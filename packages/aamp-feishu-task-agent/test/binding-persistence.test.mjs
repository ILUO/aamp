import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const controllerPath = path.resolve(__dirname, '../bin/feishu-task-agent-controller.mjs')
const root = mkdtempSync(path.join(tmpdir(), 'aamp-binding-persistence-'))
const stateHome = path.join(root, 'state')
const runtimeHome = path.join(stateHome, 'runtime-v1')
const configFile = path.join(stateHome, 'bindings-v1.json')

process.env.AAMP_TASK_STATE_HOME = stateHome
process.env.AAMP_TASK_RUNTIME_HOME = runtimeHome
process.env.AAMP_TASK_CONFIG_FILE = configFile
process.env.AAMP_RUN_LOG_DIR = path.join(root, 'logs')

const controller = await import(pathToFileURL(controllerPath).href)

after(() => rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  rmSync(stateHome, { recursive: true, force: true })
  mkdirSync(stateHome, { recursive: true })
})

function expectedFeishuConfigDir(bindingId) {
  return path.join(runtimeHome, 'bindings', bindingId, 'feishu-bridge')
}

function expectedRuntime(bindingId) {
  const bindingHome = expectedFeishuConfigDir(bindingId)
  return {
    im_config_dir: path.join(bindingHome, 'task-runtime', 'instances', 'im'),
    task_config_dir: path.join(bindingHome, 'task-runtime', 'instances', 'task'),
    feishu_bridge_email: `${bindingId}@meshmail.ai`,
  }
}

function pendingBinding(bindingId, appId) {
  return {
    binding_id: bindingId,
    agent_type: 'codex',
    aamp_host: 'https://meshmail.ai',
    environment: { name: 'online' },
    bot: {
      app_id: appId,
      app_secret: `secret-${appId}`,
      display_name: appId,
      lark_cli_profile: `profile-${appId}`,
    },
    feishu_config_dir: expectedFeishuConfigDir(bindingId),
    state: 'pending',
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
  }
}

function readyBinding(bindingId, appId) {
  return {
    ...pendingBinding(bindingId, appId),
    state: 'ready',
    agent_target_email: `${bindingId}@meshmail.ai`,
    runtime: expectedRuntime(bindingId),
  }
}

function writeStore(bindings) {
  writeFileSync(configFile, `${JSON.stringify({
    schema: 'aamp.feishu-task-agent.bindings',
    version: 1,
    bindings,
  }, null, 2)}\n`)
}

function readStore() {
  return JSON.parse(readFileSync(configFile, 'utf8'))
}

function functionRange(source, startName, endName) {
  const start = source.indexOf(startName)
  const end = source.indexOf(`\n${endName}`, start)
  assert.notEqual(start, -1, `${startName} must exist`)
  assert.notEqual(end, -1, `${endName} must follow ${startName}`)
  return source.slice(start, end)
}

test('upsertBindings appends new Bots without removing existing bindings', async () => {
  const existing = readyBinding('11111111-1111-4111-8111-111111111111', 'cli_old')
  writeStore([existing])

  const fresh = pendingBinding('22222222-2222-4222-8222-222222222222', 'cli_new')
  const result = await controller.upsertBindings([{ binding: fresh, expected: undefined }])

  assert.equal(result.replacedCount, 0)
  assert.deepEqual(readStore().bindings.map(({ bot }) => bot.app_id), ['cli_old', 'cli_new'])
})

test('upsertBindings atomically replaces the approved Bot in its original position', async () => {
  const existing = readyBinding('11111111-1111-4111-8111-111111111111', 'cli_same')
  const untouched = readyBinding('22222222-2222-4222-8222-222222222222', 'cli_keep')
  writeStore([existing, untouched])

  const replacement = pendingBinding('33333333-3333-4333-8333-333333333333', 'cli_same')
  const result = await controller.upsertBindings([{
    binding: replacement,
    expected: controller.bindingExpectation(existing),
  }])

  assert.equal(result.replacedCount, 1)
  const bindings = readStore().bindings
  assert.deepEqual(bindings.map(({ binding_id }) => binding_id), [
    '33333333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
  ])
  assert.equal(bindings[0].state, 'pending')
  assert.equal('runtime' in bindings[0], false)
  assert.equal('agent_target_email' in bindings[0], false)
})

test('upsertBindings rejects a stale approval without partially writing the batch', async () => {
  const approved = readyBinding('11111111-1111-4111-8111-111111111111', 'cli_same')
  writeStore([approved])
  const expectation = controller.bindingExpectation(approved)

  const changed = readyBinding('22222222-2222-4222-8222-222222222222', 'cli_same')
  changed.updated_at = '2026-08-12T22:00:00.000Z'
  writeStore([changed])

  await assert.rejects(
    controller.upsertBindings([
      {
        binding: pendingBinding('33333333-3333-4333-8333-333333333333', 'cli_same'),
        expected: expectation,
      },
      {
        binding: pendingBinding('44444444-4444-4444-8444-444444444444', 'cli_other'),
        expected: undefined,
      },
    ]),
    /绑定已发生变化，请重新执行/,
  )
  assert.deepEqual(readStore().bindings.map(({ binding_id }) => binding_id), [
    '22222222-2222-4222-8222-222222222222',
  ])
})

test('install and add explicitly confirm persisted duplicate Bots', () => {
  const source = readFileSync(controllerPath, 'utf8')
  assert.match(source, /Bot .* 已存在绑定/)
  assert.match(source, /拟替换为/)
  assert.match(source, /await confirm\('是否替换绑定？', false\)/)
  assert.doesNotMatch(source, /mode === 'add'\s*\?\s*store\.bindings/)
})

test('declining a replacement returns to the continue-selection prompt', () => {
  const source = readFileSync(controllerPath, 'utf8')
  const session = functionRange(source, 'async function runBindingSession(', 'async function runInstall(')
  const duplicateStart = session.indexOf('if (existing)')
  const acceptedStart = session.indexOf('bindingIntents.push', duplicateStart)
  assert.notEqual(duplicateStart, -1)
  assert.notEqual(acceptedStart, -1)
  assert.ok(duplicateStart < acceptedStart, 'replacement decision must precede accepting the binding')
  const duplicateBranch = session.slice(duplicateStart, acceptedStart)
  assert.doesNotMatch(duplicateBranch, /continue;/)
  assert.match(session, /keepGoing = await confirm\('是否继续选择本地智能体和 Bot？', false\)/)
})

test('install saves accepted pending bindings before Agent setup and uses the shared launcher', () => {
  const source = readFileSync(controllerPath, 'utf8')
  const session = functionRange(source, 'async function runBindingSession(', 'async function runInstall(')
  const persisted = session.indexOf('await upsertBindings(bindingIntents)')
  const setup = session.indexOf('await setupAgentGroups(saved)')
  assert.notEqual(persisted, -1, 'install must persist accepted drafts')
  assert.notEqual(setup, -1, 'install must set up Agent groups')
  assert.ok(persisted < setup, 'install must persist accepted drafts before setting up Agent groups')
  assert.match(session, /startBindingsWithGroups\(saved, groups, mode\)/)
  assert.doesNotMatch(session, /updateBinding/)
  assert.doesNotMatch(session, /replaceBindings\(bound\.succeeded\)/)
})

test('a failed install start keeps the already-saved pending binding', () => {
  const source = readFileSync(controllerPath, 'utf8')
  const session = functionRange(source, 'async function runBindingSession(', 'async function runInstall(')
  const launchStart = session.indexOf('await startBindingsWithGroups(saved, groups, mode)')
  assert.notEqual(launchStart, -1, 'install must launch saved drafts for binding')
  const launchBranch = session.slice(launchStart)
  assert.doesNotMatch(launchBranch, /removeBinding|replaceBindings/)
  assert.match(launchBranch, /failed\.push\(\.\.\.launched\.failed\)/)
})

test('install startup errors say the binding remains saved for retry', () => {
  const source = readFileSync(controllerPath, 'utf8')
  const reporter = functionRange(source, 'function reportBindingFailure(', 'const bindingLauncherOperations = ')
  const finalizer = functionRange(source, 'async function finalizeDeferredLaunchResults(', 'async function startBindingsWithGroups(')
  const launcher = functionRange(source, 'async function startBindingsWithGroups(', 'function startupDisposition(')
  assert.match(reporter, /🔴 启动失败：\$\{bindingLabel\(binding, runtimeAgentType\)\}/)
  assert.match(reporter, /绑定配置已保存，可稍后运行 feishu-task-agent start 重试/)
  assert.match(finalizer, /operations\.reportBindingFailure\([\s\S]*item\.runtimeAgentType,[\s\S]*item\.reason,[\s\S]*mode/)
  assert.match(finalizer, /setBindingStatus\(item\.binding, 'start', 'failed', item\.reason\)/)
  assert.match(launcher, /finalizeDeferredLaunchResults\(launched, mode, operations\)/)
})

test('add saves one atomic batch and never starts Agent groups', () => {
  const source = readFileSync(controllerPath, 'utf8')
  const session = functionRange(source, 'async function runBindingSession(', 'async function runInstall(')
  const saveStart = session.indexOf('await upsertBindings(bindingIntents)')
  const addStart = session.indexOf("if (mode === 'add')")
  const installStart = session.indexOf("console.log('\\n=== 建立绑定并启动 ===')")
  assert.notEqual(saveStart, -1)
  assert.notEqual(addStart, -1)
  assert.notEqual(installStart, -1)
  assert.ok(saveStart < addStart, 'add and install must share the same atomic batch save')
  assert.ok(addStart < installStart, 'add must return before install process setup')
  const addBranch = session.slice(addStart, installStart)
  assert.doesNotMatch(addBranch, /setupAgentGroups|prepareBindingStart|executePreparedBindingStart/)
})

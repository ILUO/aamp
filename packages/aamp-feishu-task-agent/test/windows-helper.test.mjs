import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fork } from 'node:child_process'
import {
  runWindowsHelper,
  versionAtLeast,
} from '../bootstrap/windows-helper.mjs'

function fakeCommand() {
  return process.execPath
}

test('register binding preserves SDK request parity and exact Lark profile contract', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-register-'))
  const sdk = path.join(root, 'sdk.mjs')
  const calls = path.join(root, 'sdk-call.json')
  const cli = path.join(root, 'lark-cli.mjs')
  writeFileSync(
    sdk,
    `import {writeFileSync} from 'node:fs'; export const Domain={Feishu:'feishu',Lark:'lark'}; export async function registerApp(options){writeFileSync(${JSON.stringify(calls)},JSON.stringify({source:options.source,appPreset:options.appPreset,addons:options.addons}));options.onStatusChange({status:'domain_switched'});return {client_id:'cli_registered',client_secret:'registration-secret',user_info:{tenant_brand:'lark'}}};export class Client{constructor(){this.application={application:{get:async()=>({data:{app:{app_name:'Lark Bot'}}})}}}}`,
  )
  writeFileSync(
    cli,
    `let i='';process.stdin.on('data',c=>i+=c);process.stdin.on('end',()=>{const a=process.argv.slice(2);if(a[0]==='--version')console.log('lark-cli version 1.0.64');else if(a.join(' ')==='profile list')console.log('[]');else if(a.some(v=>v.includes('user_info')))console.log('{"data":{"tenant_key":"tenant-lark"}}')})`,
  )
  const result = await runWindowsHelper(
    '__register-binding',
    {},
    {
      AAMP_REGISTER_APP_SDK_MODULE: sdk,
      AAMP_LARK_CLI_BIN: cli,
      AAMP_FEISHU_AUTH_STATE_DIR: path.join(root, 'auth'),
      AAMP_LARK_CLI_CONFIG_DIR: path.join(root, 'config'),
      FEISHU_USER_AUTH_MODE: 'disabled',
      AAMP_TASK_TEST_NO_BROWSER: 'true',
      SDK_CALLS: calls,
    },
  )
  assert.deepEqual(result, {
    app_id: 'cli_registered',
    app_secret: 'registration-secret',
    display_name: 'Lark Bot',
    tenant_brand: 'lark',
    tenant_key: 'tenant-lark',
    lark_cli_profile: 'aamp-feishu-task-cli_registered-lark',
    auth_mode: 'lark-cli',
  })
  const request = JSON.parse(readFileSync(calls, 'utf8'))
  assert.equal(request.source, 'aamp-feishu-task-agent')
  assert.equal(request.appPreset.desc, 'AAMP Feishu bridge bot')
  assert.equal(
    request.addons.scopes.tenant.includes('im:message:send_as_bot'),
    true,
  )
  assert.deepEqual(request.addons.events.items.tenant, [
    'task.task.update_user_access_v2',
  ])
})

test('discovers only proven native existing agent types in stable order', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-discover-'))
  const result = await runWindowsHelper(
    '__discover-agents',
    {},
    {
      AAMP_CODEX_CLI_BIN: fakeCommand(root, 'codex'),
      AAMP_CURSOR_CLI_BIN: fakeCommand(root, 'cursor-agent'),
      AAMP_TRAE_CLI_BIN: path.join(root, 'missing'),
    },
  )
  assert.deepEqual(result, { agents: ['codex'] })
})

test('prepare codex returns a wrapper command without secrets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-prepare-'))
  const codex = fakeCommand(root, 'codex')
  const result = await runWindowsHelper(
    '__prepare-agent',
    { agent_type: 'codex' },
    {
      AAMP_CODEX_CLI_BIN: codex,
      AAMP_TASK_SKIP_LOGIN_CHECK: 'true',
      AAMP_LARK_CLI_CONFIG_DIR: path.join(root, 'lark'),
      AAMP_TASK_RUNTIME_HOME: path.join(root, 'runtime'),
    },
  )
  assert.equal(result.agent_type, 'codex')
  assert.match(result.acp_command, /windows-agent-wrapper\.mjs/)
  assert.equal(result.lark_cli_config_dir, path.join(root, 'lark'))
  assert.doesNotMatch(result.acp_command, /secret/i)
})

test('IPC sends exactly one result and unknown actions return a sanitized error', async () => {
  const helper = new URL('../bootstrap/windows-helper.mjs', import.meta.url)
  const messages = []
  const child = fork(helper, [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, PATH: '' },
  })
  child.on('message', (m) => messages.push(m))
  child.send({
    kind: 'request',
    action: '__unknown',
    payload: { app_secret: 'secret-sentinel' },
  })
  await new Promise((resolve) => child.once('exit', resolve))
  assert.equal(messages.length, 1)
  assert.deepEqual(Object.keys(messages[0]).sort(), ['kind', 'message'])
  assert.equal(messages[0].kind, 'error')
  assert.doesNotMatch(JSON.stringify(messages), /secret-sentinel/)
})

test('minimum version compares numeric components in order', () => {
  assert.equal(versionAtLeast('0.9.99', '1.0.64'), false)
  assert.equal(versionAtLeast('1.0.63', '1.0.64'), false)
  assert.equal(versionAtLeast('1.0.64', '1.0.64'), true)
  assert.equal(versionAtLeast('1.1.0', '1.0.64'), true)
  assert.equal(versionAtLeast('unknown', '1.0.64'), false)
})

test('explicit Codex ACP override reaches the wrapper config', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-override-'))
  await runWindowsHelper(
    '__prepare-agent',
    { agent_type: 'codex' },
    {
      AAMP_CODEX_CLI_BIN: process.execPath,
      AAMP_TASK_SKIP_LOGIN_CHECK: 'true',
      AAMP_TASK_RUNTIME_HOME: root,
      AAMP_TASK_CODEX_ACP_PKG: 'custom-codex-acp@2.0.0',
    },
  )
  assert.equal(
    JSON.parse(
      readFileSync(path.join(root, 'windows-codex-agent.json'), 'utf8'),
    ).args.at(-1),
    'custom-codex-acp@2.0.0',
  )
})


test('registration prints original authorization URL and expiry when browser opening fails',async()=>{
  const {registerFeishuApp}=await import('../bootstrap/register-feishu-app.mjs')
  const logs=[]
  const sdk={registerApp:async options=>{options.onQRCodeReady({url:'https://example.test/authorize?code=test',expireIn:180});return {client_id:'cli',client_secret:'secret'}},Domain:{Feishu:'feishu'},Client:class{constructor(){this.application={application:{get:async()=>({data:{app:{app_name:'Bot'}}})}}}}}
  const result=await registerFeishuApp({sdk,openUrl:()=>{throw new Error('browser blocked')},log:message=>logs.push(message)})
  assert.equal(result.app_id,'cli')
  assert.deepEqual(logs,['请打开授权链接完成飞书 Bot 授权（180 秒内有效）：https://example.test/authorize?code=test'])
})

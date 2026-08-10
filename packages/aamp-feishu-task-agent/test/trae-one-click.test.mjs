import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bootstrap = path.resolve(__dirname, '../bootstrap/aamp-feishu-task-agent-bootstrap.sh')
const controller = path.resolve(__dirname, '../bin/feishu-task-agent-controller.mjs')
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))

function shell(source, args = []) {
  return spawnSync('bash', ['-c', source, 'bash', ...args], { encoding: 'utf8' })
}

function functionRange(source, startName, endName) {
  const start = source.indexOf(startName)
  const end = source.indexOf('\n' + endName, start)
  assert.notEqual(start, -1, startName + ' must exist')
  assert.notEqual(end, -1, endName + ' must follow ' + startName)
  return source.slice(start, end)
}

test('bootstrap resolves Trae aliases in order and builds a safe native ACP command', () => {
  const source = readFileSync(bootstrap, 'utf8')
  const helpers = functionRange(source, 'find_trae_cli()', 'ensure_agent_cli()')
    + '\n' + functionRange(source, 'build_acp_agent_command()', 'validate_codex_acp_command()')

  for (const names of [['traecli', 'traex'], ['traex']]) {
    const root = mkdtempSync(path.join(tmpdir(), 'aamp-trae-aliases-'))
    const binDir = path.join(root, 'bin')
    mkdirSync(binDir)
    for (const name of names) {
      const executable = path.join(binDir, name)
      writeFileSync(executable, '#!/usr/bin/env bash\nexit 0\n')
      chmodSync(executable, 0o755)
    }
    const result = shell([
      'set -euo pipefail',
      'PATH="$1/bin:/usr/bin:/bin"',
      'AGENT="trae"',
      'agent_fail() { printf "%s\\n" "$*" >&2; exit 1; }',
      'agent_detail() { :; }',
      helpers,
      'resolved="$(resolve_trae_cli)"',
      'build_acp_agent_command',
      'printf "%s|%s" "$resolved" "$ACP_AGENT_COMMAND"',
    ].join('\n'), [root])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, names.includes('traecli') ? 'traecli|traecli acp serve' : 'traex|traex acp serve')
    assert.doesNotMatch(result.stdout, /--yolo/)
  }
})

test('bootstrap discovers and validates canonical Trae without accepting unrelated agents', () => {
  const source = readFileSync(bootstrap, 'utf8')
  const validate = functionRange(source, 'validate_agent_name()', 'read_tty_line()')
  const discovery = functionRange(source, 'agent_cli_detected()', 'move_agent_menu_cursor_up()')
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-trae-discovery-'))
  const binDir = path.join(root, 'bin')
  mkdirSync(binDir)
  writeFileSync(path.join(binDir, 'traex'), '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(path.join(binDir, 'traex'), 0o755)
  const discovered = shell([
    'set -euo pipefail',
    'PATH="$1/bin:/usr/bin:/bin"',
    'agent_fail() { exit 64; }',
    'resolve_codex_cli_for_acp() { return 1; }',
    'find_cursor_agent_cli() { return 1; }',
    'find_trae_cli() { command -v traex; }',
    validate,
    discovery,
    'validate_agent_name trae',
    'discover_interactive_agents',
    'printf "%s" "$' + '{DETECTED_AGENTS[*]}"',
  ].join('\n'), [root])
  assert.equal(discovered.status, 0, discovered.stderr)
  assert.equal(discovered.stdout, 'trae')
  const invalid = shell(['set -euo pipefail', 'agent_fail() { exit 64; }', validate, 'validate_agent_name unrelated'].join('\n'))
  assert.equal(invalid.status, 64)
})

test('bootstrap performs Trae login before accepting a successful status check', () => {
  const source = readFileSync(bootstrap, 'utf8')
  const helpers = functionRange(source, 'run_trae_login_status()', 'print_cursor_gatekeeper_help()')
    + '\n' + functionRange(source, 'ensure_agent_login()', 'run_acp_bridge()')
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-trae-login-'))
  const fakeTrae = path.join(root, 'traecli')
  const calls = path.join(root, 'calls.log')
  const loggedIn = path.join(root, 'logged-in')
  writeFileSync(fakeTrae, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$*" >> "' + calls + '"',
    'if [ "$1" = login ] && [ "$' + '{2:-}" = status ] && [ ! -f "' + loggedIn + '" ]; then exit 1; fi',
    'if [ "$1" = login ]; then touch "' + loggedIn + '"; fi',
    '',
  ].join('\n'))
  chmodSync(fakeTrae, 0o755)
  const result = shell([
    'set -euo pipefail',
    'AGENT="trae"',
    'FAKE_TRAE="$1"',
    'resolve_trae_cli() { printf "%s\\n" "$FAKE_TRAE"; }',
    'agent_log() { :; }',
    'agent_detail() { :; }',
    'agent_fail() { exit 1; }',
    'clear_codex_quarantine() { :; }',
    'clear_cursor_quarantine() { :; }',
    helpers,
    'ensure_agent_login',
  ].join('\n'), [fakeTrae])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), ['login status', 'login', 'login status'])
})

test('controller lists a valid pending Trae binding using temporary state only', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-controller-trae-'))
  const stateHome = path.join(root, 'state')
  const runtimeHome = path.join(stateHome, 'runtime-v1')
  const bindingId = '11111111-1111-4111-8111-111111111111'
  const configFile = path.join(stateHome, 'bindings-v1.json')
  mkdirSync(stateHome, { recursive: true })
  const binding = {
    binding_id: bindingId,
    agent_type: 'trae',
    aamp_host: 'https://meshmail.ai',
    environment: { name: 'online' },
    bot: { app_id: 'cli_test_app', app_secret: 'test-only-secret', lark_cli_profile: 'test-only-profile' },
    feishu_config_dir: path.join(runtimeHome, 'bindings', bindingId, 'feishu-bridge'),
    state: 'pending',
  }
  writeFileSync(configFile, JSON.stringify({ schema: 'aamp.feishu-task-agent.bindings', version: 1, bindings: [binding] }, null, 2) + '\n')
  const result = spawnSync(process.execPath, [controller, 'list'], {
    env: { ...process.env, HOME: root, AAMP_TASK_STATE_HOME: stateHome, AAMP_TASK_CONFIG_FILE: configFile, AAMP_TASK_RUNTIME_HOME: runtimeHome, AAMP_RUN_LOG_DIR: path.join(root, 'logs') },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /trae/)
  assert.doesNotMatch(result.stdout, /test-only-secret/)
})

test('Trae one-click package pins move together', () => {
  const bootstrapSource = readFileSync(bootstrap, 'utf8')
  const controllerSource = readFileSync(controller, 'utf8')
  const acpPackage = JSON.parse(readFileSync(path.resolve(__dirname, '../../aamp-acp-bridge/package.json'), 'utf8'))
  const acpLock = JSON.parse(readFileSync(path.resolve(__dirname, '../../aamp-acp-bridge/package-lock.json'), 'utf8'))
  const taskLock = JSON.parse(readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'))
  assert.equal(acpPackage.version, '0.1.28-dev.21')
  assert.equal(acpLock.version, acpPackage.version)
  assert.equal(acpLock.packages[''].version, acpPackage.version)
  assert.equal(packageJson.version, '0.1.0-dev.175')
  assert.equal(taskLock.version, packageJson.version)
  assert.equal(taskLock.packages[''].version, packageJson.version)
  assert.match(bootstrapSource, /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@zengxingyuan\/aamp-acp-bridge@0\.1\.28-dev\.21\}"/)
  assert.match(controllerSource, /@zengxingyuan\/aamp-acp-bridge@0\.1\.28-dev\.21/)
})

test('Trae one-click user-facing agent guidance is not stale', () => {
  const bootstrapSource = readFileSync(bootstrap, 'utf8')
  assert.match(bootstrapSource, /pass --agent codex\|cursor\|trae/)
  assert.doesNotMatch(bootstrapSource, /pass --agent codex\|cursor(?!\|trae)/)
})

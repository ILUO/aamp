import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  KNOWN_AGENTS,
  WORKBUDDY_AI_APP_CLI,
  WORKBUDDY_APP_CLI,
  defaultAcpCommand,
  detectKnownAgent,
  missingAgentWarning,
} from '../src/agent-resolver.js'
import { withFakePath } from './path-fixture.js'

const WORKBUDDY_AI_ACP_COMMAND = `'${WORKBUDDY_AI_APP_CLI}' --acp`

test('registers only traex as a native Trae profile', () => {
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'traex').length, 1)
  for (const legacyName of ['trae', 'traecli', 'coco']) {
    assert.equal(KNOWN_AGENTS.includes(legacyName), false)
  }
})

test('detects traex and maps its native ACP command', {
  skip: process.platform === 'win32',
}, () => {
  withFakePath([{ name: 'traex', version: 'traecli 0.200.19' }], () => {
    assert.deepEqual(detectKnownAgent('traex'), {
      command: 'traex',
      acpCommand: 'traex acp serve',
      version: 'traecli 0.200.19',
    })
    assert.equal(defaultAcpCommand('traex'), 'traex acp serve')
  })
})

test('does not fall back to traecli or coco', {
  skip: process.platform === 'win32',
}, () => {
  withFakePath([
    { name: 'traecli', version: 'legacy' },
    { name: 'coco', version: 'legacy' },
  ], () => {
    assert.equal(detectKnownAgent('traex'), undefined)
    assert.equal(defaultAcpCommand('traex'), 'traex acp serve')
    assert.equal(missingAgentWarning('traex'), 'traex was not found on PATH.')
  })
})

test('preserves representative existing native mappings', {
  skip: process.platform === 'win32',
}, () => {
  withFakePath([
    { name: 'claude', version: 'claude 1.0.0' },
    { name: 'hermes', version: 'hermes 1.0.0' },
  ], () => {
    assert.equal(detectKnownAgent('claude')?.acpCommand, 'claude')
    assert.equal(detectKnownAgent('hermes')?.acpCommand, 'hermes acp')
    assert.equal(
      defaultAcpCommand('codex', 'npx -y custom-codex-acp'),
      'npx -y custom-codex-acp',
    )
  })
})

test('registers workbuddy exactly once as a known ACP agent', () => {
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'workbuddy').length, 1)
})

test('registers WorkBuddy and WorkBuddy AI as distinct canonical agents', () => {
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'workbuddy').length, 1)
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'workbuddy_ai').length, 1)
  for (const alias of ['workbuddy ai', 'workbuddy-ai', 'workbuddyai']) {
    assert.equal(KNOWN_AGENTS.includes(alias), false)
  }
})

test('resolves WorkBuddy AI only from its international macOS bundle', () => {
  const seen: string[] = []
  const resolution = detectKnownAgent('workbuddy_ai', {
    platform: 'darwin',
    pathExists: (candidate) => {
      seen.push(candidate)
      return candidate === WORKBUDDY_AI_APP_CLI
    },
    versionFor: () => '2.115.0',
  })

  assert.deepEqual(resolution, {
    command: WORKBUDDY_AI_APP_CLI,
    acpCommand: WORKBUDDY_AI_ACP_COMMAND,
    version: '2.115.0',
  })
  assert.deepEqual(seen, [WORKBUDDY_AI_APP_CLI])
  assert.notEqual(WORKBUDDY_AI_APP_CLI, WORKBUDDY_APP_CLI)
  assert.equal(defaultAcpCommand('workbuddy_ai'), WORKBUDDY_AI_ACP_COMMAND)
})

test('WorkBuddy AI ACP command keeps the application path as one shell word', {
  skip: process.platform === 'win32',
}, () => {
  const resolution = detectKnownAgent('workbuddy_ai', {
    platform: 'darwin',
    pathExists: (candidate) => candidate === WORKBUDDY_AI_APP_CLI,
    versionFor: () => '2.115.0',
  })
  assert.ok(resolution)

  const parsed = spawnSync('bash', [
    '-c',
    'eval "set -- $1"; printf "%s\\0" "$@"',
    'bash',
    resolution.acpCommand,
  ], { encoding: 'buffer' })

  assert.equal(parsed.status, 0, parsed.stderr.toString())
  assert.deepEqual(
    parsed.stdout.toString().split('\0').filter(Boolean),
    [WORKBUDDY_AI_APP_CLI, '--acp'],
  )
})

test('WorkBuddy products do not fall back to each other', () => {
  assert.equal(detectKnownAgent('workbuddy_ai', {
    platform: 'darwin',
    pathExists: (candidate) => candidate === WORKBUDDY_APP_CLI,
  }), undefined)
  assert.equal(detectKnownAgent('workbuddy', {
    platform: 'darwin',
    pathExists: (candidate) => candidate === WORKBUDDY_AI_APP_CLI,
  }), undefined)
})

test('WorkBuddy AI warnings name the international product and exact path', () => {
  assert.equal(
    missingAgentWarning('workbuddy_ai', { platform: 'darwin' }),
    `WorkBuddy AI was not found at ${WORKBUDDY_AI_APP_CLI}.`,
  )
  assert.equal(
    missingAgentWarning('workbuddy_ai', { platform: 'linux' }),
    'WorkBuddy AI auto-detection is only supported on macOS; configure acpCommand explicitly.',
  )
})

test('resolves the installed macOS WorkBuddy app to its embedded ACP command', () => {
  const resolution = detectKnownAgent('workbuddy', {
    platform: 'darwin',
    pathExists: (path) => path === WORKBUDDY_APP_CLI,
    versionFor: () => '2.115.0',
  })

  assert.deepEqual(resolution, {
    command: WORKBUDDY_APP_CLI,
    acpCommand: `${WORKBUDDY_APP_CLI} --acp`,
    version: '2.115.0',
  })
})

test('reports the expected WorkBuddy app path when macOS detection fails', () => {
  assert.equal(
    missingAgentWarning('workbuddy', { platform: 'darwin' }),
    `WorkBuddy was not found at ${WORKBUDDY_APP_CLI}.`,
  )
})

test('requires an explicit WorkBuddy ACP command outside macOS', () => {
  assert.equal(detectKnownAgent('workbuddy', {
    platform: 'linux',
    pathExists: () => true,
    versionFor: () => '2.115.0',
  }), undefined)
  assert.equal(
    missingAgentWarning('workbuddy', { platform: 'linux' }),
    'WorkBuddy auto-detection is only supported on macOS; configure acpCommand explicitly.',
  )
})

test('preserves explicit ACP commands and existing Hermes defaults', () => {
  assert.equal(
    defaultAcpCommand('workbuddy', 'custom-codebuddy --acp'),
    'custom-codebuddy --acp',
  )
  assert.equal(
    defaultAcpCommand('codex', 'npx -y custom-codex-acp'),
    'npx -y custom-codex-acp',
  )
  assert.equal(defaultAcpCommand('hermes'), 'hermes acp')
})

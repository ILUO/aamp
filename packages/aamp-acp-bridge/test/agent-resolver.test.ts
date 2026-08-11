import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KNOWN_AGENTS,
  WORKBUDDY_APP_CLI,
  defaultAcpCommand,
  detectKnownAgent,
  missingAgentWarning,
} from '../src/agent-resolver.js'

test('registers workbuddy exactly once as a known ACP agent', () => {
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'workbuddy').length, 1)
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

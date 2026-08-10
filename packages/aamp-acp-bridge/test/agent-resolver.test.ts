import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  KNOWN_AGENTS,
  defaultAcpCommand,
  defaultAgentCommand,
  detectKnownAgent,
  findExecutableOnPath,
  missingAgentWarning,
} from '../src/agent-resolver.js'
import { expectedFakePathVersion, withFakePath } from './path-fixture.js'

test('registers trae exactly once as a known agent', () => {
  assert.equal(KNOWN_AGENTS.filter((name) => name === 'trae').length, 1)
})

test('prefers traecli when both Trae executables are installed', () => {
  withFakePath([
    { name: 'traecli', version: 'traecli 2.0.0' },
    { name: 'traex', version: 'traecli 2.0.0' },
  ], () => {
    assert.deepEqual(detectKnownAgent('trae'), {
      command: 'traecli',
      acpCommand: 'traecli acp serve',
      version: expectedFakePathVersion('traecli 2.0.0'),
    })
  })
})

test('falls back to traex when traecli is absent', () => {
  withFakePath([{ name: 'traex', version: 'traecli 2.0.0' }], () => {
    assert.deepEqual(detectKnownAgent('trae'), {
      command: 'traex',
      acpCommand: 'traex acp serve',
      version: expectedFakePathVersion('traecli 2.0.0'),
    })
  })
})

test('uses canonical defaults and warning when Trae is absent', () => {
  withFakePath([], () => {
    assert.equal(detectKnownAgent('trae'), undefined)
    assert.equal(defaultAgentCommand('trae'), 'traecli')
    assert.equal(defaultAcpCommand('trae'), 'traecli acp serve')
    assert.equal(missingAgentWarning('trae'), 'traecli or traex was not found on PATH.')
  })
})

test('keeps detection when the selected executable cannot report a version', () => {
  assert.equal(expectedFakePathVersion('traecli 2.0.0', 'win32'), 'installed')
  assert.equal(expectedFakePathVersion('traecli 2.0.0', 'linux'), 'traecli 2.0.0')

  withFakePath([
    { name: 'traecli', version: 'unavailable', versionExitCode: 1 },
  ], () => {
    assert.deepEqual(detectKnownAgent('trae'), {
      command: 'traecli',
      acpCommand: 'traecli acp serve',
      version: 'installed',
    })
  })
})

test('preserves previous commands and existing generic agent behavior', () => {
  withFakePath([
    { name: 'claude', version: 'claude 1.0.0' },
    { name: 'hermes', version: 'hermes 1.0.0' },
  ], () => {
    assert.equal(
      defaultAcpCommand('trae', 'traecli acp serve --yolo'),
      'traecli acp serve --yolo',
    )
    assert.deepEqual(detectKnownAgent('claude'), {
      command: 'claude',
      acpCommand: 'claude',
      version: expectedFakePathVersion('claude 1.0.0'),
    })
    assert.deepEqual(detectKnownAgent('hermes'), {
      command: 'hermes',
      acpCommand: 'hermes acp',
      version: expectedFakePathVersion('hermes 1.0.0'),
    })
    assert.equal(
      defaultAcpCommand('codex', 'npx -y custom-codex-acp'),
      'npx -y custom-codex-acp',
    )
  })
})

test('ignores blank Trae commands and preserves nonblank commands verbatim', () => {
  withFakePath([{ name: 'traex', version: 'traecli 2.0.0' }], () => {
    assert.equal(defaultAcpCommand('trae', ''), 'traex acp serve')
    assert.equal(defaultAcpCommand('trae', '   '), 'traex acp serve')

    const customCommand = '  traecli acp serve --model "doubao pro" --yolo  '
    assert.equal(defaultAcpCommand('trae', customCommand), customCommand)
  })
})

test('POSIX lookup requires an executable file on PATH', {
  skip: process.platform === 'win32',
}, () => {
  withFakePath([
    { name: 'traecli', version: 'traecli 2.0.0', executable: false },
  ], (directory) => {
    assert.equal(findExecutableOnPath('traecli', {
      platform: 'linux',
      env: { PATH: directory },
    }), undefined)
  })
})

test('Windows lookup honors PATHEXT and already-suffixed commands', () => {
  withFakePath([
    { name: 'traecli.CMD', version: 'traecli 2.0.0' },
    { name: 'traex.EXE', version: 'traecli 2.0.0' },
  ], (directory) => {
    const env = { PATH: directory, PATHEXT: '.EXE;.CMD' }
    assert.equal(findExecutableOnPath('traecli', { platform: 'win32', env }), join(directory, 'traecli.CMD'))
    assert.equal(findExecutableOnPath('traecli.CMD', { platform: 'win32', env }), join(directory, 'traecli.CMD'))
    assert.equal(findExecutableOnPath('traex', {
      platform: 'win32',
      env: { Path: directory },
    }), join(directory, 'traex.EXE'))
  })
})

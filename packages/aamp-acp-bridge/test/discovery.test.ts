import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  discoverAcpBridgeAgents,
  type AcpBridgeAgentCandidate,
} from '../src/discovery.js'
import { expectedFakePathVersion, withFakePath } from './path-fixture.js'

function findTrae(configPath: string): AcpBridgeAgentCandidate {
  const candidates = discoverAcpBridgeAgents(configPath).candidates
    .filter((candidate) => candidate.id === 'trae')
  assert.equal(candidates.length, 1)
  return candidates[0]
}

test('discovers canonical trae through traecli', () => {
  withFakePath([{ name: 'traecli', version: 'traecli 2.0.0' }], (directory) => {
    const candidate = findTrae(join(directory, 'missing-config.json'))
    assert.deepEqual(candidate, {
      id: 'trae',
      displayName: 'trae',
      connection: 'acp_bridge',
      detected: true,
      configured: false,
      confidence: 'high',
      command: 'traecli',
      acpCommand: 'traecli acp serve',
      version: expectedFakePathVersion('traecli 2.0.0'),
      warnings: [],
    })
  })
})

test('reports canonical Trae defaults when both aliases are missing', () => {
  withFakePath([], (directory) => {
    const candidate = findTrae(join(directory, 'missing-config.json'))
    assert.equal(candidate.detected, false)
    assert.equal(candidate.configured, false)
    assert.equal(candidate.confidence, 'low')
    assert.equal(candidate.command, 'traecli')
    assert.equal(candidate.acpCommand, 'traecli acp serve')
    assert.deepEqual(candidate.warnings, [
      'traecli or traex was not found on PATH.',
    ])
  })
})

test('preserves a configured Trae ACP command', () => {
  withFakePath([], (directory) => {
    const configPath = join(directory, 'bridge.json')
    writeFileSync(configPath, JSON.stringify({
      aampHost: 'https://meshmail.ai',
      rejectUnauthorized: false,
      agents: [{
        name: 'trae',
        acpCommand: 'traex acp serve --yolo',
        credentialsFile: join(directory, 'missing-credentials.json'),
      }],
    }))

    const candidate = findTrae(configPath)
    assert.equal(candidate.detected, false)
    assert.equal(candidate.configured, true)
    assert.equal(candidate.confidence, 'medium')
    assert.equal(candidate.command, 'traecli')
    assert.equal(candidate.acpCommand, 'traex acp serve --yolo')
  })
})

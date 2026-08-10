import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolveInitAcpCommand } from '../src/cli/init.js'
import { withFakePath } from './path-fixture.js'

test('interactive init preserves a selected Trae agent custom ACP command', () => {
  withFakePath([{ name: 'traecli', version: 'traecli 2.0.0' }], (directory) => {
    const configPath = join(directory, 'bridge.json')
    const customCommand = 'traecli acp serve --model "doubao pro" --yolo'
    writeFileSync(configPath, JSON.stringify({
      agents: [
        { name: 'claude', acpCommand: 'claude' },
        { name: 'trae', acpCommand: customCommand },
      ],
    }))

    assert.equal(resolveInitAcpCommand(configPath, 'trae'), customCommand)
  })
})

test('interactive init ignores blank or malformed legacy Trae commands', () => {
  withFakePath([{ name: 'traecli', version: 'traecli 2.0.0' }], (directory) => {
    const configPath = join(directory, 'bridge.json')

    for (const acpCommand of ['', '   ', 42, null]) {
      writeFileSync(configPath, JSON.stringify({
        agents: [{ name: 'trae', acpCommand }],
      }))
      assert.equal(resolveInitAcpCommand(configPath, 'trae'), 'traecli acp serve')
    }

    writeFileSync(configPath, '{ malformed json')
    assert.equal(resolveInitAcpCommand(configPath, 'trae'), 'traecli acp serve')
  })
})

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runJsonInit } from '../src/json-init.js'

test('JSON init rejects empty and whitespace-only explicit ACP commands', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aamp-json-init-test-'))
  const configPath = join(directory, 'bridge.json')
  const credentialsFile = join(directory, 'credentials.json')

  try {
    writeFileSync(credentialsFile, JSON.stringify({
      email: 'trae@example.com',
      smtpPassword: 'test-password',
    }))

    for (const acpCommand of ['', '   ', '\t\r\n']) {
      await assert.rejects(runJsonInit(configPath, {
        agents: [{ name: 'trae', acpCommand, credentialsFile }],
      }))
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('JSON init preserves a quoted multi-token ACP command verbatim', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aamp-json-init-test-'))
  const configPath = join(directory, 'bridge.json')
  const credentialsFile = join(directory, 'credentials.json')
  const command = '  traecli acp serve --model "doubao pro" --yolo  '

  try {
    writeFileSync(credentialsFile, JSON.stringify({
      email: 'trae@example.com',
      smtpPassword: 'test-password',
    }))

    const result = await runJsonInit(configPath, {
      agents: [{ name: 'trae', acpCommand: command, credentialsFile }],
    })

    assert.equal(result.agents[0].acpCommand, command)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    assert.equal(written.agents[0].acpCommand, command)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

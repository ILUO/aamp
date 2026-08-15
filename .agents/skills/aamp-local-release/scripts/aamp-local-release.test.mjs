import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const helperPath = path.join(scriptDir, 'aamp-local-release.mjs')
const skillPath = path.resolve(scriptDir, '..', 'SKILL.md')
const repoRoot = path.resolve(scriptDir, '..', '..', '..', '..')

function runHelper(args, options = {}) {
  return spawnSync(process.execPath, [helperPath, ...args], {
    encoding: 'utf8',
    ...options,
  })
}

test('local release helper never exposes a publish flag', () => {
  const help = execFileSync(process.execPath, [helperPath, '--help'], { encoding: 'utf8' })
  const source = fs.readFileSync(helperPath, 'utf8')

  assert.match(help, /--mode file\|tgz/)
  assert.match(help, /--pack/)
  assert.match(help, /Without publishing/i)
  assert.match(help, /never publishes/i)
  assert.doesNotMatch(source, /--publish/)
})

test('local release helper rejects unknown package keys', () => {
  const result = runHelper(['--package', 'bogus', '--plan-only'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Unknown package key: bogus/)
})

test('local release plan-only prints a file: startup command for the selected bridge', () => {
  const result = runHelper(['--package', 'feishuBridge', '--plan-only'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /feishuBridge@/)
  assert.match(result.stdout, /export FEISHU_BRIDGE_PKG="file:\$PWD\/packages\/aamp-feishu-bridge"/)
  assert.match(result.stdout, /feishu-task-agent start/)
  assert.doesNotMatch(result.stdout, /export ACP_BRIDGE_PKG/)
})

test('local release plan-only prints both bridge overrides for --package all', () => {
  const result = runHelper(['--plan-only'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /export ACP_BRIDGE_PKG="file:\$PWD\/packages\/aamp-acp-bridge"/)
  assert.match(result.stdout, /export FEISHU_BRIDGE_PKG="file:\$PWD\/packages\/aamp-feishu-bridge"/)
})

test('local release tgz plan-only prints an absolute tgz path without packing', () => {
  const result = runHelper(['--package', 'feishuBridge', '--mode', 'tgz', '--plan-only'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /export FEISHU_BRIDGE_PKG=\/.*zengxingyuan-aamp-feishu-bridge-[0-9][^ ]*\.tgz/)
  assert.doesNotMatch(result.stdout, /tgz=/)
})

test('local release json output is parseable and carries the startup command', () => {
  const result = runHelper(['--package', 'feishuBridge', '--plan-only', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.packages[0].key, 'feishuBridge')
  assert.match(parsed.startupCommand, /FEISHU_BRIDGE_PKG="file:\$PWD\/packages\/aamp-feishu-bridge"/)
  assert.ok(Array.isArray(parsed.notes))
})

test('local release skill documents restart-before-start and no-publish', () => {
  const skill = fs.readFileSync(skillPath, 'utf8')

  assert.match(skill, /stop the current Task Agent/i)
  assert.match(skill, /never publishes/i)
  assert.match(skill, /ACP_BRIDGE_PKG|FEISHU_BRIDGE_PKG/)
})

test('local release helper discovers the repo root from its own location', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'aamp-feishu-bridge', 'package.json')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'aamp-local-release', 'SKILL.md')), true)
})

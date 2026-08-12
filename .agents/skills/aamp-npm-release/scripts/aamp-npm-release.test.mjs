import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const helperPath = path.join(scriptDir, 'aamp-npm-release.mjs')
const skillPath = path.resolve(scriptDir, '..', 'SKILL.md')

test('release helper defaults generated startup commands to the coco agent type', () => {
  const help = execFileSync(process.execPath, [helperPath, '--help'], { encoding: 'utf8' })
  const source = fs.readFileSync(helperPath, 'utf8')

  assert.match(help, /--agent NAME\s+Agent used in printed startup commands\. Default: coco/)
  assert.match(source, /agent: 'coco'/)
  assert.match(source, /options\.agent !== 'coco'/)
  assert.doesNotMatch(help, /Default: trae\b/)
})

test('release skill documents the canonical startup agent types and coco default', () => {
  const skill = fs.readFileSync(skillPath, 'utf8')

  assert.match(skill, /`codex`,\s+`cursor`, `coco`, `traex`, `traecli`, and `workbuddy`/)
  assert.match(skill, /defaults?\s+generated startup commands to `--agent coco`/i)
})

test('release helper rejects the removed trae agent type', () => {
  const result = spawnSync(process.execPath, [helperPath, '--agent', 'trae', '--help'], {
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--agent must be one of: codex, cursor, coco, traex, traecli, workbuddy/)
})

test('release wizard rejects the removed trae agent type before generating commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-release-pm-'))
  const fakeNpm = path.join(root, 'npm')
  fs.writeFileSync(fakeNpm, [
    '#!/usr/bin/env bash',
    'case "$1" in',
    '  --version) printf "10.0.0\\n" ;;',
    '  whoami) printf "luckyterry\\n" ;;',
    '  view) printf "[]\\n" ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'))
  fs.chmodSync(fakeNpm, 0o755)

  const result = spawnSync(process.execPath, [helperPath, '--wizard', '--pm', fakeNpm], {
    encoding: 'utf8',
    input: '1\n\ntrae\nall\n',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--agent must be one of: codex, cursor, coco, traex, traecli, workbuddy/)
  assert.doesNotMatch(result.stdout, /--agent trae\b/)
})

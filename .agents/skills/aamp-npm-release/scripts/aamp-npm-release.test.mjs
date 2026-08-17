import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const helperPath = path.join(scriptDir, 'aamp-npm-release.mjs')
const skillPath = path.resolve(scriptDir, '..', 'SKILL.md')

function createFakeNpm(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-release-pm-'))
  const fakeNpm = path.join(root, 'npm')
  fs.writeFileSync(fakeNpm, [
    '#!/usr/bin/env bash',
    'case "$1" in',
    '  --version) printf "10.0.0\\n" ;;',
    '  whoami) printf "luckyterry\\n" ;;',
    '  view) printf "[\\"0.1.0-dev.0\\"]\\n" ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'))
  fs.chmodSync(fakeNpm, 0o755)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return fakeNpm
}

function createRegistryAwareFakeNpm(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-release-registry-pm-'))
  const fakeNpm = path.join(root, 'npm')
  fs.writeFileSync(fakeNpm, [
    '#!/usr/bin/env bash',
    'printf "%s\n" "$*" >> "$AAMP_FAKE_NPM_LOG"',
    'case "$1" in',
    '  --version) printf "%s\n" "10.0.0" ;;',
    '  whoami) printf "%s\n" "luckyterry" ;;',
    "  view) printf '[\"0.1.0-dev.7\"]\\n' ;;",
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'))
  fs.chmodSync(fakeNpm, 0o755)
  const log = path.join(root, 'calls.log')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { fakeNpm, log }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function createSourcePackage(repo, relativeDir, name, version) {
  const packageDir = path.join(repo, relativeDir)
  writeJson(path.join(packageDir, 'package.json'), { name, version })
  writeJson(path.join(packageDir, 'package-lock.json'), {
    name,
    version,
    lockfileVersion: 3,
    packages: { '': { name, version } },
  })
}

function createReleaseRepo(t, versions = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-release-repo-'))
  const packageVersions = {
    aimeAcp: '0.1.0',
    acpBridge: '1.2.3',
    feishuBridge: '3.4.5',
    taskAgent: '2.4.6',
    ...versions,
  }
  createSourcePackage(repo, 'packages/aime-acp', '@tengchengwei/aime-acp', packageVersions.aimeAcp)
  createSourcePackage(repo, 'packages/aamp-acp-bridge', '@canonical/aamp-acp-bridge', packageVersions.acpBridge)
  createSourcePackage(repo, 'packages/aamp-feishu-bridge', '@canonical/aamp-feishu-bridge', packageVersions.feishuBridge)
  createSourcePackage(repo, 'packages/aamp-feishu-task-agent', '@larktask/aamp-feishu-task-agent', packageVersions.taskAgent)

  const taskDir = path.join(repo, 'packages/aamp-feishu-task-agent')
  fs.mkdirSync(path.join(taskDir, 'bootstrap'), { recursive: true })
  fs.writeFileSync(path.join(taskDir, 'bootstrap/aamp-feishu-task-agent-bootstrap.sh'), [
    'ACP_BRIDGE_PKG="${ACP_BRIDGE_PKG:-@canonical/aamp-acp-bridge@1.2.3}"',
    'AIME_ACP_PKG="${AIME_ACP_PKG:-@tengchengwei/aime-acp@0.1.0-dev.3}"',
    'AIME_ACP_REGISTRY="${AIME_ACP_REGISTRY:-https://bnpm.byted.org}"',
    'FEISHU_BRIDGE_PKG="${FEISHU_BRIDGE_PKG:-@canonical/aamp-feishu-bridge@3.4.5}"',
    `AAMP_TASK_AGENT_VERSION="${packageVersions.taskAgent}"`,
    "aime_fallback() { printf '%s\\n' \"${AIME_ACP_PKG:-@tengchengwei/aime-acp@0.1.0-dev.3}\"; }",
    "aime_registry_fallback() { printf '%s\\n' \"${AIME_ACP_REGISTRY:-https://bnpm.byted.org}\"; }",
    '',
  ].join('\n'))
  fs.mkdirSync(path.join(taskDir, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(taskDir, 'bin/feishu-task-agent-controller.mjs'), [
    "const ACP_PACKAGE = process.env.AAMP_TASK_ACP_BRIDGE_PKG || '@canonical/aamp-acp-bridge@1.2.3';",
    "const FEISHU_PACKAGE = process.env.AAMP_TASK_FEISHU_BRIDGE_PKG || '@canonical/aamp-feishu-bridge@3.4.5';",
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(taskDir, 'README.md'), 'Task Agent fixture\n')
  fs.writeFileSync(path.join(repo, 'existing-user-change.txt'), 'before\n')

  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo })
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  return repo
}

function createStatefulFakeNpm(t, registryVersions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-release-stateful-pm-'))
  const fakeNpm = path.join(root, 'npm')
  const registryFile = path.join(root, 'registry.json')
  const log = path.join(root, 'calls.ndjson')
  writeJson(registryFile, registryVersions)
  fs.writeFileSync(fakeNpm, [
    '#!/usr/bin/env node',
    "const crypto = require('node:crypto')",
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'const args = process.argv.slice(2)',
    "fs.appendFileSync(process.env.AAMP_FAKE_NPM_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n')",
    "if (args[0] === '--version') { console.log('10.0.0'); process.exit(0) }",
    "if (args[0] === 'whoami') { console.log('release-test'); process.exit(0) }",
    "const registry = args[args.indexOf('--registry') + 1] || 'https://registry.npmjs.org/'",
    "const state = JSON.parse(fs.readFileSync(process.env.AAMP_FAKE_NPM_REGISTRY, 'utf8'))",
    'const registryKey = `${registry}|${args[1]}`',
    "if (args[0] === 'view') {",
    "  const exact = /^(.*)@(\\d+\\.\\d+\\.\\d+(?:-dev\\.\\d+)?)$/.exec(args[1])",
    "  if (exact) {",
    "    const key = `${registry}|${exact[1]}|${exact[2]}`",
    "    const artifact = state[key]",
    "    if (artifact?.missingViews > 0) { artifact.missingViews -= 1; state[key] = artifact; fs.writeFileSync(process.env.AAMP_FAKE_NPM_REGISTRY, `${JSON.stringify(state, null, 2)}\n`); console.log('{}'); process.exit(0) }",
    "    console.log(JSON.stringify(artifact || {})); process.exit(0)",
    "  }",
    "  console.log(JSON.stringify(state[registryKey] || state[args[1]] || [])); process.exit(0)",
    "}",
    "if (args[0] === 'pack') {",
    "  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))",
    "  const destination = args[args.indexOf('--pack-destination') + 1]",
    "  fs.mkdirSync(destination, { recursive: true })",
    "  const archive = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`",
    "  fs.writeFileSync(path.join(destination, archive), `${pkg.name}@${pkg.version}\\n`)",
    '  console.log(archive)',
    '  process.exit(0)',
    '}',
    "if (args[0] === 'publish') {",
    "  const published = args.find((value, index) => index > 0 && !value.startsWith('-'))",
    "  if (!published || !published.endsWith('.tgz')) { console.error('publish requires packed tgz'); process.exit(2) }",
    "  const packedIdentity = fs.readFileSync(published, 'utf8').trim()",
    "  const at = packedIdentity.lastIndexOf('@')",
    "  if (at <= 0) { console.error('invalid packed tgz identity'); process.exit(2) }",
    "  const pkg = { name: packedIdentity.slice(0, at), version: packedIdentity.slice(at + 1) }",
    '  const key = `${registry}|${pkg.name}`',
    '  state[key] = [...new Set([...(state[key] || []), pkg.version])]',
    "  const bytes = fs.readFileSync(published)",
    "  state[`${registry}|${pkg.name}|${pkg.version}`] = { version: pkg.version, missingViews: Number(process.env.AAMP_FAKE_NPM_METADATA_DELAY || 0), dist: { shasum: crypto.createHash('sha1').update(bytes).digest('hex'), integrity: 'sha512-fake-integrity', tarball: `https://registry.test/${path.basename(published)}` } }",
    "  fs.writeFileSync(process.env.AAMP_FAKE_NPM_REGISTRY, `${JSON.stringify(state, null, 2)}\\n`)",
    '  process.exit(0)',
    '}',
    'process.exit(0)',
    '',
  ].join('\n'))
  fs.chmodSync(fakeNpm, 0o755)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return {
    fakeNpm,
    log,
    registryFile,
    env: {
      ...process.env,
      AAMP_FAKE_NPM_LOG: log,
      AAMP_FAKE_NPM_REGISTRY: registryFile,
    },
  }
}

function fakeNpmCalls(log) {
  if (!fs.existsSync(log)) return []
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function runRelease(repo, fakeNpm, env, args) {
  return spawnSync(process.execPath, [helperPath, '--pm', fakeNpm, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env,
  })
}

function snapshotFiles(files) {
  return new Map(files.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]))
}

function assertFilesMatchSnapshot(snapshot) {
  for (const [file, content] of snapshot) {
    if (content === null) {
      assert.equal(fs.existsSync(file), false, `${file} should remain absent`)
    } else {
      assert.deepEqual(fs.readFileSync(file), content, `${file} should be restored byte-for-byte`)
    }
  }
}

test('release helper keeps --agent only as a deprecated compatibility option', () => {
  const help = execFileSync(process.execPath, [helperPath, '--help'], { encoding: 'utf8' })
  const source = fs.readFileSync(helperPath, 'utf8')

  assert.match(help, /--agent NAME\s+Deprecated compatibility option; printed startup commands omit --agent/)
  assert.doesNotMatch(help, /Default: coco/)
  assert.doesNotMatch(source, /bash -s -- install --agent/)
})

test('local tgz startup command explicitly opts in to package overrides', () => {
  const source = fs.readFileSync(helperPath, 'utf8')
  assert.match(source, /AAMP_TASK_ALLOW_PACKAGE_OVERRIDES=true/)
})

test('release skill documents interactive agent selection without a startup flag', () => {
  const skill = fs.readFileSync(skillPath, 'utf8')

  assert.match(skill, /one-click startup commands omit `--agent`/i)
  assert.match(skill, /interactive multi-select/i)
  assert.doesNotMatch(skill, /defaults?\s+generated startup commands to `--agent coco`/i)
})

test('release helper rejects the removed trae agent type', () => {
  const result = spawnSync(process.execPath, [helperPath, '--agent', 'trae', '--help'], {
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--agent must be one of: codex, cursor, coco, traex, traecli, workbuddy/)
})

test('trial --prepare-source bumps stable packages to the next patch dev.1 and only writes source metadata', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  fs.writeFileSync(path.join(repo, 'existing-user-change.txt'), 'preserve me\n')

  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      '--mode', 'trial',
      '--prepare-source',
      '--bump', 'patch',
      '--pm', fakeNpm,
      '--scope', '@release-test',
      '--package', 'acpBridge',
    ],
    { cwd: repo, encoding: 'utf8', env },
  )

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /selected packages: acpBridge, taskAgent/)
  assert.match(result.stdout, /@canonical\/aamp-acp-bridge@1\.2\.3 -> @release-test\/aamp-acp-bridge@1\.2\.4-dev\.1/)
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).version, '1.2.4-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package-lock.json')).version, '1.2.4-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package-lock.json')).packages[''].version, '1.2.4-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '2.4.7-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package-lock.json')).packages[''].version, '2.4.7-dev.1')
  const bootstrap = fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8')
  assert.match(bootstrap, /AAMP_TASK_AGENT_VERSION="2\.4\.7-dev\.1"/)
  assert.match(bootstrap, /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@canonical\/aamp-acp-bridge@1\.2\.4-dev\.1\}"/)
  assert.equal(fs.readFileSync(path.join(repo, 'existing-user-change.txt'), 'utf8'), 'preserve me\n')
  const calls = fakeNpmCalls(log)
  assert.equal(calls.some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)
  assert.equal(calls.some(({ args }) => args.includes('https://bnpm.byted.org')), false)
})

test('trial --prepare-source advances dev versions above the source and same-base registry maximum', (t) => {
  const repo = createReleaseRepo(t, {
    acpBridge: '1.2.3-dev.7',
    taskAgent: '2.4.6-dev.4',
  })
  const { fakeNpm, env } = createStatefulFakeNpm(t, {
    'https://registry.npmjs.org/|@release-test/aamp-acp-bridge': [
      '1.2.3-dev.12',
      '1.2.4-dev.999',
      '1.2.3-dev.5',
      '1.2.3-beta.100',
    ],
    'https://registry.npmjs.org/|@release-test/aamp-feishu-task-agent': [
      '2.4.6-dev.2',
      '2.4.6-dev.9',
    ],
  })

  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).version, '1.2.3-dev.13')
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package-lock.json')).packages[''].version, '1.2.3-dev.13')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '2.4.6-dev.10')
  assert.match(
    fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8'),
    /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@canonical\/aamp-acp-bridge@1\.2\.3-dev\.13\}"/,
  )
})

test('ordinary trial plan and pack reuse prepared source versions and only rename packages in staging', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const prepare = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])
  assert.equal(prepare.status, 0, prepare.stderr)
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'prepare source'], { cwd: repo })

  const plan = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--plan-only',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])
  assert.equal(plan.status, 0, plan.stderr)
  assert.match(plan.stdout, /@canonical\/aamp-acp-bridge@1\.2\.4-dev\.1 -> @release-test\/aamp-acp-bridge@1\.2\.4-dev\.1/)
  assert.match(plan.stdout, /@larktask\/aamp-feishu-task-agent@2\.4\.7-dev\.1 -> @release-test\/aamp-feishu-task-agent@2\.4\.7-dev\.1/)

  const packed = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--pack',
    '--skip-build',
    '--out-dir', '.release-output',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])
  assert.equal(packed.status, 0, packed.stderr)
  const stageName = fs.readdirSync(path.join(repo, '.release-output')).find((name) => name.startsWith('stage-trial-release-test-'))
  assert.ok(stageName)
  const stageRoot = path.join(repo, '.release-output', stageName)
  const stagedAcp = readJson(path.join(stageRoot, 'aamp-acp-bridge/package.json'))
  const stagedTask = readJson(path.join(stageRoot, 'aamp-feishu-task-agent/package.json'))
  assert.deepEqual({ name: stagedAcp.name, version: stagedAcp.version }, {
    name: '@release-test/aamp-acp-bridge',
    version: '1.2.4-dev.1',
  })
  assert.deepEqual({ name: stagedTask.name, version: stagedTask.version }, {
    name: '@release-test/aamp-feishu-task-agent',
    version: '2.4.7-dev.1',
  })
  const stagedBootstrap = fs.readFileSync(path.join(stageRoot, 'aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8')
  assert.match(stagedBootstrap, /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@release-test\/aamp-acp-bridge@1\.2\.4-dev\.1\}"/)
  assert.match(stagedBootstrap, /FEISHU_BRIDGE_PKG="\$\{FEISHU_BRIDGE_PKG:-@canonical\/aamp-feishu-bridge@3\.4\.5\}"/)
  assert.match(stagedBootstrap, /AIME_ACP_PKG="\$\{AIME_ACP_PKG:-@tengchengwei\/aime-acp@0\.1\.0-dev\.3\}"/)
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).name, '@canonical/aamp-acp-bridge')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).name, '@larktask/aamp-feishu-task-agent')
  const packCalls = fakeNpmCalls(log).filter(({ args }) => args[0] === 'pack')
  assert.equal(packCalls.length, 2)
  assert.equal(fakeNpmCalls(log).some(({ args }) => args[0] === 'publish'), false)
})

test('ordinary pack rejects a prepared package lock that drifted after source preparation', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const prepare = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])
  assert.equal(prepare.status, 0, prepare.stderr)
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'prepare source'], { cwd: repo })

  const lockFile = path.join(repo, 'packages/aamp-acp-bridge/package-lock.json')
  const lock = readJson(lockFile)
  lock.packages[''].version = '9.9.9-dev.9'
  writeJson(lockFile, lock)

  const packed = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--scope', '@release-test',
    '--package', 'acpBridge',
    '--pack',
    '--skip-build',
  ])

  assert.equal(packed.status, 1)
  assert.match(packed.stderr, /Package lock validation failed/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['pack', 'publish'].includes(args[0])), false)
})

test('ordinary pack rejects canonical Task Agent pins that drifted after source preparation', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const prepare = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'acpBridge',
  ])
  assert.equal(prepare.status, 0, prepare.stderr)
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'prepare source'], { cwd: repo })

  const controllerFile = path.join(repo, 'packages/aamp-feishu-task-agent/bin/feishu-task-agent-controller.mjs')
  fs.writeFileSync(
    controllerFile,
    fs.readFileSync(controllerFile, 'utf8').replace(
      '@canonical/aamp-acp-bridge@1.2.4-dev.1',
      '@canonical/aamp-acp-bridge@1.2.4-dev.999',
    ),
  )

  const packed = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--scope', '@release-test',
    '--package', 'acpBridge',
    '--pack',
    '--skip-build',
  ])

  assert.equal(packed.status, 1)
  assert.match(packed.stderr, /ACP bridge canonical pin validation failed/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['pack', 'publish'].includes(args[0])), false)
})

test('ordinary trial publish rejects a stable source as unprepared before TTY, build, pack, or publish', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)

  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--scope', '@release-test',
    '--package', 'acpBridge',
    '--publish',
    '--confirm-publish',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /trial release requires a prepared source version.*--prepare-source/i)
  assert.doesNotMatch(result.stderr, /requires a TTY/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)
})

test('ordinary trial rejects an exact source version already present in the target registry', (t) => {
  const repo = createReleaseRepo(t, {
    acpBridge: '1.2.4-dev.1',
    taskAgent: '2.4.7-dev.1',
  })
  const { fakeNpm, log, env } = createStatefulFakeNpm(t, {
    'https://registry.npmjs.org/|@release-test/aamp-acp-bridge': ['1.2.4-dev.1'],
  })

  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--scope', '@release-test',
    '--package', 'acpBridge',
    '--pack',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Source version 1\.2\.4-dev\.1 already exists.*--prepare-source/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)
})

test('publish uses the exact packed tgz artifact instead of repacking the staging directory', (t) => {
  if (process.platform === 'win32') {
    t.skip('PTY-backed publish assertion requires POSIX script(1)')
    return
  }
  const repo = createReleaseRepo(t, { taskAgent: '2.4.7-dev.1' })
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  writeJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json'), {
    name: '@larktask/aamp-feishu-task-agent',
    version: '2.4.7-dev.1',
  })
  writeJson(path.join(repo, 'packages/aamp-feishu-task-agent/package-lock.json'), {
    name: '@larktask/aamp-feishu-task-agent',
    version: '2.4.7-dev.1',
    lockfileVersion: 3,
    packages: { '': { name: '@larktask/aamp-feishu-task-agent', version: '2.4.7-dev.1' } },
  })
  fs.writeFileSync(
    path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'),
    fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8')
      .replace('AAMP_TASK_AGENT_VERSION="2.4.6"', 'AAMP_TASK_AGENT_VERSION="2.4.7-dev.1"'),
  )
  const expectScript = path.join(path.dirname(fakeNpm), 'publish.exp')
  fs.writeFileSync(expectScript, [
    'set timeout 30',
    `spawn ${[process.execPath, helperPath, '--pm', fakeNpm, '--mode', 'trial', '--package', 'taskAgent', '--publish', '--confirm-publish', '--skip-build', '--out-dir', '.publish-output'].map((value) => `{${value}}`).join(' ')}`,
    'expect eof',
    'catch wait result',
    'exit [lindex $result 3]',
    '',
  ].join('\n'))
  const result = spawnSync('/usr/bin/expect', [expectScript], { cwd: repo, encoding: 'utf8', env })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const publishCall = fakeNpmCalls(log).find(({ args }) => args[0] === 'publish')
  assert.ok(publishCall)
  assert.match(publishCall.args[1], /release-test-aamp-feishu-task-agent-2\.4\.7-dev\.1\.tgz$/)
  assert.equal(publishCall.args[1].includes('stage-trial'), false)

  const verified = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--package', 'taskAgent',
    '--verify-published',
    '--skip-build',
    '--out-dir', '.verify-output',
  ])
  assert.equal(verified.status, 0, verified.stderr)
  assert.match(verified.stdout, /visible, packed shasum verified/)
  assert.equal(fakeNpmCalls(log).filter(({ args }) => args[0] === 'publish').length, 1)

  const resumeScript = path.join(path.dirname(fakeNpm), 'resume.exp')
  fs.writeFileSync(resumeScript, [
    'set timeout 30',
    `spawn ${[process.execPath, helperPath, '--pm', fakeNpm, '--mode', 'trial', '--package', 'taskAgent', '--resume-publish', '--confirm-publish', '--skip-build', '--out-dir', '.resume-output'].map((value) => `{${value}}`).join(' ')}`,
    'expect eof',
    'catch wait result',
    'exit [lindex $result 3]',
    '',
  ].join('\n'))
  const resumed = spawnSync('/usr/bin/expect', [resumeScript], { cwd: repo, encoding: 'utf8', env })
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`)
  assert.match(resumed.stdout, /resume verify: @release-test\/aamp-feishu-task-agent@2\.4\.7-dev\.1/)
  assert.equal(fakeNpmCalls(log).filter(({ args }) => args[0] === 'publish').length, 1)
})

test('publish retries temporarily incomplete registry artifact metadata', (t) => {
  if (process.platform === 'win32') {
    t.skip('PTY-backed publish assertion requires POSIX expect(1)')
    return
  }
  const repo = createReleaseRepo(t, { taskAgent: '2.4.7-dev.1' })
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const expectScript = path.join(path.dirname(fakeNpm), 'publish-delay.exp')
  fs.writeFileSync(expectScript, [
    'set timeout 30',
    `spawn ${[process.execPath, helperPath, '--pm', fakeNpm, '--mode', 'trial', '--package', 'taskAgent', '--publish', '--confirm-publish', '--skip-build', '--out-dir', '.publish-delay-output'].map((value) => `{${value}}`).join(' ')}`,
    'expect eof',
    'catch wait result',
    'exit [lindex $result 3]',
    '',
  ].join('\n'))

  const result = spawnSync('/usr/bin/expect', [expectScript], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...env, AAMP_FAKE_NPM_METADATA_DELAY: '1' },
  })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const exactViews = fakeNpmCalls(log).filter(({ args }) =>
    args[0] === 'view' && args[1] === '@release-test/aamp-feishu-task-agent@2.4.7-dev.1')
  assert.equal(exactViews.length, 2)
})

test('resume publish needs no TTY when every public target is already published', (t) => {
  const repo = createReleaseRepo(t, { taskAgent: '2.4.7-dev.1' })
  const taskName = '@release-test/aamp-feishu-task-agent'
  const { fakeNpm, log, env } = createStatefulFakeNpm(t, {
    [`https://registry.npmjs.org/|${taskName}`]: ['2.4.7-dev.1'],
  })
  const artifact = path.join(path.dirname(fakeNpm), 'task-agent.tgz')
  fs.writeFileSync(artifact, `${taskName}@2.4.7-dev.1\n`)
  const bytes = fs.readFileSync(artifact)
  const registryState = readJson(path.join(path.dirname(fakeNpm), 'registry.json'))
  registryState[`https://registry.npmjs.org/|${taskName}|2.4.7-dev.1`] = {
    version: '2.4.7-dev.1',
    dist: {
      shasum: createHash('sha1').update(bytes).digest('hex'),
      integrity: 'sha512-fake-integrity',
      tarball: 'https://registry.test/task-agent.tgz',
    },
  }
  writeJson(path.join(path.dirname(fakeNpm), 'registry.json'), registryState)

  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--package', 'taskAgent',
    '--resume-publish', '--confirm-publish',
    '--skip-build',
    '--out-dir', '.resume-no-tty',
  ])

  assert.doesNotMatch(result.stderr, /requires a TTY/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => args[0] === 'publish'), false)
})

test('final --prepare-source requires explicit stable versions for every actual release package before writing', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const acpBefore = fs.readFileSync(path.join(repo, 'packages/aamp-acp-bridge/package.json'), 'utf8')
  const taskBefore = fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/package.json'), 'utf8')

  const missing = runRelease(repo, fakeNpm, env, [
    '--mode', 'final',
    '--prepare-source',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--version', 'acpBridge=2.0.0',
  ])

  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /requires --version taskAgent=x\.y\.z/)
  assert.equal(fs.readFileSync(path.join(repo, 'packages/aamp-acp-bridge/package.json'), 'utf8'), acpBefore)
  assert.equal(fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/package.json'), 'utf8'), taskBefore)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)

  const invalid = runRelease(repo, fakeNpm, env, [
    '--mode', 'final',
    '--prepare-source',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--version', 'acpBridge=2.0.0-rc.1',
    '--version', 'taskAgent=3.0.0',
  ])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /must be stable x\.y\.z/)
  assert.equal(fs.readFileSync(path.join(repo, 'packages/aamp-acp-bridge/package.json'), 'utf8'), acpBefore)
})

test('final --prepare-source writes explicit stable versions and ordinary final pack reuses them exactly', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, env } = createStatefulFakeNpm(t)

  const prepare = runRelease(repo, fakeNpm, env, [
    '--mode', 'final',
    '--prepare-source',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--version', 'acpBridge=2.0.0',
    '--version', 'taskAgent=3.0.0',
  ])
  assert.equal(prepare.status, 0, prepare.stderr)
  assert.match(prepare.stdout, /dist-tag: latest/)
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).version, '2.0.0')
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package-lock.json')).packages[''].version, '2.0.0')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '3.0.0')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package-lock.json')).version, '3.0.0')
  const sourceBootstrap = fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8')
  assert.match(sourceBootstrap, /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@canonical\/aamp-acp-bridge@2\.0\.0\}"/)
  assert.match(sourceBootstrap, /AAMP_TASK_AGENT_VERSION="3\.0\.0"/)
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'prepare final source'], { cwd: repo })

  const packed = runRelease(repo, fakeNpm, env, [
    '--mode', 'final',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--pack',
    '--skip-build',
    '--out-dir', '.final-output',
  ])
  assert.equal(packed.status, 0, packed.stderr)
  assert.match(packed.stdout, /@canonical\/aamp-acp-bridge@2\.0\.0 -> @larktask\/aamp-acp-bridge@2\.0\.0/)
  assert.match(packed.stdout, /@larktask\/aamp-feishu-task-agent@3\.0\.0 -> @larktask\/aamp-feishu-task-agent@3\.0\.0/)
})

test('ordinary final rejects prerelease sources and stable versions already in the registry', (t) => {
  const prereleaseRepo = createReleaseRepo(t, { acpBridge: '2.0.0-dev.3', taskAgent: '3.0.0-dev.4' })
  const firstNpm = createStatefulFakeNpm(t)
  const prerelease = runRelease(prereleaseRepo, firstNpm.fakeNpm, firstNpm.env, [
    '--mode', 'final',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--plan-only',
  ])
  assert.equal(prerelease.status, 1)
  assert.match(prerelease.stderr, /requires a stable source version/)

  const stableRepo = createReleaseRepo(t, { acpBridge: '2.0.0', taskAgent: '3.0.0' })
  const secondNpm = createStatefulFakeNpm(t, {
    'https://registry.npmjs.org/|@larktask/aamp-acp-bridge': ['2.0.0'],
  })
  const existing = runRelease(stableRepo, secondNpm.fakeNpm, secondNpm.env, [
    '--mode', 'final',
    '--scope', '@larktask',
    '--package', 'acpBridge',
    '--pack',
  ])
  assert.equal(existing.status, 1)
  assert.match(existing.stderr, /Final version 2\.0\.0 already exists.*--prepare-source/)
  assert.equal(fakeNpmCalls(secondNpm.log).some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)
})

test('release helper prepares AIME, ACP bridge, and Task Agent source versions and canonical pins', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t, {
    'https://bnpm.byted.org|@tengchengwei/aime-acp': ['0.1.0-dev.9'],
  })
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--aime-scope', '@tengchengwei',
    '--package', 'aimeAcp',
    '--package', 'acpBridge',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /selected packages: aimeAcp, acpBridge, taskAgent/)
  assert.match(result.stdout, /@tengchengwei\/aime-acp@0\.1\.0 -> @tengchengwei\/aime-acp@0\.1\.1-dev\.1/)
  assert.match(result.stdout, /@canonical\/aamp-acp-bridge@1\.2\.3 -> @release-test\/aamp-acp-bridge@1\.2\.4-dev\.1/)
  assert.equal(readJson(path.join(repo, 'packages/aime-acp/package.json')).version, '0.1.1-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aime-acp/package-lock.json')).packages[''].version, '0.1.1-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).version, '1.2.4-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '2.4.7-dev.1')
  const bootstrap = fs.readFileSync(path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh'), 'utf8')
  assert.equal(bootstrap.match(/@tengchengwei\/aime-acp@0\.1\.1-dev\.1/g)?.length, 2)
  assert.match(bootstrap, /ACP_BRIDGE_PKG="\$\{ACP_BRIDGE_PKG:-@canonical\/aamp-acp-bridge@1\.2\.4-dev\.1\}"/)
  assert.match(bootstrap, /FEISHU_BRIDGE_PKG="\$\{FEISHU_BRIDGE_PKG:-@canonical\/aamp-feishu-bridge@3\.4\.5\}"/)
  assert.match(bootstrap, /AAMP_TASK_AGENT_VERSION="2\.4\.7-dev\.1"/)
  assert.equal(readJson(path.join(repo, 'packages/aime-acp/package.json')).name, '@tengchengwei/aime-acp')
  assert.match(fakeNpmCalls(log).find(({ args }) => args[0] === 'view' && args[1] === '@tengchengwei/aime-acp').args.join(' '), /bnpm\.byted\.org/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['run', 'pack', 'publish'].includes(args[0])), false)
})

test('release helper rejects non-canonical AIME scopes instead of targeting another owner', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--aime-scope', '@another-owner',
    '--package', 'aimeAcp',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--aime-scope is fixed to @tengchengwei/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['view', 'run', 'pack', 'publish'].includes(args[0])), false)
  assert.equal(readJson(path.join(repo, 'packages/aime-acp/package.json')).version, '0.1.0')
})

test('release helper rejects routing AIME to the public npm registry', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--aime-registry', 'https://registry.npmjs.org/',
    '--package', 'aimeAcp',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /AIME registry is fixed to https:\/\/bnpm\.byted\.org/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['whoami', 'view', 'pack', 'publish'].includes(args[0])), false)
})

test('release helper rejects routing public AAMP packages to BNPM', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--registry', 'https://bnpm.byted.org',
    '--package', 'acpBridge',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /public AAMP registry is fixed to https:\/\/registry\.npmjs\.org/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['whoami', 'view', 'pack', 'publish'].includes(args[0])), false)
})

test('release helper fixes trial packages to the authenticated personal scope', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t, {
    'https://registry.npmjs.org/|@release-test/aamp-acp-bridge': ['9.9.9-dev.999'],
  })
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--package', 'acpBridge',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /target scope: @release-test/)
  assert.match(result.stdout, /@release-test\/aamp-acp-bridge@1\.2\.4-dev\.1/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => args.includes('@someone-else/aamp-acp-bridge')), false)
})

test('release helper fixes stable public packages to the canonical larktask scope', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t)
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'final',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'taskAgent',
    '--version', 'taskAgent=3.0.0',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Final scope is fixed to @larktask/)
  assert.equal(fakeNpmCalls(log).some(({ args }) => ['view', 'pack', 'publish'].includes(args[0])), false)
})

test('release helper keeps non-AIME planning independent from the AIME registry', (t) => {
  const { fakeNpm, log } = createRegistryAwareFakeNpm(t)
  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      '--mode', 'trial',
      '--pm', fakeNpm,
      '--scope', '@luckyterry',
      '--package', 'acpBridge',
      '--plan-only',
    ],
    { encoding: 'utf8', env: { ...process.env, AAMP_FAKE_NPM_LOG: log } },
  )

  assert.equal(result.status, 0, result.stderr)
  const calls = fs.readFileSync(log, 'utf8')
  assert.doesNotMatch(calls, /view @tengchengwei\/aime-acp .*bnpm\.byted\.org/)
  assert.match(result.stdout, /selected packages: acpBridge, taskAgent/)
})

test('Task Agent-only prepare stays isolated from BNPM and preserves the AIME source pin', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, log, env } = createStatefulFakeNpm(t, {
    'https://bnpm.byted.org|@tengchengwei/aime-acp': ['0.1.0-dev.99'],
  })
  const bootstrapFile = path.join(repo, 'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh')
  const aimePinsBefore = fs.readFileSync(bootstrapFile, 'utf8').match(/@tengchengwei\/aime-acp@[0-9A-Za-z.-]+/g)
  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'taskAgent',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /selected packages: taskAgent/)
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '2.4.7-dev.1')
  assert.deepEqual(
    fs.readFileSync(bootstrapFile, 'utf8').match(/@tengchengwei\/aime-acp@[0-9A-Za-z.-]+/g),
    aimePinsBefore,
  )
  assert.equal(fakeNpmCalls(log).some(({ args }) => args.includes('https://bnpm.byted.org')), false)
})

test('a second --prepare-source fails before writes when an actual release version differs from HEAD', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, env } = createStatefulFakeNpm(t)
  const args = ['--mode', 'trial', '--prepare-source', '--scope', '@release-test', '--package', 'acpBridge']
  const first = runRelease(repo, fakeNpm, env, args)
  assert.equal(first.status, 0, first.stderr)
  const firstDiff = execFileSync('git', ['diff', '--binary'], { cwd: repo })

  const second = runRelease(repo, fakeNpm, env, args)

  assert.equal(second.status, 1)
  assert.match(second.stderr, /already prepared.*commit/i)
  assert.deepEqual(execFileSync('git', ['diff', '--binary'], { cwd: repo }), firstDiff)
  assert.equal(readJson(path.join(repo, 'packages/aamp-acp-bridge/package.json')).version, '1.2.4-dev.1')
  assert.equal(readJson(path.join(repo, 'packages/aamp-feishu-task-agent/package.json')).version, '2.4.7-dev.1')
})

test('failed strict pin validation rolls back every prepare-source file byte-for-byte', (t) => {
  const repo = createReleaseRepo(t)
  const { fakeNpm, env } = createStatefulFakeNpm(t)
  const taskDir = path.join(repo, 'packages/aamp-feishu-task-agent')
  const bootstrapFile = path.join(taskDir, 'bootstrap/aamp-feishu-task-agent-bootstrap.sh')
  fs.writeFileSync(
    bootstrapFile,
    fs.readFileSync(bootstrapFile, 'utf8').replace(
      /aime_fallback\(\).*\n/,
      "aime_fallback() { printf '%s\\n' \"missing canonical AIME fallback\"; }\n",
    ),
  )
  const files = [
    'packages/aime-acp/package.json',
    'packages/aime-acp/package-lock.json',
    'packages/aamp-acp-bridge/package.json',
    'packages/aamp-acp-bridge/package-lock.json',
    'packages/aamp-feishu-task-agent/package.json',
    'packages/aamp-feishu-task-agent/package-lock.json',
    'packages/aamp-feishu-task-agent/bootstrap/aamp-feishu-task-agent-bootstrap.sh',
    'packages/aamp-feishu-task-agent/bin/feishu-task-agent-controller.mjs',
    'packages/aamp-feishu-task-agent/README.md',
  ].map((file) => path.join(repo, file))
  const before = snapshotFiles(files)

  const result = runRelease(repo, fakeNpm, env, [
    '--mode', 'trial',
    '--prepare-source',
    '--scope', '@release-test',
    '--package', 'aimeAcp',
    '--package', 'acpBridge',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /AIME ACP canonical pin validation failed.*expected 2/i)
  assertFilesMatchSnapshot(before)
})

test('release wizard omits agent prompts and flags from local and remote one-click commands', (t) => {
  const repo = createReleaseRepo(t, {
    aimeAcp: '0.1.1-dev.1',
    acpBridge: '1.2.4-dev.1',
    feishuBridge: '3.4.6-dev.1',
    taskAgent: '2.4.7-dev.1',
  })
  const fakeNpm = createFakeNpm(t)

  for (const choice of ['1', '2']) {
    const result = spawnSync(
      process.execPath,
      [helperPath, '--wizard', '--pm', fakeNpm, '--agent', 'cursor'],
      { cwd: repo, encoding: 'utf8', input: `${choice}\nall\n` },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /启动命令使用哪个 agent/)
    if (choice === '2') assert.match(result.stdout, /bash -s -- install(?:\n|$)/)
    assert.doesNotMatch(result.stdout, /tar -xZO package\/bootstrap\/aamp-feishu-task-agent-bootstrap\.sh/)
    if (choice === '2') assert.match(result.stdout, /tar -xOzf - package\/bootstrap\/aamp-feishu-task-agent-bootstrap\.sh/)
    assert.doesNotMatch(result.stdout, /--agent(?:\s|$)/)
  }
})

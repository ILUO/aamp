#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(scriptDir, '..', '..', '..', '..')
const DEFAULT_OUT_DIR = '.aamp-local-release'
let localReleaseCacheDir

function tempCacheDir() {
  if (!localReleaseCacheDir) {
    localReleaseCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aamp-local-release-npm-cache-'))
  }
  return localReleaseCacheDir
}

const PACKAGE_SPECS = [
  {
    key: 'acpBridge',
    dir: 'packages/aamp-acp-bridge',
    unscopedName: 'aamp-acp-bridge',
    build: true,
    bin: 'aamp-acp-bridge',
    envName: 'ACP_BRIDGE_PKG',
  },
  {
    key: 'feishuBridge',
    dir: 'packages/aamp-feishu-bridge',
    unscopedName: 'aamp-feishu-bridge',
    build: true,
    bin: 'aamp-feishu-bridge',
    envName: 'FEISHU_BRIDGE_PKG',
  },
  {
    key: 'taskAgent',
    dir: 'packages/aamp-feishu-task-agent',
    unscopedName: 'aamp-feishu-task-agent',
    build: false,
    bin: 'feishu-task-agent',
    envName: '',
  },
]

const PACKAGE_KEY_ALIASES = new Map([
  ['all', 'all'],
  ['acp', 'acpBridge'],
  ['acpbridge', 'acpBridge'],
  ['acp-bridge', 'acpBridge'],
  ['aamp-acp-bridge', 'acpBridge'],
  ['feishu', 'feishuBridge'],
  ['feishubridge', 'feishuBridge'],
  ['feishu-bridge', 'feishuBridge'],
  ['aamp-feishu-bridge', 'feishuBridge'],
  ['task', 'taskAgent'],
  ['taskagent', 'taskAgent'],
  ['task-agent', 'taskAgent'],
  ['feishu-task-agent', 'taskAgent'],
  ['aamp-feishu-task-agent', 'taskAgent'],
])

function normalizePackageSelection(value) {
  if (!value) return ''
  const compact = value.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9-]/g, '').toLowerCase()
  const key = PACKAGE_KEY_ALIASES.get(compact)
  if (!key) throw new Error(`Unknown package key: ${value}. Use acpBridge, feishuBridge, taskAgent, or all.`)
  return key
}

function selectedPackageSpecs(keys) {
  return PACKAGE_SPECS.filter((spec) => keys.has(spec.key))
}

function allPackageKeys() {
  return PACKAGE_SPECS.map((spec) => spec.key)
}

function usage() {
  return `Usage:
  node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs [options]

Build AAMP packages locally, optionally pack tgz artifacts, and print the
startup command for testing the local build WITHOUT publishing.

Options:
  --package KEY          Package to build. Repeatable or comma-separated.
                         Keys: acpBridge, feishuBridge, taskAgent, all. Default: all
  --build / --skip-build Build dist before printing. Default: build
  --pack                 Also create local tgz artifacts under --out-dir
  --out-dir DIR          tgz output directory. Default: .aamp-local-release (repo root)
  --mode file|tgz        Startup command flavor. file uses file:<dir> overrides
                         (recommended: npm symlinks the live dist folder); tgz
                         uses packed tgz paths and implies --pack. Default: file
  --verify               Sanity-check that npm exec resolves each bridge bin
                         (downloads public dependencies; slower). Default: off
  --plan-only            Print plan and startup command without building or packing
  --json                 Print a JSON summary to stdout (no human sections)
  --help                 Show this help

Local testing only. This script never publishes and never touches the remote
npm registry with our packages; npm may still fetch public dependencies of the
selected packages when resolving them.
`
}

function parseArgs(argv) {
  const options = {
    packages: new Set(),
    build: true,
    pack: false,
    outDir: DEFAULT_OUT_DIR,
    mode: 'file',
    verify: false,
    planOnly: false,
    json: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`)
      return argv[i]
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--package' || arg === '--packages') {
      for (const value of next().split(',')) {
        if (value.trim()) options.packages.add(normalizePackageSelection(value.trim()))
      }
    } else if (arg === '--build') {
      options.build = true
    } else if (arg === '--skip-build') {
      options.build = false
    } else if (arg === '--pack') {
      options.pack = true
    } else if (arg === '--out-dir') {
      options.outDir = next()
    } else if (arg === '--mode') {
      options.mode = next()
    } else if (arg === '--verify') {
      options.verify = true
    } else if (arg === '--plan-only') {
      options.planOnly = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (options.mode !== 'file' && options.mode !== 'tgz') {
    throw new Error('--mode must be file or tgz')
  }
  if (options.mode === 'tgz') options.pack = true
  if (options.packages.size === 0 || options.packages.has('all')) {
    options.packages = new Set(allPackageKeys())
  }
  return options
}

function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function packageInfo(spec) {
  const pkgPath = path.join(REPO_ROOT, spec.dir, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read package manifest at ${pkgPath}: ${error.message}`)
  }
  const name = String(manifest.name || spec.unscopedName)
  const version = String(manifest.version || '')
  const binValue = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[spec.bin]
  const binPath = typeof binValue === 'string' ? path.resolve(REPO_ROOT, spec.dir, binValue) : ''
  return { name, version, binPath }
}

function packFileName(info) {
  return `${info.name.replace(/^@/, '').replace('/', '-')}-${info.version}.tgz`
}

function npmEnv() {
  return { ...process.env, npm_config_cache: tempCacheDir() }
}

function runBuild(spec, info) {
  const pkgDir = path.join(REPO_ROOT, spec.dir)
  fs.mkdirSync(tempCacheDir(), { recursive: true })
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: pkgDir,
    env: npmEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n')
    throw new Error(`npm run build failed for ${spec.key} (${spec.dir}):\n${detail}`)
  }
}

function verifyBin(spec, info) {
  if (!info.binPath || !fs.existsSync(info.binPath)) {
    throw new Error(
      `${spec.key} (${spec.dir}) binary target missing: ${info.binPath || '(no bin entry)'}. `
      + 'Build the package first or pass --skip-build only after a successful build.',
    )
  }
  if (process.platform !== 'win32' && (fs.statSync(info.binPath).mode & 0o111) === 0) {
    throw new Error(
      `${spec.key} (${spec.dir}) binary target is not executable: ${info.binPath}. `
      + 'Run "npm run prepare-bin" or rebuild the package.',
    )
  }
  return info.binPath
}

function runPack(spec, info, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(tempCacheDir(), { recursive: true })
  const pkgDir = path.join(REPO_ROOT, spec.dir)
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', outDir], {
    cwd: pkgDir,
    env: npmEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n')
    throw new Error(`npm pack failed for ${spec.key} (${spec.dir}):\n${detail}`)
  }
  const tgzPath = path.join(outDir, packFileName(info))
  if (!fs.existsSync(tgzPath)) {
    throw new Error(`npm pack completed but expected artifact is missing: ${tgzPath}`)
  }
  return tgzPath
}

function verifyResolvable(spec, info, options) {
  const pkgSpec = options.mode === 'tgz'
    ? path.join(path.resolve(REPO_ROOT, options.outDir), packFileName(info))
    : `file:${path.join(REPO_ROOT, spec.dir)}`
  fs.mkdirSync(tempCacheDir(), { recursive: true })
  const result = spawnSync(
    'npm',
    ['exec', '--yes', '--cache', tempCacheDir(), '--package', pkgSpec, '--', spec.bin, '--help'],
    { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
  )
  return result.status === 0
}

function expectedTgzPath(spec, options) {
  return path.resolve(REPO_ROOT, options.outDir, packFileName(packageInfo(spec)))
}

function buildStartupCommand(selectedSpecs, options, state) {
  const lines = [
    `cd ${shellQuote(REPO_ROOT)}`,
    'export NPM_CONFIG_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/aamp-local-runtime-npm-cache.XXXXXX")"',
  ]
  for (const spec of selectedSpecs) {
    if (!spec.envName) continue
    if (options.mode === 'tgz') {
      const tgzPath = state.tgzPaths[spec.key] || expectedTgzPath(spec, options)
      lines.push(`export ${spec.envName}=${shellQuote(tgzPath)}`)
    } else {
      lines.push(`export ${spec.envName}="file:$PWD/${spec.dir}"`)
    }
  }
  lines.push('feishu-task-agent start')
  lines.push('# fallback when ~/.aamp/bin is not on PATH:')
  lines.push('"$HOME/.aamp/bin/feishu-task-agent" start')
  return lines.join('\n')
}

function buildNotes(selectedSpecs, options, state) {
  const notes = []
  notes.push('Stop the currently running task-agent first (Ctrl+C in its terminal), then run the startup command.')
  if (options.mode === 'file') {
    notes.push('file:<dir> overrides make npm symlink the live package folder; after editing source, rebuild with npm run build and restart. No repack needed.')
  } else {
    notes.push('tgz mode uses packed artifacts; after editing source, rebuild and re-run with --pack, then restart.')
  }
  notes.push('npm may fetch public dependencies of the selected packages from the registry when resolving them; this skill never publishes our packages.')
  notes.push('Verify locally: send the agent a task that exercises the changed path and confirm the Feishu comment shows the real text.')
  const withTaskAgent = selectedSpecs.some((spec) => spec.key === 'taskAgent')
  if (withTaskAgent) {
    notes.push('The task-agent shim has no env override for itself. To test a local task-agent build, install it into the global prefix: npm install -g --prefix "$HOME/.aamp/npm-global" --force <taskAgent tgz> and set AAMP_TASK_AUTO_UPDATE=false.')
  }
  return notes
}

function run(options) {
  const selectedSpecs = selectedPackageSpecs(options.packages)
  const state = {
    packages: [],
    tgzPaths: {},
    verified: {},
    startupCommand: '',
    notes: [],
    plan: options.planOnly,
  }

  for (const spec of selectedSpecs) {
    const info = packageInfo(spec)
    const entry = {
      key: spec.key,
      dir: spec.dir,
      version: info.version,
      bin: info.binPath,
      binExists: Boolean(info.binPath) && fs.existsSync(info.binPath),
    }
    if (!options.planOnly) {
      if (options.build && spec.build) {
        runBuild(spec, info)
        entry.built = true
      }
      verifyBin(spec, info)
      if (options.pack) {
        const tgzPath = runPack(spec, info, path.resolve(REPO_ROOT, options.outDir))
        entry.tgz = tgzPath
        state.tgzPaths[spec.key] = tgzPath
      }
      if (options.verify && spec.envName) {
        state.verified[spec.key] = verifyResolvable(spec, info, options)
        entry.verified = state.verified[spec.key]
      }
    }
    state.packages.push(entry)
  }

  state.startupCommand = buildStartupCommand(selectedSpecs, options, state)
  state.notes = buildNotes(selectedSpecs, options, state)
  return state
}

function printHuman(options, state) {
  console.log('aamp-local-release plan:')
  console.log(`- repo root: ${REPO_ROOT}`)
  console.log(`- mode: ${options.mode}${options.planOnly ? ' (plan only)' : ''}${options.pack ? ' (pack)' : ''}${options.verify ? ' (verify)' : ''}`)
  console.log('- packages:')
  for (const entry of state.packages) {
    const built = entry.built === true ? 'built' : (entry.binExists ? 'bin ok' : 'bin MISSING')
    const tgz = entry.tgz ? ` tgz=${entry.tgz}` : ''
    const verified = entry.verified === true ? ' verify=ok' : entry.verified === false ? ' verify=FAILED' : ''
    console.log(`  - ${entry.key}@${entry.version} (${entry.dir}) ${built}${tgz}${verified}`)
  }
  console.log()
  console.log('startup command for local testing:')
  console.log(state.startupCommand)
  console.log()
  console.log('notes:')
  for (const note of state.notes) console.log(`- ${note}`)
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n`)
    process.stderr.write(usage())
    process.exit(2)
  }
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }
  try {
    const state = run(options)
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ...state, repoRoot: REPO_ROOT }, null, 2)}\n`)
    } else {
      printHuman(options, state)
    }
    const failedVerifications = Object.values(state.verified).filter((value) => value === false)
    process.exit(failedVerifications.length ? 1 : 0)
  } catch (error) {
    process.stderr.write(`aamp-local-release failed: ${error.message}\n`)
    process.exit(1)
  }
}

main()

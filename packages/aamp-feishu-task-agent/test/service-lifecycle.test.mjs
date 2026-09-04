import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import * as controller from '../bin/feishu-task-agent-controller.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const controllerPath = path.resolve(__dirname, '../bin/feishu-task-agent-controller.mjs')

const bindings = [
  { binding_id: 'binding-a', agent_type: 'codex' },
  { binding_id: 'binding-b', agent_type: 'aime' },
  { binding_id: 'binding-c', agent_type: 'cursor' },
]

test('service binding selection preserves saved selection order and drops removed bindings', () => {
  assert.equal(typeof controller.selectServiceBindings, 'function')
  assert.deepEqual(
    controller.selectServiceBindings(bindings, ['binding-c', 'missing', 'binding-a'])
      .map((binding) => binding.binding_id),
    ['binding-c', 'binding-a'],
  )
  assert.deepEqual(
    controller.selectServiceBindings(bindings, []).map((binding) => binding.binding_id),
    ['binding-a', 'binding-b', 'binding-c'],
  )
})

test('background handoff releases foreground resources before launchd starts', async () => {
  assert.equal(typeof controller.handoffToBackground, 'function')
  const calls = []
  const result = await controller.handoffToBackground(bindings.slice(0, 2), {
    cleanupRuntime: async () => calls.push('cleanup'),
    startService: async (bindingIds) => {
      calls.push(`start:${bindingIds.join(',')}`)
      return { state: 'running', pid: 2468 }
    },
  })

  assert.deepEqual(calls, ['cleanup', 'start:binding-a,binding-b'])
  assert.deepEqual(result, { state: 'running', pid: 2468 })
})

test('runtime status reports launchd, legacy foreground, and stopped states', async () => {
  assert.equal(typeof controller.resolveManagedRuntimeStatus, 'function')
  const background = await controller.resolveManagedRuntimeStatus({
    launchdStatus: async () => ({ loaded: true, state: 'running', pid: 1111 }),
    foregroundPids: async () => [1111],
  })
  assert.deepEqual(background, { mode: 'background', state: 'running', pid: 1111, pids: [1111] })

  const foreground = await controller.resolveManagedRuntimeStatus({
    launchdStatus: async () => ({ loaded: false, state: 'stopped', pid: null }),
    foregroundPids: async () => [2222],
  })
  assert.deepEqual(foreground, { mode: 'foreground', state: 'running', pid: 2222, pids: [2222] })

  const stopped = await controller.resolveManagedRuntimeStatus({
    launchdStatus: async () => ({ loaded: false, state: 'stopped', pid: null }),
    foregroundPids: async () => [],
  })
  assert.deepEqual(stopped, { mode: 'stopped', state: 'stopped', pid: null, pids: [] })
})

test('managed stop unloads launchd before terminating verified legacy foreground owners', async () => {
  assert.equal(typeof controller.stopManagedRuntime, 'function')
  const calls = []
  const result = await controller.stopManagedRuntime({
    stopLaunchd: async () => {
      calls.push('launchd-stop')
      return { stopped: true, wasLoaded: true }
    },
    foregroundPids: async () => {
      calls.push('owners')
      return [3333]
    },
    stopForeground: async (pids) => {
      calls.push(`foreground-stop:${pids.join(',')}`)
      return { stopped: pids, remaining: [] }
    },
  })

  assert.deepEqual(calls, ['launchd-stop', 'owners', 'foreground-stop:3333'])
  assert.deepEqual(result, { launchd: true, stoppedPids: [3333] })
})

test('background mode applies only to macOS install and start commands', () => {
  assert.equal(typeof controller.shouldUseBackgroundService, 'function')
  assert.equal(controller.shouldUseBackgroundService('install', 'darwin', false), true)
  assert.equal(controller.shouldUseBackgroundService('start', 'darwin', false), true)
  assert.equal(controller.shouldUseBackgroundService('start', 'darwin', true), false)
  assert.equal(controller.shouldUseBackgroundService('__service-run', 'darwin', false), false)
  assert.equal(controller.shouldUseBackgroundService('start', 'linux', false), false)
})

test('successful interactive startup hands off only after readiness and service workers keep supervising', async () => {
  assert.equal(typeof controller.continueStartedRuntime, 'function')
  const calls = []
  const result = await controller.continueStartedRuntime({
    background: true,
    serviceWorker: false,
    bindings: bindings.slice(0, 2),
    running: [{ binding: bindings[0] }],
    groups: new Map(),
  }, {
    handoff: async (selected) => {
      calls.push(`handoff:${selected.map((binding) => binding.binding_id).join(',')}`)
      return { state: 'running', pid: 4567 }
    },
    superviseRuntime: async () => calls.push('supervise'),
  })
  assert.deepEqual(calls, ['handoff:binding-a,binding-b'])
  assert.deepEqual(result, { mode: 'background', state: 'running', pid: 4567 })

  await controller.continueStartedRuntime({
    background: false,
    serviceWorker: true,
    serviceGeneration: 'generation-a',
    bindings: bindings.slice(0, 1),
    running: [{ binding: bindings[0] }],
    groups: new Map(),
  }, {
    handoff: async () => calls.push('unexpected-handoff'),
    markServiceReady: async (selected, generation) => calls.push(`service-ready:${generation}:${selected.map((binding) => binding.binding_id).join(',')}`),
    superviseRuntime: async () => calls.push('service-supervise'),
  })
  assert.deepEqual(calls, [
    'handoff:binding-a,binding-b',
    'service-ready:generation-a:binding-a',
    'service-supervise',
  ])
})

test('selected binding startup hands off only the bindings that actually became ready', async () => {
  assert.equal(typeof controller.startSelectedBindings, 'function')
  const calls = []
  const originalLog = console.log
  console.log = () => {}
  try {
    await controller.startSelectedBindings(bindings.slice(0, 2), undefined, {
      background: true,
      orchestrate: async () => ({
        groups: new Map(),
        running: [{ binding: bindings[0] }],
        failed: [],
        cancelled: [],
      }),
      runtimeOperations: {
        handoff: async (selected) => {
          calls.push(selected.map((binding) => binding.binding_id).join(','))
          return { state: 'running', pid: 6789 }
        },
        superviseRuntime: async () => assert.fail('background start must not remain supervised here'),
      },
    })
  } finally {
    console.log = originalLog
  }

  assert.deepEqual(calls, ['binding-a'])
})

test('service worker fails closed unless every persisted binding becomes ready', async () => {
  const calls = []
  const originalLog = console.log
  console.log = () => {}
  try {
    await assert.rejects(
      controller.startSelectedBindings(bindings.slice(0, 2), undefined, {
        serviceWorker: true,
        orchestrate: async () => ({
          groups: new Map([['group', { id: 'group' }]]),
          running: [{ binding: bindings[0] }],
          failed: [{ binding: bindings[1], error: new Error('not ready') }],
          cancelled: [],
        }),
        runtimeOperations: {
          markServiceReady: async () => calls.push('ready'),
          superviseRuntime: async () => calls.push('supervise'),
        },
        shutdown: async () => calls.push('shutdown'),
      }),
      /后台服务.*未全部启动/,
    )
  } finally {
    console.log = originalLog
  }

  assert.deepEqual(calls, ['shutdown'])
})

test('service worker marks agent preparation as non-interactive', async () => {
  const calls = []
  const originalLog = console.log
  console.log = () => {}
  try {
    await controller.startSelectedBindings(bindings.slice(0, 1), undefined, {
      serviceWorker: true,
      serviceGeneration: 'generation-non-interactive',
      orchestrate: async (selected, existingGroups, operations, runtimeOptions) => {
        assert.deepEqual(selected, bindings.slice(0, 1))
        assert.equal(existingGroups, undefined)
        assert.equal(operations, undefined)
        assert.deepEqual(runtimeOptions, { nonInteractive: true })
        return {
          groups: new Map(),
          running: [{ binding: bindings[0] }],
          failed: [],
          cancelled: [],
        }
      },
      runtimeOperations: {
        markServiceReady: async () => calls.push('ready'),
        superviseRuntime: async () => calls.push('supervise'),
      },
    })
  } finally {
    console.log = originalLog
  }

  assert.deepEqual(calls, ['ready', 'supervise'])
})

test('startup orchestration forwards runtime options to agent initialization', async () => {
  const emptyLaunch = { running: [], failed: [], cancelled: [] }
  const calls = []
  const result = await controller.orchestrateStartupBindings(bindings.slice(0, 1), undefined, {
    validateBinding: () => {},
    recordValidationFailure: async () => assert.fail('valid bindings must not fail validation'),
    initializeAgentGroups: async (selected, runtimeOptions) => {
      assert.deepEqual(selected, bindings.slice(0, 1))
      assert.deepEqual(runtimeOptions, { nonInteractive: true })
      calls.push('initialize')
      return new Map()
    },
    probeReadyBindingProfiles: async () => new Map(),
    startAgentGroups: async () => calls.push('start-agents'),
    startBindingsWithGroups: async () => emptyLaunch,
    reconcileOverlappedReadyBindings: async () => ({ alive: [], failed: [], cancelled: [] }),
    reconcileRetainedBindings: async () => ({ alive: [], failed: [] }),
    stopRunningBindings: async () => {},
    throwIfStopping: () => {},
  }, { nonInteractive: true })

  assert.deepEqual(calls, ['initialize', 'start-agents'])
  assert.deepEqual(result.running, [])
  assert.deepEqual(result.failed, [])
})

test('foreground startup prints its keep-open instruction before entering supervision', async () => {
  const output = []
  const originalLog = console.log
  console.log = (...args) => output.push(args.join(' '))
  try {
    await controller.startSelectedBindings(bindings.slice(0, 1), undefined, {
      orchestrate: async () => ({
        groups: new Map(),
        running: [{ binding: bindings[0] }],
        failed: [],
        cancelled: [],
      }),
      runtimeOperations: {
        superviseRuntime: async () => {
          assert.equal(output.some((line) => line.includes('保持终端打开')), true)
        },
      },
    })
  } finally {
    console.log = originalLog
  }
})

test('install finalization hands only ready bindings to the background service after preflight', async () => {
  assert.equal(typeof controller.finalizeInstallRuntime, 'function')
  const calls = []
  const originalLog = console.log
  console.log = () => {}
  try {
    await controller.finalizeInstallRuntime({
      acceptedBindings: bindings.slice(0, 2),
      selectedCount: 2,
      running: [{ binding: bindings[0] }],
      failed: [],
      cancelled: [],
      selectionFailures: [],
      groups: new Map(),
    }, {
      background: true,
      continueRuntime: async (runtime) => {
        calls.push({
          background: runtime.background,
          bindingIds: runtime.bindings.map((binding) => binding.binding_id),
        })
        return { mode: 'background', state: 'running', pid: 7890 }
      },
      shutdown: async () => assert.fail('a successful startup must not use all-failed shutdown'),
    })
  } finally {
    console.log = originalLog
  }

  assert.deepEqual(calls, [{ background: true, bindingIds: ['binding-a'] }])
})

test('service lifecycle status and stop commands expose actionable process state', async () => {
  assert.equal(typeof controller.runServiceLifecycleCommand, 'function')
  const output = []
  const operations = {
    log: (line) => output.push(line),
    getStatus: async () => ({ mode: 'background', state: 'running', pid: 1357, pids: [1357] }),
    stopRuntime: async () => ({ launchd: true, stoppedPids: [] }),
  }

  const status = await controller.runServiceLifecycleCommand('status', operations)
  assert.equal(status.pid, 1357)
  assert.match(output.shift(), /后台运行.*PID 1357/)

  const stopped = await controller.runServiceLifecycleCommand('stop', operations)
  assert.deepEqual(stopped, { launchd: true, stoppedPids: [] })
  assert.match(output.shift(), /已停止/)
})

test('service lifecycle status does not report a loaded but non-running launchd job as healthy', async () => {
  const output = []
  const status = await controller.runServiceLifecycleCommand('status', {
    log: (line) => output.push(line),
    getStatus: async () => ({ mode: 'background', state: 'waiting', pid: null, pids: [] }),
  })

  assert.equal(status.state, 'waiting')
  assert.match(output[0], /已加载但未运行/)
  assert.match(output[0], /logs/)
  assert.doesNotMatch(output[0], /🟢/)
})

test('service lifecycle restart reuses saved selection and falls back to all bindings', async () => {
  const calls = []
  const output = []
  const operations = {
    log: (line) => output.push(line),
    readSelection: async () => [],
    loadBindings: async () => bindings.slice(0, 2),
    stopRuntime: async () => calls.push('stop'),
    startService: async (bindingIds) => {
      calls.push(`start:${bindingIds.join(',')}`)
      return { loaded: true, state: 'running', pid: 8642 }
    },
  }

  const result = await controller.runServiceLifecycleCommand('restart', operations)

  assert.equal(result.pid, 8642)
  assert.deepEqual(calls, ['stop', 'start:binding-a,binding-b'])
  assert.match(output[0], /重新启动.*PID 8642/)
})

test('service lifecycle restart drops binding ids that no longer exist', async () => {
  const calls = []
  await controller.runServiceLifecycleCommand('restart', {
    log: () => {},
    readSelection: async () => ['missing-binding', 'binding-b'],
    loadBindings: async () => bindings.slice(0, 2),
    stopRuntime: async () => calls.push('stop'),
    startService: async (bindingIds) => {
      calls.push(`start:${bindingIds.join(',')}`)
      return { loaded: true, state: 'running', pid: 8643 }
    },
  })

  assert.deepEqual(calls, ['stop', 'start:binding-b'])
})

test('service lifecycle logs prints a bounded recent log and its stable path', async () => {
  const output = []
  const result = await controller.runServiceLifecycleCommand('logs', {
    log: (line) => output.push(line),
    recentLogs: async () => 'line-a\nline-b',
    logFile: '/Users/test/.aamp/logs/feishu-task-agent-service.log',
  })

  assert.equal(result, 'line-a\nline-b')
  assert.deepEqual(output, [
    '后台日志：/Users/test/.aamp/logs/feishu-task-agent-service.log',
    'line-a\nline-b',
  ])
})

test('start is idempotent when the launchd service is already running', async () => {
  assert.equal(typeof controller.runStart, 'function')
  const output = []
  await controller.runStart({
    background: true,
    log: (line) => output.push(line),
    loadBindings: async () => bindings,
    getStatus: async () => ({ mode: 'background', state: 'running', pid: 1122, pids: [1122] }),
    acquireLease: async () => assert.fail('an already-running service must not acquire another lease'),
    chooseBindings: async () => assert.fail('an already-running service must not prompt again'),
    startBindings: async () => assert.fail('an already-running service must not start twice'),
  })

  assert.match(output[0], /已经在后台运行.*PID 1122/)
})

test('start resumes a loaded service with only saved bindings that still exist', async () => {
  const calls = []
  await controller.runStart({
    background: true,
    log: () => {},
    loadBindings: async () => bindings.slice(0, 2),
    getStatus: async () => ({ mode: 'background', state: 'waiting', pid: null, pids: [] }),
    readSelection: async () => ['missing-binding', 'binding-b'],
    resumeService: async (bindingIds) => {
      calls.push(bindingIds)
      return { loaded: true, state: 'running', pid: 1123 }
    },
    acquireLease: async () => assert.fail('a loaded launchd service is resumed directly'),
    chooseBindings: async () => assert.fail('a loaded launchd service does not prompt again'),
    startBindings: async () => assert.fail('a loaded launchd service does not preflight again'),
  })

  assert.deepEqual(calls, [['binding-b']])
})

test('start preflights selected bindings before handing them to the background service', async () => {
  const calls = []
  await controller.runStart({
    background: true,
    loadBindings: async () => bindings,
    getStatus: async () => ({ mode: 'stopped', state: 'stopped', pid: null, pids: [] }),
    acquireLease: async () => calls.push('lease'),
    chooseBindings: async (prompt, available) => {
      calls.push(`choose:${available.length}`)
      return available.slice(0, 2)
    },
    startBindings: async (selected, existingGroups, options) => {
      assert.equal(existingGroups, undefined)
      assert.equal(options.background, true)
      calls.push(`start:${selected.map((binding) => binding.binding_id).join(',')}`)
    },
  })

  assert.deepEqual(calls, ['lease', 'choose:3', 'start:binding-a,binding-b'])
})

test('service worker starts only the persisted binding selection without prompting', async () => {
  assert.equal(typeof controller.runServiceWorker, 'function')
  const calls = []
  await controller.runServiceWorker({
    loadBindings: async () => bindings,
    readSelectionSnapshot: async () => ({
      generation: 'generation-worker',
      bindingIds: ['binding-b'],
    }),
    acquireLease: async () => calls.push('lease'),
    startBindings: async (selected, existingGroups, options) => {
      assert.equal(existingGroups, undefined)
      assert.equal(options.serviceWorker, true)
      assert.equal(options.serviceGeneration, 'generation-worker')
      calls.push(`start:${selected.map((binding) => binding.binding_id).join(',')}`)
    },
  })

  assert.deepEqual(calls, ['lease', 'start:binding-b'])
})

test('controller command routing isolates service controls from runtime acquisition', async () => {
  assert.equal(typeof controller.dispatchControllerCommand, 'function')
  const calls = []
  const operations = {
    acquireLease: async (action) => calls.push(`lease:${action}`),
    install: async () => calls.push('install'),
    start: async () => calls.push('start'),
    serviceWorker: async () => calls.push('service-worker'),
    lifecycle: async (action) => calls.push(`lifecycle:${action}`),
    list: async () => calls.push('list'),
    add: async () => calls.push('add'),
    remove: async () => calls.push('remove'),
  }

  await controller.dispatchControllerCommand('install', operations)
  await controller.dispatchControllerCommand('start', operations)
  await controller.dispatchControllerCommand('__service-run', operations)
  for (const action of ['status', 'stop', 'restart', 'logs']) {
    await controller.dispatchControllerCommand(action, operations)
  }

  assert.deepEqual(calls, [
    'lease:install',
    'install',
    'start',
    'service-worker',
    'lifecycle:status',
    'lifecycle:stop',
    'lifecycle:restart',
    'lifecycle:logs',
  ])
})

test('controller status command reads the launchd service without acquiring a runtime lease', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aamp-controller-status-'))
  const fakeLaunchctl = path.join(root, 'launchctl')
  const serviceHome = path.join(root, '.aamp', 'feishu-task-agent', 'service-v1')
  mkdirSync(serviceHome, { recursive: true })
  writeFileSync(path.join(serviceHome, 'selection.json'), JSON.stringify({
    version: 1,
    generation: 'generation-status-test',
    binding_ids: ['binding-a'],
  }))
  writeFileSync(path.join(serviceHome, 'readiness.json'), JSON.stringify({
    version: 1,
    state: 'ready',
    generation: 'generation-status-test',
    pid: 4242,
    binding_ids: ['binding-a'],
  }))
  writeFileSync(fakeLaunchctl, `#!/usr/bin/env bash
if [ "$1" = print ]; then
  printf 'state = running\\n\\tpid = 4242\\n'
  exit 0
fi
exit 97
`)
  chmodSync(fakeLaunchctl, 0o755)

  const result = spawnSync(process.execPath, [controllerPath, 'status'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      HOME: root,
      AAMP_TASK_STATE_HOME: path.join(root, 'state'),
      AAMP_TASK_RUNTIME_HOME: path.join(root, 'runtime'),
      AAMP_RUN_LOG_DIR: path.join(root, 'run-log'),
      AAMP_TASK_ALLOW_TEST_OVERRIDES: 'true',
      AAMP_TASK_LAUNCHCTL_BIN: fakeLaunchctl,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /后台运行.*PID 4242/)
})

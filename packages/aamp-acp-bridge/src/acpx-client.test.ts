import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AcpxClient,
  buildAcpxEnvironment,
  selectFinalAssistantOutput,
  selectOwnedWindowsTree,
  terminateWindowsProcessTree,
  WindowsOwnedProcessTree,
  type WindowsProcessIdentity,
} from './acpx-client.js'

const tempDirectories: string[] = []
const testDirectory = dirname(fileURLToPath(import.meta.url))

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('terminateWindowsProcessTree kills only an unchanged owned process identity', () => {
  const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = []
  const identity: WindowsProcessIdentity = {
    pid: 4312,
    creationDate: '20260907101010.000000+480',
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    ownerSid: 'S-1-5-21-1000',
  }
  const killed = terminateWindowsProcessTree(identity, () => ({ status: 'found', identity: { ...identity } }), ((command: string, args: readonly string[], options: unknown) => {
    calls.push({ command, args, options })
    return Buffer.alloc(0)
  }) as never)

  assert.equal(killed, 'termination-requested')
  assert.deepEqual(calls, [{
    command: 'taskkill.exe',
    args: ['/pid', '4312', '/t', '/f'],
    options: { stdio: 'ignore', windowsHide: true },
  }])
})

test('terminateWindowsProcessTree refuses a reused pid', () => {
  const expected: WindowsProcessIdentity = {
    pid: 4312,
    creationDate: '20260907101010.000000+480',
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    ownerSid: 'S-1-5-21-1000',
  }
  let spawned = false
  const killed = terminateWindowsProcessTree(expected, () => ({ status: 'found', identity: {
    ...expected, creationDate: '20260907101100.000000+480',
  } }), (() => {
    spawned = true
    return Buffer.alloc(0)
  }) as never)

  assert.equal(killed, 'identity-changed')
  assert.equal(spawned, false)
})

test('buildAcpxEnvironment pins local bin through one case-insensitive PATH key', () => {
  const env = buildAcpxEnvironment('C:\\workspace', {
    Path: 'C:\\global-bin',
    PATH: 'C:\\stale-bin',
    PATHEXT: '.CMD',
  }, 'win32')

  assert.deepEqual(Object.keys(env).filter((key) => key.toLowerCase() === 'path'), ['Path'])
  assert.equal(env.Path, 'C:\\workspace\\node_modules\\.bin;C:\\global-bin')
})

test('exec reports synchronous native resolver failures after trying npx fallback', async () => {
  const attempted: string[] = []
  const client = new AcpxClient(process.cwd(), {
    resolveCommand: (command) => {
      attempted.push(command)
      throw new Error(`${command} shim is unsupported`)
    },
  })

  await assert.rejects(
    () => client.ensureSession('codex', 'resolver-failure'),
    /npx shim is unsupported/,
  )
  assert.deepEqual(attempted, ['acpx', 'npx'])
})

test('WindowsOwnedProcessTree cleans a retained orphan without touching reused or unrelated pids', () => {
  const root: WindowsProcessIdentity = {
    pid: 100,
    creationDate: 'root-created',
    executablePath: 'C:\\node.exe',
    ownerSid: 'S-1-5-21-owner',
  }
  const child: WindowsProcessIdentity = {
    pid: 101,
    creationDate: 'child-created',
    executablePath: 'C:\\agent.exe',
    ownerSid: root.ownerSid,
  }
  const reused: WindowsProcessIdentity = {
    pid: 102,
    creationDate: 'old-child-created',
    executablePath: 'C:\\helper.exe',
    ownerSid: root.ownerSid,
  }
  const unrelated: WindowsProcessIdentity = {
    pid: 900,
    creationDate: 'unrelated-created',
    executablePath: 'C:\\node.exe',
    ownerSid: root.ownerSid,
  }
  let intervalCallback: (() => void) | undefined
  let cleared = false
  const live = new Map([
    [child.pid, child],
    [reused.pid, { ...reused, creationDate: 'reused-by-new-process' }],
    [unrelated.pid, unrelated],
  ])
  const killed: number[] = []
  const tree = new WindowsOwnedProcessTree(root, {
    snapshot: () => [root, child, reused],
    terminate: (identity) => {
      const current = live.get(identity.pid)
      if (current?.creationDate !== identity.creationDate) return 'identity-changed'
      killed.push(identity.pid)
      return 'termination-requested'
    },
    setIntervalFn: (callback: () => void) => {
      intervalCallback = callback
      return { unref() {} } as NodeJS.Timeout
    },
    clearIntervalFn: () => { cleared = true },
  })

  tree.start()
  intervalCallback?.()
  tree.stopPolling()
  tree.terminateRetained()

  assert.equal(cleared, true)
  assert.deepEqual(killed, [101])
  assert.equal(live.has(unrelated.pid), true)
})

test('WindowsOwnedProcessTree ignores a failed or root-mismatched snapshot', () => {
  const root: WindowsProcessIdentity = {
    pid: 200,
    creationDate: 'root-created',
    executablePath: 'C:\\node.exe',
    ownerSid: 'S-1-5-21-owner',
  }
  const killed: number[] = []
  const snapshots: Array<() => WindowsProcessIdentity[]> = [
    () => { throw new Error('CIM unavailable') },
    () => [{ ...root, creationDate: 'reused-root' }, {
      pid: 201,
      creationDate: 'not-owned',
      executablePath: 'C:\\other.exe',
      ownerSid: root.ownerSid,
    }],
  ]
  const tree = new WindowsOwnedProcessTree(root, {
    snapshot: () => snapshots.shift()?.() ?? [],
    terminate: (identity) => { killed.push(identity.pid); return 'termination-requested' },
    setIntervalFn: (() => ({ unref() {} })) as never,
    clearIntervalFn: () => {},
  })

  tree.refresh()
  tree.refresh()
  tree.terminateRetained()
  assert.deepEqual(killed, [])
})

test('selectOwnedWindowsTree rejects a child older than its parent after PID reuse', () => {
  const root: WindowsProcessIdentity = {
    pid: 300,
    creationDate: '2026-09-07T10:00:00.9000000+08:00',
    executablePath: 'C:\\node.exe',
    ownerSid: 'S-1-5-21-owner',
  }
  const selected = selectOwnedWindowsTree(root, [
    { ...root, parentPid: 1 },
    {
      pid: 301,
      parentPid: 300,
      creationDate: '2026-09-07T10:00:00.1000000+08:00',
      executablePath: 'C:\\stale.exe',
      ownerSid: root.ownerSid,
    },
    {
      pid: 302,
      parentPid: 300,
      creationDate: '2026-09-07T10:00:01.0000000+08:00',
      executablePath: 'C:\\owned.exe',
      ownerSid: root.ownerSid,
    },
  ])

  assert.deepEqual(selected.map((identity) => identity.pid), [300, 302])
})

test('WindowsOwnedProcessTree retains unconfirmed termination for a later retry', () => {
  const root: WindowsProcessIdentity = {
    pid: 400,
    creationDate: 'root-created',
    executablePath: 'C:\\node.exe',
    ownerSid: 'S-1-5-21-owner',
  }
  const child = { ...root, pid: 401, creationDate: 'child-created' }
  const attempts: number[] = []
  let childOutcome: 'unconfirmed' | 'gone' = 'unconfirmed'
  const tree = new WindowsOwnedProcessTree(root, {
    snapshot: () => [root, child],
    terminate: (identity) => {
      attempts.push(identity.pid)
      return identity.pid === child.pid ? childOutcome : 'gone'
    },
    setIntervalFn: (() => ({ unref() {} })) as never,
    clearIntervalFn: () => {},
  })

  tree.refresh()
  tree.terminateRetained()
  childOutcome = 'gone'
  tree.terminateRetained()

  assert.deepEqual(attempts, [401, 400, 401])
})

function createFakeAcpx(mode: 'success' | 'auth-failure' | 'auth-with-output' | 'json-auth-failure' | 'json-aime-auth-failure' | 'json-aime-sources' | 'auth-discussion' | 'timeout' | 'close-retry'): { cwd: string; logFile: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'aamp-acpx-readiness-test-'))
  tempDirectories.push(cwd)
  const binDirectory = join(cwd, 'node_modules', '.bin')
  const logFile = join(cwd, 'acpx.log')
  mkdirSync(binDirectory, { recursive: true })
  const entry = join(binDirectory, 'acpx.cjs')
  writeFileSync(entry, `process.env.AAMP_FAKE_ACPX_MODE = ${JSON.stringify(mode)};\nprocess.env.AAMP_FAKE_ACPX_CWD = ${JSON.stringify(cwd)};\nimport(${JSON.stringify(new URL('../test/fake-acpx.mjs', import.meta.url).href)});\n`)
  // npm-style shim exercises native resolution without requiring a POSIX shell.
  writeFileSync(join(binDirectory, 'acpx.cmd'), '@echo off\r\n"' + process.execPath + '" "%~dp0\\acpx.cjs" %*\r\n')
  writeFileSync(join(binDirectory, 'acpx'), '#!/usr/bin/env node\n' + readFileSync(entry, 'utf8'))
  chmodSync(join(binDirectory, 'acpx'), 0o755)
  return { cwd, logFile }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForState(statePath: string, state: string): Promise<number> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (existsSync(statePath)) {
      const record = readFileSync(statePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { pid?: unknown; state?: unknown })
        .find((entry) => entry.state === state)
      if (record && Number.isSafeInteger(record.pid) && (record.pid as number) > 1) {
        return record.pid as number
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for child state ${state}`)
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && processExists(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (processExists(pid)) throw new Error('owned fixture process did not exit')
}

function createTermResistantAcpx(): { cwd: string; statePath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'aamp-acpx-stop-test-'))
  tempDirectories.push(cwd)
  const binDirectory = join(cwd, 'node_modules', '.bin')
  const statePath = join(cwd, 'child-state.jsonl')
  const fixturePath = join(testDirectory, '..', 'test', 'acpx-stop-ignore-term-child.mjs')
  mkdirSync(binDirectory, { recursive: true })
  writeFileSync(join(binDirectory, 'acpx'), [
    '#!/bin/sh',
    `exec ${shellQuote(process.execPath)} ${shellQuote(fixturePath)} ${shellQuote(statePath)}`,
    '',
  ].join('\n'))
  chmodSync(join(binDirectory, 'acpx'), 0o755)
  return { cwd, statePath }
}

test('stop waits for a TERM-resistant owned child to close after SIGKILL', { timeout: 10_000, skip: process.platform === 'win32' ? 'POSIX SIGTERM resistance; Windows ownership and termination are covered separately' : false }, async () => {
  const { cwd, statePath } = createTermResistantAcpx()
  const client = new AcpxClient(cwd)
  const execution = client.ensureSession('fake-agent --acp', 'stop-owned-child')
  const executionOutcome = execution.then(
    () => ({ kind: 'fulfilled' as const }),
    () => ({ kind: 'rejected' as const }),
  )
  let pid = 0

  try {
    pid = await waitForState(statePath, 'ready')
    let stopSettled = false
    const stopping = Promise.resolve(client.stop()).finally(() => {
      stopSettled = true
    })
    await waitForState(statePath, 'sigterm-ignored')

    assert.equal(stopSettled, false, 'stop must retain ownership until child close')
    assert.equal(processExists(pid), true, 'TERM-resistant fixture must still be alive before KILL')
    await stopping
    assert.equal(processExists(pid), false, 'stop must settle only after the owned PID is gone')
    assert.equal((await executionOutcome).kind, 'rejected')
  } finally {
    if (pid > 1 && processExists(pid)) {
      try { process.kill(-pid, 'SIGKILL') } catch {
        try { process.kill(pid, 'SIGKILL') } catch { /* exact owned fixture cleanup */ }
      }
      await waitForProcessExit(pid)
    }
    await executionOutcome
  }
})

test('stop is safe after a child has already closed normally', async () => {
  const { cwd } = createFakeAcpx('success')
  const client = new AcpxClient(cwd)

  await client.ensureSession('fake-agent --acp', 'normally-closed-child')
  await Promise.resolve(client.stop())
})

test('probeAgent creates a fresh ACP session and closes it after success', async () => {
  const { cwd, logFile } = createFakeAcpx('success')
  const client = new AcpxClient(cwd)

  await client.probeAgent('fake-agent --acp', {
    sessionName: 'aamp-readiness-probe-test',
    timeoutMs: 5_000,
  })

  assert.deepEqual(readFileSync(logFile, 'utf8').trim().split('\n'), [
    `--approve-all --cwd ${cwd} --agent fake-agent --acp sessions new --name aamp-readiness-probe-test`,
    `--approve-all --cwd ${cwd} --agent fake-agent --acp sessions close aamp-readiness-probe-test`,
  ])
})

test('probeAgent preserves authentication failures and does not close a session that was not created', async () => {
  const { cwd, logFile } = createFakeAcpx('auth-failure')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.probeAgent('fake-agent --acp', {
      sessionName: 'aamp-readiness-auth-failure',
      timeoutMs: 5_000,
    }),
    /Authentication required/,
  )

  const commands = readFileSync(logFile, 'utf8').trim().split('\n')
  assert.equal(commands.length, 1)
  assert.match(commands[0], /sessions new --name aamp-readiness-auth-failure$/)
})

test('probeAgent times out instead of hanging bridge startup', async () => {
  const { cwd, logFile } = createFakeAcpx('timeout')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.probeAgent('fake-agent --acp', {
      sessionName: 'aamp-readiness-timeout',
      timeoutMs: 1_000,
    }),
    /timed out after 1000ms/,
  )

  assert.match(
    readFileSync(logFile, 'utf8'),
    /sessions close aamp-readiness-timeout/,
  )
})

test('probeAgent retries cleanup after a temporary close failure', async () => {
  const { cwd, logFile } = createFakeAcpx('close-retry')
  const client = new AcpxClient(cwd)

  await client.probeAgent('fake-agent --acp', {
    sessionName: 'aamp-readiness-close-retry',
    timeoutMs: 5_000,
  })

  const closeCommands = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter((command) => command.includes('sessions close'))
  assert.equal(closeCommands.length, 2)
})

test('prompt rejects an authentication message even when the agent exits successfully', async () => {
  const { cwd } = createFakeAcpx('auth-failure')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.prompt('fake-agent --acp', 'aamp-workbuddy', 'hello'),
    /Authentication required/,
  )
})

test('prompt rejects a stderr authentication line even after partial stdout and warnings', async () => {
  const { cwd } = createFakeAcpx('auth-with-output')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.prompt('fake-agent --acp', 'aamp-workbuddy', 'hello'),
    /^Error: Authentication required$/,
  )
})

test('prompt rejects a bare authentication message from a JSON-RPC error', async () => {
  const { cwd } = createFakeAcpx('json-auth-failure')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.prompt('fake-agent --acp', 'aamp-workbuddy', 'hello'),
    /^Error: Authentication required$/,
  )
})

test('prompt rejects a structured AIME AUTH_REQUIRED response with safe login guidance', async () => {
  const { cwd } = createFakeAcpx('json-aime-auth-failure')
  const client = new AcpxClient(cwd)

  await assert.rejects(
    client.prompt('fake-agent --acp', 'aamp-aime', 'hello'),
    {
      message: 'AUTH_REQUIRED: Managed user authentication is required. Run `aime-acp auth login --site cn`.',
    },
  )
})

test('prompt preserves normal replies that merely discuss authentication errors', async () => {
  const { cwd } = createFakeAcpx('auth-discussion')
  const client = new AcpxClient(cwd)

  const result = await client.prompt('fake-agent --acp', 'aamp-workbuddy', 'explain auth errors')

  assert.equal(result.output, 'The phrase authentication required may appear in diagnostic logs.')
})

test('final assistant selection does not reserve the AIME Sources message id by itself', () => {
  const messages = new Map([
    ['aime-sources', 'AAMP_RESULT_JSON: legitimate final answer'],
  ])

  assert.equal(
    selectFinalAssistantOutput(messages, ['aime-sources']),
    'AAMP_RESULT_JSON: legitimate final answer',
  )
})

test('prompt excludes only meta-marked AIME Sources while preserving the original protocol result', async () => {
  const { cwd } = createFakeAcpx('json-aime-sources')
  const client = new AcpxClient(cwd)
  const chunks: string[] = []

  const result = await client.prompt('fake-agent --acp', 'aamp-aime', 'weather', {
    onTextChunk: ({ text }) => chunks.push(text),
  })

  assert.equal(
    result.output,
    'AAMP_RESULT_JSON: {"output":"FEISHU_TASK_RESULT_JSON: {\\"schema\\":\\"feishu_task_result.v2\\",\\"status\\":\\"answered\\",\\"summary\\":\\"成都天气\\",\\"reply_written\\":false}"}',
  )
  assert.equal(JSON.parse(result.output.slice('AAMP_RESULT_JSON: '.length)).output.startsWith('FEISHU_TASK_RESULT_JSON: '), true)
  assert.deepEqual(chunks, [
    result.output,
    'Sources:\n- [Guide](https://example.test/guide)',
  ])
})

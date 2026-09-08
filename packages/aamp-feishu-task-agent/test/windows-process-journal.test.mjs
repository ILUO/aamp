import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { stopOwnedWindowsTree } from '../bin/windows-platform.mjs'

import {
  createWindowsProcessJournal,
  recoverWindowsProcessJournals,
  requestWindowsControllerStop,
} from '../bin/windows-process-journal.mjs'

const controller = { pid: 100, startedAt: '2026-09-07T01:00:00.000Z', command: 'node controller', executablePath: 'C:\\node.exe', ownerSid: 'S-1-5-21-1' }
const child = { ...controller, pid: 101, startedAt: '2026-09-07T01:00:01.000Z' }

test('journal atomically persists controller and verified descendant identities', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aamp-journal-'))
  try {
    const journal = await createWindowsProcessJournal(root, controller, {
      ensurePrivateDirectory: async (directory) => fsp.mkdir(directory, { recursive: true }),
      atomicReplace: fsp.rename,
    })
    await journal.record([controller, child])
    const value = JSON.parse(await fsp.readFile(journal.file, 'utf8'))
    assert.deepEqual(value, { version: 1, controller, descendants: [child] })
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

test('recovery cleans exact descendants only after the recorded controller is gone', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aamp-journal-recover-'))
  const journal = await createWindowsProcessJournal(root, controller, {
    ensurePrivateDirectory: async (directory) => fsp.mkdir(directory, { recursive: true }), atomicReplace: fsp.rename,
  })
  await journal.record([child])
  const killed = []
  await recoverWindowsProcessJournals(root, {
    readIdentity: async () => undefined,
    stopTree: async (identity) => killed.push(identity.pid),
  })
  assert.deepEqual(killed, [101])
  assert.equal(await fsp.stat(journal.file).then(() => true, () => false), false)
  await fsp.rm(root, { recursive: true, force: true })
})

test('recovery preserves journal and surfaces descendant cleanup failure', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aamp-journal-fail-'))
  const journal = await createWindowsProcessJournal(root, controller, {
    ensurePrivateDirectory: async (directory) => fsp.mkdir(directory, { recursive: true }), atomicReplace: fsp.rename,
  })
  await journal.record([child])
  await assert.rejects(recoverWindowsProcessJournals(root, {
    readIdentity: async () => undefined,
    stopTree: async () => { throw new Error('identity unavailable') },
  }), /identity unavailable/)
  assert.equal((await fsp.stat(journal.file)).isFile(), true)
  await fsp.rm(root, { recursive: true, force: true })
})

test('identity-specific stop request is written only for an exact live controller', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aamp-journal-stop-'))
  const journal = await createWindowsProcessJournal(root, controller, {
    ensurePrivateDirectory: async (directory) => fsp.mkdir(directory, { recursive: true }), atomicReplace: fsp.rename,
  })
  assert.equal(await requestWindowsControllerStop(root, controller.pid, {
    readIdentity: async () => controller,
    atomicReplace: fsp.rename,
  }), true)
  assert.deepEqual(JSON.parse(await fsp.readFile(journal.stopFile, 'utf8')), {
    pid: controller.pid, startedAt: controller.startedAt,
  })
  await assert.rejects(requestWindowsControllerStop(root, controller.pid, {
    readIdentity: async () => ({ ...controller, startedAt: '2026-09-07T02:00:00.000Z' }), atomicReplace: fsp.rename,
  }), /identity changed/)
  await fsp.rm(root, { recursive: true, force: true })
})

for (const [name, live, error] of [
  ['newer PID generation', { ...child, startedAt: '2026-09-07T02:00:00.000Z', ownerSid: 'S-1-5-21-other' }, undefined],
  ['same creation time changed owner', { ...child, ownerSid: 'S-1-5-21-other' }, /identity changed/],
  ['same creation time changed executable', { ...child, executablePath: 'C:/other.exe' }, /identity changed/],
  ['older creation time', { ...child, startedAt: controller.startedAt }, /identity changed/],
  ['invalid creation time', { ...child, startedAt: 'invalid' }, /identity changed/],
  ['different PID', { ...child, pid: 999, startedAt: '2026-09-07T02:00:00.000Z' }, /identity changed/],
  ['identity query failure', new Error('CIM access denied'), /CIM access denied/],
]) {
  test(`journal recovery handles ${name} without killing an unverified process`, async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aamp-journal-generation-'))
    t.after(() => fsp.rm(root, { recursive: true, force: true }))
    const journal = await createWindowsProcessJournal(root, controller, {
      ensurePrivateDirectory: async () => {}, atomicReplace: fsp.rename,
    })
    await journal.record([child])
    let kills = 0
    const recovery = recoverWindowsProcessJournals(root, {
      readIdentity: async () => undefined,
      stopTree: (identity, options) => stopOwnedWindowsTree(identity, {
        ...options, platform: 'win32', getCurrentSid: async () => child.ownerSid,
        readIdentity: async () => { if (live instanceof Error) throw live; return live },
        runTaskkill: async () => { kills++ },
      }),
    })
    if (error) await assert.rejects(recovery, error)
    else await recovery
    assert.equal(kills, 0)
    assert.equal(await fsp.stat(journal.file).then(() => true, () => false), Boolean(error))
  })
}

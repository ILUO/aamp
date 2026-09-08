import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

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

import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const platform = () => import('./windows-platform.mjs')

function sameIdentity(left, right) {
  return Boolean(left && right && left.pid === right.pid && left.startedAt === right.startedAt
    && left.executablePath.toLowerCase() === right.executablePath.toLowerCase()
    && left.ownerSid.toLowerCase() === right.ownerSid.toLowerCase())
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'))
}

async function writeAtomic(file, value, atomicReplace) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
    await atomicReplace(temporary, file)
  } finally {
    await fsp.rm(temporary, { force: true })
  }
}

async function journalFiles(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  return entries.filter((entry) => entry.isFile() && /^controller-.*\.json$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
}

export async function createWindowsProcessJournal(directory, controller, {
  ensurePrivateDirectory = async (target) => (await platform()).ensurePrivateWindowsDirectory(target),
  atomicReplace = async (source, destination) => (await platform()).atomicReplaceWindows(source, destination),
} = {}) {
  await ensurePrivateDirectory(directory)
  const stamp = encodeURIComponent(controller.startedAt).replace(/%/g, '')
  const file = path.join(directory, `controller-${controller.pid}-${stamp}.json`)
  const stopFile = `${file}.stop`
  let state = { version: 1, controller, descendants: [] }
  let tail = Promise.resolve()
  await writeAtomic(file, state, atomicReplace)
  return {
    file,
    stopFile,
    record(identities) {
      tail = tail.catch(() => {}).then(async () => {
        const merged = new Map(state.descendants.map((identity) => [`${identity.pid}:${identity.startedAt}`, identity]))
        for (const identity of identities || []) {
          if (!sameIdentity(identity, controller)) merged.set(`${identity.pid}:${identity.startedAt}`, identity)
        }
        const next = { ...state, descendants: [...merged.values()] }
        if (JSON.stringify(next) === JSON.stringify(state)) return
        await writeAtomic(file, next, atomicReplace)
        state = next
      })
      return tail
    },
    async stopRequested() {
      const request = await readJson(stopFile).catch((error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      return request?.pid === controller.pid && request?.startedAt === controller.startedAt
    },
  }
}

export async function recoverWindowsProcessJournals(directory, {
  readIdentity = async (pid, options) => (await platform()).readWindowsProcessIdentity(pid, options),
  stopTree = async (identity, options) => (await platform()).stopOwnedWindowsTree(identity, options),
  controllerIdentity, signal,
} = {}) {
  let recovered=0
  for (const file of await journalFiles(directory)) {
    const journal = await readJson(file)
    if (journal?.version !== 1 || !journal.controller || !Array.isArray(journal.descendants)) {
      throw new Error(`invalid Windows process journal: ${file}`)
    }
    signal?.throwIfAborted()
    if (controllerIdentity && !sameIdentity(journal.controller,controllerIdentity)) continue
    const liveController = await readIdentity(journal.controller.pid, {exitedBefore:journal.controller.startedAt,...(signal ? {signal} : {})})
    if (sameIdentity(liveController, journal.controller)) continue
    for (const identity of [...journal.descendants].reverse()) {
      await stopTree(identity, { allowExitedIdentity: true, ...(signal ? {signal} : {}) })
    }
    signal?.throwIfAborted()
    await fsp.rm(`${file}.stop`, { force: true })
    signal?.throwIfAborted()
    await fsp.rm(file)
    recovered++
  }
  return recovered
}

export async function requestWindowsControllerStop(directory, pid, {
  readIdentity = async (targetPid) => (await platform()).readWindowsProcessIdentity(targetPid),
  atomicReplace = async (source, destination) => (await platform()).atomicReplaceWindows(source, destination),
} = {}) {
  for (const file of await journalFiles(directory)) {
    const journal = await readJson(file)
    if (journal?.controller?.pid !== pid) continue
    const live = await readIdentity(pid)
    if (!sameIdentity(live, journal.controller)) throw new Error(`Windows Controller ${pid} identity changed`)
    await writeAtomic(`${file}.stop`, { pid, startedAt: journal.controller.startedAt }, atomicReplace)
    return true
  }
  return false
}

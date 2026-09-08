import { withWindowsOperationLock } from './windows-operation-lock.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const execFileAsync = promisify(execFile)
const platform = () => import('./windows-platform.mjs')

const schedulerScript = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$c=$env:AAMP_SCHEDULER_INPUT | ConvertFrom-Json
$t=Get-ScheduledTask -TaskName $c.name -ErrorAction SilentlyContinue
if ($t -and $t.Principal.UserId -ne $c.sid) { throw 'Scheduled task belongs to another identity' }
switch ($c.operation) {
 'status' {
  if ($t) { @{loaded=($t.State -ne 'Disabled');state=[string]$t.State;ownerSid=$t.Principal.UserId} | ConvertTo-Json -Compress }
  else { @{loaded=$false;state='Stopped';ownerSid=$c.sid} | ConvertTo-Json -Compress }
 }
 'disable' { if ($t) { Disable-ScheduledTask -TaskName $c.name | Out-Null } }
 'start' {
  $p=New-ScheduledTaskPrincipal -UserId $c.sid -LogonType Interactive -RunLevel Limited
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $c.sid
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $a=New-ScheduledTaskAction -Execute $c.node -Argument ('"'+$c.worker+'" "'+$c.config+'"') -WorkingDirectory $c.directory
  Register-ScheduledTask -TaskName $c.name -Action $a -Principal $p -Trigger $trigger -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $c.name
 }
 'unregister' { if ($t) { Unregister-ScheduledTask -TaskName $c.name -Confirm:$false } }
 default { throw 'Unknown scheduler operation' }
}
`
async function nativeScheduler(operation, config) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', schedulerScript],
    {
      env: {
        ...process.env,
        AAMP_SCHEDULER_INPUT: JSON.stringify({ ...config, operation }),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  )
  return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : {}
}
async function currentSid() {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  )
  const sid = stdout.trim()
  if (!/^S-1-\d+(?:-\d+)+$/.test(sid))
    throw new Error('Cannot determine Windows user SID')
  return sid
}
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError)
      return undefined
    throw error
  }
}
function sameIds(a = [], b = []) {
  return (
    JSON.stringify([...new Set(a)].sort()) ===
    JSON.stringify([...new Set(b)].sort())
  )
}
function sameIdentity(a, b, sid) {
  return Boolean(
    a &&
      b &&
      a.pid === b.pid &&
      a.startedAt === b.startedAt &&
      a.executablePath === b.executablePath &&
      a.ownerSid === sid &&
      b.ownerSid === sid,
  )
}

export function createWindowsServiceManager({
  runtimeHome,
  controllerPath = fileURLToPath(
    new URL('./feishu-task-agent-controller.mjs', import.meta.url),
  ),
  workerPath = fileURLToPath(
    new URL('./windows-service-worker.mjs', import.meta.url),
  ),
  environment = process.env,
  currentSid: getSid = currentSid,
  scheduler = nativeScheduler,
  readIdentity = async (pid) =>
    (await platform()).readWindowsProcessIdentity(pid),
  ensurePrivateDirectory = async (dir) =>
    (await platform()).ensurePrivateWindowsDirectory(dir),
  stopTree = async (identity) =>
    (await platform()).stopOwnedWindowsTree(identity),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  startupAttempts = 600,
  stopAttempts = 100,
} = {}) {
  if (!runtimeHome) throw new Error('Windows service runtimeHome is required')
  const serviceHome = path.join(runtimeHome, 'windows-service-v1')
  const paths = {
    serviceHome,
    selectionFile: path.join(serviceHome, 'selection.json'),
    readinessFile: path.join(serviceHome, 'readiness.json'),
    ownerFile: path.join(serviceHome, 'owner.json'),
    stopFile: path.join(serviceHome, 'stop.json'),
    configFile: path.join(serviceHome, 'worker.json'),
    logFile: path.join(serviceHome, 'service.log'),
  }
  const config = async () => {
    const sid = await getSid()
    return {
      sid,
      name: `AAMP-FeishuTask-${sid}`,
      node: process.execPath,
      worker: workerPath,
      config: paths.configFile,
      directory: path.dirname(workerPath),
    }
  }
  async function writeJson(file, data) {
    await ensurePrivateDirectory(path.dirname(file))
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(data) + '\n', {
        mode: 0o600,
        flag: 'wx',
      })
      if (process.platform === 'win32')
        await (await platform()).atomicReplaceWindows(temp, file)
      else await fs.rename(temp, file)
    } finally {
      await fs.rm(temp, { force: true })
    }
  }
  async function status() {
    const c = await config()
    const task = await scheduler('status', c)
    if (task.ownerSid && task.ownerSid !== c.sid)
      throw new Error('Windows task identity mismatch')
    const base = {
      loaded: Boolean(task.loaded),
      state: 'stopped',
      pid: null,
      ready: false,
    }
    if (!task.loaded) return base
    base.state = 'starting'
    const selected = await readJson(paths.selectionFile),
      owner = await readJson(paths.ownerFile),
      ready = await readJson(paths.readinessFile)
    if (!selected?.generation || owner?.generation !== selected.generation)
      return base
    const worker = owner.worker && (await readIdentity(owner.worker.pid))
    const controller =
      owner.controller && (await readIdentity(owner.controller.pid))
    if (
      !sameIdentity(worker, owner.worker, c.sid) ||
      !sameIdentity(controller, owner.controller, c.sid)
    )
      return { ...base, state: 'stopped' }
    base.pid = controller.pid
    if (
      ready?.version === 1 &&
      ready.state === 'ready' &&
      ready.generation === selected.generation &&
      ready.pid === controller.pid &&
      sameIds(ready.binding_ids, selected.binding_ids)
    )
      return { ...base, state: 'running', ready: true }
    return base
  }
  async function selectionSnapshot() {
    const p = await readJson(paths.selectionFile)
    return {
      generation: p?.generation || '',
      bindingIds: Array.isArray(p?.binding_ids) ? p.binding_ids : [],
    }
  }
  const selection = async () => (await selectionSnapshot()).bindingIds
  async function markReady(bindingIds, generation) {
    const selected = await selectionSnapshot()
    if (
      !generation ||
      generation !== selected.generation ||
      !sameIds(bindingIds, selected.bindingIds)
    )
      throw new Error('后台服务启动代次或绑定已变化')
    await writeJson(paths.readinessFile, {
      version: 1,
      state: 'ready',
      generation,
      pid: process.pid,
      binding_ids: bindingIds,
    })
  }
  async function stopUnlocked() {
    const c = await config()
    const task = await scheduler('status', c)
    await scheduler('disable', c)
    const selected = await selectionSnapshot()
    let owner = await readJson(paths.ownerFile)
    await writeJson(paths.stopFile, { generation: selected.generation })
    // A scheduled worker may not have published owner.json yet. Do not report a successful stop during that gap.
    const acknowledged = async () =>
      owner?.generation === selected.generation &&
      owner.worker &&
      sameIdentity(await readIdentity(owner.worker.pid), owner.worker, c.sid)
    for (let i = 0; !(await acknowledged()) && i < stopAttempts; i++) {
      const state = await scheduler('status', c)
      if (String(state.state).toLowerCase() !== 'running') break
      await wait(100)
      owner = await readJson(paths.ownerFile)
    }
    if (!(await acknowledged())) {
      const state = await scheduler('status', c)
      if (String(state.state).toLowerCase() === 'running')
        throw new Error(
          'Windows worker has not acknowledged stop; retry before updating',
        )
    }
    if (owner?.generation === selected.generation) {
      for (let i = 0; i < stopAttempts; i++) {
        if (!owner.controller || !(await readIdentity(owner.controller.pid)))
          break
        await wait(100)
      }
      for (const recorded of [owner.controller, owner.worker]) {
        if (!recorded) continue
        const live = await readIdentity(recorded.pid)
        if (!live) continue
        if (!sameIdentity(live, recorded, c.sid))
          throw new Error('Refusing to stop a changed Windows process identity')
        await stopTree(recorded)
      }
    }
    let after = await scheduler('status', c)
    for (
      let i = 0;
      String(after.state).toLowerCase() === 'running' && i < stopAttempts;
      i++
    ) {
      await wait(100)
      after = await scheduler('status', c)
    }
    if (String(after.state).toLowerCase() === 'running')
      throw new Error(
        'Windows worker has not acknowledged stop; retry before updating',
      )
    await fs.rm(paths.readinessFile, { force: true })
    return { stopped: true, wasLoaded: Boolean(task.loaded) }
  }
  async function startUnlocked(bindingIds = [], { stopped = false } = {}) {
    const ids = [...new Set(bindingIds.map(String).filter(Boolean))]
    if (!ids.length) throw new Error('No selected bindings')
    if (workerPath.split(/[\\/]/).includes('_npx'))
      throw new Error(
        '请先 npm.cmd install --global 安装稳定版本，再启动后台服务',
      )
    const current = await status()
    const selected = await selectionSnapshot()
    if (current.ready && sameIds(ids, selected.bindingIds))
      return { ...current, alreadyRunning: true }
    if (!stopped && (current.loaded || (await readJson(paths.ownerFile))))
      await stopUnlocked()
    const generation = randomUUID()
    const env = {}
    for (const [key, value] of Object.entries(environment)) {
      if (
        /^(AAMP_|LARKSUITE_CLI_CONFIG_DIR$|CODEX_PATH$|NODE_EXTRA_CA_CERTS$|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$|PATH$|SYSTEMROOT$|COMSPEC$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$)/i.test(
          key,
        )
      )
        env[key] = value
    }
    env.AAMP_TASK_NON_INTERACTIVE = 'true'
    env.AAMP_TASK_RUNTIME_HOME = runtimeHome
    await writeJson(paths.selectionFile, {
      version: 1,
      generation,
      binding_ids: ids,
    })
    await writeJson(paths.configFile, {
      version: 1,
      generation,
      controllerPath,
      paths,
      env,
    })
    await fs.rm(paths.readinessFile, { force: true })
    await fs.rm(paths.stopFile, { force: true })
    await scheduler('start', await config())
    for (let i = 0; i < startupAttempts; i++) {
      const s = await status()
      if (s.ready) return { ...s, alreadyRunning: false }
      await wait(500)
    }
    throw new Error('后台进程尚未就绪，请执行 logs 查看原因')
  }
  async function recentLogs(count = 100) {
    try {
      return (await fs.readFile(paths.logFile, 'utf8'))
        .trimEnd()
        .split(/\r?\n/)
        .slice(-Math.max(1, Math.min(1000, count)))
        .join('\n')
    } catch (e) {
      if (e.code === 'ENOENT') return ''
      throw e
    }
  }
  const locked = (operation) =>
    withWindowsOperationLock(
      path.join(serviceHome, '.lifecycle.lock'),
      operation,
    )
  return {
    paths,
    status,
    markReady,
    selection,
    selectionSnapshot,
    recentLogs,
    start: (ids) => locked(() => startUnlocked(ids)),
    stop: () => locked(stopUnlocked),
    restart: (ids, {beforeStart} = {}) =>
      locked(async () => {
        const next = ids || (await selection())
        await stopUnlocked()
        if (beforeStart) await beforeStart()
        return startUnlocked(next, { stopped: true })
      }),
  }
}

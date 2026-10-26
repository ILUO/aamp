import path from 'node:path'

const platform = () => import('./windows-platform.mjs')
const normalized = value => path.win32.normalize(value).toLowerCase()
const samePath = (a,b) => typeof a==='string' && typeof b==='string' && normalized(a)===normalized(b)
const inside = (root,value) => typeof value==='string' && path.win32.isAbsolute(value)
  && normalized(value).startsWith(normalized(root).replace(/\\+$/,'')+'\\')
const sameIdentity = (a,b) => a.pid===b.pid && a.startedAt===b.startedAt
  && samePath(a.executablePath,b.executablePath) && a.ownerSid.toLowerCase()===b.ownerSid.toLowerCase()

// Match executable arguments, not arbitrary command-line substrings. A Bridge
// must point to this runtime, including when its executable lives in npm cache.
function ownedRoot(p,scope) {
  const args=p.argv
  const script=args[1]
  if (samePath(script,scope.workerPath)) return samePath(args[2],path.win32.join(scope.runtimeHome,'windows-service-v1','worker.json'))
  // A controller has no runtime argument; require a recorded identity or an owned worker parent.
  const bridgeEntry=[script].find(arg=>typeof arg==='string' && /(?:^|[\\/])(?:@[^\\/]+[\\/])?aamp-(?:acp|feishu)-bridge(?:[\\/]|\.(?:mjs|js|cmd)$)/i.test(arg))
  const config=args.indexOf('--config')
  return Boolean(/(?:^|[\\/])node(?:\.exe)?$/i.test(p.executablePath) && bridgeEntry && config>=0 && inside(scope.runtimeHome,args[config+1]))
}

export function classifyWindowsRecoveryProcesses(processes,scope) {
  if(!Array.isArray(processes))throw new Error('Windows recovery process scan is incomplete')
  const selected=new Map(),byPid=new Map()
  for(const p of processes) {
    if(!Number.isSafeInteger(p.pid) || !Number.isSafeInteger(p.parentPid)
      || !Number.isFinite(Date.parse(p.startedAt)) || !p.executablePath || !p.ownerSid || !Array.isArray(p.argv)
      || p.argv.some(arg=>typeof arg!=='string'))throw new Error('Windows recovery process identity is incomplete')
    if(p.ownerSid.toLowerCase()!==scope.sid.toLowerCase())throw new Error('Windows recovery scan returned another user')
    if(byPid.has(p.pid))throw new Error('Windows recovery scan contains duplicate process identities')
    byPid.set(p.pid,p)
    if(ownedRoot(p,scope) || (scope.recorded || []).some(identity=>sameIdentity(p,identity)))selected.set(p.pid,p)
  }
  let changed
  do {
    changed=false
    for(const p of processes) {
      const parent=selected.get(p.parentPid)
      if(!selected.has(p.pid) && parent && Date.parse(p.startedAt)>=Date.parse(parent.startedAt)) {
        selected.set(p.pid,p);changed=true
      }
    }
  } while(changed)
  // Never terminate this CLI or an agent/terminal hosting the caller.
  const protectedProcesses=new Set()
  for(const pid of scope.protectedPids || []) {
    let p=byPid.get(pid);const seen=new Set()
    while(p && !seen.has(p.pid)) {
      if(selected.has(p.pid))throw new Error('Refusing to clean the current recovery session')
      seen.add(p.pid);protectedProcesses.add(p.pid);const parent=byPid.get(p.parentPid)
      p=parent && Date.parse(parent.startedAt)<=Date.parse(p.startedAt)?parent:undefined
    }
  }
  for(const p of processes) {
    if(selected.has(p.pid) || protectedProcesses.has(p.pid))continue
    const mentionsRuntime=p.argv.some(arg=>inside(scope.runtimeHome,arg))
    const acp=p.argv.some(arg=>arg==='--acp' || arg==='acp')
    const controller=samePath(p.argv[1],scope.controllerPath) && p.argv[2]==='__service-run'
    if(mentionsRuntime || acp || controller)throw new Error(`Cannot establish ownership of a possible AAMP process (${p.pid})`)
  }
  return [...selected.values()]
}

export async function recoverStaleWindowsProcesses(scope, {
  scan=options=>platform().then(p=>p.scanWindowsRecoveryProcesses(scope.sid,{...options,recorded:scope.recorded})),
  stop=(identity,options)=>platform().then(p=>p.stopOwnedWindowsTree(identity,options)),
  validate=async()=>{},signal,timeoutMs=30000,
  elevate=options=>import('./windows-recovery-elevation.mjs').then(m=>m.openWindowsRecoverySession(options)),
  onProgress=()=>{},
}={}) {
  const options={signal,timeoutMs,allowExitedIdentity:true}
  const attempt=async(scan,stop)=>{
  signal?.throwIfAborted()
  await validate()
  const candidates=classifyWindowsRecoveryProcesses(await scan(options),scope)
  await validate()
  // All descendants were captured before stopping parents. Recheck each identity
  // through the existing stop implementation, including already-exited/PID-reused cases.
  for(const identity of candidates) {
    signal?.throwIfAborted()
    await stop(identity,options)
  }
  await validate()
  const remaining=classifyWindowsRecoveryProcesses(await scan(options),{...scope,recorded:[...(scope.recorded || []),...candidates]})
  if(remaining.length)throw new Error('Windows stale background processes remain after cleanup')
  await validate()
  return {cleaned:candidates.map(({pid,startedAt,executablePath,ownerSid})=>({pid,startedAt,executablePath,ownerSid}))}
  }
  try {return await attempt(scan,stop)} catch(error) {
    const denied=/0x80041003|0x80070005|Access.*denied|拒绝访问|owner SID; return value [23]/i.test(String(error.message))
    if(!denied || !scope.allowPermissionRepair || signal?.aborted)throw error
    onProgress('旧后台清理权限不足，正在请求一次管理员授权...')
    const session=await elevate({sid:scope.sid,signal,timeoutMs})
    try {
      return await attempt(options=>platform().then(p=>p.scanWindowsRecoveryProcesses(scope.sid,{...options,runPowerShell:()=>session.request('scan',scope.recorded)})),
        identity=>session.request('stop',identity))
    } finally {session.dispose()}
  }
}

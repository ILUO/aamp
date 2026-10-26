import assert from 'node:assert/strict'
import {test} from 'node:test'
import {recoverStaleWindowsProcesses} from '../bin/windows-stale-recovery.mjs'

const scope={sid:'S-1-5-21-1',runtimeHome:'C:\\Users\\u\\.aamp\\feishu-task-agent\\runtime-v1',controllerPath:'C:\\npm\\bin\\feishu-task-agent-controller.mjs',workerPath:'C:\\npm\\bin\\windows-service-worker.mjs',protectedPids:[900]}
const proc=(pid,argv,extra={})=>({pid,parentPid:1,startedAt:'2026-10-26T01:00:00.000Z',executablePath:'C:\\node.exe',ownerSid:scope.sid,argv,...extra})

test('missing historical records recover when a complete process scan is empty',async()=>{
 let scans=0
 const result=await recoverStaleWindowsProcesses(scope,{scan:async()=>{scans++;return []},stop:async()=>assert.fail('no process'),validate:async()=>{}})
 assert.equal(scans,2);assert.deepEqual(result.cleaned,[])
})

const bridge=proc(10,['node','C:\\cache\\node_modules\\@larktask\\aamp-acp-bridge\\dist\\cli.js','start','--config',scope.runtimeHome+'\\groups\\run.json'])
test('orphaned Bridge and captured children are stopped before a clean rescan',async()=>{
 const child=proc(11,['codex','--acp'],{parentPid:10})
 let scans=0;const stopped=[]
 const result=await recoverStaleWindowsProcesses(scope,{scan:async()=>++scans===1?[bridge,child]:[],stop:async p=>stopped.push(p.pid)})
 assert.deepEqual(stopped,[10,11]);assert.equal(result.cleaned.length,2)
})
test('another runtime and unrelated Node processes are not terminated',async()=>{
 const unrelated=proc(20,['node','C:\\dev\\server.js'])
 const foreign=proc(21,['node','C:\\cache\\node_modules\\aamp-acp-bridge\\dist\\cli.js','start','--config',scope.runtimeHome+'-other\\config.json'])
 await recoverStaleWindowsProcesses(scope,{scan:async()=>[unrelated,foreign],stop:async()=>assert.fail('foreign process')})
})
test('reused PID is not sufficient proof of ownership',async()=>{
 const old=proc(20,['node','old.js'])
 const reused={...old,startedAt:'2026-10-26T02:00:00.000Z',argv:['node','C:\\dev\\server.js']}
 await recoverStaleWindowsProcesses({...scope,recorded:[old]},{scan:async()=>[reused],stop:async()=>assert.fail('reused PID')})
})
test('ambiguous orphan ACP and incomplete scans refuse success',async()=>{
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>[proc(22,['codex','--acp'])]}),/Cannot establish ownership/)
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>[{pid:1}]}),/incomplete/)
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>{throw new Error('CIM denied')}}),/CIM denied/)
})
test('current recovery session or its ancestor cannot be terminated',async()=>{
 const caller=proc(900,['node','cli.js'],{parentPid:10})
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>[bridge,caller],stop:async()=>assert.fail('caller')}),/current recovery session/)
})
test('changed service state and new residual processes prevent success',async()=>{
 let validations=0
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>[],validate:async()=>{if(++validations===2)throw new Error('generation changed')}}),/generation changed/)
 await assert.rejects(recoverStaleWindowsProcesses(scope,{scan:async()=>[bridge],stop:async()=>{}}),/remain after cleanup/)
})
test('worker matches the exact runtime configuration and brings its controller into scope',async()=>{
 const worker=proc(30,['node',scope.workerPath,scope.runtimeHome+'\\windows-service-v1\\worker.json'])
 const controller=proc(31,['node',scope.controllerPath,'__service-run'],{parentPid:30})
 let scans=0;const killed=[]
 await recoverStaleWindowsProcesses(scope,{scan:async()=>++scans===1?[worker,controller]:[],stop:async p=>killed.push(p.pid)})
 assert.deepEqual(killed,[30,31])
})

test('one elevation session retries denied scan and is always disposed',async()=>{
 let opened=0,disposed=0,requests=0
 await recoverStaleWindowsProcesses({...scope,allowPermissionRepair:true},{
  scan:async()=>{throw new Error('Get-CimInstance Access is denied 0x80041003')},
  elevate:async({sid})=>{assert.equal(sid,scope.sid);opened++;return {request:async operation=>{assert.equal(operation,'scan');requests++;return {processes:[]}},dispose:()=>{disposed++}}},
 })
 assert.equal(opened,1);assert.equal(disposed,1);assert.equal(requests,2)
})
test('noninteractive recovery and cancelled elevation cannot report success',async()=>{
 let opened=0
 const operations={scan:async()=>{throw new Error('Access is denied')},elevate:async()=>{opened++;throw new Error('UAC cancelled')}}
 await assert.rejects(recoverStaleWindowsProcesses(scope,operations),/denied/);assert.equal(opened,0)
 await assert.rejects(recoverStaleWindowsProcesses({...scope,allowPermissionRepair:true},operations),/cancelled/);assert.equal(opened,1)
})

test('native stale recovery discovers and cleans an unjournaled Bridge, preserving unrelated Node', {skip:process.platform!=='win32',timeout:120000},async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path')
 const {spawn}=await import('node:child_process')
 const {getCurrentWindowsSid,readWindowsProcessIdentity}=await import('../bin/windows-platform.mjs')
 const sid=await getCurrentWindowsSid()
 assert.ok(await readWindowsProcessIdentity(process.pid))
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-stale-native-'))
 const runtimeHome=path.join(root,'runtime'),entry=path.join(root,'node_modules','aamp-acp-bridge','dist','cli.js')
 await fs.mkdir(path.dirname(entry),{recursive:true});await fs.mkdir(runtimeHome)
 await fs.writeFile(entry,'setInterval(()=>{},1000)')
 const bridge=spawn(process.execPath,[entry,'start','--config',path.join(runtimeHome,'config.json')],{stdio:'ignore',windowsHide:true})
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true})
 t.after(async()=>{for(const child of [bridge,unrelated])if(child.exitCode===null)child.kill();await fs.rm(root,{recursive:true,force:true})})
 const result=await recoverStaleWindowsProcesses({sid,runtimeHome,controllerPath:'C:\\unused\\feishu-task-agent-controller.mjs',workerPath:'C:\\unused\\windows-service-worker.mjs',protectedPids:[process.pid]},{timeoutMs:45000})
 assert.ok(result.cleaned.some(p=>p.pid===bridge.pid))
 assert.equal(await readWindowsProcessIdentity(bridge.pid),undefined)
 assert.ok(await readWindowsProcessIdentity(unrelated.pid))
})

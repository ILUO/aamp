import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mod=await import('../bin/windows-service.mjs').catch(()=>({}));

test('native scheduler does not modify a task that is already disabled', {skip:process.platform!=='win32'}, async()=>{
 const {runWindowsPowerShell}=await import('../bin/windows-platform.mjs');
 const fixture=String.raw`
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Get-ScheduledTask { return [pscustomobject]@{Principal=[pscustomobject]@{UserId=$sid};State='Disabled'} }
function Disable-ScheduledTask { throw 'Access is denied: a redundant write was attempted' }
$env:AAMP_SCHEDULER_INPUT=@{operation='disable';name='in-memory-fixture';sid=$sid} | ConvertTo-Json -Compress
`;
 const result=await runWindowsPowerShell(fixture+mod.__test.schedulerScript+'\n@{ok=$true}|ConvertTo-Json -Compress',{});
 assert.equal(result.ok,true);
});

test('legacy task permission repair is limited to one retry and interactive mutations',async()=>{
 const denied=()=>Object.assign(new Error('denied'),{stderr:'HRESULT 0x80070005'});
 const config={name:'fixture',sid:'S-1-5-21-1',allowPermissionRepair:true};
 let calls=0,repairs=0;
 const options={execute:async()=>{if(++calls===1)throw denied();return {stdout:'{}'}},repair:async received=>{assert.equal(received,config);repairs++}};
 await mod.__test.nativeScheduler('disable',config,options);
 assert.equal(calls,2);assert.equal(repairs,1);
 calls=0;repairs=0;
 await assert.rejects(mod.__test.nativeScheduler('start',{...config,allowPermissionRepair:false},options),/交互终端/);
 assert.equal(repairs,0);
 calls=0;
 await assert.rejects(mod.__test.nativeScheduler('status',config,options),/denied/);
 assert.equal(repairs,0);
 calls=0;
 await assert.rejects(mod.__test.nativeScheduler('start',config,{...options,execute:async()=>{calls++;throw denied()}}),/修复后操作仍失败/);
 assert.equal(calls,2);assert.equal(repairs,1);
});

test('cancelled UAC repair does not retry the scheduled task operation',async()=>{
 let calls=0;
 await assert.rejects(mod.__test.nativeScheduler('start',{allowPermissionRepair:true},{execute:async()=>{calls++;throw Object.assign(new Error('denied'),{stderr:'0x80070005'})},repair:async()=>{throw new Error('已取消权限修复')}}),/已取消/);
 assert.equal(calls,1);
});

test('native ACL repair accepts existing full control in Windows PowerShell 5', {skip:process.platform!=='win32'},async()=>{
 const {runWindowsPowerShell}=await import('../bin/windows-platform.mjs');
 const fixture=String.raw`
$script:fixtureSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Get-ScheduledTask { return [pscustomobject]@{Principal=[pscustomobject]@{UserId=$script:fixtureSid};State='Ready'} }
function New-Object {
  param($ComObject)
  $registered=[pscustomobject]@{Definition=[pscustomobject]@{Principal=[pscustomobject]@{UserId=$script:fixtureSid;RunLevel=0;LogonType=3}}}
  $registered|Add-Member ScriptMethod GetSecurityDescriptor {param($flags);return ('D:(A;;FA;;;'+$script:fixtureSid+')')}
  $registered|Add-Member ScriptMethod SetSecurityDescriptor {throw 'should not rewrite existing full control'}
  $script:fixtureRegistered=$registered
  $folder=[pscustomobject]@{}
  $folder|Add-Member ScriptMethod GetTask {param($name);return $script:fixtureRegistered}
  $script:fixtureFolder=$folder
  $service=[pscustomobject]@{}
  $service|Add-Member ScriptMethod Connect {}
  $service|Add-Member ScriptMethod GetFolder {param($name);return $script:fixtureFolder}
  return $service
}
$env:AAMP_SCHEDULER_INPUT=@{operation='repair-permissions';name=('AAMP-FeishuTask-'+$script:fixtureSid);sid=$script:fixtureSid}|ConvertTo-Json -Compress
`;
 const result=await runWindowsPowerShell(fixture+mod.__test.schedulerScript+'\n@{ok=$true}|ConvertTo-Json -Compress',{});
 assert.equal(result.ok,true);
});

test('startup reports current worker terminal failure without waiting for readiness timeout', async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-service-failed-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let waits=0;
 const manager=mod.createWindowsServiceManager({runtimeHome:root,controllerPath:'controller',workerPath:'worker',currentSid:async()=>'S-1-5-21-1',ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),
 scheduler:async action=>{
   if(action==='start') {
     const config=JSON.parse(await fs.readFile(manager.paths.configFile,'utf8'));
     await fs.writeFile(path.join(manager.paths.serviceHome,'worker-state.json'),JSON.stringify({version:1,generation:config.generation,state:'failed',errorCode:'EACCES'}));
   }
   return {loaded:false,state:'Ready',ownerSid:'S-1-5-21-1'};
 },wait:async()=>{waits++},startupAttempts:3});
 await assert.rejects(manager.start(['b1']),/后台启动失败.*EACCES/);
 assert.equal(waits,0);
});
async function fixture(t, overrides={}) {
  assert.equal(typeof mod.createWindowsServiceManager,'function');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-service-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const identities=new Map([[101,{pid:101,startedAt:'2026-09-07T00:00:00.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath,command:'node worker'}],[102,{pid:102,startedAt:'2026-09-07T00:00:01.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath,command:'node controller'}]]);
  const calls=[];
  const manager=mod.createWindowsServiceManager({runtimeHome:root,controllerPath:'controller',workerPath:'worker',currentSid:async()=>'S-1-5-21-1',readIdentity:async pid=>identities.get(pid),ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),scheduler:async action=>{calls.push(action);return {loaded:true,state:identities.size ? 'Running' : 'Ready',ownerSid:'S-1-5-21-1'};},stopTree:async identity=>{identities.delete(identity.pid);},wait:async()=>{},stopAttempts:1,startupAttempts:1,...overrides});
  await fs.mkdir(manager.paths.serviceHome,{recursive:true});
  await fs.writeFile(manager.paths.selectionFile,JSON.stringify({version:1,generation:'g1',binding_ids:['b1']}));
  await fs.writeFile(manager.paths.ownerFile,JSON.stringify({generation:'g1',worker:identities.get(101),controller:identities.get(102)}));
  await fs.writeFile(path.join(manager.paths.serviceHome,'cleanup-result.json'),JSON.stringify({generation:'g1',pid:102,ok:true}));
  return {manager,identities,calls};
}
test('Windows scheduler running is not ready without matching controller readiness',async t=>{
 const {manager}=await fixture(t);
 assert.equal((await manager.status()).ready,false);
 await fs.writeFile(manager.paths.readinessFile,JSON.stringify({version:1,generation:'old',pid:102,binding_ids:['b1'],state:'ready'}));
 assert.equal((await manager.status()).ready,false);
 await fs.writeFile(manager.paths.readinessFile,JSON.stringify({version:1,generation:'g1',pid:102,binding_ids:['b1'],state:'ready'}));
 assert.equal((await manager.status()).ready,true);
});
test('Windows status rejects reused PID even if saved readiness matches',async t=>{
 const {manager,identities}=await fixture(t);
 await fs.writeFile(manager.paths.readinessFile,JSON.stringify({version:1,generation:'g1',pid:102,binding_ids:['b1'],state:'ready'}));
 identities.set(102,{...identities.get(102),startedAt:'2026-09-07T01:00:00.000Z'});
 assert.equal((await manager.status()).ready,false);
});
test('Windows stop disables login before requesting and terminating only owned processes',async t=>{
 const {manager,calls}=await fixture(t);
 await manager.stop();
 assert.equal(calls[0],'status');
 assert.equal(calls[1],'disable');
 assert.deepEqual(JSON.parse(await fs.readFile(manager.paths.stopFile,'utf8')),{generation:'g1'});
});
test('Windows start refuses an empty selection without launching a task',async t=>{
 const {manager,calls}=await fixture(t);
 await assert.rejects(manager.start([]),/No selected bindings/);
 assert.deepEqual(calls,[]);
});
test('Windows stop cannot report success while a starting worker has not published its identity',async t=>{
 const {manager}=await fixture(t);
 await fs.rm(manager.paths.ownerFile);
 await assert.rejects(manager.stop(),/后台进程尚未确认停止/);
});

test('Windows stop waits for a restarted worker even when a stale owner has the same generation',async t=>{
 const {manager,identities}=await fixture(t);
 identities.delete(101);identities.delete(102);
 identities.set(103,{pid:103,startedAt:'2026-09-07T02:00:00.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath});
 await assert.rejects(manager.stop(),/后台进程尚未确认停止/);
 assert.equal(identities.has(103),true);
});


test('independent service managers serialize entire stop transactions', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-lifecycle-lock-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const events=[]
  const make = name => mod.createWindowsServiceManager({
    runtimeHome:root,currentSid:async()=>'S-1-5-21-1',ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),
    scheduler:async action=>{
      if(action==='disable') {events.push(name+' begin');await new Promise(resolve=>setTimeout(resolve,80));events.push(name+' end')}
      return {loaded:false,state:'Ready',ownerSid:'S-1-5-21-1'}
    },stopAttempts:0,
  })
  await Promise.all([make('a').stop(),make('b').stop()])
  assert.equal(events.length,4)
  assert.equal(events[0].split(' ')[0],events[1].split(' ')[0])
  assert.equal(events[2].split(' ')[0],events[3].split(' ')[0])
})


test('native scheduler resolves SID and account-name principals and rejects unknown or foreign owners', {skip:process.platform !== 'win32' && 'requires native Windows account translation'}, async () => {
  const {execFile}=await import('node:child_process')
  const {promisify}=await import('node:util')
  const execute=promisify(execFile)
  // Shadow only the read cmdlet with an in-memory task. The production status
  // script performs the real Windows SID/NTAccount translation; no task is mutated.
  const fixture=String.raw`
$current=[System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid=$current.User.Value
switch ($env:AAMP_PRINCIPAL_FIXTURE_KIND) {
 'sid' { $principal=$sid }
 'name' { $principal=$current.Name }
 'short' { $principal=($current.Name -split '\\')[-1] }
 'foreign' { $principal='S-1-5-7'; if ($sid -eq $principal) { $principal='S-1-5-18' } }
 'unknown' { $principal='AAMP-unknown-account-'+[guid]::NewGuid().ToString('N') }
}
$script:fixtureTask=[pscustomobject]@{Principal=[pscustomobject]@{UserId=$principal};State='Ready'}
function Get-ScheduledTask { return $script:fixtureTask }
$env:AAMP_SCHEDULER_INPUT=@{operation='status';name='in-memory-fixture';sid=$sid} | ConvertTo-Json -Compress
`
  const run=kind=>execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',fixture+mod.__test.schedulerScript],{env:{...process.env,AAMP_PRINCIPAL_FIXTURE_KIND:kind},encoding:'utf8',timeout:10000})
  const direct=JSON.parse((await run('sid')).stdout.replace(/^\uFEFF/,''))
  assert.match(direct.ownerSid,/^S-1-/)
  assert.equal(direct.loaded,true)
  for (const kind of ['name','short']) assert.deepEqual(JSON.parse((await run(kind)).stdout.replace(/^\uFEFF/,'')),direct)
  await assert.rejects(run('foreign'),/Scheduled task belongs to another identity/)
  await assert.rejects(run('unknown'),/Cannot verify scheduled task principal SID/)
})

test('background config preserves explicit preparation policies and proxies but excludes unrelated secrets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-service-env-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const expected={FEISHU_USER_AUTH_MODE:'disabled',FEISHU_USER_AUTH_REQUESTED_SCOPES:'task:task:read',FEISHU_APP_SCOPES_TENANT:'task:task:read',LARK_CLI_MIN_VERSION:'1.2.3',LARK_REGISTER_APP_SDK:'@larksuiteoapi/node-sdk@1.2.3',NPM_REGISTRY:'https://registry.example.test',npm_config_cache:'cache',HTTPS_PROXY:'http://proxy.example.test:8080',CODEX_AUTO_UPDATE:'false'}
  const progress=[]
  const manager=mod.createWindowsServiceManager({runtimeHome:root,controllerPath:'controller',workerPath:'worker',onProgress:message=>progress.push(message),environment:{...expected,UNRELATED_SECRET:'sentinel'},currentSid:async()=>'S-1-5-21-1',ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),scheduler:async()=>({loaded:false,state:'Ready',ownerSid:'S-1-5-21-1'}),startupAttempts:0,stopAttempts:0})
  await assert.rejects(manager.start(['selected-binding']))
  const config=JSON.parse(await fs.readFile(manager.paths.configFile,'utf8'))
  for(const [key,value] of Object.entries(expected))assert.equal(config.env[key],value,key)
  assert.equal(config.env.AAMP_TASK_NON_INTERACTIVE,'true')
  assert.equal(config.env.NPM_GLOBAL_PREFIX,path.join(os.homedir(),'.aamp','feishu-task-agent','npm-global'))
  assert.equal(config.env.UNRELATED_SECRET,undefined)
  assert.equal(config.env.AAMP_TASK_AIME_ACP_HOME,path.join(os.homedir(),'.aamp','feishu-task-agent','aime-acp'))
  assert.equal(config.env.AAMP_TASK_CODEX_ACP_HOME,path.join(os.homedir(),'.aamp','feishu-task-agent','codex-acp'))
  assert.ok(progress.some(message=>message.includes('后台任务')))
  assert.ok(progress.some(message=>message.includes('等待智能体')))
})

test('stop refuses success when controller reports incomplete cleanup',async t=>{
 const {manager}=await fixture(t)
 await fs.writeFile(path.join(manager.paths.serviceHome,'cleanup-result.json'),JSON.stringify({generation:'g1',pid:102,ok:false}))
 await assert.rejects(manager.stop(),/停止未完成/)
})

test('outer stop deadline cancels a stuck identity query',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-stop-deadline-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 let cancelled=false
 const manager=mod.createWindowsServiceManager({runtimeHome:root,currentSid:async()=>'S-1-5-21-1',ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),
 scheduler:async()=>({loaded:true,state:'Running'}),stopTimeoutMs:30,
 readIdentity:async(pid,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason)},{once:true}))})
 await fs.mkdir(manager.paths.serviceHome,{recursive:true})
 await fs.writeFile(manager.paths.selectionFile,JSON.stringify({generation:'g'}))
 await fs.writeFile(manager.paths.ownerFile,JSON.stringify({generation:'g',worker:{pid:10}}))
 await assert.rejects(manager.stop(),/停止未完成/);assert.equal(cancelled,true)
})

test('stop refuses success without acknowledgement or recoverable journal',async t=>{
 const {manager}=await fixture(t)
 await fs.rm(path.join(manager.paths.serviceHome,'cleanup-result.json'))
 await assert.rejects(manager.stop(),/缺少控制器清理确认/)
})

test('legacy journal recovery remains stoppable on a second call',async t=>{
 const {manager,identities}=await fixture(t)
 await fs.rm(path.join(manager.paths.serviceHome,'cleanup-result.json'))
 const {createWindowsProcessJournal}=await import('../bin/windows-process-journal.mjs')
 const journal=await createWindowsProcessJournal(path.join(path.dirname(manager.paths.serviceHome),'windows-process-journals-v1'),identities.get(102),{ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),atomicReplace:fs.rename})
 await journal.record([identities.get(101)])
 await manager.stop()
 await manager.stop()
})

test('cooperative stop reserves time for verified forced cleanup',async t=>{
 let polls=0
 const {manager}=await fixture(t,{stopAttempts:100,stopGraceMs:0,wait:async()=>{polls++}})
 await manager.stop()
 assert.equal(polls,0)
})

test('stop accepts cleanup already completed by startup recovery',async t=>{
 const {manager,identities}=await fixture(t)
 const controller=identities.get(102)
 const directory=path.join(path.dirname(manager.paths.serviceHome),'windows-process-journals-v1')
 const {createWindowsProcessJournal,recoverWindowsProcessJournals}=await import('../bin/windows-process-journal.mjs')
 const journal=await createWindowsProcessJournal(directory,controller,{ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),atomicReplace:fs.rename})
 await journal.record([identities.get(101)])
 await fs.rm(path.join(manager.paths.serviceHome,'cleanup-result.json'))
 identities.clear()
 await recoverWindowsProcessJournals(directory,{readIdentity:async()=>undefined,stopTree:async()=>{}})
 await manager.stop()
 await manager.stop()
 const result=JSON.parse(await fs.readFile(path.join(manager.paths.serviceHome,'cleanup-result.json')))
 assert.deepEqual(result,{generation:'g1',pid:102,ok:true})
})

test('stale owner cannot use a different restart controller recovery receipt',async t=>{
 const {manager,identities}=await fixture(t)
 const unrelated={...identities.get(102),pid:38812,startedAt:'2026-10-23T07:20:40.614Z'}
 const directory=path.join(path.dirname(manager.paths.serviceHome),'windows-process-journals-v1')
 const {createWindowsProcessJournal,recoverWindowsProcessJournals}=await import('../bin/windows-process-journal.mjs')
 await createWindowsProcessJournal(directory,unrelated,{ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),atomicReplace:fs.rename})
 await fs.rm(path.join(manager.paths.serviceHome,'cleanup-result.json'))
 identities.clear()
 await recoverWindowsProcessJournals(directory,{readIdentity:async()=>undefined,stopTree:async()=>{}})
 await assert.rejects(manager.stop(),/缺少控制器清理确认/)
 await assert.rejects(manager.stop(),/缺少控制器清理确认/)
})

test('recovery receipt does not override explicit service cleanup failure',async t=>{
 const {manager,identities}=await fixture(t)
 const directory=path.join(path.dirname(manager.paths.serviceHome),'windows-process-journals-v1')
 const {createWindowsProcessJournal,recoverWindowsProcessJournals}=await import('../bin/windows-process-journal.mjs')
 await createWindowsProcessJournal(directory,identities.get(102),{ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),atomicReplace:fs.rename})
 identities.clear()
 await recoverWindowsProcessJournals(directory,{readIdentity:async()=>undefined,stopTree:async()=>{}})
 await fs.writeFile(path.join(manager.paths.serviceHome,'cleanup-result.json'),JSON.stringify({generation:'g1',pid:102,ok:false}))
 await assert.rejects(manager.stop(),/控制器未能清理全部进程/)
})

for(const state of ['missing','failed','stale-owner','missing-owner']) {
 test(`stop automatically reconciles ${state} history when scans prove no residual process`,async t=>{
  let disabled=false,scans=0
  const {manager,identities}=await fixture(t,{
   scheduler:async action=>{if(action==='disable')disabled=true;return {loaded:!disabled,enabled:!disabled,state:disabled?'Disabled':'Ready'}},
   scanProcesses:async()=>{scans++;return []},
  })
  identities.clear()
  const cleanup=path.join(manager.paths.serviceHome,'cleanup-result.json')
  await fs.rm(cleanup)
  if(state==='failed')await fs.writeFile(cleanup,JSON.stringify({generation:'g1',pid:102,ok:false}))
  if(state==='stale-owner') {
   const owner=JSON.parse(await fs.readFile(manager.paths.ownerFile));owner.generation='old'
   await fs.writeFile(manager.paths.ownerFile,JSON.stringify(owner))
  }
  if(state==='missing-owner')await fs.rm(manager.paths.ownerFile)
  assert.equal((await manager.stop()).stopped,true)
  assert.equal(scans,2)
  const proof=JSON.parse(await fs.readFile(path.join(manager.paths.serviceHome,'stale-recovery-result.json')))
  assert.equal(proof.method,'verified-process-scan');assert.equal(proof.generation,'g1')
  assert.ok(await fs.stat(proof.backup))
  assert.equal(await fs.stat(manager.paths.ownerFile).then(()=>true,()=>false),false)
  assert.equal((await manager.stop()).stopped,true)
 })
}

test('start continues to readiness in the same command after reconciling missing history',async t=>{
 let disabled=false,started=false,manager,identities
 const setup=await fixture(t,{
  scanProcesses:async()=>[],
  scheduler:async action=>{
   if(action==='disable')disabled=true
   if(action==='start') {
    started=true;disabled=false
    const config=JSON.parse(await fs.readFile(manager.paths.configFile))
    const worker={pid:201,startedAt:'2026-10-26T00:00:00Z',executablePath:process.execPath,ownerSid:'S-1-5-21-1'}
    const controller={...worker,pid:202}
    identities.set(201,worker);identities.set(202,controller)
    await fs.writeFile(manager.paths.ownerFile,JSON.stringify({generation:config.generation,worker,controller}))
    await fs.writeFile(manager.paths.readinessFile,JSON.stringify({version:1,state:'ready',generation:config.generation,pid:202,binding_ids:['b1']}))
   }
   return {loaded:!disabled,enabled:!disabled,state:disabled?'Disabled':started?'Running':'Ready'}
  },
 })
 manager=setup.manager;identities=setup.identities
 identities.clear();await fs.rm(path.join(manager.paths.serviceHome,'cleanup-result.json'))
 const result=await manager.start(['b1'])
 assert.equal(result.ready,true);assert.equal(result.pid,202)
 assert.deepEqual(await manager.selection(),['b1'])
})

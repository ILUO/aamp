import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mod=await import('../bin/windows-service.mjs').catch(()=>({}));
async function fixture(t) {
  assert.equal(typeof mod.createWindowsServiceManager,'function');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-service-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const identities=new Map([[101,{pid:101,startedAt:'2026-09-07T00:00:00.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath,command:'node worker'}],[102,{pid:102,startedAt:'2026-09-07T00:00:01.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath,command:'node controller'}]]);
  const calls=[];
  const manager=mod.createWindowsServiceManager({runtimeHome:root,controllerPath:'controller',workerPath:'worker',currentSid:async()=>'S-1-5-21-1',readIdentity:async pid=>identities.get(pid),ensurePrivateDirectory:dir=>fs.mkdir(dir,{recursive:true}),scheduler:async action=>{calls.push(action);return {loaded:true,state:identities.size ? 'Running' : 'Ready',ownerSid:'S-1-5-21-1'};},stopTree:async identity=>{identities.delete(identity.pid);},wait:async()=>{},stopAttempts:1,startupAttempts:1});
  await fs.mkdir(manager.paths.serviceHome,{recursive:true});
  await fs.writeFile(manager.paths.selectionFile,JSON.stringify({version:1,generation:'g1',binding_ids:['b1']}));
  await fs.writeFile(manager.paths.ownerFile,JSON.stringify({generation:'g1',worker:identities.get(101),controller:identities.get(102)}));
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
 await assert.rejects(manager.stop(),/not acknowledged stop/);
});

test('Windows stop waits for a restarted worker even when a stale owner has the same generation',async t=>{
 const {manager,identities}=await fixture(t);
 identities.delete(101);identities.delete(102);
 identities.set(103,{pid:103,startedAt:'2026-09-07T02:00:00.000Z',ownerSid:'S-1-5-21-1',executablePath:process.execPath});
 await assert.rejects(manager.stop(),/not acknowledged stop/);
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
  assert.equal(config.env.UNRELATED_SECRET,undefined)
  assert.equal(config.env.AAMP_TASK_AIME_ACP_HOME,path.join(os.homedir(),'.aamp','feishu-task-agent','aime-acp'))
  assert.equal(config.env.AAMP_TASK_CODEX_ACP_HOME,path.join(os.homedir(),'.aamp','feishu-task-agent','codex-acp'))
  assert.ok(progress.some(message=>message.includes('后台任务')))
  assert.ok(progress.some(message=>message.includes('等待智能体')))
})

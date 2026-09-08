#!/usr/bin/env node
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function runWindowsServiceWorker(config) {
  const selected=JSON.parse(await fs.readFile(config.paths.selectionFile,'utf8'));
  if(config.version!==1 || !config.generation || selected.generation!==config.generation) throw new Error('Windows service generation changed');
  const stopRequested=async()=>{try{return JSON.parse(await fs.readFile(config.paths.stopFile,'utf8')).generation===config.generation;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
  if(await stopRequested()) return 0;
  const {readWindowsProcessIdentity,ensurePrivateWindowsDirectory,stopOwnedWindowsTree,atomicReplaceWindows}=await import('./windows-platform.mjs');
  await ensurePrivateWindowsDirectory(config.paths.serviceHome);
  const log=await fs.open(config.paths.logFile,'a',0o600);
  let child,controllerIdentity;
  try {
    const self=await readWindowsProcessIdentity(process.pid);
    if(!self) throw new Error('Cannot identify Windows service worker');
    if(await stopRequested()) return 0;
    child=spawn(process.execPath,[config.controllerPath,'__service-run'],{
      env:{...process.env,...config.env,AAMP_TASK_NON_INTERACTIVE:'true',AAMP_WINDOWS_SERVICE_GENERATION:config.generation,AAMP_WINDOWS_SERVICE_STOP_FILE:config.paths.stopFile},
      stdio:['ignore',log.fd,log.fd],shell:false,windowsHide:true,
    });
    const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code ?? 1));});
    // Attach rejection handling before awaiting CIM so immediate spawn failure cannot escape.
    closed.catch(()=>{});
    controllerIdentity=child.pid ? await readWindowsProcessIdentity(child.pid) : undefined;
    if(!controllerIdentity) {return await closed;}
    const temporary=`${config.paths.ownerFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary,JSON.stringify({generation:config.generation,worker:self,controller:controllerIdentity})+'\n',{mode:0o600});
    await atomicReplaceWindows(temporary,config.paths.ownerFile);
    const code=await closed;
    const stop=await fs.readFile(config.paths.stopFile,'utf8').then(JSON.parse).catch(()=>undefined);
    return stop?.generation===config.generation ? 0 : code;
  } catch(error) {
    if(controllerIdentity) await stopOwnedWindowsTree(controllerIdentity).catch(()=>{});
    throw error;
  } finally {await log.close();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
    process.exitCode=await runWindowsServiceWorker(config);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}

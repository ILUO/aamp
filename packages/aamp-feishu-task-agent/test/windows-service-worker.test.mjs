import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const worker=await import('../bin/windows-service-worker.mjs').catch(()=>({}));
test('worker refuses a stale configuration before spawning a controller',async t=>{
 assert.equal(typeof worker.runWindowsServiceWorker,'function');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-worker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const selectionFile=path.join(root,'selection.json');await fs.writeFile(selectionFile,JSON.stringify({generation:'new'}));
 await assert.rejects(worker.runWindowsServiceWorker({version:1,generation:'old',paths:{selectionFile}}),/generation|代次/);
});

test('worker respects a stop request before loading platform primitives or spawning',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-stopped-worker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const selectionFile=path.join(root,'selection.json'),stopFile=path.join(root,'stop.json');
 await fs.writeFile(selectionFile,JSON.stringify({generation:'g1'}));await fs.writeFile(stopFile,JSON.stringify({generation:'g1'}));
 assert.equal(await worker.runWindowsServiceWorker({version:1,generation:'g1',paths:{selectionFile,stopFile}}),0);
});

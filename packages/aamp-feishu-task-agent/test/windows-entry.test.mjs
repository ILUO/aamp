import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const moduleUrl = new URL('../bootstrap/windows-entry.mjs', import.meta.url);
const entry = await import(moduleUrl).catch(() => ({}));
test('Windows CLI maps foreground and agent options without accepting unknown arguments', () => {
  assert.equal(typeof entry.parseWindowsArguments, 'function');
  assert.deepEqual(entry.parseWindowsArguments(['start','--foreground','--agent','codex','--aamp-host','https://meshmail.ai']), {
    command:'start', foreground:true, agent:'codex', host:'https://meshmail.ai', debug:false,
  });
  assert.throws(() => entry.parseWindowsArguments(['start','--agent']), /value/);
  assert.throws(() => entry.parseWindowsArguments(['start','--unknown']), /unknown/);
  assert.equal(entry.parseWindowsArguments([]).command, 'help');
});
test('Windows help needs no terminal and creates no runtime state', () => {
  const home=mkdtempSync(path.join(tmpdir(),'aamp-entry-'));
  try {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl.href)}); await m.runWindowsEntry(['help']);`],{
      env:{...process.env,USERPROFILE:home,HOME:home,AAMP_TASK_STATE_HOME:path.join(home,'state')},encoding:'utf8',timeout:10000,
    });
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/start/);
    assert.equal(existsSync(path.join(home,'state')),false);
  } finally {rmSync(home,{recursive:true,force:true});}
});
test('Windows interactive installation refuses redirected stdin before doing work', () => {
  const result=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl.href)}); await m.runWindowsEntry(['install']);`],{encoding:'utf8',timeout:10000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/终端|terminal/);
});
test('Windows update refuses a legacy Bash-only published package',async()=>{
  assert.equal(typeof entry.validateWindowsUpdatePackage,'function');
  const {mkdir,writeFile,rm}=await import('node:fs/promises');
  const root=mkdtempSync(path.join(tmpdir(),'aamp-update-'));
  try {
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'@larktask/aamp-feishu-task-agent',bin:{'feishu-task-agent':'bootstrap/legacy.sh'}}));
    await assert.rejects(entry.validateWindowsUpdatePackage(root,'@larktask/aamp-feishu-task-agent'),/Windows/);
    await mkdir(path.join(root,'bin'));await mkdir(path.join(root,'bootstrap'));
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'@larktask/aamp-feishu-task-agent',bin:{'feishu-task-agent':'bin/feishu-task-agent.mjs'}}));
    for(const file of ['bin/feishu-task-agent.mjs','bin/windows-service-worker.mjs','bootstrap/windows-entry.mjs','bootstrap/windows-helper.mjs','bootstrap/task-agent-defaults.json'])await writeFile(path.join(root,file),'fixture');
    await entry.validateWindowsUpdatePackage(root,'@larktask/aamp-feishu-task-agent');
  } finally {await rm(root,{recursive:true,force:true});}
});

// The Node dispatcher must preserve the two existing POSIX entry defaults.
test('POSIX aliases retain short help and standalone install defaults', {skip: process.platform==='win32'}, async () => {
  const fs=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const os=await import('node:os');
  const path=await import('node:path');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aamp-entry-alias-'));
  try {
    const bash=path.join(directory,'bash');
    await fs.writeFile(bash,'#!/bin/sh\nprintf "%s" "$AAMP_TASK_ENTRY"\n',{mode:0o755});
    const entry=fileURLToPath(new URL('../bin/feishu-task-agent.mjs',import.meta.url));
    for(const [name,expected] of [['feishu-task-agent','short'],['aamp-feishu-task-agent','']]) {
      const alias=path.join(directory,name);
      await fs.symlink(entry,alias);
      const env={...process.env,PATH:`${directory}:${process.env.PATH}`};
      delete env.AAMP_TASK_ENTRY;
      const result=spawnSync(process.execPath,[alias],{env,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout,expected);
    }
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

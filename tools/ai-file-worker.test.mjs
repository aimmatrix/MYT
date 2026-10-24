import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { startAiFileWorker } from './ai-file-worker.mjs';
const require=createRequire((process.env.MYT_NODE_MODULES||'/Users/ammad/Documents/Scrapper/node_modules')+'/package.json');
const ts=require('typescript');
const dir=await mkdtemp(join(tmpdir(),'myt-ai-transport-'));
const source=await readFile(new URL('../code/src/ai/fileTransport.ts',import.meta.url),'utf8');
const compiled=join(dir,'transport.mjs');await writeFile(compiled,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {createFileAiRequest}=await import(compiled);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(options={}) {
 const app=await mkdtemp(join(dir,'app-'));const root=join(app,'ai-runtime');
 const stop=await startAiFileWorker({root,env:{OPENAI_API_KEY:'test-only'},intervalMs:10,...options});
 const port={readText:p=>readFile(join(app,p),'utf8'),writeText:async(p,s)=>{await mkdir(join(app,p,'..'),{recursive:true});await writeFile(join(app,p),s);},remove:p=>unlink(join(app,p))};
 return {root,stop,request:createFileAiRequest(port)};
}
test('sandbox file transport handles both features without fetch, and removes payloads',async()=>{
 const seen=[];const x=await setup({simulateFn:async body=>{seen.push(body);return {messages:[{authorId:'demo-cast-jamal',text:'Hello'}]};},recommendFn:async()=>({recommendations:[{activityId:'a',reason:'Music'}]}),pollVotesFn:async()=>({votes:[{voterId:'demo-cast-jamal',optionIds:['food']}]})});
 try {
  assert.equal((await x.request('chat',{messages:[{authorId:'viewer',text:'Hi'}]})).messages[0].text,'Hello');
  assert.equal((await x.request('recommendations',{activityIds:['a']})).recommendations[0].activityId,'a');
  assert.equal((await x.request('poll-votes',{poll:{}})).votes[0].voterId,'demo-cast-jamal');
  assert.equal(seen.length,1);assert.deepEqual(await readdir(join(x.root,'requests')),[]);assert.deepEqual(await readdir(join(x.root,'responses')),[]);
 } finally {await x.stop();}
});
test('worker sanitizes failures and client cleans up failed requests',async()=>{
 const x=await setup({simulateFn:async()=>{throw Error('secret-key');}});
 try {await assert.rejects(x.request('chat',{messages:[]}),e=>!e.message.includes('secret-key'));assert.deepEqual(await readdir(join(x.root,'requests')),[]);assert.deepEqual(await readdir(join(x.root,'responses')),[]);}finally{await x.stop();}
});
test('offline and stale heartbeat fail before persisting a prompt',async()=>{
 let writes=0;
 const request=createFileAiRequest({readText:async()=>JSON.stringify({configured:true,updatedAt:0}),writeText:async()=>{writes++;},remove:async()=>{}});
 await assert.rejects(request('chat',{}),/offline/);assert.equal(writes,0);
});
test('cancelled requests leave no late response files',async()=>{
 let finish;const x=await setup({simulateFn:async()=>{await new Promise(r=>{finish=r;});return {messages:[]};}});
 try {
  const controller=new AbortController();const promise=x.request('chat',{messages:[]},controller.signal);
  for(let i=0;i<100&&!finish;i++)await pause(10);
  assert.ok(finish);controller.abort();await assert.rejects(promise,/cancelled/);finish();await pause(100);
  assert.deepEqual(await readdir(join(x.root,'requests')),[]);assert.deepEqual(await readdir(join(x.root,'responses')),[]);
 } finally {await x.stop();}
});
test('expired requests never call OpenAI',async()=>{
 let calls=0;const x=await setup({simulateFn:async()=>{calls++;return {messages:[]};}});
 try {
  const id=randomUUID();await writeFile(join(x.root,'requests',id+'.json'),JSON.stringify({schemaVersion:1,id,kind:'chat',createdAt:Date.now()-60000,expiresAt:Date.now()-1000,payload:{}}));
  for(let i=0;i<100;i++){try{const result=JSON.parse(await readFile(join(x.root,'responses',id+'.json'),'utf8'));assert.equal(result.ok,false);assert.match(result.error,/expired/);break;}catch(e){if(e.code!=='ENOENT')throw e;if(i===99)throw e;await pause(10);}}
  assert.equal(calls,0);
 } finally {await x.stop();}
});
after(async()=>{await rm(dir,{recursive:true,force:true});});

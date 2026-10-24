import { mkdir, readdir, readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiError, recommend, simulate, simulatePollVotes } from './ai-service.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
export async function startAiFileWorker({ root = fileURLToPath(new URL('../ai-runtime', import.meta.url)), env = process.env, recommendFn = recommend, simulateFn = simulate, pollVotesFn = simulatePollVotes, intervalMs = 250 } = {}) {
  root=resolve(root);
  const requests=join(root,'requests'),responses=join(root,'responses');
  for(const dir of [root,requests,responses]) {
    await mkdir(dir,{recursive:true,mode:0o700});
    if((await lstat(dir)).isSymbolicLink()) throw Error('AI runtime directory cannot be a symlink.');
  }
  const active=new Set(),completed=new Set();const hits=[];let stopped=false,scanning=false,lastStatus=0;
  async function atomic(path,value) {
    const temporary=path+'.tmp';
    // Refuse symlink files, including temporary files, before writing.
    for(const file of [path,temporary]){const stat=await lstat(file).catch(()=>null);if(stat?.isSymbolicLink())throw Error('Invalid runtime file.');}
    await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);
  }
  async function processFile(name) {
    const id=name.slice(0,-5),path=join(requests,name),responsePath=join(responses,name);active.add(name);
    let accepted=false;
    try {
      const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64_000)throw new AiError('Invalid AI request file.');
      let request;try{request=JSON.parse(await readFile(path,'utf8'));}catch{throw new AiError('Invalid AI request.');}
      if(request.schemaVersion!==1||request.id!==id||!['chat','recommendations','poll-votes'].includes(request.kind)||!request.payload||typeof request.payload!=='object'||Array.isArray(request.payload))throw new AiError('Invalid AI request.');
      if(!Number.isFinite(request.createdAt)||!Number.isFinite(request.expiresAt)||request.createdAt>Date.now()+5000||Date.now()-request.createdAt>40_000||request.expiresAt<Date.now()||request.expiresAt-request.createdAt>40_000)throw new AiError('AI request expired. Try again.');
      const now=Date.now();while(hits.length&&hits[0]<now-60_000)hits.shift();
      if(hits.length>=20)throw new AiError('Too many AI requests. Try again shortly.');
      hits.push(now);accepted=true;
      const result=await (request.kind==='chat'?simulateFn:request.kind==='poll-votes'?pollVotesFn:recommendFn)(request.payload,{env});
      // A client that cancelled has removed its request; don't leave a late reply.
      if(!stopped&&await lstat(path).catch(()=>null))await atomic(responsePath,{id,ok:true,result});
    } catch(error) {
      if(!stopped)await atomic(responsePath,{id,ok:false,error:error instanceof AiError?error.message:'AI service unavailable. Try again.'}).catch(()=>{});
    } finally {
      completed.add(name);await unlink(path).catch(()=>{});active.delete(name);
      // Log only type/count, never prompts, secrets or provider error bodies.
      if(accepted)console.log('MYT AI file request completed.');
    }
  }
  async function tick() {
    if(stopped||scanning)return;scanning=true;
    try {
      if(Date.now()-lastStatus>2000){await atomic(join(root,'status.json'),{schemaVersion:1,configured:!!env.OPENAI_API_KEY,updatedAt:Date.now()});lastStatus=Date.now();}
      for(const name of await readdir(responses)) {
        if(!UUID.test(name))continue;const path=join(responses,name);const stat=await lstat(path).catch(()=>null);
        if(stat&&Date.now()-stat.mtimeMs>60_000)await unlink(path).catch(()=>{});
      }
      const names=await readdir(requests);
      for(const name of [...completed])if(!names.includes(name))completed.delete(name);
      for(const name of names) {
        if(active.size>=3)break;
        if(UUID.test(name)&&!active.has(name)&&!completed.has(name))void processFile(name);
      }
    } finally { scanning=false; }
  }
  await tick();
  const timer=setInterval(()=>{void tick().catch(()=>console.error('MYT AI file service could not access runtime files.'));},intervalMs);
  return async()=>{stopped=true;clearInterval(timer);await unlink(join(root,'status.json')).catch(()=>{});};
}

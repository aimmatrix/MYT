import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const require=createRequire((process.env.MYT_NODE_MODULES||'/Users/ammad/Documents/Scrapper/node_modules')+'/package.json');const ts=require('typescript');
const cache=new Map();
function load(file){file=resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',js)(name=>name==='../ai/client'?{}:name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name),module,module.exports);return module.exports;}
const {createDemoSession}=load('MYT/code/src/demo/session.ts');const {communityPath}=load('MYT/code/src/domain/community.ts');const {dmId}=load('MYT/code/src/domain/social.ts');
const event=id=>({schemaVersion:1,id,title:id,description:'A local event',interestId:'football',area:'London',status:'available',timeOptions:[{id:'time',startAt:'2030-10-26T17:00:00Z',endAt:null,availabilityKeys:['weekend-evening']}],cost:{amountPence:1200,currency:'GBP',isEstimate:false},source:{kind:'unverified',url:null,checkedAt:null}});
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out waiting for demo activity');}
async function setup(overrides={},timing={timeScale:0}){const calls=[];let writes=0;const source={readText:async()=>JSON.stringify({schemaVersion:1,items:[event('football-a'),event('football-b'),{...event('music-a'),interestId:'music',timeOptions:[]}]}),writeText:async()=>{writes++;}};
 const ai={simulateChat:async(messages,signal,context)=>{calls.push({kind:'chat',messages,context});return {messages:context.memberIds.slice(0,context.chatType==='private'?1:2).map(authorId=>({authorId,text:context.chatType==='private'?"yeah I'm good! what are you up to?":`I'd love to join you for ${context.activity?.title}. Meet outside?`}))};},simulatePollVotes:async(poll,messages,signal,context)=>{calls.push({kind:'poll',messages,context});return {votes:context.memberIds.map(voterId=>({voterId,optionIds:[poll.options[0].id]}))};},...overrides};
 return {session:await createDemoSession(source,ai,timing),calls,writes:()=>writes};}
async function social(session){const loaded=await session.social.load();assert.equal(loaded.ok,true,JSON.stringify(loaded));return loaded.value.value;}
test('onboarding starts with zero joined groups, zero interests and zero plans while other students remain visible',async()=>{
 const x=await setup();try{const result=await x.session.repository.loadActivities();assert.equal(result.ok,true);for(const a of result.value.value.items){const interests=await x.session.repository.loadInterests(a.id);assert.ok(interests.ok);assert.ok(interests.value.value.filter(r=>r.userId!=='demo-viewer').length>=3);assert.ok(!interests.value.value.some(r=>r.userId==='demo-viewer'));}
 const s=await social(x.session);assert.ok(!s.messages.some(m=>m.chatId.startsWith('group:')));assert.deepEqual(x.session.getSnapshot().typingUsers,[]);assert.equal(x.calls.length,0);const plans=await x.session.repository.loadPlans();assert.equal(plans.ok,true);assert.deepEqual(Object.keys(plans.value.value),[]);assert.ok(s.messages.some(m=>m.chatId.startsWith('dm:')));assert.equal(x.writes(),0);}finally{x.session.dispose();}
});
test('joining the rented pitch shows existing conversation silently; only sending a text triggers AI',async()=>{
 const {session,calls}=await setup();try{const rsvp={kind:'rsvp',eventId:'demo-football',userId:session.user.id,name:'You',going:true};await session.files.writeText(communityPath(rsvp),JSON.stringify(rsvp),{overwrite:true});await session.communityChanged(rsvp);const chat='group:community:demo-football';
 assert.equal((await social(session)).messages.filter(m=>m.chatId===chat).length,3);assert.equal(calls.length,0);assert.deepEqual(session.getSnapshot().typingUsers,[]);
 assert.equal((await session.social.post(chat,{kind:'text',text:'Can I bring a friend?'})).ok,true);await until(()=>calls.some(c=>c.messages.at(-1)?.text==='Can I bring a friend?'));await until(()=>!session.getSnapshot().busyChatIds.length);
 const s=await social(session);assert.ok(s.messages.filter(m=>m.chatId===chat&&m.authorId!=='demo-viewer').length>=3);assert.equal(calls.at(-1).context.activity.title,'Five-a-side at the rented pitch');assert.equal(calls.at(-1).context.chatType,'group');}finally{session.dispose();}
});
test('a new event preserves price, auto-joins demo students and supports polls in its group',async()=>{
 const {session,calls}=await setup();try{const record={kind:'event',id:'my-event',title:'Football with friends',location:'North pitch',startsAt:'2030-10-26T18:00:00Z',price:12.5,description:'Bring a water bottle',hostId:session.user.id,hostName:'You'};await session.files.writeText(communityPath(record),JSON.stringify(record),{overwrite:false});await session.communityChanged(record);
 const catalog=await session.repository.loadActivities();const activity=catalog.value.value.items.find(a=>a.id==='community:my-event');assert.equal(activity.cost.amountPence,1250);const interests=await session.repository.loadInterests(activity.id);assert.equal(interests.value.value.length,1);
 await until(async()=>{const r=await session.repository.loadInterests(activity.id);return r.value.value.length>=4;});assert.equal(calls.length,0);assert.deepEqual(session.getSnapshot().typingUsers,[]);
 const chat='group:'+activity.id;const poll={question:'What time should we meet?',options:[{id:'early',label:'30 minutes before'},{id:'late',label:'At kick-off'}],multi:false,anonymous:false};assert.equal((await session.social.post(chat,{kind:'poll',poll})).ok,true);await until(()=>calls.some(c=>c.kind==='poll'));await until(()=>!session.getSnapshot().busyChatIds.length);
 const s=await social(session);const posted=s.messages.find(m=>m.chatId===chat&&m.kind==='poll');const votes=s.votes.filter(v=>v.messageId===posted.id);assert.ok(votes.length>=3);assert.ok(votes.every(v=>v.voterId!=='demo-viewer'&&v.optionIds[0]==='early'));
 }finally{session.dispose();}
});
test('private messages use only the friend as the AI participant',async()=>{
 const {session,calls}=await setup();try{const chat=dmId(session.user.id,'demo-cast-leo');assert.equal((await session.social.post(chat,{kind:'text',text:'What films do you like?'})).ok,true);await until(()=>calls.length>0);await until(()=>!session.getSnapshot().busyChatIds.length);assert.equal(calls[0].context.chatType,'private');assert.deepEqual(calls[0].context.memberIds,['demo-cast-leo']);const s=await social(session);assert.equal(s.messages.filter(m=>m.chatId===chat&&m.authorId==='demo-cast-leo').length,2);}finally{session.dispose();}
});
test('choosing I would go unlocks existing history without AI requests or typing',async()=>{
 const {session,calls}=await setup();try{assert.equal((await session.repository.setInterest('music-a','interested')).ok,true);assert.equal(calls.length,0);assert.deepEqual(session.getSnapshot().typingUsers,[]);const s=await social(session);assert.ok(s.messages.some(m=>m.chatId==='group:music-a'&&m.authorId!=='demo-viewer'));}finally{session.dispose();}
});
test('failed AI jobs expose a retry and disposal ignores late AI responses',async()=>{
 let fail=true;const x=await setup({simulateChat:async(messages,signal,context)=>{if(fail)throw Error('AI offline');return {messages:[{authorId:context.memberIds[0],text:'back now'}]};}});const chat=dmId(x.session.user.id,'demo-cast-leo');await x.session.social.post(chat,{kind:'text',text:'hello'});await until(()=>x.session.getSnapshot().errors[chat]);assert.equal(x.session.getSnapshot().errors[chat],'AI offline');fail=false;x.session.retry(chat);await until(async()=>(await social(x.session)).messages.some(m=>m.text==='back now'));x.session.dispose();
 let finish;const y=await setup({simulateChat:()=>new Promise(r=>{finish=r;})});await y.session.social.post(chat,{kind:'text',text:'hi'});await until(()=>finish);y.session.dispose();finish({messages:[{authorId:'demo-cast-leo',text:'late reply'}]});await new Promise(r=>setTimeout(r,20));assert.ok(!(await social(y.session)).messages.some(m=>m.text==='late reply'));
});

test('replies have a reading pause, then one person types before each message appears',async()=>{
 const {session}=await setup({}, {timeScale:0.02,random:()=>0});
 const chat=dmId(session.user.id,'demo-cast-leo');try{
  await session.social.post(chat,{kind:'text',text:'How are you?'});
  assert.deepEqual(session.getSnapshot().typingUsers,[]);
  await until(()=>session.getSnapshot().typingUsers.some(t=>t.chatId===chat));
  assert.equal((await social(session)).messages.filter(m=>m.chatId===chat&&m.authorId==='demo-cast-leo').length,1);
  await until(async()=>(await social(session)).messages.filter(m=>m.chatId===chat&&m.authorId==='demo-cast-leo').length===2);
  await until(()=>!session.getSnapshot().busyChatIds.length);assert.deepEqual(session.getSnapshot().typingUsers,[]);
 }finally{session.dispose();}
});
test('created-event participants join gradually with no typing; exit cancels delayed joins',async()=>{
 const make=async(session,id)=>{const record={kind:'event',id,title:'A new group',location:'Campus',startsAt:'2030-10-26T18:00:00Z',price:5,description:'Meet up',hostId:session.user.id,hostName:'You'};await session.files.writeText(communityPath(record),JSON.stringify(record),{overwrite:false});await session.communityChanged(record);};
 const {session,calls}=await setup({}, {timeScale:0.02,random:()=>0});try{
  await make(session,'staggered');const count=async()=>{const r=await session.repository.loadInterests('community:staggered');return r.value.value.length;};assert.equal(await count(),1);
  await until(async()=>await count()===2);assert.deepEqual(session.getSnapshot().typingUsers,[]);assert.equal(calls.length,0);
  await until(async()=>await count()>=3);
 }finally{session.dispose();}
 const next=await setup({}, {timeScale:0.02,random:()=>0});await make(next.session,'cancelled');next.session.dispose();await new Promise(r=>setTimeout(r,150));const r=await next.session.repository.loadInterests('community:cancelled');assert.equal(r.value.value.length,1);
});

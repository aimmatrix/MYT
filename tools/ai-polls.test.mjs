import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { simulate, simulatePollVotes, CAST } from './ai-service.mjs';
const require=createRequire((process.env.MYT_NODE_MODULES||'/Users/ammad/Documents/Scrapper/node_modules')+'/package.json');
const ts=require('typescript');
const poll={question:'What should we do after the match?',options:[{id:'food',label:'Food'},{id:'coffee',label:'Coffee'}],multi:false,anonymous:false};
const env={OPENAI_API_KEY:'test-secret'};
const mock=v=>async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]}));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(group){for(let i=0;i<100&&group.getSnapshot().aiPollBusy.length;i++)await pause(5);assert.deepEqual(group.getSnapshot().aiPollBusy,[]);}
function sample(pollFn){
 const cache=new Map();
 function load(file){
  file=resolve(file);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const local=name=>name==='../ai/client'?{simulatePollVotes:pollFn,simulateChat:async()=>({messages:[]})}:name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name);
  new Function('require','module','exports',js)(local,module,module.exports);return module.exports;
 }
 return load('MYT/code/src/demo/sampleGroup.ts');
}
test('model poll votes only use cast voters and valid choices, and enforce single choice',async()=>{
 const votes=[{voterId:'real-user',optionIds:['food']},{voterId:CAST[0].id,optionIds:['made-up']},{voterId:CAST[1].id,optionIds:['food','coffee']},{voterId:CAST[2].id,optionIds:['food']},{voterId:CAST[2].id,optionIds:['coffee']}];
 assert.deepEqual((await simulatePollVotes({poll,messages:[]},{env,fetchImpl:mock({votes})})).votes,[{voterId:CAST[2].id,optionIds:['food']}]);
});
test('multi choice accepts several distinct options; duplicate selections are rejected',async()=>{
 const result=await simulatePollVotes({poll:{...poll,multi:true},messages:[]},{env,fetchImpl:mock({votes:[{voterId:CAST[0].id,optionIds:['food','coffee']},{voterId:CAST[1].id,optionIds:['food','food']}]})});
 assert.deepEqual(result.votes,[{voterId:CAST[0].id,optionIds:['food','coffee']}]);
});
test('invalid poll never calls OpenAI and conversation identities are minimized',async()=>{
 await assert.rejects(simulatePollVotes({poll:{...poll,options:[poll.options[0],poll.options[0]]}},{env,fetchImpl:()=>{throw Error('must not call');}}),/Invalid poll/);
 await simulatePollVotes({poll,messages:[{authorId:'private-user-id',text:'I prefer food'}]},{env,fetchImpl:async(url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).input);assert.equal(input.messages[0].authorId,'viewer');assert.equal(input.poll.options.length,2);return mock({votes:[]})();
 }});
});
test('sample poll collects five AI votes, user vote stays separate, retry does not duplicate',async()=>{
 const group=sample(async()=>({votes:CAST.map(c=>({voterId:c.id,optionIds:['food']}))}));group.joinSampleGroup();group.setSampleAiEnabled(true);
 const actions=group.withSampleGroup(null,'viewer');await actions.post(group.SAMPLE_GROUP_ID,{kind:'poll',poll});await settle(group);
 const message=group.getSnapshot().mine.at(-1);let votes=group.sampleSocial(group.getSnapshot(),'viewer').votes.filter(v=>v.messageId===message.id);
 assert.equal(votes.length,5);assert.equal(new Set(votes.map(v=>v.voterId)).size,5);assert.ok(votes.every(v=>v.voterId.startsWith('demo-cast-')));
 await actions.vote(group.SAMPLE_GROUP_ID,message.id,['coffee']);votes=group.sampleSocial(group.getSnapshot(),'viewer').votes.filter(v=>v.messageId===message.id);assert.equal(votes.length,6);assert.deepEqual(votes.find(v=>v.voterId==='viewer').optionIds,['coffee']);
 group.retrySamplePollVotes(message.id,'viewer');await settle(group);assert.equal(group.getSnapshot().aiVotes.length,5);
 await actions.vote(group.SAMPLE_GROUP_ID,message.id,[]);assert.equal(group.getSnapshot().aiVotes.length,5);group.leaveSampleGroup();
});
test('polls posted with AI off vote when enabled; real chats never trigger AI votes',async()=>{
 let calls=0,posts=0;const group=sample(async()=>{calls++;return {votes:[{voterId:CAST[0].id,optionIds:['food']}]};});group.joinSampleGroup();
 const actions=group.withSampleGroup({post:async()=>{posts++;return {ok:true,value:null};}},'viewer');
 await actions.post(group.SAMPLE_GROUP_ID,{kind:'poll',poll});assert.equal(calls,0);group.setSampleAiEnabled(true);await settle(group);assert.equal(calls,1);
 await actions.post('group:real',{kind:'poll',poll});assert.equal(calls,1);assert.equal(posts,1);group.leaveSampleGroup();
});
test('AI voting failures can be retried without losing the poll or user vote',async()=>{
 let fail=true;const group=sample(async()=>{if(fail)throw Error('offline');return {votes:[{voterId:CAST[0].id,optionIds:['food']}]};});group.joinSampleGroup();group.setSampleAiEnabled(true);
 const actions=group.withSampleGroup(null,'viewer');await actions.post(group.SAMPLE_GROUP_ID,{kind:'poll',poll});await settle(group);const id=group.getSnapshot().mine.at(-1).id;
 assert.equal(group.getSnapshot().aiPollErrors[id],'offline');await actions.vote(group.SAMPLE_GROUP_ID,id,['coffee']);fail=false;group.retrySamplePollVotes(id,'viewer');await settle(group);
 assert.equal(group.getSnapshot().aiPollErrors[id],'');assert.equal(group.getSnapshot().aiVotes.length,1);assert.equal(group.getSnapshot().votes.length,1);group.leaveSampleGroup();
});
test('switching off or leaving blocks late model votes',async()=>{
 for(const leave of [false,true]){
  let finish;const group=sample(()=>new Promise(r=>{finish=r;}));group.joinSampleGroup();group.setSampleAiEnabled(true);await group.withSampleGroup(null,'viewer').post(group.SAMPLE_GROUP_ID,{kind:'poll',poll});
  if(leave)group.leaveSampleGroup();else group.setSampleAiEnabled(false);finish({votes:[{voterId:CAST[0].id,optionIds:['food']}]});await pause(10);assert.deepEqual(group.getSnapshot().aiVotes,[]);assert.deepEqual(group.getSnapshot().aiPollBusy,[]);group.leaveSampleGroup();
 }
});

test('private AI replies are restricted to the actual demo friend',async()=>{
 const result=await simulate({chatType:'private',memberIds:['demo-cast-leo'],messages:[{authorId:'viewer',text:'How was your day?'}]},{env,fetchImpl:mock({messages:[{authorId:'demo-cast-jamal',text:'Wrong person'},{authorId:'demo-cast-leo',text:'pretty good, yours?'},{authorId:'demo-cast-leo',text:'duplicate'}]})});
 assert.deepEqual(result.messages,[{authorId:'demo-cast-leo',text:'pretty good, yours?'}]);
});
test('event poll votes include only selected demo group members, including Sofia',async()=>{
 const result=await simulatePollVotes({poll,memberIds:['demo-cast-sofia'],messages:[]},{env,fetchImpl:mock({votes:[{voterId:'demo-cast-sofia',optionIds:['food']},{voterId:'demo-cast-jamal',optionIds:['coffee']}]})});
 assert.deepEqual(result.votes,[{voterId:'demo-cast-sofia',optionIds:['food']}]);
});

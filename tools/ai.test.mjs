import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { AiError, structured, recommend, simulate, CAST } from './ai-service.mjs';
import { createAiServer } from './ai-server.mjs';
const env = { OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test-model' };
const mock = value => async () => new Response(JSON.stringify({ status:'completed', output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}] }));
const event = (id, timeOptions=[]) => ({id,title:id,description:'Event description',status:'available',timeOptions,cost:{amountPence:1000,isEstimate:false},interestId:'music',area:'London'});
test('structured Responses request keeps key server-side and disables storage',async()=>{
 await structured('test',{},'instructions',{}, {env,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-secret');
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.model,'test-model');
  return mock({})()}
 });
});
test('recommendations exclude invented IDs, duplicates, expired and unavailable events',async()=>{
 const catalog=[event('a'),event('expired',[{startAt:'2020-01-01T00:00:00Z'}]),{...event('unavailable'),status:'unavailable'}];
 const result=await recommend({activityIds:['a','expired','unavailable'],profile:{}},{env,catalog,fetchImpl:mock({recommendations:[{activityId:'invented',reason:'fake'},{activityId:'expired',reason:'old'},{activityId:'unavailable',reason:'closed'},{activityId:'a',reason:'Fits your music interest'},{activityId:'a',reason:'duplicate'}]})});
 assert.deepEqual(result.recommendations,[{activityId:'a',reason:'A different kind of plan to explore. Listed price £10.00.'}]);
});
test('only allowlisted IDs are sent; names and user IDs are omitted from recommendation input',async()=>{
 await recommend({activityIds:['a'],profile:{userId:'secret-id',displayName:'Secret Name',interestIds:['music'],budgetPence:1500}},{env,catalog:[event('a'),event('b')],fetchImpl:async(url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).input);assert.equal(input.candidates.length,1);assert.ok(!JSON.stringify(input).includes('Secret Name'));assert.ok(!JSON.stringify(input).includes('secret-id'));return mock({recommendations:[]})();
 }});
});
test('no candidates means no model call',async()=>assert.deepEqual(await recommend({activityIds:[]},{catalog:[],fetchImpl:()=>{throw Error('must not call');}}),{recommendations:[]}));
test('simulation never impersonates viewer or a real account',async()=>{
 const result=await simulate({messages:[{authorId:'real-person',text:'hello'}]},{env,fetchImpl:mock({messages:[{authorId:'real-person',text:'bad'},{authorId:CAST[0].id,text:'Where should we meet?'}]})});
 assert.deepEqual(result.messages,[{authorId:CAST[0].id,text:'Where should we meet?'}]);
});
test('chat sends at most 24 messages and anonymizes the viewer',async()=>{
 await simulate({messages:Array.from({length:40},()=>({authorId:'real-user-id',text:'hello'}))},{env,fetchImpl:async(url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).input);assert.equal(input.messages.length,24);assert.ok(input.messages.every(m=>m.authorId==='viewer'));return mock({messages:[]})();
 }});
});
test('missing key, quota, refusal, incomplete and malformed output fail explicitly without leaking secrets',async()=>{
 await assert.rejects(structured('test',{},'',{},{env:{}}),e=>e instanceof AiError && e.status===503);
 for(const response of [new Response('secret-provider-error',{status:429}),new Response(JSON.stringify({status:'incomplete',output:[]})),new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]})),new Response('not json')]){
  await assert.rejects(structured('test',{},'',{},{env,fetchImpl:async()=>response}),e=>e instanceof AiError && !e.message.includes('secret'));
 }
});
test('server enforces host, origin, JSON, size and rate limits; errors are sanitized',async()=>{
 const server=createAiServer({env:{...env,MYT_AI_PORT:'18787'},simulateFn:async()=>({messages:[]}),pollVotesFn:async()=>({votes:[{voterId:'demo-cast-leo',optionIds:['a']}]}),recommendFn:async()=>{throw Error('test-secret');}});
 await new Promise(resolve=>server.listen(18787,'127.0.0.1',resolve));
 const url='http://127.0.0.1:18787';
 try {
  assert.equal((await fetch(url+'/api/ai/status')).status,200);
  const pollResponse=await fetch(url+'/api/ai/poll-votes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(pollResponse.status,200);assert.equal((await pollResponse.json()).votes[0].voterId,'demo-cast-leo');
  assert.equal((await fetch(url+'/api/ai/chat',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{const req=httpRequest(url+'/api/ai/status',{headers:{Host:'evil.example:18787'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);
  assert.equal((await fetch(url+'/api/ai/chat',{method:'POST',body:'{}'})).status,415);
  const post=body=>fetch(url+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal((await post('bad')).status,400);
  assert.equal((await post(JSON.stringify({text:'x'.repeat(65000)}))).status,413);
  const failed=await fetch(url+'/api/ai/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('test-secret'));
  let response;for(let i=0;i<21;i++)response=await post('{}');assert.equal(response.status,429);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});

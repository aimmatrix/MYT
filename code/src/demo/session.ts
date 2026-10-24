import type { FileChange, FileEntry, MytFilePort, MytRepository } from '../data-contract';
import type { CurrentUser, ActivityCatalog, ActionResult, ChatMessage, ChatPoll, Activity } from '../types';
import type { SocialRepository } from '../data/socialRepository';
import { createSocialRepository } from '../data/socialRepository';
import { createAppRepository } from '../wiring/appRepository';
import { createDemoCast } from './cast';
import { DEMO_CAST } from './identity';
import { interestPath, messagePath } from '../paths';
import { dmId } from '../domain/social';
import { communityActivity, communityPath, type CommunityRecord, type CommunityEvent } from '../domain/community';
import { simulateChat, simulatePollVotes } from '../ai/client';

export interface DemoAiState {
 typingUsers:{userId:string;name:string;chatId:string}[];
 busyChatIds:string[];
 votingChatIds:string[];
 waitingChatIds:string[];
 errors:Record<string,string>;
}
export interface DemoSession {
 files:MytFilePort; user:CurrentUser; repository:MytRepository; social:SocialRepository;
 communityChanged:(record:CommunityRecord)=>Promise<void>;
 subscribe:(fn:()=>void)=>()=>void; getSnapshot:()=>DemoAiState;
 retry:(chatId:string)=>void; dispose:()=>void;
}
interface DemoAi {simulateChat:typeof simulateChat;simulatePollVotes:typeof simulatePollVotes}
const asText=(message:ChatMessage)=>({authorId:message.authorId,text:message.kind==='text'?message.text:`Poll: ${message.poll.question}. Options: ${message.poll.options.map(o=>o.label).join(', ')}`});
/** Every person, RSVP, message and vote in this session lives in memory. */
export async function createDemoSession(source:MytFilePort, ai:DemoAi={simulateChat,simulatePollVotes}, timing:{timeScale?:number;random?:()=>number}={}):Promise<DemoSession> {
 const user={id:'demo-viewer',name:'You'};
 const catalog:ActivityCatalog=JSON.parse(await source.readText('data/activities.json'));
 if(!Array.isArray(catalog.items))throw new Error('The activity feed could not be loaded.');
 const data=new Map<string,string>([
  ['data/activities.json',JSON.stringify(catalog)],['data/sample-profiles.json',JSON.stringify({schemaVersion:1,items:[]})],
  ['data/session.json',JSON.stringify({schemaVersion:1,organiserUserId:user.id})],
 ]);
 const listeners=new Set<{path:string;listener:(change:FileChange)=>void}>();
 const files:MytFilePort={
  async readText(path){const text=data.get(path);if(text===undefined)throw new Error('File not found');return text;},
  async writeText(path,text,options){
   if(data.has(path)&&!options.overwrite)throw new Error('File already exists');
   const type=data.has(path)?'changed':'created';data.set(path,text);
   for(const entry of listeners)if(!entry.path||path===entry.path||path.startsWith(entry.path+'/'))entry.listener({type,path});
  },
  async list(path){const prefix=path?path+'/':'';const entries=new Map<string,FileEntry>();for(const full of data.keys()){
   if(!full.startsWith(prefix))continue;const remainder=full.slice(prefix.length),name=remainder.split('/')[0];
   entries.set(name,{name,path:prefix+name,kind:remainder.includes('/')?'folder':'file'});
  }return [...entries.values()];},
  watch(path,listener){const entry={path,listener};listeners.add(entry);return()=>{listeners.delete(entry);};},
 };
 const cast=await createDemoCast(files,user.id).addAll();if(!cast.ok)throw new Error(cast.message);
 const base=createAppRepository(files,user),original=createSocialRepository(files,user,base);
 const actor=(id:string)=>{const member=DEMO_CAST.find(m=>m.id===id);if(!member)return null;const who={id,name:member.name};return createSocialRepository(files,who,createAppRepository(files,who));};
 const stamp=()=>new Date().toISOString();
 const ok:ActionResult<unknown>={ok:true,value:null};
 let disposed=false;
 const uiListeners=new Set<()=>void>();
 let snapshot:DemoAiState={typingUsers:[],busyChatIds:[],votingChatIds:[],waitingChatIds:[],errors:{}};
 const background=new Set<AbortController>();
 const timeScale=Math.max(0,timing.timeScale??1);
 const between=(min:number,max:number)=>min+Math.max(0,Math.min(1,(timing.random??Math.random)()))*(max-min);
 function pause(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(new Error('Demo interaction cancelled.'));return;}
   const finish=()=>{signal.removeEventListener('abort',cancel);resolve();};
   const timer=setTimeout(finish,ms*timeScale);
   const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new Error('Demo interaction cancelled.'));};
   signal.addEventListener('abort',cancel,{once:true});
  });
 }

 const jobs=new Map<string,{controller:AbortController;chatId:string;typer:string|null}>();
 const pendingConversations=new Set<string>();
 const retries=new Map<string,()=>void>();
 function update(errors=snapshot.errors){snapshot={errors,waitingChatIds:[...pendingConversations],votingChatIds:[...new Set([...jobs.entries()].filter(([key])=>key.startsWith('poll:')).map(([,j])=>j.chatId))],busyChatIds:[...new Set([...jobs.values()].map(j=>j.chatId))],typingUsers:[...jobs.values()].filter(j=>j.typer).map(j=>({userId:j.typer!,name:DEMO_CAST.find(m=>m.id===j.typer)?.name??'Demo student',chatId:j.chatId}))};for(const fn of uiListeners)fn();}
 function run(key:string,chatId:string,typer:string|null,work:(signal:AbortSignal,active:()=>boolean,setTyping:(id:string|null)=>void)=>Promise<void>){
  if(disposed)return;jobs.get(key)?.controller.abort();const controller=new AbortController();jobs.set(key,{controller,chatId,typer});
  retries.set(chatId,()=>run(key,chatId,typer,work));update({...snapshot.errors,[chatId]:''});
  const active=()=>!disposed&&!controller.signal.aborted&&jobs.get(key)?.controller===controller;
  const timer=setTimeout(()=>controller.abort(),60000);
  const setTyping=(id:string|null)=>{if(active()){jobs.get(key)!.typer=id;update();}};
  void work(controller.signal,active,setTyping).catch(error=>{if(!disposed&&jobs.get(key)?.controller===controller)update({...snapshot.errors,[chatId]:error instanceof Error?error.message:'AI response failed. Try again.'});}).finally(()=>{clearTimeout(timer);if(jobs.get(key)?.controller===controller){jobs.delete(key);update();}});
 }
 async function membersFor(chatId:string){
  if(chatId.startsWith('dm:'))return DEMO_CAST.filter(m=>chatId===dmId(user.id,m.id));
  const result=await base.loadInterests(chatId.slice(6));const ids=result.ok?result.value.value.filter(r=>r.status==='interested').map(r=>r.userId):[];
  const loaded=await original.load();const blocked=loaded.ok?loaded.value.value.blockedIds:[];
  return DEMO_CAST.filter(m=>ids.includes(m.id)&&!blocked.includes(m.id));
 }
 function context(chatId:string,memberIds:string[],trigger?:string){
  const activity=catalog.items.find(a=>chatId==='group:'+a.id);
  const hosted=activity?.id.startsWith('community:')?events.get(activity.id.slice(10)):undefined;
  return {memberIds,chatType:chatId.startsWith('dm:')?'private' as const:'group' as const,activity:activity?{title:activity.title,description:activity.description,area:activity.area,startAt:activity.timeOptions[0]?.startAt,costPence:activity.cost.amountPence,hostName:hosted?.hostName,viewerIsHost:hosted?.hostId===user.id}:undefined,trigger};
 }
 async function conversation(chatId:string,trigger?:string){
  if(disposed)return;const members=await membersFor(chatId);
  if(!members.length){if(chatId.startsWith('group:')){pendingConversations.add(chatId);update();}return;}
  pendingConversations.delete(chatId);
  run('chat:'+chatId,chatId,null,async(signal,active,setTyping)=>{
   const loaded=await original.load();if(!loaded.ok)throw new Error(loaded.error.message);
   const messages=loaded.value.value.messages.filter(m=>m.chatId===chatId).slice(-24).map(asText);
   const started=Date.now();
   const result=await ai.simulateChat(messages,signal,context(chatId,members.map(m=>m.id),trigger));
   await pause(Math.max(0,between(1400,2600)-(Date.now()-started)/Math.max(timeScale,0.001)),signal);
   const replies=result.messages.filter(reply=>members.some(m=>m.id===reply.authorId)&&reply.text.trim());
   if(!replies.length)throw new Error("AI couldn’t produce a reply. Try again.");
   for(const reply of replies){if(!active())return;if(!members.some(m=>m.id===reply.authorId))continue;
    setTyping(reply.authorId);
    await pause(Math.min(6500,Math.max(1800,1000+reply.text.length*between(35,55))),signal);
    if(!active())return;
    const saved=await actor(reply.authorId)!.post(chatId,{kind:'text',text:reply.text});if(!saved.ok)throw new Error(saved.error.message);
    setTyping(null);
    await pause(between(1000,2200),signal);
   }
  });
 }
 async function pollVotes(chatId:string,message:ChatMessage & {kind:'poll'}){
  const members=await membersFor(chatId);if(!members.length||disposed)return;
  run('poll:'+message.id,chatId,null,async(signal,active)=>{
   const loaded=await original.load();if(!loaded.ok)throw new Error(loaded.error.message);
   const result=await ai.simulatePollVotes(message.poll,loaded.value.value.messages.filter(m=>m.chatId===chatId).slice(-24).map(asText),signal,context(chatId,members.map(m=>m.id)));
   for(const vote of result.votes){if(!active())return;if(!members.some(m=>m.id===vote.voterId))continue;
    await pause(between(900,1800),signal);if(!active())return;
    const saved=await actor(vote.voterId)!.vote(chatId,message.id,vote.optionIds);if(!saved.ok)throw new Error(saved.error.message);
   }
  });
 }
 async function interested(activityId:string,id:string,status:'interested'|'withdrawn'='interested'){
  await files.writeText(interestPath(activityId,id),JSON.stringify({schemaVersion:1,activityId,userId:id,status,updatedAt:stamp()}),{overwrite:true});
 }
 const participants=(a:Activity,index=0)=>{
  const matching=DEMO_CAST.filter(m=>m.interestIds.includes(a.interestId));
  return [...matching,...DEMO_CAST.filter(m=>!matching.includes(m))].slice(0,3+(index%3));
 };
 const available=catalog.items.filter(a=>a.status==='available');
 for(const [index,a] of available.entries())for(const member of participants(a,index))await interested(a.id,member.id);
 // Other students have a conversation already; the viewer joins no groups here.
 async function seedHistory(activity:Activity){
  const members=participants(activity);
  const lines=[`Anyone else thinking of ${activity.title}? I'd be up for going with a few people.`,"Yeah, I'd be up for going together.","Let's work out a meeting point here once everyone's in."];
  for(const [index,member] of members.slice(0,3).entries()){
   const id=`demo-history-${index}`,chatId='group:'+activity.id,path=messagePath(chatId,member.id,id);
   if(data.has(path))continue;
   await files.writeText(path,JSON.stringify({schemaVersion:1,id,chatId,authorId:member.id,createdAt:new Date(Date.now()-(25-index*5)*60000).toISOString(),kind:'text',text:lines[index]}),{overwrite:false});
  }
 }
 for(const a of available)await seedHistory(a);
 const events=new Map<string,CommunityEvent>();
 async function communityChanged(record:CommunityRecord){
  if(disposed)return;
  if(record.kind==='event'){
   events.set(record.id,record);const a=communityActivity(record);const index=catalog.items.findIndex(item=>item.id===a.id);if(index<0)catalog.items.unshift(a);else catalog.items[index]=a;
   await files.writeText('data/activities.json',JSON.stringify(catalog),{overwrite:true});
   await interested(a.id,record.hostId);
   const joining=participants(a).filter(member=>member.id!==record.hostId).slice(0,4);
   const addMember=async(member:typeof DEMO_CAST[number])=>{
    await interested(a.id,member.id);
    const r={kind:'rsvp' as const,eventId:record.id,userId:member.id,name:member.name,going:true};
    await files.writeText(communityPath(r),JSON.stringify(r),{overwrite:true});
   };
   if(record.hostId===user.id){
    // Creating a plan is immediate; other people discover it and join gradually.
    const controller=new AbortController();background.add(controller);
    void (async()=>{
     for(const [index,member] of joining.entries()){
      await pause(index===0?between(3500,5500):between(2500,4500),controller.signal);
      if(disposed||controller.signal.aborted)return;
      await addMember(member);
      await actor(member.id)!.post('group:'+a.id,{kind:'text',text:[`I'd be up for ${record.title}! ${record.price===0?'Free works for me.':`£${record.price.toFixed(2)} works for me.`}`,"Just joined too. Looks like a good plan.","I'm in! Happy to meet outside beforehand.","Count me in as well."][index]});
      if(pendingConversations.has('group:'+a.id))void conversation('group:'+a.id,'The viewer sent a message before anyone joined. Respond to their most recent message now that you have joined, even if a join announcement came after it.');
     }
    })().catch(error=>{if(!disposed&&!controller.signal.aborted)update({...snapshot.errors,['group:'+a.id]:error instanceof Error?error.message:'Demo students could not join.'});}).finally(()=>background.delete(controller));
   }else{
    for(const member of joining)await addMember(member);
    await seedHistory(a);
   }
  }else{
   const event=events.get(record.eventId);if(!event)return;
   await interested('community:'+event.id,record.userId,record.going?'interested':'withdrawn');

  }
 }
 const football:CommunityEvent={kind:'event',id:'demo-football',title:'Five-a-side at the rented pitch',location:'Hendon football pitches',startsAt:new Date(Date.now()+172800000).toISOString(),price:8,description:'Demo plan: a friendly game for all levels. Bring trainers and a water bottle.',hostId:DEMO_CAST.find(m=>m.id==='demo-cast-jamal')!.id,hostName:'Jamal (demo)'};
 await files.writeText(communityPath(football),JSON.stringify(football),{overwrite:false});await communityChanged(football);
 // One existing friend and one incoming request populate the social flow.
 const friend=DEMO_CAST.find(m=>m.id==='demo-cast-leo')!;
 await original.request(friend.id,'pending');await actor(friend.id)!.respond(user.id,'accepted');await actor(friend.id)!.post(dmId(user.id,friend.id),{kind:'text',text:'Hey! How’s your week going? You looking at anything on Discover?'});
 await actor(DEMO_CAST[0].id)!.request(user.id,'pending');
 async function greeting(id:string){const other=actor(id);if(!other||disposed)return ok;const chatId=dmId(user.id,id);const loaded=await other.load();if(loaded.ok&&!loaded.value.value.messages.some(m=>m.chatId===chatId&&m.authorId===id))return other.post(chatId,{kind:'text',text:'hey, thanks for adding me! how’s your day going?'});return ok;}
 const repository:MytRepository={...base,async setInterest(id,status){const result=await base.setInterest(id,status);if(result.ok&&status==='interested'){
  const a=catalog.items.find(a=>a.id===id);if(a){for(const member of participants(a,2))await interested(id,member.id);await seedHistory(a);}
 }return result;}};
 const social:SocialRepository={...original,
  async request(id,status){const result=await original.request(id,status);if(!result.ok||status!=='pending')return result;const other=actor(id);if(!other)return result;const accepted=await other.respond(user.id,'accepted');if(!accepted.ok)return accepted;return greeting(id);},
  async respond(id,status){const result=await original.respond(id,status);if(!result.ok||status!=='accepted')return result;return greeting(id);},
  async post(chatId,input){const result=await original.post(chatId,input);if(!result.ok||disposed)return result;
   if(input.kind==='text')void conversation(chatId);
   else {const loaded=await original.load();if(loaded.ok){const message=loaded.value.value.messages.filter((m):m is ChatMessage & {kind:'poll'}=>m.chatId===chatId&&m.authorId===user.id&&m.kind==='poll').at(-1);if(message)void pollVotes(chatId,message);}}
   return result;
  },
 };
 return {files,user,repository,social,communityChanged,subscribe(fn){uiListeners.add(fn);return()=>{uiListeners.delete(fn);};},getSnapshot:()=>snapshot,retry(chatId){retries.get(chatId)?.();},dispose(){disposed=true;pendingConversations.clear();for(const controller of background)controller.abort();background.clear();for(const job of jobs.values())job.controller.abort();jobs.clear();uiListeners.clear();listeners.clear();}};
}

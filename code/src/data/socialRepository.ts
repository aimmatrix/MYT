import type { MytFilePort, MytRepository, ReadResult } from "../data-contract";
import type { ActionResult, ChatRead, PollVote, ChatMessage, ChatPoll, CurrentUser, SocialData, RecordIssue } from "../types";
import { isSocialRecord, type SocialKind, type SocialRecord, isChatPoll } from "../domain/validation";
import { areFriends, dmId, emptySocial, groupMembers, realId } from "../domain/social";
import { blocksPath, interestFolderPath, chatFolderPath, chatReadPath, friendRequestPath, friendResponsePath, meetPath, messagePath, pollVotePath } from "../paths";
export type MessageInput = {kind:"text";text:string} | {kind:"poll";poll:ChatPoll};
export interface SocialRepository {
 load(): Promise<ReadResult<SocialData>>;
 request(toId: string, status: "pending" | "cancelled"): Promise<ActionResult<unknown>>;
 respond(fromId: string, status: "accepted" | "declined" | "undone"): Promise<ActionResult<unknown>>;
 pass(id: string, reset?: boolean): Promise<ActionResult<unknown>>;
 block(id: string, blocked: boolean): Promise<ActionResult<unknown>>;
 post(chatId: string, input: MessageInput): Promise<ActionResult<unknown>>;
 read(chatId: string): Promise<ActionResult<unknown>>;
 vote(chatId: string, messageId: string, optionIds: string[]): Promise<ActionResult<unknown>>;
}
const fail = (message:string): ActionResult<never> => ({ok:false,error:{code:"not-allowed",message}});
const now = () => new Date().toISOString();
export function createSocialRepository(files: MytFilePort, user: CurrentUser | null, base: MytRepository): SocialRepository {
 const actor = () => {if (!user || !realId(user.id)) throw new Error("Sign in to join.");return user.id;};
 async function listing(path: string): Promise<Awaited<ReturnType<MytFilePort["list"]>>> {
  try { return await files.list(path); }
  catch {
   if (path === "data") throw new Error("Couldn't read shared data. Retry.");
   const index = path.lastIndexOf("/");const parent = path.slice(0,index), name=path.slice(index+1);
   const entries = await listing(parent);
   if (entries.some(e=>e.name===name)) throw new Error("Couldn't read a shared folder. Retry.");
   return [];
  }
 }
 function canonical(kind: SocialKind, r: SocialRecord): string | null {
  if (kind === "request" && "createdAt" in r && "fromId" in r) return friendRequestPath(r.fromId,r.toId);
  if (kind === "response" && "respondedAt" in r) return friendResponsePath(r.toId,r.fromId);
  if (kind === "meet" && "passedIds" in r) return meetPath(r.userId);
  if (kind === "blocks" && "blockedIds" in r) return blocksPath(r.userId);
  if (kind === "message" && "kind" in r) return messagePath(r.chatId,r.authorId,r.id);
  if (kind === "read" && "lastReadAt" in r) return chatReadPath(r.chatId,r.userId);
  if (kind === "pollVote" && "voterId" in r) return pollVotePath(r.chatId,r.messageId,r.voterId);
  return null;
 }
 async function records(root: string, kind: SocialKind, issues: RecordIssue[], exact?: string): Promise<SocialRecord[]> {
  const out: SocialRecord[]=[];
  for (const entry of await listing(root)) {
   if (entry.kind === "folder") { if (!exact) out.push(...await records(entry.path,kind,issues)); continue; }
   if (!entry.name.endsWith(".json") || (exact && entry.path !== exact)) continue;
   let text: string;
   try {text=await files.readText(entry.path);}catch {throw new Error("Couldn't read shared data. Retry.");}
   try {
    const r:unknown=JSON.parse(text);
    if (!isSocialRecord(kind,r) || canonical(kind,r) !== entry.path) throw new Error("Invalid record or path.");
    out.push(r);
   } catch {issues.push({path:entry.path,code:"invalid-record",message:"An invalid social record was excluded."});}
  }
  return out;
 }
 async function basics(issues: RecordIssue[]): Promise<SocialData> {
  const s=emptySocial();
  const [requests,responses,blocked,passed]=await Promise.all([
   records("data/friends/requests","request",issues),records("data/friends/responses","response",issues),
   user ? records("data/blocks","blocks",issues,blocksPath(user.id)) : [],user ? records("data/meet","meet",issues,meetPath(user.id)) : []]);
  s.requests=requests.filter(r=>"fromId" in r && "createdAt" in r);
  s.responses=responses.filter(r=>"respondedAt" in r);
  s.blockedIds=blocked.flatMap(r=>"blockedIds" in r?r.blockedIds:[]);
  s.passedIds=passed.flatMap(r=>"passedIds" in r?r.passedIds:[]);
  return s;
 }
 async function members(chatId: string, s: SocialData): Promise<string[]> {
  if (chatId.startsWith("group:")) {
   const a=chatId.slice(6);const interests=await base.loadInterests(a);
   if(!interests.ok)throw new Error(interests.error.message);
   return groupMembers(a,interests.value.value);
  }
  if (chatId.startsWith("dm:")) {
   const pair=chatId.slice(3).split("|");const a=pair[0],b=pair[1];
   if(pair.length===2 && a && b && dmId(a,b)===chatId && areFriends(a,b,s.requests,s.responses) && !s.blockedIds.includes(a) && !s.blockedIds.includes(b))return [a,b];
  }
  return [];
 }
 async function allowed(chatId:string): Promise<SocialData> {
  const me=actor();const s=await basics([]);
  if(!(await members(chatId,s)).includes(me))throw new Error("Join this activity, or become friends, to open its chat.");
  return s;
 }
 async function put(kind:SocialKind, path:string, r:SocialRecord, overwrite=true): Promise<ActionResult<unknown>> {
  if(!isSocialRecord(kind,r) || canonical(kind,r)!==path)return fail("Invalid record.");
  await files.writeText(path,JSON.stringify(r),{overwrite});return {ok:true,value:r};
 }
 async function safe(run:()=>Promise<ActionResult<unknown>>):Promise<ActionResult<unknown>> {
  try {actor();return await run();}catch(e){return {ok:false,error:{code:"io",message:e instanceof Error?e.message:"Couldn't save. Retry."}};}
 }
 return {
  async load() {
   try {
    const issues:RecordIssue[]=[];const s=await basics(issues);
    if(!user)return {ok:true,value:{value:s,issues}};
    const activities=await base.loadActivities(); if(!activities.ok)return activities;
    const ids:string[]=[];
    const interestFolders = new Set((await listing("data/interests")).filter(e=>e.kind === "folder").map(e=>e.path));
    for(const a of activities.value.value.items) {if(!interestFolders.has(interestFolderPath(a.id)))continue;const id=`group:${a.id}`;if((await members(id,s)).includes(user.id))ids.push(id);}
    const people=new Set(s.requests.flatMap(r=>[r.fromId,r.toId]));
    for(const id of people)if(id!==user.id && !s.blockedIds.includes(id) && areFriends(user.id,id,s.requests,s.responses))ids.push(dmId(user.id,id));
    for(const id of ids) {
     const root=chatFolderPath(id);
     const [messages,reads,votes]=await Promise.all([records(`${root}/messages`,"message",issues),records(`${root}/read`,"read",issues,chatReadPath(id,user.id)),records(`${root}/polls`,"pollVote",issues)]);
     s.messages.push(...messages.filter((r): r is ChatMessage => "kind" in r && r.chatId===id));
     s.reads.push(...reads.filter((r): r is ChatRead => "lastReadAt" in r && r.chatId===id));
     s.votes.push(...votes.filter((r): r is PollVote => "voterId" in r && r.chatId===id));
    }
    s.messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    return {ok:true,value:{value:s,issues}};
   }catch(e){return {ok:false,error:{code:"io",message:e instanceof Error?e.message:"Couldn't load chats."}};}
  },
  request(toId,status) {return safe(async()=>{
   const me=actor();if(!realId(toId)||toId===me)return fail("Only another real student can receive a request.");
   const s=await basics([]);if(s.blockedIds.includes(toId))return fail("Unblock this student first.");
   const old=s.requests.find(r=>r.fromId===me&&r.toId===toId);
   if(status==="pending" && old?.status === "pending")return {ok:true,value:old};
   const priorResponse=s.responses.find(r=>r.fromId===me&&r.toId===toId);
   const createdAt=status==="cancelled"&&old ? old.createdAt : new Date(Math.max(Date.now(), old ? Date.parse(old.createdAt)+1 : 0, priorResponse ? Date.parse(priorResponse.respondedAt)+1 : 0)).toISOString();
   return put("request",friendRequestPath(me,toId),{schemaVersion:1,fromId:me,toId,status,createdAt});
  });},
  respond(fromId,status) {return safe(async()=>{
   const me=actor();const s=await basics([]);
   if(s.blockedIds.includes(fromId)||!s.requests.some(r=>r.fromId===fromId&&r.toId===me&&r.status==="pending"))return fail("This request is no longer available.");
   const request=s.requests.find(r=>r.fromId===fromId&&r.toId===me&&r.status==="pending");
   const respondedAt=new Date(Math.max(Date.now(),request ? Date.parse(request.createdAt)+1 : 0)).toISOString();
   return put("response",friendResponsePath(me,fromId),{schemaVersion:1,fromId,toId:me,status,respondedAt});
  });},
  pass(id,reset=false) {return safe(async()=>{const me=actor();const s=await basics([]);return put("meet",meetPath(me),{schemaVersion:1,userId:me,passedIds:reset?[]:[...new Set([...s.passedIds,id])],updatedAt:now()});});},
  block(id,blocked) {return safe(async()=>{const me=actor();if(!realId(id)||id===me)return fail("Invalid student.");const s=await basics([]);return put("blocks",blocksPath(me),{schemaVersion:1,userId:me,blockedIds:blocked?[...new Set([...s.blockedIds,id])]:s.blockedIds.filter(x=>x!==id),updatedAt:now()});});},
  post(chatId,input) {return safe(async()=>{
   await allowed(chatId);const me=actor();
   if(input.kind==="poll" && !isChatPoll(input.poll))return fail("Check the poll question and options.");
   const r:ChatMessage={schemaVersion:1,id:crypto.randomUUID(),chatId,authorId:me,createdAt:now(),...(input.kind==="text"?{kind:"text",text:input.text.trim()}:{kind:"poll",poll:input.poll})};
   return put("message",messagePath(chatId,me,r.id),r,false);
  });},
  read(chatId) {return safe(async()=>{await allowed(chatId);const me=actor();return put("read",chatReadPath(chatId,me),{schemaVersion:1,chatId,userId:me,lastReadAt:now()});});},
  vote(chatId,messageId,optionIds) {return safe(async()=>{
   await allowed(chatId);const loaded=await this.load();if(!loaded.ok)return loaded;
   const m=loaded.value.value.messages.find(m=>m.chatId===chatId&&m.id===messageId);
   if(!m || m.kind!=="poll" || (!m.poll.multi&&optionIds.length>1) || new Set(optionIds).size!==optionIds.length || optionIds.some(id=>!m.poll.options.some(o=>o.id===id)))return fail("Invalid vote.");
   const me=actor();return put("pollVote",pollVotePath(chatId,messageId,me),{schemaVersion:1,chatId,messageId,voterId:me,optionIds,updatedAt:now()});
  });},
 };
}

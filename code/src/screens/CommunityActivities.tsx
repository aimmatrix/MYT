import { useEffect, useRef, useState } from "react";
import { Button, Field, Panel, Avatar } from "../components/ui";
import { filePort } from "../host";
import type { MytFilePort } from "../data-contract";
import type { CurrentUser } from "../types";

import type { CommunityEvent as EventRecord, CommunityRsvp as ReplyRecord, CommunityRecord as RecordEntry } from "../domain/community";
const DIRECTORY = "data/community";
const key = (value:string) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2,"0")).join("");
function valid(value:any): value is RecordEntry {
 if (!value || typeof value !== "object") return false;
 if (value.kind === "rsvp") return ["eventId","userId","name"].every(field => typeof value[field] === "string") && typeof value.going === "boolean";
 return value.kind === "event" && ["id","title","location","description","hostId","hostName"].every(field => typeof value[field] === "string") && Number.isFinite(Date.parse(value.startsAt)) && Number.isFinite(value.price) && value.price >= 0;
}
export function CommunityActivities({user,demo=false,files=filePort,simulated=false,onChange,onOpenChat}:{user:CurrentUser|null;demo?:boolean;files?:MytFilePort;simulated?:boolean;onChange?:(record:RecordEntry)=>Promise<void>;onOpenChat?:(id:string)=>void}) {
 const [records,setRecords] = useState<RecordEntry[]>(() => demo ? [
  {kind:"event",id:"football",title:"Five-a-side at the rented pitch",location:"Hendon football pitches",startsAt:new Date(Date.now()+86400000*2).toISOString(),price:8,description:"Pitch booked for an hour. All levels welcome, bring trainers and a water bottle.",hostId:"alex",hostName:"Alex"},
  ...["Alex","Maya","Sam"].map(name => ({kind:"rsvp" as const,eventId:"football",userId:name.toLowerCase(),name,going:true}))
 ] : []);
 const [loaded,setLoaded]=useState(demo);
 const [error,setError]=useState("");
 const [creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false);
 const pending=useRef(false);
 const [title,setTitle]=useState("");
 const [location,setLocation]=useState("");
 const [date,setDate]=useState("");
 const [price,setPrice]=useState("0");
 const [description,setDescription]=useState("");
 useEffect(() => {
  if(demo)return;
  let active=true;
  let revision=0;
  async function refresh() {
   const request=++revision;
   try {
    const root=await files.list("data");
    const entries=root.some(entry=>entry.path===DIRECTORY) ? await files.list(DIRECTORY) : [];
    const next:RecordEntry[]=[];
    for(const entry of entries.filter(entry=>entry.kind==="file"&&entry.path.endsWith(".json"))){
     const value=JSON.parse(await files.readText(entry.path));
     if(!valid(value))throw new Error("An activity record could not be read.");
     next.push(value);
    }
    if(active&&request===revision){setRecords(next);setLoaded(true);setError("");}
   }catch{if(active&&request===revision)setError("Couldn't load activities. Try again by reopening this screen.");}
  }
  void refresh();
  const unsubscribe=files.watch("data",change=>{if(change.path.startsWith(DIRECTORY))void refresh();});
  return()=>{active=false;unsubscribe();};
 },[demo,files]);
 async function save(record:RecordEntry) {
  const path=record.kind==="event" ? DIRECTORY+"/event-"+key(record.id)+".json" : DIRECTORY+"/rsvp-"+key(record.eventId)+"-"+key(record.userId)+".json";
  if(!demo)await files.writeText(path,JSON.stringify(record),{overwrite:record.kind==="rsvp"});
  if(onChange)await onChange(record);
  setRecords(previous=>[...previous.filter(item=>record.kind==="event" ? !(item.kind==="event"&&item.id===record.id) : !(item.kind==="rsvp"&&item.eventId===record.eventId&&item.userId===record.userId)),record]);
 }
 async function run(action:()=>Promise<void>) {
  if(pending.current)return;
  pending.current=true;setBusy(true);setError("");
  try{await action();}catch{setError("Couldn't save. Your changes are still here, please try again.");}
  finally{pending.current=false;setBusy(false);}
 }
 const events=records.filter((record):record is EventRecord=>record.kind==="event").sort((first,second)=>Date.parse(first.startsAt)-Date.parse(second.startsAt));
 const canCreate=!!title.trim()&&!!location.trim()&&Date.parse(date)>Date.now()&&price.trim()!==""&&Number.isFinite(Number(price))&&Number(price)>=0&&Number(price)<=10000;
 return <section className="myt-stack myt-community">
 <div className="myt-row"><div><h2>Make a plan</h2><p className="myt-muted">Host an activity. Let your people opt in.</p></div><Button variant="primary" disabled={!user||!loaded} onClick={()=>setCreating(true)}>Create activity</Button></div>
 {!user?<p>Sign in to create or join activities.</p>:null}
 {error?<p role="alert">{error}</p>:null}
 {creating?<Panel title="Your next get-together"><div className="myt-stack">
 <Field label="Activity name" value={title} maxLength={100} onChange={setTitle}/>
 <Field label="Where are we meeting?" value={location} maxLength={200} onChange={setLocation}/>
 <label className="myt-budget">Date and time (your local time)<input aria-label="Date and time" type="datetime-local" value={date} onChange={event=>setDate(event.target.value)}/></label>
 <Field label="Cost per person (£)" type="number" value={price} onChange={setPrice}/>
 <Field label="Details" value={description} maxLength={1200} onChange={setDescription}/>
 <p className="myt-small myt-muted">Use a future date and a cost of £0 or more. Creating a plan does not book a venue or collect payment.</p>
 <div className="myt-actions"><Button variant="primary" pending={busy} disabled={!canCreate||!user} onClick={()=>void run(async()=>{
  if(!user||!canCreate)return;
  const createdId=crypto.randomUUID();
  await save({kind:"event",id:createdId,title:title.trim(),location:location.trim(),startsAt:new Date(date).toISOString(),price:Math.round(Number(price)*100)/100,description:description.trim(),hostId:user.id,hostName:user.name});
  setCreating(false);setTitle("");setLocation("");setDate("");setPrice("0");setDescription("");
  onOpenChat?.(createdId);
 })}>Publish activity</Button><Button disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button></div>
 </div></Panel>:null}
 {!loaded&&!error?<p role="status">Loading activities…</p>:null}
 {loaded&&!events.length?<p className="myt-muted">A football pitch, a cinema trip, coffee after class. Be the first to host.</p>:null}
 {events.map(event=>{
  const replies=records.filter((record):record is ReplyRecord=>record.kind==="rsvp"&&record.eventId===event.id&&record.going&&record.userId!==event.hostId);
  const members=[{userId:event.hostId,name:event.hostName},...replies];
  const joined=members.some(member=>member.userId===user?.id);
  const ended=Date.parse(event.startsAt)<=Date.now();
  return <Panel key={event.id} title={event.title}><div className="myt-stack">
  <p>{event.location} · {new Date(event.startsAt).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</p>
  <p><strong>{event.price===0?"Free":"£"+event.price.toFixed(2)+" per person"}</strong> · Hosted by {event.hostName}</p>
  <p>{event.description}</p><div className="myt-members">{members.map(member=><span key={member.userId} className="myt-member"><Avatar name={member.name}/><span>{member.name}</span></span>)}</div>
  <p>{members.length} going{demo||simulated?" · Fictional demo participants":""}</p>
  <Button disabled={!user||busy||ended||user.id===event.hostId} variant={joined?"secondary":"primary"} onClick={()=>void run(async()=>{if(user){await save({kind:"rsvp",eventId:event.id,userId:user.id,name:user.name,going:!joined});if(!joined)onOpenChat?.(event.id);}})}>{ended?"Activity started":user?.id===event.hostId?"You're hosting":joined?"Leave activity":"Join activity"}</Button>
  {joined&&onOpenChat?<Button onClick={()=>onOpenChat(event.id)}>Open group chat →</Button>:null}
  </div></Panel>;
 })}
 </section>;
}

import { useEffect, useRef, useState } from "react";
import type { OnboardingProps } from "../ui-contract";
import type { FreeSlot, InterestId, ProfileInput } from "../types";
import { Button, Chip, Field, Panel, ProgressSteps } from "../components/ui";
import { DAYS, UNIVERSITIES, profilePreferences } from "../domain/preferences";
import { Onboarding as LegacyPreferences } from "./LegacyPreferences";
const INTERESTS: {id:InterestId; label:string}[] = [{id:"football",label:"⚽ Football"},{id:"karting",label:"⚑ Karting"},{id:"cinema",label:"▤ Cinema"},{id:"music",label:"♫ Gigs"},{id:"social",label:"♧ Socials"},{id:"fitness",label:"↗ Fitness"},{id:"comedy",label:"☺ Comedy"},{id:"theatre",label:"◇ Theatre"}];
export function Onboarding(props: OnboardingProps) {
 const saved = props.profile.state === "ready" ? props.profile.value : null;
 if (props.mode === "preview" || !props.currentUser || props.profile.state !== "ready") return <LegacyPreferences {...props} />;
 return <OnboardingFlow key={props.currentUser.id} {...props} saved={saved} />;
}
function OnboardingFlow({saved, ...props}: OnboardingProps & {saved: import("../types").Profile | null}) {
 const [step,setStep] = useState(saved ? 2 : 1);
 const [name,setName] = useState(saved?.displayName ?? props.currentUser?.name.split(" ")[0] ?? "");
 const [email,setEmail] = useState("student@demo.ac.uk");
 const [codeSent,setCodeSent] = useState(false);
 const [code,setCode] = useState("");
 const [verified,setVerified] = useState(false);
 const [uni,setUni] = useState(saved?.universityId ?? "mdx");
 const [year,setYear] = useState<NonNullable<ProfileInput["yearOfStudy"]>>(saved?.yearOfStudy ?? "1");
 const [slots,setSlots] = useState<FreeSlot[]>(saved?.freeSlots ?? [...(saved?.availability.includes("weekday-evening") ? ["tue-eve" as const] : []), ...(saved?.availability.includes("weekend-day") ? ["sat-day" as const] : []), ...(saved?.availability.includes("weekend-evening") ? ["sat-eve" as const] : [])]);
 const [budget,setBudget] = useState(saved ? saved.budgetPence === null ? 50 : Math.min(50, saved.budgetPence / 100) : 15);
 const [interests,setInterests] = useState<InterestId[]>(saved?.interestIds ?? []);
 const [error,setError] = useState("");
 const [busy,setBusy] = useState(false);
 const saving = useRef(false);
 const [ready,setReady] = useState(false);
 const [uniQuery,setUniQuery] = useState("");
 useEffect(() => { if (step !== 5) return; const timer = setTimeout(() => setReady(true), 900); return () => clearTimeout(timer); }, [step]);
 const validEmail = /^[^@\s]+@[^@\s]+\.ac\.uk$/i.test(email.trim());
 async function save() {
  if (!props.onSave || saving.current) return;
  saving.current = true; setBusy(true); setError("");
  try {
   const input = profilePreferences({displayName:name.trim(),university:UNIVERSITIES.find(u => u.id === uni)?.name ?? "Other",universityId:uni,yearOfStudy:year,freeSlots:slots,interestIds:interests,availability:saved?.availability ?? [],budgetPence:budget === 50 ? null : budget * 100});
   const result = await props.onSave(input);
   if (result.ok) setStep(5); else setError(result.error.message);
  } catch { setError("Couldn't save. Your answers are still here; try again."); }
  finally {saving.current = false;setBusy(false);}
 }
 return <div className="myt-onboard"><ProgressSteps step={step}/>
 {step === 1 ? <><div className="myt-big-mark" aria-label="myt">myt<span aria-hidden="true">✳</span></div><h1>Find your people.<br/>Make your plans.</h1><p className="myt-muted">Your London starts here.</p><Field label="First name" value={name} maxLength={60} onChange={setName}/><Field label="Uni email" type="email" value={email} maxLength={254} onChange={v => {setEmail(v);setCodeSent(false);setVerified(false);}} hint="Demo only: no email is sent. Your email stays in this form."/>
 {codeSent && !verified ? <Panel title="Check your inbox (demo)"><div className="myt-stack"><p>Use demo code <strong>123456</strong>. No message was sent.</p><Field label="Verification code" inputMode="numeric" maxLength={6} value={code} onChange={setCode}/><Button disabled={code !== "123456"} onClick={() => setVerified(true)}>Verify demo code</Button></div></Panel> : null}
 {verified ? <p role="status">✓ Student verified · simulated for this demo</p> : null}
 <div className="myt-actions"><Button fullWidth variant="primary" disabled={!name.trim() || !validEmail} onClick={() => verified ? setStep(2) : setCodeSent(true)}>{verified ? "Continue →" : codeSent ? "Resend demo code" : "Send my code →"}</Button>{props.onEnterPreview ? <Button fullWidth variant="quiet" onClick={props.onEnterPreview}>Explore the preview</Button> : null}</div></> : null}
 {step === 2 ? <><h1>{saved ? "Your preferences" : "Where's your campus?"}</h1><p className="myt-muted">Find students on your wavelength, across London.</p>{saved ? <Field label="Display name" value={name} onChange={setName} maxLength={60}/> : null}<Field label="Search universities" type="search" value={uniQuery} onChange={setUniQuery}/><div className="myt-stack">{UNIVERSITIES.filter(u => u.name.toLowerCase().includes(uniQuery.toLowerCase())).map(u => <Chip key={u.id} selected={uni===u.id} onSelectedChange={() => setUni(u.id)}>{u.name}</Chip>)}</div><Field label="Year of study" control="select" value={year} onChange={v => {if(v==="1"||v==="2"||v==="3+"||v==="postgrad")setYear(v);}} options={[{value:"1",label:"1st year"},{value:"2",label:"2nd year"},{value:"3+",label:"3rd year+"},{value:"postgrad",label:"Postgrad"}]}/><div className="myt-actions"><Button fullWidth variant="primary" disabled={!name.trim()} onClick={() => setStep(3)}>Continue →</Button>{saved ? <Button onClick={() => props.onNavigate({name:"discover"})}>Cancel</Button> : null}</div></> : null}
 {step === 3 ? <><h1>When's your<br/>free time?</h1><p className="myt-muted">Pick the slots that usually work. You can change these later.</p><p>☀ Daytime</p><div className="myt-slot-grid">{DAYS.map(d => {const slot:FreeSlot=`${d}-day`;return <button key={slot} type="button" aria-label={`${d} daytime`} aria-pressed={slots.includes(slot)} onClick={() => setSlots(s => s.includes(slot) ? s.filter(x=>x!==slot) : [...s,slot])}>{d}</button>;})}</div><p>☾ Evening</p><div className="myt-slot-grid">{DAYS.map(d => {const slot:FreeSlot=`${d}-eve`;return <button key={slot} type="button" aria-label={`${d} evening`} aria-pressed={slots.includes(slot)} onClick={() => setSlots(s => s.includes(slot) ? s.filter(x=>x!==slot) : [...s,slot])}>{d}</button>;})}</div><label className="myt-budget">Usual spend per person <strong>{budget === 0 ? "Free" : budget === 50 ? "£50+" : `Up to £${budget}`}</strong><input aria-label="Usual spend per person" type="range" min="0" max="50" step="1" value={budget} aria-valuetext={budget === 0 ? "Free" : budget === 50 ? "£50 or more, no limit" : `Up to £${budget}`} onChange={event => setBudget(Number(event.target.value))}/><span className="myt-row"><span>Free</span><span>£25</span><span>£50+</span></span><small>£50+ includes any price.</small></label><div className="myt-actions"><Button onClick={()=>setStep(2)}>Back</Button><Button variant="primary" onClick={()=>setStep(4)}>Continue →</Button></div></> : null}
 {step === 4 ? <><h1>What are<br/>you into?</h1><p className="myt-muted">Pick a few. We'll take it from here.</p><div className="myt-chip-group">{INTERESTS.map(i => <Chip key={i.id} tone={i.id} selected={interests.includes(i.id)} onSelectedChange={on => setInterests(s => on ? [...s,i.id] : s.filter(x=>x!==i.id))}>{i.label}</Chip>)}</div>{error ? <p role="alert" className="myt-banner" data-tone="danger">{error}</p> : null}<div className="myt-actions"><Button disabled={busy} onClick={()=>setStep(3)}>Back</Button><Button variant="primary" disabled={interests.length === 0 || !props.onSave} pending={busy} onClick={save}>{saved ? "Save preferences" : "Find my people →"}</Button></div></> : null}
 {step === 5 ? <><div className="myt-radar" aria-hidden="true"/><h1>{ready ? "You're all set." : "Finding your people…"}</h1><div role="status" className="myt-stack"><p>✓ Reading your free time</p><p>✓ Finding plans that fit</p><p>{ready ? "✓ Ready to explore London" : "Matching your interests…"}</p></div><p className="myt-muted">Saved on this device. Find plans and meet other students.</p><Button fullWidth variant="primary" disabled={!ready} onClick={()=>props.onNavigate({name:"discover"})}>Let's go →</Button></> : null}
 </div>;
}

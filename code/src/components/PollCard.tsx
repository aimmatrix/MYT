import { useState } from "react";
import type { ChatMessage, PollVote } from "../types";
import { BottomSheet, Button } from "./ui";
import { pollTally, togglePollVote } from "../domain/social";
export function PollCard({message,votes,me,names,onVote}: {message:ChatMessage & {kind:"poll"};votes:PollVote[];me:string|null;names:Record<string,string>;onVote?:(ids:string[])=>void}) {
 const [show,setShow]=useState(false);
 const tally=pollTally(message.poll,votes);
 const mine=votes.find(v=>v.voterId===me)?.optionIds ?? [];
 return <div className="myt-poll">{message.authorId===me&&Date.now()-Date.parse(message.createdAt)<60000?<span className="myt-new-poll">NEW POLL</span>:null}<h3>{message.poll.question}</h3>{tally.options.map(o=><button type="button" className="myt-poll-option" key={o.id} aria-pressed={mine.includes(o.id)} disabled={!onVote} onClick={()=>onVote?.(togglePollVote(message.poll,mine,o.id))}><span style={{width:`${o.percent}%`}}/>{mine.includes(o.id)?"✓ ":""}{o.label} · {o.percent}%</button>)}<p className="myt-small myt-muted">{tally.voters} {tally.voters===1?"vote":"votes"} · {message.poll.multi?"Pick any":"Pick one"}{message.poll.anonymous?" · Anonymous":""}</p>{message.poll.anonymous?<p className="myt-small myt-muted">Names hidden here. Votes remain readable in shared files.</p>:<Button size="sm" variant="quiet" onClick={()=>setShow(true)}>See who voted</Button>}{show?<BottomSheet title="Who voted" onClose={()=>setShow(false)}>{votes.filter(v=>v.optionIds.length).map(v=><p key={v.voterId}>{names[v.voterId]??"Student"}: {v.optionIds.map(id=>message.poll.options.find(o=>o.id===id)?.label).join(", ")}</p>)}{!tally.voters?<p>No votes yet.</p>:null}</BottomSheet>:null}</div>;
}

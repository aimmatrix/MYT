import type { ChatMessage, ChatPoll, FriendRequest, FriendResponse, InterestRecord, PollVote, SocialData } from "../types";
import { isValidId } from "./identifiers";
export const realId = (id: string) => isValidId(id) && !id.startsWith("sample:") && !id.startsWith("preview:");
export const emptySocial = (): SocialData => ({requests:[],responses:[],passedIds:[],blockedIds:[],messages:[],reads:[],votes:[]});
export function areFriends(a: string, b: string, requests: readonly FriendRequest[], responses: readonly FriendResponse[]): boolean {
 return realId(a) && realId(b) && requests.some(r => r.status === "pending" && ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)) && responses.some(s => s.fromId === r.fromId && s.toId === r.toId && s.status === "accepted" && Date.parse(s.respondedAt) >= Date.parse(r.createdAt)));
}
export function dmId(a: string, b: string): string {
 if (a === b || !realId(a) || !realId(b) || a.includes("|") || b.includes("|")) throw new Error("These accounts cannot form a direct chat.");
 const id = `dm:${[a,b].sort().join("|")}`;
 if (!isValidId(id)) throw new Error("The direct chat ID exceeds the supported length.");
 return id;
}
export function groupMembers(activityId: string, records: readonly InterestRecord[]): string[] {
 const latest = new Map<string, InterestRecord>();
 for (const r of records) if (r.activityId === activityId && realId(r.userId) && (!latest.has(r.userId) || Date.parse(r.updatedAt) > Date.parse(latest.get(r.userId)!.updatedAt))) latest.set(r.userId,r);
 return [...latest.values()].filter(r => r.status === "interested").map(r => r.userId).sort();
}
export function validPoll(poll: ChatPoll): boolean {
 return poll.question === poll.question.trim() && poll.question.length >= 1 && poll.question.length <= 80 && poll.options.length >= 2 && poll.options.length <= 6 && new Set(poll.options.map(o=>o.id)).size === poll.options.length && poll.options.every(o => isValidId(o.id) && o.label === o.label.trim() && o.label.length >= 1 && o.label.length <= 40) && typeof poll.multi === "boolean" && typeof poll.anonymous === "boolean";
}
export function togglePollVote(poll: ChatPoll, current: readonly string[], optionId: string): string[] {
 if (!poll.options.some(o=>o.id===optionId)) return [...current];
 return poll.multi ? current.includes(optionId) ? current.filter(id=>id!==optionId) : [...current,optionId] : current.includes(optionId) ? [] : [optionId];
}
export function pollTally(poll: ChatPoll, votes: readonly PollVote[]) {
 const valid = votes.filter(v => realId(v.voterId) && new Set(v.optionIds).size === v.optionIds.length && (poll.multi || v.optionIds.length <= 1) && v.optionIds.every(id=>poll.options.some(o=>o.id===id)));
 const latest = new Map<string, PollVote>();
 for (const v of valid) if (!latest.has(v.voterId) || Date.parse(v.updatedAt) > Date.parse(latest.get(v.voterId)!.updatedAt)) latest.set(v.voterId,v);
 const active = [...latest.values()].filter(v=>v.optionIds.length > 0);
 return { voters:active.length, options:poll.options.map(o => ({...o,count:active.filter(v=>v.optionIds.includes(o.id)).length,percent:active.length ? Math.round(active.filter(v=>v.optionIds.includes(o.id)).length / active.length * 100) : 0})) };
}
export function unreadCount(messages: readonly ChatMessage[], chatId: string, me: string, lastReadAt?: string): number {
 const after = lastReadAt ? Date.parse(lastReadAt) : 0;
 return messages.filter(m=>m.chatId === chatId && m.authorId !== me && Date.parse(m.createdAt) > after).length;
}

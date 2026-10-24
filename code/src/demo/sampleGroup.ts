import { useSyncExternalStore } from "react";
import type { ChatMessage, ChatPoll, ChatRead, PollVote, SocialData } from "../types";
import type { MessageInput, SocialRepository } from "../data/socialRepository";
import { simulateChat, simulatePollVotes } from "../ai/client";
import { realId, validPoll } from "../domain/social";
import { DEMO_CAST } from "./identity";

/*
 * A pre-filled group chat for showing how MYT chats look. Its members are the labelled "(demo)"
 * cast, its history is written here, and nothing is ever saved to shared files: joining, posting
 * and voting live in memory for the session. Every real chat still goes through the social
 * repository untouched.
 */

export const SAMPLE_GROUP_ID = "sample-group:saturday-football";
export const SAMPLE_GROUP_NAME = "Saturday football crew";
export const SAMPLE_GROUP_BLURB = "Watching a match together this weekend";
/** A stand-in for a signed-out or preview viewer, so their messages and votes still count. */
export const SAMPLE_GUEST_ID = "demo-guest-you";

const CAST = Object.fromEntries(DEMO_CAST.map((m) => [m.id.replace("demo-cast-", ""), m]));
const MEMBERS = ["jamal", "leo", "ben", "priya", "amara"] as const;
type Member = (typeof MEMBERS)[number];
const idOf = (m: Member) => CAST[m].id;

export const SAMPLE_MEMBER_IDS: readonly string[] = MEMBERS.map(idOf);
export const SAMPLE_ONLINE_IDS: readonly string[] = [idOf("jamal"), idOf("leo"), idOf("priya")];
export const SAMPLE_NAMES: Record<string, string> = Object.fromEntries(MEMBERS.map((m) => [idOf(m), CAST[m].name]));

const POLL: ChatPoll = {
  question: "Which kick-off works?",
  options: [
    { id: "sat-1230", label: "Sat 12:30" },
    { id: "sat-1500", label: "Sat 15:00" },
    { id: "sun-1400", label: "Sun 14:00" },
  ],
  multi: false,
  anonymous: false,
};

const MINUTE = 60_000;

/** The conversation that is already under way, oldest first, with ages in minutes before "now". */
const SCRIPT: Array<{ id: string; by: Member; ago: number; text?: string; poll?: ChatPoll }> = [
  { id: "m1", by: "jamal", ago: 1560, text: "Right, who's actually up for a match this weekend? ⚽" },
  { id: "m2", by: "leo", ago: 1552, text: "Me! Been wanting to go all season." },
  { id: "m3", by: "priya", ago: 1541, text: "I'm in. I've never been to a proper game, so go easy on me 😅" },
  { id: "m4", by: "ben", ago: 1530, text: "Ha, we'll look after you. Do we want to sit together or just meet before?" },
  { id: "m5", by: "jamal", ago: 1522, text: "Sit together if we can. I'll check what's available." },
  { id: "m6", by: "amara", ago: 1180, text: "Just seen this. Count me in too! Anything under £30 is good for me." },
  { id: "m7", by: "leo", ago: 1171, text: "Student tickets are usually around that, fingers crossed 🤞" },
  { id: "m8", by: "ben", ago: 640, poll: POLL },
  { id: "m9", by: "priya", ago: 612, text: "Voted! Afternoon is easier for me, I have a lecture in the morning." },
  { id: "m10", by: "amara", ago: 540, text: "Same, 15:00 is perfect." },
  { id: "m11", by: "jamal", ago: 95, text: "Looks like 15:00 is winning. Meeting point? Somewhere public near the station?" },
  { id: "m12", by: "leo", ago: 71, text: "Station entrance, 30 mins before? We can grab food after." },
  { id: "m13", by: "ben", ago: 18, text: "Sounds good to me. I'll be the one in the blue scarf 💙" },
  { id: "m14", by: "priya", ago: 7, text: "Can't wait! See you all there 🎉" },
];

/** Who voted for what on the poll, so it opens with real-looking results. */
const SEED_VOTES: Array<{ by: Member; option: string; ago: number }> = [
  { by: "jamal", option: "sat-1500", ago: 600 },
  { by: "priya", option: "sat-1500", ago: 610 },
  { by: "amara", option: "sat-1500", ago: 538 },
  { by: "leo", option: "sat-1230", ago: 590 },
  { by: "ben", option: "sat-1500", ago: 620 },
];

const REPLIES: Array<{ by: Member; text: string }> = [
  { by: "jamal", text: "Nice one! 👊" },
  { by: "leo", text: "Haha yes, agreed." },
  { by: "priya", text: "Love that, can't wait!" },
  { by: "ben", text: "Good shout. See you Saturday." },
  { by: "amara", text: "Perfect, I'm in 🙌" },
];

interface State {
  joined: boolean;
  joinedAt: number;
  mine: ChatMessage[];
  replies: ChatMessage[];
  votes: PollVote[];
  aiVotes: PollVote[];
  aiPollBusy: string[];
  aiPollErrors: Record<string,string>;
  readAt: string | null;
  typing: string | null;
  replyCount: number;
  aiEnabled: boolean;
  aiBusy: boolean;
  aiError: string;
}

let state: State = { joined: false, joinedAt: 0, mine: [], replies: [], votes: [], aiVotes: [], aiPollBusy: [], aiPollErrors: {}, readAt: null, typing: null, replyCount: 0, aiEnabled: false, aiBusy: false, aiError: "" };
// The history is timed from the moment the module loads, so it reads as "earlier today" and "yesterday".
const BASE = Date.now();
const listeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const at = (agoMinutes: number) => new Date(BASE - agoMinutes * MINUTE).toISOString();
let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const HISTORY: ChatMessage[] = SCRIPT.map((m) => ({
  schemaVersion: 1,
  id: m.id,
  chatId: SAMPLE_GROUP_ID,
  authorId: idOf(m.by),
  createdAt: at(m.ago),
  ...(m.poll ? { kind: "poll" as const, poll: m.poll } : { kind: "text" as const, text: m.text ?? "" }),
}));
const POLL_MESSAGE_ID = SCRIPT.find((m) => m.poll)!.id;
const HISTORY_VOTES: PollVote[] = SEED_VOTES.map((v) => ({
  schemaVersion: 1,
  chatId: SAMPLE_GROUP_ID,
  messageId: POLL_MESSAGE_ID,
  voterId: idOf(v.by),
  optionIds: [v.option],
  updatedAt: at(v.ago),
}));

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const getSnapshot = () => state;
export const useSampleGroup = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const joinSampleGroup = () => {
  if (!state.joined) set({ joined: true, joinedAt: Date.now() });
};
export function leaveSampleGroup() {
  cancelAi(); cancelPollVotes();
  timers.forEach(clearTimeout);
  timers.clear();
  set({ joined: false, mine: [], replies: [], votes: [], aiVotes: [], aiPollBusy: [], aiPollErrors: {}, readAt: null, typing: null, replyCount: 0, aiEnabled: false, aiBusy: false, aiError: "" });
}

/** The sample chat's messages, votes and read marker, to merge into the real social data. */
export function sampleSocial(s: State, me: string): Pick<SocialData, "messages" | "votes" | "reads"> {
  if (!s.joined) return { messages: [], votes: [], reads: [] };
  const reads: ChatRead[] = s.readAt ? [{ schemaVersion: 1, chatId: SAMPLE_GROUP_ID, userId: me, lastReadAt: s.readAt }] : [];
  const messages = [...HISTORY, ...s.replies, ...s.mine.map((m) => ({ ...m, authorId: me }))].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return { messages, votes: [...HISTORY_VOTES, ...s.aiVotes, ...s.votes.map((v) => ({ ...v, voterId: me }))], reads };
}

function scheduleReply() {
  const reply = REPLIES[state.replyCount % REPLIES.length];
  const clear = (t: ReturnType<typeof setTimeout>) => void timers.delete(t);
  const start = setTimeout(() => {
    clear(start);
    set({ typing: idOf(reply.by) });
    const finish = setTimeout(() => {
      clear(finish);
      const message: ChatMessage = {
        schemaVersion: 1, id: uid("r"), chatId: SAMPLE_GROUP_ID, authorId: idOf(reply.by), createdAt: new Date().toISOString(), kind: "text", text: reply.text,
      };
      set({ typing: null, replies: [...state.replies, message], replyCount: state.replyCount + 1 });
    }, 1800);
    timers.add(finish);
  }, 900);
  timers.add(start);
}

const ok = { ok: true as const, value: null };

/**
 * Routes actions for the sample chat into the in-memory store. Anything for another chat goes to
 * the real repository, or is refused when there is none (signed out, preview).
 */
export function withSampleGroup(base: SocialRepository | null, me: string): SocialRepository {
  const refuse = async () => ({ ok: false as const, error: { code: "not-signed-in" as const, message: "Sign in to do this." } });
  const sampleOnly = async () => ({ ok: false as const, error: { code: "not-allowed" as const, message: "Sample students can't be blocked or messaged outside this demo chat." } });
  return {
    load: () => (base ? base.load() : Promise.resolve({ ok: true, value: { value: { requests: [], responses: [], passedIds: [], blockedIds: [], messages: [], reads: [], votes: [] }, issues: [] } })),
    request: (to, status) => (base ? base.request(to, status) : refuse()),
    respond: (from, status) => (base ? base.respond(from, status) : refuse()),
    pass: (id, reset) => (base ? base.pass(id, reset) : refuse()),
    block: (id, blocked) => (SAMPLE_MEMBER_IDS.includes(id) ? sampleOnly() : base ? base.block(id, blocked) : refuse()),
    async post(chatId: string, input: MessageInput) {
      if (chatId !== SAMPLE_GROUP_ID) return base ? base.post(chatId, input) : refuse();
      if (input.kind === "poll" && !validPoll(input.poll)) return {ok:false as const,error:{code:"not-allowed" as const,message:"Add a valid question and 2–6 options."}};
      const text = input.kind === "text" ? input.text.trim() : "";
      const message: ChatMessage = {
        schemaVersion: 1, id: uid("u"), chatId, authorId: me, createdAt: new Date().toISOString(),
        ...(input.kind === "text" ? { kind: "text" as const, text } : { kind: "poll" as const, poll: input.poll }),
      };
      set({ mine: [...state.mine, message], readAt: message.createdAt });
      if (input.kind === "text") { if (state.aiEnabled) void scheduleAiReply(me); else scheduleReply(); }
      if (input.kind === "poll" && state.aiEnabled) void scheduleAiPollVotes(message as ChatMessage & {kind:"poll"},me);
      return ok;
    },
    async read(chatId: string) {
      if (chatId !== SAMPLE_GROUP_ID) return base ? base.read(chatId) : refuse();
      set({ readAt: new Date().toISOString() });
      return ok;
    },
    async vote(chatId: string, messageId: string, optionIds: string[]) {
      if (chatId !== SAMPLE_GROUP_ID) return base ? base.vote(chatId, messageId, optionIds) : refuse();
      const vote: PollVote = { schemaVersion: 1, chatId, messageId, voterId: me, optionIds, updatedAt: new Date().toISOString() };
      set({ votes: [...state.votes.filter((v) => v.messageId !== messageId), vote] });
      return ok;
    },
  };
}

/** The ID used for the viewer inside the sample chat: their own when it is a real account. */
export const sampleViewerId = (me: string) => (realId(me) ? me : SAMPLE_GUEST_ID);

let aiController: AbortController | null = null;
let aiQueue: Promise<void> = Promise.resolve();
function cancelAi() { aiController?.abort(); aiController = null; }
const pollControllers = new Map<string,AbortController>();
function cancelPollVotes() { for (const controller of pollControllers.values()) controller.abort(); pollControllers.clear(); }

export function setSampleAiEnabled(enabled: boolean) {
  cancelAi(); cancelPollVotes(); timers.forEach(clearTimeout); timers.clear();
  set({ aiEnabled: enabled, aiBusy: false, aiError: "", typing: null, aiPollBusy: [], aiPollErrors: {} });
  if (enabled && state.joined) for (const message of state.mine) {
    if (message.kind === "poll" && !state.aiVotes.some(v=>v.messageId===message.id)) void scheduleAiPollVotes(message,message.authorId);
  }
}
function scheduleAiReply(me: string): Promise<void> {
  // A fresh user message supersedes any response still being generated.
  cancelAi();
  const controller = new AbortController(); aiController = controller;
  set({ aiBusy: true, aiError: "", typing: SAMPLE_MEMBER_IDS[state.replyCount % SAMPLE_MEMBER_IDS.length] });
  aiQueue = aiQueue.catch(()=>{}).then(async () => {
    if (controller.signal.aborted) return;
    const timer = setTimeout(()=>controller.abort(),35000);
    try {
      const messages = sampleSocial(state,me).messages.map(m=>({authorId:m.authorId,text:m.kind==="text"?m.text:`Poll: ${m.poll.question}`}));
      const result = await simulateChat(messages,controller.signal);
      for (const reply of result.messages) {
        if (controller.signal.aborted || !state.joined || !state.aiEnabled) return;
        if (!SAMPLE_MEMBER_IDS.includes(reply.authorId)) continue;
        set({ typing: reply.authorId });
        await new Promise<void>(resolve=>setTimeout(resolve,900));
        if (controller.signal.aborted || !state.joined || !state.aiEnabled) return;
        set({ replies:[...state.replies,{schemaVersion:1,id:uid("ai"),chatId:SAMPLE_GROUP_ID,authorId:reply.authorId,createdAt:new Date().toISOString(),kind:"text",text:reply.text}],replyCount:state.replyCount+1 });
      }
    } catch (e) { if (aiController===controller && state.aiEnabled) set({aiError:e instanceof Error?e.message:"AI chat unavailable."}); }
    finally { clearTimeout(timer); if(aiController===controller){aiController=null;set({aiBusy:false,typing:null});} }
  });
  return aiQueue;
}
export function retrySampleAi(me: string) { if(state.aiEnabled && !state.aiBusy) void scheduleAiReply(me); }

async function scheduleAiPollVotes(message: ChatMessage & {kind:"poll"}, me: string) {
  const id=message.id;
  pollControllers.get(id)?.abort();
  const controller=new AbortController();pollControllers.set(id,controller);
  set({aiPollBusy:[...state.aiPollBusy.filter(x=>x!==id),id],aiPollErrors:{...state.aiPollErrors,[id]:""}});
  const timer=setTimeout(()=>controller.abort(),35000);
  const current=()=>pollControllers.get(id)===controller && state.joined && state.aiEnabled;
  try {
    const messages=sampleSocial(state,me).messages.map(m=>({authorId:m.authorId,text:m.kind==="text"?m.text:`Poll: ${m.poll.question}`}));
    const result=await simulatePollVotes(message.poll,messages,controller.signal);
    if (!current() || controller.signal.aborted) return;
    const seen=new Set<string>();
    const votes:PollVote[]=result.votes.filter(v=>SAMPLE_MEMBER_IDS.includes(v.voterId) && !seen.has(v.voterId) && Array.isArray(v.optionIds) && v.optionIds.every(optionId=>message.poll.options.some(o=>o.id===optionId)) && new Set(v.optionIds).size===v.optionIds.length && (message.poll.multi||v.optionIds.length<=1) && !!seen.add(v.voterId)).map(v=>({schemaVersion:1,chatId:SAMPLE_GROUP_ID,messageId:id,voterId:v.voterId,optionIds:v.optionIds,updatedAt:new Date().toISOString()}));
    if (!votes.length) throw new Error("The demo students couldn't vote on this poll. Try again.");
    set({aiVotes:[...state.aiVotes.filter(v=>v.messageId!==id),...votes]});
  } catch(e) { if(current())set({aiPollErrors:{...state.aiPollErrors,[id]:e instanceof Error?e.message:"AI voting failed. Try again."}}); }
  finally { clearTimeout(timer);if(pollControllers.get(id)===controller){pollControllers.delete(id);set({aiPollBusy:state.aiPollBusy.filter(x=>x!==id)});} }
}
export function retrySamplePollVotes(messageId:string,me:string) {
  if(!state.aiEnabled || state.aiPollBusy.includes(messageId))return;
  const message=state.mine.find(m=>m.id===messageId);
  if(message?.kind==="poll")void scheduleAiPollVotes(message,me);
}

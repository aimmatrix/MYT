import type { FileEntry, MytFilePort } from "../data-contract";
import type { ChatMessage, CurrentUser, FreeSlot, InterestId, Profile, ProfileInput } from "../types";
import { createAppRepository } from "../wiring/appRepository";
import { createSocialRepository } from "../data/socialRepository";
import { areFriends, dmId, groupMembers, realId } from "../domain/social";
import { getFutureTimeOptions } from "../domain/londonTime";
import { keyForId } from "../domain/identifiers";
import {
  ATTENDANCE_DIR, CHATS_DIR, FRIENDS_DIR, INTERESTS_DIR, VOTES_DIR,
  blocksPath, chatFolderPath, meetPath, profilePath,
} from "../paths";
import { DEMO_IDS, DEMO_PARTNER_ID, DEMO_PARTNER_NAME } from "./identity";

/*
 * Demo partner writer. Alex acts through the app's own repositories, constructed with Alex as the
 * signed-in user, so every record is built, validated and placed exactly as a second real person's
 * would be, and every rule (no joining after a plan, join before voting, friends before a DM)
 * applies to Alex too. Nothing here imports the host SDK, so it runs under a plain file port in tests.
 */

export type DemoOutcome = { ok: true; message: string } | { ok: false; message: string };

export interface DemoPartnerDeps {
  files: MytFilePort;
  /** Deletes a file or folder (folders with their contents). Missing paths are a no-op. */
  remove(path: string): Promise<void>;
  /** The real signed-in user Alex interacts with. */
  meId: string | null;
}

export interface DemoPartner {
  ensureProfile(): Promise<DemoOutcome>;
  join(activityId: string): Promise<DemoOutcome>;
  voteForTime(activityId: string): Promise<DemoOutcome>;
  markGoing(planId: string): Promise<DemoOutcome>;
  sendRequest(): Promise<DemoOutcome>;
  acceptRequest(): Promise<DemoOutcome>;
  reply(chatId: string): Promise<DemoOutcome>;
  voteInLatestPoll(chatId: string): Promise<DemoOutcome>;
  reset(): Promise<DemoOutcome>;
}

export const DEMO_REPLIES = [
  "Hey! Count me in.",
  "That time works for me.",
  "Shall we meet by the station entrance first?",
  "Sounds great, see you there!",
  "Happy to grab food afterwards if anyone is up for it.",
] as const;

const DEFAULT_INTERESTS: InterestId[] = ["football", "cinema", "social", "comedy"];
const DEFAULT_SLOTS: FreeSlot[] = ["fri-eve", "sat-day", "sat-eve", "sun-day"];

/** Alex's profile input, chosen to overlap the real user's interests and free time. */
export function buildDemoProfileInput(mine: Profile | null): ProfileInput {
  const interestIds = mine && mine.interestIds.length > 0 ? mine.interestIds.slice(0, 4) : DEFAULT_INTERESTS;
  const freeSlots = mine && mine.freeSlots && mine.freeSlots.length > 0 ? mine.freeSlots.slice(0, 6) : DEFAULT_SLOTS;
  const sameUni = mine?.universityId === "kcl";
  return {
    displayName: DEMO_PARTNER_NAME,
    university: sameUni ? "University College London" : "King's College London",
    universityId: sameUni ? "ucl" : "kcl",
    yearOfStudy: "2",
    freeSlots,
    budgetBand: "u30",
    interestIds,
    availability: mine && mine.availability.length > 0 ? mine.availability : ["weekend-day", "weekend-evening"],
    budgetPence: 3000,
  };
}

const ok = (message: string): DemoOutcome => ({ ok: true, message });
const fail = (message: string): DemoOutcome => ({ ok: false, message });

export function createDemoPartner(deps: DemoPartnerDeps): DemoPartner {
  const { files, remove, meId } = deps;
  const alex: CurrentUser = { id: DEMO_PARTNER_ID, name: DEMO_PARTNER_NAME };
  const repo = createAppRepository(files, alex);
  const social = createSocialRepository(files, alex, repo);
  const meRepo = meId ? createAppRepository(files, { id: meId, name: "" }) : null;

  function me(): string | null {
    return meId && realId(meId) && meId !== DEMO_PARTNER_ID ? meId : null;
  }

  async function guarded(run: () => Promise<DemoOutcome>): Promise<DemoOutcome> {
    if (!me()) return fail("Sign in first. Alex needs a real account to interact with.");
    try {
      return await run();
    } catch (error) {
      return fail(error instanceof Error && error.message ? error.message : "Not saved. Try again.");
    }
  }

  async function ensureProfile(): Promise<DemoOutcome> {
    const existing = await repo.loadMyProfile();
    if (existing.ok && existing.value.value) return ok(`${DEMO_PARTNER_NAME} is ready.`);
    if (!existing.ok && existing.error.code === "io") return fail(existing.error.message);
    const mine = meRepo ? await meRepo.loadMyProfile() : null;
    const input = buildDemoProfileInput(mine && mine.ok ? mine.value.value : null);
    const saved = await repo.saveProfile(input);
    return saved.ok ? ok(`${DEMO_PARTNER_NAME} joined MYT with a matching profile.`) : fail(saved.error.message);
  }

  async function withProfile(run: () => Promise<DemoOutcome>): Promise<DemoOutcome> {
    return guarded(async () => {
      const profile = await ensureProfile();
      if (!profile.ok) return profile;
      return run();
    });
  }

  async function alexInterested(activityId: string): Promise<boolean> {
    const interests = await repo.loadInterests(activityId);
    if (!interests.ok) throw new Error(interests.error.message);
    return groupMembers(activityId, interests.value.value).includes(DEMO_PARTNER_ID);
  }

  async function activityTitle(activityId: string): Promise<string> {
    const catalog = await repo.loadActivities();
    return catalog.ok ? catalog.value.value.items.find((a) => a.id === activityId)?.title ?? "this activity" : "this activity";
  }

  async function join(activityId: string): Promise<DemoOutcome> {
    return withProfile(async () => {
      const saved = await repo.setInterest(activityId, "interested");
      if (!saved.ok) return fail(`Alex could not join. ${saved.error.message}`);
      return ok("Alex joined. They count as a real interested person now.");
    });
  }

  async function voteForTime(activityId: string): Promise<DemoOutcome> {
    return withProfile(async () => {
      if (!(await alexInterested(activityId))) return fail("Alex has not joined this activity yet. Use \"Alex joins\" first.");
      const catalog = await repo.loadActivities();
      if (!catalog.ok) return fail(catalog.error.message);
      const activity = catalog.value.value.items.find((a) => a.id === activityId);
      if (!activity) return fail("This activity could not be found.");
      const future = getFutureTimeOptions(activity.timeOptions, Date.now());
      if (future.length === 0) return fail("This activity has no future time to vote for.");
      const votes = await repo.loadVotes(activityId);
      if (!votes.ok) return fail(votes.error.message);
      const mine = votes.value.value.find((v) => v.userId === meId);
      const choice = future.find((o) => o.id === mine?.optionId) ?? future[0];
      const saved = await repo.setVote(activityId, choice.id);
      if (!saved.ok) return fail(`Alex's vote was not saved. ${saved.error.message}`);
      const when = new Date(choice.startAt).toLocaleString("en-GB", {
        timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      return ok(mine?.optionId === choice.id ? `Alex voted for your time: ${when}.` : `Alex voted for ${when}.`);
    });
  }

  async function markGoing(planId: string): Promise<DemoOutcome> {
    return withProfile(async () => {
      const saved = await repo.setAttendance(planId, "going");
      return saved.ok ? ok("Alex is going. The Going count includes them now.") : fail(`Not saved. ${saved.error.message}`);
    });
  }

  async function socialState() {
    const loaded = await social.load();
    if (!loaded.ok) throw new Error(loaded.error.message);
    return loaded.value.value;
  }

  async function sendRequest(): Promise<DemoOutcome> {
    return withProfile(async () => {
      const target = me()!;
      const s = await socialState();
      if (areFriends(target, DEMO_PARTNER_ID, s.requests, s.responses)) return ok("You and Alex are already friends.");
      const saved = await social.request(target, "pending");
      return saved.ok ? ok("Alex sent you a friend request. Open Requests to accept it.") : fail(`Not sent. ${saved.error.message}`);
    });
  }

  async function acceptRequest(): Promise<DemoOutcome> {
    return withProfile(async () => {
      const target = me()!;
      const s = await socialState();
      if (areFriends(target, DEMO_PARTNER_ID, s.requests, s.responses)) return ok("You and Alex are already friends.");
      const pending = s.requests.some((r) => r.fromId === target && r.toId === DEMO_PARTNER_ID && r.status === "pending");
      if (!pending) return fail("You have not sent Alex a request yet. Add Alex in Meet first.");
      const saved = await social.respond(target, "accepted");
      return saved.ok ? ok("Alex accepted. You are friends, so your direct chat is open.") : fail(`Not saved. ${saved.error.message}`);
    });
  }

  function membershipHint(chatId: string): string {
    return chatId.startsWith("group:")
      ? "Alex has not joined this activity, so they are not in its chat. Use \"Alex joins\" first."
      : "Alex can only post here once you are friends.";
  }

  async function reply(chatId: string): Promise<DemoOutcome> {
    return withProfile(async () => {
      if (chatId.startsWith("group:") && !(await alexInterested(chatId.slice(6)))) return fail(membershipHint(chatId));
      const s = await socialState();
      const count = s.messages.filter((m) => m.chatId === chatId && m.authorId === DEMO_PARTNER_ID).length;
      const text = DEMO_REPLIES[count % DEMO_REPLIES.length];
      const saved = await social.post(chatId, { kind: "text", text });
      return saved.ok ? ok(`Alex replied: "${text}"`) : fail(saved.error.message.startsWith("Join this activity") ? membershipHint(chatId) : saved.error.message);
    });
  }

  async function voteInLatestPoll(chatId: string): Promise<DemoOutcome> {
    return withProfile(async () => {
      if (chatId.startsWith("group:") && !(await alexInterested(chatId.slice(6)))) return fail(membershipHint(chatId));
      const s = await socialState();
      const polls = s.messages.filter((m): m is Extract<ChatMessage, { kind: "poll" }> => m.chatId === chatId && m.kind === "poll");
      const poll = polls.at(-1);
      if (!poll) return fail("There is no poll in this chat yet. Post one with the + button.");
      const myVote = s.votes.filter((v) => v.chatId === chatId && v.messageId === poll.id && v.voterId === meId).at(-1);
      const choice = poll.poll.options.find((o) => myVote?.optionIds.includes(o.id)) ?? poll.poll.options[0];
      const saved = await social.vote(chatId, poll.id, [choice.id]);
      return saved.ok ? ok(`Alex voted "${choice.label}" in "${poll.poll.question}".`) : fail(saved.error.message);
    });
  }

  async function list(path: string): Promise<FileEntry[]> {
    try {
      return await files.list(path);
    } catch {
      return [];
    }
  }

  /** Every path a demo person wrote, or that only exists because of one. Never the real user's own records or plans. */
  async function demoPaths(): Promise<string[]> {
    const keys = new Set(DEMO_IDS.map((id) => keyForId(id)));
    const files = new Set([...keys].map((key) => `${key}.json`));
    const out: string[] = DEMO_IDS.flatMap((id) => [profilePath(id), meetPath(id), blocksPath(id)]);
    const childFiles = async (dir: string) => {
      for (const folder of await list(dir)) {
        if (folder.kind !== "folder") continue;
        for (const e of await list(folder.path)) if (files.has(e.name)) out.push(`${folder.path}/${e.name}`);
      }
    };
    await Promise.all([childFiles(INTERESTS_DIR), childFiles(VOTES_DIR), childFiles(ATTENDANCE_DIR)]);
    for (const side of ["requests", "responses"]) {
      const root = `${FRIENDS_DIR}/${side}`;
      for (const folder of await list(root)) {
        if (folder.kind !== "folder") continue;
        if (keys.has(folder.name)) out.push(folder.path);
        else for (const e of await list(folder.path)) if (files.has(e.name)) out.push(`${folder.path}/${e.name}`);
      }
    }
    const dmFolders = new Set<string>();
    const target = me();
    if (target) {
      for (const id of DEMO_IDS) {
        try { dmFolders.add(chatFolderPath(dmId(target, id))); } catch { /* not a valid pair */ }
      }
    }
    for (const chat of await list(CHATS_DIR)) {
      if (chat.kind !== "folder") continue;
      // A direct chat with a demo person exists only because of them, so it goes as a whole.
      if (dmFolders.has(chat.path)) { out.push(chat.path); continue; }
      for (const e of await list(`${chat.path}/messages`)) if (keys.has(e.name)) out.push(e.path);
      for (const e of await list(`${chat.path}/read`)) if (files.has(e.name)) out.push(e.path);
      for (const poll of await list(`${chat.path}/polls`)) {
        if (poll.kind !== "folder") continue;
        for (const e of await list(poll.path)) if (files.has(e.name)) out.push(e.path);
      }
    }
    return out;
  }

  /** Drops demo people from the real user's Meet passes, so they show again after a reset. */
  async function clearMyDemoPasses(): Promise<void> {
    const target = me();
    if (!target) return;
    const path = meetPath(target);
    let record: { passedIds?: unknown } | null = null;
    try { record = JSON.parse(await files.readText(path)); } catch { return; }
    const passed = Array.isArray(record?.passedIds) ? record!.passedIds.filter((id): id is string => typeof id === "string") : [];
    const kept = passed.filter((id) => !DEMO_IDS.includes(id));
    if (kept.length === passed.length) return;
    await files.writeText(path, JSON.stringify({ ...record, passedIds: kept, updatedAt: new Date().toISOString() }), { overwrite: true });
  }

  async function reset(): Promise<DemoOutcome> {
    return guarded(async () => {
      // Plans are never deleted. Note any that Alex took part in so the presenter knows.
      const kept: string[] = [];
      const plans = await repo.loadPlans();
      if (plans.ok) {
        for (const plan of Object.values(plans.value.value)) {
          const interests = await repo.loadInterests(plan.activityId);
          const attendance = await repo.loadAttendance(plan.id);
          const involved = (interests.ok && interests.value.value.some((r) => r.userId === DEMO_PARTNER_ID))
            || (attendance.ok && attendance.value.value.some((r) => r.userId === DEMO_PARTNER_ID));
          if (involved) kept.push(await activityTitle(plan.activityId));
        }
      }
      const paths = await demoPaths();
      let failed = 0;
      try { await clearMyDemoPasses(); } catch { failed += 1; }
      for (const path of paths) {
        try { await remove(path); } catch { failed += 1; }
      }
      const keptNote = kept.length
        ? ` The confirmed plan for ${kept.join(", ")} was kept, since plans are never deleted. Alex no longer counts toward it.`
        : "";
      if (failed > 0) return fail(`${failed} of ${paths.length} demo files could not be removed. Try Reset demo again.${keptNote}`);
      return ok(`Demo reset. Removed Alex, the demo students and everything they did.${keptNote}`);
    });
  }

  return {
    ensureProfile: () => guarded(ensureProfile),
    join, voteForTime, markGoing, sendRequest, acceptRequest, reply, voteInLatestPoll, reset,
  };
}

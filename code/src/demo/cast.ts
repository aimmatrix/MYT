import type { MytFilePort } from "../data-contract";
import type { CurrentUser, SocialData } from "../types";
import { createAppRepository } from "../wiring/appRepository";
import { createSocialRepository } from "../data/socialRepository";
import { areFriends, dmId, realId } from "../domain/social";
import { DEMO_CAST, type DemoCastMember } from "./identity";
import type { DemoOutcome } from "./partner";

/*
 * Demo cast writer. Each demo student acts through the app's own repositories signed in as
 * themselves, exactly like Alex, so their profiles, requests and accepts are ordinary records.
 */

export interface DemoCast {
  /** Writes a profile for every cast member who doesn't have one yet. */
  addAll(): Promise<DemoOutcome>;
  /** Every cast member the real user has requested accepts. */
  acceptPending(): Promise<DemoOutcome>;
  /** The first cast member with no request either way sends one to the real user. */
  sendOneRequest(): Promise<DemoOutcome>;
  /** The cast member in this direct chat, if any. */
  memberInDm(chatId: string): DemoCastMember | null;
  /** That cast member posts a friendly line in the direct chat. */
  replyInDm(chatId: string): Promise<DemoOutcome>;
}

const CAST_REPLIES = [
  "Hey! Thanks for the add.",
  "Up for something this weekend?",
  "I saw a few good ones on Discover. Want to pick one?",
  "Sounds good to me!",
] as const;

const ok = (message: string): DemoOutcome => ({ ok: true, message });
const fail = (message: string): DemoOutcome => ({ ok: false, message });

export function createDemoCast(files: MytFilePort, meId: string | null): DemoCast {
  const me = meId && realId(meId) ? meId : null;
  const reposFor = (member: DemoCastMember) => {
    const user: CurrentUser = { id: member.id, name: member.name };
    const repo = createAppRepository(files, user);
    return { repo, social: createSocialRepository(files, user, repo) };
  };

  async function guarded(run: (me: string) => Promise<DemoOutcome>): Promise<DemoOutcome> {
    if (!me) return fail("Sign in first. The demo students need a real account to interact with.");
    try {
      return await run(me);
    } catch (error) {
      return fail(error instanceof Error && error.message ? error.message : "Not saved. Try again.");
    }
  }

  async function ensure(member: DemoCastMember): Promise<boolean> {
    const { repo } = reposFor(member);
    const existing = await repo.loadMyProfile();
    if (existing.ok && existing.value.value) return false;
    if (!existing.ok && existing.error.code === "io") throw new Error(existing.error.message);
    const saved = await repo.saveProfile({
      displayName: member.name,
      university: member.university,
      universityId: member.universityId,
      yearOfStudy: member.yearOfStudy,
      interestIds: member.interestIds,
      freeSlots: member.freeSlots,
      budgetBand: member.budgetBand,
      availability: [],
      budgetPence: null,
    });
    if (!saved.ok) throw new Error(saved.error.message);
    return true;
  }

  async function socialState(): Promise<SocialData> {
    const { social } = reposFor(DEMO_CAST[0]);
    const loaded = await social.load();
    if (!loaded.ok) throw new Error(loaded.error.message);
    return loaded.value.value;
  }

  function memberInDm(chatId: string): DemoCastMember | null {
    if (!me) return null;
    return DEMO_CAST.find((m) => {
      try { return dmId(me, m.id) === chatId; } catch { return false; }
    }) ?? null;
  }

  return {
    memberInDm,
    replyInDm: (chatId) => guarded(async () => {
      const member = memberInDm(chatId);
      if (!member) return fail("This chat isn't with a demo student.");
      const { social } = reposFor(member);
      const loaded = await social.load();
      if (!loaded.ok) return fail(loaded.error.message);
      const count = loaded.value.value.messages.filter((m) => m.chatId === chatId && m.authorId === member.id).length;
      const text = CAST_REPLIES[count % CAST_REPLIES.length];
      const saved = await social.post(chatId, { kind: "text", text });
      const name = member.name.replace(" (demo)", "");
      return saved.ok ? ok(`${name} replied: "${text}"`) : fail(saved.error.message.startsWith("Join this activity") ? `${name} can post here once you are friends.` : saved.error.message);
    }),
    addAll: () => guarded(async () => {
      let added = 0;
      for (const member of DEMO_CAST) if (await ensure(member)) added += 1;
      return ok(added
        ? `${added} demo students joined MYT. Swipe right in Meet to send a request, left to pass.`
        : "The demo students are already in Meet.");
    }),

    acceptPending: () => guarded(async (target) => {
      const s = await socialState();
      const accepted: string[] = [];
      for (const member of DEMO_CAST) {
        if (areFriends(target, member.id, s.requests, s.responses)) continue;
        if (!s.requests.some((r) => r.fromId === target && r.toId === member.id && r.status === "pending")) continue;
        const saved = await reposFor(member).social.respond(target, "accepted");
        if (!saved.ok) return fail(`${member.name} could not accept. ${saved.error.message}`);
        accepted.push(member.name.replace(" (demo)", ""));
      }
      return accepted.length
        ? ok(`${accepted.join(", ")} accepted. You're friends now, so you can message them in Chats.`)
        : fail("You haven't sent a request to a demo student yet. Swipe right on one in Meet first.");
    }),

    sendOneRequest: () => guarded(async (target) => {
      const s = await socialState();
      const member = DEMO_CAST.find((m) => !s.requests.some((r) =>
        (r.fromId === m.id && r.toId === target) || (r.fromId === target && r.toId === m.id)));
      if (!member) return fail("Every demo student already has a request with you.");
      await ensure(member);
      const saved = await reposFor(member).social.request(target, "pending");
      return saved.ok
        ? ok(`${member.name} sent you a friend request. Open Requests to accept it.`)
        : fail(`Not sent. ${saved.error.message}`);
    }),
  };
}

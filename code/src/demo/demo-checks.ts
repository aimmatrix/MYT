/*
 * Node checks for the demo partner writer. Not imported by the app. Bundle with esbuild and run:
 *   esbuild src/demo/demo-checks.ts --bundle --platform=node --format=cjs --outfile=$TMPDIR/demo-checks.cjs
 *   node $TMPDIR/demo-checks.cjs ../data/activities.json
 * Runs the full solo walkthrough against an in-memory file port, then asserts that every file on
 * "disk" passes its decoder and sits at its canonical path, and that reset removes only Alex's files.
 */
import type { FileEntry, MytFilePort } from "../data-contract";
import type { ChatPoll } from "../types";
import { createAppRepository } from "../wiring/appRepository";
import { createSocialRepository } from "../data/socialRepository";
import { decodeRecord, isSocialRecord, type SocialKind } from "../domain/validation";
import { isValidId, planIdForActivity } from "../domain/identifiers";
import { parseInstant } from "../domain/londonTime";
import { dmId, areFriends, groupMembers } from "../domain/social";
import {
  attendancePath, blocksPath, chatReadPath, friendRequestPath, friendResponsePath, interestPath,
  meetPath, messagePath, planPath, pollVotePath, profilePath, votePath,
} from "../paths";
import { createDemoPartner } from "./partner";
import { DEMO_CAST, DEMO_IDS, DEMO_PARTNER_ID } from "./identity";
import { createDemoCast } from "./cast";

declare const process: { argv: string[]; exit(code: number): never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(name: string): any;

function memoryFiles(seed: Record<string, string>) {
  const store = new Map(Object.entries(seed));
  const isFolder = (path: string) => path === "" || [...store.keys()].some((k) => k.startsWith(path + "/"));
  const port: MytFilePort = {
    async readText(path) {
      const text = store.get(path);
      if (text === undefined) throw new Error("missing " + path);
      return text;
    },
    async writeText(path, text, options) {
      if (!options.overwrite && store.has(path)) throw new Error("exists " + path);
      store.set(path, text);
    },
    async list(path) {
      if (!isFolder(path)) throw new Error("no folder " + path);
      const prefix = path === "" ? "" : path + "/";
      const seen = new Map<string, FileEntry>();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        seen.set(name, { path: prefix + name, name, kind: rest.includes("/") ? "folder" : "file" });
      }
      return [...seen.values()];
    },
    watch() { return () => undefined; },
  };
  const remove = async (path: string) => {
    for (const key of [...store.keys()]) if (key === path || key.startsWith(path + "/")) store.delete(key);
  };
  return { port, remove, store };
}

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log("ok   " + label);
  else { failures += 1; console.log("FAIL " + label + (detail ? " :: " + detail : "")); }
}

const deps = { parseInstant, isValidId };

/** Decodes every file and checks it sits at the path its own identity implies. */
function auditStore(store: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [path, text] of store) {
    if (path === "data/activities.json" || path === "data/session.json" || path === "data/sample-profiles.json") continue;
    const json = JSON.parse(text);
    const expect = (decoded: { ok: boolean }, canonical: string) => {
      if (!decoded.ok) problems.push("decode " + path);
      else if (canonical !== path) problems.push("path " + path + " expected " + canonical);
    };
    const social = (kind: SocialKind, canonical: string) => {
      if (!isSocialRecord(kind, json)) problems.push("social decode " + kind + " " + path);
      else if (canonical !== path) problems.push("social path " + path + " expected " + canonical);
    };
    if (path.startsWith("data/profiles/")) expect(decodeRecord("profile", text, deps), profilePath(json.userId));
    else if (path.startsWith("data/interests/")) expect(decodeRecord("interest", text, deps), interestPath(json.activityId, json.userId));
    else if (path.startsWith("data/votes/")) expect(decodeRecord("vote", text, deps), votePath(json.activityId, json.userId));
    else if (path.startsWith("data/plans/")) expect(decodeRecord("plan", text, deps), planPath(planIdForActivity(json.activityId)));
    else if (path.startsWith("data/attendance/")) expect(decodeRecord("attendance", text, deps), attendancePath(json.planId, json.userId));
    else if (path.startsWith("data/friends/requests/")) social("request", friendRequestPath(json.fromId, json.toId));
    else if (path.startsWith("data/friends/responses/")) social("response", friendResponsePath(json.toId, json.fromId));
    else if (path.startsWith("data/meet/")) social("meet", meetPath(json.userId));
    else if (path.startsWith("data/blocks/")) social("blocks", blocksPath(json.userId));
    else if (/\/messages\//.test(path)) social("message", messagePath(json.chatId, json.authorId, json.id));
    else if (/\/read\//.test(path)) social("read", chatReadPath(json.chatId, json.userId));
    else if (/\/polls\//.test(path)) social("pollVote", pollVotePath(json.chatId, json.messageId, json.voterId));
    else problems.push("unknown file " + path);
  }
  return problems;
}

async function main() {
  const fs = require("node:fs");
  const catalogText: string = fs.readFileSync(process.argv[2], "utf8");
  const catalog = JSON.parse(catalogText);
  const now = Date.now();
  const activity = catalog.items.find((a: { status: string; timeOptions: { startAt: string }[] }) =>
    a.status === "available" && a.timeOptions.filter((o) => Date.parse(o.startAt) > now).length >= 2)
    ?? catalog.items.find((a: { status: string; timeOptions: { startAt: string }[] }) => a.status === "available" && a.timeOptions.some((o) => Date.parse(o.startAt) > now));
  const meId = "3b92dba8-979c-467d-935f-318296862c4d";
  const myProfile = {
    schemaVersion: 1, userId: meId, displayName: "Presenter", university: "University College London", universityId: "ucl",
    yearOfStudy: "2", freeSlots: ["sat-day", "tue-eve", "sun-eve"], budgetBand: "any",
    interestIds: ["football", "karting", "social", "fitness", "comedy"], availability: ["weekend-day", "weekday-evening", "weekend-evening"],
    budgetPence: null, isDemo: false,
  };
  const { port, remove, store } = memoryFiles({
    "data/activities.json": catalogText,
    "data/session.json": JSON.stringify({ schemaVersion: 1, organiserUserId: null }),
    "data/sample-profiles.json": JSON.stringify({ schemaVersion: 1, items: [] }),
    [profilePath(meId)]: JSON.stringify(myProfile),
  });
  const me = { id: meId, name: "Presenter" };
  const meRepo = createAppRepository(port, me);
  const meSocial = createSocialRepository(port, me, meRepo);
  const alex = createDemoPartner({ files: port, remove, meId });

  check("real-user checks accept the demo ID", isValidId(DEMO_PARTNER_ID) && !DEMO_PARTNER_ID.startsWith("sample:") && !DEMO_PARTNER_ID.startsWith("preview:"));

  // Before anything: actions that need setup fail with a clear message, not a throw.
  let r = await alex.voteForTime(activity.id);
  check("vote before join is refused", !r.ok && /has not joined/.test(r.message), r.message);
  r = await alex.acceptRequest();
  check("accept without a request is refused", !r.ok, r.message);

  r = await alex.ensureProfile();
  check("profile created", r.ok, r.message);
  const profiles = await meRepo.loadRealProfiles();
  const alexProfile = profiles.ok ? profiles.value.value[DEMO_PARTNER_ID] : undefined;
  check("Alex loads as a real profile", !!alexProfile && alexProfile.isDemo === false && /\(demo\)/.test(alexProfile.displayName));
  check("Alex shares interests", !!alexProfile && alexProfile.interestIds.every((i) => myProfile.interestIds.includes(i)));

  r = await alex.join(activity.id);
  check("Alex joins", r.ok, r.message);
  const meJoin = await meRepo.setInterest(activity.id, "interested");
  check("presenter joins", meJoin.ok);
  const future = activity.timeOptions.filter((o: { startAt: string }) => Date.parse(o.startAt) > now);
  const myOption = future[future.length - 1].id;
  check("presenter votes", (await meRepo.setVote(activity.id, myOption)).ok);
  r = await alex.voteForTime(activity.id);
  check("Alex votes", r.ok, r.message);
  const votes = await meRepo.loadVotes(activity.id);
  check("Alex votes for the presenter's time", votes.ok && votes.value.value.find((v) => v.userId === DEMO_PARTNER_ID)?.optionId === myOption);

  check("presenter claims organiser", (await meRepo.claimOrganiser({ replace: false })).ok);
  const confirmed = await meRepo.confirmPlan({ activityId: activity.id, optionId: myOption, meetingPoint: "Main entrance" });
  check("plan confirms with Alex as the second person", confirmed.ok && confirmed.kind === "created", JSON.stringify(confirmed));
  const planId = planIdForActivity(activity.id);
  r = await alex.markGoing(planId);
  check("Alex is going", r.ok, r.message);
  check("presenter is going", (await meRepo.setAttendance(planId, "going")).ok);
  const attendance = await meRepo.loadAttendance(planId);
  check("two going records", attendance.ok && attendance.value.value.filter((a) => a.status === "going").length === 2);
  r = await alex.join(activity.id);
  check("Alex cannot join after the plan exists", !r.ok, r.message);

  // Group chat.
  const groupId = `group:${activity.id}`;
  const groupInterests = await meRepo.loadInterests(activity.id);
  check("Alex is a group member", groupInterests.ok && groupMembers(activity.id, groupInterests.value.value).includes(DEMO_PARTNER_ID));
  check("presenter posts in group", (await meSocial.post(groupId, { kind: "text", text: "Hi all" })).ok);
  r = await alex.reply(groupId);
  check("Alex replies in group", r.ok, r.message);
  r = await alex.reply(groupId);
  check("Alex replies again with a different line", r.ok && !/Count me in/.test(r.message), r.message);
  r = await alex.voteInLatestPoll(groupId);
  check("poll vote without a poll is refused", !r.ok, r.message);
  const poll: ChatPoll = { question: "Food after?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], multi: false, anonymous: false };
  check("presenter posts poll", (await meSocial.post(groupId, { kind: "poll", poll })).ok);
  const loaded = await meSocial.load();
  const pollMessage = loaded.ok ? loaded.value.value.messages.find((m) => m.kind === "poll") : undefined;
  check("presenter votes no", !!pollMessage && (await meSocial.vote(groupId, pollMessage.id, ["no"])).ok);
  r = await alex.voteInLatestPoll(groupId);
  check("Alex votes in poll", r.ok && /"No"/.test(r.message), r.message);

  // Friends: Alex sends, presenter accepts.
  r = await alex.sendRequest();
  check("Alex sends request", r.ok, r.message);
  let social = await meSocial.load();
  check("presenter sees Alex's pending request", social.ok && social.value.value.requests.some((q) => q.fromId === DEMO_PARTNER_ID && q.toId === meId && q.status === "pending"));
  check("presenter accepts", (await meSocial.respond(DEMO_PARTNER_ID, "accepted")).ok);
  social = await meSocial.load();
  check("now friends", social.ok && areFriends(meId, DEMO_PARTNER_ID, social.value.value.requests, social.value.value.responses));
  const dm = dmId(meId, DEMO_PARTNER_ID);
  check("presenter posts in DM", (await meSocial.post(dm, { kind: "text", text: "Hey Alex" })).ok);
  r = await alex.reply(dm);
  check("Alex replies in DM", r.ok, r.message);
  check("presenter marks DM read", (await meSocial.read(dm)).ok);

  let problems = auditStore(store);
  check("every file decodes and sits at its canonical path", problems.length === 0, problems.join("; "));

  // Reset, then the other friend direction: presenter sends, Alex accepts.
  r = await alex.reset();
  check("reset succeeds and mentions the kept plan", r.ok && /was kept/.test(r.message), r.message);
  const leftovers = [...store.entries()].filter(([path, text]) => path.includes("id-" + Buffer.from(DEMO_PARTNER_ID).toString("hex")) || text.includes(DEMO_PARTNER_ID));
  check("no Alex files or references remain", leftovers.length === 0, leftovers.map(([p]) => p).join(", "));
  check("plan kept", store.has(planPath(planId)));
  check("presenter profile kept", store.has(profilePath(meId)));
  check("presenter interest, vote and attendance kept", store.has(interestPath(activity.id, meId)) && store.has(votePath(activity.id, meId)) && store.has(attendancePath(planId, meId)));
  check("presenter's group messages kept", [...store.keys()].some((k) => k.includes("/messages/" + "id-" + Buffer.from(meId).toString("hex"))));

  check("Alex re-created", (await alex.ensureProfile()).ok);
  check("presenter sends request", (await meSocial.request(DEMO_PARTNER_ID, "pending")).ok);
  r = await alex.acceptRequest();
  check("Alex accepts", r.ok, r.message);
  social = await meSocial.load();
  check("friends after Alex accepts", social.ok && areFriends(meId, DEMO_PARTNER_ID, social.value.value.requests, social.value.value.responses));
  r = await alex.sendRequest();
  check("sending when already friends is a no-op", r.ok && /already friends/.test(r.message), r.message);
  problems = auditStore(store);
  check("audit after second flow", problems.length === 0, problems.join("; "));
  r = await alex.reset();
  check("second reset", r.ok, r.message);
  const leftovers2 = [...store.entries()].filter(([, text]) => text.includes(DEMO_PARTNER_ID));
  check("clean after second reset", leftovers2.length === 0, leftovers2.map(([p]) => p).join(", "));

  // ---- demo cast: people to swipe on in Meet
  const cast = createDemoCast(port, meId);
  r = await cast.addAll();
  check("cast added", r.ok, r.message);
  check("every cast profile written", DEMO_CAST.every((m) => store.has(profilePath(m.id))));
  const loadedProfiles = await createAppRepository(port, { id: meId, name: "Me" }).loadRealProfiles();
  check("cast profiles load as real profiles", loadedProfiles.ok && DEMO_CAST.every((m) => Object.hasOwn(loadedProfiles.value.value, m.id)), loadedProfiles.ok ? JSON.stringify(loadedProfiles.value.issues) : "");
  r = await cast.addAll();
  check("adding again is a no-op", r.ok && /already/.test(r.message), r.message);
  r = await cast.acceptPending();
  check("accept with no requests is refused", !r.ok, r.message);
  const [first, second] = DEMO_CAST;
  check("swipe right on first cast member", (await meSocial.request(first.id, "pending")).ok);
  check("swipe left on second cast member", (await meSocial.pass(second.id)).ok);
  r = await cast.acceptPending();
  check("cast accepts", r.ok, r.message);
  social = await meSocial.load();
  check("friends with first cast member", social.ok && areFriends(meId, first.id, social.value.value.requests, social.value.value.responses));
  check("pass recorded", social.ok && social.value.value.passedIds.includes(second.id));
  check("DM with cast member available", social.ok && social.value.value.requests.length > 0 && (() => { try { dmId(meId, first.id); return true; } catch { return false; } })());
  check("post in cast DM", (await meSocial.post(dmId(meId, first.id), { kind: "text", text: "Hi!" })).ok);
  r = await cast.replyInDm(dmId(meId, first.id));
  check("cast member replies in DM", r.ok, r.message);
  r = await cast.replyInDm("dm:nobody|else");
  check("reply in a non-cast chat is refused", !r.ok, r.message);
  r = await cast.sendOneRequest();
  check("a cast member sends a request", r.ok, r.message);
  social = await meSocial.load();
  check("incoming cast request exists", social.ok && social.value.value.requests.some((q) => q.toId === meId && DEMO_CAST.some((m) => m.id === q.fromId) && q.status === "pending"));
  problems = auditStore(store);
  check("audit after cast flow", problems.length === 0, problems.join("; "));
  r = await alex.reset();
  check("reset with cast", r.ok, r.message);
  const castLeft = [...store.entries()].filter(([, text]) => DEMO_IDS.some((id) => text.includes(id)));
  check("no demo person left anywhere, passes included", castLeft.length === 0, castLeft.map(([p]) => p).join(", "));

  const signedOut = createDemoPartner({ files: port, remove, meId: null });
  r = await signedOut.join(activity.id);
  check("signed out is refused", !r.ok, r.message);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures) process.exit(1);
}

declare const Buffer: { from(value: string): { toString(encoding: string): string } };
void main();

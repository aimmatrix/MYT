import type { Activity, InterestRecord, Profile, TimeVote } from "../types";
import type { FileEntry, MytFilePort } from "../data-contract";
import { createMytRepository, type RepositoryDependencies } from "../data/repository";
import { isValidId, keyForId, idFromKey, planIdForActivity } from "../domain/identifiers";
import { rankActivities } from "../domain/matching";
import { selectInterestedUserIds, selectGoingUserIds } from "../domain/participantSelectors";
import { calculateTimeConsensus } from "../domain/timeConsensus";
import { evaluatePlanCreation } from "../domain/planRules";
import { decodeRecord } from "../domain/validation";
import { parseInstant } from "../domain/londonTime";
import { ACTIVITIES_PATH, SAMPLE_PROFILES_PATH, SESSION_PATH, interestPath, planPathForActivity } from "../paths";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const NOW = Date.parse("2026-10-25T00:45:00Z");
const EARLIER = "2026-10-24T12:00:00Z";
const LATER = "2026-10-24T13:00:00Z";
const FIRST = "2026-10-25T01:30:00+01:00";
const SECOND = "2026-10-25T01:30:00+00:00";
const FUTURE = "2100-06-01T18:00:00+01:00";
const FUTURE_END = "2100-06-01T20:00:00+01:00";

function activity(id: string, interestId: Activity["interestId"], costPence: number | null, startAt = FUTURE): Activity {
  return {
    schemaVersion: 1, id, title: id, description: "QA fixture", interestId, area: "London",
    status: "available",
    timeOptions: [{ id: "slot", startAt, endAt: null, availabilityKeys: ["weekend-day"] }],
    cost: { amountPence: costPence, currency: "GBP", isEstimate: false },
    source: { kind: "demo", url: null, checkedAt: null },
  };
}

function profile(userId: string): Profile {
  return {
    schemaVersion: 1, userId, displayName: userId, university: "Example",
    interestIds: ["football"], availability: ["weekend-day"], budgetPence: 0, isDemo: false,
  };
}

function record(activityId: string, userId: string, status: InterestRecord["status"], updatedAt: string): InterestRecord {
  return { schemaVersion: 1, activityId, userId, status, updatedAt };
}

class MemoryFiles implements MytFilePort {
  readonly records = new Map<string, string>();
  readonly rejectedWrites = new Set<string>();
  readonly writes: Array<{ path: string; overwrite: boolean }> = [];

  async readText(path: string): Promise<string> {
    const value = this.records.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  }

  async writeText(path: string, text: string, options: { overwrite: boolean }): Promise<void> {
    if (this.rejectedWrites.has(path)) throw new Error("write rejected");
    if (!options.overwrite && this.records.has(path)) throw new Error("already exists");
    this.records.set(path, text);
    this.writes.push({ path, overwrite: options.overwrite });
  }

  async list(path: string): Promise<FileEntry[]> {
    if (path !== "" && path !== "data" && ![...this.records.keys()].some(key => key.startsWith(path + "/"))) {
      throw new Error("missing folder");
    }
    const prefix = path ? path + "/" : "";
    const children = new Map<string, FileEntry>();
    for (const key of this.records.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      const childPath = prefix + name;
      children.set(childPath, { path: childPath, name, kind: rest.includes("/") ? "folder" : "file" });
    }
    return [...children.values()];
  }

  watch(): () => void {
    return () => undefined;
  }
}

const decodeForRepository = ((kind: Parameters<RepositoryDependencies["decodeRecord"]>[0], text: string) =>
  decodeRecord(kind, text, { parseInstant, isValidId })) as RepositoryDependencies["decodeRecord"];

const dependencies: RepositoryDependencies = { decodeRecord: decodeForRepository, isValidId, planIdForActivity, parseInstant };

async function checkRepository(assert: (condition: boolean, name: string, detail?: string) => void): Promise<void> {
  const files = new MemoryFiles();
  const football = activity("football-qa", "football", 0);
  files.records.set(ACTIVITIES_PATH, JSON.stringify({ schemaVersion: 1, items: [football] }));
  files.records.set(SAMPLE_PROFILES_PATH, JSON.stringify({ schemaVersion: 1, items: [] }));
  files.records.set(SESSION_PATH, JSON.stringify({ schemaVersion: 1, organiserUserId: "real-a" }));
  const first = createMytRepository(files, { id: "real-a", name: "A" }, dependencies);
  const second = createMytRepository(files, { id: "real-b", name: "B" }, dependencies);

  const ownPath = interestPath(football.id, "real-a");
  files.rejectedWrites.add(ownPath);
  const rejected = await first.setInterest(football.id, "interested");
  assert(!rejected.ok && rejected.error.code === "io" && !files.records.has(ownPath),
    "Repository reports rejected writes without false success");
  files.rejectedWrites.delete(ownPath);

  const joinedA = await first.setInterest(football.id, "interested");
  const joinedB = await second.setInterest(football.id, "interested");
  const loaded = await first.loadInterests(football.id);
  assert(joinedA.ok && joinedB.ok && loaded.ok && loaded.value.value.length === 2
    && files.records.has(interestPath(football.id, "real-b")),
  "Two participants write separate interest files");

  const created = await first.confirmPlan({ activityId: football.id, optionId: "slot", meetingPoint: "Station entrance" });
  const duplicate = await first.confirmPlan({ activityId: football.id, optionId: "slot", meetingPoint: "Station entrance" });
  const planPath = planPathForActivity(football.id);
  assert(created.ok && created.kind === "created" && duplicate.ok && duplicate.kind === "existing"
    && files.writes.filter(write => write.path === planPath).length === 1
    && files.writes.find(write => write.path === planPath)?.overwrite === false,
  "Duplicate plan confirmation returns the existing plan");

  const different = await second.confirmPlan({ activityId: football.id, optionId: "slot", meetingPoint: "Other place" });
  assert(!different.ok && different.error.code === "already-exists",
    "Different duplicate confirmation cannot replace a plan");
}

export async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  function check(condition: boolean, name: string, detail?: string): void {
    results.push({ name, passed: condition, ...(condition ? {} : { detail: detail ?? "Unexpected result" }) });
  }
  function guarded(name: string, action: () => void): void {
    try { action(); } catch (error) { check(false, name, String(error)); }
  }

  guarded("London autumn clock change", () => {
    check(parseInstant(FIRST) === Date.parse(FIRST) && parseInstant(SECOND) === Date.parse(SECOND)
      && parseInstant(SECOND)! - parseInstant(FIRST)! === 3_600_000
      && parseInstant("2026-10-25T01:30:00") === null,
    "London repeated hour requires an explicit offset");
    const early = activity("early", "football", 0, FIRST);
    const late = activity("late", "football", null, SECOND);
    const ranked = rankActivities({ profile: profile("real-a"), activities: [early, late], nowMs: NOW });
    check(ranked.items.length === 1 && ranked.items[0].activity.id === "late",
      "Ranking excludes the first repeated-hour option after it passes");
  });

  guarded("Ranking and cost", () => {
    const ranked = rankActivities({
      profile: profile("real-a"),
      activities: [activity("unknown", "football", null), activity("free", "football", 0), activity("other", "cinema", 0)],
      nowMs: NOW,
    });
    check(ranked.items.map(item => item.activity.id).join(",") === "free,unknown,other",
      "Shared interest and free cost rank ahead of unknown cost");
    check(ranked.items.find(item => item.activity.id === "free")?.reasonCodes.includes("budget-fit") === true
      && ranked.items.find(item => item.activity.id === "unknown")?.reasonCodes.includes("budget-fit") === false,
    "Zero cost is a budget fit; unknown cost is not");
  });

  guarded("Participant and vote filtering", () => {
    const real = new Set(["real-a", "real-b"]);
    const interests = [
      record("football-qa", "real-a", "interested", EARLIER),
      record("football-qa", "real-b", "interested", EARLIER),
      record("football-qa", "real-b", "withdrawn", LATER),
      record("football-qa", "sample:pat", "interested", LATER),
      record("other", "real-b", "interested", LATER),
    ];
    const eligible = new Set(selectInterestedUserIds(interests, "football-qa", real, parseInstant));
    check(eligible.size === 1 && eligible.has("real-a"),
      "Withdrawn, unrelated and sample interest does not count");
    const votes: TimeVote[] = [
      { schemaVersion: 1, activityId: "football-qa", userId: "real-a", optionId: "valid", updatedAt: EARLIER },
      { schemaVersion: 1, activityId: "football-qa", userId: "real-b", optionId: "valid", updatedAt: LATER },
    ];
    const tally = calculateTimeConsensus({
      activityId: "football-qa",
      options: [{ id: "valid", startAt: FUTURE, endAt: FUTURE_END }, { id: "bad", startAt: "invalid", endAt: null }],
      votes, eligibleUserIds: eligible, nowMs: NOW,
    }, parseInstant);
    check(tally.voterCount === 1 && tally.suggestedOptionId === "valid"
      && tally.counts.length === 1 && tally.counts[0].count === 1,
    "Withdrawn votes and invalid time options are excluded");
    const going = selectGoingUserIds([
      { planId: "plan:football-qa", userId: "sample:pat", status: "going", updatedAt: LATER },
      { planId: "plan:football-qa", userId: "real-a", status: "going", updatedAt: LATER },
    ], "plan:football-qa", real, parseInstant);
    check(going.join(",") === "real-a", "Sample attendance is excluded");
  });

  guarded("Identifiers and plan rules", () => {
    const opaque = "user/../id:%";
    check(idFromKey(keyForId(opaque)) === opaque && !keyForId(opaque).includes("/")
      && !isValidId("x".repeat(121)) && planIdForActivity("football-qa") === "plan:football-qa",
    "IDs round-trip safely and enforce the byte limit");
    const base = {
      currentUserId: "real-a", organiserUserId: "real-a", realUserIds: new Set(["real-a", "real-b"]),
      activityId: "football-qa", activityStatus: "available" as const, existingPlanId: null,
      chosenOptionId: "valid", options: [{ id: "valid", startAt: FUTURE, endAt: FUTURE_END }],
      interestedUserIds: new Set(["real-a", "sample:pat"]), meetingPoint: " Station entrance ", nowMs: NOW,
    };
    check(evaluatePlanCreation(base, parseInstant).allowed === false,
      "Sample interest cannot satisfy the two-person threshold");
    const allowed = evaluatePlanCreation({ ...base, interestedUserIds: new Set(["real-a", "real-b"]) }, parseInstant);
    check(allowed.allowed && allowed.meetingPoint === "Station entrance",
      "Two real interested people allow explicit organiser confirmation");
    const invalid = evaluatePlanCreation({
      ...base, interestedUserIds: new Set(["real-a", "real-b"]), chosenOptionId: "bad",
    }, parseInstant);
    check(!invalid.allowed && invalid.code === "option-not-found",
      "Plan creation rejects an option absent from the activity");
  });

  try { await checkRepository(check); } catch (error) { check(false, "Repository checks completed", String(error)); }
  return results;
}

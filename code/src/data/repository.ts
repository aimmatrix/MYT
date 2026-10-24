import { profilePreferences } from "../domain/preferences";
import type { MytFilePort, MytRepository, ReadResult } from "../data-contract";
import type {
  ActionResult, ActivityCatalog, Attendance, CreatePlanResult, CurrentUser,
  InterestRecord, MytError, MytErrorCode, Plan, Profile, RecordIssue,
  SampleProfileCatalog, SessionConfig, TimeVote,
} from "../types";
import {
  ACTIVITIES_PATH, SAMPLE_PROFILES_PATH, SESSION_PATH, PROFILES_DIR,
  INTERESTS_DIR, VOTES_DIR, PLANS_DIR, ATTENDANCE_DIR, profilePath,
  interestFolderPath, interestPath, voteFolderPath, votePath,
  planPath, planPathForActivity, attendanceFolderPath, attendancePath,
} from "../paths";

type RecordMap = {
  activityCatalog: ActivityCatalog;
  sampleProfileCatalog: SampleProfileCatalog;
  session: SessionConfig;
  profile: Profile;
  interest: InterestRecord;
  vote: TimeVote;
  plan: Plan;
  attendance: Attendance;
};
type RecordKind = keyof RecordMap;
type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid-json" | "invalid-record" | "unsupported-schema"; issues: ReadonlyArray<{ path: string; reason: string }> };

export interface RepositoryDependencies {
  decodeRecord<K extends RecordKind>(kind: K, text: string): DecodeResult<RecordMap[K]>;
  isValidId(value: unknown): boolean;
  planIdForActivity(activityId: string): string;
  parseInstant(value: string): number | null;
}

function failure(code: MytErrorCode, message: string, path?: string): { ok: false; error: MytError } {
  return { ok: false, error: { code, message, ...(path ? { path } : {}) } };
}

function success<T>(value: T): ActionResult<T> {
  return { ok: true, value };
}

function issue(path: string, code: MytErrorCode, message: string): RecordIssue {
  return { path, code, message };
}

function ioError(path: string): MytError {
  return { code: "io", message: "Could not access shared data. Please retry.", path };
}

function isRealUserId(value: unknown, dependencies: RepositoryDependencies): value is string {
  return typeof value === "string" && dependencies.isValidId(value)
    && !value.startsWith("sample:") && !value.startsWith("preview:");
}

function isPathId(value: unknown, dependencies: RepositoryDependencies): value is string {
  return dependencies.isValidId(value);
}

function safePath(makePath: () => string): ActionResult<string> {
  try {
    return success(makePath());
  } catch {
    return failure("id-invalid", "An identifier cannot be used as a data path.");
  }
}

function utcNow(): string {
  return new Date().toISOString();
}

export function createMytRepository(
  files: MytFilePort,
  currentUser: CurrentUser | null,
  dependencies: RepositoryDependencies,
): MytRepository {
  function actor(): ActionResult<string> {
    if (!currentUser) return failure("not-signed-in", "Sign in to save your choices.");
    if (!isRealUserId(currentUser.id, dependencies)) {
      return failure("id-invalid", "This account has an invalid user ID.");
    }
    return success(currentUser.id);
  }

  async function listed(path: string): Promise<ActionResult<{ path: string; name: string; kind: "file" | "folder" }[] | null>> {
    try {
      return success(await files.list(path));
    } catch {
      if (path === "" || path === "data") return failure("io", "Could not list shared data.", path);
      // S1 integration fix. Decide "missing" by walking down from "data", which always exists.
      // Listing only the immediate parent reported a hard io error whenever a grandparent folder
      // was absent too (for example data/interests before anyone has joined), so a fresh install
      // could not show any interest count.
      const segments = path.split("/");
      let current = segments[0] ?? "";
      for (let index = 1; index < segments.length; index += 1) {
        let entries: { name: string; kind: "file" | "folder" }[];
        try {
          entries = await files.list(current);
        } catch {
          return failure("io", "Could not list shared data.", path);
        }
        const entry = entries.find(item => item.name === segments[index]);
        if (!entry) return success(null);
        if (entry.kind !== "folder") return failure("io", "Expected a folder but found a file.", path);
        current = `${current}/${segments[index]}`;
      }
      return failure("io", "Could not list shared data.", path);
    }
  }

  async function exists(path: string): Promise<ActionResult<boolean>> {
    const slash = path.lastIndexOf("/");
    const parent = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const listing = await listed(parent);
    if (!listing.ok) return listing;
    return success(listing.value?.some(entry => entry.name === name && entry.kind === "file") ?? false);
  }

  async function readText(path: string): Promise<ActionResult<string | null>> {
    try {
      return success(await files.readText(path));
    } catch {
      const present = await exists(path);
      if (!present.ok) return present;
      return present.value
        ? { ok: false, error: ioError(path) }
        : success(null);
    }
  }

  function decode<K extends RecordKind>(kind: K, text: string, path: string): ActionResult<RecordMap[K]> {
    const decoded = dependencies.decodeRecord(kind, text);
    if (decoded.ok) return success(decoded.value);
    return failure(decoded.code, decoded.issues.map(item => item.path + ": " + item.reason).join("; ") || "Invalid shared record.", path);
  }

  async function readRequired<K extends RecordKind>(kind: K, path: string): Promise<ReadResult<RecordMap[K]>> {
    const text = await readText(path);
    if (!text.ok) return text;
    if (text.value === null) return failure("not-found", "Required shared data is missing.", path);
    const decoded = decode(kind, text.value, path);
    return decoded.ok ? success({ value: decoded.value, issues: [] }) : decoded;
  }

  async function readOptional<K extends RecordKind>(kind: K, path: string): Promise<ActionResult<RecordMap[K] | null>> {
    const text = await readText(path);
    if (!text.ok) return text;
    return text.value === null ? success(null) : decode(kind, text.value, path);
  }

  async function readCollection<K extends RecordKind>(
    folder: string,
    kind: K,
    accepts: (record: RecordMap[K], path: string) => boolean,
  ): Promise<ReadResult<RecordMap[K][]>> {
    const listing = await listed(folder);
    if (!listing.ok) return listing;
    if (listing.value === null) return success({ value: [], issues: [] });
    const paths = listing.value.filter(entry => entry.kind === "file" && entry.name.endsWith(".json")).map(entry => entry.path);
    const results = await Promise.all(paths.map(async path => {
      const text = await readText(path);
      if (!text.ok) return { path, result: text };
      if (text.value === null) return { path, result: failure("not-found", "Record disappeared during loading.", path) };
      const decoded = decode(kind, text.value, path);
      if (decoded.ok && !accepts(decoded.value, path)) {
        return { path, result: failure("invalid-record", "Record identity does not match its file path.", path) };
      }
      return { path, result: decoded };
    }));
    const values: RecordMap[K][] = [];
    const issues: RecordIssue[] = [];
    for (const { path, result } of results) {
      if (result.ok) values.push(result.value);
      else if (result.error.code === "io") return result;
      else issues.push(issue(path, result.error.code, result.error.message));
    }
    return success({ value: values, issues });
  }

  async function writeRecord<K extends RecordKind>(
    kind: K, path: string, record: RecordMap[K], overwrite: boolean,
  ): Promise<ActionResult<RecordMap[K]>> {
    const text = JSON.stringify(record);
    const checked = decode(kind, text, path);
    if (!checked.ok) return checked;
    try {
      await files.writeText(path, text, { overwrite });
      return success(checked.value);
    } catch {
      return { ok: false, error: ioError(path) };
    }
  }

  async function loadActivities(): Promise<ReadResult<ActivityCatalog>> {
    return readRequired("activityCatalog", ACTIVITIES_PATH);
  }

  async function loadSamples(): Promise<ReadResult<SampleProfileCatalog>> {
    return readRequired("sampleProfileCatalog", SAMPLE_PROFILES_PATH);
  }

  async function loadSession(): Promise<ReadResult<SessionConfig>> {
    return readRequired("session", SESSION_PATH);
  }

  async function loadMyProfile(): Promise<ReadResult<Profile | null>> {
    const me = actor();
    if (!me.ok) return me;
    const path = safePath(() => profilePath(me.value));
    if (!path.ok) return path;
    const result = await readOptional("profile", path.value);
    if (!result.ok) return result;
    if (result.value && (result.value.userId !== me.value || result.value.isDemo)) {
      return failure("invalid-record", "Profile identity does not match this account.", path.value);
    }
    return success({ value: result.value, issues: [] });
  }

  async function loadRealProfiles(): Promise<ReadResult<Record<string, Profile>>> {
    const result = await readCollection(PROFILES_DIR, "profile",
      (record, path) => isRealUserId(record.userId, dependencies) && !record.isDemo
        && safePath(() => profilePath(record.userId)).ok
        && profilePath(record.userId) === path);
    if (!result.ok) return result;
    const profiles: Record<string, Profile> = {};
    for (const profile of result.value.value) profiles[profile.userId] = profile;
    return success({ value: profiles, issues: result.value.issues });
  }

  async function loadInterests(activityId: string): Promise<ReadResult<InterestRecord[]>> {
    if (!isPathId(activityId, dependencies)) return failure("id-invalid", "Invalid activity ID.");
    const folder = safePath(() => interestFolderPath(activityId));
    if (!folder.ok) return folder;
    return readCollection(folder.value, "interest",
      (record, path) => record.activityId === activityId && isRealUserId(record.userId, dependencies)
        && interestPath(activityId, record.userId) === path);
  }

  async function loadVotes(activityId: string): Promise<ReadResult<TimeVote[]>> {
    if (!isPathId(activityId, dependencies)) return failure("id-invalid", "Invalid activity ID.");
    const folder = safePath(() => voteFolderPath(activityId));
    if (!folder.ok) return folder;
    return readCollection(folder.value, "vote",
      (record, path) => record.activityId === activityId && isRealUserId(record.userId, dependencies)
        && votePath(activityId, record.userId) === path);
  }

  async function loadPlans(): Promise<ReadResult<Record<string, Plan>>> {
    const result = await readCollection(PLANS_DIR, "plan",
      (record, path) => {
        if (!isPathId(record.activityId, dependencies) || !isRealUserId(record.organiserId, dependencies)) return false;
        const expected = safePath(() => dependencies.planIdForActivity(record.activityId));
        return expected.ok && record.id === expected.value && planPath(record.id) === path;
      });
    if (!result.ok) return result;
    const plans: Record<string, Plan> = {};
    for (const plan of result.value.value) plans[plan.id] = plan;
    return success({ value: plans, issues: result.value.issues });
  }

  async function loadAttendance(planId: string): Promise<ReadResult<Attendance[]>> {
    if (!isPathId(planId, dependencies)) return failure("id-invalid", "Invalid plan ID.");
    const folder = safePath(() => attendanceFolderPath(planId));
    if (!folder.ok) return folder;
    return readCollection(folder.value, "attendance",
      (record, path) => record.planId === planId && isRealUserId(record.userId, dependencies)
        && attendancePath(planId, record.userId) === path);
  }

  async function saveProfile(input: Parameters<MytRepository["saveProfile"]>[0]): Promise<ActionResult<Profile>> {
    const me = actor();
    if (!me.ok) return me;
    const path = safePath(() => profilePath(me.value));
    if (!path.ok) return path;
    return writeRecord("profile", path.value,
      { schemaVersion: 1, userId: me.value, ...profilePreferences(input), isDemo: false }, true);
  }

  async function activityForAction(activityId: string): Promise<ActionResult<ActivityCatalog["items"][number]>> {
    if (!isPathId(activityId, dependencies)) return failure("id-invalid", "Invalid activity ID.");
    const catalog = await loadActivities();
    if (!catalog.ok) return catalog;
    const activity = catalog.value.value.items.find(item => item.id === activityId);
    return activity ? success(activity) : failure("not-found", "Activity was not found.", ACTIVITIES_PATH);
  }

  async function existingPlan(activityId: string): Promise<ActionResult<Plan | null>> {
    const path = safePath(() => planPathForActivity(activityId));
    if (!path.ok) return path;
    const plan = await readOptional("plan", path.value);
    if (!plan.ok) return plan;
    if (plan.value && (plan.value.activityId !== activityId || plan.value.id !== dependencies.planIdForActivity(activityId))) {
      return failure("invalid-record", "Plan identity does not match its file path.", path.value);
    }
    return plan;
  }

  async function setInterest(activityId: string, status: InterestRecord["status"]): Promise<ActionResult<InterestRecord>> {
    const me = actor();
    if (!me.ok) return me;
    if (status !== "interested" && status !== "withdrawn") return failure("invalid-record", "Invalid interest choice.");
    const activity = await activityForAction(activityId);
    if (!activity.ok) return activity;
    if (activity.value.status !== "available") return failure("not-allowed", "This activity is unavailable.");
    const plan = await existingPlan(activityId);
    if (!plan.ok) return plan;
    if (plan.value) return failure("not-allowed", "This activity already has a confirmed plan.");
    const path = safePath(() => interestPath(activityId, me.value));
    if (!path.ok) return path;
    return writeRecord("interest", path.value,
      { schemaVersion: 1, activityId, userId: me.value, status, updatedAt: utcNow() }, true);
  }

  async function setVote(activityId: string, optionId: string | null): Promise<ActionResult<TimeVote>> {
    const me = actor();
    if (!me.ok) return me;
    const activity = await activityForAction(activityId);
    if (!activity.ok) return activity;
    if (activity.value.status !== "available") return failure("not-allowed", "This activity is unavailable.");
    const plan = await existingPlan(activityId);
    if (!plan.ok) return plan;
    if (plan.value) return failure("not-allowed", "This activity already has a confirmed plan.");
    const interestPathResult = safePath(() => interestPath(activityId, me.value));
    if (!interestPathResult.ok) return interestPathResult;
    const interest = await readOptional("interest", interestPathResult.value);
    if (!interest.ok) return interest;
    if (!interest.value || interest.value.activityId !== activityId || interest.value.userId !== me.value
      || interest.value.status !== "interested") return failure("not-allowed", "Join this activity before choosing a time.");
    if (optionId !== null) {
      const option = activity.value.timeOptions.find(item => item.id === optionId);
      const startMs = option ? dependencies.parseInstant(option.startAt) : null;
      const endMs = option?.endAt ? dependencies.parseInstant(option.endAt) : null;
      if (!option || startMs === null || startMs <= Date.now()
        || (option.endAt !== null && (endMs === null || endMs <= startMs))) {
        return failure("not-allowed", "Choose a future time option.");
      }
    }
    const path = safePath(() => votePath(activityId, me.value));
    if (!path.ok) return path;
    return writeRecord("vote", path.value,
      { schemaVersion: 1, activityId, userId: me.value, optionId, updatedAt: utcNow() }, true);
  }

  async function claimOrganiser(input: { replace: boolean }): Promise<ActionResult<SessionConfig>> {
    const me = actor();
    if (!me.ok) return me;
    const session = await loadSession();
    if (!session.ok) return session;
    if (session.value.value.organiserUserId === me.value) return success(session.value.value);
    if (session.value.value.organiserUserId && !input.replace) {
      return failure("not-allowed", "An organiser is already set. Use Replace organiser deliberately.", SESSION_PATH);
    }
    return writeRecord("session", SESSION_PATH,
      { schemaVersion: 1, organiserUserId: me.value }, true);
  }

  async function confirmPlan(input: Parameters<MytRepository["confirmPlan"]>[0]): Promise<CreatePlanResult> {
    const me = actor();
    if (!me.ok) return me;
    const activity = await activityForAction(input.activityId);
    if (!activity.ok) return activity;
    const path = safePath(() => planPathForActivity(input.activityId));
    if (!path.ok) return path;
    const prior = await existingPlan(input.activityId);
    if (!prior.ok) return prior;
    if (prior.value) return comparableExisting(prior.value, input);
    const session = await loadSession();
    if (!session.ok) return session;
    if (session.value.value.organiserUserId !== me.value) {
      return failure("not-allowed", "Only the designated organiser can confirm this plan.");
    }
    if (activity.value.status !== "available") return failure("not-allowed", "This activity is unavailable.");
    const interests = await loadInterests(input.activityId);
    if (!interests.ok) return interests;
    const interested = new Set(interests.value.value
      .filter(record => record.status === "interested" && isRealUserId(record.userId, dependencies))
      .map(record => record.userId));
    if (!interested.has(me.value) || interested.size < 2) {
      return failure("not-allowed", "Two real interested people, including the organiser, are needed.");
    }
    const option = activity.value.timeOptions.find(item => item.id === input.optionId);
    const startMs = option ? dependencies.parseInstant(option.startAt) : null;
    const endMs = option?.endAt ? dependencies.parseInstant(option.endAt) : null;
    if (!option || startMs === null || startMs <= Date.now()
      || (option.endAt !== null && (endMs === null || endMs <= startMs))) {
      return failure("not-allowed", "Choose a valid future time.");
    }
    const meetingPoint = input.meetingPoint.trim();
    // Count characters as planRules does, so an emoji is not rejected here but allowed in the form.
    if (!meetingPoint || Array.from(meetingPoint).length > 240) {
      return failure("not-allowed", "Enter a public meeting point of 1 to 240 characters.");
    }
    const derivedId = safePath(() => dependencies.planIdForActivity(input.activityId));
    if (!derivedId.ok) return derivedId;
    const planId = derivedId.value;
    const plan: Plan = {
      schemaVersion: 1, id: planId, activityId: input.activityId, organiserId: me.value,
      chosenOptionId: option.id, startAt: option.startAt, endAt: option.endAt,
      meetingPoint, createdAt: utcNow(),
    };
    const checked = decode("plan", JSON.stringify(plan), path.value);
    if (!checked.ok) return checked;
    const latest = await existingPlan(input.activityId);
    if (!latest.ok) return latest;
    if (latest.value) return comparableExisting(latest.value, input);
    try {
      await files.writeText(path.value, JSON.stringify(plan), { overwrite: false });
      return { ok: true, kind: "created", plan };
    } catch {
      const after = await existingPlan(input.activityId);
      if (!after.ok) return after;
      return after.value ? comparableExisting(after.value, input) : { ok: false, error: ioError(path.value) };
    }
  }

  function comparableExisting(plan: Plan, input: Parameters<MytRepository["confirmPlan"]>[0]): CreatePlanResult {
    return plan.chosenOptionId === input.optionId && plan.meetingPoint === input.meetingPoint.trim()
      ? { ok: true, kind: "existing", plan }
      : failure("already-exists", "A different plan is already confirmed. Open the saved plan.", planPath(plan.id));
  }

  async function setAttendance(planId: string, status: Attendance["status"]): Promise<ActionResult<Attendance>> {
    const me = actor();
    if (!me.ok) return me;
    if (status !== "going" && status !== "declined") return failure("invalid-record", "Invalid attendance choice.");
    if (!isPathId(planId, dependencies)) return failure("id-invalid", "Invalid plan ID.");
    const path = safePath(() => planPath(planId));
    if (!path.ok) return path;
    const plan = await readOptional("plan", path.value);
    if (!plan.ok) return plan;
    if (!plan.value || plan.value.id !== planId) {
      return failure("not-found", "Confirmed plan was not found.", path.value);
    }
    const planActivityId = plan.value.activityId;
    const expectedId = safePath(() => dependencies.planIdForActivity(planActivityId));
    if (!expectedId.ok || expectedId.value !== planId) {
      return failure("invalid-record", "Plan identity does not match its activity.", path.value);
    }
    const startMs = dependencies.parseInstant(plan.value.startAt);
    if (status === "going" && (startMs === null || startMs <= Date.now())) {
      return failure("not-allowed", "You cannot join a past plan.");
    }
    const ownPath = safePath(() => attendancePath(planId, me.value));
    if (!ownPath.ok) return ownPath;
    return writeRecord("attendance", ownPath.value,
      { schemaVersion: 1, planId, userId: me.value, status, updatedAt: utcNow() }, true);
  }

  return {
    loadActivities, loadSamples, loadSession, loadMyProfile, loadRealProfiles,
    loadInterests, loadVotes, loadPlans, loadAttendance,
    saveProfile, setInterest, setVote, claimOrganiser, confirmPlan, setAttendance,
  };
}

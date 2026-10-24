import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MytActions, MytViewModel, MytFilePort } from "./data-contract";
import type {
  ActionResult,
  ActionState,
  Activity,
  ActivityFilters,
  ActivityPresence,
  AppMode,
  Attendance,
  ConfirmPlanInput,
  CreatePlanResult,
  CurrentUser,
  InterestRecord,
  Loadable,
  MytError,
  ParticipantSummary,
  Plan,
  PlanCreationDecision,
  Profile,
  ProfileInput,
  RankedActivity,
  RecordIssue,
  Route,
  SessionConfig,
  TimeConsensus,
  TimeVote,
} from "./types";
import type { PlanCard } from "./ui-contract";
import { filePort, toCurrentUser, useCurrentUser } from "./host";
import { createSocialRepository } from "./data/socialRepository";
import { createAppRepository } from "./wiring/appRepository";
import { useParticipation } from "./wiring/useParticipation";
import { useMytData } from "./hooks/useMytData";
import { useActivityPresence } from "./hooks/useActivityPresence";
import { useAsyncAction, type AsyncAction } from "./hooks/useAsyncAction";
import { rankActivities } from "./domain/matching";
import { isValidId, planIdForActivity } from "./domain/identifiers";
import { getFutureTimeOptions, parseInstant } from "./domain/londonTime";
import { selectGoingUserIds, selectInterestedUserIds } from "./domain/participantSelectors";
import { calculateTimeConsensus } from "./domain/timeConsensus";
import { evaluatePlanCreation } from "./domain/planRules";
import { buildPreviewModel, listPreviewScenarios } from "./preview/buildPreviewModel";
import { DEFAULT_PREVIEW_NOW_MS, type PreviewScenarioId } from "./preview/fixtures";
import { Button, Wordmark, TabBar, Avatar } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SocialScreens } from "./screens/SocialScreens";
import { emptySocial, groupMembers, unreadCount } from "./domain/social";
import { Onboarding } from "./screens/Onboarding";
import { Discover } from "./screens/Discover";
import { ActivityDetail } from "./screens/ActivityDetail";
import { ConfirmPlan } from "./screens/ConfirmPlan";
import { MyPlans } from "./screens/MyPlans";
import { Setup } from "./screens/Setup";
import { SourceStatus } from "./components/SourceStatus";
import { PlanSummary } from "./components/PlanSummary";
import { M0Probe } from "./m0Probe";
import { DemoDock, DemoModeButton } from "./demo/DemoDock";
import { createDemoSession, type DemoSession } from "./demo/session";
import { CommunityActivities } from "./screens/CommunityActivities";

/*
 * S1: the one place that composes every module. Screens stay prop-driven; this file derives
 * their props from the view model and the domain helpers. Live and preview are separate
 * component trees so preview never joins a room, reads shared files or exposes a write.
 */

// ---------------------------------------------------------------- small helpers

type Dict<T> = Record<string, T>;
const NO_TYPING = (_chatId: string | null) => {};
const EMPTY_ISSUES: RecordIssue[] = [];
const NO_ACTION_STATE: ActionState = { status: "idle" };

function own<T>(map: Dict<T> | undefined, key: string): T | undefined {
  return map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

function ready<T>(value: T, issues: RecordIssue[] = EMPTY_ISSUES): Loadable<T> {
  return { state: "ready", value, issues };
}

function isRealUserId(id: string): boolean {
  return isValidId(id) && !id.startsWith("sample:") && !id.startsWith("preview:");
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Loading or error slices pass through for any value type; only a ready slice returns null. */
function notReady<T>(slice: Loadable<unknown>): Loadable<T> | null {
  return slice.state === "ready" ? null : slice;
}

const BUSY: { ok: false; error: MytError } = {
  ok: false,
  error: { code: "not-allowed", message: "Still saving your previous change. Try again in a moment." },
};
const UNEXPECTED: { ok: false; error: MytError } = {
  ok: false,
  error: { code: "io", message: "The change could not be saved. Please try again." },
};
const UNAVAILABLE: { ok: false; error: MytError } = {
  ok: false,
  error: { code: "not-signed-in", message: "Sign in to save your choices." },
};

type Ran<V> = ActionResult<V> | CreatePlanResult | null;

/** Screens want a plain ActionResult; the hook returns null for a duplicate click. */
function toActionResult<V>(result: Ran<V>): ActionResult<V> {
  if (result === null) return BUSY;
  if ("kind" in result) return UNEXPECTED;
  return result;
}

function toCreatePlanResult(result: Ran<Plan>): CreatePlanResult {
  if (result === null) return BUSY;
  if ("kind" in result) return result;
  return result.ok ? UNEXPECTED : result;
}

// ---------------------------------------------------------------- actions

interface ActionBundle {
  profile: AsyncAction<Profile, [ProfileInput]>;
  interest: AsyncAction<InterestRecord, ["interested" | "withdrawn"]>;
  vote: AsyncAction<TimeVote, [string | null]>;
  confirm: AsyncAction<Plan, [ConfirmPlanInput]>;
  attendance: AsyncAction<Attendance, ["going" | "declined"]>;
  claim: AsyncAction<SessionConfig, [boolean]>;
}

/** One hook instance per independent write, scoped so state clears when the context changes. */
function useActionBundle(
  actions: MytActions | null,
  userId: string | null,
  activityId: string | null,
  planId: string | null,
): ActionBundle {
  const scope = (name: string) => `${userId ?? "anon"}:${activityId ?? planId ?? "-"}:${name}`;
  const profile = useAsyncAction<Profile, [ProfileInput]>(
    (input) => (actions ? actions.saveProfile(input) : Promise.resolve(UNAVAILABLE)),
    scope("profile"),
  );
  const interest = useAsyncAction<InterestRecord, ["interested" | "withdrawn"]>(
    (status) => (actions && activityId ? actions.setInterest(activityId, status) : Promise.resolve(UNAVAILABLE)),
    scope("interest"),
  );
  const vote = useAsyncAction<TimeVote, [string | null]>(
    (optionId) => (actions && activityId ? actions.setVote(activityId, optionId) : Promise.resolve(UNAVAILABLE)),
    scope("vote"),
  );
  const confirm = useAsyncAction<Plan, [ConfirmPlanInput]>(
    (input) => (actions ? actions.confirmPlan(input) : Promise.resolve(UNAVAILABLE)),
    scope("confirm"),
  );
  const attendance = useAsyncAction<Attendance, ["going" | "declined"]>(
    (status) => (actions && planId ? actions.setAttendance(planId, status) : Promise.resolve(UNAVAILABLE)),
    scope("attendance"),
  );
  const claim = useAsyncAction<SessionConfig, [boolean]>(
    (replace) => (actions ? actions.claimOrganiser({ replace }) : Promise.resolve(UNAVAILABLE)),
    scope("claim"),
  );
  return { profile, interest, vote, confirm, attendance, claim };
}

// ---------------------------------------------------------------- derived data

interface Ctx {
  files?: MytFilePort;
  demoSession?: DemoSession;
  demo?: boolean;
  mode: AppMode;
  currentUser: CurrentUser | null;
  vm: MytViewModel;
  navigate: (route: Route) => void;
  nowMs: number;
  interests: Loadable<Dict<InterestRecord[]>>;
  attendance: Loadable<Dict<Attendance[]>>;
  realUserIds: ReadonlySet<string>;
  presence: ActivityPresence;
  bundle: ActionBundle;
  onTyping?: (chatId: string | null) => void;
  onEnterPreview?: () => void;
  onExitPreview?: () => void;
  /** Preview only: the example profile save state a scenario wants to show. */
  previewSaveState?: ActionState;
}

function profilesOf(vm: MytViewModel): Dict<Profile> {
  return vm.realProfiles.state === "ready" ? vm.realProfiles.value : Object.create(null);
}

function summarise(ctx: Ctx, userId: string): ParticipantSummary {
  const profile = own(profilesOf(ctx.vm), userId);
  if (profile) {
    return {
      userId,
      displayName: profile.displayName,
      university: profile.university.trim() === "" ? null : profile.university,
      interestIds: profile.interestIds,
      availability: profile.availability,
    };
  }
  const me = ctx.currentUser;
  return { userId, displayName: me && me.id === userId ? me.name : "", university: null };
}

function summariseAll(ctx: Ctx, userIds: readonly string[]): ParticipantSummary[] {
  return userIds.map((id) => summarise(ctx, id));
}

function interestRecords(ctx: Ctx, activityId: string): Loadable<InterestRecord[]> {
  const slice = ctx.interests;
  return slice.state === "ready" ? ready(own(slice.value, activityId) ?? [], slice.issues) : slice;
}

function attendanceRecords(ctx: Ctx, planId: string): Loadable<Attendance[]> {
  const slice = ctx.attendance;
  return slice.state === "ready" ? ready(own(slice.value, planId) ?? [], slice.issues) : slice;
}

function interestedIdsOf(ctx: Ctx, activityId: string): string[] | null {
  const records = interestRecords(ctx, activityId);
  return records.state === "ready"
    ? selectInterestedUserIds(records.value, activityId, ctx.realUserIds, parseInstant)
    : null;
}

function goingIdsOf(ctx: Ctx, planId: string): string[] | null {
  const records = attendanceRecords(ctx, planId);
  return records.state === "ready"
    ? selectGoingUserIds(records.value, planId, ctx.realUserIds, parseInstant)
    : null;
}

function activityOf(ctx: Ctx, activityId: string): Loadable<Activity | null> {
  const catalog = ctx.vm.activities;
  if (catalog.state !== "ready") return catalog;
  return ready(catalog.value.items.find((item) => item.id === activityId) ?? null, catalog.issues);
}

function planOfActivity(ctx: Ctx, activityId: string): Loadable<Plan | null> {
  const plans = ctx.vm.plansById;
  if (plans.state !== "ready") return plans;
  let planId: string;
  try {
    planId = planIdForActivity(activityId);
  } catch {
    return ready(null, plans.issues);
  }
  return ready(own(plans.value, planId) ?? null, plans.issues);
}

function planById(ctx: Ctx, planId: string): Loadable<Plan | null> {
  const plans = ctx.vm.plansById;
  return plans.state === "ready" ? ready(own(plans.value, planId) ?? null, plans.issues) : plans;
}

function myInterestOf(ctx: Ctx, activityId: string): Loadable<"interested" | "withdrawn" | null> {
  const records = interestRecords(ctx, activityId);
  if (records.state !== "ready") return records;
  const mine = ctx.currentUser ? records.value.find((r) => r.userId === ctx.currentUser?.id) : undefined;
  return ready(mine ? mine.status : null, records.issues);
}

function votesOf(ctx: Ctx, activityId: string): Loadable<TimeVote[]> {
  const slice = ctx.vm.votesByActivity;
  return slice.state === "ready" ? ready(own(slice.value, activityId) ?? [], slice.issues) : slice;
}

function consensusOf(ctx: Ctx, activity: Activity): Loadable<TimeConsensus> {
  const votes = votesOf(ctx, activity.id);
  const interested = interestedIdsOf(ctx, activity.id);
  if (votes.state !== "ready") return votes;
  if (interested === null) return notReady<TimeConsensus>(interestRecords(ctx, activity.id)) ?? { state: "loading" };
  return ready(
    calculateTimeConsensus(
      {
        activityId: activity.id,
        options: activity.timeOptions,
        votes: votes.value,
        eligibleUserIds: new Set(interested),
        nowMs: ctx.nowMs,
      },
      parseInstant,
    ),
    votes.issues,
  );
}

function organiserIdOf(ctx: Ctx): string | null {
  return ctx.vm.session.state === "ready" ? ctx.vm.session.value.organiserUserId : null;
}

function evaluateDraftFor(
  ctx: Ctx,
  activity: Activity,
  existingPlan: Plan | null,
  optionId: string | null,
  meetingPoint: string,
): PlanCreationDecision {
  return evaluatePlanCreation(
    {
      currentUserId: ctx.currentUser?.id ?? null,
      organiserUserId: organiserIdOf(ctx),
      realUserIds: ctx.realUserIds,
      activityId: activity.id,
      activityStatus: activity.status,
      existingPlanId: existingPlan ? existingPlan.id : null,
      chosenOptionId: optionId,
      options: activity.timeOptions,
      interestedUserIds: new Set(interestedIdsOf(ctx, activity.id) ?? []),
      meetingPoint,
      // Read when called, so an option that expires while the screen is open is caught on click.
      nowMs: Date.now(),
    },
    parseInstant,
  );
}

/** Decides only whether to offer the confirm screen. The full draft check happens there. */
function confirmationEntryFor(
  ctx: Ctx,
  activity: Activity,
  plan: Loadable<Plan | null>,
): { allowed: boolean; reason: string | null } {
  if (plan.state !== "ready") return { allowed: false, reason: "Checking whether a plan already exists." };
  if (ctx.mode === "preview") return { allowed: false, reason: "Confirming is not available in preview." };
  if (ctx.vm.session.state !== "ready") return { allowed: false, reason: "Checking who the organiser is." };
  const firstFuture = getFutureTimeOptions(activity.timeOptions, ctx.nowMs)[0];
  if (!firstFuture) {
    return {
      allowed: false,
      reason: activity.timeOptions.length === 0 ? "This activity has no proposed times yet." : "No proposed time is still in the future.",
    };
  }
  const decision = evaluateDraftFor(ctx, activity, plan.value, firstFuture.id, "Public meeting point");
  return decision.allowed ? { allowed: true, reason: null } : { allowed: false, reason: decision.message };
}

// ---------------------------------------------------------------- route components

function DiscoverRoute({
  ctx,
  filters,
  onFiltersChange,
}: {
  ctx: Ctx;
  filters: ActivityFilters;
  onFiltersChange: (filters: ActivityFilters) => void;
}) {
  const { vm, nowMs } = ctx;
  const profile = vm.myProfile.state === "ready" ? vm.myProfile.value : null;
  const ranked = useMemo<Loadable<RankedActivity[]>>(() => {
    if (vm.activities.state !== "ready") return vm.activities;
    const result = rankActivities({ profile, activities: vm.activities.value.items, nowMs, filters });
    const issues: RecordIssue[] = result.issues.map((item) => ({
      path: item.activityId,
      code: "invalid-record",
      message: item.message,
    }));
    return ready(result.items, [...vm.activities.issues, ...issues]);
  }, [vm.activities, profile, nowMs, filters]);

  const counts = useMemo(() => {
    const out: Dict<number> = Object.create(null);
    if (ctx.interests.state !== "ready" || vm.activities.state !== "ready") return out;
    for (const activity of vm.activities.value.items) {
      out[activity.id] = selectInterestedUserIds(
        own(ctx.interests.value, activity.id) ?? [],
        activity.id,
        ctx.realUserIds,
        parseInstant,
      ).length;
    }
    return out;
  }, [ctx.interests, ctx.realUserIds, vm.activities]);

  return (
    <Discover
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      greetingName={profile ? profile.displayName : null}
      rankedActivities={ranked}
      aiProfile={profile}
      aiInterestedActivityIds={ctx.interests.state === "ready" && ctx.currentUser ? Object.entries(ctx.interests.value).filter(([, records]) => records.some(r => r.userId === ctx.currentUser!.id && r.status === "interested")).map(([id]) => id) : []}
      filters={filters}
      interestedCounts={counts}
      onFiltersChange={onFiltersChange}
      onOpenActivity={(activityId) => ctx.navigate({ name: "activity", activityId })}
      onOpenPlans={() => ctx.navigate({ name: "plans" })}
    />
  );
}

function ActivityRoute({ ctx, activityId }: { ctx: Ctx; activityId: string }) {
  const { vm, bundle } = ctx;
  const activityLoadable = activityOf(ctx, activityId);
  const activity = activityLoadable.state === "ready" ? activityLoadable.value : null;
  const plan = planOfActivity(ctx, activityId);
  const canWrite = ctx.mode === "live" && ctx.currentUser !== null && vm.actions !== null;
  const interestRecordsSlice = interestRecords(ctx, activityId);
  const interestedIds = interestedIdsOf(ctx, activityId);
  const interestedPeople: Loadable<ParticipantSummary[]> =
    interestRecordsSlice.state !== "ready"
      ? interestRecordsSlice
      : vm.realProfiles.state === "loading"
        ? { state: "loading" }
        : ready(summariseAll(ctx, interestedIds ?? []), interestRecordsSlice.issues);

  const futureIds = useMemo(
    () => new Set(activity ? getFutureTimeOptions(activity.timeOptions, ctx.nowMs).map((o) => o.id) : []),
    [activity, ctx.nowMs],
  );
  const myVote: Loadable<TimeVote | null> = (() => {
    const votes = votesOf(ctx, activityId);
    if (votes.state !== "ready") return votes;
    const mine = ctx.currentUser ? votes.value.find((v) => v.userId === ctx.currentUser?.id) : undefined;
    return ready(mine ?? null, votes.issues);
  })();

  // The profile list can be absent while samples load; the companion list handles empty input.
  const samples = vm.samples.state === "ready" ? vm.samples.value.items : [];
  const myProfile = vm.myProfile.state === "ready" ? vm.myProfile.value : null;
  const placeholder: Activity = {
    schemaVersion: 1,
    id: activityId,
    title: "Loading",
    description: "",
    interestId: "football",
    area: "",
    status: "unavailable",
    timeOptions: [],
    cost: { amountPence: null, currency: "GBP", isEstimate: false },
    source: { kind: "unverified", url: null, checkedAt: null },
  };
  const shown = activity ?? placeholder;
  const interest = myInterestOf(ctx, activityId);

  return (
    <ActivityDetail
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      activity={activityLoadable}
      onOpenChat={ctx.currentUser && interestedIds?.includes(ctx.currentUser.id) ? () => ctx.navigate({name:"chat",chatId:`group:${activityId}`}) : undefined}
      plan={plan}
      interestPanel={{
        mode: ctx.mode,
        currentUser: ctx.currentUser,
        activityId,
        activityAvailable: activity !== null && activity.status === "available",
        planExists: plan.state === "ready" && plan.value !== null,
        interest,
        interestedPeople,
        actionState: bundle.interest.state,
        onSetInterest: canWrite ? async (status) => { const result=toActionResult(await bundle.interest.run(status)); if(result.ok&&ctx.demo&&status==="interested")ctx.navigate({name:"chat",chatId:`group:${activityId}`}); return result; } : undefined,
        onExitPreview: ctx.onExitPreview,
      }}
      timeVotePanel={{
        mode: ctx.mode,
        currentUser: ctx.currentUser,
        activityId,
        options: shown.timeOptions,
        validFutureOptionIds: futureIds,
        myInterest: interest,
        myVote,
        consensus: activity ? consensusOf(ctx, activity) : { state: "loading" },
        planExists: plan.state === "ready" && plan.value !== null,
        actionState: bundle.vote.state,
        onSetVote: canWrite ? async (optionId) => toActionResult(await bundle.vote.run(optionId)) : undefined,
        onGoToInterest: () => undefined,
      }}
      companionList={{
        activity: shown,
        currentProfile: myProfile,
        realParticipants: summariseAll(ctx, interestedIds ?? []),
        sampleProfiles: samples,
      }}
      presenceStrip={{ presence: ctx.presence, mode: ctx.mode, currentUser: ctx.currentUser }}
      confirmationEntry={activity ? confirmationEntryFor(ctx, activity, plan) : { allowed: false, reason: null }}
      onOpenConfirmation={() => ctx.navigate({ name: "confirm", activityId })}
      onOpenPlan={(planId) => ctx.navigate({ name: "plan", planId })}
      onBack={() => ctx.navigate({ name: "discover" })}
    />
  );
}

function ConfirmRoute({ ctx, activityId }: { ctx: Ctx; activityId: string }) {
  const { bundle } = ctx;
  const activityLoadable = activityOf(ctx, activityId);
  const activity = activityLoadable.state === "ready" ? activityLoadable.value : null;
  const plan = planOfActivity(ctx, activityId);
  const interestSlice = interestRecords(ctx, activityId);
  const interestedIds = interestedIdsOf(ctx, activityId);
  const interestedPeople: Loadable<ParticipantSummary[]> =
    interestSlice.state !== "ready" ? interestSlice : ready(summariseAll(ctx, interestedIds ?? []), interestSlice.issues);
  const canWrite = ctx.mode === "live" && ctx.currentUser !== null && ctx.vm.actions !== null;

  return (
    <ConfirmPlan
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      activity={activityLoadable}
      existingPlan={plan}
      interestedPeople={interestedPeople}
      organiserUserId={organiserIdOf(ctx)}
      consensus={activity ? consensusOf(ctx, activity) : { state: "loading" }}
      initialOptionId={null}
      evaluateDraft={(optionId, meetingPoint) =>
        activity
          ? evaluateDraftFor(ctx, activity, plan.state === "ready" ? plan.value : null, optionId, meetingPoint)
          : { allowed: false, code: "activity-missing", message: "This activity could not be found." }
      }
      confirmState={bundle.confirm.state}
      onConfirm={canWrite ? async (input) => toCreatePlanResult(await bundle.confirm.run(input)) : undefined}
      onOpenPlan={(planId) => ctx.navigate({ name: "plan", planId })}
      onBack={() => ctx.navigate({ name: "activity", activityId })}
    />
  );
}

interface PlansModel {
  plans: Loadable<PlanCard[]>;
  goingPeople?: Dict<Loadable<ParticipantSummary[]>>;
  organisers?: Dict<ParticipantSummary | null>;
  interestedActivities?: Loadable<Activity[]>;
}

function PlansRoute({ ctx }: { ctx: Ctx }) {
  const { vm } = ctx;
  const me = ctx.currentUser;
  const catalog = vm.activities;
  const activities = catalog.state === "ready" ? catalog.value.items : [];

  const model = useMemo<PlansModel>(() => {
    const waiting =
      notReady<PlanCard[]>(vm.plansById) ?? notReady<PlanCard[]>(ctx.attendance) ?? notReady<PlanCard[]>(ctx.interests);
    if (waiting !== null) return { plans: waiting };
    if (vm.plansById.state !== "ready" || ctx.attendance.state !== "ready" || ctx.interests.state !== "ready") {
      return { plans: { state: "loading" } };
    }
    const attendanceMap = ctx.attendance.value;
    const interestMap = ctx.interests.value;
    const goingPeople: Dict<Loadable<ParticipantSummary[]>> = Object.create(null);
    const organisers: Dict<ParticipantSummary | null> = Object.create(null);
    const cards: PlanCard[] = [];
    for (const plan of Object.values(vm.plansById.value)) {
      const records = own(attendanceMap, plan.id) ?? [];
      const goingIds = selectGoingUserIds(records, plan.id, ctx.realUserIds, parseInstant);
      const mineRecord = me ? records.find((r) => r.userId === me.id) : undefined;
      const interestedHere = me
        ? selectInterestedUserIds(own(interestMap, plan.activityId) ?? [], plan.activityId, ctx.realUserIds, parseInstant).includes(me.id)
        : false;
      // "My plans": ones I organise, am interested in, or have answered.
      const mine = me !== null && (plan.organiserId === me.id || interestedHere || mineRecord !== undefined);
      if (!mine) continue;
      cards.push({
        plan,
        activity: activities.find((a) => a.id === plan.activityId) ?? null,
        myAttendance: me && goingIds.includes(me.id) ? "going" : mineRecord && mineRecord.status === "declined" ? "declined" : null,
        goingCount: goingIds.length,
      });
      goingPeople[plan.id] = ready(summariseAll(ctx, goingIds));
      organisers[plan.id] = isRealUserId(plan.organiserId) ? summarise(ctx, plan.organiserId) : null;
    }
    const planned = new Set(cards.map((c) => c.plan.activityId));
    const interestedActivities: Activity[] = me
      ? activities.filter(
          (a) =>
            !planned.has(a.id) &&
            selectInterestedUserIds(own(interestMap, a.id) ?? [], a.id, ctx.realUserIds, parseInstant).includes(me.id),
        )
      : [];
    return {
      plans: ready(cards, vm.plansById.issues),
      goingPeople,
      organisers,
      interestedActivities: ready(interestedActivities),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.plansById, ctx.attendance, ctx.interests, ctx.realUserIds, activities, me, vm.realProfiles]);

  const actions = vm.actions;
  return (
    <MyPlans
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      plans={model.plans}
      goingPeopleByPlanId={model.goingPeople}
      organisersByPlanId={model.organisers}
      interestedActivities={model.interestedActivities}
      onSetAttendance={
        ctx.mode === "live" && actions
          ? (planId, status) => actions.setAttendance(planId, status)
          : undefined
      }
      onOpenPlan={(planId) => ctx.navigate({ name: "plan", planId })}
      onDiscover={() => ctx.navigate({ name: "discover" })}
    />
  );
}

function PlanRoute({ ctx, planId }: { ctx: Ctx; planId: string }) {
  const { bundle } = ctx;
  const plan = planById(ctx, planId);
  const activityId = plan.state === "ready" && plan.value ? plan.value.activityId : null;
  const activityLoadable = activityId ? activityOf(ctx, activityId) : null;
  const activity = activityLoadable && activityLoadable.state === "ready" ? activityLoadable.value : null;
  const records = attendanceRecords(ctx, planId);
  const goingIds = goingIdsOf(ctx, planId);
  const goingPeople: Loadable<ParticipantSummary[]> =
    records.state !== "ready" ? records : ready(summariseAll(ctx, goingIds ?? []), records.issues);
  const myAttendance: Loadable<"going" | "declined" | null> = (() => {
    if (records.state !== "ready") return records;
    const me = ctx.currentUser;
    const mine = me ? records.value.find((r) => r.userId === me.id) : undefined;
    const going = me && goingIds ? goingIds.includes(me.id) : false;
    return ready(going ? "going" : mine && mine.status === "declined" ? "declined" : null, records.issues);
  })();
  const canWrite = ctx.mode === "live" && ctx.currentUser !== null && ctx.vm.actions !== null;

  return (
    <PlanSummary
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      plan={plan}
      activity={activity}
      organiser={plan.state === "ready" && plan.value && isRealUserId(plan.value.organiserId) ? summarise(ctx, plan.value.organiserId) : null}
      goingPeople={goingPeople}
      myAttendance={myAttendance}
      attendanceState={bundle.attendance.state}
      onSetAttendance={canWrite ? async (status) => toActionResult(await bundle.attendance.run(status)) : undefined}
      onBackToPlans={() => ctx.navigate({ name: "plans" })}
    />
  );
}

function SetupRoute({ ctx }: { ctx: Ctx }) {
  const organiserId = organiserIdOf(ctx);
  const canWrite = ctx.mode === "live" && ctx.currentUser !== null && ctx.vm.actions !== null;
  return (
    <div className="myt-stack">
    <Setup
      mode={ctx.mode}
      currentUser={ctx.currentUser}
      onNavigate={ctx.navigate}
      session={ctx.vm.session}
      organiserName={organiserId ? summarise(ctx, organiserId).displayName || null : null}
      claimState={ctx.bundle.claim.state}
      onClaim={canWrite ? async (replace) => toActionResult(await ctx.bundle.claim.run(replace)) : undefined}
    />
    {ctx.mode === "live" ? <SourceStatus files={ctx.files ?? filePort} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- shell

function routeKey(route: Route): string {
  switch (route.name) {
    case "activity":
    case "confirm":
      return `${route.name}:${route.activityId}`;
    case "plan":
      return `plan:${route.planId}`;
    default:
      return route.name;
  }
}

function navGroup(route: Route): "welcome" | "discover" | "plans" | "setup" | "meet" | "chats" {
  switch (route.name) {
    case "welcome":
      return "welcome";
    case "meet":
    case "requests":
      return "meet";
    case "chats":
    case "chat":
      return "chats";
    case "setup":
      return "setup";
    case "plans":
    case "plan":
      return "plans";
    default:
      return "discover";
  }
}

function AppView({
  ctx,
  route,
  banner,
  allowDiagnostics,
  initialFilters,
}: {
  ctx: Ctx;
  route: Route;
  banner?: ReactNode;
  allowDiagnostics: boolean;
  initialFilters?: ActivityFilters;
}) {
  const [filters, setFilters] = useState<ActivityFilters>(() => initialFilters ?? { interestIds: [], availability: [] });
  const [diagnostics, setDiagnostics] = useState(false);
  const group = navGroup(route);
  const go = (next: Route) => {
    setDiagnostics(false);
    ctx.navigate(next);
  };
  const issueCount = ctx.vm.issues.length;

  let content: ReactNode;
  if (diagnostics) {
    content = <M0Probe />;
  } else {
    switch (route.name) {
      case "welcome":
        content = (
          <Onboarding
            mode={ctx.mode}
            currentUser={ctx.currentUser}
            onNavigate={ctx.navigate}
            profile={ctx.vm.myProfile}
            saveState={ctx.previewSaveState ?? ctx.bundle.profile.state}
            onSave={
              ctx.vm.actions && ctx.mode === "live"
                ? async (input) => toActionResult(await ctx.bundle.profile.run(input))
                : undefined
            }
            onEnterPreview={ctx.onEnterPreview}
            onExitPreview={ctx.onExitPreview}
          />
        );
        break;
      case "discover":
        content = <div className="myt-stack">{ctx.mode === "live" ? <CommunityActivities user={ctx.currentUser} files={ctx.files} simulated={ctx.demo} onChange={ctx.demoSession?.communityChanged} onOpenChat={ctx.demo ? id=>go({name:"chat",chatId:"group:community:"+id}) : undefined} /> : null}<DiscoverRoute ctx={ctx} filters={filters} onFiltersChange={setFilters} /></div>;
        break;
      case "activity":
        content = <ActivityRoute ctx={ctx} activityId={route.activityId}/>;
        break;
      case "confirm":
        content = <ConfirmRoute ctx={ctx} activityId={route.activityId} />;
        break;
      case "plans":
        content = <PlansRoute ctx={ctx} />;
        break;
      case "plan":
        content = <PlanRoute ctx={ctx} planId={route.planId} />;
        break;
      case "meet":
      case "requests":
      case "chats":
      case "chat":
        content = <SocialScreens demoSession={ctx.demoSession} mode={ctx.mode} user={ctx.currentUser} profile={ctx.vm.myProfile.state === "ready" ? ctx.vm.myProfile.value : null} profiles={Object.values(profilesOf(ctx.vm))} samples={ctx.vm.samples.state === "ready" ? ctx.vm.samples.value.items : []} activities={ctx.vm.activities.state === "ready" ? ctx.vm.activities.value.items : []} interests={ctx.interests.state === "ready" ? ctx.interests.value : {}} plans={ctx.vm.plansById.state === "ready" ? Object.values(ctx.vm.plansById.value) : []} social={ctx.vm.social ?? ready(emptySocial())} actions={ctx.mode === "live" ? ctx.vm.socialActions ?? null : null} route={route} navigate={go} presence={ctx.presence} onTyping={ctx.onTyping ?? NO_TYPING} />;
        break;
      case "setup":
        content = <SetupRoute ctx={ctx} />;
        break;
    }
  }

  return (
    <>
      {route.name !== "welcome" && route.name !== "chat" ? <header className="myt-header">
        <Wordmark />
        <div className="myt-actions">

          <Button variant="quiet" aria-label="Edit profile and preferences" onClick={() => go({name:"welcome"})}><Avatar name={ctx.currentUser?.name ?? "Guest"}/></Button>
        </div>
      </header> : null}

      <main className="myt-main">
        {banner}
        {ctx.mode === "live" && ctx.currentUser === null ? (
          <div className="myt-banner" data-tone="warn">
            <div className="myt-banner__text">
              <strong className="myt-banner__title">You are not signed in.</strong> You can look around, but joining and saving need a Lightfern account.
            </div>
            {ctx.onEnterPreview ? (
              <Button size="sm" onClick={ctx.onEnterPreview}>
                Try the preview
              </Button>
            ) : null}
          </div>
        ) : null}
        {ctx.mode === "live" && issueCount > 0 ? (
          <div className="myt-banner" data-tone="warn" role="status">
            <div className="myt-banner__text">
              {issueCount === 1 ? "1 saved record could not be read and is not shown." : `${issueCount} saved records could not be read and are not shown.`}
            </div>
          </div>
        ) : null}
        {route.name === "welcome" && !ctx.demo ? <details className="myt-tools"><summary>App tools</summary><div className="myt-row"><Button size="sm" onClick={()=>go({name:"setup"})}>Setup</Button>{allowDiagnostics ? <Button size="sm" onClick={()=>setDiagnostics(v=>!v)}>Diagnostics</Button> : null}{ctx.onEnterPreview ? <Button size="sm" onClick={ctx.onEnterPreview}>Preview</Button> : null}{ctx.mode === "live" ? <DemoModeButton /> : null}</div></details> : null}
        <ErrorBoundary resetKey={`${routeKey(route)}:${diagnostics}`}>{content}</ErrorBoundary>
      </main>
      {route.name !== "welcome" && route.name !== "chat" ? <TabBar active={group} unread={ctx.vm.social?.state === "ready" && ctx.currentUser ? ctx.vm.social.value.messages.filter(m => m.authorId !== ctx.currentUser?.id && Date.parse(m.createdAt) > Date.parse(ctx.vm.social?.state === "ready" ? ctx.vm.social.value.reads.find(r=>r.chatId===m.chatId && r.userId===ctx.currentUser?.id)?.lastReadAt ?? "1970-01-01T00:00:00Z" : "1970-01-01T00:00:00Z")).length : 0} onChange={name => go({name})}/> : null}
      {!ctx.demo ? <DemoDock mode={ctx.mode} route={route} currentUser={ctx.currentUser} vm={ctx.vm} interests={ctx.interests} attendance={ctx.attendance} navigate={go} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- live and preview trees

function buildRealUserIds(
  vm: MytViewModel,
  interests: Loadable<Dict<InterestRecord[]>>,
  attendance: Loadable<Dict<Attendance[]>>,
  currentUser: CurrentUser | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  const add = (id: string) => {
    if (isRealUserId(id)) ids.add(id);
  };
  if (currentUser) add(currentUser.id);
  if (vm.realProfiles.state === "ready") Object.keys(vm.realProfiles.value).forEach(add);
  if (interests.state === "ready") Object.values(interests.value).forEach((list) => list.forEach((r) => add(r.userId)));
  if (attendance.state === "ready") Object.values(attendance.value).forEach((list) => list.forEach((r) => add(r.userId)));
  return ids;
}

function LiveApp({ onEnterPreview, demo }: { onEnterPreview?: () => void; demo?: DemoSession }) {
  const signedInUser = toCurrentUser(useCurrentUser());
  const currentUser = demo?.user ?? signedInUser;
  const files = demo?.files ?? filePort;
  const userId = currentUser?.id ?? null;
  const [route, setRoute] = useState<Route>({ name: "welcome" });
  const nowMs = useNow(30_000);
  const repository = useMemo(() => demo?.repository ?? createAppRepository(files, currentUser), [userId, files, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const activityId = route.name === "activity" || route.name === "confirm" ? route.activityId : null;
  const planId = route.name === "plan" ? route.planId : null;
  const socialRepository = useMemo(() => demo?.social ?? createSocialRepository(files, currentUser, repository), [repository, userId, demo, files]);
  const vm = useMytData({ socialRepository, repository, files, mode: "live", currentUser, activityId, planId });

  const activityIds = vm.activities.state === "ready" ? vm.activities.value.items.map((a) => a.id) : null;
  const planIds = vm.plansById.state === "ready" ? Object.keys(vm.plansById.value) : null;
  const { interests, attendance } = useParticipation({ repository, files, enabled: true, activityIds, planIds });

  const [typingIn, setTypingIn] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTyping = useCallback((id: string | null) => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setTypingIn(id);
    if (id) typingTimer.current = setTimeout(() => setTypingIn(null), 4000);
  }, []);
  useEffect(() => { onTyping(null); return () => { if (typingTimer.current) clearTimeout(typingTimer.current); }; }, [route.name, onTyping]);
  const presence = useActivityPresence(route, demo ? null : currentUser, typingIn);
  const bundle = useActionBundle(vm.actions, userId, activityId, planId);
  const realUserIds = useMemo(() => buildRealUserIds(vm, interests, attendance, currentUser), [vm, interests, attendance, currentUser]);

  // A returning student lands on the feed once, instead of the preferences form.
  const autoRouted = useRef(false);
  useEffect(() => {
    if (demo || autoRouted.current || vm.myProfile.state === "loading") return;
    autoRouted.current = true;
    if (vm.myProfile.state === "ready" && vm.myProfile.value !== null) {
      setRoute((current) => (current.name === "welcome" ? { name: "discover" } : current));
    }
  }, [vm.myProfile, demo]);

  const ctx: Ctx = {
    files,
    demo: !!demo,
    demoSession: demo,
    mode: "live",
    currentUser,
    vm,
    navigate: setRoute,
    nowMs,
    interests,
    attendance,
    realUserIds,
    presence,
    onTyping,
    bundle,
    onEnterPreview,
  };
  return <AppView ctx={ctx} route={route} allowDiagnostics={!demo} />;
}

function PreviewApp({
  scenario,
  onScenario,
  onExit,
}: {
  scenario: PreviewScenarioId;
  onScenario: (id: PreviewScenarioId) => void;
  onExit: () => void;
}) {
  const model = useMemo(() => buildPreviewModel(scenario, DEFAULT_PREVIEW_NOW_MS), [scenario]);
  const [route, setRoute] = useState<Route>(model.route);
  useEffect(() => setRoute(model.route), [model]);
  const bundle = useActionBundle(null, null, null, null);
  const interests = useMemo(() => ready<Dict<InterestRecord[]>>(Object.create(null)), []);
  const attendance = useMemo(() => ready<Dict<Attendance[]>>(Object.create(null)), []);
  const realUserIds = useMemo(() => new Set<string>(), []);

  const ctx: Ctx = {
    mode: "preview",
    currentUser: model.viewModel.currentUser,
    vm: model.viewModel,
    navigate: setRoute,
    nowMs: model.nowMs,
    interests,
    attendance,
    realUserIds,
    presence: model.activityPresence,
    bundle,
    onExitPreview: onExit,
    previewSaveState: model.saveState,
  };

  const banner = (
    <div className="myt-banner" data-tone="warn" role="status">
      <div className="myt-banner__text">
        <strong className="myt-banner__title">Preview.</strong> {model.banner}
      </div>
      <div className="myt-actions">
        {listPreviewScenarios().map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant="quiet"
            aria-current={item.id === scenario ? "true" : undefined}
            title={item.description}
            onClick={() => onScenario(item.id)}
          >
            {item.label}
          </Button>
        ))}
        <Button size="sm" onClick={onExit}>
          Leave preview
        </Button>
      </div>
    </div>
  );
  return <AppView key={scenario} ctx={ctx} route={route} banner={banner} allowDiagnostics={false} initialFilters={model.discover.filters} />;
}

export function App() {
  const [demo, setDemo] = useState<DemoSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [demoError, setDemoError] = useState("");
  async function startDemo() {
    if (starting) return;
    setStarting(true); setDemoError("");
    try { setDemo(await createDemoSession(filePort)); }
    catch (error) { setDemoError(error instanceof Error ? error.message : "Could not start the demo. Try again."); }
    finally { setStarting(false); }
  }
  const [mode, setMode] = useState<AppMode>("live");
  const [scenario, setScenario] = useState<PreviewScenarioId>("discover");
  return (
    <div className="myt-app">
      {demo ? <>
        <div className="myt-demo-launch"><span className="myt-small">Demo · real event feed · simulated people · resets on exit</span><Button onClick={() => { demo.dispose(); setDemo(null); }}>Exit demo</Button></div>
        <LiveApp key="demo" demo={demo} />
      </> : <>
      <div className="myt-demo-launch"><Button variant="primary" pending={starting} disabled={starting} onClick={() => void startDemo()}>▶ Start demo</Button><span className="myt-small myt-muted">Onboarding, people, groups and plans</span></div>
      {demoError ? <p role="alert">{demoError}</p> : null}
      {mode === "live" ? (
        <LiveApp key="live" onEnterPreview={() => setMode("preview")} />
      ) : (
        <PreviewApp scenario={scenario} onScenario={setScenario} onExit={() => setMode("live")} />
      )}
      </>}
    </div>
  );
}

import type { MytViewModel } from "../data-contract";
import type {
  ActionState,
  Activity,
  ActivityFilters,
  ActivityPresence,
  Loadable,
  Plan,
  RankedActivity,
  Route,
} from "../types";
import {
  DEFAULT_PREVIEW_NOW_MS,
  PREVIEW_ACTIVITIES,
  PREVIEW_COMPANIONS,
  PREVIEW_SCENARIOS,
  PREVIEW_USER,
  type PreviewScenarioId,
} from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PREVIEW_BANNER = "Preview only: fictional examples. Nothing here is saved or live.";

function ready<T>(value: T): Loadable<T> {
  return { state: "ready", value, issues: [] };
}

function buildActivities(nowMs: number): Activity[] {
  return PREVIEW_ACTIVITIES.map((template) => ({
    schemaVersion: 1,
    id: template.id,
    title: template.title,
    description: template.description,
    interestId: template.interestId,
    area: template.area,
    status: "available",
    timeOptions: [{
      id: "proposed-time",
      startAt: new Date(nowMs + template.startsAfterDays * DAY_MS + (template.startsAfterHours ?? 0) * HOUR_MS).toISOString(),
      endAt: null,
      availabilityKeys: [...template.availabilityKeys],
    }],
    cost: { amountPence: null, currency: "GBP", isEstimate: false },
    source: { kind: "demo", url: null, checkedAt: null },
    suggestedMeetingPoint: template.suggestedMeetingPoint,
  }));
}

function buildPlan(activity: Activity, nowMs: number): Plan {
  return {
    schemaVersion: 1,
    id: `plan:${activity.id}`,
    activityId: activity.id,
    organiserId: PREVIEW_USER.userId,
    chosenOptionId: activity.timeOptions[0].id,
    startAt: activity.timeOptions[0].startAt,
    endAt: null,
    meetingPoint: activity.suggestedMeetingPoint ?? "Public meeting point to be agreed",
    createdAt: new Date(nowMs).toISOString(),
  };
}

function ranked(activities: Activity[]): RankedActivity[] {
  return activities.map((activity) => ({
    activity,
    reasonCodes: PREVIEW_USER.interestIds.includes(activity.interestId) ? ["interest"] : [],
    reasons: PREVIEW_USER.interestIds.includes(activity.interestId)
      ? [`Matches your interest in ${activity.interestId}.`]
      : ["Explore another activity idea."],
    nextOptionId: activity.timeOptions[0].id,
    nextStartAt: activity.timeOptions[0].startAt,
  }));
}

export interface PreviewModel {
  scenario: PreviewScenarioId;
  scenarioLabel: string;
  banner: string;
  route: Route;
  nowMs: number;
  viewModel: MytViewModel;
  discover: {
    rankedActivities: Loadable<RankedActivity[]>;
    filters: ActivityFilters;
    interestedCounts: Record<string, number>;
  };
  activityPresence: ActivityPresence;
  saveState: ActionState;
}

export function listPreviewScenarios(): ReadonlyArray<(typeof PREVIEW_SCENARIOS)[number]> {
  return PREVIEW_SCENARIOS;
}

export function buildPreviewModel(
  scenario: PreviewScenarioId,
  nowMs: number = DEFAULT_PREVIEW_NOW_MS,
  onPreviewRetry?: () => void,
): PreviewModel {
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8.64e15 - 30 * DAY_MS) {
    throw new RangeError("Preview clock must be a valid date with room for future options.");
  }

  const scenarioInfo = PREVIEW_SCENARIOS.find((item) => item.id === scenario);
  if (!scenarioInfo) throw new Error(`Unknown preview scenario: ${scenario}`);

  const activities = buildActivities(nowMs);
  const selectedActivity = activities[0];
  const plan = buildPlan(selectedActivity, nowMs);
  const isFirstTime = scenario === "first-time";
  const isLoading = scenario === "loading";
  const hasPlan = scenario === "confirmed-plan";
  const failure = {
    code: "io" as const,
    message: "Example save failed. Your changes were not saved. Retry from the live app.",
  };

  const viewModel: MytViewModel = {
    mode: "preview",
    currentUser: { id: PREVIEW_USER.userId, name: PREVIEW_USER.displayName },
    activities: isLoading ? { state: "loading" } : ready({ schemaVersion: 1, items: activities }),
    samples: ready({ schemaVersion: 1, items: PREVIEW_COMPANIONS.map((profile) => ({ ...profile })) }),
    session: ready({ schemaVersion: 1, organiserUserId: PREVIEW_USER.userId }),
    myProfile: isLoading ? { state: "loading" } : ready(isFirstTime ? null : { ...PREVIEW_USER }),
    realProfiles: ready({}),
    interestsByActivity: ready({}),
    votesByActivity: ready({}),
    plansById: ready(hasPlan ? { [plan.id]: plan } : {}),
    attendanceByPlan: ready({}),
    issues: [],
    actions: null,
  };

  const route: Route = scenario === "first-time" || scenario === "failed-save" || isLoading
    ? { name: "welcome" }
    : scenario === "activity"
      ? { name: "activity", activityId: selectedActivity.id }
      : hasPlan
        ? { name: "plan", planId: plan.id }
        : { name: "discover" };

  const discoverRanked = isLoading
    ? { state: "loading" } as const
    : ready(scenario === "no-matches" ? [] : ranked(activities));
  const filters: ActivityFilters = scenario === "no-matches"
    ? { interestIds: ["cinema"], availability: ["weekend-evening"] }
    : { interestIds: [], availability: [] };

  return {
    scenario,
    scenarioLabel: scenarioInfo.label,
    banner: PREVIEW_BANNER,
    route,
    nowMs,
    viewModel,
    discover: { rankedActivities: discoverRanked, filters, interestedCounts: {} },
    activityPresence: { connected: false, viewers: [] },
    saveState: scenario === "failed-save"
      ? { status: "error", error: failure, retry: onPreviewRetry ?? (() => undefined) }
      : { status: "idle" },
  };
}

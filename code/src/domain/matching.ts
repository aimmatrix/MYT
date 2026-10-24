import type { Activity, ActivityFilters, AvailabilityKey, InterestId, Profile, RankedActivity, TimeOption } from "../types";
import { compareAvailability } from "./availability";
import { compareBudget } from "./cost";
import { getFutureTimeOptions, parseInstant } from "./londonTime";

export interface RankingInput {
  profile: Profile | null;
  activities: readonly Activity[];
  nowMs: number;
  filters?: ActivityFilters;
}

export interface RankingIssue {
  activityId: string;
  optionId: string | null;
  code: "invalid-schedule" | "invalid-clock";
  message: string;
}

export interface RankingResult {
  items: RankedActivity[];
  issues: RankingIssue[];
}

interface Candidate {
  item: RankedActivity;
  interestMatch: boolean;
  availabilityMatch: boolean;
  budgetMatch: boolean;
  nextStartMs: number;
}

const INTEREST_LABELS: Record<InterestId, string> = {
  football: "football",
  karting: "go-karting",
  cinema: "cinema",
  music: "music",
  social: "social",
  fitness: "fitness",
  comedy: "comedy",
  theatre: "theatre",
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueValues<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)];
}

function scheduleIssues(activity: Activity): RankingIssue[] {
  const issues: RankingIssue[] = [];

  for (const option of activity.timeOptions) {
    const startMs = parseInstant(option.startAt);
    const endMs = option.endAt === null ? null : parseInstant(option.endAt);
    if (startMs === null || (option.endAt !== null && (endMs === null || endMs <= startMs))) {
      issues.push({
        activityId: activity.id,
        optionId: option.id,
        code: "invalid-schedule",
        message: `Activity "${activity.title}" has an invalid time option "${option.id}".`,
      });
    }
  }

  return issues;
}

function availabilityForOptions(
  userKeys: readonly AvailabilityKey[],
  options: readonly Pick<TimeOption, "availabilityKeys">[] | readonly { availabilityKeys: readonly string[] }[],
): "overlap" | "no-overlap" | "unknown" {
  let hasUnknown = false;

  for (const option of options) {
    const comparison = compareAvailability(userKeys, option.availabilityKeys);
    if (comparison === "overlap") return "overlap";
    if (comparison === "unknown") hasUnknown = true;
  }

  return hasUnknown ? "unknown" : "no-overlap";
}

export function rankActivities({ profile, activities, nowMs, filters }: RankingInput): RankingResult {
  if (!Number.isFinite(nowMs)) {
    return {
      items: [],
      issues: [{ activityId: "", optionId: null, code: "invalid-clock", message: "The current time is invalid, so activities cannot be ranked." }],
    };
  }

  const interestFilter = uniqueValues(filters?.interestIds ?? []);
  const availabilityFilter = uniqueValues(filters?.availability ?? []);
  const profileInterests = new Set(profile?.interestIds ?? []);
  const availabilityKeys = availabilityFilter.length > 0 ? availabilityFilter : (profile?.availability ?? []);
  const candidates: Candidate[] = [];
  const issues: RankingIssue[] = [];

  for (const activity of activities) {
    if (activity.status !== "available") continue;
    if (interestFilter.length > 0 && !interestFilter.includes(activity.interestId)) continue;

    issues.push(...scheduleIssues(activity));
    const futureOptions = getFutureTimeOptions(activity.timeOptions, nowMs);
    // Undated venue/film suggestions remain browsable. They cannot be confirmed
    // as a plan until an actual schedule is supplied. Expired dated events stay hidden.
    if (futureOptions.length === 0) {
      if (activity.timeOptions.length !== 0 || availabilityFilter.length > 0) continue;
      const interestMatch = profileInterests.has(activity.interestId);
      candidates.push({
        item: {
          activity,
          reasonCodes: interestMatch ? ["shared-interest", "schedule-needed"] : ["schedule-needed"],
          reasons: [
            ...(interestMatch ? [`Matches your interest in ${INTEREST_LABELS[activity.interestId]}.`] : []),
            "Check the source for a date or bookable session before making a plan.",
          ],
          nextOptionId: null,
          nextStartAt: null,
        },
        interestMatch, availabilityMatch: false, budgetMatch: false, nextStartMs: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }

    const nextOption = futureOptions[0];
    const nextStartMs = parseInstant(nextOption.startAt);
    if (nextStartMs === null) continue;

    const filteredAvailability = availabilityFilter.length > 0
      ? availabilityForOptions(availabilityFilter, futureOptions)
      : null;
    if (availabilityFilter.length > 0 && filteredAvailability !== "overlap") continue;

    const interestMatch = profileInterests.has(activity.interestId);
    const availabilityMatch = availabilityForOptions(availabilityKeys, futureOptions) === "overlap";
    const budgetMatch = profile !== null && compareBudget(activity.cost, profile.budgetPence) === "within";
    const reasonCodes: string[] = [];
    const reasons: string[] = [];

    if (interestMatch) {
      reasonCodes.push("shared-interest");
      reasons.push(`Matches your interest in ${INTEREST_LABELS[activity.interestId]}.`);
    }
    if (availabilityMatch) {
      reasonCodes.push("availability-overlap");
      reasons.push("A proposed time fits your selected availability.");
    }
    if (budgetMatch) {
      reasonCodes.push(activity.cost.isEstimate ? "estimated-budget-fit" : "budget-fit");
      reasons.push(activity.cost.isEstimate
        ? "Estimated cost is within your selected budget."
        : "Listed cost is within your selected budget.");
    }

    candidates.push({
      item: {
        activity,
        reasonCodes,
        reasons,
        nextOptionId: nextOption.id,
        nextStartAt: nextOption.startAt,
      },
      interestMatch,
      availabilityMatch,
      budgetMatch,
      nextStartMs,
    });
  }

  candidates.sort((left, right) =>
    Number(right.interestMatch) - Number(left.interestMatch)
    || Number(right.availabilityMatch) - Number(left.availabilityMatch)
    || Number(right.budgetMatch) - Number(left.budgetMatch)
    || left.nextStartMs - right.nextStartMs
    || compareText(left.item.activity.id, right.item.activity.id)
    || compareText(left.item.activity.title, right.item.activity.title),
  );

  return { items: candidates.map((candidate) => candidate.item), issues };
}

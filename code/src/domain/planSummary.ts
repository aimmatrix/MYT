import type { Activity, ParticipantSummary, Plan } from "../types";
import { isValidId } from "./identifiers";
import { formatLondonTimeRange } from "./londonTime";
import { formatCost } from "./cost";
import { getSourcePresentation } from "./sourcePresentation";

export interface SavedPlanSummary {
  title: string;
  when: string;
  meetingPoint: string;
  area: string | null;
  cost: string | null;
  organiserName: string | null;
  source: { label: string; href: string | null; detail: string } | null;
  goingPeople: ParticipantSummary[];
  goingCount: number;
  copyText: string;
}

function isRealParticipant(person: ParticipantSummary): boolean {
  return isValidId(person.userId) && !person.userId.startsWith("sample:") && !person.userId.startsWith("preview:");
}

export function buildPlanSummary(input: {
  plan: Plan;
  activity: Activity | null;
  organiser: ParticipantSummary | null;
  goingPeople: readonly ParticipantSummary[];
}): SavedPlanSummary {
  const { plan, activity } = input;
  const title = activity?.title.trim() || "Saved plan";
  const when = formatLondonTimeRange(plan.startAt, plan.endAt);
  const meetingPoint = plan.meetingPoint.trim() || "Meeting point unavailable";
  const area = activity?.area.trim() || null;
  const cost = activity ? formatCost(activity.cost) : null;
  const source = activity ? getSourcePresentation(activity.source) : null;
  const organiserName = input.organiser && isRealParticipant(input.organiser)
    ? input.organiser.displayName.trim() || null
    : null;
  const seen = new Set<string>();
  const goingPeople = input.goingPeople.filter((person) => {
    if (!isRealParticipant(person) || seen.has(person.userId)) return false;
    seen.add(person.userId);
    return true;
  });
  const goingCount = goingPeople.length;
  const copyText = [
    title,
    `When: ${when} (London time)`,
    `Meet: ${meetingPoint}`,
    area ? `Area: ${area}` : null,
    cost ? `Cost: ${cost}` : null,
    `Going: ${goingCount} ${goingCount === 1 ? "person" : "people"}`,
    source?.href ? `Original listing: ${source.href}` : null,
    "This is a shared plan, not a ticket booking or reservation.",
  ].filter((line): line is string => line !== null).join("\n");

  return {
    title,
    when,
    meetingPoint,
    area,
    cost,
    organiserName,
    source,
    goingPeople,
    goingCount,
    copyText,
  };
}

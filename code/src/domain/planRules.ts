// Pure decision rules for the step from shared interest to a confirmed plan and explicit attendance.
// No I/O, no clock reads, no ID or timestamp creation: callers pass `nowMs` and re-check current data before saving.
// These rules drive UI and domain behaviour only. They are not an access-control boundary.

/** Prototype small-group threshold: organiser plus one other real person. It never implies attendance. */
export const MIN_REAL_PARTICIPANTS = 2;

/** Practical cap for a public meeting-point description, counted in characters after trimming. */
export const MEETING_POINT_MAX_LENGTH = 240;

/** Returns epoch milliseconds, or null (NaN/non-finite is also treated as invalid) when the text is not a usable instant. */
export type ParseInstant = (value: string) => number | null;

export interface PlanOptionInput {
  id: string;
  startAt: string;
  endAt: string | null;
}

export interface PlanCreationInput {
  currentUserId: string | null;
  organiserUserId: string | null;
  /** Real signed-in profiles only; fictional sample profiles must not be members. */
  realUserIds: ReadonlySet<string>;
  activityId: string;
  activityStatus: "available" | "unavailable";
  existingPlanId: string | null;
  chosenOptionId: string | null;
  options: ReadonlyArray<PlanOptionInput>;
  interestedUserIds: ReadonlySet<string>;
  meetingPoint: string;
  nowMs: number;
}

export type PlanCreationDenialCode =
  | "signed-out"
  | "not-real-user"
  | "organiser-not-set"
  | "not-organiser"
  | "plan-exists"
  | "activity-unavailable"
  | "organiser-not-interested"
  | "insufficient-real-interest"
  | "invalid-now"
  | "option-not-selected"
  | "option-not-found"
  | "option-ambiguous"
  | "option-start-invalid"
  | "option-end-invalid"
  | "option-end-not-after-start"
  | "option-expired"
  | "meeting-point-blank"
  | "meeting-point-too-long";

export type PlanCreationResult =
  | {
      allowed: true;
      chosenOptionId: string;
      startAt: string;
      endAt: string | null;
      meetingPoint: string;
    }
  | {
      allowed: false;
      code: PlanCreationDenialCode;
      message: string;
      existingPlanId?: string;
    };

function deny(code: PlanCreationDenialCode, message: string): PlanCreationResult {
  return { allowed: false, code, message };
}

function parseFinite(parseInstant: ParseInstant, value: string): number | null {
  const parsed = parseInstant(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function isPresent(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

/**
 * Decides whether the signed-in organiser may confirm a plan from current data.
 * Check order is fixed so the first failing rule is the reason shown. The checks are: identity,
 * organiser, existing plan, activity, real interest, option, then meeting point.
 * A majority vote on options is advisory and is not consulted here.
 */
export function evaluatePlanCreation(
  input: PlanCreationInput,
  parseInstant: ParseInstant,
): PlanCreationResult {
  const { currentUserId, organiserUserId, realUserIds } = input;

  if (!isPresent(currentUserId)) {
    return deny("signed-out", "Sign in to confirm a plan.");
  }
  if (!realUserIds.has(currentUserId)) {
    return deny("not-real-user", "Only real signed-in people can confirm a plan, not sample profiles.");
  }
  if (!isPresent(organiserUserId)) {
    return deny("organiser-not-set", "No organiser is set for this activity yet, so nobody can confirm a plan.");
  }
  if (organiserUserId !== currentUserId) {
    return deny("not-organiser", "Only the organiser can confirm the plan.");
  }

  if (isPresent(input.existingPlanId)) {
    return {
      allowed: false,
      code: "plan-exists",
      message: "A plan is already confirmed for this activity. Open it instead of creating another.",
      existingPlanId: input.existingPlanId,
    };
  }

  if (input.activityStatus !== "available") {
    return deny("activity-unavailable", "This activity is no longer available.");
  }

  // Sets are already distinct; intersecting with realUserIds drops any sample profiles mixed in.
  let realInterestedCount = 0;
  for (const userId of input.interestedUserIds) {
    if (realUserIds.has(userId)) realInterestedCount += 1;
  }
  if (!input.interestedUserIds.has(organiserUserId)) {
    return deny("organiser-not-interested", "The organiser needs to express interest in this activity first.");
  }
  if (realInterestedCount < MIN_REAL_PARTICIPANTS) {
    return deny(
      "insufficient-real-interest",
      `At least ${MIN_REAL_PARTICIPANTS} real people, including the organiser, must be interested before a plan can be confirmed.`,
    );
  }

  if (!Number.isFinite(input.nowMs)) {
    return deny("invalid-now", "The current time is unavailable, so the plan cannot be checked yet.");
  }
  if (!isPresent(input.chosenOptionId)) {
    return deny("option-not-selected", "Choose a time option for the plan.");
  }
  const matches = input.options.filter((option) => option.id === input.chosenOptionId);
  if (matches.length === 0) {
    return deny("option-not-found", "The chosen time option no longer exists. Pick another.");
  }
  const option = matches[0];
  if (matches.length > 1 || option === undefined) {
    return deny("option-ambiguous", "More than one time option shares this ID, so it cannot be chosen safely.");
  }

  const startMs = parseFinite(parseInstant, option.startAt);
  if (startMs === null) {
    return deny("option-start-invalid", "The chosen time option has an invalid start time.");
  }
  if (option.endAt !== null) {
    const endMs = parseFinite(parseInstant, option.endAt);
    if (endMs === null) {
      return deny("option-end-invalid", "The chosen time option has an invalid end time.");
    }
    if (endMs <= startMs) {
      return deny("option-end-not-after-start", "The chosen time option must end after it starts.");
    }
  }
  if (startMs <= input.nowMs) {
    return deny("option-expired", "The chosen time has already started or passed. Pick a future time.");
  }

  const meetingPoint = input.meetingPoint.trim();
  if (meetingPoint === "") {
    return deny("meeting-point-blank", "Describe a public meeting point, such as a station entrance or venue foyer.");
  }
  if (Array.from(meetingPoint).length > MEETING_POINT_MAX_LENGTH) {
    return deny(
      "meeting-point-too-long",
      `Keep the meeting point to ${MEETING_POINT_MAX_LENGTH} characters or fewer.`,
    );
  }

  return {
    allowed: true,
    chosenOptionId: option.id,
    startAt: option.startAt,
    endAt: option.endAt,
    meetingPoint,
  };
}

export interface AttendanceInput {
  currentUserId: string | null;
  realUserIds: ReadonlySet<string>;
  planExists: boolean;
  planStartMs: number | null;
  nowMs: number;
  desiredStatus: "going" | "declined";
}

export type AttendanceDenialCode =
  | "signed-out"
  | "not-real-user"
  | "plan-missing"
  | "invalid-status"
  | "plan-time-invalid"
  | "invalid-now"
  | "plan-started";

export interface AttendanceDecision {
  allowed: boolean;
  code: AttendanceDenialCode | null;
  message: string | null;
}

function denyAttendance(code: AttendanceDenialCode, message: string): AttendanceDecision {
  return { allowed: false, code, message };
}

/**
 * Decides whether the current user may record "going" or "declined" for a plan.
 * "going" needs a plan whose start is known and still in the future. "declined" is always
 * allowed once a plan exists so a person can clear a commitment after the start or when the
 * plan time is unreadable. The repository must still write only the current user's own record.
 */
export function evaluateAttendance(input: AttendanceInput): AttendanceDecision {
  if (input.currentUserId === null || input.currentUserId.trim() === "") {
    return denyAttendance("signed-out", "Sign in to mark your attendance.");
  }
  if (!input.realUserIds.has(input.currentUserId)) {
    return denyAttendance("not-real-user", "Only real signed-in people can mark attendance, not sample profiles.");
  }
  if (!input.planExists) {
    return denyAttendance("plan-missing", "There is no confirmed plan to attend.");
  }

  if (input.desiredStatus === "declined") {
    return { allowed: true, code: null, message: null };
  }
  if (input.desiredStatus !== "going") {
    return denyAttendance("invalid-status", "Attendance must be either going or declined.");
  }

  if (input.planStartMs === null || !Number.isFinite(input.planStartMs)) {
    return denyAttendance("plan-time-invalid", "This plan has no valid start time, so you cannot commit to it.");
  }
  if (!Number.isFinite(input.nowMs)) {
    return denyAttendance("invalid-now", "The current time is unavailable, so attendance cannot be checked yet.");
  }
  if (input.planStartMs <= input.nowMs) {
    return denyAttendance("plan-started", "This plan has already started or passed. You can still decline to clear your commitment.");
  }
  return { allowed: true, code: null, message: null };
}

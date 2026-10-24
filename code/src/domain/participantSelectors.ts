/**
 * Pure selectors that keep three groups of people distinct:
 *
 *   - viewers (presence): never an input here, so never counted;
 *   - interested users: derived only from InterestRecord rows;
 *   - confirmed attendees: derived only from AttendanceRecord rows.
 *
 * Interest never implies attendance and presence never implies either.
 *
 * Rules shared by all four selectors
 *   1. Scope first: records for other activities/plans (or other users, for
 *      the "my" selectors) are dropped before anything is resolved.
 *   2. Identity is the user ID, matched exactly against `realUserIds`. Names
 *      are never read. A fictional sample profile, or a user whose profile
 *      has not been established yet, is absent from `realUserIds` and is
 *      therefore not counted, even if it shares a display name with a real
 *      user.
 *   3. Duplicate rows for the same user and subject collapse to the row with
 *      the latest valid `updatedAt` (compared as parsed instants, so two
 *      spellings of the same instant are equal).
 *   4. Tie rule: when the latest instant is shared by rows that disagree,
 *      the conservative state wins ("withdrawn" for interest, "declined" for
 *      attendance). Result is independent of input order.
 *   5. A row whose timestamp `parseInstant` rejects (null, NaN, infinite,
 *      throws) is ignored entirely. It cannot override a valid row, and on
 *      its own it neither adds nor removes anyone. Consequence: a valid
 *      "going" followed by an undated "declined" still reads as going.
 *   6. Malformed rows (not an object, empty or non-string IDs, a status
 *      outside the allowed pair, non-string timestamp) are ignored. Inputs
 *      are never mutated and results are fresh arrays.
 *   7. Output is unique IDs in ascending UTF-16 code-unit order (not
 *      locale-dependent).
 *
 * Limits: these selectors make the display consistent. They are not a
 * security boundary. Anyone who can edit the shared files can add, remove or
 * backdate records or alter the real-user set that the caller builds.
 */

/** Structural input: matches the app's InterestRecord without importing it. */
export interface InterestRecordInput {
  readonly activityId: string;
  readonly userId: string;
  readonly status: "interested" | "withdrawn";
  readonly updatedAt: string;
}

/** Structural input: matches the app's AttendanceRecord without importing it. */
export interface AttendanceRecordInput {
  readonly planId: string;
  readonly userId: string;
  readonly status: "going" | "declined";
  readonly updatedAt: string;
}

/** Returns epoch milliseconds, or null when the text is not a valid instant. */
export type ParseInstant = (value: string) => number | null;

/** IDs of current real participants; fictional sample profiles are excluded. */
export type RealUserIds = ReadonlySet<string>;

interface RecordKind {
  readonly subjectField: "activityId" | "planId";
  readonly activeStatus: string;
  readonly inactiveStatus: string;
}

const INTEREST_KIND: RecordKind = {
  subjectField: "activityId",
  activeStatus: "interested",
  inactiveStatus: "withdrawn",
};

const ATTENDANCE_KIND: RecordKind = {
  subjectField: "planId",
  activeStatus: "going",
  inactiveStatus: "declined",
};

interface ValidEntry {
  readonly subjectId: string;
  readonly userId: string;
  readonly instant: number;
  readonly active: boolean;
}

/**
 * User IDs with an active (not withdrawn) interest in `activityId`.
 * Says nothing about attendance.
 */
export function selectInterestedUserIds(
  records: ReadonlyArray<InterestRecordInput>,
  activityId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  return activeUsersForSubject(INTEREST_KIND, records, activityId, realUserIds, parseInstant);
}

/**
 * User IDs explicitly marked "going" for `planId`. Interest in the matching
 * activity, and being online, are deliberately ignored.
 */
export function selectGoingUserIds(
  records: ReadonlyArray<AttendanceRecordInput>,
  planId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  return activeUsersForSubject(ATTENDANCE_KIND, records, planId, realUserIds, parseInstant);
}

/**
 * Activity IDs `userId` is currently interested in. Empty unless `userId` is
 * in `realUserIds`.
 */
export function selectMyInterestedActivityIds(
  records: ReadonlyArray<InterestRecordInput>,
  userId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  return activeSubjectsForUser(INTEREST_KIND, records, userId, realUserIds, parseInstant);
}

/**
 * Plan IDs `userId` is currently marked "going" for. Empty unless `userId` is
 * in `realUserIds`.
 */
export function selectMyGoingPlanIds(
  records: ReadonlyArray<AttendanceRecordInput>,
  userId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  return activeSubjectsForUser(ATTENDANCE_KIND, records, userId, realUserIds, parseInstant);
}

function activeUsersForSubject(
  kind: RecordKind,
  records: unknown,
  subjectId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  if (!isNonEmptyString(subjectId)) return [];
  const entries = readValidEntries(kind, records, realUserIds, parseInstant).filter(
    (entry) => entry.subjectId === subjectId,
  );
  return activeKeys(collapseToLatest(entries, (entry) => entry.userId));
}

function activeSubjectsForUser(
  kind: RecordKind,
  records: unknown,
  userId: string,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): string[] {
  if (!isNonEmptyString(userId) || !isRealUser(realUserIds, userId)) return [];
  const entries = readValidEntries(kind, records, realUserIds, parseInstant).filter(
    (entry) => entry.userId === userId,
  );
  return activeKeys(collapseToLatest(entries, (entry) => entry.subjectId));
}

/** Keeps only well-formed rows from real users with a parseable timestamp. */
function readValidEntries(
  kind: RecordKind,
  records: unknown,
  realUserIds: RealUserIds,
  parseInstant: ParseInstant,
): ValidEntry[] {
  if (!Array.isArray(records)) return [];
  const entries: ValidEntry[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const subjectId = readField(record, kind.subjectField);
    const userId = readField(record, "userId");
    const status = readField(record, "status");
    if (!isNonEmptyString(subjectId) || !isNonEmptyString(userId)) continue;
    if (status !== kind.activeStatus && status !== kind.inactiveStatus) continue;
    if (!isRealUser(realUserIds, userId)) continue;
    const instant = safeInstant(parseInstant, readField(record, "updatedAt"));
    if (instant === null) continue;
    entries.push({ subjectId, userId, instant, active: status === kind.activeStatus });
  }
  return entries;
}

/**
 * One entry per key: the latest instant wins; at an equal instant the entry is
 * active only if every tied row is active.
 */
function collapseToLatest(
  entries: readonly ValidEntry[],
  keyOf: (entry: ValidEntry) => string,
): Map<string, ValidEntry> {
  const latest = new Map<string, ValidEntry>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const current = latest.get(key);
    if (current === undefined || entry.instant > current.instant) {
      latest.set(key, entry);
    } else if (entry.instant === current.instant && current.active && !entry.active) {
      latest.set(key, entry);
    }
  }
  return latest;
}

function activeKeys(latest: ReadonlyMap<string, ValidEntry>): string[] {
  const keys: string[] = [];
  for (const [key, entry] of latest) {
    if (entry.active) keys.push(key);
  }
  return keys.sort(compareIds);
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRealUser(realUserIds: RealUserIds, userId: string): boolean {
  try {
    return realUserIds.has(userId) === true;
  } catch {
    return false;
  }
}

function readField(record: object, field: string): unknown {
  return Reflect.get(record, field);
}

function safeInstant(parseInstant: ParseInstant, value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    const instant = parseInstant(value);
    return typeof instant === "number" && Number.isFinite(instant) ? instant : null;
  } catch {
    return null;
  }
}

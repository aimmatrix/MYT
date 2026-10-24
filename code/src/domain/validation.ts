import type { RichPreferences } from "../types";
import { FREE_SLOTS } from "./preferences";
/**
 * Decoder for shared MYT record files (version 1).
 *
 * Turns the raw text of a shared file into a trusted, freshly constructed
 * value, or into a structured failure. Nothing here reads storage, touches the
 * network or invents defaults: a record is either exactly what the version-1
 * schema describes or it is rejected.
 *
 * Failure scope
 *  - Catalog kinds (`activityCatalog`, `sampleProfileCatalog`) are all-or-nothing.
 *    One corrupt item fails the whole catalog, and every offending item is
 *    reported by path (`items[3].cost.amountPence`). A caller must show "catalog
 *    is corrupted", never an empty library.
 *  - Every other kind is a single record in a single file. A failure rejects
 *    that one record only; the caller drops it and reports it, and the rest of
 *    the shared state stays usable.
 *
 * Date and identifier rules are injected, so this module agrees with whatever
 * date and identifier helpers the app imports instead of re-implementing them.
 * Source safety (is a link safe to render) is deliberately not decided here.
 *
 * Integration patch (S1): the optional `Activity.suggestedMeetingPoint` accepted by G1 is
 * now read and carried through. When the key is present it must be null or non-blank text;
 * when absent it stays absent. The original proposal dropped it silently.
 */

export type DecodedInterestId = 'football' | 'karting' | 'cinema' | 'music' | 'social' | 'fitness' | 'comedy' | 'theatre';
export type DecodedAvailabilityKey = 'weekday-evening' | 'weekend-day' | 'weekend-evening';

export interface DecodedProfile extends RichPreferences {
  schemaVersion: 1;
  userId: string;
  displayName: string;
  university: string;
  interestIds: DecodedInterestId[];
  availability: DecodedAvailabilityKey[];
  budgetPence: number | null;
  isDemo: boolean;
}

export interface DecodedTimeOption {
  id: string;
  startAt: string;
  endAt: string | null;
  availabilityKeys: DecodedAvailabilityKey[];
}

export interface DecodedActivity {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  interestId: DecodedInterestId;
  area: string;
  status: 'available' | 'unavailable';
  timeOptions: DecodedTimeOption[];
  cost: {
    amountPence: number | null;
    currency: 'GBP';
    isEstimate: boolean;
  };
  source: {
    kind: 'demo' | 'verified' | 'unverified';
    url: string | null;
    checkedAt: string | null;
  };
  /** Optional proposal for the plan's meeting point (S1 patch). Present only when the file had the key. */
  suggestedMeetingPoint?: string | null;
}

export interface DecodedActivityCatalog {
  schemaVersion: 1;
  items: DecodedActivity[];
}

/** Every item has `isDemo: true`; the decoder rejects the catalog otherwise. */
export interface DecodedSampleProfileCatalog {
  schemaVersion: 1;
  items: DecodedProfile[];
}

export interface DecodedSession {
  schemaVersion: 1;
  organiserUserId: string | null;
}

export interface DecodedInterest {
  schemaVersion: 1;
  activityId: string;
  userId: string;
  status: 'interested' | 'withdrawn';
  updatedAt: string;
}

export interface DecodedVote {
  schemaVersion: 1;
  activityId: string;
  userId: string;
  optionId: string | null;
  updatedAt: string;
}

export interface DecodedPlan {
  schemaVersion: 1;
  id: string;
  activityId: string;
  organiserId: string;
  chosenOptionId: string;
  startAt: string;
  endAt: string | null;
  meetingPoint: string;
  createdAt: string;
}

export interface DecodedAttendance {
  schemaVersion: 1;
  planId: string;
  userId: string;
  status: 'going' | 'declined';
  updatedAt: string;
}

export type RecordKind =
  | 'profile'
  | 'activityCatalog'
  | 'sampleProfileCatalog'
  | 'session'
  | 'interest'
  | 'vote'
  | 'plan'
  | 'attendance';

export interface DecodedRecordByKind {
  profile: DecodedProfile;
  activityCatalog: DecodedActivityCatalog;
  sampleProfileCatalog: DecodedSampleProfileCatalog;
  session: DecodedSession;
  interest: DecodedInterest;
  vote: DecodedVote;
  plan: DecodedPlan;
  attendance: DecodedAttendance;
}

export type DecodedRecord = DecodedRecordByKind[RecordKind];

export interface DecoderDependencies {
  /** Epoch milliseconds for a valid instant, otherwise null. */
  parseInstant(value: string): number | null;
  isValidId(value: string): boolean;
}

export type DecodeFailureCode = 'invalid-json' | 'unsupported-schema' | 'invalid-record';

export interface DecodeIssue {
  /** Field path such as `items[2].timeOptions[0].startAt`; `$` is the whole file. */
  path: string;
  /** Short fixed-vocabulary reason. Never contains file contents. */
  reason: string;
}

export interface DecodeSuccess<T> {
  ok: true;
  value: T;
}

export interface DecodeFailure {
  ok: false;
  code: DecodeFailureCode;
  issues: DecodeIssue[];
}

export type DecodeResult<T> = DecodeSuccess<T> | DecodeFailure;

const INTEREST_IDS = ['football', 'karting', 'cinema', 'music', 'social', 'fitness', 'comedy', 'theatre'] as const;
const AVAILABILITY_KEYS = ['weekday-evening', 'weekend-day', 'weekend-evening'] as const;
const ACTIVITY_STATUSES = ['available', 'unavailable'] as const;
const SOURCE_KINDS = ['demo', 'verified', 'unverified'] as const;
const INTEREST_STATUSES = ['interested', 'withdrawn'] as const;
const ATTENDANCE_STATUSES = ['going', 'declined'] as const;
const CURRENCIES = ['GBP'] as const;

const SUPPORTED_SCHEMA_VERSION = 1;

/** Issues kept in a result; the rest are summarised so a bad file stays readable. */
const MAX_ISSUES = 25;

interface DecodeContext {
  readonly dependencies: DecoderDependencies;
  readonly issues: DecodeIssue[];
  errorCount: number;
  sawUnsupportedSchema: boolean;
}

/** Returns the decoded value, or undefined after reporting why it is invalid. */
type Reader<T> = (context: DecodeContext, value: unknown, path: string) => T | undefined;

interface Instant {
  text: string;
  ms: number;
}

function report(context: DecodeContext, path: string, reason: string): void {
  context.errorCount += 1;
  if (context.issues.length < MAX_ISSUES) {
    context.issues.push({ path: path === '' ? '$' : path, reason });
  }
}

function joinField(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function joinIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/** Reads a required field. A missing key is an issue, a present null is passed to `read`. */
function field<T>(
  context: DecodeContext,
  source: Record<string, unknown>,
  key: string,
  path: string,
  read: Reader<T>,
): T | undefined {
  const fieldPath = joinField(path, key);
  if (!hasOwn(source, key)) {
    report(context, fieldPath, 'required field is missing');
    return undefined;
  }
  return read(context, source[key], fieldPath);
}

function readObject(context: DecodeContext, value: unknown, path: string): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    report(context, path, `must be an object, got ${describeType(value)}`);
    return undefined;
  }
  return value;
}

function readText(context: DecodeContext, value: unknown, path: string): string | undefined {
  if (typeof value !== 'string') {
    report(context, path, `must be a string, got ${describeType(value)}`);
    return undefined;
  }
  return value;
}

function readNonBlankText(context: DecodeContext, value: unknown, path: string): string | undefined {
  const text = readText(context, value, path);
  if (text === undefined) return undefined;
  if (text.trim() === '') {
    report(context, path, 'must not be blank');
    return undefined;
  }
  return text;
}

function readBoolean(context: DecodeContext, value: unknown, path: string): boolean | undefined {
  if (typeof value !== 'boolean') {
    report(context, path, `must be true or false, got ${describeType(value)}`);
    return undefined;
  }
  return value;
}

function readId(context: DecodeContext, value: unknown, path: string): string | undefined {
  if (typeof value !== 'string') {
    report(context, path, `must be a string identifier, got ${describeType(value)}`);
    return undefined;
  }
  if (!context.dependencies.isValidId(value)) {
    report(context, path, 'is not a valid identifier');
    return undefined;
  }
  return value;
}

function readInstant(context: DecodeContext, value: unknown, path: string): Instant | undefined {
  if (typeof value !== 'string') {
    report(context, path, `must be a timestamp string, got ${describeType(value)}`);
    return undefined;
  }
  const ms = context.dependencies.parseInstant(value);
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    report(context, path, 'is not a valid timestamp');
    return undefined;
  }
  return { text: value, ms };
}

/** Whole pence only: finite, non-negative, integer and within the safe range. */
function readPence(context: DecodeContext, value: unknown, path: string): number | undefined {
  if (typeof value !== 'number') {
    report(context, path, `must be a number of pence, got ${describeType(value)}`);
    return undefined;
  }
  if (!Number.isFinite(value)) {
    report(context, path, 'must be a finite number');
    return undefined;
  }
  if (value < 0 || Object.is(value, -0)) {
    report(context, path, 'must not be negative');
    return undefined;
  }
  if (!Number.isInteger(value)) {
    report(context, path, 'must be a whole number of pence');
    return undefined;
  }
  if (!Number.isSafeInteger(value)) {
    report(context, path, 'is too large to be a safe integer');
    return undefined;
  }
  return value;
}

function readSchemaVersion(context: DecodeContext, value: unknown, path: string): 1 | undefined {
  if (value === SUPPORTED_SCHEMA_VERSION) return SUPPORTED_SCHEMA_VERSION;
  context.sawUnsupportedSchema = true;
  report(context, path, `unsupported schema version (this build reads version ${SUPPORTED_SCHEMA_VERSION})`);
  return undefined;
}

function nullable<T>(read: Reader<T>): Reader<T | null> {
  return (context, value, path) => (value === null ? null : read(context, value, path));
}

function oneOf<T extends string>(allowed: readonly T[]): Reader<T> {
  return (context, value, path) => {
    const match = allowed.find((candidate) => candidate === value);
    if (match === undefined) {
      report(context, path, `must be one of: ${allowed.join(', ')}`);
      return undefined;
    }
    return match;
  };
}

/** Array of valid items. `unique` rejects repeated primitive values instead of deduplicating. */
function arrayOf<T>(read: Reader<T>, options: { unique: boolean }): Reader<T[]> {
  return (context, value, path) => {
    if (!Array.isArray(value)) {
      report(context, path, `must be an array, got ${describeType(value)}`);
      return undefined;
    }
    const errorsBefore = context.errorCount;
    const items: T[] = [];
    const seen = new Set<T>();
    value.forEach((element: unknown, index: number) => {
      const itemPath = joinIndex(path, index);
      const item = read(context, element, itemPath);
      if (item === undefined) return;
      if (options.unique && seen.has(item)) {
        report(context, itemPath, 'duplicate value');
        return;
      }
      seen.add(item);
      items.push(item);
    });
    return context.errorCount === errorsBefore ? items : undefined;
  };
}

/** Array of records whose `idKey` must be unique within the array. */
function recordsWithUniqueIds<T>(read: Reader<T>, idKey: string, idOf: (item: T) => string): Reader<T[]> {
  return (context, value, path) => {
    if (!Array.isArray(value)) {
      report(context, path, `must be an array, got ${describeType(value)}`);
      return undefined;
    }
    const errorsBefore = context.errorCount;
    const items: T[] = [];
    const firstIndexById = new Map<string, number>();
    value.forEach((element: unknown, index: number) => {
      const itemPath = joinIndex(path, index);
      const item = read(context, element, itemPath);
      if (item === undefined) return;
      const id = idOf(item);
      const firstIndex = firstIndexById.get(id);
      if (firstIndex !== undefined) {
        report(context, joinField(itemPath, idKey), `duplicate ${idKey} (first used at index ${firstIndex})`);
        return;
      }
      firstIndexById.set(id, index);
      items.push(item);
    });
    return context.errorCount === errorsBefore ? items : undefined;
  };
}

function checkEndAfterStart(
  context: DecodeContext,
  path: string,
  start: Instant | undefined,
  end: Instant | null | undefined,
): void {
  if (start === undefined || end === undefined || end === null) return;
  if (end.ms <= start.ms) {
    report(context, joinField(path, 'endAt'), 'must be later than startAt');
  }
}

const readInterestId = oneOf(INTEREST_IDS);
const readAvailabilityKey = oneOf(AVAILABILITY_KEYS);

const readInterestIds = arrayOf(readInterestId, { unique: true });
const readAvailabilityKeys = arrayOf(readAvailabilityKey, { unique: true });

const readNullableInstant = nullable(readInstant);

function readProfile(context: DecodeContext, value: unknown, path: string): DecodedProfile | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const userId = field(context, source, 'userId', path, readId);
  const displayName = field(context, source, 'displayName', path, readNonBlankText);
  const university = field(context, source, 'university', path, readText);
  const interestIds = field(context, source, 'interestIds', path, readInterestIds);
  const availability = field(context, source, 'availability', path, readAvailabilityKeys);
  const budgetPence = field(context, source, 'budgetPence', path, nullable(readPence));
  const isDemo = field(context, source, 'isDemo', path, readBoolean);

  if (
    schemaVersion === undefined ||
    userId === undefined ||
    displayName === undefined ||
    university === undefined ||
    interestIds === undefined ||
    availability === undefined ||
    budgetPence === undefined ||
    isDemo === undefined
  ) {
    return undefined;
  }
  const extra: RichPreferences = {};
  if (source.universityId !== undefined) {
    if (typeof source.universityId !== "string" || source.universityId.length > 80) report(context, path, "Invalid universityId");
    else extra.universityId = source.universityId;
  }
  if (source.yearOfStudy !== undefined) {
    const y = source.yearOfStudy;
    if (y === "1" || y === "2" || y === "3+" || y === "postgrad") extra.yearOfStudy = y;
    else report(context, path, "Invalid yearOfStudy");
  }
  if (source.budgetBand !== undefined) {
    const b = source.budgetBand;
    if (b === "free" || b === "u15" || b === "u30" || b === "any") extra.budgetBand = b;
    else report(context, path, "Invalid budgetBand");
  }
  if (source.freeSlots !== undefined) {
    if (!Array.isArray(source.freeSlots) || source.freeSlots.length > 14 || !source.freeSlots.every((v: unknown) => typeof v === "string" && FREE_SLOTS.some(s => s === v))) report(context, path, "Invalid freeSlots");
    else extra.freeSlots = FREE_SLOTS.filter(s => source.freeSlots instanceof Array && source.freeSlots.includes(s));
  }
  return { schemaVersion, userId, displayName, university, interestIds, availability, budgetPence, isDemo, ...extra };
}

function readSampleProfile(context: DecodeContext, value: unknown, path: string): DecodedProfile | undefined {
  const profile = readProfile(context, value, path);
  if (profile === undefined) return undefined;
  if (!profile.isDemo) {
    report(context, joinField(path, 'isDemo'), 'sample profiles must be marked isDemo true');
    return undefined;
  }
  return profile;
}

function readTimeOption(context: DecodeContext, value: unknown, path: string): DecodedTimeOption | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const id = field(context, source, 'id', path, readId);
  const startAt = field(context, source, 'startAt', path, readInstant);
  const endAt = field(context, source, 'endAt', path, readNullableInstant);
  const availabilityKeys = field(context, source, 'availabilityKeys', path, readAvailabilityKeys);
  checkEndAfterStart(context, path, startAt, endAt);

  if (id === undefined || startAt === undefined || endAt === undefined || availabilityKeys === undefined) {
    return undefined;
  }
  if (endAt !== null && endAt.ms <= startAt.ms) return undefined;
  return { id, startAt: startAt.text, endAt: endAt === null ? null : endAt.text, availabilityKeys };
}

const readTimeOptions = recordsWithUniqueIds(readTimeOption, 'id', (option) => option.id);

function readCost(context: DecodeContext, value: unknown, path: string): DecodedActivity['cost'] | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const amountPence = field(context, source, 'amountPence', path, nullable(readPence));
  const currency = field(context, source, 'currency', path, oneOf(CURRENCIES));
  const isEstimate = field(context, source, 'isEstimate', path, readBoolean);

  if (amountPence === undefined || currency === undefined || isEstimate === undefined) return undefined;
  return { amountPence, currency, isEstimate };
}

function readSource(context: DecodeContext, value: unknown, path: string): DecodedActivity['source'] | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const kind = field(context, source, 'kind', path, oneOf(SOURCE_KINDS));
  const url = field(context, source, 'url', path, nullable(readNonBlankText));
  const checkedAt = field(context, source, 'checkedAt', path, readNullableInstant);

  if (kind === 'verified') {
    if (url === null) report(context, joinField(path, 'url'), 'a verified source requires a url');
    if (checkedAt === null) report(context, joinField(path, 'checkedAt'), 'a verified source requires checkedAt');
  }

  if (kind === undefined || url === undefined || checkedAt === undefined) return undefined;
  if (kind === 'verified' && (url === null || checkedAt === null)) return undefined;
  return { kind, url, checkedAt: checkedAt === null ? null : checkedAt.text };
}

function readActivity(context: DecodeContext, value: unknown, path: string): DecodedActivity | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const id = field(context, source, 'id', path, readId);
  const title = field(context, source, 'title', path, readNonBlankText);
  const description = field(context, source, 'description', path, readText);
  const interestId = field(context, source, 'interestId', path, readInterestId);
  const area = field(context, source, 'area', path, readText);
  const status = field(context, source, 'status', path, oneOf(ACTIVITY_STATUSES));
  const timeOptions = field(context, source, 'timeOptions', path, readTimeOptions);
  const cost = field(context, source, 'cost', path, readCost);
  const activitySource = field(context, source, 'source', path, readSource);

  // Optional (S1 patch): absent stays absent; present must be null or non-blank text.
  const hasSuggestion = hasOwn(source, 'suggestedMeetingPoint');
  const suggestedMeetingPoint = hasSuggestion
    ? field(context, source, 'suggestedMeetingPoint', path, nullable(readNonBlankText))
    : undefined;

  if (
    schemaVersion === undefined ||
    id === undefined ||
    title === undefined ||
    description === undefined ||
    interestId === undefined ||
    area === undefined ||
    status === undefined ||
    timeOptions === undefined ||
    cost === undefined ||
    activitySource === undefined ||
    (hasSuggestion && suggestedMeetingPoint === undefined)
  ) {
    return undefined;
  }
  return {
    schemaVersion,
    id,
    title,
    description,
    interestId,
    area,
    status,
    timeOptions,
    cost,
    source: activitySource,
    ...(suggestedMeetingPoint === undefined ? {} : { suggestedMeetingPoint }),
  };
}

const readActivities = recordsWithUniqueIds(readActivity, 'id', (activity) => activity.id);
const readSampleProfiles = recordsWithUniqueIds(readSampleProfile, 'userId', (profile) => profile.userId);

function readActivityCatalog(context: DecodeContext, value: unknown, path: string): DecodedActivityCatalog | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const items = field(context, source, 'items', path, readActivities);

  if (schemaVersion === undefined || items === undefined) return undefined;
  return { schemaVersion, items };
}

function readSampleProfileCatalog(
  context: DecodeContext,
  value: unknown,
  path: string,
): DecodedSampleProfileCatalog | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const items = field(context, source, 'items', path, readSampleProfiles);

  if (schemaVersion === undefined || items === undefined) return undefined;
  return { schemaVersion, items };
}

function readSession(context: DecodeContext, value: unknown, path: string): DecodedSession | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const organiserUserId = field(context, source, 'organiserUserId', path, nullable(readId));

  if (schemaVersion === undefined || organiserUserId === undefined) return undefined;
  return { schemaVersion, organiserUserId };
}

function readInterest(context: DecodeContext, value: unknown, path: string): DecodedInterest | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const activityId = field(context, source, 'activityId', path, readId);
  const userId = field(context, source, 'userId', path, readId);
  const status = field(context, source, 'status', path, oneOf(INTEREST_STATUSES));
  const updatedAt = field(context, source, 'updatedAt', path, readInstant);

  if (
    schemaVersion === undefined ||
    activityId === undefined ||
    userId === undefined ||
    status === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  return { schemaVersion, activityId, userId, status, updatedAt: updatedAt.text };
}

function readVote(context: DecodeContext, value: unknown, path: string): DecodedVote | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const activityId = field(context, source, 'activityId', path, readId);
  const userId = field(context, source, 'userId', path, readId);
  const optionId = field(context, source, 'optionId', path, nullable(readId));
  const updatedAt = field(context, source, 'updatedAt', path, readInstant);

  if (
    schemaVersion === undefined ||
    activityId === undefined ||
    userId === undefined ||
    optionId === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  return { schemaVersion, activityId, userId, optionId, updatedAt: updatedAt.text };
}

function readPlan(context: DecodeContext, value: unknown, path: string): DecodedPlan | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const id = field(context, source, 'id', path, readId);
  const activityId = field(context, source, 'activityId', path, readId);
  const organiserId = field(context, source, 'organiserId', path, readId);
  const chosenOptionId = field(context, source, 'chosenOptionId', path, readId);
  const startAt = field(context, source, 'startAt', path, readInstant);
  const endAt = field(context, source, 'endAt', path, readNullableInstant);
  const meetingPoint = field(context, source, 'meetingPoint', path, readNonBlankText);
  const createdAt = field(context, source, 'createdAt', path, readInstant);
  checkEndAfterStart(context, path, startAt, endAt);

  if (
    schemaVersion === undefined ||
    id === undefined ||
    activityId === undefined ||
    organiserId === undefined ||
    chosenOptionId === undefined ||
    startAt === undefined ||
    endAt === undefined ||
    meetingPoint === undefined ||
    createdAt === undefined
  ) {
    return undefined;
  }
  if (endAt !== null && endAt.ms <= startAt.ms) return undefined;
  return {
    schemaVersion,
    id,
    activityId,
    organiserId,
    chosenOptionId,
    startAt: startAt.text,
    endAt: endAt === null ? null : endAt.text,
    meetingPoint,
    createdAt: createdAt.text,
  };
}

function readAttendance(context: DecodeContext, value: unknown, path: string): DecodedAttendance | undefined {
  const source = readObject(context, value, path);
  if (source === undefined) return undefined;

  const schemaVersion = field(context, source, 'schemaVersion', path, readSchemaVersion);
  const planId = field(context, source, 'planId', path, readId);
  const userId = field(context, source, 'userId', path, readId);
  const status = field(context, source, 'status', path, oneOf(ATTENDANCE_STATUSES));
  const updatedAt = field(context, source, 'updatedAt', path, readInstant);

  if (
    schemaVersion === undefined ||
    planId === undefined ||
    userId === undefined ||
    status === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  return { schemaVersion, planId, userId, status, updatedAt: updatedAt.text };
}

function failure(code: DecodeFailureCode, issues: DecodeIssue[]): DecodeFailure {
  return { ok: false, code, issues };
}

function decodeWith<T>(text: string, dependencies: DecoderDependencies, read: Reader<T>): DecodeResult<T> {
  if (typeof text !== 'string') {
    return failure('invalid-json', [{ path: '$', reason: 'input is not text' }]);
  }
  if (text.trim() === '') {
    return failure('invalid-json', [{ path: '$', reason: 'file is empty' }]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // The engine's message can quote the file, so only the character offset is kept.
    const offset = error instanceof Error ? /position (\d+)/.exec(error.message) : null;
    const reason = offset === null ? 'not valid JSON' : `not valid JSON (near character ${offset[1]})`;
    return failure('invalid-json', [{ path: '$', reason }]);
  }

  // A different schema version may have a different shape, so stop before judging fields.
  if (isPlainObject(parsed) && hasOwn(parsed, 'schemaVersion') && parsed['schemaVersion'] !== SUPPORTED_SCHEMA_VERSION) {
    return failure('unsupported-schema', [
      {
        path: 'schemaVersion',
        reason: `unsupported schema version (this build reads version ${SUPPORTED_SCHEMA_VERSION})`,
      },
    ]);
  }

  const context: DecodeContext = { dependencies, issues: [], errorCount: 0, sawUnsupportedSchema: false };
  const value = read(context, parsed, '');
  if (context.errorCount === 0 && value !== undefined) {
    return { ok: true, value };
  }

  if (context.errorCount === 0) {
    // A reader returned nothing without reporting why; never let that read as success.
    report(context, '', 'record could not be decoded');
  }
  if (context.errorCount > context.issues.length) {
    context.issues.push({ path: '$', reason: `${context.errorCount - context.issues.length} further issues omitted` });
  }
  return failure(context.sawUnsupportedSchema ? 'unsupported-schema' : 'invalid-record', context.issues);
}

/**
 * Decodes the text of one shared file.
 *
 * - `invalid-json`: the text is empty or not parseable JSON.
 * - `unsupported-schema`: a `schemaVersion` is present but is not exactly the number 1
 *   (a root mismatch is reported alone; a mismatch inside a catalog item also yields this code).
 * - `invalid-record`: valid JSON that is not a valid record of this kind, including a missing
 *   `schemaVersion`. `issues` lists each field with a short reason.
 *
 * Unknown properties are ignored and never copied into the result. Never throws for bad input.
 */
export function decodeRecord(
  kind: 'profile',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedProfile>;
export function decodeRecord(
  kind: 'activityCatalog',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedActivityCatalog>;
export function decodeRecord(
  kind: 'sampleProfileCatalog',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedSampleProfileCatalog>;
export function decodeRecord(
  kind: 'session',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedSession>;
export function decodeRecord(
  kind: 'interest',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedInterest>;
export function decodeRecord(kind: 'vote', text: string, dependencies: DecoderDependencies): DecodeResult<DecodedVote>;
export function decodeRecord(kind: 'plan', text: string, dependencies: DecoderDependencies): DecodeResult<DecodedPlan>;
export function decodeRecord(
  kind: 'attendance',
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedAttendance>;
export function decodeRecord(
  kind: RecordKind,
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedRecord>;
export function decodeRecord(
  kind: RecordKind,
  text: string,
  dependencies: DecoderDependencies,
): DecodeResult<DecodedRecord> {
  switch (kind) {
    case 'profile':
      return decodeWith(text, dependencies, readProfile);
    case 'activityCatalog':
      return decodeWith(text, dependencies, readActivityCatalog);
    case 'sampleProfileCatalog':
      return decodeWith(text, dependencies, readSampleProfileCatalog);
    case 'session':
      return decodeWith(text, dependencies, readSession);
    case 'interest':
      return decodeWith(text, dependencies, readInterest);
    case 'vote':
      return decodeWith(text, dependencies, readVote);
    case 'plan':
      return decodeWith(text, dependencies, readPlan);
    case 'attendance':
      return decodeWith(text, dependencies, readAttendance);
    default:
      return failure('invalid-record', [{ path: 'kind', reason: 'unknown record kind' }]);
  }
}

// New social records use independent guards so the original frozen decoder remains compatible.
export type SocialRecord = import("../types").FriendRequest | import("../types").FriendResponse | import("../types").MeetState | import("../types").BlockState | import("../types").ChatMessage | import("../types").ChatRead | import("../types").PollVote;
export type SocialKind = "request" | "response" | "meet" | "blocks" | "message" | "read" | "pollVote";
export function isSocialRecord(kind: SocialKind, value: unknown): value is SocialRecord {
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;
 const r: Record<string, unknown> = Object.fromEntries(Object.entries(value));
 if (r.schemaVersion !== 1) return false;
 const id = (key: string) => typeof r[key] === "string" && socialValidId(r[key]);
 const real = (key: string) => typeof r[key] === "string" && socialRealId(r[key]);
 const time = (key: string) => typeof r[key] === "string" && socialParseInstant(r[key]) !== null;
 const ids = (key: string) => Array.isArray(r[key]) && r[key].every((v: unknown)=>typeof v === "string" && socialValidId(v));
 switch(kind) {
  case "request": return real("fromId") && real("toId") && r.fromId !== r.toId && (r.status === "pending" || r.status === "cancelled") && time("createdAt");
  case "response": return real("fromId") && real("toId") && r.fromId !== r.toId && (r.status === "accepted" || r.status === "declined" || r.status === "undone") && time("respondedAt");
  case "meet": return real("userId") && ids("passedIds") && time("updatedAt");
  case "blocks": return real("userId") && ids("blockedIds") && time("updatedAt");
  case "read": return real("userId") && id("chatId") && time("lastReadAt");
  case "pollVote": return real("voterId") && id("chatId") && id("messageId") && ids("optionIds") && Array.isArray(r.optionIds) && new Set(r.optionIds).size === r.optionIds.length && time("updatedAt");
  case "message": {
   if (!real("authorId") || !id("chatId") || !id("id") || !time("createdAt")) return false;
   if(r.kind === "text") return typeof r.text === "string" && r.text.trim() === r.text && r.text.length >= 1 && r.text.length <= 1000 && r.poll === undefined;
   return r.kind === "poll" && isChatPoll(r.poll) && r.text === undefined;
  }
 }
}
export function isChatPoll(value: unknown): value is import("../types").ChatPoll {
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;
 const p = Object.fromEntries(Object.entries(value));
 if(typeof p.question !== "string" || typeof p.multi !== "boolean" || typeof p.anonymous !== "boolean" || !Array.isArray(p.options)) return false;
 const options: {id:string;label:string}[] = [];
 for(const value of p.options) {
  if(!value || typeof value !== "object") return false;
  const o = Object.fromEntries(Object.entries(value));
  if(typeof o.id !== "string" || typeof o.label !== "string") return false;
  options.push({id:o.id,label:o.label});
 }
 return socialValidPoll({question:p.question,options,multi:p.multi,anonymous:p.anonymous});
}
import { isValidId as socialValidId } from "./identifiers";
import { realId as socialRealId, validPoll as socialValidPoll } from "./social";
import { parseInstant as socialParseInstant } from "./londonTime";

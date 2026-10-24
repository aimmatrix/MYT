/**
 * London date-time helpers for activity cards, time voting and plan summaries.
 *
 * Parsing accepts only ISO date-times with an explicit Z or numeric offset.
 * Impossible calendar dates are rejected before any conversion, so a value
 * such as 31 February cannot roll into March. Display uses en-GB and
 * Europe/London, so winter and summer keep the offset reported by Intl.
 *
 * Duplicate option IDs are one choice. Among valid future rows with the same
 * id, the earliest start instant wins. If those instants are equal, the
 * earlier input row wins. Survivors are ordered by start instant, then by
 * option id using UTF-16 code-unit order.
 */

export interface TimeOptionInput {
  id: string;
  startAt: string;
  endAt: string | null;
  availabilityKeys: string[];
}

const TIME_UNAVAILABLE = "Time unavailable";
const EN_DASH = "\u2013";
const UNIX_EPOCH_DAYS = 719468;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;

const ISO_DATE_TIME =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?(?<zone>Z|[+-]\d{2}:\d{2}|[+-]\d{2}\d{2})$/;

const LONDON_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Europe/London",
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
};

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
}

interface LondonClock {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
  millisecond: number;
  zone: string;
  dayKey: string;
}

type ClockPrecision = "minutes" | "seconds" | "milliseconds";

interface RankedOption {
  option: TimeOptionInput;
  startMs: number;
  index: number;
}

/**
 * Parse an explicit-offset ISO date-time into Unix epoch milliseconds.
 * Returns null when the value is missing, date-only, timezone-less,
 * calendar-impossible, or has an invalid offset. Sub-millisecond digits
 * are truncated, not rounded.
 */
export function parseInstant(value: string): number | null {
  try {
    if (typeof value !== "string") return null;
    const parts = readDateTimeParts(value);
    if (parts === null) return null;
    const days = gregorianToUnixDays(parts.year, parts.month, parts.day);
    const wallClockMs =
      days * MILLISECONDS_PER_DAY +
      parts.hour * MILLISECONDS_PER_HOUR +
      parts.minute * MILLISECONDS_PER_MINUTE +
      parts.second * 1000 +
      parts.millisecond;
    const instant = wallClockMs - parts.offsetMinutes * MILLISECONDS_PER_MINUTE;
    return Number.isSafeInteger(instant) ? instant : null;
  } catch {
    return null;
  }
}

/**
 * Format one instant in Europe/London.
 * Example: "Thu, 15 Jan 2026, 18:30 GMT".
 * Returns "Time unavailable" for any value parseInstant rejects.
 */
export function formatLondonDateTime(value: string): string {
  try {
    const clock = clockFromInput(value);
    if (clock === null) return TIME_UNAVAILABLE;
    return formatPoint(clock, precisionFor(clock));
  } catch {
    return TIME_UNAVAILABLE;
  }
}

/**
 * Format a London start/end pair.
 * A null end shows the start only, because no duration was supplied.
 * The same London calendar day shares one date. A range that crosses
 * midnight, or that changes from BST to GMT, includes each date or zone
 * needed to tell the instants apart. An end that is missing, invalid, or
 * not strictly after the start returns "Time unavailable".
 */
export function formatLondonTimeRange(startAt: string, endAt: string | null): string {
  try {
    if (endAt === null) return formatLondonDateTime(startAt);
    if (typeof startAt !== "string" || typeof endAt !== "string") return TIME_UNAVAILABLE;
    const startMs = parseInstant(startAt);
    const endMs = parseInstant(endAt);
    if (startMs === null || endMs === null || endMs <= startMs) return TIME_UNAVAILABLE;
    const start = readLondonClock(startMs);
    const end = readLondonClock(endMs);
    if (start === null || end === null) return TIME_UNAVAILABLE;
    const precision = finerPrecision(precisionFor(start), precisionFor(end));
    if (start.dayKey === end.dayKey) {
      const startClock = formatClock(start, precision);
      const endClock = formatClock(end, precision);
      if (start.zone === end.zone) {
        return `${formatDate(start)}, ${startClock}${EN_DASH}${endClock} ${start.zone}`;
      }
      return `${formatDate(start)}, ${startClock} ${start.zone} ${EN_DASH} ${endClock} ${end.zone}`;
    }
    return `${formatPoint(start, precision)} ${EN_DASH} ${formatPoint(end, precision)}`;
  } catch {
    return TIME_UNAVAILABLE;
  }
}

/**
 * Keep future time options. `nowMs` is injected; this function does not
 * read the current clock. A start must be strictly later than `nowMs`.
 * When an end is present it must parse and be strictly later than the start.
 * The input array and its objects are not mutated.
 */
export function getFutureTimeOptions(
  options: readonly TimeOptionInput[],
  nowMs: number,
): TimeOptionInput[] {
  if (!Array.isArray(options) || typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return [];
  }

  const selected = new Map<string, RankedOption>();
  for (let index = 0; index < options.length; index += 1) {
    const ranked = rankFutureOption(options[index], nowMs, index);
    if (ranked === null) continue;
    const current = selected.get(ranked.option.id);
    if (current === undefined || ranked.startMs < current.startMs) {
      selected.set(ranked.option.id, ranked);
    }
  }

  const ordered = [...selected.values()];
  ordered.sort((left, right) => compareRanked(left, right));
  return ordered.map((ranked) => ranked.option);
}

function rankFutureOption(value: unknown, nowMs: number, index: number): RankedOption | null {
  try {
    if (!isTimeOptionInput(value)) return null;
    const startMs = parseInstant(value.startAt);
    if (startMs === null || startMs <= nowMs) return null;
    if (value.endAt !== null) {
      const endMs = parseInstant(value.endAt);
      if (endMs === null || endMs <= startMs) return null;
    }
    return { option: copyTimeOption(value), startMs, index };
  } catch {
    return null;
  }
}

function compareRanked(left: RankedOption, right: RankedOption): number {
  if (left.startMs !== right.startMs) return left.startMs < right.startMs ? -1 : 1;
  if (left.option.id !== right.option.id) return left.option.id < right.option.id ? -1 : 1;
  return left.index - right.index;
}

function copyTimeOption(option: TimeOptionInput): TimeOptionInput {
  return {
    id: option.id,
    startAt: option.startAt,
    endAt: option.endAt,
    availabilityKeys: option.availabilityKeys.slice(),
  };
}

function isTimeOptionInput(value: unknown): value is TimeOptionInput {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.startAt !== "string") return false;
  if (value.endAt !== null && typeof value.endAt !== "string") return false;
  return isStringArray(value.availabilityKeys);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry: unknown) => typeof entry === "string");
}

function readDateTimeParts(value: string): DateTimeParts | null {
  const match = ISO_DATE_TIME.exec(value);
  const groups = match?.groups;
  if (groups === undefined) return null;
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const second = Number(groups.second);
  const offsetMinutes = readOffsetMinutes(groups.zone);
  if (offsetMinutes === null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millisecond = fractionToMilliseconds(groups.fraction);
  if (millisecond === null) return null;
  return { year, month, day, hour, minute, second, millisecond, offsetMinutes };
}

function readOffsetMinutes(zone: string | undefined): number | null {
  if (zone === undefined) return null;
  if (zone === "Z") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (match === null) return null;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

function fractionToMilliseconds(fraction: string | undefined): number | null {
  if (fraction === undefined) return 0;
  if (!/^\d{1,9}$/.test(fraction)) return null;
  return Number((fraction + "000").slice(0, 3));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isGregorianLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  if (month === 1 || month === 3 || month === 5 || month === 7 || month === 8 || month === 10 || month === 12) {
    return 31;
  }
  return 0;
}

function isGregorianLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/**
 * Howard Hinnant's proleptic Gregorian day count, returning whole days
 * since 1970-01-01. Used instead of the platform date parser so years
 * 0000–0099 stay in that century and invalid dates never roll over.
 */
function gregorianToUnixDays(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthShift = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthShift + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - UNIX_EPOCH_DAYS;
}

function clockFromInput(value: string): LondonClock | null {
  if (typeof value !== "string") return null;
  const instant = parseInstant(value);
  if (instant === null) return null;
  return readLondonClock(instant);
}

function readLondonClock(instant: number): LondonClock | null {
  if (!Number.isSafeInteger(instant)) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", LONDON_FORMAT);
    const parts = formatter.formatToParts(instant);
    const weekday = partValue(parts, "weekday");
    const day = partValue(parts, "day");
    const month = partValue(parts, "month");
    const year = partValue(parts, "year");
    const hour = padTimeUnit(partValue(parts, "hour"), 23);
    const minute = padTimeUnit(partValue(parts, "minute"), 59);
    const second = padTimeUnit(partValue(parts, "second"), 59);
    const zone = partValue(parts, "timeZoneName");
    if (
      hour === null ||
      minute === null ||
      second === null ||
      !isDisplayToken(weekday) ||
      !isDisplayToken(day) ||
      !isDisplayToken(month) ||
      !isDisplayToken(year) ||
      !isDisplayToken(zone)
    ) {
      return null;
    }
    const remainder = instant % 1000;
    const millisecond = remainder < 0 ? remainder + 1000 : remainder;
    return {
      weekday,
      day,
      month,
      year,
      hour,
      minute,
      second,
      millisecond,
      zone,
      dayKey: `${year}-${month}-${day}`,
    };
  } catch {
    return null;
  }
}

function partValue(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((part) => part.type === type);
  return found === undefined ? "" : found.value;
}

function padTimeUnit(value: string, max: number): string | null {
  const digits = value.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d{1,2}$/.test(digits)) return null;
  const numeric = Number(digits);
  if (numeric > max) return null;
  return String(numeric).padStart(2, "0");
}

function isDisplayToken(value: string): boolean {
  return value.length > 0 && !/[\u0000-\u001f]/.test(value);
}

function precisionFor(clock: LondonClock): ClockPrecision {
  if (clock.millisecond !== 0) return "milliseconds";
  if (clock.second !== "00") return "seconds";
  return "minutes";
}

function finerPrecision(left: ClockPrecision, right: ClockPrecision): ClockPrecision {
  const rank: Record<ClockPrecision, number> = { minutes: 0, seconds: 1, milliseconds: 2 };
  return rank[left] >= rank[right] ? left : right;
}

function formatDate(clock: LondonClock): string {
  return `${clock.weekday}, ${clock.day} ${clock.month} ${clock.year}`;
}

function formatClock(clock: LondonClock, precision: ClockPrecision): string {
  let text = `${clock.hour}:${clock.minute}`;
  if (precision !== "minutes") text += `:${clock.second}`;
  if (precision === "milliseconds") text += `.${String(clock.millisecond).padStart(3, "0")}`;
  return text;
}

function formatPoint(clock: LondonClock, precision: ClockPrecision): string {
  return `${formatDate(clock)}, ${formatClock(clock, precision)} ${clock.zone}`;
}

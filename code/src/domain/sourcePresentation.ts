/**
 * Honest presentation of an activity's event source.
 *
 * This module formats catalog metadata for display. It does not fetch, follow
 * redirects, write storage, or independently verify that an event exists.
 * `kind: "verified"` means the catalog author recorded a source check. Demo
 * items are outing ideas, never researched scheduled events.
 *
 * Safe hrefs are https destinations after URL parsing. javascript:, data:,
 * http:, credentials, control characters and malformed strings are dropped. The
 * original destination is returned without wrapping it in a tracker. Sensitive
 * URL material is never logged or copied into labels.
 *
 * Integration patch (S1): the proposal also linked plain `http:`. Architecture's
 * Concurrency review row 23 says links render for `https:` only, so that rule is
 * applied here (three lines marked "S1 patch").
 */

export type SourceKind = "demo" | "verified" | "unverified";

/** Structural copy of `Activity.source`. Extra fields on a real record are ignored. */
export interface SourceInput {
  kind: SourceKind;
  url: string | null;
  checkedAt: string | null;
}

export interface SourcePresentation {
  kind: SourceKind;
  label: string;
  href: string | null;
  detail: string;
}

const DEMO_LABEL = "Demo activity idea";
const VERIFIED_LABEL = "Verified listing";
const UNVERIFIED_LABEL = "Unverified listing";

const DEMO_DETAIL =
  "This is a group outing idea, not a scheduled event established by research. Check a real venue, time and price separately.";
const FORMATTER_CANNOT_VERIFY = "A source formatter cannot independently verify an event.";
const UNVERIFIED_WITH_LINK =
  "A source link is available, but a safe address is not a reliability check. This listing has not been recorded as verified.";
const UNVERIFIED_WITHOUT_LINK = "No safe source link is available. This listing has not been recorded as verified.";
const UNCLASSIFIED_DETAIL = "This listing is not classified as a researched event.";

const EXPLICIT_OFFSET_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function getSourcePresentation(source: SourceInput): SourcePresentation {
  const claimed = sourceKind(source);
  const href = safeSourceHref(source == null ? null : source.url);
  const checked = classifyCheckedAt(source == null ? null : source.checkedAt);

  if (claimed === "demo") {
    return {
      kind: "demo",
      label: DEMO_LABEL,
      href,
      detail: DEMO_DETAIL,
    };
  }

  if (claimed === "verified") {
    const evidence = verifiedEvidenceProblems(source, href, checked);
    if (evidence.length === 0 && href !== null && checked.iso !== null) {
      return {
        kind: "verified",
        label: VERIFIED_LABEL,
        href,
        detail:
          "The catalog author recorded a source check at " +
          checked.iso +
          ". This display does not independently verify the listing, tickets or a MYT outing.",
      };
    }
    const reasons = evidence.length > 0 ? evidence : ["the recorded verification metadata is incomplete"];
    return {
      kind: "unverified",
      label: UNVERIFIED_LABEL,
      href,
      detail: "Shown as unverified because " + reasons.join("; ") + ". " + FORMATTER_CANNOT_VERIFY,
    };
  }

  return {
    kind: "unverified",
    label: UNVERIFIED_LABEL,
    href,
    detail: claimed === "unverified" ? (href ? UNVERIFIED_WITH_LINK : UNVERIFIED_WITHOUT_LINK) : UNCLASSIFIED_DETAIL,
  };
}

function sourceKind(source: SourceInput): SourceKind | "unknown" {
  if (source == null || typeof source !== "object") return "unknown";
  const kind = source.kind;
  if (kind === "demo" || kind === "verified" || kind === "unverified") return kind;
  return "unknown";
}

type CheckedAtClassification =
  | { state: "missing"; iso: null }
  | { state: "invalid"; iso: null }
  | { state: "valid"; iso: string };

function classifyCheckedAt(value: unknown): CheckedAtClassification {
  if (value == null) return { state: "missing", iso: null };
  if (typeof value !== "string" || value.length === 0) return { state: "invalid", iso: null };
  if (!isExplicitOffsetIsoInstant(value)) return { state: "invalid", iso: null };
  return { state: "valid", iso: value };
}

function verifiedEvidenceProblems(
  source: SourceInput,
  href: string | null,
  checked: CheckedAtClassification,
): string[] {
  const problems: string[] = [];
  if (checked.state === "missing") {
    problems.push("the catalog has no recorded check time");
  } else if (checked.state === "invalid") {
    problems.push("the recorded check time is not a valid ISO date-time with an explicit offset");
  }
  const rawUrl = source == null ? null : source.url;
  if (href === null) {
    if (rawUrl == null || rawUrl === "") {
      problems.push("there is no source URL supporting the catalog author's check");
    } else {
      problems.push("the recorded source address is not a safe https link"); // S1 patch
    }
  }
  return problems;
}

function isExplicitOffsetIsoInstant(value: string): boolean {
  const match = EXPLICIT_OFFSET_ISO.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetToken = match[8];
  const offsetHour = offsetToken === "Z" ? 0 : Number(match[9]);
  const offsetMinute = offsetToken === "Z" ? 0 : Number(match[10]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 14 || offsetMinute > 59) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInGregorianMonth(year, month)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return MONTH_DAYS[month - 1] ?? 0;
}

/**
 * Returns a navigable https href, or null. Never throws, never logs `raw`.
 * Callers must treat null as "do not render a link".
 */
function safeSourceHref(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (containsUnsafeCharacters(raw)) return null;
  if (containsEncodedControl(raw)) return null;
  if (!hasHttpsUrlPrefix(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:") return null; // S1 patch
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname.length === 0) return null;
  if (!/[0-9A-Za-z]/.test(parsed.hostname)) return null;
  const href = parsed.href;
  if (containsUnsafeCharacters(href) || containsEncodedControl(href)) return null;
  return href;
}

function hasHttpsUrlPrefix(raw: string): boolean { // S1 patch
  return raw.toLowerCase().startsWith("https://");
}

function containsUnsafeCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return /\s/u.test(value);
}

function containsEncodedControl(value: string): boolean {
  return /%(0[0-9A-Fa-f]|1[0-9A-Fa-f]|7[Ff])/u.test(value);
}

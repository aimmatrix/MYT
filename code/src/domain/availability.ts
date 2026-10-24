/**
 * Pure availability preferences for matching and time-option descriptions.
 *
 * A key is an explicit preference window. It is not a reservation, a saved
 * plan, or proof that a person will attend. This module does not read
 * university, course, age, timezone, bio, display labels, or instants.
 * The curator assigns activity timeOptions.availabilityKeys. The time module
 * owns valid instants. G4 owns ordering; there is no score here.
 *
 * Recognised keys, in the only order this module emits:
 * 1. "weekday-evening" — Weekday evenings
 * 2. "weekend-day" — Weekend daytime
 * 3. "weekend-evening" — Weekend evenings
 *
 * Matching copy: say that an option fits someone's availability only when
 * compareAvailability returns "overlap". "unknown" means a side did not name
 * a recognised key — use "Availability not specified", never
 * "Fits your availability". "no-overlap" is a preference mismatch between
 * two known selections, not proof that someone cannot attend.
 */

export const AVAILABILITY_KEY_ORDER = [
  "weekday-evening",
  "weekend-day",
  "weekend-evening",
] as const;

export type AvailabilityKey = (typeof AVAILABILITY_KEY_ORDER)[number];

export type AvailabilityComparison = "overlap" | "no-overlap" | "unknown";

const AVAILABILITY_LABELS: Record<AvailabilityKey, string> = {
  "weekday-evening": "Weekday evenings",
  "weekend-day": "Weekend daytime",
  "weekend-evening": "Weekend evenings",
};

const AVAILABILITY_NOT_SPECIFIED = "Availability not specified";

const RECOGNISED_KEYS: ReadonlySet<string> = new Set(AVAILABILITY_KEY_ORDER);

function isAvailabilityKey(value: unknown): value is AvailabilityKey {
  return typeof value === "string" && RECOGNISED_KEYS.has(value);
}

/**
 * Recognised keys from `input`, deduplicated, in AVAILABILITY_KEY_ORDER.
 * Unrecognised entries are dropped. `input` is not mutated.
 * A non-array yields no keys, so a display string is not scanned character
 * by character and cannot become a selection.
 */
export function normaliseAvailability(input: readonly string[]): AvailabilityKey[] {
  const present = new Set<AvailabilityKey>();
  if (Array.isArray(input)) {
    for (const value of input) {
      if (isAvailabilityKey(value)) {
        present.add(value);
      }
    }
  }
  const normalised: AvailabilityKey[] = [];
  for (const key of AVAILABILITY_KEY_ORDER) {
    if (present.has(key)) {
      normalised.push(key);
    }
  }
  return normalised;
}

/**
 * "overlap" when both sides name a recognised key and share one.
 * "no-overlap" when both sides are known and share none.
 * "unknown" when either side has no recognised key.
 */
export function compareAvailability(
  userKeys: readonly string[],
  optionKeys: readonly string[],
): AvailabilityComparison {
  const user = normaliseAvailability(userKeys);
  const option = normaliseAvailability(optionKeys);
  if (user.length === 0 || option.length === 0) {
    return "unknown";
  }
  const optionKeySet = new Set<AvailabilityKey>(option);
  for (const key of user) {
    if (optionKeySet.has(key)) {
      return "overlap";
    }
  }
  return "no-overlap";
}

/**
 * Preference phrase in canonical order.
 * No recognised keys produces "Availability not specified".
 * Two keys join with "and". Three keys use a comma, then "and" before the last.
 */
export function describeAvailability(keys: readonly string[]): string {
  const normalised = normaliseAvailability(keys);
  if (normalised.length === 0) {
    return AVAILABILITY_NOT_SPECIFIED;
  }
  const labels = normalised.map((key) => AVAILABILITY_LABELS[key]);
  if (labels.length === 1) {
    return labels[0];
  }
  const leading = labels.slice(0, -1).join(", ");
  return `${leading} and ${labels[labels.length - 1]}`;
}

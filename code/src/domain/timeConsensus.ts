/**
 * Transparent time-choice tallying for one activity.
 *
 * This module only COUNTS votes. A leading option is a suggestion, never an
 * agreed plan: the organiser still explicitly chooses and confirms the final
 * time. It creates no plan, assigns no organiser and touches no attendance.
 *
 * Pure and synchronous: no network, storage, clock reads or mutation of input.
 * `nowMs` and `parseInstant` are injected so results are reproducible.
 */

/** Returns epoch milliseconds, or null when the string is not a valid explicit instant. */
export type ParseInstant = (value: string) => number | null;

export type TimeConsensusOption = {
  readonly id: string;
  readonly startAt: string;
  readonly endAt: string | null;
};

export type TimeConsensusVote = {
  readonly activityId: string;
  readonly userId: string;
  /** null is an explicit "cleared" vote. */
  readonly optionId: string | null;
  readonly updatedAt: string;
};

export type TimeConsensusInput = {
  readonly activityId: string;
  readonly options: ReadonlyArray<TimeConsensusOption>;
  readonly votes: ReadonlyArray<TimeConsensusVote>;
  /** Real, currently interested participants only (selected upstream). */
  readonly eligibleUserIds: ReadonlySet<string>;
  readonly nowMs: number;
};

export type TimeConsensusResult = {
  /** Every valid future option, ordered by start instant then option ID. */
  counts: Array<{ optionId: string; count: number }>;
  /** Set only when exactly one option leads with at least one vote. */
  suggestedOptionId: string | null;
  /** Positive-count leaders, only when two or more share the lead. */
  tiedOptionIds: string[];
  /** Effective eligible votes that landed on a valid option (equals the sum of counts). */
  voterCount: number;
};

type ValidOption = { id: string; startMs: number; endMs: number | null };

function toInstant(value: unknown, parseInstant: ParseInstant): number | null {
  if (typeof value !== "string") return null;
  const parsed = parseInstant(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/** Orders by code unit, not locale, so output never depends on the runtime's ICU data. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the usable option set.
 *
 * An option is valid when its start is a valid instant later than `nowMs` and
 * its end, if supplied, is a valid instant later than its start.
 *
 * Duplicate option IDs (conservative rule): an ID is usable only if EVERY entry
 * carrying it is valid and all of them agree on the parsed start and end. Exact
 * repeats collapse to one option; any disagreement, or a mix of valid and
 * invalid entries, makes the ID ambiguous, so it is dropped entirely. Votes for
 * it then do not count. We never guess which copy was meant.
 */
function collectValidOptions(
  options: ReadonlyArray<TimeConsensusOption>,
  nowMs: number,
  parseInstant: ParseInstant,
): Map<string, ValidOption> {
  const usable = new Map<string, ValidOption>();
  const ambiguous = new Set<string>();
  if (!Number.isFinite(nowMs)) return usable;

  for (const option of options) {
    if (typeof option?.id !== "string" || option.id === "") continue;
    if (ambiguous.has(option.id)) continue;

    const startMs = toInstant(option.startAt, parseInstant);
    let endMs: number | null = null;
    let valid = startMs !== null && startMs > nowMs;
    if (valid && option.endAt !== null) {
      endMs = toInstant(option.endAt, parseInstant);
      valid = endMs !== null && endMs > (startMs as number);
    }

    if (!valid) {
      usable.delete(option.id);
      ambiguous.add(option.id);
      continue;
    }

    const existing = usable.get(option.id);
    if (existing && (existing.startMs !== startMs || existing.endMs !== endMs)) {
      usable.delete(option.id);
      ambiguous.add(option.id);
      continue;
    }
    usable.set(option.id, { id: option.id, startMs: startMs as number, endMs });
  }
  return usable;
}

/**
 * Resolves each eligible user's single effective choice.
 *
 * - Only votes for this activity from eligible users are considered.
 * - Votes whose `updatedAt` is not a valid instant cannot be ordered and are ignored.
 * - The latest valid `updatedAt` wins; earlier votes are never consulted again.
 * - If several votes share that latest instant and disagree, the user has no
 *   effective choice (input order must never decide). Agreeing repeats are fine.
 * - A winning `optionId: null` is an explicit clear: no choice, no fallback.
 *
 * Returns user ID -> chosen option ID (users with no effective choice are absent).
 */
function resolveEffectiveChoices(
  input: TimeConsensusInput,
  parseInstant: ParseInstant,
): Map<string, string> {
  type Latest = { atMs: number; choices: Set<string | null> };
  const latestByUser = new Map<string, Latest>();

  for (const vote of input.votes) {
    if (vote?.activityId !== input.activityId) continue;
    if (!input.eligibleUserIds.has(vote.userId)) continue;
    const atMs = toInstant(vote.updatedAt, parseInstant);
    if (atMs === null) continue;

    const choice = typeof vote.optionId === "string" ? vote.optionId : null;
    const current = latestByUser.get(vote.userId);
    if (!current || atMs > current.atMs) {
      latestByUser.set(vote.userId, { atMs, choices: new Set([choice]) });
    } else if (atMs === current.atMs) {
      current.choices.add(choice);
    }
  }

  const effective = new Map<string, string>();
  for (const [userId, latest] of latestByUser) {
    if (latest.choices.size !== 1) continue; // equal-time conflict
    const [choice] = latest.choices;
    if (choice !== null) effective.set(userId, choice);
  }
  return effective;
}

export function calculateTimeConsensus(
  input: TimeConsensusInput,
  parseInstant: ParseInstant,
): TimeConsensusResult {
  const options = collectValidOptions(input.options, input.nowMs, parseInstant);
  const choices = resolveEffectiveChoices(input, parseInstant);

  const tally = new Map<string, number>();
  for (const id of options.keys()) tally.set(id, 0);

  let voterCount = 0;
  for (const optionId of choices.values()) {
    // A vote for a missing, invalid or past option does not count and creates nothing.
    const count = tally.get(optionId);
    if (count === undefined) continue;
    tally.set(optionId, count + 1);
    voterCount += 1;
  }

  const counts = [...options.values()]
    .sort((a, b) => a.startMs - b.startMs || compareText(a.id, b.id))
    .map((option) => ({ optionId: option.id, count: tally.get(option.id) ?? 0 }));

  const topCount = counts.reduce((max, entry) => Math.max(max, entry.count), 0);
  const leaders = topCount > 0 ? counts.filter((entry) => entry.count === topCount) : [];

  return {
    counts,
    suggestedOptionId: leaders.length === 1 ? leaders[0].optionId : null,
    tiedOptionIds: leaders.length >= 2 ? leaders.map((entry) => entry.optionId) : [],
    voterCount,
  };
}

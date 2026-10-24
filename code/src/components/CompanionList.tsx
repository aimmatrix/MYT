import { useId, useMemo, useState } from "react";
import type { Activity, AvailabilityKey, InterestId, ParticipantSummary, Profile } from "../types";
import type { CompanionListProps } from "../ui-contract";
import { Button, Chip, Panel, cx } from "./ui";
import { ProfileAvatar } from "./ProfileAvatar";

/*
 * MYT companion list (S10). Answers "who might enjoy this with me?" from supplied props only.
 * Presentation only: no host, repository, presence or storage access, and no controls that change
 * anyone's state. Real participants and fictional demo profiles are separate groups with separate
 * counts. Fields a person has not shared are never inferred; they render a neutral fallback, or
 * nothing at all for availability.
 */

const REAL_LIMIT = 6;
const DEMO_LIMIT = 3;

const INTEREST_LABEL: Record<InterestId, string> = {
  football: "Football",
  karting: "Go-karting",
  cinema: "Cinema",
  music: "Music",
  social: "Social",
  fitness: "Fitness",
  comedy: "Comedy",
  theatre: "Theatre",
};

const AVAILABILITY_ORDER: AvailabilityKey[] = ["weekday-evening", "weekend-day", "weekend-evening"];

const AVAILABILITY_LABEL: Record<AvailabilityKey, string> = {
  "weekday-evening": "Weekday evening",
  "weekend-day": "Weekend day",
  "weekend-evening": "Weekend evening",
};

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** Known interest ids, de-duplicated. `null` means the person has not said (not "no interests"). */
function knownInterests(ids: readonly string[] | undefined): InterestId[] | null {
  if (!Array.isArray(ids)) return null;
  const out: InterestId[] = [];
  for (const id of ids) {
    if (has(INTEREST_LABEL, id) && !out.includes(id as InterestId)) out.push(id as InterestId);
  }
  return out;
}

function knownAvailability(keys: readonly string[] | undefined): AvailabilityKey[] | null {
  if (!Array.isArray(keys)) return null;
  const out: AvailabilityKey[] = [];
  for (const key of keys) {
    if (has(AVAILABILITY_LABEL, key) && !out.includes(key as AvailabilityKey)) out.push(key as AvailabilityKey);
  }
  return out;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

interface Companion {
  userId: string;
  name: string;
  university: string | null;
  interestIds: InterestId[] | null;
  availability: AvailabilityKey[] | null;
}

function fromSummary(person: ParticipantSummary): Companion | null {
  if (typeof person.userId !== "string" || person.userId === "") return null;
  return {
    userId: person.userId,
    name: text(person.displayName),
    university: text(person.university) || null,
    interestIds: knownInterests(person.interestIds),
    availability: knownAvailability(person.availability),
  };
}

function fromProfile(profile: Profile): Companion | null {
  return fromSummary({
    userId: profile.userId,
    displayName: profile.displayName,
    university: profile.university,
    interestIds: profile.interestIds,
    availability: profile.availability,
  });
}

function sharedWith(companion: Companion, mine: InterestId[]): InterestId[] {
  return companion.interestIds ? companion.interestIds.filter((id) => mine.includes(id)) : [];
}

function byOverlap(mine: InterestId[]) {
  return (a: Companion, b: Companion) => {
    const diff = sharedWith(b, mine).length - sharedWith(a, mine).length;
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
  };
}

/** Availability keys the activity actually offers, from its time options. */
function activityAvailability(activity: Activity): Set<AvailabilityKey> {
  const keys = new Set<AvailabilityKey>();
  for (const option of activity.timeOptions ?? []) {
    for (const key of option.availabilityKeys ?? []) keys.add(key);
  }
  return keys;
}

interface CompanionRowProps {
  companion: Companion;
  sample: boolean;
  mine: InterestId[];
  offered: Set<AvailabilityKey>;
  nameShared: boolean;
}

function CompanionRow({ companion, sample, mine, offered, nameShared }: CompanionRowProps) {
  const name = companion.name || "Unnamed participant";
  const shared = sharedWith(companion, mine);
  const compare = mine.length > 0;

  let interestLabel: string;
  let interestChips: InterestId[] = [];
  if (companion.interestIds === null) {
    interestLabel = "Interests not listed";
  } else if (compare) {
    interestChips = shared;
    interestLabel = shared.length > 0 ? "Shared interests" : "No shared interests listed";
  } else {
    interestChips = companion.interestIds;
    interestLabel = interestChips.length > 0 ? "Interests" : "No interests listed";
  }

  const relevantTimes =
    companion.availability === null ? [] : AVAILABILITY_ORDER.filter((key) => companion.availability?.includes(key) && offered.has(key));

  return (
    <li className={cx("myt-person", "myt-companion", sample && "myt-person--sample")}>
      <ProfileAvatar userId={companion.userId} displayName={companion.name} isDemo={sample} decorative />
      <div className="myt-person__text myt-stack myt-stack--xs">
        {sample ? (
          <div className="myt-badges">
            <Chip tone="warn">Demo profile</Chip>
            <Chip tone="warn">Fictional</Chip>
          </div>
        ) : null}
        <span className="myt-person__name">{name}</span>
        <span className="myt-person__meta">{companion.university ?? "University not shared"}</span>
        {nameShared ? <span className="myt-person__meta myt-subtle">Same name as another person in this list</span> : null}
        <div className="myt-cluster">
          <span className="myt-small myt-muted">{interestLabel}</span>
          {interestChips.map((id) => (
            <Chip key={id} tone={id}>
              {INTEREST_LABEL[id]}
            </Chip>
          ))}
        </div>
        {relevantTimes.length > 0 ? (
          <span className="myt-small myt-muted">
            Listed as available: {relevantTimes.map((key) => AVAILABILITY_LABEL[key]).join(", ")}
          </span>
        ) : null}
      </div>
    </li>
  );
}

interface GroupProps {
  title: string;
  count: string;
  note: string;
  items: Companion[];
  limit: number;
  expanded: boolean;
  onToggle: () => void;
  sample: boolean;
  mine: InterestId[];
  offered: Set<AvailabilityKey>;
  emptyText: string;
}

function CompanionGroup({ title, count, note, items, limit, expanded, onToggle, sample, mine, offered, emptyText }: GroupProps) {
  const headingId = useId();
  const listId = useId();
  const visible = expanded ? items : items.slice(0, limit);
  const hidden = items.length - limit;

  const nameCounts = new Map<string, number>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return (
    <div className="myt-stack myt-stack--sm">
      <div className="myt-stack myt-stack--xs">
        <h3 id={headingId} className="myt-heading myt-heading--small">
          {title} <span className="myt-count">· {count}</span>
        </h3>
        <p className="myt-small myt-muted">{note}</p>
      </div>
      {items.length === 0 ? (
        <p className="myt-small myt-muted">{emptyText}</p>
      ) : (
        <>
          <ul id={listId} className="myt-people" aria-labelledby={headingId}>
            {visible.map((companion) => (
              <CompanionRow
                key={companion.userId}
                companion={companion}
                sample={sample}
                mine={mine}
                offered={offered}
                nameShared={companion.name !== "" && (nameCounts.get(companion.name.toLowerCase()) ?? 0) > 1}
              />
            ))}
          </ul>
          {hidden > 0 ? (
            <div>
              <Button variant="quiet" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
                {expanded ? "Show fewer" : `Show ${hidden} more`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Suggested people for one activity. `realParticipants` are actual MYT users supplied by the parent
 * (the current user is left out, by user id). `sampleProfiles` are fictional and only those whose
 * interests include the activity's are shown. Real people win if a user id appears in both.
 */
export function CompanionList({ activity, currentProfile, realParticipants, sampleProfiles }: CompanionListProps) {
  const [open, setOpen] = useState({ activityId: activity.id, real: false, demo: false });
  const current = open.activityId === activity.id ? open : { activityId: activity.id, real: false, demo: false };

  const model = useMemo(() => {
    const mine = knownInterests(currentProfile?.interestIds) ?? [];
    const seen = new Set<string>();
    if (currentProfile?.userId) seen.add(currentProfile.userId);

    const real: Companion[] = [];
    for (const person of realParticipants) {
      const companion = fromSummary(person);
      if (!companion || seen.has(companion.userId)) continue;
      seen.add(companion.userId);
      real.push(companion);
    }

    const demo: Companion[] = [];
    for (const profile of sampleProfiles) {
      const companion = fromProfile(profile);
      if (!companion || seen.has(companion.userId)) continue;
      if (!companion.interestIds?.includes(activity.interestId)) continue;
      seen.add(companion.userId);
      demo.push(companion);
    }

    const order = byOverlap(mine);
    return { mine, real: real.sort(order), demo: demo.sort(order), offered: activityAvailability(activity) };
  }, [activity, currentProfile, realParticipants, sampleProfiles]);

  const realCount = model.real.length;
  const demoCount = model.demo.length;

  return (
    <Panel
      title="People you could go with"
      description="Based on the interests people chose to share. There is no match score."
    >
      {realCount === 0 && demoCount === 0 ? (
        <div className="myt-empty">
          <p className="myt-empty__title">No one to suggest yet</p>
          <p className="myt-empty__body">
            When other people join MYT and share their interests, they will show up here.
          </p>
        </div>
      ) : (
        <div className="myt-stack myt-stack--lg">
          <CompanionGroup
            title="Real participants"
            count={`${realCount} ${realCount === 1 ? "person" : "people"}`}
            note={currentProfile ? "Real MYT users, not counting you." : "Real MYT users."}
            items={model.real}
            limit={REAL_LIMIT}
            expanded={current.real}
            onToggle={() => setOpen({ ...current, real: !current.real })}
            sample={false}
            mine={model.mine}
            offered={model.offered}
            emptyText="No other real participants yet."
          />
          {demoCount > 0 ? (
            <CompanionGroup
              title="Demo profiles"
              count={`${demoCount} fictional ${demoCount === 1 ? "example" : "examples"}`}
              note="Made-up examples of who could appear here. They are not real people, are not online, and are not counted as interested or going."
              items={model.demo}
              limit={DEMO_LIMIT}
              expanded={current.demo}
              onToggle={() => setOpen({ ...current, demo: !current.demo })}
              sample
              mine={model.mine}
              offered={model.offered}
              emptyText=""
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ examples */

/*
 * Representative inputs for render checks and previews (G7, G8, S1). Every person here is invented:
 * the "real" ones use `preview:` ids and are only stand-ins for real participants.
 */

const exampleActivity: Activity = {
  schemaVersion: 1,
  id: "preview:go-karting",
  title: "Go-karting night",
  description: "",
  interestId: "karting",
  area: "South London",
  status: "available",
  timeOptions: [
    { id: "preview:sat-day", startAt: "2026-11-14T14:00:00Z", endAt: null, availabilityKeys: ["weekend-day"] },
    { id: "preview:sat-eve", startAt: "2026-11-14T19:00:00Z", endAt: null, availabilityKeys: ["weekend-evening"] },
  ],
  cost: { amountPence: null, currency: "GBP", isEstimate: true },
  source: { kind: "demo", url: null, checkedAt: null },
};

const exampleMe: Profile = {
  schemaVersion: 1,
  userId: "preview:me",
  displayName: "Alex Morgan",
  university: "University of Westminster",
  interestIds: ["karting", "football"],
  availability: ["weekend-day"],
  budgetPence: null,
  isDemo: false,
};

const exampleReal: ParticipantSummary[] = [
  { userId: "preview:me", displayName: "Alex Morgan", university: "University of Westminster" },
  {
    userId: "preview:ana",
    displayName: "Ana Costa",
    university: "Brunel University of London",
    interestIds: ["karting", "cinema"],
    availability: ["weekend-day", "weekday-evening"],
  },
  { userId: "preview:sam-1", displayName: "Sam", university: null },
  { userId: "preview:sam-2", displayName: "Sam", university: "Goldsmiths, University of London", interestIds: ["football"] },
  { userId: "preview:ivy", displayName: "Ivy Clarke", university: "", interestIds: ["cinema"], availability: ["weekend-evening"] },
  { userId: "preview:tom", displayName: "Tom Reid", university: "City St George's, University of London", interestIds: ["karting", "football"] },
  { userId: "preview:zoe", displayName: "Zoe Hart", university: "SOAS University of London", interestIds: [] },
  { userId: "preview:kai", displayName: "   ", university: "University of Greenwich", interestIds: ["karting"] },
];

const exampleSamples: Profile[] = [
  {
    schemaVersion: 1,
    userId: "sample:leo-mensah",
    displayName: "Leo Mensah",
    university: "University College London",
    interestIds: ["football", "karting"],
    availability: ["weekend-day"],
    budgetPence: null,
    isDemo: true,
  },
  {
    schemaVersion: 1,
    userId: "sample:priya-shah",
    displayName: "Priya Shah",
    university: "Queen Mary University of London",
    interestIds: ["cinema", "karting"],
    availability: ["weekday-evening", "weekend-evening"],
    budgetPence: null,
    isDemo: true,
  },
  {
    schemaVersion: 1,
    userId: "sample:noah-chen",
    displayName: "Noah Chen",
    university: "Imperial College London",
    interestIds: ["karting"],
    availability: ["weekend-day", "weekend-evening"],
    budgetPence: null,
    isDemo: true,
  },
  {
    schemaVersion: 1,
    userId: "sample:sana-khan",
    displayName: "Sana Khan",
    university: "",
    interestIds: ["karting", "cinema"],
    availability: [],
    budgetPence: null,
    isDemo: true,
  },
];

export const companionListExamples: Record<"empty" | "sampleOnly" | "realOnly" | "mixed", CompanionListProps> = {
  empty: { activity: exampleActivity, currentProfile: exampleMe, realParticipants: [], sampleProfiles: [] },
  sampleOnly: { activity: exampleActivity, currentProfile: exampleMe, realParticipants: [], sampleProfiles: exampleSamples },
  realOnly: { activity: exampleActivity, currentProfile: exampleMe, realParticipants: exampleReal, sampleProfiles: [] },
  mixed: { activity: exampleActivity, currentProfile: exampleMe, realParticipants: exampleReal, sampleProfiles: exampleSamples },
};

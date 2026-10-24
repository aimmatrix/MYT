import type { Activity, Profile } from "../types";

export const DEFAULT_PREVIEW_NOW_MS = Date.parse("2026-10-24T12:00:00Z");

export const PREVIEW_SCENARIOS = [
  { id: "first-time", label: "First-time onboarding", description: "An empty profile and a clear start." },
  { id: "discover", label: "Populated discover", description: "Relevant, labelled activity cards." },
  { id: "no-matches", label: "No matches", description: "Filters remove every suggestion." },
  { id: "activity", label: "Activity and companions", description: "Fictional example companions, no live peers." },
  { id: "loading", label: "Loading", description: "Catalog and profile are still loading." },
  { id: "failed-save", label: "Failed save", description: "An example save error with a recovery prompt." },
  { id: "confirmed-plan", label: "Confirmed plan", description: "An illustrative saved-plan layout." },
] as const;

export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number]["id"];

export const PREVIEW_USER: Profile = {
  schemaVersion: 1,
  userId: "preview:student",
  displayName: "Alex Morgan",
  university: "University College London",
  interestIds: ["cinema", "karting"],
  availability: ["weekday-evening", "weekend-day"],
  budgetPence: null,
  isDemo: true,
};

export const PREVIEW_COMPANIONS: Profile[] = [
  {
    schemaVersion: 1,
    userId: "sample:maya-rahman",
    displayName: "Maya Rahman",
    university: "King's College London",
    interestIds: ["football", "cinema"],
    availability: ["weekend-day", "weekday-evening"],
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
];

export interface PreviewActivityTemplate {
  id: string;
  title: string;
  description: string;
  interestId: Activity["interestId"];
  area: string;
  startsAfterDays: number;
  /** Extra hours after `startsAfterDays`, so the start falls in the window `availabilityKeys` names. */
  startsAfterHours?: number;
  availabilityKeys: Activity["timeOptions"][number]["availabilityKeys"];
  suggestedMeetingPoint: string;
}

export const PREVIEW_ACTIVITIES: PreviewActivityTemplate[] = [
  {
    id: "preview-cinema-night",
    title: "Choose a film together in central London",
    description: "Demo activity idea. Choose a time, then check a cinema's actual screenings and ticket prices.",
    interestId: "cinema",
    area: "Central London, cinema to choose",
    // The default preview clock is Saturday 12:00, so this lands on Thursday 19:00 London time.
    startsAfterDays: 5,
    startsAfterHours: 7,
    availabilityKeys: ["weekday-evening"],
    suggestedMeetingPoint: "The cinema foyer once a venue is chosen",
  },
  {
    id: "preview-karting",
    title: "Try indoor karting in East London",
    description: "Demo activity idea. Check a venue's availability and prices before booking.",
    interestId: "karting",
    area: "East London, venue to choose",
    startsAfterDays: 14,
    availabilityKeys: ["weekend-day"],
    suggestedMeetingPoint: "A public meeting point near the chosen venue",
  },
  {
    id: "preview-football",
    title: "Watch a football match together",
    description: "Demo activity idea. Confirm the fixture, tickets and meeting point independently.",
    interestId: "football",
    area: "London, venue to choose",
    startsAfterDays: 21,
    availabilityKeys: ["weekend-day"],
    suggestedMeetingPoint: "A public meeting point near the venue",
  },
];

export type FreeSlot = `${"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"}-${"day" | "eve"}`;
export interface RichPreferences {
 universityId?: string;
 yearOfStudy?: "1" | "2" | "3+" | "postgrad";
 freeSlots?: FreeSlot[];
 budgetBand?: "free" | "u15" | "u30" | "any";
}
export type InterestId = "football" | "karting" | "cinema" | "music" | "social" | "fitness" | "comedy" | "theatre";
export type AvailabilityKey = "weekday-evening" | "weekend-day" | "weekend-evening";
export type AppMode = "live" | "preview";

export interface Profile extends RichPreferences {
  schemaVersion: 1;
  userId: string;
  displayName: string;
  university: string;
  interestIds: InterestId[];
  availability: AvailabilityKey[];
  budgetPence: number | null;
  isDemo: boolean;
}

export interface TimeOption {
  id: string;
  startAt: string;
  endAt: string | null;
  availabilityKeys: AvailabilityKey[];
}

export interface Activity {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  interestId: InterestId;
  area: string;
  status: "available" | "unavailable";
  timeOptions: TimeOption[];
  cost: {
    amountPence: number | null;
    currency: "GBP";
    isEstimate: boolean;
  };
  source: {
    kind: "demo" | "verified" | "unverified";
    url: string | null;
    checkedAt: string | null;
  };
  suggestedMeetingPoint?: string | null;
}

export interface InterestRecord {
  schemaVersion: 1;
  activityId: string;
  userId: string;
  status: "interested" | "withdrawn";
  updatedAt: string;
}

export interface TimeVote {
  schemaVersion: 1;
  activityId: string;
  userId: string;
  optionId: string | null;
  updatedAt: string;
}

export interface Plan {
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

export interface Attendance {
  schemaVersion: 1;
  planId: string;
  userId: string;
  status: "going" | "declined";
  updatedAt: string;
}

export interface SessionConfig {
  schemaVersion: 1;
  organiserUserId: string | null;
}

export interface ActivityCatalog {
  schemaVersion: 1;
  items: Activity[];
}

export interface SampleProfileCatalog {
  schemaVersion: 1;
  items: Profile[];
}

export interface CurrentUser {
  id: string;
  name: string;
}

export type MytErrorCode =
  | "not-found"
  | "invalid-json"
  | "invalid-record"
  | "unsupported-schema"
  | "already-exists"
  | "id-invalid"
  | "not-signed-in"
  | "not-allowed"
  | "preview"
  | "io";

export interface MytError {
  code: MytErrorCode;
  message: string;
  path?: string;
}

export interface RecordIssue {
  path: string;
  code: MytErrorCode;
  message: string;
}

export type Loadable<T> =
  | { state: "loading" }
  | { state: "ready"; value: T; issues: RecordIssue[] }
  | { state: "error"; error: MytError };

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MytError };

export type CreatePlanResult =
  | { ok: true; kind: "created"; plan: Plan }
  | { ok: true; kind: "existing"; plan: Plan }
  | { ok: false; error: MytError };

export type ActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "saved"; at: string }
  | { status: "error"; error: MytError; retry: () => void };

export type Route =
  | { name: "welcome" }
  | { name: "discover" }
  | { name: "activity"; activityId: string }
  | { name: "confirm"; activityId: string }
  | { name: "plans" }
  | { name: "plan"; planId: string }
  | { name: "setup" }
  | { name: "meet" }
  | { name: "requests" }
  | { name: "chats" }
  | { name: "chat"; chatId: string };

export interface ProfileInput extends RichPreferences {
  displayName: string;
  university: string;
  interestIds: InterestId[];
  availability: AvailabilityKey[];
  budgetPence: number | null;
}

export interface ConfirmPlanInput {
  activityId: string;
  optionId: string;
  meetingPoint: string;
}

export interface ActivityFilters {
  interestIds: InterestId[];
  availability: AvailabilityKey[];
}

export interface RankedActivity {
  activity: Activity;
  reasonCodes: string[];
  reasons: string[];
  nextOptionId: string | null;
  nextStartAt: string | null;
}

export interface TimeConsensus {
  counts: Array<{ optionId: string; count: number }>;
  suggestedOptionId: string | null;
  tiedOptionIds: string[];
  voterCount: number;
}

export type PlanCreationDecision =
  | { allowed: true; chosenOptionId: string; startAt: string; endAt: string | null; meetingPoint: string }
  | { allowed: false; code: string; message: string; existingPlanId?: string };

export interface ParticipantSummary {
  userId: string;
  displayName: string;
  university: string | null;
  interestIds?: InterestId[];
  availability?: AvailabilityKey[];
}

export interface PresenceViewer {
  userId: string;
  name: string;
}

export interface ActivityPresence {
  connected: boolean;
  viewers: PresenceViewer[];
  onlineUserIds?: string[];
  typingUsers?: Array<{userId:string;name:string;chatId:string}>;
}

export interface PresencePayload {
  v: 1;
  screen: Route["name"];
  activityId: string | null;
  typingIn?: string | null;
}

export interface FriendRequest { schemaVersion: 1; fromId: string; toId: string; status: "pending" | "cancelled"; createdAt: string }
export interface FriendResponse { schemaVersion: 1; fromId: string; toId: string; status: "accepted" | "declined" | "undone"; respondedAt: string }
export interface MeetState { schemaVersion: 1; userId: string; passedIds: string[]; updatedAt: string }
export interface BlockState { schemaVersion: 1; userId: string; blockedIds: string[]; updatedAt: string }
export interface ChatPoll { question: string; options: { id: string; label: string }[]; multi: boolean; anonymous: boolean }
export type ChatMessage = { schemaVersion: 1; id: string; chatId: string; authorId: string; createdAt: string } & ({kind: "text"; text: string} | {kind: "poll"; poll: ChatPoll});
export interface ChatRead { schemaVersion: 1; chatId: string; userId: string; lastReadAt: string }
export interface PollVote { schemaVersion: 1; chatId: string; messageId: string; voterId: string; optionIds: string[]; updatedAt: string }
export interface SocialData { requests: FriendRequest[]; responses: FriendResponse[]; passedIds: string[]; blockedIds: string[]; messages: ChatMessage[]; reads: ChatRead[]; votes: PollVote[] }

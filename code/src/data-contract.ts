import type { SocialRepository } from "./data/socialRepository";
import type { SocialData } from "./types";
import type {
  ActionResult,
  ActivityCatalog,
  AppMode,
  Attendance,
  ConfirmPlanInput,
  CreatePlanResult,
  CurrentUser,
  InterestRecord,
  Loadable,
  Plan,
  Profile,
  ProfileInput,
  RecordIssue,
  SampleProfileCatalog,
  SessionConfig,
  TimeVote,
} from "./types";

export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "folder";
}

export interface FileChange {
  type: "created" | "changed" | "deleted";
  path: string;
}

export interface MytFilePort {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string, options: { overwrite: boolean }): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
  watch(path: string, listener: (change: FileChange) => void): () => void;
}

export interface ReadValue<T> {
  value: T;
  issues: RecordIssue[];
}

export type ReadResult<T> = ActionResult<ReadValue<T>>;

export interface MytRepository {
  loadActivities(): Promise<ReadResult<ActivityCatalog>>;
  loadSamples(): Promise<ReadResult<SampleProfileCatalog>>;
  loadSession(): Promise<ReadResult<SessionConfig>>;
  loadMyProfile(): Promise<ReadResult<Profile | null>>;
  loadRealProfiles(): Promise<ReadResult<Record<string, Profile>>>;
  loadInterests(activityId: string): Promise<ReadResult<InterestRecord[]>>;
  loadVotes(activityId: string): Promise<ReadResult<TimeVote[]>>;
  loadPlans(): Promise<ReadResult<Record<string, Plan>>>;
  loadAttendance(planId: string): Promise<ReadResult<Attendance[]>>;
  saveProfile(input: ProfileInput): Promise<ActionResult<Profile>>;
  setInterest(activityId: string, status: InterestRecord["status"]): Promise<ActionResult<InterestRecord>>;
  setVote(activityId: string, optionId: string | null): Promise<ActionResult<TimeVote>>;
  claimOrganiser(input: { replace: boolean }): Promise<ActionResult<SessionConfig>>;
  confirmPlan(input: ConfirmPlanInput): Promise<CreatePlanResult>;
  setAttendance(planId: string, status: Attendance["status"]): Promise<ActionResult<Attendance>>;
}

export interface MytActions {
  saveProfile(input: ProfileInput): Promise<ActionResult<Profile>>;
  setInterest(activityId: string, status: InterestRecord["status"]): Promise<ActionResult<InterestRecord>>;
  setVote(activityId: string, optionId: string | null): Promise<ActionResult<TimeVote>>;
  claimOrganiser(input: { replace: boolean }): Promise<ActionResult<SessionConfig>>;
  confirmPlan(input: ConfirmPlanInput): Promise<CreatePlanResult>;
  setAttendance(planId: string, status: Attendance["status"]): Promise<ActionResult<Attendance>>;
}

export interface UseMytDataInput {
  socialRepository?: SocialRepository;
  repository: MytRepository;
  files: MytFilePort;
  mode: AppMode;
  currentUser: CurrentUser | null;
  activityId: string | null;
  planId: string | null;
}

export interface MytViewModel {
  social?: Loadable<SocialData>;
  socialActions?: SocialRepository | null;
  mode: AppMode;
  currentUser: CurrentUser | null;
  activities: Loadable<ActivityCatalog>;
  samples: Loadable<SampleProfileCatalog>;
  session: Loadable<SessionConfig>;
  myProfile: Loadable<Profile | null>;
  realProfiles: Loadable<Record<string, Profile>>;
  interestsByActivity: Loadable<Record<string, InterestRecord[]>>;
  votesByActivity: Loadable<Record<string, TimeVote[]>>;
  plansById: Loadable<Record<string, Plan>>;
  attendanceByPlan: Loadable<Record<string, Attendance[]>>;
  issues: RecordIssue[];
  actions: MytActions | null;
}

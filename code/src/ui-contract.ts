import type {
  ActionResult,
  ActionState,
  Activity,
  ActivityFilters,
  ActivityPresence,
  AppMode,
  Attendance,
  ConfirmPlanInput,
  CreatePlanResult,
  CurrentUser,
  Loadable,
  ParticipantSummary,
  Plan,
  PlanCreationDecision,
  Profile,
  ProfileInput,
  RankedActivity,
  Route,
  TimeConsensus,
  TimeOption,
  TimeVote,
} from "./types";

export interface ScreenContext {
  mode: AppMode;
  currentUser: CurrentUser | null;
  onNavigate: (route: Route) => void;
}

export interface OnboardingProps extends ScreenContext {
  profile: Loadable<Profile | null>;
  saveState: ActionState;
  onSave?: (input: ProfileInput) => Promise<ActionResult<Profile>>;
  onEnterPreview?: () => void;
  onExitPreview?: () => void;
}

export interface DiscoverProps extends ScreenContext {
  aiProfile?: Profile | null;
  aiInterestedActivityIds?: string[];
  greetingName: string | null;
  rankedActivities: Loadable<RankedActivity[]>;
  filters: ActivityFilters;
  interestedCounts: Record<string, number>;
  onFiltersChange: (filters: ActivityFilters) => void;
  onOpenActivity: (activityId: string) => void;
  onOpenPlans: () => void;
}

export interface InterestPanelProps {
  mode: AppMode;
  currentUser: CurrentUser | null;
  activityId: string;
  activityAvailable: boolean;
  planExists: boolean;
  interest: Loadable<"interested" | "withdrawn" | null>;
  interestedPeople: Loadable<ParticipantSummary[]>;
  actionState: ActionState;
  onSetInterest?: (status: "interested" | "withdrawn") => Promise<ActionResult<unknown>>;
  onExitPreview?: () => void;
}

export interface TimeVotePanelProps {
  mode: AppMode;
  currentUser: CurrentUser | null;
  activityId: string;
  options: TimeOption[];
  validFutureOptionIds: ReadonlySet<string>;
  myInterest: Loadable<"interested" | "withdrawn" | null>;
  myVote: Loadable<TimeVote | null>;
  consensus: Loadable<TimeConsensus>;
  planExists: boolean;
  actionState: ActionState;
  onSetVote?: (optionId: string | null) => Promise<ActionResult<unknown>>;
  onGoToInterest: () => void;
}

export interface CompanionListProps {
  activity: Activity;
  currentProfile: Profile | null;
  realParticipants: ParticipantSummary[];
  sampleProfiles: Profile[];
}

export interface PresenceStripProps {
  presence: ActivityPresence;
  mode: AppMode;
  currentUser: CurrentUser | null;
}

export interface ActivityDetailProps extends ScreenContext {
  onOpenChat?: () => void;
  activity: Loadable<Activity | null>;
  plan: Loadable<Plan | null>;
  interestPanel: InterestPanelProps;
  timeVotePanel: TimeVotePanelProps;
  companionList: CompanionListProps;
  presenceStrip: PresenceStripProps;
  confirmationEntry: { allowed: boolean; reason: string | null };
  onOpenConfirmation: () => void;
  onOpenPlan: (planId: string) => void;
  onBack: () => void;
}

export interface ConfirmPlanProps extends ScreenContext {
  activity: Loadable<Activity | null>;
  existingPlan: Loadable<Plan | null>;
  interestedPeople: Loadable<ParticipantSummary[]>;
  organiserUserId: string | null;
  consensus: Loadable<TimeConsensus>;
  initialOptionId: string | null;
  evaluateDraft: (optionId: string | null, meetingPoint: string) => PlanCreationDecision;
  confirmState: ActionState;
  onConfirm?: (input: ConfirmPlanInput) => Promise<CreatePlanResult>;
  onOpenPlan: (planId: string) => void;
  onBack: () => void;
}

export interface PlanCard {
  plan: Plan;
  activity: Activity | null;
  myAttendance: Attendance["status"] | null;
  goingCount: number;
}

export interface MyPlansProps extends ScreenContext {
  plans: Loadable<PlanCard[]>;
  onOpenPlan: (planId: string) => void;
  onDiscover: () => void;
}

export interface PlanSummaryProps extends ScreenContext {
  plan: Loadable<Plan | null>;
  activity: Activity | null;
  organiser: ParticipantSummary | null;
  goingPeople: Loadable<ParticipantSummary[]>;
  myAttendance: Loadable<Attendance["status"] | null>;
  attendanceState: ActionState;
  onSetAttendance?: (status: "going" | "declined") => Promise<ActionResult<unknown>>;
  onBackToPlans: () => void;
}

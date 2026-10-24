import type { MytFilePort, MytRepository } from "../data-contract";
import type {
  ActivityCatalog,
  Attendance,
  CurrentUser,
  InterestRecord,
  Plan,
  Profile,
  SampleProfileCatalog,
  SessionConfig,
  TimeVote,
} from "../types";
import { createMytRepository, type RepositoryDependencies } from "../data/repository";
import { isValidId, planIdForActivity } from "../domain/identifiers";
import { parseInstant } from "../domain/londonTime";
import { decodeRecord, type DecoderDependencies } from "../domain/validation";

/*
 * S1 wiring: connects T1's decoder, T3's identifiers and C2's parser to G2's repository.
 * No casts: each record kind gets its own typed decoder, so the kind-to-result correlation is
 * checked by the compiler rather than asserted.
 */

interface RecordMap {
  activityCatalog: ActivityCatalog;
  sampleProfileCatalog: SampleProfileCatalog;
  session: SessionConfig;
  profile: Profile;
  interest: InterestRecord;
  vote: TimeVote;
  plan: Plan;
  attendance: Attendance;
}

type RecordKind = keyof RecordMap;
type Decoded<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid-json" | "invalid-record" | "unsupported-schema"; issues: ReadonlyArray<{ path: string; reason: string }> };

const decoderDependencies: DecoderDependencies = { parseInstant, isValidId };

const decoders: { [K in RecordKind]: (text: string) => Decoded<RecordMap[K]> } = {
  activityCatalog: (text) => decodeRecord("activityCatalog", text, decoderDependencies),
  sampleProfileCatalog: (text) => decodeRecord("sampleProfileCatalog", text, decoderDependencies),
  session: (text) => decodeRecord("session", text, decoderDependencies),
  profile: (text) => decodeRecord("profile", text, decoderDependencies),
  interest: (text) => decodeRecord("interest", text, decoderDependencies),
  vote: (text) => decodeRecord("vote", text, decoderDependencies),
  plan: (text) => decodeRecord("plan", text, decoderDependencies),
  attendance: (text) => decodeRecord("attendance", text, decoderDependencies),
};

const repositoryDependencies: RepositoryDependencies = {
  decodeRecord: <K extends RecordKind>(kind: K, text: string): Decoded<RecordMap[K]> => decoders[kind](text),
  isValidId,
  planIdForActivity,
  parseInstant,
};

export function createAppRepository(files: MytFilePort, currentUser: CurrentUser | null): MytRepository {
  return createMytRepository(files, currentUser, repositoryDependencies);
}

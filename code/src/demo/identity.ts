import type { FreeSlot, InterestId } from "../types";
/*
 * Demo mode: one simulated participant who acts through ordinary shared files.
 *
 * The ID deliberately avoids the "sample:" and "preview:" prefixes, so every real-user check in the
 * app (realId, isRealUserId) accepts it and Alex counts exactly like a second signed-in person.
 * Every screen labels it through the display name, which always says "(demo)".
 */
export const DEMO_PARTNER_ID = "demo-partner-alex";
export const DEMO_PARTNER_NAME = "Alex (demo)";
export const DEMO_PARTNER_SHORT = "Alex";

/*
 * The demo cast: extra simulated students who appear in Meet so a solo presenter has people to swipe
 * on. Like Alex they are ordinary real-looking profiles written to shared files, labelled "(demo)",
 * and removed by Reset demo.
 */
export interface DemoCastMember {
  id: string;
  name: string;
  university: string;
  universityId: string;
  yearOfStudy: "1" | "2" | "3+" | "postgrad";
  interestIds: InterestId[];
  freeSlots: FreeSlot[];
  budgetBand: "free" | "u15" | "u30" | "any";
}

export const DEMO_CAST: readonly DemoCastMember[] = [
  { id: "demo-cast-priya", name: "Priya (demo)", university: "King's College London", universityId: "kcl", yearOfStudy: "2", interestIds: ["cinema", "comedy", "social"], freeSlots: ["thu-eve", "fri-eve", "sat-eve"], budgetBand: "u15" },
  { id: "demo-cast-jamal", name: "Jamal (demo)", university: "Queen Mary University of London", universityId: "qm", yearOfStudy: "1", interestIds: ["football", "fitness", "karting"], freeSlots: ["wed-eve", "sat-day", "sun-day"], budgetBand: "u30" },
  { id: "demo-cast-sofia", name: "Sofia (demo)", university: "University College London", universityId: "ucl", yearOfStudy: "3+", interestIds: ["music", "theatre", "social"], freeSlots: ["fri-eve", "sat-eve", "sun-day"], budgetBand: "any" },
  { id: "demo-cast-ben", name: "Ben (demo)", university: "Imperial College London", universityId: "icl", yearOfStudy: "postgrad", interestIds: ["karting", "football", "cinema"], freeSlots: ["tue-eve", "sat-day", "sat-eve"], budgetBand: "u30" },
  { id: "demo-cast-amara", name: "Amara (demo)", university: "Goldsmiths, University of London", universityId: "gold", yearOfStudy: "2", interestIds: ["comedy", "music", "fitness"], freeSlots: ["mon-eve", "thu-eve", "sun-day"], budgetBand: "free" },
  { id: "demo-cast-leo", name: "Leo (demo)", university: "Middlesex University", universityId: "mdx", yearOfStudy: "1", interestIds: ["football", "social", "cinema"], freeSlots: ["fri-eve", "sat-day", "sun-eve"], budgetBand: "u15" },
];

/** Every simulated person Demo mode can write as. */
export const DEMO_IDS: readonly string[] = [DEMO_PARTNER_ID, ...DEMO_CAST.map((m) => m.id)];

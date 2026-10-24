import type { AvailabilityKey, FreeSlot, ProfileInput } from "../types";
export const UNIVERSITIES = [
 {id:"mdx",name:"Middlesex University"}, {id:"kcl",name:"King's College London"}, {id:"ucl",name:"University College London"},
 {id:"icl",name:"Imperial College London"}, {id:"qm",name:"Queen Mary University of London"}, {id:"gold",name:"Goldsmiths, University of London"},
 {id:"lse",name:"London School of Economics"}, {id:"other",name:"Other"},
] as const;
export const DAYS = ["mon","tue","wed","thu","fri","sat","sun"] as const;
export const FREE_SLOTS: readonly FreeSlot[] = DAYS.flatMap(d => [`${d}-day`,`${d}-eve`] as const);
export function availabilityFromSlots(slots: readonly FreeSlot[]): AvailabilityKey[] {
 const keys = new Set<AvailabilityKey>();
 for (const slot of slots) {
  if (slot.startsWith("sat") || slot.startsWith("sun")) keys.add(slot.endsWith("day") ? "weekend-day" : "weekend-evening");
  else if (slot.endsWith("eve")) keys.add("weekday-evening");
 }
 return [...keys];
}
export function profilePreferences(input: ProfileInput): ProfileInput {
 return {...input, availability: input.freeSlots ? availabilityFromSlots(input.freeSlots) : input.availability,
 budgetPence: input.budgetBand ? ({free:0,u15:1500,u30:3000,any:null})[input.budgetBand] : input.budgetPence};
}

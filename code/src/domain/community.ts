import type { Activity } from '../types';
export type CommunityEvent = {kind:'event';id:string;title:string;location:string;startsAt:string;price:number;description:string;hostId:string;hostName:string};
export type CommunityRsvp = {kind:'rsvp';eventId:string;userId:string;name:string;going:boolean};
export type CommunityRecord = CommunityEvent | CommunityRsvp;
export const communityPath = (record:CommunityRecord) => {
 const key=(value:string)=>Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('');
 return record.kind==='event'?`data/community/event-${key(record.id)}.json`:`data/community/rsvp-${key(record.eventId)}-${key(record.userId)}.json`;
};
export function communityActivity(event:CommunityEvent):Activity {
 const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short'}).format(new Date(event.startsAt));
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',hourCycle:'h23'}).format(new Date(event.startsAt)));
 const weekend=day==='Sat'||day==='Sun';
 return {schemaVersion:1,id:`community:${event.id}`,title:event.title,description:event.description,area:event.location,
  interestId:/football|pitch|five.a.side/i.test(event.title)?'football':/cinema|film/i.test(event.title)?'cinema':/gig|music/i.test(event.title)?'music':'social',status:'available',
  timeOptions:[{id:'community-time',startAt:event.startsAt,endAt:null,availabilityKeys:weekend?[hour>=17?'weekend-evening':'weekend-day']:hour>=17?['weekday-evening']:[]}],
  cost:{amountPence:Math.round(event.price*100),currency:'GBP',isEstimate:false},source:{kind:'demo',url:null,checkedAt:null},suggestedMeetingPoint:event.location};
}

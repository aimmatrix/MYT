import type { Profile, RankedActivity, ChatPoll } from '../types';
import { aiRequest as request } from '../host';
export interface AiRecommendation { activityId: string; reason: string }
export const recommendEvents = (profile: Profile | null, items: RankedActivity[], interestedActivityIds: string[], signal?: AbortSignal) => request<{ recommendations: AiRecommendation[] }>('recommendations', {
  profile: profile ? { interestIds: profile.interestIds, availability: profile.availability, freeSlots: profile.freeSlots, budgetPence: profile.budgetPence } : {},
  activityIds: items.slice(0, 60).map(x => x.activity.id), interestedActivityIds,
}, signal);
export interface AiConversationContext {memberIds?:string[];chatType?:'private'|'group';activity?:{title:string;description:string;area:string;startAt?:string;costPence:number|null;hostName?:string;viewerIsHost?:boolean};trigger?:string}
export const simulateChat = (messages: { authorId: string; text: string }[], signal?: AbortSignal, context?:AiConversationContext) => request<{ messages: { authorId: string; text: string }[] }>('chat', { messages, ...context }, signal);

export interface AiPollVote { voterId: string; optionIds: string[] }
export const simulatePollVotes = (poll: ChatPoll, messages: {authorId:string;text:string}[], signal?: AbortSignal, context?:AiConversationContext) => request<{votes:AiPollVote[]}>('poll-votes', {poll,messages,...context}, signal);

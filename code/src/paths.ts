import { keyForId, planIdForActivity } from "./domain/identifiers";

export const DATA_ROOT = "data";
export const ACTIVITIES_PATH = "data/activities.json";
export const SAMPLE_PROFILES_PATH = "data/sample-profiles.json";
export const SESSION_PATH = "data/session.json";
export const PROFILES_DIR = "data/profiles";
export const INTERESTS_DIR = "data/interests";
export const VOTES_DIR = "data/votes";
export const PLANS_DIR = "data/plans";
export const ATTENDANCE_DIR = "data/attendance";

export function profilePath(userId: string): string {
  return `${PROFILES_DIR}/${keyForId(userId)}.json`;
}

export function interestFolderPath(activityId: string): string {
  return `${INTERESTS_DIR}/${keyForId(activityId)}`;
}

export function interestPath(activityId: string, userId: string): string {
  return `${interestFolderPath(activityId)}/${keyForId(userId)}.json`;
}

export function voteFolderPath(activityId: string): string {
  return `${VOTES_DIR}/${keyForId(activityId)}`;
}

export function votePath(activityId: string, userId: string): string {
  return `${voteFolderPath(activityId)}/${keyForId(userId)}.json`;
}

export function planPathForActivity(activityId: string): string {
  return planPath(planIdForActivity(activityId));
}

export function planPath(planId: string): string {
  return `${PLANS_DIR}/${keyForId(planId)}.json`;
}

export function attendanceFolderPath(planId: string): string {
  return `${ATTENDANCE_DIR}/${keyForId(planId)}`;
}

export function attendancePath(planId: string, userId: string): string {
  return `${attendanceFolderPath(planId)}/${keyForId(userId)}.json`;
}

export const FRIENDS_DIR = "data/friends";
export const CHATS_DIR = "data/chats";
export const friendRequestPath = (fromId: string, toId: string) => `${FRIENDS_DIR}/requests/${keyForId(fromId)}/${keyForId(toId)}.json`;
export const friendResponsePath = (toId: string, fromId: string) => `${FRIENDS_DIR}/responses/${keyForId(toId)}/${keyForId(fromId)}.json`;
export const meetPath = (userId: string) => `data/meet/${keyForId(userId)}.json`;
export const blocksPath = (userId: string) => `data/blocks/${keyForId(userId)}.json`;
export const chatFolderPath = (chatId: string) => `${CHATS_DIR}/${keyForId(chatId)}`;
export const messagePath = (chatId: string, authorId: string, messageId: string) => `${chatFolderPath(chatId)}/messages/${keyForId(authorId)}/${keyForId(messageId)}.json`;
export const chatReadPath = (chatId: string, userId: string) => `${chatFolderPath(chatId)}/read/${keyForId(userId)}.json`;
export const pollVotePath = (chatId: string, messageId: string, voterId: string) => `${chatFolderPath(chatId)}/polls/${keyForId(messageId)}/${keyForId(voterId)}.json`;

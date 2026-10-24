import { useEffect, useMemo } from "react";
import { useConnected, usePeers, useSetPresence } from "../host";
import { isValidId } from "../domain/identifiers";
import type {
  ActivityPresence,
  CurrentUser,
  PresencePayload,
  PresenceViewer,
  Route,
} from "../types";

export const MYT_PRESENCE_ROOM = "myt-v1";

const routeNames: ReadonlySet<Route["name"]> = new Set([
  "welcome",
  "discover",
  "activity",
  "confirm",
  "plans",
  "plan",
  "setup", "meet", "requests", "chats", "chat",
]);

interface PresencePeer {
  user: { id: string; name: string | null };
  presence: unknown;
}

function isPresencePayload(value: unknown): value is PresencePayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.v !== 1 || !routeNames.has(payload.screen as Route["name"])) return false;
  if (payload.screen === "activity" || payload.screen === "confirm") {
    return isValidId(payload.activityId);
  }
  return payload.activityId === null;
}

export function selectActivityViewers(
  peers: readonly PresencePeer[],
  activityId: string,
  currentUserId: string | null
): PresenceViewer[] {
  const viewers = new Map<string, PresenceViewer>();
  for (const peer of peers) {
    if (!isValidId(peer.user?.id)) continue;
    if (peer.user.id === currentUserId || peer.user.id.startsWith("sample:") || peer.user.id.startsWith("preview:")) continue;
    if (!isPresencePayload(peer.presence)) continue;
    if (peer.presence.screen !== "activity" || peer.presence.activityId !== activityId) continue;
    const name = peer.user.name?.trim() || "Another student";
    const previous = viewers.get(peer.user.id);
    if (!previous || (previous.name === "Another student" && name !== "Another student")) {
      viewers.set(peer.user.id, { userId: peer.user.id, name });
    }
  }
  return [...viewers.values()].sort((first, second) =>
    first.name.localeCompare(second.name) || first.userId.localeCompare(second.userId)
  );
}

export function useActivityPresence(
  route: Route,
  currentUser: CurrentUser | null,
  typingIn: string | null = null
): ActivityPresence {
  const connected = useConnected(MYT_PRESENCE_ROOM);
  const peers = usePeers<unknown>(MYT_PRESENCE_ROOM);
  const setPresence = useSetPresence<PresencePayload>(MYT_PRESENCE_ROOM);
  const activityId = route.name === "activity" || route.name === "confirm" ? route.activityId : null;

  useEffect(() => {
    setPresence({ v: 1, screen: route.name, activityId, typingIn });
    return () => setPresence(null);
  }, [route.name, activityId, typingIn, setPresence]);

  const viewers = useMemo(
    () =>
      connected && route.name === "activity" && activityId
        ? selectActivityViewers(peers, activityId, currentUser?.id ?? null)
        : [],
    [connected, route.name, activityId, peers, currentUser?.id]
  );

  const validPeers = connected ? peers.filter(peer => peer.user.id !== currentUser?.id && !peer.user.id.startsWith("sample:") && !peer.user.id.startsWith("preview:") && isPresencePayload(peer.presence)) : [];
  const onlineUserIds = [...new Set(validPeers.map(peer=>peer.user.id))];
  if (connected && currentUser) onlineUserIds.push(currentUser.id);
  const typingUsers = validPeers.flatMap(peer => isPresencePayload(peer.presence) && typeof peer.presence.typingIn === "string" && isValidId(peer.presence.typingIn) ? [{userId:peer.user.id,name:peer.user.name??"Student",chatId:peer.presence.typingIn}] : []);
  return { connected, viewers, onlineUserIds, typingUsers: [...new Map(typingUsers.map(u=>[u.userId,u])).values()] };
}

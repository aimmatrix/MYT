import type { PresenceStripProps } from "../ui-contract";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || "S").toUpperCase();
}

export function PresenceStrip({ presence, mode, currentUser }: PresenceStripProps) {
  if (mode === "preview") {
    return <div className="myt-presence" role="status">Live viewers are unavailable in preview.</div>;
  }

  if (!presence.connected) {
    return <div className="myt-presence" role="status">Live viewers are unavailable right now.</div>;
  }

  const others = presence.viewers.filter((viewer) => viewer.userId !== currentUser?.id);
  const selfLabel = currentUser ? "You" : null;

  return (
    <div className="myt-presence" role="status">
      <span aria-hidden="true">●</span>
      {others.length === 0 ? (
        <span>{selfLabel ? "You're viewing this activity. No one else is here right now." : "No one is viewing this activity right now."}</span>
      ) : (
        <>
          <span>{selfLabel ? `You and ${others.length} ${others.length === 1 ? "other person are" : "other people are"} viewing this activity:` : `${others.length} ${others.length === 1 ? "person is" : "people are"} viewing this activity:`}</span>
          <span className="myt-avatar-row">
            {others.map((viewer) => (
              <span key={viewer.userId} className="myt-person">
                <span className="myt-avatar myt-avatar--sm" aria-hidden="true">{initials(viewer.name)}</span>
                <span className="myt-person__name">{viewer.name}</span>
              </span>
            ))}
          </span>
        </>
      )}
    </div>
  );
}

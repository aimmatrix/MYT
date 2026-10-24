import { useEffect, useState } from "react";
import type { MytFilePort } from "../data-contract";
import { Panel } from "./ui";

interface Status { provider: string; label: string; state: "ok" | "error" | "needs-key" | "needs-events"; count: number; checkedAt: string }

/** Status contains no credentials; only the local importer can make provider requests. */
export function SourceStatus({ files }: { files: MytFilePort }) {
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data: unknown = JSON.parse(await files.readText("data/source-status.json"));
        if (!data || typeof data !== "object" || !("providers" in data) || !Array.isArray(data.providers)) throw new Error();
        const rows = data.providers.filter((row): row is Status => row && typeof row.provider === "string"
          && typeof row.label === "string" && ["ok", "error", "needs-key", "needs-events"].includes(row.state)
          && Number.isInteger(row.count) && row.count >= 0 && typeof row.checkedAt === "string");
        if (active) setStatuses(rows);
      } catch { if (active) setStatuses(null); }
    }
    void load();
    let stop: (() => void) | undefined;
    try { stop = files.watch("data", change => { if (change.path === "data/source-status.json") void load(); }); } catch { /* reopen to refresh */ }
    return () => { active = false; stop?.(); };
  }, [files]);
  return (
    <Panel title="Activity sources">
      {statuses ? <ul>{statuses.map(row => <li key={row.provider}>
        <strong>{row.label}</strong>: {row.state === "ok" ? `${row.count} listings fetched`
          : row.state === "needs-key" ? "Waiting for API credentials"
          : row.state === "needs-events" ? "Connected; add public Eventbrite event links to import" : "Last refresh failed; existing activities kept"}
        {row.state === "ok" ? <> · <time dateTime={row.checkedAt}>{new Date(row.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</time></> : null}
      </li>)}</ul> : <p>No source refresh report is available yet.</p>}
      <p className="myt-muted myt-small">Listings are snapshots from the last refresh. Check the source before booking. Venue and film suggestions need a confirmed session time.</p>
      <p className="myt-small">Venue data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>. Film data, when enabled: <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </Panel>
  );
}

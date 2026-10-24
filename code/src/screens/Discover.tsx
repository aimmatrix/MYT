import { useEffect, useState, useRef } from "react";
import type { ActivityFilters, AvailabilityKey, InterestId, RankedActivity, Profile } from "../types";
import type { DiscoverProps } from "../ui-contract";
import { recommendEvents, type AiRecommendation } from "../ai/client";
import { getSourcePresentation } from "../domain/sourcePresentation";
import { ActivityMark, Button, Chip, ChipGroup, SectionHeader, Field, type Tone } from "../components/ui";

/*
 * Discover (S4). Prop-driven: it reads nothing, writes nothing and owns no state beyond a focus ref.
 * Ranking, filtering and reason strings come from G4 through `rankedActivities`; the list is rendered
 * in the order it arrives and is never re-filtered here. Viewer (presence) counts are deliberately
 * absent from feed cards: presence is only joined for the open activity.
 */

const INTERESTS: ReadonlyArray<{ id: InterestId; label: string }> = [
  { id: "football", label: "Football" },
  { id: "karting", label: "Go-karting" },
  { id: "cinema", label: "Cinema" },
  { id: "music", label: "Music" },
  { id: "social", label: "Social" },
  { id: "fitness", label: "Fitness" },
  { id: "comedy", label: "Comedy" },
  { id: "theatre", label: "Theatre" },
];

const AVAILABILITY: ReadonlyArray<{ key: AvailabilityKey; label: string }> = [
  { key: "weekday-evening", label: "Weekday evenings" },
  { key: "weekend-day", label: "Weekend days" },
  { key: "weekend-evening", label: "Weekend evenings" },
];

const MAX_REASONS = 3;

function interestMeta(id: string): { id: InterestId; label: string } | null {
  return INTERESTS.find((item) => item.id === id) ?? null;
}

/*
 * Display helpers. C1 (source labels), C2 (London time) and C3 (cost) are not integrated yet, so these
 * are minimal stand-ins for presentation only. When those modules are imported, S1 should replace
 * `sourceLabel`, `formatWhen`, `formatCheckedDate` and `formatCost` with them (see Handoffs/S4.md).
 */

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function toDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function londonParts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour12: false, ...options }).formatToParts(date);
    const out: Record<string, string> = {};
    for (const part of parts) out[part.type] = part.value;
    return out;
  } catch {
    return null;
  }
}

function formatWhen(value: string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  const p = londonParts(date, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (!p) return null;
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

function formatCheckedDate(value: string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  const p = londonParts(date, { day: "numeric", month: "short", year: "numeric" });
  return p ? `${p.day} ${p.month} ${p.year}` : null;
}

function formatCost(cost: { amountPence: number | null; isEstimate: boolean } | null | undefined): string {
  const pence = cost?.amountPence;
  if (typeof pence !== "number" || !Number.isInteger(pence) || pence < 0) return "Price not listed";
  if (pence === 0) return cost?.isEstimate ? "Probably free (estimate)" : "Free";
  const pounds = pence / 100;
  const text = `£${Number.isInteger(pounds) ? pounds.toString() : pounds.toFixed(2)}`;
  return cost?.isEstimate ? `About ${text} (estimate)` : text;
}

function sourceLabel(kind: string | null | undefined): { label: string; tone: Tone } {
  if (kind === "verified") return { label: "Verified", tone: "success" };
  if (kind === "demo") return { label: "Group idea", tone: "warn" };
  if (kind === "unverified") return { label: "Source listing", tone: "neutral" };
  return { label: "Source unclear", tone: "warn" };
}

function countText(count: number | undefined): string {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return "Interest count not available";
  if (count === 0) return "No one interested yet";
  return `${count} interested`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function readCount(counts: Record<string, number> | null | undefined, id: string): number | undefined {
  if (!counts || !Object.prototype.hasOwnProperty.call(counts, id)) return undefined;
  return counts[id];
}

/* ----------------------------------------------------------------- Card */

interface ActivityCardProps {
  item: RankedActivity;
  count: number | undefined;
  onOpen: (activityId: string) => void;
}

function ActivityCard({ item, count, onOpen }: ActivityCardProps) {
  const { activity } = item;
  const interest = interestMeta(activity.interestId);
  const title = activity.title?.trim() || "Untitled activity";
  const area = activity.area?.trim() || "Area not listed";
  const source = sourceLabel(activity.source?.kind);
  const checked = formatCheckedDate(activity.source.checkedAt);
  const sourceHref = getSourcePresentation(activity.source).href;
  const providers: Record<string, string> = { ticketmaster: "Ticketmaster", luma: "Luma", skiddle: "Skiddle", serpapi: "Google Events", eventbrite: "Eventbrite", places: "Google Maps", overpass: "OpenStreetMap", tmdb: "TMDB", movieglu: "MovieGlu" };
  const provider = providers[activity.id.split("-")[1]] ?? "Event source";
  const when = formatWhen(item.nextStartAt) ?? "Suggestion · check dates and availability";
  const extraTimes = Array.isArray(activity.timeOptions) ? Math.max(0, activity.timeOptions.length - 1) : 0;
  const reasons = (Array.isArray(item.reasons) ? item.reasons : [])
    .filter((reason): reason is string => typeof reason === "string" && reason.trim() !== "")
    .slice(0, MAX_REASONS);

  return (
    <article className="myt-activity-card" data-activity-id={activity.id}>
      <div className="myt-activity-card__top">
        {interest ? <ActivityMark interestId={interest.id} title={title} size="md" /> : null}
        <div className="myt-activity-card__heading">
          <h3>
            <button type="button" className="myt-activity-card__link" aria-label={`Open activity: ${title}`} onClick={() => onOpen(activity.id)}>
              {title}
            </button>
          </h3>
          <div className="myt-badges">
            <Chip tone={interest ? (interest.id as Tone) : "neutral"}>{interest ? interest.label : "Other interest"}</Chip>
            <Chip tone={source.tone}>{source.label}</Chip>
            <Chip tone="neutral">{item.nextStartAt ? "Scheduled event" : "Check availability"}</Chip>
            {activity.status === "unavailable" ? <Chip tone="warn">Unavailable</Chip> : null}
          </div>
        </div>
      </div>

      <div className="myt-activity-card__meta">
        <span className="myt-wrap-anywhere">
          <span className="myt-visually-hidden">Where: </span>
          {area}
        </span>
        <span>
          <span className="myt-visually-hidden">Next time: </span>
          {when}
          {extraTimes > 0 ? `, ${extraTimes} more ${plural(extraTimes, "time", "times")}` : ""}
        </span>
        <span>
          <span className="myt-visually-hidden">Cost: </span>
          {formatCost(activity.cost)}
        </span>
        <span className="myt-small myt-subtle">{provider}{checked ? ` · Updated ${checked}` : ""}</span>
      </div>

      {activity.description.split("\nSource:")[0].trim() ? <p className="myt-small myt-muted">{activity.description.split("\nSource:")[0].trim().slice(0, 200)}</p> : null}
      {sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="myt-link">{item.nextStartAt ? "Event details and tickets" : "View source and availability"} ↗</a> : null}

      {reasons.length > 0 ? (
        <ul className="myt-activity-card__reasons" aria-label="Why this fits">
          {reasons.map((reason, index) => (
            <li key={`${index}:${reason}`}>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="myt-activity-card__footer">
        <span className="myt-count">{countText(count)}</span>
        <span className="myt-link myt-strong" aria-hidden="true">
          Open activity →
        </span>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="myt-activity-card" aria-hidden="true">
      <div className="myt-activity-card__top">
        <span className="myt-skeleton myt-skeleton--mark" />
        <div className="myt-activity-card__heading" style={{ flex: 1 }}>
          <span className="myt-skeleton myt-skeleton--title" />
          <span className="myt-skeleton myt-skeleton--short" />
        </div>
      </div>
      <span className="myt-skeleton myt-skeleton--block" />
      <span className="myt-skeleton myt-skeleton--short" />
    </div>
  );
}

/* --------------------------------------------------------------- Search scanner */

const SCAN_MS_QUERY = 3400;
const SCAN_MS_BROWSE = 1600;
const BEAM_SECONDS = 2.2;
const MAX_BLIPS = 28;

function matchesQuery(item: RankedActivity, q: string): boolean {
  if (!item || !item.activity) return false;
  if (!q) return true;
  const a = item.activity;
  return `${a.title} ${a.area} ${a.interestId === "music" ? "gigs" : ""} ${a.interestId} ${interestMeta(a.interestId)?.label ?? ""}`.toLowerCase().includes(q);
}

/** Stable pseudo-random number in [0, 1) from an id, so a blip keeps its spot across renders. */
function hashUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/*
 * The scan walks the real catalogue: every count, title and blip comes from `items`, and the match
 * count is the same predicate the result list uses. Only the pacing is staged so people can follow it.
 */
function SearchScanner({ items, query, durationMs }: { items: RankedActivity[]; query: string; durationMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(now - start, durationMs);
      setElapsed(t);
      if (t < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  const valid = items.filter((item) => item && item.activity);
  const total = valid.length;
  const progress = durationMs > 0 ? elapsed / durationMs : 1;
  const scanned = total === 0 ? 0 : Math.min(total, Math.round(total * Math.min(1, Math.max(0, (progress - 0.1) / 0.68))));
  const matched = valid.slice(0, scanned).filter((item) => matchesQuery(item, query));
  const current = scanned < total ? valid[scanned]?.activity : valid[total - 1]?.activity;
  const areas = new Set(valid.slice(0, scanned).map((item) => item.activity.area).filter(Boolean)).size;

  const stages: Array<{ at: number; label: string }> = [
    { at: 0, label: "Connecting to the London catalogue" },
    { at: 0.1, label: total ? `Pulling ${total} ${plural(total, "listing", "listings")}` : "Pulling listings" },
    { at: 0.36, label: query ? `Matching “${query}”` : "Matching your interests" },
    { at: 0.6, label: "Checking when you're free" },
    { at: 0.8, label: "Ranking by best fit" },
  ];

  const hits = valid.filter((item) => matchesQuery(item, query));
  const radarItems = (query ? [...hits.slice(0, 10), ...valid.filter((item) => !matchesQuery(item, query))] : valid).slice(0, MAX_BLIPS);
  const blips = radarItems.map((item, index) => {
    const angle = hashUnit(item.activity.id, 1) * 360;
    const radius = 14 + hashUnit(item.activity.id, 2) * 32;
    const rad = (angle * Math.PI) / 180;
    return {
      id: item.activity.id,
      tone: item.activity.interestId,
      left: 50 + radius * Math.sin(rad),
      top: 50 - radius * Math.cos(rad),
      delay: (angle / 360) * BEAM_SECONDS,
      visible: index < Math.ceil((scanned / Math.max(1, total)) * Math.min(total, MAX_BLIPS)),
      hit: matchesQuery(item, query),
    };
  });

  return (
    <div className="myt-scan" role="status" aria-label={query ? `Searching for ${query}` : "Finding plans for you"}>
      <div className="myt-scan__radar" aria-hidden="true" style={{ ["--beam" as string]: `${BEAM_SECONDS}s` }}>
        <span className="myt-scan__ring" />
        <span className="myt-scan__ring" />
        <span className="myt-scan__ring" />
        <span className="myt-scan__cross" />
        <span className="myt-scan__beam" />
        <span className="myt-scan__pulse" />
        {blips.map((b) =>
          b.visible ? (
            <span
              key={b.id}
              className="myt-scan__blip"
              data-hit={b.hit && progress > 0.36 ? "true" : undefined}
              style={{ left: `${b.left}%`, top: `${b.top}%`, animationDelay: `0s, ${b.delay}s`, ["--blip" as string]: `var(--myt-${b.tone}, var(--myt-accent))` }}
            />
          ) : null,
        )}
        <span className="myt-scan__core" />
      </div>

      <div className="myt-scan__panel">
        <div className="myt-scan__stats" aria-hidden="true">
          <span><b>{scanned}</b>/{total || "…"} scanned</span>
          <span><b>{progress > 0.36 ? matched.length : 0}</b> {plural(matched.length, "match", "matches")}</span>
          <span><b>{areas}</b> {plural(areas, "area", "areas")}</span>
        </div>
        <div className="myt-scan__bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="myt-scan__ticker" aria-hidden="true">
          {current && progress > 0.1 && progress < 0.95 ? <><span className="myt-scan__caret">›</span> {current.title}{current.area ? ` · ${current.area}` : ""}</> : <span className="myt-scan__caret">›</span>}
        </p>
        <ol className="myt-scan__log">
          {stages.map((stage, i) => {
            if (progress < stage.at) return null;
            const done = i === stages.length - 1 ? progress >= 1 : progress >= stages[i + 1].at;
            return (
              <li key={stage.label} data-done={done ? "true" : undefined}>
                <span className="myt-scan__tick" aria-hidden="true">{done ? "✓" : ""}</span>
                {stage.label}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Screen */

function normalised(filters: ActivityFilters | null | undefined): { interestIds: InterestId[]; availability: AvailabilityKey[] } {
  const interestIds = INTERESTS.map((i) => i.id).filter((id) => Array.isArray(filters?.interestIds) && filters.interestIds.includes(id));
  const availability = AVAILABILITY.map((a) => a.key).filter((key) => Array.isArray(filters?.availability) && filters.availability.includes(key));
  return { interestIds, availability };
}

export function Discover({ aiProfile, aiInterestedActivityIds = [], mode, greetingName, rankedActivities, filters, interestedCounts, onFiltersChange, onOpenActivity, onOpenPlans }: DiscoverProps) {
  const [visibleCount,setVisibleCount] = useState(12);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [settled, setSettled] = useState("");
  const pending = query.trim().toLowerCase();
  const scanMs = pending ? SCAN_MS_QUERY : SCAN_MS_BROWSE;
  useEffect(() => { setSearching(true); const timer = setTimeout(() => {setSettled(pending); setVisibleCount(12); setSearching(false);}, scanMs); return () => clearTimeout(timer); }, [pending, scanMs, filters]);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const selected = normalised(filters);
  const hasInterestFilter = selected.interestIds.length > 0;
  const hasAvailabilityFilter = selected.availability.length > 0;
  const filtersActive = hasInterestFilter || hasAvailabilityFilter;

  const emit = (next: { interestIds: InterestId[]; availability: AvailabilityKey[] }) => onFiltersChange({ ...filters, ...next });
  const toggleInterest = (id: InterestId, on: boolean) =>
    emit({ ...selected, interestIds: INTERESTS.map((i) => i.id).filter((x) => (x === id ? on : selected.interestIds.includes(x))) });
  const toggleAvailability = (key: AvailabilityKey, on: boolean) =>
    emit({ ...selected, availability: AVAILABILITY.map((a) => a.key).filter((x) => (x === key ? on : selected.availability.includes(x))) });
  const clearAll = () => emit({ interestIds: [], availability: [] });
  /* The empty-state buttons unmount when results return, so park focus on the results heading. */
  const relax = (next: { interestIds: InterestId[]; availability: AvailabilityKey[] }) => {
    emit(next);
    resultsRef.current?.focus();
  };

  const name = greetingName?.trim();
  const selectedLabels = [
    ...selected.interestIds.map((id) => interestMeta(id)?.label ?? id),
    ...selected.availability.map((key) => AVAILABILITY.find((a) => a.key === key)?.label ?? key),
  ];

  const list = rankedActivities.state === "ready" && Array.isArray(rankedActivities.value) ? rankedActivities.value.filter((item) => matchesQuery(item, settled)) : [];
  const shown = list.slice(0, visibleCount);
  const issues = rankedActivities.state === "ready" ? rankedActivities.issues.length : 0;

  return (
    <div className="myt-stack myt-stack--lg">
      <SectionHeader
        level={1}
        eyebrow="MYT · London"
        title={name ? `Hey ${name}. What's the plan?` : "What's the plan?"}
        description="Find something to do. Find someone to go with."
      />

      {mode === "preview" ? (
        <div className="myt-banner" data-tone="warn" role="status">
          <div className="myt-banner__text">
            <p className="myt-banner__title">Preview mode</p>
            <p className="myt-small">You are looking at example data. Nothing you do here is saved or shared.</p>
          </div>
        </div>
      ) : null}

      {mode !== "preview" && rankedActivities.state === "ready" ? <AiPicks key={JSON.stringify([aiProfile, aiInterestedActivityIds, filters, rankedActivities.value.map(x => x.activity.id)])} profile={aiProfile ?? null} items={rankedActivities.value} interestedIds={aiInterestedActivityIds} counts={interestedCounts} onOpen={onOpenActivity} /> : null}
      <Field label="Find your next plan" type="search" value={query} onChange={setQuery} placeholder="Football, cinema, East London…"/>
      <section className="myt-filters myt-filters--compact" aria-label="Filter activities">
        <div className="myt-filters__row">
          <span className="myt-filters__label">Interests</span>
          <ChipGroup label="Filter by interest">
            {INTERESTS.map((item) => (
              <Chip key={item.id} tone={item.id} selected={selected.interestIds.includes(item.id)} onSelectedChange={(on) => toggleInterest(item.id, on)}>
                {item.label}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        <details className="myt-time-filters">
          <summary>When you're free{hasAvailabilityFilter ? ` · ${selected.availability.length} selected` : ""}</summary>
          <ChipGroup label="Filter by availability">
            {AVAILABILITY.map((item) => (
              <Chip key={item.key} selected={selected.availability.includes(item.key)} onSelectedChange={(on) => toggleAvailability(item.key, on)}>
                {item.label}
              </Chip>
            ))}
          </ChipGroup>
        </details>
        {filtersActive ? (
          <div className="myt-filters__row">
            <span className="myt-filters__label">Showing</span>
            <span className="myt-small myt-muted">{selectedLabels.join(", ")}</span>
            <Button variant="quiet" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </section>

      <section className="myt-stack" aria-labelledby="myt-discover-results" aria-busy={rankedActivities.state === "loading" || undefined}>
        <h2 id="myt-discover-results" className="myt-visually-hidden" ref={resultsRef} tabIndex={-1}>
          Activities
        </h2>

        {searching ? <SearchScanner key={pending} items={rankedActivities.state === "ready" && Array.isArray(rankedActivities.value) ? rankedActivities.value : []} query={pending} durationMs={scanMs} /> : null}
        {rankedActivities.state === "loading" && !searching ? (
          <>
            <p className="myt-visually-hidden" role="status">
              Loading activities
            </p>
            <div className="myt-grid" aria-hidden="true">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </>
        ) : null}

        {rankedActivities.state === "error" ? (
          <div className="myt-banner" data-tone="danger" role="alert">
            <div className="myt-banner__text">
              <p className="myt-banner__title">We couldn't load the activities</p>
              <p className="myt-small myt-wrap-anywhere">{rankedActivities.error.message || "Something went wrong reading the activity list."}</p>
            </div>
          </div>
        ) : null}

        {rankedActivities.state === "ready" && !searching ? (
          <>
            <p className="myt-small myt-muted" aria-live="polite">
              {list.length === 0
                ? "No activities to show"
                : `${list.length} ${plural(list.length, "activity", "activities")}${filtersActive ? ` matching ${selectedLabels.join(", ")}` : ""}`}
            </p>

            {issues > 0 ? (
              <p className="myt-small myt-muted">
                {issues} {plural(issues, "activity record", "activity records")} could not be read and {plural(issues, "is", "are")} not shown.
              </p>
            ) : null}

            {list.length === 0 ? (
              <div className="myt-empty">
                <p className="myt-empty__title">{filtersActive ? "No activities match these filters" : "No activities listed yet"}</p>
                <p className="myt-empty__body">
                  {filtersActive
                    ? "MYT only shows activities from its own list, so there is nothing to suggest right now. Try relaxing a filter."
                    : "There is nothing in the list at the moment. Check back later."}
                </p>
                {filtersActive ? (
                  <div className="myt-actions">
                    <Button variant="primary" onClick={() => relax({ interestIds: [], availability: [] })}>
                      Clear all filters
                    </Button>
                    {hasInterestFilter && hasAvailabilityFilter ? (
                      <>
                        <Button variant="quiet" onClick={() => relax({ interestIds: selected.interestIds, availability: [] })}>
                          Any time
                        </Button>
                        <Button variant="quiet" onClick={() => relax({ interestIds: [], availability: selected.availability })}>
                          Any interest
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : <>
              {shown.some(item => item.nextStartAt !== null) ? <section className="myt-stack" aria-label="Upcoming events">
                <h2>Upcoming events</h2>
                <p className="myt-small myt-muted">Real listings with published start times. Check the source for tickets and changes.</p>
                <div className="myt-grid">{shown.filter(item => item.nextStartAt !== null).map(item => <ActivityCard key={item.activity.id} item={item} count={readCount(interestedCounts, item.activity.id)} onOpen={onOpenActivity} />)}</div>
              </section> : null}
              {shown.some(item => item.nextStartAt === null) ? <section className="myt-stack" aria-label="More to explore">
                <h2>More to explore</h2>
                <p className="myt-small myt-muted">Venue and film suggestions, and listings whose exact time still needs checking.</p>
                <div className="myt-grid">{shown.filter(item => item.nextStartAt === null).map(item => <ActivityCard key={item.activity.id} item={item} count={readCount(interestedCounts, item.activity.id)} onOpen={onOpenActivity} />)}</div>
              </section> : null}
            </>}

            {list.length > visibleCount ? <Button onClick={()=>setVisibleCount(n=>n+12)}>Show more plans</Button> : null}
            {list.length > 0 ? (
              <p className="myt-small myt-subtle">
                "Interested" counts people who have saved their interest in MYT. Who is viewing an activity right now appears only on that activity's page.
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function AiPicks({profile, items, interestedIds, counts, onOpen}: {profile:Profile|null; items:RankedActivity[]; interestedIds:string[]; counts:Record<string,number>; onOpen:(id:string)=>void}) {
  const [picks,setPicks] = useState<AiRecommendation[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const generate = async () => {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 35000);
    setBusy(true); setError("");
    try { const result = await recommendEvents(profile,items,interestedIds,abort.signal); if (!abort.signal.aborted) setPicks(result.recommendations); }
    catch (e) { if (controller.current === abort) setError(e instanceof Error ? e.message : "Couldn't get recommendations."); }
    finally { clearTimeout(timeout); if (controller.current === abort) setBusy(false); }
  };
  return <section className="myt-stack" aria-label="AI event recommendations">
    <div className="myt-row"><div><h2>Picked for you · AI</h2><p className="myt-small myt-muted">Based on your interests, free time, budget and plans you like. Only events from this catalog.</p></div><Button pending={busy} disabled={busy || !items.length} onClick={()=>void generate()}>{picks ? "Refresh AI picks" : "Find my AI picks"}</Button></div>
    <p className="myt-small myt-muted">Your preferences and interested event IDs are sent to OpenAI when you request picks. Requests pass briefly through app files, readable by library collaborators. Check event details before booking.</p>
    {error ? <p role="alert">{error} Your usual feed is still available below.</p> : null}
    {busy ? <p role="status">Matching events to you…</p> : null}
    {picks?.length === 0 ? <p role="status">No close matches right now. Update your preferences or explore below.</p> : null}
    {picks?.length ? <div className="myt-grid">{picks.map(pick=>{const item=items.find(x=>x.activity.id===pick.activityId);return item ? <ActivityCard key={pick.activityId} item={{...item,reasons:[`AI pick: ${pick.reason}`, ...item.reasons]}} count={counts[pick.activityId]} onOpen={onOpen}/> : null;})}</div> : null}
  </section>;
}

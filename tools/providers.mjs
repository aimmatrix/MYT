// Runs in Node, never in the Lightfern webview. Only public, normalized data leaves here.
import { createHash } from 'node:crypto';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : '';
const id = (provider, value) => `api-${provider}-${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some(key => /key|token|secret|auth/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
export function category(value, fallback = 'social') {
  const label = text(value).toLowerCase();
  if (/football|soccer|five.a.side|5.a.side/.test(label)) return 'football';
  if (/kart/.test(label)) return 'karting';
  if (/cinema|film|movie/.test(label)) return 'cinema';
  if (/fitness|gym|workout|yoga/.test(label)) return 'fitness';
  if (/comedy|stand.up/.test(label)) return 'comedy';
  if (/theatre|theater/.test(label)) return 'theatre';
  if (/music|concert|gig|clubb|\bclub\b|\blive\b|\bfest\b/.test(label)) return 'music';
  return fallback;
}

const londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function londonParts(date) {
  return Object.fromEntries(londonFormatter.formatToParts(date).map(p => [p.type, p.value]));
}
export function londonLocal(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(time ?? '')) return null;
  const wanted = `${date}T${time.length === 5 ? time + ':00' : time}`;
  const base = Date.parse(wanted + 'Z');
  // Test both London offsets; reject nonexistent and ambiguous DST wall times.
  const matches = [base, base - 3600000].filter(ms => {
    if (!Number.isFinite(ms)) return false;
    const p = londonParts(new Date(ms));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === wanted;
  });
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function option(start, end, now) {
  start = instant(start);
  if (!start || Date.parse(start) <= now.getTime()) return [];
  end = instant(end);
  if (end && end <= start) end = null;
  const p = londonParts(new Date(start));
  const day = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay();
  const weekend = day === 0 || day === 6;
  const availabilityKeys = weekend ? [Number(p.hour) < 18 ? 'weekend-day' : 'weekend-evening']
    : Number(p.hour) >= 17 ? ['weekday-evening'] : [];
  return [{ id: id('time', start), startAt: start, endAt: end, availabilityKeys }];
}
function activity(provider, record, now) {
  const title = text(record.title);
  const url = safeUrl(record.url);
  if (!title || !record.key || !url) return null;
  const timeOptions = option(record.start, record.end, now);
  if (record.start && timeOptions.length === 0) return null;
  return {
    schemaVersion: 1, id: id(provider, record.key), title,
    description: `${text(record.description)}\nSource: ${record.label}. ${record.notice ?? 'Check the source for tickets, availability and any changes. No booking has been made.'}`.trim(),
    interestId: record.category ?? category(title), area: text(record.area) || 'London',
    status: 'available', timeOptions,
    cost: { amountPence: Number.isInteger(record.pence) && record.pence >= 0 ? record.pence : null, currency: 'GBP', isEstimate: Boolean(record.estimate) },
    source: { kind: 'unverified', url, checkedAt: now.toISOString() },
    suggestedMeetingPoint: null,
  };
}
const normalized = (provider, records, now) => records.map(r => activity(provider, r, now)).filter(Boolean);
// Records sharing an ID are one listing (for example timed-entry slots): keep one card with every slot.
function combine(items) {
  const byId = new Map();
  for (const item of items) {
    const prior = byId.get(item.id);
    if (!prior) { byId.set(item.id, item); continue; }
    const options = new Map([...prior.timeOptions, ...item.timeOptions].map(o => [o.id, o]));
    prior.timeOptions = [...options.values()].sort((a, b) => a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0);
    const prices = [prior.cost.amountPence, item.cost.amountPence].filter(p => p !== null);
    if (prices.length) prior.cost = { ...prior.cost, amountPence: Math.min(...prices), isEstimate: prior.cost.isEstimate || item.cost.isEstimate };
  }
  return [...byId.values()];
}

export const PROVIDERS = {
  ticketmaster: { keys: ['TICKETMASTER_API_KEY'], label: 'Ticketmaster' },
  luma: { keys: [], label: 'Luma public discovery (unofficial)' },
  skiddle: { keys: ['SKIDDLE_API_KEY'], label: 'Skiddle' },
  serpapi: { keys: ['SERPAPI_API_KEY'], label: 'Google Events via SerpApi' },
  places: { keys: ['GOOGLE_PLACES_API_KEY'], label: 'Google Places' },
  overpass: { keys: [], label: 'OpenStreetMap' },
  tmdb: { keys: ['TMDB_READ_TOKEN'], label: 'TMDB' },
  movieglu: { keys: ['MOVIEGLU_CLIENT', 'MOVIEGLU_API_KEY', 'MOVIEGLU_AUTHORIZATION', 'MOVIEGLU_API_VERSION'], label: 'MovieGlu' },
  eventbrite: { keys: ['EVENTBRITE_PRIVATE_TOKEN'], label: 'Eventbrite' },
};

export function eventbriteIds(catalog, configured = '') {
  const ids = configured.split(',').map(value => value.trim()).filter(value => /^\d+$/.test(value));
  for (const item of catalog.items ?? []) {
    try {
      const url = new URL(item.source?.url);
      if (!/(^|\.)eventbrite\.(com|co\.uk)$/.test(url.hostname)) continue;
      const eventId = url.pathname.match(/(?:^|[-/])(\d{8,})\/?$/)?.[1];
      if (eventId) ids.push(eventId);
    } catch { /* No usable source URL. */ }
  }
  return [...new Set(ids)].slice(0, 20);
}

export async function fetchProvider(provider, env, { now = new Date(), fetchImpl = fetch } = {}) {
  const missing = PROVIDERS[provider].keys.filter(key => !env[key]?.trim());
  if (missing.length) return { state: 'needs-key', items: [], missing };
  async function json(base, params = {}, init = {}) {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    // No raw errors, response bodies, URLs or headers are logged: they may contain credentials.
    let response;
    try { response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(35000) }); }
    catch { throw new Error('Network request failed or timed out'); }
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    if (response.status === 204) return {};
    try { return await response.json(); } catch { throw new Error('Provider returned invalid JSON'); }
  }
  let items = [];
  if (provider === 'ticketmaster') {
    const data = await json('https://app.ticketmaster.com/discovery/v2/events.json', {
      apikey: env.TICKETMASTER_API_KEY, city: 'London', countryCode: 'GB', size: 50,
      startDateTime: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), sort: 'date,asc',
    });
    if (!data._embedded && !data.page) throw new Error('Unexpected Ticketmaster response');
    items = normalized(provider, list(data._embedded?.events).map(e => ({
      // Timed-entry attractions list each slot as an event sharing one listing URL; key on it so they combine.
      key: safeUrl(e.url), label: 'Ticketmaster', title: e.name, description: e.info,
      url: e.url, area: e._embedded?.venues?.[0]?.name,
      category: category([e.name, ...list(e.classifications).flatMap(c => [c.segment?.name, c.genre?.name])].join(' ')),
      start: e.dates?.start?.dateTime,
      // A day-only event has no confirmed start; it stays undated.
      pence: e.priceRanges?.[0]?.currency === 'GBP' ? Math.round(e.priceRanges[0].min * 100) : null,
      estimate: true,
    })).filter((_, i) => !['cancelled', 'postponed', 'rescheduled'].includes(data._embedded.events[i].dates?.status?.code)), now);
  } else if (provider === 'eventbrite') {
    // No public citywide search exists: enrich known public listings, never import private account events.
    const ids = eventbriteIds({ items: [] }, env.EVENTBRITE_EVENT_IDS ?? '');
    if (!ids.length) return { state: 'needs-events', provider, items: [], missing: ['EVENTBRITE_EVENT_IDS'] };
    for (const eventId of ids) {
      let event;
      try {
        event = await json(`https://www.eventbriteapi.com/v3/events/${eventId}/`, { expand: 'venue' }, {
          headers: { Authorization: `Bearer ${env.EVENTBRITE_PRIVATE_TOKEN}` },
        });
      } catch (error) {
        if (/HTTP (403|404)$/.test(error.message)) continue; // inaccessible/deleted listing
        throw error;
      }
      if (event.listed !== true || event.status !== 'live' || event.hide_start_date === true) continue;
      if (!event.id || !event.name?.text || !instant(event.start?.utc)) continue;
      const record = activity(provider, {
        key: event.id, label: 'Eventbrite', title: event.name.text,
        description: event.summary || event.description?.text, url: event.url,
        start: event.start.utc, end: event.end?.utc,
        area: event.online_event ? 'Online' : [event.venue?.name, event.venue?.address?.city].filter(Boolean).join(', '),
        pence: event.is_free === true ? 0 : null,
      }, now);
      if (record) items.push(record);
    }
  } else if (provider === 'luma') {
    const data = await json('https://api.luma.com/discover/get-paginated-events', { slug: 'london' });
    if (!Array.isArray(data.entries)) throw new Error('Luma public feed is unavailable or changed shape');
    items = normalized(provider, data.entries.map(entry => {
      const e = entry.event ?? entry;
      return { key: e.api_id ?? e.url, label: 'Luma', title: e.name, start: e.start_at, end: e.end_at,
        url: e.url?.startsWith('https:') ? e.url : e.url ? `https://luma.com/${e.url}` : null,
        area: e.geo_address_info?.city ?? 'London', category: category(e.name),
        notice: 'Imported from an unofficial public discovery feed. Confirm details with the organiser; this feed may change.' };
    }), now);
  } else if (provider === 'skiddle') {
    const data = await json('https://www.skiddle.com/api/v1/events/search/', {
      api_key: env.SKIDDLE_API_KEY, latitude: 51.5074, longitude: -0.1278,
      radius: 15, limit: 50, order: 'trending', minDate: now.toISOString().slice(0, 10), description: 1,
    });
    if (!Array.isArray(data.results)) throw new Error('Unexpected Skiddle response');
    if (data.error) throw new Error('Unexpected Skiddle response');
    items = normalized(provider, data.results.filter(e => ![true, 1, '1'].includes(e.cancelled)).map(e => ({ key: e.id, label: 'Skiddle', title: e.eventname,
      description: e.description, url: e.link, area: e.venue?.name,
      start: instant(e.startdate) ?? londonLocal(e.date, e.openingtimes?.doorsopen), end: instant(e.enddate),
      category: category(`${e.eventname} ${e.EventCode ?? e.eventcode ?? ''}`),
    })), now);
  } else if (provider === 'serpapi') {
    const data = await json('https://serpapi.com/search.json', {
      api_key: env.SERPAPI_API_KEY, engine: 'google_events', q: 'events in London', hl: 'en', gl: 'uk',
    });
    if (data.error || (!data.events_results && data.search_information?.events_results_state !== 'Fully empty')) throw new Error('SerpApi did not return event results');
    items = normalized(provider, list(data.events_results).map(e => {
      // Some Google Events responses omit the top-level link and supply ticket_info instead.
      // Keep the event/ticket destination; venue links are not evidence for an event.
      const url = safeUrl(e.link) ?? list(e.ticket_info).map(ticket => safeUrl(ticket.link)).find(Boolean);
      return {
      key: url, label: 'Google Events via SerpApi', title: e.title, description: e.description,
      url, area: list(e.address).join(', '),
      // Google returns display dates without a dependable year/offset. Do not invent a start instant.
      notice: `Date as listed: ${text(e.date?.when) || 'See source'}. Confirm the exact date and time on the event site before planning.`,
    }; }), now);
  } else if (provider === 'places') {
    // Only place IDs are requested and none are stored: without names, per-place cards were indistinguishable.
    // Each search that returns venues becomes one card linking to the same search on Google Maps.
    for (const [interest, query, noun] of [['karting', 'go karting tracks in London', 'go-karting tracks'], ['football', '5 a side football pitches in London', 'five-a-side football pitches'], ['fitness', 'gyms in London', 'gyms']]) {
    const data = await json('https://places.googleapis.com/v1/places:searchText', {}, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify({ textQuery: query, pageSize: 10 }),
    });
    if (!Array.isArray(data.places) && Object.keys(data).length) throw new Error('Unexpected Places response');
    if (!list(data.places).some(p => typeof p?.id === 'string' && p.id)) continue;
    items.push(...normalized(provider, [{ key: `search-${interest}`, label: 'Google Maps', title: `Compare ${noun} in London`,
      category: interest, url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      description: `A Google Maps search for ${noun} across London. Choose a venue together, then check its bookable sessions.`,
      notice: 'Open Google Maps to compare current venue names, addresses, opening hours and prices. A venue suggestion has no scheduled session.' }], now));
    }
  } else if (provider === 'overpass') {
    const query = '[out:json][timeout:25];(nwr["sport"="soccer"]["leisure"="pitch"](51.40,-0.35,51.65,0.15);nwr["sport"="karting"](51.40,-0.35,51.65,0.15);nwr["leisure"="fitness_centre"](51.40,-0.35,51.65,0.15);nwr["amenity"="cinema"](51.40,-0.35,51.65,0.15););out tags center;';
    let data;
    // A second public instance is a fallback for an overloaded/unavailable server.
    for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        // OpenStreetMap's usage policy asks clients to identify themselves.
        data = await json(endpoint, { data: query }, { headers: { 'User-Agent': 'MYT-activity-importer/0.1 (Lightfern app)' } });
        if (Array.isArray(data.elements) && !data.remark) break;
      } catch { /* try the other public instance */ }
    }
    if (!data) throw new Error('Overpass query failed or returned incomplete data');
    if (!Array.isArray(data.elements) || data.remark) throw new Error('Overpass query failed or returned incomplete data');
    // Include named public venues only. Pitches may be private even when mapped.
    const seen = new Set();
    items = normalized(provider, data.elements.filter(e => e.tags?.name && !['private', 'no'].includes(e.tags.access)).map(e => ({
      key: `${e.type}/${e.id}`, label: 'OpenStreetMap', title: e.tags.name,
      category: e.tags.sport === 'soccer' ? 'football' : e.tags.sport === 'karting' ? 'karting' : e.tags.amenity === 'cinema' ? 'cinema' : 'fitness',
      area: [e.tags['addr:street'], e.tags['addr:suburb'], e.tags['addr:city']].filter(Boolean).join(', ') || 'London',
      url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      notice: '© OpenStreetMap contributors, ODbL. Venue idea only; check public access, opening hours, price and bookable sessions with the venue.',
    })), now).filter(item => {
      // Several mapped pitches or chain branches can share a name; identical cards cannot be told apart.
      const key = `${item.interestId}|${item.title.toLowerCase()}|${item.area.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 60);
  } else if (provider === 'tmdb') {
    const records = [];
    for (const endpoint of ['now_playing', 'upcoming']) {
      const data = await json(`https://api.themoviedb.org/3/movie/${endpoint}`, { region: 'GB', language: 'en-GB', page: 1 },
        { headers: { Authorization: `Bearer ${env.TMDB_READ_TOKEN}` } });
      if (!Array.isArray(data.results)) throw new Error('Unexpected TMDB response');
      records.push(...data.results.map(e => ({ key: e.id, label: 'TMDB', title: e.title, category: 'cinema',
        description: e.overview, url: `https://www.themoviedb.org/movie/${e.id}`,
        notice: 'Film suggestion from the UK movie list, not a cinema screening or showtime. This product uses the TMDB API but is not endorsed or certified by TMDB.',
      })));
    }
    items = normalized(provider, records, now);
  } else if (provider === 'movieglu') {
    const p = londonParts(now);
    const headers = { client: env.MOVIEGLU_CLIENT, 'x-api-key': env.MOVIEGLU_API_KEY,
      authorization: env.MOVIEGLU_AUTHORIZATION, territory: 'UK', 'api-version': env.MOVIEGLU_API_VERSION,
      geolocation: '51.5074;-0.1278', 'device-datetime': `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` };
    const nearby = await json('https://api-gate2.movieglu.com/cinemasNearby/', { n: 2 }, { headers });
    if (Object.keys(nearby).length && !Array.isArray(nearby.cinemas)) throw new Error('Unexpected MovieGlu cinema response');
    for (const cinema of list(nearby.cinemas)) {
      const date = `${p.year}-${p.month}-${p.day}`;
      const data = await json('https://api-gate2.movieglu.com/cinemaShowTimes/', { cinema_id: cinema.cinema_id, date }, { headers });
      if (Object.keys(data).length && !Array.isArray(data.films)) throw new Error('Unexpected MovieGlu showtime response');
      for (const film of list(data.films)) {
        for (const [format, showing] of Object.entries(film.showings ?? {})) {
          for (const time of list(showing.times)) {
            // MovieGlu's cinema day ends at 02:59; those showings belong to the following calendar date.
            const day = Number(time.start_time?.slice(0, 2)) < 3
              ? new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : date;
            const start = londonLocal(day, time.start_time);
            if (!start) continue;
            const record = activity(provider, { key: `${cinema.cinema_id}-${film.film_id}-${format}-${start}`,
              label: 'MovieGlu', title: `${film.film_name} (${format})`, category: 'cinema',
              area: cinema.cinema_name, start,
              url: safeUrl(cinema.website) ?? (film.imdb_title_id ? `https://www.imdb.com/title/${film.imdb_title_id}/` : null),
              notice: `Showtime at ${cinema.cinema_name} supplied by MovieGlu. Confirm tickets and the final time with the cinema; the source link may show film details only.`,
            }, now);
            if (record) items.push(record);
          }
        }
      }
    }
  }
  return { state: 'ok', provider, items: combine(items) };
}

export function mergeCatalog(existing, batches, protectedIds = new Set()) {
  // A successful, non-empty refresh supersedes that provider's earlier unreferenced entries, so expired
  // or renamed listings do not pile up as duplicates. Failed or empty refreshes remove nothing.
  const replaced = batches.filter(batch => batch.provider && batch.items.length).map(batch => `api-${batch.provider}-`);
  const items = new Map(existing.items
    .filter(item => protectedIds.has(item.id) || !replaced.some(prefix => item.id.startsWith(prefix)))
    .map(item => [item.id, item]));
  for (const batch of batches) for (const item of batch.items) {
    if (!protectedIds.has(item.id)) items.set(item.id, item);
  }
  // Prefer a dated listing to its Google-discovered link, but preserve all referenced records.
  const canonical = item => {
    const eventId = eventbriteIds({ items: [item] })[0];
    if (eventId) return `eventbrite:${eventId}`;
    try {
      const url = new URL(item.source?.url);
      for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|aff|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return url.origin + url.pathname.replace(/\/$/, '') + url.search;
    }
    catch { return item.id; }
  };
  const selected = new Map();
  const protectedItems = [];
  for (const item of items.values()) {
    if (protectedIds.has(item.id)) { protectedItems.push(item); continue; }
    const key = canonical(item);
    const previous = selected.get(key);
    if (!previous || (item.timeOptions?.length && !previous.timeOptions?.length)) selected.set(key, item);
  }
  const protectedSources = new Set(protectedItems.map(canonical));
  return { schemaVersion: 1, items: [...items.values()].filter(item => protectedIds.has(item.id)
    || (!protectedSources.has(canonical(item)) && selected.get(canonical(item))?.id === item.id)) };
}

export function liveCatalog(catalog, protectedIds = new Set()) {
  return { schemaVersion: 1, items: catalog.items.flatMap(item => {
    if (item.id.startsWith('api-') && item.source.kind !== 'demo') return [item];
    // Keep historical plan references resolvable without showing seeded activities in Discover.
    return protectedIds.has(item.id) ? [{ ...item, status: 'unavailable' }] : [];
  }) };
}

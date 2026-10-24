import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, fetchProvider, londonLocal, mergeCatalog, safeUrl, eventbriteIds, liveCatalog } from './providers.mjs';

const now = new Date('2026-10-24T12:00:00Z');
function mock(body, inspect) {
  return async (url, init) => { inspect?.(url, init); return new Response(JSON.stringify(body), { status: 200 }); };
}
const env = Object.fromEntries(Object.values(PROVIDERS).flatMap(p => p.keys).map(k => [k, 'fixture-secret']));
async function run(provider, data, inspect) { return fetchProvider(provider, env, { now, fetchImpl: mock(data, inspect) }); }

test('missing keys skip all network traffic', async () => {
  const result = await fetchProvider('ticketmaster', {}, { fetchImpl() { assert.fail('network called'); } });
  assert.equal(result.state, 'needs-key');
});
test('Eventbrite discovers IDs only from official event URLs and bounded explicit IDs', () => {
  assert.deepEqual(eventbriteIds({ items: [
    { source: { url: 'https://www.eventbrite.com/e/startup-party-tickets-2000036861091?aff=test' } },
    { source: { url: 'https://www.eventbrite.co.uk/e/2000036861091' } },
    { source: { url: 'https://eventbrite.com.attacker.example/e/9999999999' } },
  ] }, '123456789,not-an-id'), ['123456789', '2000036861091']);
});
test('Eventbrite imports only public live events with real UTC times; skips private and cancelled listings', async () => {
  const result = await fetchProvider('eventbrite', { ...env, EVENTBRITE_EVENT_IDS: '1,2,3,4' }, { now, fetchImpl: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer fixture-secret');
    const id = url.pathname.split('/').filter(Boolean).at(-1);
    return new Response(JSON.stringify({ id, listed: id !== '2', status: id === '3' ? 'canceled' : 'live',
      hide_start_date: id === '4', name: { text: 'Startup Party' }, url: `https://www.eventbrite.com/e/${id}`,
      start: { utc: '2026-10-28T18:00:00Z' }, end: { utc: '2026-10-28T21:00:00Z' },
      is_free: true, venue: { name: 'Big Chill', address: { city: 'London' } },
    }));
  } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Startup Party');
  assert.equal(result.items[0].timeOptions[0].startAt, '2026-10-28T18:00:00.000Z');
  assert.equal(result.items[0].cost.amountPence, 0);
});
test('Eventbrite requires known public event IDs instead of pretending citywide search exists', async () => {
  const result = await fetchProvider('eventbrite', env, { fetchImpl() { assert.fail('Network called without event IDs'); } });
  assert.equal(result.state, 'needs-events');
});
test('Eventbrite enrichments supersede undated Google links to the same event', () => {
  const source = { kind: 'unverified', url: 'https://www.eventbrite.com/e/2000036861091?aff=google' };
  const google = { id: 'api-serpapi-1', source, timeOptions: [] };
  const detailed = { id: 'api-eventbrite-1', source: { ...source, url: 'https://www.eventbrite.com/e/party-tickets-2000036861091' }, timeOptions: [{ id: 'start' }] };
  assert.deepEqual(mergeCatalog({ items: [google] }, [{ provider: 'eventbrite', items: [detailed] }]).items.map(item => item.id), [detailed.id]);
  assert.deepEqual(mergeCatalog({ items: [google] }, [{ provider: 'eventbrite', items: [detailed] }], new Set([google.id])).items.map(item => item.id), [google.id]);
});
test('live catalog removes seed/demo records while preserving hidden historical plan references', () => {
  const demo = { id: 'seed', status: 'available', source: { kind: 'demo' } };
  const real = { id: 'api-skiddle-1', status: 'available', source: { kind: 'unverified' } };
  assert.deepEqual(liveCatalog({ items: [demo, real] }).items, [real]);
  assert.equal(liveCatalog({ items: [demo, real] }, new Set(['seed'])).items[0].status, 'unavailable');
});
test('deduplication preserves distinct Google Maps searches and meaningful event query parameters', () => {
  const records = ['karting', 'football', 'gyms'].map((query, i) => ({
    id: `api-places-${i}`, source: { url: `https://www.google.com/maps/search/?api=1&query=${query}` }, timeOptions: [],
  }));
  assert.equal(mergeCatalog({ items: records }, []).items.length, 3);
});
test('Ticketmaster dates, lower price estimate and categories; cancelled events excluded', async () => {
  const item = { id: 't1', name: 'London football', url: 'https://ticketmaster.co.uk/event/1', dates: { start: { dateTime: '2026-11-05T19:00:00Z' } }, priceRanges: [{ currency: 'GBP', min: 25 }] };
  const result = await run('ticketmaster', { _embedded: { events: [item, { ...item, id: 'cancelled', dates: { ...item.dates, status: { code: 'cancelled' } } }] } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].interestId, 'football');
  assert.equal(result.items[0].cost.amountPence, 2500);
  assert.equal(result.items[0].cost.isEstimate, true);
  assert.equal(result.items[0].timeOptions[0].availabilityKeys[0], 'weekday-evening');
});
test('Luma official-shaped nested events and safe public links', async () => {
  const result = await run('luma', { entries: [{ event: { api_id: 'l1', name: 'Student social', url: 'student-social', start_at: '2026-11-07T14:00:00Z' } }] });
  assert.equal(result.items[0].source.url, 'https://luma.com/student-social');
  assert.equal(result.items[0].interestId, 'social');
});
test('Skiddle uses supported trending sort, explicit timestamps, cancellation and expiry filters', async () => {
  const e = { id: 's1', eventname: 'Live gig', EventCode: 'LIVE', link: 'https://www.skiddle.com/event/1', startdate: '2026-11-01T20:00:00+00:00', enddate: '2026-11-01T22:00:00+00:00' };
  const result = await run('skiddle', { error: 0, results: [e, { ...e, id: 'cancelled', cancelled: '1' }, { ...e, id: 'past', startdate: '2026-10-01T20:00:00Z' }] }, u => assert.equal(u.searchParams.get('order'), 'trending'));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].interestId, 'music');
  assert.equal(result.items[0].timeOptions[0].endAt, '2026-11-01T22:00:00.000Z');
});
test('SerpApi display-only dates never become fabricated scheduled events', async () => {
  const result = await run('serpapi', { events_results: [{ title: 'Comedy night', link: 'https://example.com/event', date: { when: 'Sat, Nov 7, 7 PM' } }] });
  assert.equal(result.items[0].interestId, 'comedy');
  assert.deepEqual(result.items[0].timeOptions, []);
});
test('SerpApi imports ticket_info links when Google omits the top-level event link', async () => {
  const result = await run('serpapi', { events_results: [
    { title: 'Startup party', date: { when: 'Oct 28, 6:00 PM' }, ticket_info: [{ link: 'https://example.com/event-tickets' }] },
    { title: 'Missing event source', venue: { link: 'https://example.com/venue' } },
    { title: 'Unsafe ticket source', ticket_info: [{ link: 'javascript:alert(1)' }, { link: 'https://example.com/?api_key=secret' }] },
  ] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source.url, 'https://example.com/event-tickets');
  assert.deepEqual(result.items[0].timeOptions, []);
});
test('Places requests IDs only and stores no restricted venue content', async () => {
  const result = await run('places', { places: [{ id: 'place123', displayName: { text: 'Restricted Name' }, formattedAddress: 'Restricted address' }] }, (_, init) => {
    assert.equal(init.headers['X-Goog-FieldMask'], 'places.id');
    assert.equal(init.method, 'POST');
  });
  // One distinguishable card per search; no place IDs or venue content are stored.
  assert.deepEqual(result.items.map(item => item.interestId), ['karting', 'football', 'fitness']);
  assert.equal(new Set(result.items.map(item => item.title)).size, 3);
  assert.match(result.items[0].source.url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=go%20karting/);
  assert.doesNotMatch(JSON.stringify(result), /Restricted|place123/);
  assert.deepEqual(result.items[0].timeOptions, []);
  assert.equal((await run('places', {})).items.length, 0);
});
test('Ticketmaster timed-entry slots sharing a listing combine into one activity', async () => {
  const slot = (id, start, min) => ({ id, name: 'The View', url: 'https://www.universe.com/events/view?ref=ticketmaster',
    dates: { start: { dateTime: start } }, priceRanges: [{ currency: 'GBP', min }] });
  const result = await run('ticketmaster', { _embedded: { events: [slot('a', '2026-11-05T14:15:00Z', 30), slot('b', '2026-11-05T14:00:00Z', 25)] } });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].timeOptions.map(o => o.startAt), ['2026-11-05T14:00:00.000Z', '2026-11-05T14:15:00.000Z']);
  assert.equal(result.items[0].cost.amountPence, 2500);
});
test('Overpass excludes unnamed and private venues and preserves attribution', async () => {
  const result = await run('overpass', { elements: [
    { type: 'node', id: 1, tags: { name: 'Public pitch', sport: 'soccer' } },
    { type: 'way', id: 2, tags: { name: 'Private pitch', sport: 'soccer', access: 'private' } },
    { type: 'way', id: 3, tags: { sport: 'soccer' } },
  ] });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].description, /OpenStreetMap contributors/);
  assert.equal(result.items[0].interestId, 'football');
  const twins = await run('overpass', { elements: [
    { type: 'way', id: 4, tags: { name: 'Football Pitch', sport: 'soccer' } },
    { type: 'way', id: 5, tags: { name: 'Football Pitch', sport: 'soccer' } },
    { type: 'way', id: 6, tags: { name: 'Football Pitch', sport: 'soccer', 'addr:suburb': 'Hackney' } },
  ] });
  assert.deepEqual(twins.items.map(item => item.area), ['London', 'Hackney']);
});
test('TMDB deduplicates movies across now playing and upcoming, never invents showtimes', async () => {
  const result = await run('tmdb', { results: [{ id: 123, title: 'A film', overview: 'Synopsis' }] });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].timeOptions, []);
  assert.match(result.items[0].description, /not a cinema screening/);
});
test('MovieGlu cinema-day rollover puts 01:00 on the following calendar day', async () => {
  let count = 0;
  const result = await fetchProvider('movieglu', env, { now: new Date('2026-10-23T12:00:00Z'), fetchImpl: async (url, init) => {
    assert.equal(init.headers.territory, 'UK');
    count++;
    return new Response(JSON.stringify(count === 1 ? { cinemas: [{ cinema_id: 1, cinema_name: 'Test cinema' }] } : {
      films: [{ film_id: 2, film_name: 'Film', imdb_title_id: 'tt123456', showings: { Standard: { times: [{ start_time: '01:00' }] } } }],
    }));
  } });
  assert.equal(result.items[0].timeOptions[0].startAt, '2026-10-24T00:00:00.000Z');
});
test('London conversion handles GMT, BST and invalid/ambiguous DST wall times', () => {
  assert.equal(londonLocal('2026-07-04', '19:30'), '2026-07-04T18:30:00.000Z');
  assert.equal(londonLocal('2026-11-04', '19:30'), '2026-11-04T19:30:00.000Z');
  assert.equal(londonLocal('2026-03-29', '01:30'), null);
  assert.equal(londonLocal('2026-10-25', '01:30'), null);
  assert.equal(londonLocal('2026-02-30', '19:30'), null);
});
test('merge protects referenced times and retains failed-provider catalog data', () => {
  const old = { id: 'a', timeOptions: [{ id: 'old' }] };
  const existing = { items: [old, { id: 'b' }] };
  const merged = mergeCatalog(existing, [{ items: [{ id: 'a', timeOptions: [] }, { id: 'c' }] }], new Set(['a']));
  assert.equal(merged.items[0], old);
  assert.equal(merged.items.length, 3);
});
test('a successful provider refresh supersedes its unreferenced earlier entries only', () => {
  const existing = { items: [{ id: 'seed' }, { id: 'api-places-old' }, { id: 'api-places-kept' }, { id: 'api-luma-x' }] };
  const merged = mergeCatalog(existing, [{ provider: 'places', items: [{ id: 'api-places-new' }] }, { provider: 'luma', items: [] }], new Set(['api-places-kept']));
  assert.deepEqual(merged.items.map(item => item.id), ['seed', 'api-places-kept', 'api-luma-x', 'api-places-new']);
});
test('provider/network errors never expose credentials or raw exception text', async () => {
  await assert.rejects(fetchProvider('tmdb', env, { fetchImpl() { throw new Error('fixture-secret'); } }), /Network request failed or timed out/);
  await assert.rejects(run('luma', { surprise: true }), /changed shape/);
  assert.equal(safeUrl('https://example.com/?api_key=fixture-secret'), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://user:password@example.com/'), null);
});

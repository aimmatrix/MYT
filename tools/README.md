# MYT activity API integrations

The Lightfern app reads `data/activities.json` through its existing repository and watches it for changes. This Node 22 importer fetches providers, normalizes their public data into the real `Activity` schema, and updates that catalog. It is an explicit snapshot refresh, not a background server. API keys never enter the React bundle or shared data folder.

## Run

From the `MYT` directory:

```sh
node --env-file=tools/api.env tools/refresh-sources.mjs
```

Working keys for Ticketmaster, Skiddle, SerpApi, Google Places and Eventbrite are committed in `tools/api.env` for hackathon judging, so the importer runs as-is. They will be rotated after judging. `api.env.example` lists every supported credential.

To select providers or test without changing shared data:

```sh
node --env-file=tools/api.env tools/refresh-sources.mjs --providers=luma,skiddle --dry-run
node --test tools/providers.test.mjs
```

Refresh after adding credentials. The app's Setup page displays each provider's last refresh outcome. A provider error gives the command a nonzero exit code, but successful providers still update the catalog. Missing keys are explicitly reported. No accounts are created, billing enabled or API access purchased by this command.

## Provider setup

| Provider | Configuration | What is imported |
| --- | --- | --- |
| Ticketmaster | `TICKETMASTER_API_KEY` from [registration](https://developer-account.ticketmaster.com/user/register) | First 50 London events with source dates and GBP price estimates where supplied. Timed-entry slots that share one listing become one activity with several time options. |
| Luma public discovery | No key | First discovery page for London; unofficial and subject to change. Luma Plus's official calendar API cannot search everyone's events. |
| Skiddle | `SKIDDLE_API_KEY` from [application](https://www.skiddle.com/api/join.php) | First 50 trending London-area listings; cancelled and past occurrences excluded. |
| SerpApi | `SERPAPI_API_KEY` from [dashboard](https://serpapi.com/dashboard) | Google event links and descriptions. Display dates lack dependable offsets/years, so records remain undated suggestions. |
| Google Places | `GOOGLE_PLACES_API_KEY` with Places API (New) enabled in [Google Cloud](https://developers.google.com/maps/documentation/places/web-service/get-api-key) | Three ID-only searches: karting, five-a-side, gyms. Each search that returns venues becomes one activity linking to the same search on Google Maps, where people compare current venue names and details. No place IDs or venue content are stored. |
| Overpass / OpenStreetMap | No key | Named football pitches, karting venues, gyms and cinemas in the London bounding box; up to 60 public venue suggestions. Venues with the same name and area are imported once. Two instances are tried. |
| TMDB | `TMDB_READ_TOKEN` from [API settings](https://www.themoviedb.org/settings/api) | First pages of UK now-playing and upcoming films, deduplicated by film ID. No screening times invented. |
| MovieGlu | `MOVIEGLU_CLIENT`, `MOVIEGLU_API_KEY`, `MOVIEGLU_AUTHORIZATION`, `MOVIEGLU_API_VERSION` from the [UK evaluation email](https://api-registration.movieglu.com/) | Today's showtimes at the two cinemas nearest central London, up to three calls per refresh. Uses the UK territory, not sandbox credentials. |

Configured services can consume provider quotas and, if enabled on your account, billing. No unlimited polling or pagination is performed. Google Places requests only IDs and retains no venue names, addresses, ratings or photos. Other provider data retention and attribution must follow your account terms. Skiddle attribution and outbound links are included; add its official brand logo before public distribution. TMDB requires its approved logo alongside attribution before public distribution; the required notice is already in the app.

## Data and date handling

- Imported entries have stable provider-scoped hashed IDs. All are labelled unverified: a successful API request is not an independent verification or a booking.
- Existing seed entries remain. An API outage, or a successful but empty response, never erases previously imported entries. A successful refresh with results replaces that provider's earlier entries, so expired or renamed listings do not pile up. Existing activities referenced by interests, votes or plans are never removed and are frozen during refresh to preserve chosen time IDs.
- Source start times with explicit offsets become scheduled time options. London local times are converted with actual GMT/BST rules; nonexistent or ambiguous DST wall times are not guessed. MovieGlu screenings before 03:00 roll into the following calendar date.
- Undated films and venues appear in Discover with a suggestion label and source link. They do not appear when an availability filter requires a known slot, and cannot be confirmed as plans without a real time option. Expired dated events remain on disk for existing plans but disappear from Discover.
- Requests time out, redirects are rejected, credentials and raw provider errors are never logged, imported HTML is stripped, and unsafe/credential-bearing source URLs are rejected.

## Verified on 24 October 2026

Latest refresh: Luma 47, Skiddle 49, Ticketmaster 50, and Google Places 30. Together with six original entries, the catalog contains 182 activities. Ticketmaster uses the approved app’s existing Consumer Key; Google Places uses the existing “places api key” without changing restrictions or billing. SerpApi Google sign-in succeeded with user approval, but its account still needs email and phone verification before the free plan is available. TMDB is signed in but has no API key yet; its key-request page is open. MovieGlu confirms that credentials were emailed, but the credentials were not available on the demo page or in the relevant mailbox searches. Overpass returned HTTP 406/429 across attempted public endpoints. These four remaining sources are not represented as live integrations.

The full source tree passes strict TypeScript checking with the existing Lightfern SDK stubs, all 13 new provider tests pass, and all 15 existing domain/repository checks pass. Lightfern's real hosted UI, sync and multiplayer were not tested in this change.

Provider references: [Ticketmaster](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [Skiddle](https://github.com/Skiddle/web-api/wiki/Events-API), [SerpApi](https://serpapi.com/google-events-api), [Google Places](https://developers.google.com/maps/documentation/places/web-service/text-search), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API), [TMDB](https://developer.themoviedb.org/reference/movie-now-playing-list), [MovieGlu headers](https://developer.movieglu.com/v2/api-index/setup/) and [showtimes](https://developer.movieglu.com/v2/api-index/cinemashowtimes/).

SerpApi follow-up on 24 October 2026: account verification is complete, its existing key is saved privately, and a live query imported eight London event suggestions. Google supplied ticket links under `ticket_info` rather than a top-level `link`; the importer now accepts that response shape and has a regression test. The catalog now contains 190 activities, all accepted by the app decoder and ranking code with no issues. SerpApi remains undated when only a display date is supplied.

Catalog clean-up on 24 October 2026: Google Places previously produced 30 cards with identical titles (“Explore a London football venue” and similar), because only IDs are retained. They are now three distinct search cards, one per interest. Ticketmaster timed-entry slots that shared one listing (for example four 15-minute Shard slots) are now one activity each with several time options. The catalog was migrated from the saved data without new API calls and contains 155 activities; all other entries are unchanged and none were referenced by interests, votes or plans.

## Real listings in the normal feed

The refresh command now uses **every available configured provider**, including Eventbrite. `EVENTBRITE_PRIVATE_TOKEN` is read only in Node. Known public event IDs are extracted from Eventbrite links in the existing catalog; you can also supply comma-separated `EVENTBRITE_EVENT_IDS`. It retrieves those specific events with venue details and UTC start/end times, excludes private/unlisted, cancelled, undated and past occurrences, and never imports private account event collections. Eventbrite does not provide general citywide event search.

A successful refresh writes an API-only catalog. The original six manually seeded activities are archived at `Planning/Archives/original-seed-activities.json`; they are no longer offered in Discover. If an old seed is referenced by an existing plan or vote it stays resolvable but unavailable. Explicit Preview mode retains its clearly labelled fictional fixtures.

Discover now has **Upcoming events** for source-published times and **More to explore** for venue/film suggestions or links with no dependable schedule. Cards display the source, refresh date, venue/area, available price and a direct source/ticket link. These are snapshots from the last refresh, not a claim that tickets or venues are reserved. Unknown prices and times stay unknown. Google discovery links are deduplicated when Eventbrite supplies a scheduled record for the same event, while existing plan references are preserved.

Run the refresh command again to update listings. Services missing credentials remain explicitly marked as waiting for credentials; network errors retain prior real listings and do not introduce demo fallbacks.

Latest full integration check: 152 API-sourced catalog entries, comprising 146 scheduled events and 6 undated suggestions. All five saved API credentials are now used: Ticketmaster, Skiddle, SerpApi, Google Places and Eventbrite; Luma works without a key. Cross-source deduplication means provider fetch counts can exceed the displayed catalog count. All 21 provider/import tests, all 15 existing domain/repository checks, strict TypeScript checking with the existing SDK stubs, and a static render of the real Discover component against the refreshed catalog passed. No private credentials were found in shared MYT files. TMDB and MovieGlu still have no configured credentials; Overpass still returns server errors. These services do not fall back to made-up events.


## Student redesign demo and checks

- `node MYT/tools/build-demo.cjs` builds `MYT/demo/index.html` from the actual React app with an isolated browser adapter. Open the HTML directly or serve the demo folder locally. All demo students are fictional, and saves stay in this browser. University-email code: **123456**. Reset demo clears only the MYT demo storage key.
- `node MYT/tools/check-redesign.cjs` runs strict compilation with local SDK stubs, 41 domain checks and the 62-check in-memory two-account flow.
- Both commands accept `MYT_NODE_MODULES=/path/to/node_modules`; the installation must provide TypeScript, React 19 and React type declarations. Their default points to the existing local Scrapper installation.
- Browser demo files do not replace the Lightfern entry point. Real sync and presence require separate host testing.

## OpenAI chat simulation and event picks

The local AI server serves the built demo and calls the OpenAI Responses API using strict JSON schemas and `store: false` ([official API documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)). The default model is `gpt-4o-mini`; change `OPENAI_MODEL` privately if needed. No SDK installation is required (Node 22).

```sh
node MYT/tools/build-demo.cjs
node --env-file=tools/openai.env tools/ai-server.mjs
```

Open **http://127.0.0.1:8787**. Complete the demo onboarding (simulated email code `123456`), then:

- **Discover → Find my AI picks**: recommends up to six existing catalog events using interests, available time, budget and previously interested event IDs. Filters still determine the candidate list. Names, email addresses and account IDs are omitted. Picks reset when profile, filters or catalog IDs change; requests only happen on click. Unknown prices/times remain unknown; AI chooses the order; explanations of interest and price are built from catalog facts, and the original listing and deterministic fit reasons stay visible.
- **Chats → Saturday football crew → Join group**: send a message; AI replies and poll votes are enabled automatically. OpenAI receives up to 24 messages from this fictional sample group and generates 1–3 replies from the labelled demo cast. Replies appear with a typing indicator. This is session-only simulation; it never posts as real students or writes to real group chats. There is no scripted fallback for new messages. Failures show an error and Retry. The pre-filled conversation remains as clearly fictional history.

The OpenAI key is not in the repo: judges receive `tools/openai.env` directly (copy `openai.env.example` to make your own). It is never bundled into the demo.

The server binds only to loopback, checks Host and Origin, accepts bounded JSON, rejects unknown event IDs and non-cast authors, limits requests to 20/minute with three in flight, times out upstream calls and sanitizes errors. It serves only the demo root; it cannot serve secret files. API calls can incur OpenAI charges.

**Lightfern host (fixed):** the installed SDK sandbox blocks HTTP origins entirely. MYT now uses `ctx.files` to send requests through the app-local `ai-runtime/requests` directory; the Node service processes them and writes a matching response. No network permission or CORS change is needed in Lightfern, and the OpenAI key stays outside the library. The same start command above enables both the file worker and the browser demo server. Runtime files are excluded from Git; requests/responses are temporary and readable by anyone with library file access. The client deletes them on success, error or cancellation; the worker removes processed requests and purges leftover responses after one minute. Sync services or backups may retain historical copies. Only the fictional sample-chat messages and selected recommendation preferences should be sent. Expired requests are rejected without calling OpenAI. A heartbeat reports whether the service is running. Keep the service running while using AI inside Lightfern. A public/multiuser deployment still needs a hosted authenticated backend; do not expose this local server publicly.

Transport checks: `node --test MYT/tools/ai-file-worker.test.mjs` exercises the exact client transport with a real temporary filesystem and worker, including both features, cancellation, offline detection, expired requests and cleanup. Live OpenAI chat and recommendations have also succeeded over the file transport.

Validation: `node --test MYT/tools/ai.test.mjs` checks response/error handling, restricted catalog/cast output, input minimization, Host/Origin rules, body limits and request limits. It uses mocked OpenAI responses and a temporary loopback server. Existing checks remain `node MYT/tools/check-redesign.cjs`. Live chat and recommendation requests both returned HTTP 200 on 24 October 2026 using the private environment configuration.


### AI votes on sample-group polls

In Lightfern, open **Chats → Saturday football crew**, use **+ → Poll**; AI voting is already enabled. Posting a poll asks OpenAI to select options for the five labelled fictional students, using the poll question, options and recent sample conversation. Their votes appear in the ordinary percentages and **See who voted** sheet. Single-choice and multiple-choice rules are validated on the server and in the sample store; unknown voters/options and duplicate votes are rejected. Your vote stays separate. Errors offer **Retry AI votes** on that poll. Turning AI off or leaving the group cancels pending votes. Polls posted with AI off are picked up when enabled. All votes are sample-session state and never become votes from real students. The same Lightfern file transport is used, with temporary request cleanup and the existing private server key.

`node --test MYT/tools/ai-polls.test.mjs` covers poll validation, single/multiple choice, cast-only voters, preservation of your vote, retries, real-chat isolation and cancellation. The file-worker tests also cover the poll-votes transport.


## Populated interactive hack demo

**Start demo** now opens an isolated in-memory session with the real event catalog and six labelled fictional students. Every available listing has three to five interested students. An existing friend, an incoming friend request and the £8 five-a-side listing populate the social flow. The viewer starts with zero joined groups, no interests and no plans.

AI is **on automatically throughout this mode**: no AI switch is shown. DMs use only that friend as the model's character; group replies and poll votes use only that activity's members. Requests include the actual activity details, recent messages and poll choices. Joining a community activity or pressing “I'd go with someone” opens its group with pre-existing conversation and no automatic typing. New community events retain the price you set, appear in the demo catalog, have fictional students join gradually, and get a working chat. Cast votes use the normal poll records and tallies.

Demo RSVP records now map to canonical activity interest records, so the five-a-side join button grants actual chat membership. Created-event hosts are members automatically, and **Open group chat** reopens their conversation. Demo AI failures show an explicit retry in the affected chat. Exiting disposes pending requests and drops the session. Preferences, friends, participants, events, chat messages and votes are never written to the real app's shared data files; the AI transport still uses temporary request files as described above.

`node --test MYT/tools/demo-session.test.mjs` checks populated catalogs, pitch membership, automatic contextual replies, priced event creation, poll voting, private-chat participants, interested companions, retries, cancellation and isolation from real data. Live OpenAI checks also passed over the same file transport used inside Lightfern.


Demo pacing: joining never calls OpenAI or shows typing. Existing group history is already present when you join. Replies begin only after you send a text: a short reading pause, then a typing indicator for the actual replying student, then one message at a time with gaps. Typing lasts roughly 2–6.5 seconds depending on message length. New events initially contain only their host; the first demo participant joins after 3.5–5.5 seconds and others follow at 2.5–4.5 second intervals, leaving short messages without typing animation. Poll votes also arrive individually. Exiting cancels both responses and delayed joins.

The older standalone Saturday football sample group also enables AI on join. Its canned-reply generator has been removed. Sending “hi” invokes OpenAI with the recent conversation and the sample cast; unavailable or empty model responses show Retry rather than a scripted substitute. Existing seeded history is unchanged.

Messages sent immediately after creating a demo event are queued while the host is alone. The first demo participant joining triggers a contextual AI reply to the waiting viewer message, with the normal paced typing. A waiting status is shown instead of silently dropping the message. A regression test covers sending “hi” before anyone joins.

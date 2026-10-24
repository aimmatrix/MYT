# MYT

**Turn a shared interest into an actual plan.** MYT is a Lightfern app for London university students. You use it to find something to do (a five-a-side game, karting, a film, a gig), see who else would go, agree on a time and lock in a plan together.

Built for the Lightfern hackathon, October 2026.

## What it does

- **Discover:** activities matched to your interests, availability and budget. Each card says why it fits you, what it costs and where the listing came from. It never shows an invented match score.
- **Meet:** send requests to other students and see live presence ("Viewing") on any activity.
- **Chat and polls:** group chats with typing indicators, polls and time polls.
- **Confirm plan:** the organiser picks the final time and a public meeting point. Everyone then marks themselves **I'm going** explicitly.
- **My plans:** saved plans that survive reopening and sync to the other participants' devices.

MYT never books tickets. Event links go to the original organiser's listing.

## How it's built

- **App** (`code/`): React 19 on the Lightfern SDK. Each person writes only their own JSON records under `data/` (profiles, interests, votes, attendance, chats). File watching syncs changes between people. Presence runs over one multiplayer room (`myt-v1`). `host.ts` is the only boundary between the app and the SDK.
- **Activity importer** (`tools/refresh-sources.mjs`): a Node 22 script that normalises listings from Ticketmaster, Skiddle, Luma, SerpApi, Google Places, OpenStreetMap, TMDB and MovieGlu into `data/activities.json`. API keys stay in a private env file and never reach the bundle. See [tools/README.md](tools/README.md).
- **AI demo students** (`tools/ai-*.mjs`): a small server that uses OpenAI to write replies and poll votes for fictional, clearly labelled sample students. It's there so you can try the social flow solo.
- **Browser demo** (`demo/index.html`): a standalone build with fictional fixture accounts. It never writes to the shared data folder.

## Run

```sh
# Refresh the activity catalog (keys in a private env file; see tools/api.env.example)
node --env-file=/path/to/api.env tools/refresh-sources.mjs

# Tests
node --test tools/*.test.mjs

# Rebuild the standalone demo
node tools/build-demo.cjs
```

Open `demo/index.html` in a browser for a no-setup walkthrough. To run the full app, install it into Lightfern from `code/manifest.json`.

## Docs

The design and planning docs are in [Planning/](Planning/): [Architecture](Planning/Architecture.md), [Design](Planning/Design.md), [Contract](Planning/Contract.md), [Integration](Planning/Integration.md), [QA](Planning/QA.md) and the [demo script](Planning/Demo%20script.md).

## Honesty rules

The app makes no claim it can't back up. "Saved" means saved on this device, because the SDK has no sync-complete signal. Sample profiles are always labelled fictional and never count towards Viewing, Interested or Going. Votes are advice, and only the organiser confirms a plan.

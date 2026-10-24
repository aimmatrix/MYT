import { readFile, writeFile, rename, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROVIDERS, fetchProvider, mergeCatalog, eventbriteIds, liveCatalog } from './providers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = join(root, 'data');
const args = process.argv.slice(2);
const selection = args.find(arg => arg.startsWith('--providers='))?.slice(12);
const selected = selection ? selection.split(',') : Object.keys(PROVIDERS);
if (selected.some(name => !Object.hasOwn(PROVIDERS, name))) {
  console.error('Unknown provider. Choose: ' + Object.keys(PROVIDERS).join(', '));
  process.exit(1);
}
const catalogPath = join(dataDir, 'activities.json');
const original = await readFile(catalogPath, 'utf8');
const catalog = JSON.parse(original);
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error('Invalid existing activity catalog');
const protectedIds = new Set();
async function protect(folder) {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await protect(path);
    else if (entry.name.endsWith('.json')) {
      // An unreadable/malformed record aborts rather than risking changing a referenced slot.
      const record = JSON.parse(await readFile(path, 'utf8'));
      if (record.activityId) protectedIds.add(record.activityId);
    }
  }
}
await Promise.all(['interests', 'votes', 'plans'].map(folder => protect(join(dataDir, folder))));
const statuses = [];
const batches = [];
const providerEnv = { ...process.env,
  EVENTBRITE_EVENT_IDS: eventbriteIds(catalog, process.env.EVENTBRITE_EVENT_IDS).join(','),
};
for (const provider of selected) {
  try {
    const result = await fetchProvider(provider, providerEnv);
    batches.push(result);
    statuses.push({ provider, label: PROVIDERS[provider].label, state: result.state,
      count: result.items.length, missing: result.missing ?? [], checkedAt: new Date().toISOString() });
    console.log(`${provider}: ${result.state}, ${result.items.length} activities${result.missing?.length ? ' (needs ' + result.missing.join(', ') + ')' : ''}`);
  } catch (error) {
    // fetchProvider deliberately emits only safe, fixed errors. Never print raw fetch exceptions.
    const message = /^(Network request failed or timed out|Provider returned HTTP \d+|Provider returned invalid JSON|Unexpected \w+ response|.*(?:changed shape|event results|incomplete data|cinema response|showtime response))$/.test(error.message)
      ? error.message : 'Provider request or normalization failed';
    statuses.push({ provider, label: PROVIDERS[provider].label, state: 'error', count: 0, message, checkedAt: new Date().toISOString() });
    console.log(`${provider}: ${message}; previous catalog entries retained`);
  }
}
if (args.includes('--dry-run')) {
  console.log('Dry run: no catalog or status files written.');
} else {
  const merged = liveCatalog(mergeCatalog(catalog, batches, protectedIds), protectedIds);
  // Guard against another process editing the catalog while requests were in flight.
  if (await readFile(catalogPath, 'utf8') !== original) throw new Error('Catalog changed during refresh; rerun to preserve those edits');
  async function atomic(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(content), { flag: 'wx' });
    await rename(temp, path);
  }
  if (JSON.stringify(merged) !== JSON.stringify(catalog)) await atomic(catalogPath, merged);
  const statusPath = join(dataDir, 'source-status.json');
  let previousStatuses = [];
  try {
    const previous = JSON.parse(await readFile(statusPath, 'utf8'));
    if (Array.isArray(previous.providers)) previousStatuses = previous.providers;
  } catch { /* The first refresh has no previous report. */ }
  const reports = new Map(previousStatuses.map(report => [report.provider, report]));
  for (const report of statuses) reports.set(report.provider, report);
  await atomic(statusPath, { schemaVersion: 1, checkedAt: new Date().toISOString(), providers: [...reports.values()] });
  console.log(`Catalog: ${merged.items.length} activities; ${protectedIds.size} referenced activities protected.`);
}
if (statuses.some(status => status.state === 'error')) process.exitCode = 1;

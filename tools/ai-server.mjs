import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AiError, recommend, simulate, simulatePollVotes } from './ai-service.mjs';
import { startAiFileWorker } from './ai-file-worker.mjs';

export function createAiServer({ env = process.env, recommendFn = recommend, simulateFn = simulate, pollVotesFn = simulatePollVotes } = {}) {
  const port = Number(env.MYT_AI_PORT || 8787);
  const ownOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const allowedOrigins = new Set([...ownOrigins, ...(env.MYT_AI_ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
  let active = 0;
  const hits = [];
  return createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      // Bind to loopback and validate Host too, preventing DNS rebinding.
      if (!ownOrigins.some(o => new URL(o).host === req.headers.host)) return json(403, { error: 'Host not allowed.' });
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return json(403, { error: 'Origin not allowed. Configure MYT_AI_ALLOWED_ORIGINS for your app.' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204); return res.end();
      }
      if (req.method === 'GET' && req.url === '/api/ai/status') return json(200, { configured: !!env.OPENAI_API_KEY });
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const html = await readFile(fileURLToPath(new URL('../demo/index.html', import.meta.url)));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
      }
      if (req.method !== 'POST' || !['/api/ai/recommendations', '/api/ai/chat', '/api/ai/poll-votes'].includes(req.url)) return json(404, { error: 'Not found.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required.' });
      while (hits.length && hits[0] < Date.now() - 60_000) hits.shift();
      if (hits.length >= 20 || active >= 3) return json(429, { error: 'Too many AI requests. Try again shortly.' });
      hits.push(Date.now());
      let raw = ''; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 64_000) throw new AiError('Request too large.', 413); raw += chunk; }
      let body; try { body = JSON.parse(raw); } catch { throw new AiError('Invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AiError('Invalid request.');
      // Recheck after reading the body: simultaneous uploads must respect the concurrency cap.
      if (active >= 3) return json(429, { error: 'Too many AI requests. Try again shortly.' });
      active++;
      try { json(200, await (req.url.endsWith('/chat') ? simulateFn : req.url.endsWith('/poll-votes') ? pollVotesFn : recommendFn)(body, { env })); }
      finally { active--; }
    } catch (error) { json(error instanceof AiError ? error.status : 500, { error: error instanceof AiError ? error.message : 'AI service unavailable.' }); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MYT_AI_PORT || 8787);
  const stopWorker = await startAiFileWorker();
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => { await stopWorker(); process.exit(0); });
  console.log('MYT AI Lightfern file service ready.');
  createAiServer().listen(port, '127.0.0.1', () => console.log(`MYT AI demo: http://127.0.0.1:${port}`));
}

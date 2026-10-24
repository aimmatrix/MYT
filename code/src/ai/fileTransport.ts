/** Lightfern sandbox transport. All requests go through the allowed SDK file API. */
export interface AiFilePort {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string, options: { overwrite: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
}
const ROOT = 'ai-runtime';
export function createFileAiRequest(files: AiFilePort) {
  return async function request<T>(kind: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const check = () => { if (signal?.aborted) throw new Error('AI request cancelled or timed out.'); };
    check();
    let status;
    try { status = JSON.parse(await files.readText(`${ROOT}/status.json`)); } catch { /* Friendly error below. */ }
    if (!status || !Number.isFinite(status.updatedAt) || Date.now() - status.updatedAt > 10_000 || !status.configured) {
      throw new Error('The local MYT AI service is offline or has no key configured. Start the service, then retry.');
    }
    const id = crypto.randomUUID();
    const requestPath = `${ROOT}/requests/${id}.json`, responsePath = `${ROOT}/responses/${id}.json`;
    const createdAt = Date.now();
    const text = JSON.stringify({ schemaVersion: 1, id, kind, payload, createdAt, expiresAt: createdAt + 40_000 });
    if (new TextEncoder().encode(text).length > 64_000) throw new Error('This AI request is too large.');
    try {
      check();
      await files.writeText(requestPath, text, { overwrite: false });
      while (Date.now() - createdAt < 40_000) {
        check();
        let raw: string | undefined;
        try { raw = await files.readText(responsePath); } catch { /* Worker has not answered yet. */ }
        if (raw) {
          const response = JSON.parse(raw);
          if (response.id !== id) throw new Error('AI response did not match this request.');
          if (!response.ok) throw new Error(response.error || 'AI request failed. Try again.');
          return response.result as T;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The AI service took too long. Try again.');
    } finally {
      await Promise.allSettled([files.remove(requestPath), files.remove(responsePath)]);
    }
  };
}

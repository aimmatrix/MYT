import { createFileAiRequest } from "./ai/fileTransport";
import { connect } from "lightfern:host";
import type { CurrentUser } from "./types";
import type { FileChange, FileEntry, MytFilePort } from "./data-contract";

// The only module that talks to the Lightfern SDK. One connection per view.
export const ctx = await connect();

const decoder = new TextDecoder();

export const filePort: MytFilePort = {
  async readText(path) {
    const content = await ctx.files.read(path, "utf-8");
    return typeof content === "string" ? content : decoder.decode(content);
  },
  async writeText(path, text, options) {
    await ctx.files.write(path, text, { overwrite: options.overwrite });
  },
  async list(path) {
    const entries = await ctx.files.list(path);
    return entries.map((e): FileEntry => ({ path: e.path, name: e.name, kind: e.kind }));
  },
  watch(path, listener) {
    return ctx.files.watch(path, (change: FileChange) => listener({ type: change.type, path: change.path }));
  },
};

/** Maps the SDK user to MYT's narrow shape. Signed out is `null`. */
export function toCurrentUser(
  user: { id: string; name: string | null; email?: string | null } | null
): CurrentUser | null {
  if (!user) return null;
  return { id: user.id, name: user.name ?? "Student" };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// Multiplayer and identity hooks are re-exported so other modules never import the SDK directly.
export { useConnected, usePeers, useSetPresence, useCurrentUser } from "lightfern:host/react";

// The app sandbox has no HTTP localhost access; use the host file capability.
export const aiRequest = createFileAiRequest({ ...filePort, remove: path => ctx.files.delete(path) });

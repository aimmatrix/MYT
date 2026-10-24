declare module "lightfern:host" {
  export interface FileEntry { path: string; name: string; kind: "file" | "folder" }
  export interface FileChange { type: "created" | "changed" | "deleted"; path: string }
  export interface Peer<P> { peerId: string; user: { id: string; name: string | null; profilePictureUrl: string | null }; presence: P | null }
  export interface Ctx {
    path: string; homePath: string; pluginId: string; fileId: string | null;
    currentUser: { id: string; email: string; name: string | null; profilePictureUrl: string | null } | null;
    open(path: string, newTab?: boolean): void;
    files: {
      read(path: string, encoding?: "utf-8" | "binary"): Promise<string | Uint8Array>;
      write(path: string, content: string | Uint8Array, options?: { overwrite?: boolean }): Promise<void>;
      list(path: string): Promise<FileEntry[]>;
      watch(path: string, listener: (c: FileChange) => void): () => void;
      delete(path: string): Promise<void>;
    };
  }
  export function connect(): Promise<Ctx>;
}
declare module "lightfern:host/react" {
  import type { Peer } from "lightfern:host";
  export function useConnected(name: string): boolean;
  export function usePeers<P = unknown>(name: string): readonly Peer<P>[];
  export function useSetPresence<P = unknown>(name: string): (presence: P | null) => void;
  export function useCurrentUser(): { id: string; email: string; name: string | null; profilePictureUrl: string | null } | null;
}
declare module "react-dom/client" {
  export function createRoot(el: Element | DocumentFragment): { render(node: unknown): void };
}

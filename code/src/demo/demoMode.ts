import { useCallback, useSyncExternalStore } from "react";

/*
 * Demo mode switch. Off by default. Persisted in localStorage when the sandboxed frame allows it,
 * otherwise kept in memory for this view only.
 */
const STORAGE_KEY = "myt.demoMode.v1";
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let current = readStored();

export function isDemoModeOn(): boolean {
  return current;
}

export function setDemoMode(on: boolean): void {
  current = on;
  try {
    if (on) globalThis.localStorage?.setItem(STORAGE_KEY, "on");
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage is blocked in this frame. The in-memory value still applies until the view closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDemoMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, isDemoModeOn, isDemoModeOn);
  const set = useCallback((next: boolean) => setDemoMode(next), []);
  return [on, set];
}

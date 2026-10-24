import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult, ActionState, CreatePlanResult, MytError, MytErrorCode } from "../types";

type Result<Value> = ActionResult<Value> | CreatePlanResult;

const messages: Record<MytErrorCode, string> = {
  "not-found": "The saved item could not be found. Refresh and try again.",
  "invalid-json": "Some saved data could not be read. Refresh and try again.",
  "invalid-record": "Some saved data is invalid. Refresh and try again.",
  "unsupported-schema": "This saved data needs a newer version of MYT.",
  "already-exists": "This item has already been saved. Refresh to see it.",
  "id-invalid": "Your account ID cannot be used for this action.",
  "not-signed-in": "Sign in to save this change.",
  "not-allowed": "This change is not available right now. Refresh and try again.",
  preview: "Preview mode does not save changes.",
  io: "The change could not be saved on this device. Check your connection and try again.",
};

function safeError(error: MytError): MytError {
  const code = Object.hasOwn(messages, error.code) ? error.code : "io";
  return { code, message: messages[code] };
}

function unexpectedError(): MytError {
  return { code: "io", message: messages.io };
}

export interface AsyncAction<Value, Args extends unknown[]> {
  state: ActionState;
  run: (...args: Args) => Promise<Result<Value> | null>;
  clear: () => void;
  reset: () => void;
}

export function useAsyncAction<Value, Args extends unknown[]>(
  action: (...args: Args) => Promise<Result<Value>>,
  scopeKey?: string,
): AsyncAction<Value, Args> {
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const actionRef = useRef(action);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  actionRef.current = action;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    activeRef.current = false;
    setState({ status: "idle" });
  }, [scopeKey]);

  const run = useCallback(async (...args: Args): Promise<Result<Value> | null> => {
    if (activeRef.current) return null;
    activeRef.current = true;
    const generation = ++generationRef.current;
    setState({ status: "pending" });
    let result: Result<Value>;
    try {
      result = await actionRef.current(...args);
    } catch {
      result = { ok: false, error: unexpectedError() };
    }
    if (!result.ok) result = { ok: false, error: safeError(result.error) };
    if (mountedRef.current && generation === generationRef.current) {
      activeRef.current = false;
      if (result.ok) {
        const existing = "kind" in result && result.kind === "existing";
        setState(existing ? { status: "idle" } : { status: "saved", at: new Date().toISOString() });
      } else {
        setState({ status: "error", error: result.error, retry: () => { void run(...args); } });
      }
    }
    return result;
  }, []);

  const clear = useCallback(() => {
    if (!activeRef.current) setState({ status: "idle" });
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    activeRef.current = false;
    if (mountedRef.current) setState({ status: "idle" });
  }, []);

  return { state, run, clear, reset };
}

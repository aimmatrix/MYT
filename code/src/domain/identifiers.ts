/**
 * Opaque domain IDs <-> portable filename components.
 *
 * An ID is mapped to "id-" + lowercase hex of its UTF-8 bytes. The result
 * contains only [a-z0-9-], so a slash, "..", percent sequence, colon or space
 * inside an ID can never act as a path separator or escape. IDs are compared
 * exactly: no case folding, trimming, Unicode normalisation or decoding.
 *
 * This module returns filename components and plan IDs only. It never builds
 * absolute paths (G1 owns the data/ folder builders). An encoded key is an
 * identifier, not a credential: it is trivially reversible and proves nothing.
 *
 * Exact limits (keep validation and path helpers in step with these):
 *   - ID:               1..120 UTF-8 bytes (MAX_ID_UTF8_BYTES)
 *   - key:              "id-" + 2 hex chars per byte, so 5..243 chars (MAX_KEY_LENGTH)
 *   - key + ".json":    at most 248 chars, inside the common 255-char filename limit
 *   - plan ID:          "plan:" + activity ID, itself a valid ID (<= 120 bytes),
 *                       so an activity ID can be at most 115 UTF-8 bytes
 */

export const ID_KEY_PREFIX = "id-";
export const PLAN_ID_PREFIX = "plan:";
export const MAX_ID_UTF8_BYTES = 120;
export const MAX_KEY_LENGTH = ID_KEY_PREFIX.length + MAX_ID_UTF8_BYTES * 2;

const KEY_PATTERN = /^id-(?:[0-9a-f]{2})+$/;
const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

const utf8Encoder = new TextEncoder();
// ignoreBOM keeps a leading U+FEFF in the output so it round-trips exactly.
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function isAsciiControl(codeUnit: number): boolean {
  return codeUnit <= 0x1f || codeUnit === 0x7f;
}

/** Returns a human-readable reason the ID is invalid, or null when it is valid. */
function findIdProblem(id: unknown): string | null {
  if (typeof id !== "string") {
    return `ID must be a string, got ${id === null ? "null" : typeof id}`;
  }
  if (id.length === 0) {
    return "ID must not be empty";
  }
  // Every UTF-16 code unit is at least one UTF-8 byte, so this bounds the work
  // done on hostile input before scanning or encoding it.
  if (id.length > MAX_ID_UTF8_BYTES) {
    return `ID is longer than ${MAX_ID_UTF8_BYTES} UTF-8 bytes (${id.length} UTF-16 code units)`;
  }

  for (let index = 0; index < id.length; index += 1) {
    const codeUnit = id.charCodeAt(index);
    if (isAsciiControl(codeUnit)) {
      return `ID contains an ASCII control character (U+${codeUnit.toString(16).toUpperCase().padStart(4, "0")}) at index ${index}`;
    }
    if (codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END) {
      const next = index + 1 < id.length ? id.charCodeAt(index + 1) : -1;
      if (next >= LOW_SURROGATE_START && next <= LOW_SURROGATE_END) {
        index += 1;
        continue;
      }
      return `ID contains an unpaired high surrogate at index ${index}`;
    }
    if (codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END) {
      return `ID contains an unpaired low surrogate at index ${index}`;
    }
  }

  const byteLength = utf8Encoder.encode(id).length;
  if (byteLength > MAX_ID_UTF8_BYTES) {
    return `ID is ${byteLength} UTF-8 bytes; the limit is ${MAX_ID_UTF8_BYTES}`;
  }
  return null;
}

function assertValidId(id: unknown, label: string): asserts id is string {
  const problem = findIdProblem(id);
  if (problem !== null) {
    throw new Error(`${label}: ${problem}`);
  }
}

function bytesToLowerHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** True when `id` is a string satisfying every ID rule. Never throws. */
export function isValidId(id: unknown): boolean {
  return findIdProblem(id) === null;
}

/** Encodes an ID as "id-" + lowercase hex UTF-8. Throws a descriptive Error for invalid IDs. */
export function keyForId(id: string): string {
  assertValidId(id, "keyForId");
  return ID_KEY_PREFIX + bytesToLowerHex(utf8Encoder.encode(id));
}

/**
 * Decodes a key produced by keyForId. Accepts only the canonical form and
 * throws a descriptive Error for anything else.
 */
export function idFromKey(key: string): string {
  if (typeof key !== "string") {
    throw new Error(`idFromKey: key must be a string, got ${key === null ? "null" : typeof key}`);
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`idFromKey: key is longer than ${MAX_KEY_LENGTH} characters (${key.length})`);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `idFromKey: key must be "${ID_KEY_PREFIX}" followed by an even number (at least 2) of lowercase hex digits`,
    );
  }

  const hex = key.slice(ID_KEY_PREFIX.length);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  let id: string;
  try {
    id = strictUtf8Decoder.decode(bytes);
  } catch {
    throw new Error("idFromKey: key does not contain valid UTF-8");
  }

  const problem = findIdProblem(id);
  if (problem !== null) {
    throw new Error(`idFromKey: decoded ID is invalid: ${problem}`);
  }
  if (keyForId(id) !== key) {
    throw new Error("idFromKey: key is not canonical (re-encoding does not match)");
  }
  return id;
}

/**
 * Plan ID for an activity: exactly "plan:" + activityId. Version 1 has one plan
 * per activity. Both the activity ID and the derived plan ID must be valid, so
 * an activity ID may be at most MAX_ID_UTF8_BYTES - PLAN_ID_PREFIX.length (115) bytes.
 */
export function planIdForActivity(activityId: string): string {
  assertValidId(activityId, "planIdForActivity: activityId");
  const planId = PLAN_ID_PREFIX + activityId;
  assertValidId(planId, "planIdForActivity: derived plan ID");
  return planId;
}

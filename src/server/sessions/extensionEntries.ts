import { SESSION_EXTENSION_ENTRY_LIMIT, type SessionExtensionEntry } from "../../shared/apiTypes.js";

/**
 * Most recent extension entries forwarded for one session.
 *
 * Pi sessions accumulate entries for the lifetime of the session, and this endpoint is served
 * to browsers, so the payload has to stay bounded. Older entries are dropped rather than
 * truncated in the middle, so a plugin always sees whole entries.
 */
export const MAX_SESSION_EXTENSION_ENTRIES = SESSION_EXTENSION_ENTRY_LIMIT;

/**
 * Largest serialized `data` forwarded for a single entry.
 *
 * `data` is written by an extension and is opaque here, so an entry that exceeds the limit is
 * still reported, with `dataOmitted` set instead of a payload. Reporting the entry keeps the
 * entry stream intact for readers that track identity or ordering.
 */
export const MAX_SESSION_EXTENSION_ENTRY_DATA_BYTES = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function serializedByteLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    // Typed as unknown on purpose: JSON.stringify is declared to return string, but it returns
    // undefined for inputs it cannot represent, such as a function or a symbol.
    const serialized: unknown = JSON.stringify(value);
    return typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : 0;
  } catch {
    // A value an extension wrote may not be serializable, for example when it contains a cycle.
    // Treat it as oversized so it is reported without a payload instead of failing the request.
    return MAX_SESSION_EXTENSION_ENTRY_DATA_BYTES + 1;
  }
}

/**
 * Normalize one Pi session entry into an extension entry, or `undefined` when the entry is not
 * an extension-owned custom entry.
 *
 * Pi persists extension state as `custom` entries and keeps them out of the model context. This
 * is the only projection PI WEBUI performs: the entry's `customType` and `data` belong to the
 * writing extension and are never interpreted here.
 */
export function sessionExtensionEntry(entry: unknown): SessionExtensionEntry | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom") return undefined;
  const customType = typeof entry["customType"] === "string" ? entry["customType"].trim() : "";
  if (customType === "") return undefined;

  const normalized: SessionExtensionEntry = {
    customType,
    entryId: typeof entry["id"] === "string" ? entry["id"] : "",
    timestamp: typeof entry["timestamp"] === "string" ? entry["timestamp"] : "",
  };
  if (!Object.prototype.hasOwnProperty.call(entry, "data")) return normalized;

  const data = entry["data"];
  // An extension that wrote no payload is reported the same way whether it omitted `data` or
  // set it to undefined, so readers never have to distinguish the two.
  if (data === undefined) return normalized;
  if (serializedByteLength(data) > MAX_SESSION_EXTENSION_ENTRY_DATA_BYTES) {
    return { ...normalized, dataOmitted: true };
  }
  return { ...normalized, data };
}

/**
 * Collect the extension entries that a session branch carries, oldest first.
 *
 * Conversation history is not the right place for these entries: they are state written by an
 * extension, not chat content, so they are exposed separately for plugins that render them.
 */
export function sessionExtensionEntriesFromBranch(branch: readonly unknown[]): SessionExtensionEntry[] {
  const entries: SessionExtensionEntry[] = [];
  for (const entry of branch) {
    const normalized = sessionExtensionEntry(entry);
    if (normalized !== undefined) entries.push(normalized);
  }
  return entries.length > MAX_SESSION_EXTENSION_ENTRIES
    ? entries.slice(entries.length - MAX_SESSION_EXTENSION_ENTRIES)
    : entries;
}

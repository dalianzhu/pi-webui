import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiSessionManager } from "./piSessionService.js";

/**
 * SDK fork() opens an independent manager and can commit a child JSONL before
 * teardown/createRuntime/apply. Neither the outgoing manager nor runtime ID
 * records that commit. Observe the durable store directly, including custom
 * session directories, without going through the service's live/list cache.
 *
 * This is an operation-scoped probe, not a directory watcher: only newly listed
 * files whose persisted parent is this source count as evidence. Existing
 * children and unrelated session files cannot turn a failed fork into a commit.
 */
export async function captureDurableForkCommit(
  manager: PiSessionManager,
): Promise<() => Promise<boolean>> {
  if (!(manager instanceof SessionManager) || !manager.isPersisted())
    return () => Promise.resolve(false);
  const sourceFile = manager.getSessionFile();
  if (sourceFile === undefined) return () => Promise.resolve(false);
  const cwd = manager.getCwd();
  const sessionDir = manager.getSessionDir();
  // Capture file names, not best-effort parsed records: an unreadable existing
  // transcript must not be mistaken for a new commit if it becomes readable.
  const before = new Set((await readdir(sessionDir)).map((name) => join(sessionDir, name)));
  return async () => (await SessionManager.list(cwd, sessionDir)).some((record) =>
    !before.has(record.path) && record.parentSessionPath === sourceFile,
  );
}

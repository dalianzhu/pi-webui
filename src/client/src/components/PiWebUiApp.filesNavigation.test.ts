import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { FileExplorerController } from "../controllers/fileExplorerController";
import { PiWebUiApp } from "./PiWebUiApp";

function appHarness() {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  const app = new PiWebUiApp();
  const files: unknown = Reflect.get(app, "files");
  if (!(files instanceof FileExplorerController)) throw new Error("Files controller unavailable");
  const restore = vi.spyOn(files, "restoreRememberedFile").mockResolvedValue(undefined);
  const changed = vi.spyOn(files, "workspaceChanged");
  const method: unknown = Reflect.get(app, "synchronizeFileNavigation");
  if (typeof method !== "function") throw new Error("Files navigation boundary unavailable");
  const sync = (previous: AppState, next: AppState) => { method.call(app, previous, next); };
  return { app, restore, changed, sync };
}
function selected(projectId: string, workspaceId = "main", machineId = "local"): AppState {
  return { ...initialAppState(), selectedProject: { id: projectId, name: projectId, path: `/${projectId}`, createdAt: "now" }, selectedWorkspace: { id: workspaceId, projectId, path: `/${projectId}/${workspaceId}`, label: workspaceId, isMain: true, isGitRepo: true, isGitWorktree: false }, selectedMachine: { id: machineId, name: machineId, kind: "local", createdAt: "now", updatedAt: "now" } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PiWebUiApp Files navigation integration", () => {
  it("restores on project/workspace/machine changes, even when workspace ids match", () => {
    const h = appHarness();
    const a = selected("a");
    h.sync(a, selected("b"));
    h.sync(a, selected("a", "branch"));
    h.sync(a, selected("a", "main", "remote"));
    expect(h.changed).toHaveBeenCalledTimes(3);
    expect(h.restore).toHaveBeenCalledTimes(3);
    h.sync(a, { ...a, selectedFilePath: "new.ts" });
    expect(h.restore).toHaveBeenCalledTimes(3);
    h.sync(a, initialAppState());
    expect(h.changed).toHaveBeenCalledTimes(4);
    expect(h.restore).toHaveBeenCalledTimes(3);
  });

  it("defers remembered restoration while an explicit route is being selected", () => {
    const h = appHarness();
    Reflect.set(h.app, "routeRestoreDepth", 1);
    h.sync(initialAppState(), selected("a"));
    expect(h.changed).toHaveBeenCalledOnce();
    expect(h.restore).not.toHaveBeenCalled();
  });

  it("passes explicit route files to the same restore entry point, or falls back to memory", async () => {
    const h = appHarness();
    const method: unknown = Reflect.get(h.app, "refreshRestoredWorkspaceTool");
    if (typeof method !== "function") throw new Error("Route tool restoration unavailable");
    await method.call(h.app, "core:workspace.files", "linked.ts");
    expect(h.restore).toHaveBeenLastCalledWith("linked.ts");
    await method.call(h.app, "core:workspace.files", undefined);
    expect(h.restore).toHaveBeenLastCalledWith(undefined);
    await method.call(h.app, undefined, undefined);
    expect(h.restore).toHaveBeenCalledTimes(3);
    await method.call(h.app, "core:workspace.terminal", undefined);
    expect(h.restore).toHaveBeenCalledTimes(4);
  });
});

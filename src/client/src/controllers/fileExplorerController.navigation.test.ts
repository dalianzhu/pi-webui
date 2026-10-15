import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, resetWorkspaceScopedState } from "../appState";
import type { FileContentResponse, FileTreeResponse } from "../api";
import { FileExplorerController, type FileExplorerControllerDependencies } from "./fileExplorerController";
import { FileNavigationMemory, fileWorkspaceKey } from "./fileNavigationMemory";

type FilesApi = NonNullable<FileExplorerControllerDependencies["api"]>;
const content = (path: string, text = path): FileContentResponse => ({ path, content: text, size: text.length, encoding: "utf8", modifiedAt: "now", binary: false, truncated: false });
const tree = (path = ""): FileTreeResponse => ({ path, entries: [], scannedAt: "now", truncated: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<FilesApi> = {}, memory = new FileNavigationMemory({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })) {
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: new URL("http://localhost/app"), history: { pushState: vi.fn(), replaceState: vi.fn() } }));
  let state = initialAppState();
  const api: FilesApi = {
    workspaceTree: vi.fn<FilesApi["workspaceTree"]>((_projectId, _workspaceId, path = "") => Promise.resolve(tree(path))),
    workspaceFile: vi.fn<FilesApi["workspaceFile"]>((_projectId, _workspaceId, path) => Promise.resolve(content(path))),
    ...overrides,
  };
  const controller = new FileExplorerController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { api, memory });
  function select(projectId = "a", workspaceId = "main", machineId = "local") {
    controller.workspaceChanged();
    state = { ...state, ...resetWorkspaceScopedState(), selectedMachine: { id: machineId, name: machineId, kind: machineId === "local" ? "local" : "remote", createdAt: "now", updatedAt: "now" }, selectedProject: { id: projectId, name: projectId, path: `/${projectId}`, createdAt: "now" }, selectedWorkspace: { id: workspaceId, projectId, path: `/${projectId}/${workspaceId}`, label: workspaceId, isMain: workspaceId === "main", isGitRepo: true, isGitWorktree: workspaceId !== "main" } };
  }
  select();
  return { controller, api, memory, select, get state() { return state; }, get key() { return fileWorkspaceKey(state) ?? ""; } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Files navigation restore", () => {
  it("restores each project's last file, parent chain and reading line", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.controller.selectFile("src/deep/a.ts");
    h.controller.rememberTopLine(h.key, "src/deep/a.ts", 45);
    h.select("b");
    await h.controller.selectFile("other.ts");
    h.select("a");
    await h.controller.restoreRememberedFile();
    expect(h.state.selectedFilePath).toBe("src/deep/a.ts");
    expect(h.state.selectedFileContent?.content).toBe("src/deep/a.ts");
    expect(h.state.selectedFileTopLine).toBe(45);
    expect(Object.keys(h.state.expandedDirs)).toEqual(["src", "src/deep"]);
    vi.runAllTimers();
  });

  it("uses explicit route files over memory, without leaking a different file's line", async () => {
    const h = harness();
    h.memory.remember(h.key, "remembered.ts", 80);
    await h.controller.restoreRememberedFile("linked.ts");
    expect(h.state.selectedFilePath).toBe("linked.ts");
    expect(h.state.selectedFileTopLine).toBe(1);
    expect(h.memory.latest(h.key)).toEqual({ path: "linked.ts", topLine: 1 });
  });

  it("does not inherit files across worktrees or machines, and no memory means no file read", async () => {
    const h = harness();
    await h.controller.selectFile("README.md");
    h.select("a", "branch");
    await h.controller.restoreRememberedFile();
    expect(h.state.selectedFilePath).toBeUndefined();
    h.select("a", "main", "remote");
    await h.controller.restoreRememberedFile();
    expect(h.state.selectedFilePath).toBeUndefined();
    expect(h.api.workspaceFile).toHaveBeenCalledTimes(1);
  });

  it("clears missing-file memory, but preserves it on network/permission failure", async () => {
    for (const message of ["ENOENT", "network offline", "Permission denied"]) {
      const h = harness({ workspaceFile: vi.fn(() => Promise.reject(new Error(message))) });
      h.memory.remember(h.key, "a.ts", 10);
      await h.controller.restoreRememberedFile();
      if (message === "ENOENT") {
        expect(h.memory.latest(h.key)).toBeUndefined();
        expect(h.state.selectedFilePath).toBeUndefined();
        expect(h.state.error).toBe("");
      } else {
        expect(h.memory.latest(h.key)).toEqual({ path: "a.ts", topLine: 10 });
        expect(h.state.error).toContain(message);
      }
    }
  });

  it("clears memory when a parent disappears after the file was read", async () => {
    const h = harness({ workspaceTree: vi.fn((_p, _w, path) => path === "src" ? Promise.reject(new Error("ENOENT")) : Promise.resolve(tree())) });
    h.memory.remember(h.key, "src/a.ts", 10);
    await h.controller.restoreRememberedFile();
    expect(h.memory.latest(h.key)).toBeUndefined();
    expect(h.state.selectedFilePath).toBeUndefined();
  });

  it("does not store a text reading line for images or binary files", async () => {
    const h = harness({ workspaceFile: vi.fn<FilesApi["workspaceFile"]>((_p, _w, path) => Promise.resolve({ ...content(path), mediaType: "image" })) });
    await h.controller.selectFile("a.png");
    expect(h.memory.latest(h.key)).toEqual({ path: "a.png" });
  });
});

describe("Files request ordering and collapse", () => {
  it("keeps file content, memory and reading line while collapse and Refresh leave only root entries", async () => {
    const h = harness();
    h.memory.remember(h.key, "src/a.ts", 20);
    await h.controller.restoreRememberedFile();
    const before = h.state.selectedFileContent;
    h.controller.collapseAll();
    await h.controller.refreshFiles();
    expect(h.state.expandedDirs).toEqual({});
    expect(h.state.selectedFileContent).toBe(before);
    expect(h.state.selectedFileTopLine).toBe(20);
    expect(h.memory.latest(h.key)).toEqual({ path: "src/a.ts", topLine: 20 });
    h.select("b");
    h.select("a");
    await h.controller.restoreRememberedFile();
    expect(h.state.expandedDirs).toHaveProperty("src");
  });

  it("ignores an old file response after A → B → A, even with the same file path", async () => {
    const old = deferred<FileContentResponse>();
    const h = harness({ workspaceFile: vi.fn().mockReturnValueOnce(old.promise).mockImplementation((_p: string, _w: string, path: string) => Promise.resolve(content(path, "new"))) });
    const pending = h.controller.selectFile("README.md");
    h.select("b");
    h.select("a");
    await h.controller.selectFile("README.md");
    old.resolve(content("README.md", "stale"));
    await pending;
    expect(h.state.selectedFileContent?.content).toBe("new");
  });

  it("does not override a user selection while remembered root loading is pending", async () => {
    const root = deferred<FileTreeResponse>();
    const h = harness({ workspaceTree: vi.fn(() => root.promise) });
    h.memory.remember(h.key, "old.ts", 40);
    const pending = h.controller.restoreRememberedFile();
    await h.controller.selectFile("new.ts");
    root.resolve(tree());
    await pending;
    expect(h.state.selectedFilePath).toBe("new.ts");
    expect(h.api.workspaceFile).toHaveBeenCalledTimes(1);
  });

  it("does not let pending directory, refresh or automatic reveal undo collapse", async () => {
    for (const operation of ["expand", "refresh", "restore"]) {
      const pendingTree = deferred<FileTreeResponse>();
      const h = harness();
      await h.controller.selectFile("src/a.ts");
      vi.mocked(h.api.workspaceTree).mockImplementation(() => pendingTree.promise);
      const pending = operation === "expand" ? h.controller.expandDir("other") : operation === "refresh" ? h.controller.refreshFiles() : h.controller.restoreFile("src/a.ts");
      // Let restoreFile reach its deferred parent read.
      await Promise.resolve();
      h.controller.collapseAll();
      pendingTree.resolve(tree());
      await pending;
      expect(h.state.expandedDirs).toEqual({});
      expect(h.state.selectedFilePath).toBe("src/a.ts");
    }
  });

  it("allows independent pending directories to expand without cancelling each other", async () => {
    const src = deferred<FileTreeResponse>();
    const docs = deferred<FileTreeResponse>();
    const h = harness({ workspaceTree: vi.fn<FilesApi["workspaceTree"]>((_p, _w, path) => path === "src" ? src.promise : docs.promise) });
    const first = h.controller.expandDir("src");
    const second = h.controller.expandDir("docs");
    docs.resolve(tree("docs"));
    src.resolve(tree("src"));
    await Promise.all([first, second]);
    expect(Object.keys(h.state.expandedDirs).sort()).toEqual(["docs", "src"]);
  });

  it("reserves route intent before root loading so old same-workspace files cannot publish", async () => {
    const old = deferred<FileContentResponse>();
    const root = deferred<FileTreeResponse>();
    const h = harness({
      workspaceFile: vi.fn<FilesApi["workspaceFile"]>().mockReturnValueOnce(old.promise).mockImplementation((_p, _w, path) => Promise.resolve(content(path))),
      workspaceTree: vi.fn(() => root.promise),
    });
    const oldRead = h.controller.selectFile("old.ts");
    const routeRead = h.controller.restoreRememberedFile("linked.ts");
    old.resolve(content("old.ts"));
    await oldRead;
    expect(h.state.selectedFileContent).toBeUndefined();
    root.resolve(tree());
    await routeRead;
    expect(h.state.selectedFileContent?.path).toBe("linked.ts");
  });

  it("commits the latest same-file line reported while its GET is in flight", async () => {
    vi.useFakeTimers();
    const file = deferred<FileContentResponse>();
    const h = harness({ workspaceFile: vi.fn(() => file.promise) });
    h.memory.remember(h.key, "a.ts", 120);
    const opening = h.controller.selectFile("a.ts");
    h.controller.rememberTopLine(h.key, "a.ts", 300);
    expect(h.memory.latest(h.key)?.topLine).toBe(300);
    file.resolve(content("a.ts"));
    await opening;
    expect(h.memory.latest(h.key)).toEqual({ path: "a.ts", topLine: 300 });
    expect(h.state.selectedFileTopLine).toBe(300);
    vi.runAllTimers();
  });

  it("keeps user collapse authoritative during the root-await part of restore", async () => {
    const h = harness();
    await h.controller.selectFile("src/a.ts");
    const root = deferred<FileTreeResponse>();
    vi.mocked(h.api.workspaceTree).mockImplementation((_p, _w, path) => path === "" ? root.promise : Promise.resolve(tree(path)));
    const restoring = h.controller.restoreRememberedFile();
    h.controller.collapseAll();
    root.resolve(tree());
    await restoring;
    expect(h.state.expandedDirs).toEqual({});
    expect(h.state.selectedFileContent?.path).toBe("src/a.ts");
  });

  it("ignores old refresh errors after a workspace switch", async () => {
    const root = deferred<FileTreeResponse>();
    const h = harness({ workspaceTree: vi.fn(() => root.promise) });
    const pending = h.controller.refreshFiles();
    h.select("b");
    root.reject(new Error("old failure"));
    await pending;
    expect(h.state.error).toBe("");
  });
});

import {
  api as defaultApi,
  uploadWorkspaceFiles as defaultUploadWorkspaceFiles,
  WorkspaceUploadBatchError,
  WorkspaceUploadCancelledError,
  type WorkspaceUploadBatchProgress,
  type WorkspaceUploadTask,
  type WriteWorkspaceFileResponse,
} from "../api";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import {
  cancelWorkspaceUploadBatch,
  completeWorkspaceUploadBatch,
  createWorkspaceUploadBatchState,
  failWorkspaceUploadBatch,
  updateWorkspaceUploadBatchProgress,
  type WorkspaceUploadBatchState,
} from "../workspaceUploadState";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import { FileNavigationMemory, fileWorkspaceKey } from "./fileNavigationMemory";

const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");

type FileExplorerApi = Pick<typeof defaultApi, "workspaceFile" | "workspaceTree">;
type UploadWorkspaceFiles = typeof defaultUploadWorkspaceFiles;

export interface FileExplorerControllerDependencies {
  api?: FileExplorerApi;
  uploadWorkspaceFiles?: UploadWorkspaceFiles;
  createUploadBatchId?: () => string;
  now?: () => string;
  memory?: FileNavigationMemory;
}

export interface StartWorkspaceUploadOptions {
  destinationFolder: string;
  createDirs?: boolean;
  overwrite?: boolean;
  selectUploadedFile?: boolean;
}

export interface WorkspaceUploadRun {
  batchId: string;
  done: Promise<void>;
}

export class FileExplorerController {
  private readonly api: FileExplorerApi;
  private readonly uploadWorkspaceFiles: UploadWorkspaceFiles;
  private readonly createUploadBatchId: () => string;
  private readonly now: () => string;
  private readonly uploadTasks = new Map<string, WorkspaceUploadTask<WriteWorkspaceFileResponse[]>>();
  private uploadBatchSequence = 0;
  private readonly memory: FileNavigationMemory;
  private workspaceGeneration = 0;
  private fileRequest = 0;
  private refreshRequest = 0;
  private treeGeneration = 0;
  private collapseGeneration = 0;
  private readonly directoryRequests = new Map<string, number>();

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    deps: FileExplorerControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.memory = deps.memory ?? new FileNavigationMemory();
    this.uploadWorkspaceFiles = deps.uploadWorkspaceFiles ?? defaultUploadWorkspaceFiles;
    this.createUploadBatchId = deps.createUploadBatchId ?? (() => {
      this.uploadBatchSequence += 1;
      return `workspace-upload-${String(this.uploadBatchSequence)}`;
    });
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Called for every workspace scope transition, including A → B → A. */
  workspaceChanged(): void {
    this.workspaceGeneration += 1;
    this.fileRequest += 1;
    this.treeGeneration += 1;
    this.collapseGeneration += 1;
    this.directoryRequests.clear();
  }

  forgetScope(machineId: string, projectId?: string): void {
    this.memory.forgetScope(machineId, projectId);
  }

  topLine(path: string | undefined): number | undefined {
    const key = fileWorkspaceKey(this.getState());
    const position = key === undefined ? undefined : this.memory.latest(key);
    return position?.path === path ? position?.topLine : undefined;
  }

  rememberTopLine(key: string, path: string, line: number): void {
    this.memory.rememberLine(key, path, line);
  }

  async restoreRememberedFile(path?: string): Promise<void> {
    const scope = this.captureScope();
    if (scope === undefined) return;
    const file = path ?? this.memory.latest(scope.key)?.path;
    const request = ++this.fileRequest;
    const revealGeneration = this.treeGeneration;
    await this.refreshFiles();
    if (!scope.current() || request !== this.fileRequest || file === undefined) return;
    await this.restoreFile(file, revealGeneration);
    if (!scope.current() || this.getState().selectedFilePath !== file) return;
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", this.getState().selectedFilePath);
    this.updateUrl({ replace: true });
  }

  collapseAll(): void {
    this.treeGeneration += 1;
    this.collapseGeneration += 1;
    this.setState({ expandedDirs: {} });
  }

  async refreshFiles(): Promise<void> {
    const scope = this.captureScope();
    if (scope === undefined) return;
    const request = ++this.refreshRequest;
    const tree = this.treeGeneration;
    let expanded = { ...this.getState().expandedDirs };
    try {
      const root = await this.api.workspaceTree(scope.projectId, scope.workspaceId, "", scope.machineId);
      await Promise.all(Object.keys(expanded).map(async (path) => {
        try {
          expanded[path] = (await this.api.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId)).entries;
        } catch (error) {
          if (!isUnavailableFileError(error)) throw error;
          expanded = omitKey(expanded, path);
        }
      }));
      if (!scope.current() || request !== this.refreshRequest) return;
      // A refresh must not undo an intervening user collapse/expand action.
      this.setState({ fileTree: root.entries, ...(tree === this.treeGeneration ? { expandedDirs: expanded } : {}), fileTreeStale: false, error: "" });
    } catch (error) {
      if (scope.current() && request === this.refreshRequest) this.setState({ error: String(error) });
    }
  }

  async expandDir(path: string): Promise<void> {
    const scope = this.captureScope();
    if (scope === undefined) return;
    const request = (this.directoryRequests.get(path) ?? 0) + 1;
    this.directoryRequests.set(path, request);
    this.treeGeneration += 1;
    const collapse = this.collapseGeneration;
    if (this.getState().expandedDirs[path] !== undefined) {
      this.collapseGeneration += 1;
      this.setState({ expandedDirs: Object.fromEntries(Object.entries(this.getState().expandedDirs).filter(([key]) => key !== path && !key.startsWith(`${path}/`))) });
      return;
    }
    try {
      const response = await this.api.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId);
      if (!scope.current() || collapse !== this.collapseGeneration || request !== this.directoryRequests.get(path)) return;
      this.treeGeneration += 1;
      this.setState({ expandedDirs: { ...this.getState().expandedDirs, [path]: response.entries }, error: "" });
    } catch (error) {
      if (scope.current() && collapse === this.collapseGeneration && request === this.directoryRequests.get(path)) this.setState({ error: String(error) });
    }
  }

  private captureScope() {
    const state = this.getState();
    const key = fileWorkspaceKey(state);
    if (key === undefined || state.selectedProject === undefined || state.selectedWorkspace === undefined) return undefined;
    const generation = this.workspaceGeneration;
    return {
      key,
      projectId: state.selectedProject.id,
      workspaceId: state.selectedWorkspace.id,
      machineId: selectedMachineId(state),
      current: () => generation === this.workspaceGeneration && key === fileWorkspaceKey(this.getState()),
    };
  }

  async selectFile(path: string): Promise<void> {
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, workspaceTool: "core:workspace.files", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.files" });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", path);
    this.updateUrl({ replace: true });
    await this.restoreFile(path);
  }

  async restoreFile(path: string, revealGeneration = this.treeGeneration): Promise<void> {
    const scope = this.captureScope();
    if (scope === undefined) return;
    const request = ++this.fileRequest;
    const tree = revealGeneration;
    const current = () => scope.current() && request === this.fileRequest;
    const remembered = this.memory.latest(scope.key);
    const topLine = remembered?.path === path ? remembered.topLine ?? 1 : 1;
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, selectedFileTopLine: topLine });
    try {
      const content = await this.api.workspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId);
      if (!current()) return;
      // The outgoing viewer can report its final line while this GET is in
      // flight. Commit the latest same-file position, not the request snapshot.
      const latest = this.memory.latest(scope.key);
      const committedLine = latest?.path === path ? latest.topLine ?? 1 : 1;
      this.memory.remember(scope.key, path, content.mediaType === "image" || content.binary ? undefined : committedLine);
      this.setState({ selectedFileContent: content, selectedFileTopLine: committedLine, error: "" });
    } catch (error) {
      if (!current()) return;
      if (isUnavailableFileError(error)) {
        if (this.memory.latest(scope.key)?.path === path) this.memory.forget(scope.key);
        this.setState({ selectedFilePath: undefined, selectedFileContent: undefined, selectedFileTopLine: undefined, error: "" });
        setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
        this.updateUrl({ replace: true });
        return;
      }
      this.setState({ error: String(error) });
      return;
    }
    if (!current() || tree !== this.treeGeneration) return;
    const parents = path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    try {
      const entries = await Promise.all(parents.map(async (parent) => [parent, (await this.api.workspaceTree(scope.projectId, scope.workspaceId, parent, scope.machineId)).entries] as const));
      if (current() && tree === this.treeGeneration) {
        this.treeGeneration += 1;
        this.setState({ expandedDirs: { ...this.getState().expandedDirs, ...Object.fromEntries(entries) } });
      }
    } catch (error) {
      if (!current() || tree !== this.treeGeneration) return;
      if (isUnavailableFileError(error)) {
        this.memory.forget(scope.key);
        this.setState({ selectedFilePath: undefined, selectedFileContent: undefined, selectedFileTopLine: undefined });
        setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
        this.updateUrl({ replace: true });
      } else this.setState({ error: String(error) });
    }
  }

  startWorkspaceUpload(files: readonly File[], options: StartWorkspaceUploadOptions): WorkspaceUploadRun | undefined {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) {
      this.setState({ error: "Select a workspace before uploading files." });
      return undefined;
    }
    if (files.length === 0) return undefined;

    const machineId = selectedMachineId(this.getState());
    const overwrite = options.overwrite ?? false;
    const createDirs = options.createDirs ?? true;
    let batch: WorkspaceUploadBatchState;
    try {
      batch = createWorkspaceUploadBatchState({
        id: this.createUploadBatchId(),
        projectId: project.id,
        workspaceId: workspace.id,
        machineId,
        destinationFolder: options.destinationFolder,
        overwrite,
        createDirs,
        files,
        startedAt: this.now(),
      });
    } catch (error) {
      this.setState({ error: String(error) });
      return undefined;
    }

    this.setUploadBatch(batch);
    let task: WorkspaceUploadTask<WriteWorkspaceFileResponse[]>;
    try {
      task = this.uploadWorkspaceFiles(project.id, workspace.id, files, {
        destinationFolder: options.destinationFolder,
        machineId,
        overwrite,
        createDirs,
        onProgress: (progress) => { this.updateUploadProgress(batch.id, progress); },
      });
    } catch (error) {
      this.failUploadBatch(batch.id, error);
      return { batchId: batch.id, done: Promise.resolve() };
    }

    this.uploadTasks.set(batch.id, task);
    const done = task.promise
      .then(async (responses) => { await this.completeUploadBatch(batch.id, responses, options); })
      .catch(async (error: unknown) => { await this.handleUploadFailure(batch.id, error, options); })
      .finally(() => { this.uploadTasks.delete(batch.id); });
    return { batchId: batch.id, done };
  }

  cancelWorkspaceUpload(batchId: string): void {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(cancelWorkspaceUploadBatch(batch, this.now()));
    this.uploadTasks.get(batchId)?.cancel();
  }

  clearWorkspaceUpload(batchId: string): void {
    this.uploadTasks.get(batchId)?.cancel();
    this.uploadTasks.delete(batchId);
    this.setState({ workspaceUploadBatches: omitKey(this.getState().workspaceUploadBatches, batchId) });
  }

  private updateUploadProgress(batchId: string, progress: WorkspaceUploadBatchProgress): void {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(updateWorkspaceUploadBatchProgress(batch, progress));
  }

  private async completeUploadBatch(batchId: string, responses: WriteWorkspaceFileResponse[], options: StartWorkspaceUploadOptions): Promise<void> {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(completeWorkspaceUploadBatch(batch, responses, this.now()), { error: "" });
    if (!this.isCurrentWorkspaceBatch(batch)) return;
    await this.refreshFiles();
    const uploadedPath = responses[0]?.path;
    if (options.selectUploadedFile !== false && uploadedPath !== undefined && this.isCurrentWorkspaceBatch(batch)) await this.selectFile(uploadedPath);
  }

  private async handleUploadFailure(batchId: string, error: unknown, options: StartWorkspaceUploadOptions): Promise<void> {
    const batch = this.failUploadBatch(batchId, error);
    if (!(error instanceof WorkspaceUploadBatchError) || error.responses.length === 0 || batch === undefined || !this.isCurrentWorkspaceBatch(batch)) return;
    await this.refreshFiles();
    const uploadedPath = error.responses[0]?.path;
    if (options.selectUploadedFile !== false && uploadedPath !== undefined && this.isCurrentWorkspaceBatch(batch)) await this.selectFile(uploadedPath);
  }

  private failUploadBatch(batchId: string, error: unknown): WorkspaceUploadBatchState | undefined {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return undefined;
    if (isWorkspaceUploadCancelled(error)) {
      const cancelled = cancelWorkspaceUploadBatch(batch, this.now());
      this.setUploadBatch(cancelled);
      return cancelled;
    }
    const message = errorMessage(error);
    const failed = failWorkspaceUploadBatch(batch, message, this.now());
    this.setUploadBatch(failed, { error: message });
    return failed;
  }

  private getUploadBatch(batchId: string): WorkspaceUploadBatchState | undefined {
    return this.getState().workspaceUploadBatches[batchId];
  }

  private setUploadBatch(batch: WorkspaceUploadBatchState, patch: { error?: string } = {}): void {
    this.setState({ workspaceUploadBatches: { ...this.getState().workspaceUploadBatches, [batch.id]: batch }, ...patch });
  }

  private isCurrentWorkspaceBatch(batch: WorkspaceUploadBatchState): boolean {
    const state = this.getState();
    return state.selectedProject?.id === batch.projectId && state.selectedWorkspace?.id === batch.workspaceId && selectedMachineId(state) === batch.machineId;
  }
}

function isUnavailableFileError(error: unknown): boolean {
  const message = String(error);
  return message.includes("Path does not exist") || message.includes("ENOENT") || message.includes("no such file or directory");
}

function isWorkspaceUploadCancelled(error: unknown): boolean {
  return error instanceof WorkspaceUploadCancelledError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

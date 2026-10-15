import type { AppState } from "../appState";
import { selectedMachineId } from "./types";
import { PersistentValueMap, type KeyValueStorage } from "./sessionStorageMemory";

export interface FileNavigationPosition {
  path: string;
  topLine?: number;
}

export function fileWorkspaceKey(state: AppState): string | undefined {
  const project = state.selectedProject;
  const workspace = state.selectedWorkspace;
  return project === undefined || workspace === undefined ? undefined : JSON.stringify([selectedMachineId(state), project.id, workspace.id]);
}

export class FileNavigationMemory {
  private readonly positions: PersistentValueMap<FileNavigationPosition>;
  private readonly pending = new Map<string, FileNavigationPosition>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly flush = () => {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.flush);
    for (const [key, value] of this.pending) this.positions.set(key, value);
    this.pending.clear();
  };

  constructor(storage?: KeyValueStorage) {
    this.positions = new PersistentValueMap("pi-webui:files-navigation:v1", parsePosition, storage);
  }

  latest(key: string): FileNavigationPosition | undefined {
    const value = this.pending.get(key) ?? this.positions.get(key);
    return value === undefined ? undefined : { ...value };
  }

  remember(key: string, path: string, topLine?: number): void {
    const value = parsePosition({ path, topLine });
    if (value === undefined) return;
    const previous = this.latest(key);
    if (previous?.path === value.path && previous.topLine === value.topLine) return;
    this.pending.delete(key);
    this.positions.set(key, value);
  }

  rememberLine(key: string, path: string, topLine: number): void {
    const previous = this.latest(key);
    if (previous?.path !== path || !validLine(topLine) || previous.topLine === topLine) return;
    // Update the in-memory value synchronously so rapid switching sees the latest
    // line, but avoid serializing sessionStorage on every scroll event.
    this.pending.set(key, { path, topLine });
    if (this.timer === undefined) {
      this.timer = setTimeout(this.flush, 100);
      if (typeof window !== "undefined") window.addEventListener("pagehide", this.flush);
    }
  }

  forgetScope(machineId: string, projectId?: string): void {
    const prefix = `${JSON.stringify(projectId === undefined ? [machineId] : [machineId, projectId]).slice(0, -1)},`;
    for (const key of new Set([...this.positions.entries().map(([key]) => key), ...this.pending.keys()])) {
      if (key.startsWith(prefix)) this.forget(key);
    }
  }

  forget(key: string): void {
    this.pending.delete(key);
    this.positions.delete(key);
  }
}

function validLine(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePosition(value: unknown): FileNavigationPosition | undefined {
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string") return undefined;
  const path = value.path;
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part === "")) return undefined;
  const topLine = "topLine" in value && validLine(value.topLine) ? value.topLine : undefined;
  return topLine === undefined ? { path } : { path, topLine };
}

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";
import { WorkspaceList } from "./WorkspaceList";

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom has no layout; observe the browser scrolling boundary instead.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  scrollIntoView.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function workspace(id: string): Workspace {
  return { id, projectId: "project", path: `/work/${id}`, label: id, isMain: false, isGitRepo: true, isGitWorktree: true };
}

async function mount(workspaces: Workspace[], selected?: Workspace, collapsed = false): Promise<WorkspaceList> {
  const list = new WorkspaceList();
  list.workspaces = workspaces;
  if (selected !== undefined) list.selected = selected;
  list.collapsed = collapsed;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function expectSelectedScroll(list: WorkspaceList): void {
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
  expect(scrollIntoView.mock.instances[0]).toBe(list.shadowRoot?.querySelector(".action-row.selected"));
}

describe("workspace selection scrolling", () => {
  it("reveals the initial selection but does not scroll on background refresh or same-ID selection replacement", async () => {
    const first = workspace("first");
    const second = workspace("second");
    const list = await mount([first, second], first);
    expectSelectedScroll(list);
    scrollIntoView.mockClear();

    list.workspaces = [{ ...first }, { ...second }];
    await list.updateComplete;
    list.selected = { ...first };
    await list.updateComplete;
    list.workspaces = [second, first, workspace("third")];
    list.selected = { ...first };
    await list.updateComplete;
    list.activities = {};
    await list.updateComplete;
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals a different selected ID", async () => {
    const first = workspace("first");
    const second = workspace("second");
    const list = await mount([first, second], first);
    scrollIntoView.mockClear();
    list.selected = second;
    await list.updateComplete;
    expectSelectedScroll(list);
  });

  it("does not scroll while collapsed and reveals the selection on expansion", async () => {
    const first = workspace("first");
    const second = workspace("second");
    const list = await mount([first, second], first);
    scrollIntoView.mockClear();
    list.collapsed = true;
    await list.updateComplete;
    list.selected = second;
    list.workspaces = [{ ...first }, { ...second }];
    await list.updateComplete;
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.collapsed = false;
    await list.updateComplete;
    expectSelectedScroll(list);
    scrollIntoView.mockClear();
    list.collapsed = true;
    await list.updateComplete;
    list.collapsed = false;
    await list.updateComplete;
    expectSelectedScroll(list);
  });

  it("reveals an initially collapsed selection when expanded", async () => {
    const first = workspace("first");
    const list = await mount([first], first, true);
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.collapsed = false;
    await list.updateComplete;
    expectSelectedScroll(list);
  });

  it("reveals the selected row when it first loads or reappears", async () => {
    const first = workspace("first");
    const list = await mount([], first);
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.workspaces = [first];
    await list.updateComplete;
    expectSelectedScroll(list);
    scrollIntoView.mockClear();
    list.workspaces = [];
    await list.updateComplete;
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.workspaces = [{ ...first }];
    await list.updateComplete;
    expectSelectedScroll(list);
  });

  it("does not scroll without a selection and reveals a selection after clearing it", async () => {
    const first = workspace("first");
    const list = await mount([first]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.selected = first;
    await list.updateComplete;
    expectSelectedScroll(list);
    scrollIntoView.mockClear();
    Reflect.set(list, "selected", undefined);
    await list.updateComplete;
    expect(scrollIntoView).not.toHaveBeenCalled();
    list.selected = { ...first };
    await list.updateComplete;
    expectSelectedScroll(list);
  });
});

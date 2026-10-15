import { afterEach, describe, expect, it, vi } from "vitest";
import { FileNavigationMemory } from "./fileNavigationMemory";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Files navigation memory", () => {
  it("isolates machine/project/workspace keys and restores paths and lines across reload", () => {
    const persisted = storage();
    const memory = new FileNavigationMemory(persisted);
    for (const key of ['["local","p","main"]', '["remote","p","main"]', '["local","q","main"]', '["local","p","branch"]']) memory.remember(key, "src/main.ts", key.length);
    const reloaded = new FileNavigationMemory(persisted);
    expect(reloaded.latest('["local","p","main"]')).toEqual({ path: "src/main.ts", topLine: 20 });
    expect(reloaded.latest('["remote","p","main"]')).toEqual({ path: "src/main.ts", topLine: 21 });
    expect(reloaded.latest("missing")).toBeUndefined();
  });

  it("updates lines synchronously, throttles durable writes and flushes on pagehide", () => {
    vi.useFakeTimers();
    const window = new EventTarget();
    vi.stubGlobal("window", window);
    const persisted = storage();
    const memory = new FileNavigationMemory(persisted);
    memory.remember("scope", "a.ts", 1);
    memory.rememberLine("scope", "a.ts", 50);
    memory.rememberLine("scope", "a.ts", 80);
    expect(memory.latest("scope")).toEqual({ path: "a.ts", topLine: 80 });
    expect(persisted.setItem).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(new FileNavigationMemory(persisted).latest("scope")?.topLine).toBe(80);
    vi.runAllTimers();
    expect(persisted.setItem).toHaveBeenCalledTimes(2);
  });

  it("does not apply an old viewer's final line to a new file or resurrect forgotten state", () => {
    vi.useFakeTimers();
    const persisted = storage();
    const memory = new FileNavigationMemory(persisted);
    memory.remember("scope", "old.ts", 3);
    memory.rememberLine("scope", "old.ts", 60);
    memory.remember("scope", "new.ts", 1);
    memory.rememberLine("scope", "old.ts", 90);
    vi.runAllTimers();
    expect(new FileNavigationMemory(persisted).latest("scope")).toEqual({ path: "new.ts", topLine: 1 });
    memory.rememberLine("scope", "new.ts", 10);
    memory.forget("scope");
    vi.runAllTimers();
    expect(new FileNavigationMemory(persisted).latest("scope")).toBeUndefined();
  });

  it("ignores corrupt paths, accepts path-only entries and sanitizes invalid line numbers", () => {
    const persisted = storage();
    persisted.setItem("pi-webui:files-navigation:v1", JSON.stringify({ version: 1, entries: [["valid", { path: "src/a.ts" }], ["invalid-line", { path: "b.ts", topLine: -1 }], ["escape", { path: "../secret" }], ["absolute", { path: "/etc/passwd" }]] }));
    const memory = new FileNavigationMemory(persisted);
    expect(memory.latest("valid")).toEqual({ path: "src/a.ts" });
    expect(memory.latest("invalid-line")).toEqual({ path: "b.ts" });
    expect(memory.latest("escape")).toBeUndefined();
    expect(memory.latest("absolute")).toBeUndefined();
    persisted.setItem("pi-webui:files-navigation:v1", "not-json");
    expect(new FileNavigationMemory(persisted).latest("valid")).toBeUndefined();
  });

  it("forgets only the removed project or machine, including pending lines", () => {
    vi.useFakeTimers();
    const persisted = storage();
    const memory = new FileNavigationMemory(persisted);
    memory.remember('["local","a","main"]', "a.ts", 1);
    memory.remember('["local","b","main"]', "b.ts", 1);
    memory.remember('["remote","a","main"]', "a.ts", 1);
    memory.rememberLine('["local","a","main"]', "a.ts", 50);
    memory.forgetScope("local", "a");
    vi.runAllTimers();
    expect(memory.latest('["local","a","main"]')).toBeUndefined();
    expect(memory.latest('["local","b","main"]')?.path).toBe("b.ts");
    expect(memory.latest('["remote","a","main"]')?.path).toBe("a.ts");
    memory.forgetScope("remote");
    expect(new FileNavigationMemory(persisted).latest('["remote","a","main"]')).toBeUndefined();
  });

  it("keeps working when storage is unavailable", () => {
    const memory = new FileNavigationMemory({ getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("denied"); } });
    memory.remember("scope", "a.ts", 4);
    expect(memory.latest("scope")).toEqual({ path: "a.ts", topLine: 4 });
    memory.forget("scope");
    expect(memory.latest("scope")).toBeUndefined();
  });
});

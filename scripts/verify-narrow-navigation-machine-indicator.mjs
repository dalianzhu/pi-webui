import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const repo = resolve(dirname(self), "..");
const modules = [
  "src/client/src/components/appShell/AppNavigationPanel.ts",
  "src/client/src/components/MachineSwitcher.ts",
];
const oldRevision = "5f8e27e9859cafe75c7c325b4b657fce0f8eb8d9";
const argv = process.argv.slice(2);
const serverMode = argv[0] === "--fixture-server";
const options = new Map();
for (let index = serverMode ? 1 : 0; index < argv.length; index += 2) {
  const flag = argv[index];
  const value = argv[index + 1];
  const allowed = serverMode ? ["--port", "--temp-root", "--source-overlay"] : ["--source-overlay"];
  assert(allowed.includes(flag) && value && !value.startsWith("--") && !options.has(flag), `Invalid arguments: ${argv.join(" ")}`);
  options.set(flag, value);
}
const overlay = options.has("--source-overlay") ? resolve(options.get("--source-overlay")) : undefined;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function until(probe, ms, label, signal) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    try { const value = await probe(); signal?.throwIfAborted(); if (value) return value; } catch (error) { last = error; }
    signal?.throwIfAborted();
    await sleep(40);
  }
  throw new Error(`Timeout: ${label}${last ? `: ${last.message}` : ""}`);
}
async function port() {
  const server = createPortServer();
  try {
    await bounded(new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); }), 2000, "port allocation");
    const address = server.address();
    assert(address && typeof address === "object");
    return address.port;
  } finally {
    if (server.listening) await bounded(new Promise((done, reject) => server.close((error) => error ? reject(error) : done())), 2000, "port release");
  }
}
async function json(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response.json();
}

class CDP {
  constructor(ws, onEvent, signal) {
    this.ws = ws;
    this.onEvent = onEvent;
    this.signal = signal;
    this.pending = new Map();
    this.next = 1;
    this.closed = false;
    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id !== undefined) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result ?? {});
        } else this.onEvent(message.method, message.params ?? {});
      } catch (error) { this.fail(error); }
    });
    ws.addEventListener("close", () => { this.closed = true; this.fail(new Error("CDP socket closed")); });
    ws.addEventListener("error", () => this.fail(new Error("CDP socket error")));
  }
  static async connect(url, onEvent, signal) {
    signal.throwIfAborted();
    const ws = new WebSocket(url);
    const client = new CDP(ws, onEvent, signal);
    try {
      await bounded(new Promise((done, reject) => {
        ws.addEventListener("open", done, { once: true });
        ws.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
      }), 5000, "CDP connection");
      signal.throwIfAborted();
      return client;
    } catch (error) { ws.close(); throw error; }
  }
  fail(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}) {
    if (this.signal.aborted) return Promise.reject(this.signal.reason);
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP unavailable: ${method}`));
    const id = this.next++;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: CDP ${method}`)); }, 8000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Browser assertion: ${JSON.stringify(result.exceptionDetails)}`);
    return result.result?.value;
  }
  async close() {
    if (this.closed) return;
    const closed = new Promise((done) => this.ws.addEventListener("close", done, { once: true }));
    this.ws.close();
    await bounded(closed, 2000, "CDP close");
  }
}

async function browserFixture({ AppNavigationPanel, AppRefreshControl, appStyles }) {
  const tolerance = 0.75;
  const time = "2026-10-17T00:00:00.000Z";
  const machines = [
    { id: "local", name: "Local", kind: "local", status: "online" },
    { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test", status: "offline" },
    { id: "long", name: "Remote machine with a deliberately very long name that must stay inside its label allocation", kind: "remote", baseUrl: "https://long.example.test", status: "error" },
    { id: "unknown", name: "Unknown", kind: "remote" },
  ].map((machine) => ({ ...machine, createdAt: time, updatedAt: time }));
  const host = document.createElement("narrow-navigation-fixture");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appStyles.cssText;
  const shell = document.createElement("div");
  shell.className = "shell";
  // Layout/font/rail rules are imported, not recreated here.
  shell.innerHTML = '<activity-rail></activity-rail><aside></aside><div class="navigation-panel-edge"></div><main></main><div class="workspace-panel-edge"></div><workspace-panel></workspace-panel>';
  const panel = new AppNavigationPanel();
  shell.querySelector("aside").append(panel);
  shadow.append(style, shell);
  document.body.append(host);
  const counts = { select: 0, next: 0, actions: 0, reload: 0 };
  let saved;
  const must = (condition, message) => { if (!condition) throw new Error(message); };
  const near = (actual, expected, name) => must(Math.abs(actual - expected) <= tolerance, `[GEOMETRY] ${name}: ${actual}, expected ${expected}`);
  const get = (parent, selector) => { const value = parent.querySelector(selector); must(value, `Missing ${selector}`); return value; };
  const child = () => get(panel.shadowRoot, "machine-switcher");
  const button = () => get(child().shadowRoot, ".machine-switcher-button");
  const menu = () => child().shadowRoot.querySelector(".machine-switcher-menu");
  const option = (id) => get(child().shadowRoot, `.machine-option-main[data-machine-id="${id}"]`);
  const rect = (element) => element.getBoundingClientRect();
  const contained = (inner, outer, label) => {
    const a = rect(inner), b = rect(outer);
    must(a.width > 0 && a.height > 0 && a.left >= b.left - tolerance && a.right <= b.right + tolerance && a.top >= b.top - tolerance && a.bottom <= b.bottom + tolerance, `[GEOMETRY] ${label} not contained: ${JSON.stringify(a.toJSON())} in ${JSON.stringify(b.toJSON())}`);
  };
  const nonoverlap = (elements, label) => {
    for (let a = 0; a < elements.length; a += 1) for (let b = a + 1; b < elements.length; b += 1) {
      const x = rect(elements[a]), y = rect(elements[b]);
      must(Math.min(x.right, y.right) - Math.max(x.left, y.left) <= tolerance || Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) <= tolerance, `[GEOMETRY] ${label} overlap ${a}/${b}`);
    }
  };
  const readable = (element, label) => {
    must(element.clientWidth > 0 && element.scrollWidth <= element.clientWidth + 1, `[GEOMETRY] ${label} clipped: ${element.scrollWidth}/${element.clientWidth}`);
  };
  const visible = (element) => getComputedStyle(element).display !== "none" && rect(element).width > 0;
  async function flush() {
    await panel.updateComplete;
    await child().updateComplete;
    const refresh = panel.shadowRoot.querySelector("app-refresh-control");
    if (refresh) await refresh.updateComplete;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }
  async function resize(column) { shell.style.setProperty("--navigation-panel-size", `${column}px`); await flush(); }
  async function reset({ column = 180, refresh = false, health = "unknown", activity = "both", selected = "local" } = {}) {
    // Close any previous menu via its public DOM, not by writing private state.
    document.body.click();
    panel.machines = machines;
    panel.selectedMachine = machines.find((machine) => machine.id === selected);
    panel.version = "1.26.0";
    panel.machineStatuses = { [selected]: { machineId: selected, status: health, ok: health === "online", checkedAt: time } };
    panel.machineActivities = { [selected]: { fixture: { cwd: "/fixture", hasSessionActivity: activity === "session" || activity === "both", hasTerminalActivity: activity === "terminal" || activity === "both", updatedAt: time } } };
    panel.onSelectMachine = (machine) => { counts.select += 1; panel.selectedMachine = machine; };
    panel.onShowActions = () => { counts.actions += 1; };
    panel.onFocusNavigationTarget = (target) => { must(target === "projects", `Wrong next section ${target}`); counts.next += 1; };
    if (refresh) {
      const control = new AppRefreshControl();
      control.onReload = () => { counts.reload += 1; };
      panel.refreshControl = control;
    } else panel.refreshControl = undefined;
    for (const name of Object.keys(counts)) counts[name] = 0;
    await resize(column);
  }
  function layout({ column, refresh, health = "unknown", activity = "both", selected = "local" }) {
    const header = get(panel.shadowRoot, "header");
    const h = getComputedStyle(header);
    const narrow = column - 44 < 416;
    // FIRST gate uses only old DOM: original modules must fail here for mode.
    must(h.display === (narrow ? "grid" : "flex"), `[GEOMETRY] mode at column ${column}, host ${rect(panel).width}: ${h.display}; expected ${narrow ? "grid" : "flex"}`);
    near(window.innerWidth, 1600, "viewport width");
    near(window.innerHeight, 900, "viewport height");
    near(rect(shell.querySelector("aside")).width, column, "navigation column");
    near(parseFloat(getComputedStyle(shell.querySelector("aside")).paddingLeft), 44, "desktop rail reserve");
    near(rect(panel).width, column - 44, "host content box");
    near(parseFloat(getComputedStyle(panel).paddingLeft) || 0, 0, "host padding");
    near(parseFloat(h.paddingLeft), narrow ? 8 : 12, "header left padding");
    near(parseFloat(h.paddingRight), narrow ? 8 : 12, "header right padding");
    near(parseFloat(h.paddingTop), narrow ? 8 : 12, "header top padding");
    near(parseFloat(h.paddingBottom), narrow ? 8 : 12, "header bottom padding");
    if (column === 180) near(rect(header).width - parseFloat(h.paddingLeft) - parseFloat(h.paddingRight) - parseFloat(h.borderLeftWidth) - parseFloat(h.borderRightWidth), 120, "header content box");
    must(getComputedStyle(host).fontFamily.includes("system-ui"), "Fixture did not apply appStyles :host system font");
    must(getComputedStyle(host).getPropertyValue("--pi-success").trim() === "#3fb950", "Production tokens not supplied");
    const brand = get(panel.shadowRoot, ".brand");
    const actions = get(panel.shadowRoot, ".header-actions");
    const action = get(actions, "button");
    const selectedButton = button();
    const status = get(selectedButton, ".machine-status");
    const kicker = get(selectedButton, ".machine-switcher-kicker");
    const label = get(selectedButton, ".machine-switcher-label");
    const chevron = get(selectedButton, ".machine-chevron");
    const mark = get(brand, ".brand-wordmark");
    const version = get(brand, ".brand-version");
    must(visible(mark) === !narrow && visible(version) === !narrow, "Wrong brand visibility");
    must(version.textContent === "v1.26.0" && brand.getAttribute("aria-label") === "Pi WebUI version 1.26.0", "Brand semantics drift");
    for (const element of [brand, actions, child(), selectedButton, status, chevron, get(brand, ".brand-symbol")]) { contained(element, header, element.className || element.tagName); contained(element, panel, element.tagName); }
    for (const element of [kicker, label, status, chevron]) contained(element, selectedButton, element.className);
    nonoverlap([brand, actions, selectedButton], "primary controls");
    readable(action, "Actions");
    readable(selectedButton, "selector");
    readable(actions, "action group");
    readable(kicker, "Machine kicker");
    must(action.textContent.trim() === "Actions" && visible(action), "Actions label lost");
    if (selected === "local") { must(label.textContent === "Local", "Wrong selected label"); readable(label, "Local"); }
    else {
      must(label.scrollWidth > label.clientWidth && label.clientWidth > 0, "Long label must intentionally ellipsize");
      const l = getComputedStyle(label);
      must(l.textOverflow === "ellipsis" && l.overflowX === "hidden" && l.whiteSpace === "nowrap", "Long-name ellipsis contract changed");
    }
    if (narrow) {
      near(parseFloat(h.columnGap), 4, "column gap"); near(parseFloat(h.rowGap), 8, "row gap");
      near(parseFloat(getComputedStyle(actions).gap), 4, "action gap");
      near(parseFloat(getComputedStyle(action).paddingLeft), 3, "Actions inline padding");
      near(rect(selectedButton).top, Math.max(rect(brand).bottom, rect(actions).bottom) + 8, "selector on exactly row two, no third row");
      near(rect(header).bottom - parseFloat(h.borderBottomWidth) - rect(selectedButton).bottom, 8, "no trailing third row");
      must(Math.min(rect(brand).bottom, rect(actions).bottom) > Math.max(rect(brand).top, rect(actions).top), "Brand/actions not on first row");
      near(rect(status).width, 7, "health dot width"); near(rect(status).height, 7, "health dot height");
      must(getComputedStyle(status).fontSize === "0px", "Health word visually exposed in dot mode");
      must(getComputedStyle(status).backgroundColor === getComputedStyle(status).color, "Dot must use health color");
    } else {
      const row = [rect(brand), rect(actions), rect(selectedButton)];
      must(Math.min(...row.map((r) => r.bottom)) > Math.max(...row.map((r) => r.top)), "Wide header is not one row");
      must(parseFloat(getComputedStyle(status).fontSize) > 0, "Health word hidden in wide mode");
      readable(status, "health word");
    }
    must(status.textContent === health && status.title === health, "Selected health content or tooltip drift");
    must(selectedButton.getAttribute("aria-describedby") === "machine-status-description", "Missing selected status association");
    const description = get(child().shadowRoot, "#machine-status-description");
    must(description.textContent.trim() === `Machine status: ${health}.` && getComputedStyle(description).display !== "none" && getComputedStyle(description).visibility !== "hidden" && description.getAttribute("aria-hidden") !== "true", "Status description unavailable");
    const colorToken = health === "online" ? "--pi-success" : health === "unknown" ? "--pi-muted" : "--pi-danger";
    const probe = document.createElement("span"); probe.style.color = `var(${colorToken})`; document.body.append(probe);
    must(getComputedStyle(status).color === getComputedStyle(probe).color, `Wrong ${health} color`); probe.remove();
    const active = selectedButton.querySelector(".activity-indicator");
    const eligible = health !== "offline" && health !== "error" && activity !== "none";
    must(Boolean(active) === eligible, "Activity suppression drift");
    if (active) {
      const session = activity === "session" || activity === "both";
      const text = session ? "Machine active" : "Machine terminal active";
      must(active.classList.contains(session ? "session" : "terminal") && !active.classList.contains(session ? "terminal" : "session"), "Activity precedence drift");
      must(active.getAttribute("role") === "img" && active.getAttribute("aria-label") === text && active.title === text, "Activity accessibility drift");
      contained(active, selectedButton, "activity"); contained(active, header, "activity"); contained(active, panel, "activity");
    }
    nonoverlap([get(selectedButton, ".machine-switcher-text"), status, chevron, ...(active ? [active] : [])], "selector items");
    const control = actions.querySelector("app-refresh-control");
    must(Boolean(control) === refresh, "Refresh presence drift");
    contained(action, actions, "Actions button");
    if (control) {
      const reload = get(control.shadowRoot, ".app-refresh-button");
      near(rect(reload).width, 36, "refresh width"); near(rect(reload).height, 36, "refresh height");
      contained(reload, actions, "refresh"); contained(reload, header, "refresh"); contained(reload, panel, "refresh");
      nonoverlap([control, action], "action buttons");
    }
  }
  function checkMenu() {
    const value = menu(); must(value, "Expected open menu");
    const r = rect(value), trigger = rect(button());
    must(getComputedStyle(value).position === "fixed", "Menu lost viewport positioning");
    near(r.width, 280, "menu width independent of selector");
    near(r.top, Math.round(trigger.bottom), "reopened menu top from current trigger");
    near(r.left, Math.round(Math.min(Math.max(8, trigger.left), 1600 - 8 - 280)), "menu viewport left");
    must(r.left >= 8 - tolerance && r.right <= 1592 + tolerance && r.bottom <= 892 + tolerance, "Menu outside viewport");
    near(parseFloat(value.style.maxHeight), Math.round(Math.max(0, 900 - trigger.bottom - 8)), "menu maximum height");
    must(getComputedStyle(value).zIndex === "10000", "Menu z-index drift");
    const entries = [...value.querySelectorAll(".machine-option-main")];
    must(entries.length === machines.length, "Menu omitted machines");
    for (const [index, machine] of machines.entries()) {
      const entry = entries[index];
      const status = panel.machineStatuses[machine.id]?.status ?? machine.status ?? "unknown";
      must(entry.dataset.machineId === machine.id && get(entry, ".machine-option-name").textContent.includes(machine.name), "Menu name/order drift");
      must(get(entry, "small").textContent === `${machine.kind === "local" ? "Local Pi WebUI" : machine.baseUrl ?? "Remote Pi WebUI"} · ${status}`, "Menu lost complete detail/health word");
    }
  }
  function element(kind, id) {
    if (kind === "selector") return button();
    if (kind === "option") return option(id);
    if (kind === "actions") return get(panel.shadowRoot, ".header-actions > button");
    if (kind === "refresh") return get(get(panel.shadowRoot, "app-refresh-control").shadowRoot, ".app-refresh-button");
    throw new Error(`Unknown target ${kind}`);
  }
  function expectState({ open, focused, selected, select, next, actions, reload } = {}) {
    if (open !== undefined) must(Boolean(menu()) === open && button().getAttribute("aria-expanded") === String(open), `Menu open expected ${open}`);
    if (focused !== undefined) must(child().shadowRoot.activeElement === (focused === "selector" ? button() : option(focused)), `Focus expected ${focused}`);
    if (selected !== undefined) must(panel.selectedMachine.id === selected, `Selected expected ${selected}`);
    for (const [name, value] of Object.entries({ select, next, actions, reload })) if (value !== undefined) must(counts[name] === value, `Counter ${name}: ${counts[name]}, expected ${value}`);
  }
  await reset();
  await document.fonts.ready;
  window.narrowFixture = {
    reset, resize, layout, checkMenu, expectState,
    focus: (kind, id) => element(kind, id).focus(),
    target: (kind, id) => { const r = rect(element(kind, id)); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    counters: () => ({ ...counts }),
    remember: () => { saved = { panel, child: child(), button: button(), focused: child().shadowRoot.activeElement, selected: panel.selectedMachine, counts: JSON.stringify(counts) }; },
    unchanged: () => { must(saved.panel === panel && saved.child === child() && saved.button === button() && saved.focused === child().shadowRoot.activeElement && saved.selected === panel.selectedMachine && saved.counts === JSON.stringify(counts) && Boolean(menu()), "CSS resize changed identity/state/focus/callbacks"); },
    snapshot: () => ({ host: rect(panel).toJSON(), button: rect(button()).toJSON(), menu: menu() ? rect(menu()).toJSON() : null, selected: panel.selectedMachine.id, counts: { ...counts } }),
  };
}

async function serveFixture() {
  const fixturePort = Number(options.get("--port"));
  const temp = options.get("--temp-root");
  assert(Number.isInteger(fixturePort) && fixturePort > 0 && temp, "Invalid fixture-server arguments");
  const { createServer } = await import("vite");
  const sourceHtml = await readFile(join(repo, "src/client/index.html"), "utf8");
  const theme = sourceHtml.match(/<style>[\s\S]*?<\/style>/u)?.[0];
  assert(theme?.includes("--pi-success"), "Production theme style not found");
  const overlaySources = new Map();
  if (overlay) for (const path of modules) overlaySources.set(resolve(repo, path), await readFile(join(overlay, path), "utf8"));
  const javascript = [
    'import { AppNavigationPanel } from "/src/client/src/components/appShell/AppNavigationPanel.ts";',
    'import { AppRefreshControl } from "/src/client/src/components/appShell/AppRefreshControl.ts";',
    'import "/src/client/src/components/ActivityRail.ts";',
    'import { appStyles } from "/src/client/src/components/shared.ts";',
    `await (${browserFixture.toString()})({ AppNavigationPanel, AppRefreshControl, appStyles });`,
  ].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">${theme}</head><body><script type="module" src="/narrow-fixture.js"></script></body></html>`;
  const fixturePlugin = {
    name: "narrow-navigation-offline-fixture", enforce: "pre",
    load(id) { return overlaySources.get(id.split("?")[0]) ?? null; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/" || request.url === "/narrow-fixture.js") {
          response.statusCode = 200;
          response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
          response.end(request.url === "/" ? html : javascript);
        } else next();
      });
    },
  };
  const server = await createServer({
    configFile: false, root: repo, cacheDir: join(temp, "vite-cache"), logLevel: "warn", clearScreen: false,
    plugins: [fixturePlugin],
    optimizeDeps: { noDiscovery: true, include: ["lit", "lit/decorators.js"] },
    server: { host: "127.0.0.1", port: fixturePort, strictPort: true, hmr: false, fs: { allow: [repo] } },
  });
  await bounded(server.listen(), 10000, "fixture listen");
  console.log(`Fixture ready on ${fixturePort}`);
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const result = spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 1000 });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim().split("\n")[0];
  }
  throw new Error("Chromium was not found. Set CHROME_BIN to a Chromium binary; browser acceptance cannot be skipped.");
}
function start(command, args, label, temp, failures) {
  const child = spawn(command, args, { cwd: repo, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.once("error", (error) => failures.push(`${label}: ${error.message}`));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    try { appendFileSync(join(temp, `${label}.log`), chunk); }
    catch (error) { failures.push(`${label} log: ${error.message}`); }
  });
  return child;
}
async function stop(child, label) {
  if (!child?.pid) return;
  const signal = (value) => {
    try { if (process.platform === "win32") child.kill(value); else process.kill(-child.pid, value); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  signal("SIGTERM");
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 1500, `${label} TERM`); }
  catch { signal("SIGKILL"); await until(() => child.exitCode !== null || child.signalCode !== null, 2500, `${label} KILL`); }
  signal("SIGKILL"); // Also reap Chromium/optimizer descendants in this isolated process group.
}

async function acceptance(cdp, origin, failures, signal) {
  const evaluate = (expression) => cdp.evaluate(expression);
  const call = (name, ...args) => evaluate(`window.narrowFixture.${name}(...${JSON.stringify(args)})`);
  const checkFailures = () => assert.equal(failures.length, 0, failures.join("\n"));
  async function key(key) {
    const keys = { Enter: ["Enter", 13, "\r"], " ": ["Space", 32, " "], ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], Home: ["Home", 36], End: ["End", 35], Escape: ["Escape", 27] };
    const [code, virtualKey, text] = keys[key];
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, ...(text ? { text, unmodifiedText: text } : {}) });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
    await call("resize", (await call("snapshot")).host.width + 44);
    checkFailures();
  }
  async function click(kind, id) {
    const { x, y } = await call("target", kind, id);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await call("resize", (await call("snapshot")).host.width + 44);
    checkFailures();
  }
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: origin });
  await until(async () => { checkFailures(); return evaluate("Boolean(window.narrowFixture)"); }, 15000, "fixture navigation/ready", signal);
  checkFailures();

  // Old modules reach this existing-DOM mode assertion before any new selector.
  await call("layout", { column: 180, refresh: false });
  console.log("PASS initial minimum geometry gate");
  let states = 0;
  for (const refresh of [false, true]) for (const health of ["online", "offline", "error", "unknown"]) for (const activity of ["none", "session", "terminal", "both"]) for (const selected of ["local", "long"]) {
    const state = { column: 180, refresh, health, activity, selected };
    await call("reset", state); await call("layout", state); states += 1; checkFailures();
  }
  for (const column of [459, 460, 461, 600]) for (const refresh of [false, true]) {
    const state = { column, refresh, health: "unknown", activity: "both", selected: "local" };
    await call("reset", state); await call("layout", state); checkFailures();
  }
  console.log(`PASS ${states} minimum states plus 415/416/417 and wider host modes, both refresh states`);

  for (const nativeKey of ["Enter", " "]) {
    await call("reset"); await call("focus", "selector");
    await key(nativeKey); await call("expectState", { open: true, select: 0 }); await call("checkMenu");
    await key(nativeKey); await call("expectState", { open: false, select: 0 });
  }
  await call("reset", { health: "online" });
  await click("selector"); await call("checkMenu");
  await click("option", "remote");
  await call("expectState", { open: false, selected: "remote", select: 1 });
  await click("selector");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 1500, y: 850, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1500, y: 850, button: "left", clickCount: 1 });
  await call("resize", 180); await call("expectState", { open: false, select: 1 });

  for (const openingKey of ["ArrowUp", "ArrowDown"]) {
    await call("reset", { selected: "remote" }); await call("focus", "selector"); await key(openingKey);
    await call("expectState", { open: true, focused: "remote" });
    await key("ArrowDown"); await call("expectState", { focused: "long" });
    await key("ArrowUp"); await call("expectState", { focused: "remote" });
    await key("Home"); await key("ArrowUp"); await call("expectState", { focused: "local" });
    await key("End"); await key("ArrowDown"); await call("expectState", { focused: "unknown" });
    await key(openingKey === "ArrowUp" ? "Escape" : "ArrowLeft");
    await call("expectState", { open: false, focused: "selector", select: 0, next: 0 });
  }
  await call("reset"); await call("focus", "selector"); await key("ArrowRight");
  await call("expectState", { next: 1, select: 0 });
  await key("ArrowDown"); await key("ArrowRight");
  await call("expectState", { open: false, next: 2, select: 0 });

  for (const refresh of [false, true]) {
    await call("reset", { column: 459, refresh, health: "unknown", activity: "both" });
    await call("focus", "selector"); await key("ArrowDown"); await key("ArrowDown");
    await call("expectState", { focused: "remote", selected: "local", open: true }); await call("remember");
    for (const column of [460, 461, 460, 459]) {
      await call("resize", column); await call("unchanged");
      await call("layout", { column, refresh });
    }
    const before = await call("snapshot");
    await key("Escape"); await call("resize", 460); await click("selector"); await call("checkMenu");
    const after = await call("snapshot");
    assert(Math.abs(before.button.bottom - after.button.bottom) > 1, "Resize fixture did not move the trigger; reopen check is vacuous");
    await call("expectState", { selected: "local", select: 0, next: 0, actions: 0, reload: 0 });
  }
  await call("reset", { refresh: true });
  await click("actions"); await click("refresh");
  await call("expectState", { actions: 1, reload: 1, select: 0, next: 0 });
  checkFailures();
  console.log("PASS native Enter/Space/click, full menu, clamped navigation, focus, resize identity, menu reanchor, Actions and refresh callbacks");
}

async function run() {
  const chromeBin = findChrome();
  const temp = await mkdtemp(join(tmpdir(), "pi-webui-narrow-navigation-"));
  const failures = [];
  const cleanupErrors = [];
  let chrome, server, cdp, primary, workPromise;
  let timer;
  const controller = new AbortController();
  const signal = controller.signal;
  const signalHandlers = new Map();
  try {
    if (overlay) {
      console.log(`Source overlay baseline ${oldRevision}`);
      for (const path of modules) { assert(existsSync(join(overlay, path)), `Missing overlay module ${path}`); console.log(`${path} -> ${join(overlay, path)}`); }
    }
    const profile = join(temp, "profile"); await mkdir(profile);
    const serverPort = await port();
    let debugPort = await port();
    for (let attempt = 0; debugPort === serverPort && attempt < 8; attempt += 1) debugPort = await port();
    assert.notEqual(debugPort, serverPort, "Could not allocate distinct temporary ports");
    const origin = `http://127.0.0.1:${serverPort}/`;
    server = start(process.execPath, [self, "--fixture-server", "--port", String(serverPort), "--temp-root", temp, ...(overlay ? ["--source-overlay", overlay] : [])], "vite", temp, failures);
    const work = async () => {
      await until(async () => { assert.equal(failures.length, 0, failures.join("\n")); const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); return response.ok; }, 15000, "fixture HTTP readiness", signal);
      signal.throwIfAborted();
      chrome = start(chromeBin, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--window-size=1600,900", "--force-device-scale-factor=1", "--disable-background-networking", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-features=Translate,MediaRouter,OptimizationHints", "--no-default-browser-check", "--no-first-run", "--no-sandbox", "about:blank"], "chromium", temp, failures);
      await until(() => { assert.equal(failures.length, 0, failures.join("\n")); return json(`http://127.0.0.1:${debugPort}/json/version`); }, 10000, "Chromium readiness", signal);
      signal.throwIfAborted();
      const page = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
      cdp = await CDP.connect(page.webSocketDebuggerUrl, (method, params) => {
        if (method === "Runtime.exceptionThrown") failures.push(`Browser exception: ${JSON.stringify(params.exceptionDetails)}`);
        if (method === "Runtime.consoleAPICalled" && params.type === "error") failures.push(`Console error: ${JSON.stringify(params.args)}`);
        if (method === "Log.entryAdded" && params.entry?.level === "error") failures.push(`Browser log error: ${params.entry.text}`);
        if (method === "Network.requestWillBeSent" && /^https?:/u.test(params.request.url) && new URL(params.request.url).origin !== new URL(origin).origin) failures.push(`Offline violation: ${params.request.url}`);
      }, signal);
      await acceptance(cdp, origin, failures, signal);
    };
    const interrupted = new Promise((_, reject) => {
      for (const signal of ["SIGINT", "SIGTERM"]) { const handler = () => reject(new Error(`Interrupted: ${signal}`)); signalHandlers.set(signal, handler); process.once(signal, handler); }
    });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Acceptance exceeded 120000ms wall-clock budget")), 120000); });
    workPromise = work();
    await Promise.race([workPromise, interrupted, deadline]);
  } catch (error) {
    primary = error;
    controller.abort(error);
    cdp?.fail(error);
    for (const name of ["vite", "chromium"]) {
      try { console.error(`${name} log tail:\n${(await readFile(join(temp, `${name}.log`), "utf8")).slice(-12000)}`); }
      catch (logError) { if (logError.code !== "ENOENT") cleanupErrors.push(logError); }
    }
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("Acceptance runner stopped"));
    cdp?.fail(signal.reason);
    if (workPromise) {
      try { await bounded(workPromise.catch(() => {}), 10000, "acceptance cancellation drain"); }
      catch (error) { cleanupErrors.push(error); }
    }
    for (const [name, handler] of signalHandlers) process.removeListener(name, handler);
    for (const [label, action] of [["CDP", () => cdp?.close()], ["Chromium", () => stop(chrome, "Chromium")], ["Vite", () => stop(server, "Vite")], ["temporary files", () => bounded(rm(temp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }), 3000, "temporary cleanup")]]) {
      try { await action(); } catch (error) { cleanupErrors.push(new Error(`${label} cleanup failed: ${error.message}`)); }
    }
  }
  if (failures.length) cleanupErrors.push(new Error(failures.join("\n")));
  if (primary || cleanupErrors.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], "Narrow navigation acceptance failed");
  console.log("PASS narrow navigation acceptance; browser/server/profile/logs cleaned");
}

try { if (serverMode) await serveFixture(); else await run(); }
catch (error) { console.error(error); process.exitCode = 1; }

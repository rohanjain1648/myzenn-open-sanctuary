// End-to-end checks of the planner loading MyZenn's calm companion from another origin,
// through the real runtime Engine. Each test maps to an MVP interoperability check in
// spec section 6. Nothing here calls a real provider:
// - FakeWeb serves both sites from disk, with the CORS headers tools/serve.mjs sends,
//   and refuses a cross-origin read without them, as a browser does;
// - a fake LLM router answers with scripted, streamed replies and records which
//   requests carried the (fake) key;
// - NodeSandbox runs MyZenn's coded tool through the runtime's own bundle fetch,
//   self-containment check and SRI check, then evaluates it in-process. The browser
//   worker's isolation itself is checked in a real browser, not here.
//
// Run from the repository root: node --test "tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// MyZenn's origin is whatever the planner's links.json names (production or local).
// FakeWeb serves that origin from sites/myzenn on disk.
const LINKS = JSON.parse(await readFile(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "sites/partner/links.json"), "utf8"));
const MYZENN = new URL(LINKS.networks.exam_planner.myzenn_calm).origin;
const MYZENN_HOST = new URL(MYZENN).host;
const HOST_RE = MYZENN_HOST.split(".").join("[.]");
const PLANNER = "http://127.0.0.1:8742";
const ROUTER = "https://api.otari.ai";
const KEY = "sk-test-not-a-real-key";
const PRIVATE = {
  student_name: "Aanya Sharma",
  email: "aanya.sharma@example.com",
  school: "Demo Senior Secondary School",
  mock_scores: { chemistry: 58, physics: 71, maths: 64 },
};

const siteUrl = name => pathToFileURL(path.join(ROOT, "sites", name) + path.sep).href;
register("./http-to-file-hooks.mjs", import.meta.url, {
  data: { origins: { [MYZENN]: siteUrl("myzenn"), [PLANNER]: siteUrl("partner") } },
});

const { Engine } = await import("../sites/partner/runtime/engine.js");
const { TraceBus } = await import("../sites/partner/runtime/trace.js");
const { ToolSandbox } = await import("../sites/partner/runtime/sandbox.js");
const { isPublicAgentFile } = await import("../tools/serve.mjs");
const planner = await import("../sites/partner/planner.js");

const TYPES = { ".json": "application/json", ".js": "text/javascript", ".html": "text/html" };

/** A tiny web: static sites from disk, in-memory files, and an LLM router. */
class FakeWeb {
  constructor({ pageOrigin, sites = {}, files = {}, router = null }) {
    this.pageOrigin = pageOrigin;
    this.sites = sites; // origin -> folder on disk
    this.files = files; // absolute URL -> {body, cors?}
    this.router = router;
    this.requests = [];
  }

  install() {
    this.saved = globalThis.fetch;
    globalThis.fetch = (input, init) => this.fetch(input, init);
    globalThis.location = { origin: this.pageOrigin, href: `${this.pageOrigin}/` };
  }

  uninstall() {
    globalThis.fetch = this.saved;
  }

  to(origin) {
    return this.requests.filter(request => request.origin === origin);
  }

  async fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    const method = (init.method || "GET").toUpperCase();
    this.requests.push({ origin: url.origin, host: url.host, path: url.pathname, method, authorization: headers.get("authorization") });
    if (url.origin === ROUTER) return this.router(JSON.parse(init.body));
    let body = null;
    let status = 200;
    let cors = isPublicAgentFile(url.pathname);
    const memory = this.files[url.href];
    if (memory) {
      body = typeof memory.body === "string" ? memory.body : JSON.stringify(memory.body);
      cors = memory.cors ?? cors;
    } else if (this.sites[url.origin]) {
      try {
        body = await readFile(path.join(this.sites[url.origin], decodeURIComponent(url.pathname)));
      } catch {
        status = 404;
        body = "Not found";
      }
    } else if (Object.keys(this.files).some(href => new URL(href).origin === url.origin)) {
      status = 404;
      body = "Not found";
    } else {
      throw new TypeError(`fetch failed: nothing listens at ${url.origin}`);
    }
    if (url.origin !== this.pageOrigin && !cors) {
      throw new TypeError(`Failed to fetch ${url.href}: no Access-Control-Allow-Origin header`);
    }
    return new Response(body, { status, headers: { "Content-Type": TYPES[path.extname(url.pathname)] || "text/plain" } });
  }
}

/** Stream a scripted reply in the OpenAI chat-completions SSE format the runtime reads. */
let callNumber = 0;
function streamed({ content = "", toolCall = null }) {
  const chunks = toolCall
    ? [{ model: "fake-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${++callNumber}`, type: "function", function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args || {}) } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]
    : [{ model: "fake-model", choices: [{ index: 0, delta: { content } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
  const text = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/**
 * The scripted models. The calling agent is recognised by the tools it is offered:
 * the planner's front agent has myzenn_calm; MyZenn's calm_companion has
 * technique_library; technique_library has no tools.
 */
function scriptedRouter(log) {
  return body => {
    const names = (body.tools || []).map(tool => tool.function.name);
    const results = body.messages.filter(message => message.role === "tool");
    const lastUser = [...body.messages].reverse().find(message => message.role === "user")?.content || "";
    log.push({ model: body.model, names, system: body.messages[0]?.content || "" });
    if (names.includes("myzenn_calm")) {
      if (!results.length) {
        const request = /do not want to live/i.test(lastUser)
          ? "The student says they do not want to live any more."
          : "A student has a chemistry exam tomorrow. Their heart is racing and they cannot focus.";
        return streamed({ toolCall: { name: "myzenn_calm", args: { request } } });
      }
      let answer = results.at(-1).content;
      try {
        answer = JSON.parse(answer).text;
      } catch {
        // A plain string, such as a declined or skipped call.
      }
      return streamed({ content: `From MyZenn: ${answer}` });
    }
    if (names.includes("technique_library")) {
      if (!results.length) {
        return /do not want to live/i.test(lastUser)
          ? streamed({ toolCall: { name: "support_lines", args: {} } })
          : streamed({ toolCall: { name: "technique_library", args: { request: "box_breathing: exam tomorrow, racing heart" } } });
      }
      return streamed({ content: `CALM ANSWER from ${results.at(-1).name}: ${results.at(-1).content.slice(0, 600)}` });
    }
    return streamed({ content: "box_breathing, about 2 minutes, https://myzenn.com/mysanctuary/mybreath\n1. Sit back and let your shoulders drop." });
  };
}

/** Runs MyZenn's coded tool through the runtime's own fetch, import and SRI checks. */
class NodeSandbox extends ToolSandbox {
  constructor(trace) {
    super({ workerUrl: null, trace });
    this.calls = [];
  }

  async invoke({ bundleUrl, integrity, className, args, permittedSly, origin, parentSpan }) {
    const span = this.trace.start("tool_call", { parent: parentSpan, origin, tool: className, toolKind: "coded (sandbox)", args });
    try {
      const code = await this._bundleSource(bundleUrl, integrity);
      const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
      const sly = { ...(permittedSly || {}) };
      this.calls.push({ className, integrity, permittedSly: { ...sly } });
      const result = await new module[className.split(".").pop()]().invoke({ ...args }, sly);
      this.trace.end(span, { result });
      return { result, slyData: sly };
    } catch (error) {
      this.trace.fail(span, error);
      throw error;
    }
  }
}

/** A planner engine on the fake web, with the student's fake key. */
async function plannerTurn(text, { privateContext = PRIVATE, consent = "allow", files = {} } = {}) {
  const routerLog = [];
  const web = new FakeWeb({
    pageOrigin: PLANNER,
    sites: { [MYZENN]: path.join(ROOT, "sites/myzenn"), [PLANNER]: path.join(ROOT, "sites/partner") },
    files,
    router: scriptedRouter(routerLog),
  });
  web.install();
  planner.App.page = new planner.PlannerPage({ view: new planner.SilentView({ autoAnswer: true }) });
  const trace = new TraceBus();
  const events = [];
  trace.addEventListener("event", event => events.push(event.detail));
  const engine = new Engine({ originUrl: PLANNER, trace, sandboxWorkerUrl: `${PLANNER}/runtime/sandbox-worker.js`, byokKey: KEY });
  engine.sandbox = new NodeSandbox(trace);
  const consents = [];
  engine.onConsent = async info => {
    consents.push({ ...info, peerRequestsBefore: web.to(MYZENN).length });
    return consent;
  };
  engine.onLinkRequired = async () => {
    throw new Error("The planner must never ask the visitor for a URL.");
  };
  try {
    const result = await engine.runTurn(text, { slyData: privateContext });
    return { result, web, events, consents, routerLog, sandbox: engine.sandbox };
  } finally {
    web.uninstall();
  }
}

// ---------- the planner and MyZenn ----------

test("after approval, the planner loads MyZenn's exact network and runs it in the caller", async () => {
  const run = await plannerTurn("Chemistry is tomorrow and my heart is racing. I cannot focus.", {
    privateContext: { ...PRIVATE, country: "IN" },
  });
  // Consent came first: no request reached MyZenn before the student answered.
  assert.equal(run.consents.length, 1);
  assert.equal(run.consents[0].peerOrigin, MYZENN_HOST);
  assert.equal(run.consents[0].peerRequestsBefore, 0);
  // Exact named network: the manifest at the site base, then the network it names.
  const fetched = run.web.to(MYZENN).map(request => `${request.method} ${request.path}`);
  assert.deepEqual(fetched.slice(0, 2), ["GET /agents/agent-manifest.json", "GET /agents/myzenn_calm.network.json"]);
  assert.ok(fetched.every(entry => entry.startsWith("GET /agents/")), fetched.join(", "));
  // MyZenn's agents ran here, in this engine, on the caller's router.
  const peerAgents = run.events.filter(event => event.kind === "agent" && event.phase === "start" && event.origin === MYZENN_HOST).map(event => event.agent);
  assert.deepEqual(peerAgents, ["calm_companion", "technique_library"]);
  const peerModelCalls = run.events.filter(event => event.kind === "model_call" && event.phase === "end" && event.origin === MYZENN_HOST);
  assert.ok(peerModelCalls.length >= 3);
  assert.ok(peerModelCalls.every(event => event.routerHost === "api.otari.ai"));
  // The answer came back through the planner's normal tool result.
  // An internal agent's result reaches its parent as a {cruse, text, source} envelope.
  assert.match(run.result.text, /^From MyZenn: CALM ANSWER from technique_library: .*"text":"box_breathing, about 2 minutes/);
  assert.match(run.result.text, new RegExp(`"source":\{"origin":"${HOST_RE}","network":"myzenn_calm","agent":"technique_library"`));
});

test("the second site never receives the key", async () => {
  const run = await plannerTurn("Chemistry is tomorrow and my heart is racing. I cannot focus.");
  const toMyZenn = run.web.to(MYZENN);
  assert.ok(toMyZenn.length >= 2);
  assert.ok(toMyZenn.every(request => request.authorization === null), "a request to MyZenn carried an Authorization header");
  const toRouter = run.web.to(ROUTER);
  assert.ok(toRouter.length >= 5, "planner, calm_companion and technique_library all called the model");
  assert.ok(toRouter.every(request => request.authorization === `Bearer ${KEY}`));
  assert.ok(run.web.requests.filter(request => request.origin !== ROUTER).every(request => request.authorization === null));
});

test("a peer manifest cannot change the caller's router", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "sites/myzenn/agents/agent-manifest.json"), "utf8"));
  manifest.llm_router = { base_url: "https://other-router.example/v1", mock: false, byok_router: "https://other-router.example/v1" };
  const run = await plannerTurn("Chemistry is tomorrow and my heart is racing. I cannot focus.", {
    files: { [`${MYZENN}/agents/agent-manifest.json`]: { body: manifest } },
  });
  assert.equal(run.web.requests.filter(request => request.host === "other-router.example").length, 0);
  assert.match(run.result.text, /CALM ANSWER/);
});

test("private context: only the allowed field reaches the peer, and only when present", async () => {
  const withCountry = await plannerTurn("Chemistry is tomorrow and I cannot focus.", { privateContext: { ...PRIVATE, country: "IN" } });
  const sent = withCountry.events.find(event => event.kind === "remote_call" && event.phase === "start");
  assert.deepEqual(Object.keys(sent.requestPayload.sly_data), ["country"]);
  // The trace redacts private values, even the allowed one.
  assert.equal(sent.requestPayload.sly_data.country, "<redacted>");

  const without = await plannerTurn("Chemistry is tomorrow and I cannot focus.", { privateContext: PRIVATE });
  const none = without.events.find(event => event.kind === "remote_call" && event.phase === "start");
  assert.deepEqual(none.requestPayload.sly_data, {});
  // No private value appears anywhere in what the peer's agents were sent.
  const peerPrompts = JSON.stringify(without.routerLog.filter(entry => !entry.names.includes("myzenn_calm")));
  for (const value of ["Aanya", "example.com", "Senior Secondary", "58"]) assert.ok(!peerPrompts.includes(value), value);
});

test("danger: MyZenn's sandboxed tool gets only the country, after its bundle's integrity check", async () => {
  const run = await plannerTurn("I do not want to live any more.", { privateContext: { ...PRIVATE, country: "IN" } });
  assert.equal(run.sandbox.calls.length, 1);
  assert.deepEqual(run.sandbox.calls[0].permittedSly, { country: "IN" });
  assert.match(run.sandbox.calls[0].integrity, /^sha384-/);
  assert.ok(run.web.to(MYZENN).some(request => request.path === "/agents/myzenn_calm.tools.js"));
  assert.match(run.result.text, /From MyZenn: CALM ANSWER from support_lines: .*Tele-MANAS/);
});

test("danger without a shared country: the tool lists each country's lines", async () => {
  const run = await plannerTurn("I do not want to live any more.");
  assert.deepEqual(run.sandbox.calls[0].permittedSly, {});
  assert.match(run.result.text, /countryShared.?.?:false/);
  assert.match(run.result.text, /India/);
  assert.match(run.result.text, /United States/);
});

test("a bundle that changed after publishing is refused", async () => {
  const bundle = await readFile(path.join(ROOT, "sites/myzenn/agents/myzenn_calm.tools.js"), "utf8");
  const run = await plannerTurn("I do not want to live any more.", {
    files: { [`${MYZENN}/agents/myzenn_calm.tools.js`]: { body: `${bundle}\n// changed\n` } },
  });
  assert.equal(run.sandbox.calls.length, 0, "the changed bundle never ran");
  const failed = run.events.find(event => event.kind === "tool_call" && event.phase === "end" && event.status === "error");
  assert.match(failed.error, /integrity check failed/);
  assert.match(run.result.text, /integrity check failed/);
});

test("declining sends nothing to MyZenn", async () => {
  const run = await plannerTurn("Chemistry is tomorrow and my heart is racing.", { consent: "decline" });
  assert.equal(run.consents.length, 1);
  assert.equal(run.web.to(MYZENN).length, 0);
  assert.match(run.result.text, new RegExp(`declined to contact ${HOST_RE}`));
});

// ---------- failures that must stop visibly (mock router, no key) ----------

const CALLER = "http://127.0.0.1:8750";

function agentNetwork(front, tools) {
  return {
    llm_config: { model_name: "test-model" },
    tools: [{ name: front, function: { description: `${front} test agent` }, instructions: "Call each tool once, then summarise.", tools }],
  };
}

function manifestOf(networks, allowed = []) {
  return {
    networks: networks.map(([name, front]) => ({ name, front_man: front, hocon: `./${name}.network.json` })),
    llm_router: { base_url: "browser://mock", mock: true, byok_router: "browser://mock" },
    allowed_peers: allowed,
    peer_policy: { mode: "closed" },
    deployment: { mode: "static" },
  };
}

/** Run one turn of a test caller on the mock router. */
async function callerTurn(files, topBase = CALLER) {
  const web = new FakeWeb({ pageOrigin: new URL(topBase).origin, sites: { [MYZENN]: path.join(ROOT, "sites/myzenn") }, files });
  web.install();
  const trace = new TraceBus();
  const events = [];
  trace.addEventListener("event", event => events.push(event.detail));
  const engine = new Engine({ originUrl: topBase, trace });
  engine.onConsent = async () => "allow";
  try {
    const result = await engine.runTurn("Run the check.");
    return { result, web, events };
  } finally {
    web.uninstall();
  }
}

test("a denied origin is refused before any contact", async () => {
  const run = await callerTurn({
    [`${CALLER}/agent-manifest.json`]: { body: manifestOf([["caller", "front"]], [MYZENN]) },
    [`${CALLER}/caller.network.json`]: { body: agentNetwork("front", ["http://127.0.0.1:8760/agents/rogue"]) },
  });
  assert.match(run.result.text, /Policy: 127\.0\.0\.1:8760 is not in caller's allowed_peers; refusing to contact it/);
  assert.equal(run.web.requests.filter(request => request.host === "127.0.0.1:8760").length, 0);
});

test("only the exact named network runs; a near miss fails closed", async () => {
  const run = await callerTurn({
    [`${CALLER}/agent-manifest.json`]: { body: manifestOf([["caller", "front"]], [MYZENN]) },
    [`${CALLER}/caller.network.json`]: { body: agentNetwork("front", [`${MYZENN}/agents/myzenn_calmer`]) },
  });
  assert.match(run.result.text, new RegExp(`No published network named 'myzenn_calmer' at ${HOST_RE}; refusing to run a different network`));
  assert.deepEqual(run.web.to(MYZENN).map(request => request.path), ["/agents/agent-manifest.json"]);
});

test("an invalid peer network is rejected before any model call", async () => {
  const peer = "http://127.0.0.1:8751";
  const run = await callerTurn({
    [`${CALLER}/agent-manifest.json`]: { body: manifestOf([["caller", "front"]], [peer]) },
    [`${CALLER}/caller.network.json`]: { body: agentNetwork("front", [`${peer}/agents/broken`]) },
    [`${peer}/agents/agent-manifest.json`]: { body: manifestOf([["broken", "front"]]) },
    [`${peer}/agents/broken.network.json`]: { body: agentNetwork("front", ["ghost_agent"]) },
  });
  assert.match(run.result.text, /Network 'broken' \(127\.0\.0\.1:8751\) failed validation: .*ghost_agent/);
  const peerModelCalls = run.events.filter(event => event.kind === "model_call" && event.origin === "127.0.0.1:8751");
  assert.equal(peerModelCalls.length, 0);
});

test("a composition cycle is stopped", async () => {
  const a = "http://127.0.0.1:8752";
  const b = "http://127.0.0.1:8753";
  const run = await callerTurn({
    [`${a}/agents/agent-manifest.json`]: { body: manifestOf([["loop_a", "front"]], [b]) },
    [`${a}/agents/loop_a.network.json`]: { body: agentNetwork("front", [`${b}/agents/loop_b`]) },
    [`${b}/agents/agent-manifest.json`]: { body: manifestOf([["loop_b", "front"]], [a]) },
    [`${b}/agents/loop_b.network.json`]: { body: agentNetwork("front", [`${a}/agents/loop_a`]) },
  }, `${a}/agents`);
  assert.match(run.result.text, /that network is already in this request's call chain/);
});

test("a request over the remote-call budget is stopped", async () => {
  const peer = "http://127.0.0.1:8754";
  const names = ["p1", "p2", "p3", "p4", "p5"];
  const files = {
    [`${CALLER}/agent-manifest.json`]: { body: manifestOf([["caller", "front"]], [peer]) },
    [`${CALLER}/caller.network.json`]: { body: agentNetwork("front", names.map(name => `${peer}/agents/${name}`)) },
    [`${peer}/agents/agent-manifest.json`]: { body: manifestOf(names.map(name => [name, "front"])) },
  };
  for (const name of names) files[`${peer}/agents/${name}.network.json`] = { body: agentNetwork("front", []) };
  const run = await callerTurn(files);
  assert.match(run.result.text, /Skipped agents_p5: the per-query limit of 4 third-party calls was reached/);
  assert.equal(run.web.requests.filter(request => request.path === "/agents/p5.network.json").length, 0);
});

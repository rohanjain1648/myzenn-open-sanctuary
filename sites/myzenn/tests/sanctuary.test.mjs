// Checks that MyPal's network, the manifest, the page object and its actions work
// together. Uses the real runtime with a scripted model; no LLM provider is called.
// Run from the repository root: node --test "sites/myzenn/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { ScriptedModel } from "./scripted_model.mjs";
import { App, SanctuaryPage, SilentView } from "../sanctuary.js";
import { registerActions } from "../site-actions.js";
import { SafetyNet } from "../safety-net.js";
import { TOOLS } from "../data/catalog.js";
import { HELPLINES } from "../data/support.js";
import { EMOTIONS, isEmotionPath } from "../data/emotions.js";

const NETWORK = "myzenn_sanctuary";
const BASE = "http://localhost:8080";
const SCOPE = { base: BASE, network: NETWORK };
const MEDICAL_CLAIMS = /blood pressure|immune|prevent(s)? panic|clinical|cure|diagnos(e|is) (you|your)|treat(s|ment) (anxiety|depression)|heart rate/i;

const config = JSON.parse(await readFile(new URL(`../${NETWORK}.network.json`, import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
const network = new AgentNetwork(config, NETWORK);

async function makeRegistry() {
  const registry = new ActionRegistry();
  await registerActions({ register: registry.register.bind(registry, SCOPE) });
  return registry;
}

function ref(registry, name) {
  const entry = registry.catalog(SCOPE).find(e => e.name === name);
  if (!entry) throw new Error(`Action ${name} is not registered.`);
  return entry.ref;
}

async function run(registry, name, args = {}) {
  const plan = registry.prepare({ kind: "action", action: ref(registry, name), arguments: args });
  const receipts = await registry.execute(plan, async () => true, `test-${name}`);
  return receipts[0];
}

/** A fresh page for each test, so tests do not share state. */
function freshPage({ autoAnswer = true, clock } = {}) {
  App.page = new SanctuaryPage({ view: new SilentView({ autoAnswer }), clock });
  return App.page;
}

// ---------- network and manifest ----------

test("network is valid, has two agents and a reachable specialist", () => {
  const result = validateNetwork(network);
  assert.equal(result.ok ?? result.valid ?? true, true, JSON.stringify(result));
  assert.equal(network.findFrontMan(), "mypal");
  assert.deepEqual(config.tools.map(t => t.name), ["mypal", "sanctuary_guide"]);
  assert.deepEqual(network.getAgentSpec("mypal").tools, ["sanctuary_guide"]);
});

test("manifest names the network, front agent and every registered action", async () => {
  const entry = manifest.networks[0];
  assert.equal(entry.name, NETWORK);
  assert.equal(entry.front_man, "mypal");
  assert.equal(entry.hocon, `./${NETWORK}.network.json`);
  assert.deepEqual(entry.sample_queries, config.metadata.sample_queries);
  const registry = await makeRegistry();
  const names = registry.catalog(SCOPE).map(e => e.name).sort();
  assert.deepEqual([...manifest.actions.agentTools].sort(), names);
  for (const e of registry.catalog(SCOPE)) assert.equal(e.availability, "local-only", e.name);
  for (const e of registry.catalog(SCOPE)) assert.notEqual(e.effect, "irreversible", `${e.name} should not need a dialog`);
});

test("MyPal's expanded instructions carry the care rules", () => {
  // The published file keeps {placeholders}; the browser expands them once, like this.
  const strings = config.commondefs.replacement_strings;
  const expand = text => text.replace(/\{(\w+)\}/g, (all, key) => strings[key] ?? all);
  const mypal = expand(network.getAgentSpec("mypal").instructions);
  assert.doesNotMatch(mypal, /\{\w+\}/, "an unexpanded placeholder is left");
  assert.match(mypal, /not a therapist, doctor or crisis service/);
  assert.match(mypal, /Never diagnose/);
  assert.match(mypal, /call website_show_support and website_get_support_resources/);
  assert.match(mypal, /Never invent a helpline/);
  assert.ok(mypal.length < 4200, `mypal instructions are ${mypal.length} chars`);
});

// ---------- reading ----------

test("the front agent reads page state through runAgent", async () => {
  freshPage();
  const registry = await makeRegistry();
  const model = new ScriptedModel([
    { tool: "website_get_sanctuary_state", arguments: {} },
    { text: "Nothing is running right now." },
  ]);
  const ctx = {
    network, manifest, actions: registry, baseOrigin: BASE, displayOrigin: "localhost:8080",
    trace: new TraceBus(), isTop: true, frontMan: "mypal", history: [], llm: model,
  };
  const result = await runAgent(ctx, "mypal", "How are things on the page?", null, []);
  assert.match(result.text, /Nothing is running/);
  const offered = model.toolNames(0);
  for (const name of manifest.actions.agentTools) assert.ok(offered.includes(`website_${name}`), name);
  assert.ok(offered.includes("sanctuary_guide"));
  const [receipt] = model.toolResults(1);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.active, null);
  assert.equal(receipt.result.toolsOnThisPage.length, 4);
});

test("catalog: 18 tools, unique ids, myzenn.com links, no medical claims", () => {
  const catalog = freshPage().getCatalog();
  assert.equal(catalog.tools.length, 18);
  assert.equal(new Set(catalog.tools.map(t => t.id)).size, 18);
  for (const tool of catalog.tools) {
    assert.match(tool.url, /^https:\/\/myzenn\.com\//, tool.id);
    assert.ok(catalog.categories.some(c => c.id === tool.category), tool.id);
    assert.doesNotMatch(`${tool.summary} ${tool.goodFor} ${tool.tip}`, MEDICAL_CLAIMS, tool.id);
  }
  assert.deepEqual(TOOLS.filter(t => t.onPage).map(t => t.onPage).sort(), ["anchor", "breathing", "grounding", "wheel"]);
});

test("support resources are complete and the read gives no raw dial strings", () => {
  const support = freshPage().getSupport();
  assert.ok(support.helplines.length >= 5);
  for (const line of HELPLINES) assert.ok(line.country && line.name && line.contact && line.hours, line.name);
  for (const line of support.helplines) assert.equal(line.tel, undefined);
  assert.ok(support.emergency.some(e => e.number === "112"));
});

// ---------- writes with consent ----------

test("start_breathing starts only after the visitor accepts", async () => {
  const page = freshPage({ autoAnswer: true });
  const registry = await makeRegistry();
  const receipt = await run(registry, "start_breathing", { seconds: 3, rounds: 5 });
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.ok, true);
  assert.equal(page.active.tool, "breathing");
  assert.deepEqual(page.active.params, { seconds: 3, rounds: 5 });
  assert.equal(page.active.source, "pal");
  assert.equal(page.view.proposals[0].summary, "box breathing: 5 rounds of 3 seconds per side, about 1 minutes.".replace("about 1 minutes", "about a minute"));
  assert.equal(page.pending, null);
});

test("a declined suggestion changes nothing and tells the agent", async () => {
  const page = freshPage({ autoAnswer: false });
  const registry = await makeRegistry();
  const receipt = await run(registry, "start_grounding");
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.ok, false);
  assert.equal(receipt.result.declined, true);
  assert.equal(page.active, null);
  assert.equal(page.finished.length, 0);
});

test("a site refusal shows no suggestion card", async () => {
  const page = freshPage();
  const registry = await makeRegistry();
  const blank = await run(registry, "start_focus_anchor", { intention: "   " });
  assert.equal(blank.result.ok, false);
  assert.equal(blank.result.field, "intention");
  const long = await run(registry, "start_focus_anchor", { intention: "x".repeat(100) });
  assert.equal(long.result.ok, false);
  assert.equal(page.view.proposals.length, 0);
  assert.equal(page.active, null);
});

test("arguments outside the schema never reach the page", async () => {
  const page = freshPage();
  const registry = await makeRegistry();
  for (const [name, args] of [
    ["start_breathing", { seconds: 10 }],
    ["start_breathing", { rounds: 1 }],
    ["open_emotion_wheel", { core: "Elated" }],
    ["start_focus_anchor", { intention: "read", minutes: 7 }],
    ["start_grounding", { extra: true }],
  ]) {
    assert.throws(() => registry.prepare({ kind: "action", action: ref(registry, name), arguments: args }), undefined, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(page.view.proposals.length, 0);
});

test("a new suggestion closes the old one as declined", async () => {
  const page = freshPage({ autoAnswer: null });
  const first = page.propose("breathing", { seconds: 4, rounds: 4 }, "first");
  const second = page.propose("grounding", {}, "second");
  const answer = await first;
  assert.equal(answer.accepted, false);
  assert.match(answer.reason, /new suggestion/);
  assert.equal(page.pending.summary, "second");
  page.answerProposal(page.pending.id, true);
  assert.equal((await second).accepted, true);
});

test("when the visitor starts a tool themselves, an open suggestion closes", async () => {
  const page = freshPage({ autoAnswer: null });
  const waiting = page.propose("wheel", { core: null }, "wheel");
  page.startBreathing({});
  const answer = await waiting;
  assert.equal(answer.accepted, false);
  assert.match(answer.reason, /themselves/);
  assert.equal(page.active.tool, "breathing");
  assert.equal(page.active.source, "visitor");
});

test("show_support opens the panel at once, without a suggestion", async () => {
  const page = freshPage({ autoAnswer: null });
  const registry = await makeRegistry();
  const receipt = await run(registry, "show_support");
  assert.equal(receipt.result.ok, true);
  assert.equal(page.supportOpen, true);
  assert.equal(page.pending, null);
  assert.equal(receipt.result.state.supportOpen, true);
});

test("wheel opened by MyPal records the feeling the visitor picks", async () => {
  const page = freshPage();
  const registry = await makeRegistry();
  await run(registry, "open_emotion_wheel", { core: "Sad" });
  assert.deepEqual(page.active.path, ["Sad"]);
  assert.equal(page.chooseEmotion(["Sad", "Nope"]).ok, false);
  assert.equal(page.chooseEmotion(["Sad", "Lonely"]).ok, true);
  const done = page.chooseEmotion(["Sad", "Lonely", "Isolated"]);
  assert.equal(done.ok, true);
  assert.deepEqual(done.ended.path, ["Sad", "Lonely", "Isolated"]);
  assert.equal(done.ended.source, "pal");
  assert.deepEqual(page.getState().lastEmotion.path, ["Sad", "Lonely", "Isolated"]);
  assert.equal(page.active, null);
});

test("every wheel path in the data is valid, and only those", () => {
  for (const core of EMOTIONS) {
    for (const middle of core.children) {
      for (const leaf of middle.children) assert.ok(isEmotionPath([core.name, middle.name, leaf]));
    }
  }
  assert.equal(isEmotionPath(["Happy", "Lonely"]), false);
  assert.equal(isEmotionPath([]), false);
});

test("grounding walks five senses, then ends as completed", () => {
  const page = freshPage();
  page.startGrounding();
  for (let i = 0; i < 4; i += 1) page.advanceGrounding();
  assert.equal(page.getState().active.progress.step, 5);
  const end = page.advanceGrounding();
  assert.deepEqual({ tool: end.ended.tool, completed: end.ended.completed }, { tool: "grounding", completed: true });
});

// ---------- timing ----------

test("breathing phases follow the square, then finish", () => {
  const p = { seconds: 4, rounds: 4 };
  const at = ms => SanctuaryPage.breathingProgress(p, ms);
  assert.deepEqual([at(0).phase, at(4000).phase, at(8000).phase, at(12000).phase], ["in", "hold", "out", "rest"]);
  assert.equal(at(0).secondsLeftInPhase, 4);
  assert.equal(at(3500).secondsLeftInPhase, 1);
  assert.equal(at(16000).round, 2);
  assert.equal(at(63999).done, false);
  assert.equal(at(64000).done, true);
});

test("a timed tool completes on the clock", () => {
  let now = 1_000_000;
  const page = freshPage({ clock: () => now });
  page.startAnchor({ intention: "Read chapter 4", minutes: 5 });
  assert.equal(page.getState().active.progress.minutesLeft, 5);
  now += 4 * 60000 + 1;
  assert.equal(page.completeIfDone(), null);
  now += 60000;
  const end = page.completeIfDone();
  assert.equal(end.ended.completed, true);
  assert.equal(page.getState().endedThisVisit.at(-1).label, "MyAnchor");
});

// ---------- safety net ----------

test("safety net catches danger in English, Hinglish and Hindi", () => {
  for (const text of [
    "I want to die",
    "honestly i dont want to live anymore",
    "I don’t want to live like this",
    "thinking about suicide again",
    "I might hurt myself tonight",
    "main marna chahta hoon",
    "jeene ka mann nahi karta",
    "मैं मरना चाहती हूँ",
  ]) {
    assert.equal(SafetyNet.screen(text).urgent, true, text);
  }
});

test("safety net leaves ordinary stress alone", () => {
  for (const text of [
    "this exam is killing me",
    "I'm so stressed about tomorrow",
    "I feel low and tired",
    "my chest feels tight",
    "",
  ]) {
    assert.equal(SafetyNet.screen(text).urgent, false, text);
  }
});

test("safety net screens new turns and steering before the model", () => {
  const calls = [];
  const engine = {
    streamTurn(text) {
      calls.push(text);
      return { steer: guidance => calls.push(`steer:${guidance}`) };
    },
  };
  const alerts = [];
  SafetyNet.attach(engine, result => alerts.push(result.matched));
  const stream = engine.streamTurn("I feel anxious");
  assert.deepEqual(alerts, []);
  stream.steer("actually I want to end my life");
  assert.deepEqual(alerts, ["end my life"]);
  engine.streamTurn("suicidal thoughts");
  assert.equal(alerts.length, 2);
  // The message still reaches the model.
  assert.deepEqual(calls, ["I feel anxious", "steer:actually I want to end my life", "suicidal thoughts"]);
});

test("safety net screens the chat box even when the runtime refuses to send", () => {
  // A container that records capture listeners, like the chat's #agent-app.
  const input = { value: "", matches: sel => sel === "#ns-input" };
  const send = { closest: sel => (sel === "#ns-send" ? send : null) };
  const listeners = {};
  const root = {
    querySelector: sel => (sel === "#ns-input" ? input : null),
    addEventListener: (name, handler, capture) => { assert.equal(capture, true); listeners[name] = handler; },
  };
  const alerts = [];
  SafetyNet.watchInput(root, result => alerts.push(result.matched));
  input.value = "exam tomorrow, so stressed";
  listeners.keydown({ key: "Enter", target: input });
  assert.equal(alerts.length, 0);
  input.value = "I want to kill myself";
  listeners.keydown({ key: "a", target: input });
  assert.equal(alerts.length, 0, "only Enter sends");
  listeners.keydown({ key: "Enter", target: input });
  listeners.click({ target: send });
  assert.deepEqual(alerts, ["kill myself", "kill myself"]);
});

test("with no model connected, an urgent message stays with the page", () => {
  const input = { value: "I want to die", matches: () => true };
  const listeners = {};
  const root = { querySelector: () => input, addEventListener: (name, handler) => { listeners[name] = handler; } };
  let held = true;
  SafetyNet.watchInput(root, () => {}, { holdUrgent: () => held });
  const stopped = [];
  const event = { key: "Enter", target: input, preventDefault: () => stopped.push("default"), stopPropagation: () => stopped.push("propagation") };
  listeners.keydown(event);
  assert.deepEqual(stopped, ["default", "propagation"]);
  held = false;
  stopped.length = 0;
  listeners.keydown(event);
  assert.deepEqual(stopped, [], "with a model connected the message goes on to MyPal");
  input.value = "just stressed";
  held = true;
  listeners.keydown(event);
  assert.deepEqual(stopped, [], "ordinary messages are never held");
});

test("a failing support panel never blocks the visitor's message", () => {
  const engine = { streamTurn: text => ({ text }) };
  SafetyNet.attach(engine, () => { throw new Error("panel broke"); });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(engine.streamTurn("I want to die"), { text: "I want to die" });
  } finally {
    console.error = original;
  }
});

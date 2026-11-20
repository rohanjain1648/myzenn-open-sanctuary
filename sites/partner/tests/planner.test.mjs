// Checks the planner's network, manifest, link map, page object and actions together.
// Uses the real runtime with a scripted model; no LLM provider is called.
// Run from the repository root: node --test "sites/partner/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { buildToolTable, runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { ScriptedModel } from "./scripted_model.mjs";
import { App, PlannerPage, SilentView, toMinutes, toTime } from "../planner.js";
import { registerActions } from "../site-actions.js";
import { StudentContext } from "../context.js";
import { STUDENT } from "../data/week.js";

const NETWORK = "exam_planner";
const BASE = "http://127.0.0.1:8742";
const SCOPE = { base: BASE, network: NETWORK };
const read = path => readFile(new URL(path, import.meta.url), "utf8");

const config = JSON.parse(await read(`../${NETWORK}.network.json`));
const manifest = JSON.parse(await read("../agent-manifest.json"));
const links = JSON.parse(await read("../links.json"));
const network = new AgentNetwork(config, NETWORK);

async function makeRegistry() {
  const registry = new ActionRegistry();
  await registerActions({ register: registry.register.bind(registry, SCOPE) });
  return registry;
}

function ref(registry, name) {
  const entry = registry.catalog(SCOPE).find(candidate => candidate.name === name);
  if (!entry) throw new Error(`Action ${name} is not registered.`);
  return entry.ref;
}

async function run(registry, name, args = {}) {
  const plan = registry.prepare({ kind: "action", action: ref(registry, name), arguments: args });
  return (await registry.execute(plan, async () => true, `test-${name}`))[0];
}

function freshPage(autoAnswer = true) {
  App.page = new PlannerPage({ view: new SilentView({ autoAnswer }) });
  return App.page;
}

// ---------- network, manifest and link map ----------

test("network is valid, and myzenn_calm is a link slot the runtime accepts", () => {
  assert.deepEqual(validateNetwork(network).errors, []);
  assert.equal(network.findFrontMan(), "study_planner");
  assert.deepEqual(network.getAgentSpec("study_planner").tools, ["myzenn_calm"]);
  assert.equal(network.classifyTool("myzenn_calm").kind, "link");
});

test("private context: the only field allowed to cross is country", () => {
  assert.deepEqual(network.getAgentSpec("study_planner").allow, { to_downstream: { sly_data: ["country"] } });
});

test("links.json binds myzenn_calm to MyZenn's network, and the manifest agrees", () => {
  const target = links.networks[NETWORK].myzenn_calm;
  const url = new URL(target);
  // Spec 3.2: the last path segment is the network name; the rest is the site base.
  assert.equal(url.pathname, "/agents/myzenn_calm");
  assert.ok(manifest.allowed_peers.includes(url.origin), "allowed_peers must name MyZenn's origin");
  assert.deepEqual(manifest.linking.imports.map(entry => [entry.reference, entry.url]), [["myzenn_calm", target]]);
  assert.equal(manifest.peer_policy.mode, "closed");
});

test("manifest lists every registered action, all local-only writes or reads", async () => {
  assert.deepEqual(manifest.networks[0].sample_queries, config.metadata.sample_queries);
  const registry = await makeRegistry();
  const entries = registry.catalog(SCOPE);
  assert.deepEqual(entries.map(entry => entry.name).sort(), [...manifest.actions.agentTools].sort());
  for (const entry of entries) {
    assert.equal(entry.availability, "local-only", entry.name);
    assert.notEqual(entry.effect, "irreversible", entry.name);
  }
});

test("instructions keep personal details out of the request to MyZenn", () => {
  const strings = config.commondefs.replacement_strings;
  const text = network.getAgentSpec("study_planner").instructions.replace(/\{(\w+)\}/g, (all, key) => strings[key] ?? all);
  assert.doesNotMatch(text, /\{\w+\}/);
  assert.match(text, /call myzenn_calm/);
  assert.match(text, /Never put their name, email, school or scores in that request/);
  assert.match(text, /Never write breathing steps or helplines yourself/);
});

// ---------- reading ----------

test("the front agent reads the plan through runAgent, and is offered myzenn_calm", async () => {
  freshPage();
  const registry = await makeRegistry();
  const model = new ScriptedModel([
    { tool: "website_get_week_plan", arguments: {} },
    { text: "Three blocks are left today." },
  ]);
  const ctx = {
    network, manifest, actions: registry, baseOrigin: BASE, displayOrigin: "127.0.0.1:8742",
    trace: new TraceBus(), isTop: true, frontMan: "study_planner", history: [], llm: model,
  };
  const result = await runAgent(ctx, "study_planner", "What is left today?", null, []);
  assert.match(result.text, /Three blocks/);
  const offered = model.toolNames(0);
  assert.ok(offered.includes("myzenn_calm"));
  for (const name of manifest.actions.agentTools) assert.ok(offered.includes(`website_${name}`), name);
  const [receipt] = model.toolResults(1);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.now.day, "Wednesday");
  assert.equal(receipt.result.nextBlock.title, "Chemistry: organic reactions");
  // The plan never carries the student's private profile to the model.
  const shown = JSON.stringify(receipt.result);
  for (const secret of [STUDENT.name, STUDENT.email, STUDENT.school]) assert.ok(!shown.includes(secret), secret);
});

test("building the tool table does not contact MyZenn", async () => {
  const registry = await makeRegistry();
  let contacted = false;
  const ctx = {
    network, manifest, actions: registry, baseOrigin: BASE, trace: new TraceBus(),
    resolveLink: async () => { contacted = true; return null; },
    resolveRemote: async () => { contacted = true; return null; },
  };
  const table = await buildToolTable(ctx, network.getAgentSpec("study_planner"), [], null);
  assert.equal(table.toolByName.get("myzenn_calm").kind, "link");
  assert.equal(contacted, false, "consent must come before any contact");
});

// ---------- writes, each shown to the student first ----------

test("add_block adds a break only after the student accepts", async () => {
  const page = freshPage(true);
  const registry = await makeRegistry();
  const receipt = await run(registry, "add_block", { day: "Wed", start: "15:45", minutes: 15, kind: "break" });
  assert.equal(receipt.result.ok, true);
  assert.equal(receipt.result.added.title, "Break");
  assert.equal(receipt.result.added.end, "16:00");
  assert.equal(page.view.proposals[0].summary, "add Break, Wednesday 15:45 to 16:00.");
  assert.ok(page.blocks.some(block => block.day === "Wed" && block.start === "15:45"));
});

test("a declined suggestion changes nothing", async () => {
  const page = freshPage(false);
  const registry = await makeRegistry();
  const before = JSON.stringify(page.blocks);
  const receipt = await run(registry, "add_block", { day: "Thu", start: "13:00", minutes: 30, kind: "study", subject: "physics" });
  assert.deepEqual({ ok: receipt.result.ok, declined: receipt.result.declined }, { ok: false, declined: true });
  assert.equal(JSON.stringify(page.blocks), before);
});

test("the planner's rules refuse bad slots before showing any card", async () => {
  const page = freshPage(true);
  const registry = await makeRegistry();
  const cases = [
    [{ day: "Tue", start: "18:00", kind: "break" }, /has passed/],
    [{ day: "Wed", start: "15:00", kind: "break" }, /has passed/],
    [{ day: "Wed", start: "16:30", kind: "break" }, /overlaps Chemistry: organic reactions \(16:00 to 17:30\)/],
    [{ day: "Wed", start: "21:30", minutes: 60, kind: "study", subject: "maths" }, /runs from 07:00 to 22:00/],
    [{ day: "Fri", start: "9:00", kind: "break" }, /HH:MM/],
    [{ day: "Fri", start: "13:00", kind: "study" }, /needs a subject/],
    [{ day: "Fri", start: "13:00", kind: "break", title: "x".repeat(61) }, /under 60 characters/],
  ];
  for (const [args, reason] of cases) {
    const receipt = await run(registry, "add_block", args);
    assert.equal(receipt.result.ok, false, JSON.stringify(args));
    assert.match(receipt.result.reason, reason);
  }
  assert.equal(page.view.proposals.length, 0);
});

test("a slot exactly at the edges is accepted", () => {
  const page = freshPage();
  assert.equal(page.checkSlot("Wed", "15:30", 15).ok, true, "now is allowed");
  assert.equal(page.checkSlot("Wed", "17:30", 30).ok, true, "right after a block");
  assert.equal(page.checkSlot("Sat", "07:00", 120).ok, true, "start of the day");
  assert.equal(page.checkSlot("Fri", "21:00", 60).ok, true, "ends at 22:00");
  assert.equal(page.checkSlot("Fri", "21:15", 60).ok, false, "ends after 22:00");
});

test("move_block moves a future block, and refuses exams, past blocks and clashes", async () => {
  const page = freshPage(true);
  const registry = await makeRegistry();
  const moved = await run(registry, "move_block", { id: "b07", day: "Fri", start: "13:00" });
  assert.equal(moved.result.ok, true);
  assert.deepEqual([moved.result.moved.to.day, moved.result.moved.to.start, moved.result.moved.to.end], ["Fri", "13:00", "14:00"]);
  assert.match((await run(registry, "move_block", { id: "b08", day: "Fri", start: "09:00" })).result.reason, /fixed/);
  assert.match((await run(registry, "move_block", { id: "b01", day: "Fri", start: "09:00" })).result.reason, /over/);
  assert.match((await run(registry, "move_block", { id: "b06", day: "Thu", start: "10:00" })).result.reason, /overlaps Chemistry exam/);
  assert.match((await run(registry, "move_block", { id: "b99", day: "Fri", start: "09:00" })).result.reason, /no block/);
});

test("mark_block_done ticks a block off once", async () => {
  const page = freshPage(true);
  const registry = await makeRegistry();
  const done = await run(registry, "mark_block_done", { id: "b05" });
  assert.equal(done.result.ok, true);
  assert.equal(page.blocks.find(block => block.id === "b05").done, true);
  assert.match((await run(registry, "mark_block_done", { id: "b05" })).result.reason, /already/);
  assert.match((await run(registry, "mark_block_done", { id: "b08" })).result.reason, /exam/);
});

test("arguments outside the schema never reach the page", async () => {
  const page = freshPage(true);
  const registry = await makeRegistry();
  for (const [name, args] of [
    ["add_block", { day: "Someday", start: "10:00" }],
    ["add_block", { day: "Fri", start: "10:00", minutes: 20 }],
    ["add_block", { day: "Fri", start: "10:00", subject: "history", kind: "study" }],
    ["move_block", { id: "b05", day: "Fri" }],
    ["mark_block_done", { id: "b05", extra: 1 }],
  ]) {
    assert.throws(() => registry.prepare({ kind: "action", action: ref(registry, name), arguments: args }), undefined, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(page.view.proposals.length, 0);
});

test("a new suggestion closes the old one as declined", async () => {
  const page = freshPage(null);
  const first = page.propose("add", { day: "Fri" }, "first");
  const second = page.propose("done", { id: "b05" }, "second");
  assert.equal((await first).accepted, false);
  page.answerProposal(page.pending.id, true);
  assert.equal((await second).accepted, true);
});

test("time helpers round-trip", () => {
  assert.equal(toMinutes("07:05"), 425);
  assert.equal(toTime(425), "07:05");
  for (const bad of ["7:05", "24:00", "12:60", "", null]) assert.equal(toMinutes(bad), null, String(bad));
});

// ---------- private context ----------

test("country joins the private context only when the student allows it", () => {
  StudentContext.shareCountry = false;
  assert.equal(Object.hasOwn(StudentContext.forTurn(), "country"), false);
  StudentContext.shareCountry = true;
  assert.equal(StudentContext.forTurn().country, "IN");
  StudentContext.shareCountry = false;
});

// ---------- consistency with MyZenn ----------

test("the planner's copy of MyZenn's safety net is unchanged", async () => {
  assert.equal(await read("../vendor/myzenn-safety-net.js"), await read("../../myzenn/safety-net.js"));
});

test("numbers in the planner's support banner come from MyZenn's list", async () => {
  const html = await read("../index.html");
  const support = await read("../../myzenn/data/support.js");
  for (const number of html.match(/href="tel:([^"]+)"/g).map(match => match.slice(10, -1))) {
    assert.ok(support.includes(`"${number}"`), `${number} is not in MyZenn's support.js`);
  }
  for (const emergency of ["112", "911"]) assert.ok(html.includes(emergency) && support.includes(`"${emergency}"`));
});

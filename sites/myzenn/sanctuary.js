// The sanctuary page object: one shared stage that the visitor and MyPal both use.
//
// The page's own buttons and the agent's website_* actions call the same methods, so
// both follow one set of rules. Methods refuse bad input by returning
// {ok: false, reason, field} before changing anything. Rendering lives in a view
// (stage-view.js in the browser, a silent view in tests), so the rules here have no DOM.

import { TOOLS, CATEGORIES, toolUrl } from "./data/catalog.js";
import { CORE_EMOTIONS, isEmotionPath } from "./data/emotions.js";
import { supportResources } from "./data/support.js";

export const ON_PAGE_TOOLS = {
  breathing: { label: "MyBreath", what: "Box breathing" },
  grounding: { label: "MySenses", what: "5-4-3-2-1 grounding" },
  wheel: { label: "MyWheel", what: "Emotion wheel" },
  anchor: { label: "MyAnchor", what: "Focus anchor" },
};

export const BREATHING_LIMITS = { seconds: [3, 6], rounds: [2, 8] };
export const ANCHOR_MINUTES = [5, 10, 15, 20, 25, 30, 40, 50];
export const SENSE_STEPS = [
  { count: 5, sense: "see", title: "Five things you can see", hint: "Look around slowly. Name each one, out loud or in your head." },
  { count: 4, sense: "touch", title: "Four things you can touch", hint: "Notice texture, weight and temperature: your chair, your sleeve, the floor." },
  { count: 3, sense: "hear", title: "Three things you can hear", hint: "Some will be near, some far away. Traffic, a fan, your own breath." },
  { count: 2, sense: "smell", title: "Two things you can smell", hint: "If nothing comes, that is fine. Notice the air itself." },
  { count: 1, sense: "taste", title: "One thing you can taste", hint: "Or take a sip of water and notice it." },
];
const PHASES = ["in", "hold", "out", "rest"];
const PROPOSAL_TIMEOUT_MS = 120000;

/** A view that renders nothing: used in Node tests and before the page mounts. */
export class SilentView {
  constructor({ autoAnswer = null } = {}) {
    this.autoAnswer = autoAnswer; // true or false answers proposals automatically
    this.proposals = [];
  }
  render() {}
  showProposal(proposal, page) {
    this.proposals.push(proposal);
    if (this.autoAnswer !== null) queueMicrotask(() => page.answerProposal(proposal.id, this.autoAnswer));
  }
  hideProposal() {}
  showSupport() {}
  hideSupport() {}
}

export class SanctuaryPage {
  /**
   * :param view: Renders state changes. Defaults to a SilentView.
   * :param clock: Returns the current time in ms; tests pass a fake clock.
   */
  constructor({ view = new SilentView(), clock = () => Date.now() } = {}) {
    this.view = view;
    this.clock = clock;
    this.version = 0;
    this.active = null; // {tool, params, startedAt, step?, path?, finishedAt?}
    this.lastEmotion = null; // {path, at}
    this.supportOpen = false;
    this.finished = []; // tools ended this visit, newest last
    this.pending = null; // {id, tool, params, summary, resolve, timer}
    this.nextProposalId = 1;
    this.palSender = null; // set by site.js once the chat can send messages
  }

  // ---------- reading ----------

  /** State for the agent and the page, as plain JSON copies. */
  getState() {
    return {
      version: this.version,
      active: this.active ? this.describeActive() : null,
      pendingSuggestion: this.pending
        ? { tool: this.pending.tool, params: { ...this.pending.params }, summary: this.pending.summary }
        : null,
      lastEmotion: this.lastEmotion
        ? { path: [...this.lastEmotion.path], minutesAgo: Math.floor((this.clock() - this.lastEmotion.at) / 60000) }
        : null,
      supportOpen: this.supportOpen,
      endedThisVisit: this.finished.slice(-5).map(f => ({ ...f })),
      toolsOnThisPage: Object.entries(ON_PAGE_TOOLS).map(([tool, info]) => ({ tool, label: info.label, what: info.what })),
    };
  }

  describeActive() {
    const { tool, params } = this.active;
    const base = { tool, label: ON_PAGE_TOOLS[tool].label, startedBy: this.active.source === "pal" ? "MyPal" : "visitor", params: { ...params } };
    const elapsed = this.clock() - this.active.startedAt;
    if (tool === "breathing") return { ...base, progress: SanctuaryPage.breathingProgress(params, elapsed) };
    if (tool === "anchor") return { ...base, progress: SanctuaryPage.anchorProgress(params, elapsed) };
    if (tool === "grounding") {
      const step = SENSE_STEPS[this.active.step];
      return { ...base, progress: { step: this.active.step + 1, of: SENSE_STEPS.length, now: step.title } };
    }
    return { ...base, progress: { path: [...this.active.path] } };
  }

  /** The 18-tool catalog for the sanctuary guide. */
  getCatalog() {
    return {
      categories: CATEGORIES.map(c => ({ ...c })),
      tools: TOOLS.map(t => ({
        id: t.id, name: t.name, category: t.category, duration: t.duration,
        summary: t.summary, goodFor: t.goodFor, tip: t.tip,
        onThisPage: t.onPage || null, url: toolUrl(t),
      })),
    };
  }

  getSupport() {
    return { ...supportResources(), panelOpen: this.supportOpen };
  }

  static breathingProgress(params, elapsedMs) {
    const sideMs = params.seconds * 1000;
    const cycleMs = sideMs * 4;
    const totalMs = cycleMs * params.rounds;
    if (elapsedMs >= totalMs) return { done: true, round: params.rounds, rounds: params.rounds, phase: "done", secondsLeftInPhase: 0 };
    const t = Math.max(0, elapsedMs);
    const inCycle = t % cycleMs;
    return {
      done: false,
      round: Math.floor(t / cycleMs) + 1,
      rounds: params.rounds,
      phase: PHASES[Math.floor(inCycle / sideMs)],
      secondsLeftInPhase: Math.ceil((sideMs - (inCycle % sideMs)) / 1000),
    };
  }

  static anchorProgress(params, elapsedMs) {
    const totalMs = params.minutes * 60000;
    const leftMs = Math.max(0, totalMs - elapsedMs);
    return { done: leftMs === 0, minutesLeft: Math.ceil(leftMs / 60000), secondsLeft: Math.ceil(leftMs / 1000) };
  }

  // ---------- checks (read-only) ----------

  checkBreathing(args = {}) {
    const seconds = args.seconds ?? 4;
    const rounds = args.rounds ?? 4;
    const [sMin, sMax] = BREATHING_LIMITS.seconds;
    const [rMin, rMax] = BREATHING_LIMITS.rounds;
    if (!Number.isInteger(seconds) || seconds < sMin || seconds > sMax) {
      return { ok: false, field: "seconds", reason: `Each side of the square can be ${sMin} to ${sMax} seconds.` };
    }
    if (!Number.isInteger(rounds) || rounds < rMin || rounds > rMax) {
      return { ok: false, field: "rounds", reason: `Box breathing here runs ${rMin} to ${rMax} rounds.` };
    }
    return { ok: true, params: { seconds, rounds } };
  }

  checkWheel(args = {}) {
    if (args.core == null) return { ok: true, params: { core: null } };
    if (!CORE_EMOTIONS.includes(args.core)) {
      return { ok: false, field: "core", reason: `The wheel starts from one of: ${CORE_EMOTIONS.join(", ")}.` };
    }
    return { ok: true, params: { core: args.core } };
  }

  checkAnchor(args = {}) {
    const intention = String(args.intention ?? "").trim();
    const minutes = args.minutes ?? 25;
    if (!intention) return { ok: false, field: "intention", reason: "MyAnchor needs one intention, such as: read chapter 4." };
    if (intention.length > 80) return { ok: false, field: "intention", reason: "Keep the intention under 80 characters. A smaller step works better anyway." };
    if (!ANCHOR_MINUTES.includes(minutes)) {
      return { ok: false, field: "minutes", reason: `MyAnchor runs for ${ANCHOR_MINUTES.join(", ")} minutes.` };
    }
    return { ok: true, params: { intention, minutes } };
  }

  // ---------- operations ----------

  startBreathing(args, { source = "visitor" } = {}) {
    const check = this.checkBreathing(args);
    if (!check.ok) return check;
    return this.begin("breathing", check.params, { source });
  }

  startGrounding({ source = "visitor" } = {}) {
    return this.begin("grounding", {}, { source, step: 0 });
  }

  /** The visitor pressed Next in MySenses. */
  advanceGrounding() {
    if (this.active?.tool !== "grounding") return { ok: false, reason: "MySenses is not running." };
    if (this.active.step >= SENSE_STEPS.length - 1) return this.end(true);
    this.active.step += 1;
    return this.changed();
  }

  openWheel(args, { source = "visitor" } = {}) {
    const check = this.checkWheel(args);
    if (!check.ok) return check;
    return this.begin("wheel", check.params, { source, path: check.params.core ? [check.params.core] : [] });
  }

  /** The visitor tapped a feeling. A full path (3 names) records it and ends the wheel. */
  chooseEmotion(path) {
    if (this.active?.tool !== "wheel") return { ok: false, reason: "MyWheel is not open." };
    if (!isEmotionPath(path)) return { ok: false, field: "path", reason: "That feeling is not on the wheel." };
    this.active.path = [...path];
    if (path.length < 3) return this.changed();
    this.lastEmotion = { path: [...path], at: this.clock() };
    return this.end(true);
  }

  /** The visitor stepped back one ring in the wheel. */
  wheelBack() {
    if (this.active?.tool !== "wheel") return { ok: false, reason: "MyWheel is not open." };
    this.active.path = this.active.path.slice(0, -1);
    return this.changed();
  }

  startAnchor(args, { source = "visitor" } = {}) {
    const check = this.checkAnchor(args);
    if (!check.ok) return check;
    return this.begin("anchor", check.params, { source });
  }

  /** Stop whatever tool is running. Stopping nothing is fine and changes nothing. */
  stopTool() {
    if (!this.active) return { ok: true, state: this.getState(), note: "No tool was running." };
    return this.end(false);
  }

  /** The view calls this when a timed tool reaches its end. */
  completeIfDone() {
    if (!this.active) return null;
    const p = this.describeActive().progress;
    return p.done ? this.end(true) : null;
  }

  openSupport({ source = "visitor" } = {}) {
    this.supportOpen = true;
    this.view.showSupport({ source });
    return this.changed();
  }

  closeSupport() {
    this.supportOpen = false;
    this.view.hideSupport();
    return this.changed();
  }

  // ---------- agent suggestions ----------

  /**
   * Show the visitor what MyPal wants to start and wait for their answer.
   * Only one suggestion is open at a time: a new one, or a tool the visitor starts
   * themselves, closes the old one as declined.
   *
   * :return: Promise of {accepted, reason?}.
   */
  propose(tool, params, summary) {
    this.dismissProposal("MyPal made a new suggestion before the visitor answered this one.");
    return new Promise(resolve => {
      const id = this.nextProposalId++;
      const timer = setTimeout(() => this.answerProposal(id, false, "The visitor did not answer within two minutes."), PROPOSAL_TIMEOUT_MS);
      this.pending = { id, tool, params: { ...params }, summary, resolve, timer };
      this.version += 1;
      this.view.showProposal({ id, tool, params: { ...params }, summary }, this);
    });
  }

  answerProposal(id, accepted, reason = null) {
    if (!this.pending || this.pending.id !== id) return false;
    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    this.version += 1;
    this.view.hideProposal(id);
    resolve(accepted ? { accepted: true } : { accepted: false, reason: reason || "The visitor chose Not now." });
    return true;
  }

  dismissProposal(reason) {
    if (this.pending) this.answerProposal(this.pending.id, false, reason);
  }

  /** Send a message to MyPal as the visitor, when the chat is connected. */
  sayToPal(text) {
    return typeof this.palSender === "function" ? this.palSender(text) : false;
  }

  // ---------- internals ----------

  begin(tool, params, extra = {}) {
    // An accepted suggestion is already closed when its tool begins, so any open one
    // here means the visitor chose something else themselves.
    this.dismissProposal("The visitor started a tool themselves instead.");
    if (this.active) this.end(false, { quiet: true });
    this.active = { tool, params: { ...params }, startedAt: this.clock(), ...extra };
    return this.changed();
  }

  end(completed, { quiet = false } = {}) {
    const { tool, source, path } = this.active;
    this.finished.push({ tool, label: ON_PAGE_TOOLS[tool].label, completed });
    if (this.finished.length > 20) this.finished.shift();
    const ended = { tool, completed, source, path: path ? [...path] : undefined };
    this.active = null;
    if (quiet) {
      this.version += 1;
      return { ok: true };
    }
    return this.changed({ ended });
  }

  changed(extra = {}) {
    this.version += 1;
    this.view.render(this, extra);
    return { ok: true, ...extra, state: this.getState() };
  }
}

/** The one page object, shared by the page, site.js and site-actions.js. */
export const App = { page: new SanctuaryPage() };

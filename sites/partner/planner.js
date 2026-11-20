// The planner page object: one plan that the student and the planner's assistant both
// change through the same methods. Methods refuse bad input by returning
// {ok: false, reason, field} before changing anything. Rendering lives in a view
// (week-view.js in the browser, a silent view in tests), so these rules have no DOM.

import { DAYS, DAY_NAMES, NOW, DAY_START, DAY_END, BLOCK_MINUTES, SUBJECTS, EXAMS, SEED_BLOCKS } from "./data/week.js";

const PROPOSAL_TIMEOUT_MS = 120000;
const TITLE_MAX = 60;

/** "HH:MM" (24-hour) to minutes after midnight, or null when it is not a valid time. */
export function toMinutes(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight to "HH:MM". */
export function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const DAY_INDEX = Object.fromEntries(DAYS.map((day, index) => [day, index]));
const NOW_MIN = toMinutes(NOW.time);
const START_MIN = toMinutes(DAY_START);
const END_MIN = toMinutes(DAY_END);

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
}

export class PlannerPage {
  constructor({ view = new SilentView(), blocks = SEED_BLOCKS } = {}) {
    this.view = view;
    this.blocks = blocks.map(block => ({ ...block }));
    this.version = 0;
    this.pending = null; // {id, action, params, summary, resolve, timer}
    this.nextProposalId = 1;
    this.nextBlockNumber = this.blocks.length + 1;
  }

  // ---------- reading ----------

  getState() {
    return {
      version: this.version,
      now: { day: DAY_NAMES[NOW.day], time: NOW.time },
      days: DAYS.map(day => ({ day, name: DAY_NAMES[day], today: day === NOW.day, past: DAY_INDEX[day] < DAY_INDEX[NOW.day] })),
      blocks: this.sortedBlocks().map(block => this.describe(block)),
      nextBlock: this.nextBlock(),
      exams: EXAMS.map(exam => ({
        title: exam.title,
        day: exam.nextWeek ? `next ${DAY_NAMES[exam.day]}` : DAY_NAMES[exam.day],
        start: exam.start,
      })),
      pendingSuggestion: this.pending ? { action: this.pending.action, summary: this.pending.summary } : null,
      limits: { dayStart: DAY_START, dayEnd: DAY_END, minutes: [...BLOCK_MINUTES] },
    };
  }

  describe(block) {
    const start = toMinutes(block.start);
    return {
      id: block.id,
      day: block.day,
      dayName: DAY_NAMES[block.day],
      start: block.start,
      end: toTime(start + block.minutes),
      minutes: block.minutes,
      kind: block.kind,
      subject: block.subject ? SUBJECTS[block.subject].name : null,
      title: block.title,
      done: block.done,
      over: this.isPast(block.day, start + block.minutes),
    };
  }

  sortedBlocks() {
    return [...this.blocks].sort((a, b) => DAY_INDEX[a.day] - DAY_INDEX[b.day] || toMinutes(a.start) - toMinutes(b.start));
  }

  nextBlock() {
    const next = this.sortedBlocks().find(block => !block.done && !this.isPast(block.day, toMinutes(block.start)));
    return next ? { id: next.id, title: next.title, day: DAY_NAMES[next.day], start: next.start } : null;
  }

  /** True when a moment on a day is before "now". */
  isPast(day, minutes) {
    return DAY_INDEX[day] < DAY_INDEX[NOW.day] || (day === NOW.day && minutes <= NOW_MIN);
  }

  // ---------- checks (read-only) ----------

  /** Check that a slot is a real, free, future time on the plan. */
  checkSlot(day, start, minutes, ignoreId = null) {
    if (!Object.hasOwn(DAY_INDEX, day)) return { ok: false, field: "day", reason: `Days are ${DAYS.join(", ")}.` };
    const from = toMinutes(start);
    if (from === null) return { ok: false, field: "start", reason: "Give the start time as HH:MM, 24-hour, such as 15:45." };
    if (!BLOCK_MINUTES.includes(minutes)) return { ok: false, field: "minutes", reason: `Blocks last ${BLOCK_MINUTES.join(", ")} minutes.` };
    const to = from + minutes;
    if (from < START_MIN || to > END_MIN) return { ok: false, field: "start", reason: `The planner's day runs from ${DAY_START} to ${DAY_END}.` };
    if (this.isPast(day, from) && !(day === NOW.day && from === NOW_MIN)) {
      return { ok: false, field: "start", reason: `That time has passed. It is ${DAY_NAMES[NOW.day]}, ${NOW.time}.` };
    }
    const clash = this.blocks.find(other => other.id !== ignoreId && other.day === day
      && toMinutes(other.start) < to && from < toMinutes(other.start) + other.minutes);
    if (clash) {
      const described = this.describe(clash);
      return { ok: false, field: "start", reason: `That overlaps ${clash.title} (${described.start} to ${described.end}).` };
    }
    return { ok: true };
  }

  checkAdd(args = {}) {
    const kind = args.kind ?? "study";
    if (kind !== "study" && kind !== "break") return { ok: false, field: "kind", reason: "You can add a study block or a break." };
    const subject = args.subject ?? null;
    if (kind === "study" && !Object.hasOwn(SUBJECTS, subject)) {
      return { ok: false, field: "subject", reason: `A study block needs a subject: ${Object.keys(SUBJECTS).join(", ")}.` };
    }
    if (kind === "break" && subject !== null) return { ok: false, field: "subject", reason: "A break has no subject." };
    const minutes = args.minutes ?? (kind === "break" ? 15 : 60);
    const slot = this.checkSlot(args.day, args.start, minutes);
    if (!slot.ok) return slot;
    const title = String(args.title ?? "").trim() || (kind === "break" ? "Break" : `${SUBJECTS[subject].name}: revision`);
    if (title.length > TITLE_MAX) return { ok: false, field: "title", reason: `Keep the title under ${TITLE_MAX} characters.` };
    return { ok: true, block: { day: args.day, start: toTime(toMinutes(args.start)), minutes, kind, subject: kind === "break" ? null : subject, title } };
  }

  checkMove(args = {}) {
    const block = this.blocks.find(candidate => candidate.id === args.id);
    if (!block) return { ok: false, field: "id", reason: "There is no block with that id. Read the plan again for current ids." };
    if (block.kind === "exam") return { ok: false, field: "id", reason: "Exam times are fixed. They cannot be moved." };
    if (this.isPast(block.day, toMinutes(block.start))) return { ok: false, field: "id", reason: `${block.title} has already started or is over.` };
    const slot = this.checkSlot(args.day, args.start, block.minutes, block.id);
    if (!slot.ok) return slot;
    return { ok: true, block, to: { day: args.day, start: toTime(toMinutes(args.start)) } };
  }

  checkDone(id) {
    const block = this.blocks.find(candidate => candidate.id === id);
    if (!block) return { ok: false, field: "id", reason: "There is no block with that id. Read the plan again for current ids." };
    if (block.kind === "exam") return { ok: false, field: "id", reason: "An exam is not ticked off on the plan." };
    if (block.done) return { ok: false, field: "id", reason: `${block.title} is already ticked off.` };
    return { ok: true, block };
  }

  // ---------- operations ----------

  addBlock(args) {
    const check = this.checkAdd(args);
    if (!check.ok) return check;
    const block = { id: `b${String(this.nextBlockNumber++).padStart(2, "0")}`, ...check.block, done: false };
    this.blocks.push(block);
    return this.changed({ added: this.describe(block) });
  }

  moveBlock(args) {
    const check = this.checkMove(args);
    if (!check.ok) return check;
    const from = this.describe(check.block);
    check.block.day = check.to.day;
    check.block.start = check.to.start;
    return this.changed({ moved: { from, to: this.describe(check.block) } });
  }

  markDone(id) {
    const check = this.checkDone(id);
    if (!check.ok) return check;
    check.block.done = true;
    return this.changed({ done: this.describe(check.block) });
  }

  // ---------- assistant suggestions ----------

  /**
   * Show the student what the assistant wants to change and wait for their answer.
   * Only one suggestion is open at a time; a new one closes the old one as declined.
   *
   * :return: Promise of {accepted, reason?}.
   */
  propose(action, params, summary) {
    this.dismissProposal("The planner made a new suggestion before the student answered this one.");
    return new Promise(resolve => {
      const id = this.nextProposalId++;
      const timer = setTimeout(() => this.answerProposal(id, false, "The student did not answer within two minutes."), PROPOSAL_TIMEOUT_MS);
      this.pending = { id, action, params: { ...params }, summary, resolve, timer };
      this.version += 1;
      this.view.showProposal({ id, action, params: { ...params }, summary }, this);
    });
  }

  answerProposal(id, accepted, reason = null) {
    if (!this.pending || this.pending.id !== id) return false;
    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    this.version += 1;
    this.view.hideProposal(id);
    resolve(accepted ? { accepted: true } : { accepted: false, reason: reason || "The student chose Not now." });
    return true;
  }

  dismissProposal(reason) {
    if (this.pending) this.answerProposal(this.pending.id, false, reason);
  }

  changed(extra = {}) {
    this.version += 1;
    this.view.render(this, extra);
    return { ok: true, ...extra, state: this.getState() };
  }
}

/** The one page object, shared by the page, site.js and site-actions.js. */
export const App = { page: new PlannerPage() };

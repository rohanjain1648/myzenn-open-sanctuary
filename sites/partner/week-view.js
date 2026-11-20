// Draws the planner page object into the page and turns the student's own clicks into
// page-object calls. All rules live in planner.js.

import { DAYS, DAY_NAMES, NOW, DAY_START, DAY_END, BLOCK_MINUTES, SUBJECTS } from "./data/week.js";
import { toMinutes, toTime } from "./planner.js";

const PX_PER_HOUR = 44;
const START_MIN = toMinutes(DAY_START);
const END_MIN = toMinutes(DAY_END);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "style") for (const [p, v] of Object.entries(value)) node.style.setProperty(p, v);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function offset(minutes) {
  return `${((minutes - START_MIN) / 60) * PX_PER_HOUR}px`;
}

export class WeekView {
  constructor(doc) {
    this.doc = doc;
    this.headline = doc.getElementById("countdown");
    this.subline = doc.getElementById("countdown-sub");
    this.grid = doc.getElementById("week");
    this.scroller = doc.getElementById("week-scroll");
    this.card = doc.getElementById("planner-suggestion");
    this.detail = doc.getElementById("block-detail");
    this.form = doc.getElementById("add-form");
    this.page = null;
    this.proposal = null;
    this.selected = null;
  }

  /** Wire the student's own controls once. */
  mount(page) {
    this.page = page;
    this.buildForm();
    this.render(page);
    // Start the week scrolled to today on narrow screens.
    const today = this.grid.querySelector(".day.is-today");
    if (today && this.scroller.scrollWidth > this.scroller.clientWidth) {
      this.scroller.scrollLeft = today.offsetLeft - 56;
    }
  }

  render(page, extra = {}) {
    this.page = page;
    const state = page.getState();
    this.renderCountdown(state);
    this.renderWeek(state, extra);
    this.renderDetail(state);
  }

  // ---------- countdown hero ----------

  renderCountdown(state) {
    const exam = state.blocks.find(block => block.kind === "exam" && !block.over);
    if (exam) {
      const gap = DAYS.indexOf(exam.day) - DAYS.indexOf(NOW.day);
      const when = gap === 0 ? "today" : gap === 1 ? "tomorrow" : `on ${exam.dayName}`;
      this.headline.textContent = `${exam.subject} exam ${when}, ${exam.start}.`;
    }
    const left = state.blocks.filter(block => block.day === NOW.day && !block.over && !block.done && block.kind === "study");
    const count = ["No", "One", "Two", "Three", "Four", "Five"][left.length] || String(left.length);
    this.subline.textContent = `${state.now.day}, ${state.now.time} in this demo week. ${count} study block${left.length === 1 ? "" : "s"} left today.`;
  }

  // ---------- the week grid ----------

  renderWeek(state, extra) {
    const hours = [];
    for (let minutes = START_MIN; minutes < END_MIN; minutes += 60) {
      hours.push(el("span", { class: "hour", style: { "--top": offset(minutes) } }, toTime(minutes)));
    }
    const ghost = this.ghost();
    const changed = extra.added?.id || extra.moved?.to?.id || null;
    const columns = state.days.map(day => {
      const blocks = state.blocks.filter(block => block.day === day.day).map(block => this.blockButton(block, block.id === changed));
      if (ghost && ghost.day === day.day) blocks.push(ghost.node);
      const now = day.today
        ? el("span", { class: "now-line", style: { "--top": offset(toMinutes(NOW.time)) }, "aria-hidden": "true" })
        : null;
      return el("div", { class: `day${day.today ? " is-today" : ""}${day.past ? " is-past" : ""}`, role: "group", "aria-label": day.name },
        el("div", { class: "day-head" },
          el("span", { class: "day-short", "aria-hidden": "true" }, day.day),
          el("span", { class: "day-tag" }, day.today ? "Today" : "")),
        el("div", { class: "day-body", style: { "--hours": String((END_MIN - START_MIN) / 60) } }, now, blocks));
    });
    this.grid.replaceChildren(
      el("div", { class: "hours", "aria-hidden": "true" }, el("div", { class: "day-head" }), el("div", { class: "hours-body" }, hours)),
      ...columns,
    );
  }

  blockButton(block, isNew) {
    const classes = ["block", `kind-${block.kind}`];
    if (block.subject) classes.push(`subject-${block.subject.toLowerCase()}`);
    if (block.done) classes.push("is-done");
    if (block.over) classes.push("is-over");
    if (isNew) classes.push("is-new");
    if (this.selected === block.id) classes.push("is-selected");
    const short = block.minutes < 45;
    const height = (block.minutes / 60) * PX_PER_HOUR;
    // Title lines that fit under the time: 8px padding, 15px per line.
    const lines = Math.max(1, Math.floor((height - 8 - 15) / 15));
    const label = `${block.title}, ${block.dayName} ${block.start} to ${block.end}${block.done ? ", done" : ""}${block.kind === "exam" ? ", exam" : ""}`;
    return el("button", {
      type: "button",
      class: classes.join(" ") + (short ? " is-short" : ""),
      style: { "--top": offset(toMinutes(block.start)), "--h": `${height}px`, "--lines": String(lines) },
      "aria-label": label,
      "aria-pressed": String(this.selected === block.id),
      onclick: () => this.select(block.id),
    },
      el("span", { class: "block-time" }, block.start),
      el("span", { class: "block-title" }, block.title));
  }

  /** The proposed block, drawn dashed on the grid before the student answers. */
  ghost() {
    const p = this.proposal;
    if (!p || (p.action !== "add" && p.action !== "move")) return null;
    let day = p.params.day;
    let start = p.params.start;
    let minutes = p.params.minutes;
    let title = p.params.title;
    if (p.action === "move") {
      const block = this.page.blocks.find(candidate => candidate.id === p.params.id);
      if (!block) return null;
      minutes = block.minutes;
      title = block.title;
    }
    return {
      day,
      node: el("div", {
        class: "block is-ghost",
        style: { "--top": offset(toMinutes(start)), "--h": `${(minutes / 60) * PX_PER_HOUR}px` },
        "aria-hidden": "true",
      }, el("span", { class: "block-time" }, start), el("span", { class: "block-title" }, title)),
    };
  }

  // ---------- selected block ----------

  select(id) {
    this.selected = this.selected === id ? null : id;
    this.render(this.page);
  }

  renderDetail(state) {
    const block = state.blocks.find(candidate => candidate.id === this.selected);
    if (!block) {
      this.detail.hidden = true;
      this.detail.replaceChildren();
      return;
    }
    const canTick = block.kind !== "exam" && !block.done;
    this.detail.hidden = false;
    this.detail.replaceChildren(
      el("p", {}, el("strong", {}, block.title), ` ${block.dayName}, ${block.start} to ${block.end}.`,
        block.done ? " Done." : "", block.kind === "exam" ? " Exam times are fixed." : ""),
      el("div", { class: "row" },
        canTick ? el("button", { class: "btn", type: "button", onclick: () => this.tick(block.id) }, "Tick it off") : null,
        el("button", { class: "btn quiet", type: "button", onclick: () => this.select(block.id) }, "Close")),
    );
  }

  tick(id) {
    const result = this.page.markDone(id);
    if (!result.ok) this.detail.querySelector("p").textContent = result.reason;
  }

  // ---------- add form (the student's own control) ----------

  buildForm() {
    const days = this.form.querySelector("#add-day");
    for (const day of DAYS) days.append(el("option", { value: day, selected: day === NOW.day }, DAY_NAMES[day]));
    const minutes = this.form.querySelector("#add-minutes");
    for (const value of BLOCK_MINUTES) minutes.append(el("option", { value: String(value), selected: value === 30 }, `${value} minutes`));
    const what = this.form.querySelector("#add-what");
    what.append(el("option", { value: "break" }, "A break"));
    for (const [id, subject] of Object.entries(SUBJECTS)) what.append(el("option", { value: id }, `${subject.name} study`));
    const error = this.form.querySelector("#add-error");
    this.form.addEventListener("submit", event => {
      event.preventDefault();
      const kind = what.value === "break" ? "break" : "study";
      const result = this.page.addBlock({
        day: days.value,
        start: this.form.querySelector("#add-start").value,
        minutes: Number(minutes.value),
        kind,
        subject: kind === "study" ? what.value : null,
        title: this.form.querySelector("#add-title").value,
      });
      error.textContent = result.ok ? "" : result.reason;
      if (result.ok) this.form.querySelector("#add-title").value = "";
    });
  }

  // ---------- the assistant's suggestion card ----------

  showProposal(proposal, page) {
    this.page = page;
    this.proposal = proposal;
    const verb = { add: "Add it", move: "Move it", done: "Tick it off" }[proposal.action];
    this.card.replaceChildren(
      el("p", {}, el("strong", {}, "The planner wants to "), proposal.summary),
      el("div", { class: "row" },
        el("button", { class: "btn", type: "button", onclick: () => page.answerProposal(proposal.id, true) }, verb),
        el("button", { class: "btn quiet", type: "button", onclick: () => page.answerProposal(proposal.id, false) }, "Not now")),
    );
    this.card.dataset.id = String(proposal.id);
    this.card.hidden = false;
    this.render(page);
  }

  hideProposal(id) {
    if (this.card.dataset.id !== String(id)) return;
    this.proposal = null;
    this.card.hidden = true;
    this.card.replaceChildren();
    delete this.card.dataset.id;
    this.render(this.page);
  }
}

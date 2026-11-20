// Renders the sanctuary page object into the page. All rules live in sanctuary.js;
// this file only draws state and turns clicks into page-object calls.

import { EMOTIONS } from "./data/emotions.js";
import { HELPLINES, EMERGENCY, ELSEWHERE } from "./data/support.js";
import { ON_PAGE_TOOLS, SENSE_STEPS, ANCHOR_MINUTES } from "./sanctuary.js";

const PHASE_WORDS = { in: "Breathe in", hold: "Hold", out: "Breathe out", rest: "Rest", done: "Done" };

/** Create an element: el("p", {class: "x"}, "text", child). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
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

export class StageView {
  constructor(doc) {
    this.doc = doc;
    this.stage = doc.getElementById("stage");
    this.suggestion = doc.getElementById("stage-suggestion");
    this.support = doc.getElementById("support");
    this.picker = doc.getElementById("tool-picker");
    this.ticker = null;
    this.mountedTool = null; // the tool whose DOM is on the stage
    this.page = null;
  }

  /** Draw the stage for the current state. */
  render(page, extra = {}) {
    this.page = page;
    this.markPicker(page.active?.tool || null);
    const hadFocus = this.stage.contains(this.doc.activeElement);
    if (!page.active) {
      this.stopTicker();
      this.mountedTool = null;
      this.stage.replaceChildren(extra.ended ? this.endedView(extra.ended) : this.idleView());
      this.stage.dataset.tool = extra.ended ? "ended" : "idle";
      if (hadFocus) this.focusStage();
      if (extra.ended?.tool === "wheel" && extra.ended.completed && extra.ended.source === "pal") {
        page.sayToPal(`I picked a feeling on MyWheel: ${extra.ended.path.join(", then ")}.`);
      }
      return;
    }
    const { tool, startedAt } = page.active;
    const key = `${tool}@${startedAt}`;
    // Timed tools mount once per run, so their CSS animation keeps its timing.
    // Stepped tools redraw on every change.
    const timed = tool === "breathing" || tool === "anchor";
    if (this.mountedTool !== key || !timed) {
      this.stage.replaceChildren(this.toolView(tool, page));
      this.stage.dataset.tool = tool;
      this.mountedTool = key;
      if (hadFocus) this.focusStage();
    }
    if (timed) this.startTicker();
    else this.stopTicker();
    this.tick();
  }

  /** After a redraw that removed the focused control, focus the new heading or button. */
  focusStage() {
    const target = this.stage.querySelector("[tabindex='-1'], button, input");
    target?.focus();
  }

  // ---------- idle and ended ----------

  idleView() {
    return el("div", { class: "idle" },
      el("p", { class: "breath-word idle-word", "aria-hidden": "true" }, "breathe"),
      el("h1", { class: "idle-title" }, "Take a breath. Then tell MyPal what is going on."),
      el("p", { class: "idle-lede" },
        "MyPal can help you name a feeling and start a calming exercise right here on this page. ",
        "It runs in your browser, on the AI provider you choose."),
    );
  }

  endedView(ended) {
    const label = ON_PAGE_TOOLS[ended.tool].label;
    if (ended.tool === "wheel" && ended.completed) {
      const feeling = ended.path[ended.path.length - 1];
      return el("div", { class: "ended" },
        el("p", { class: "breath-word ended-word" }, feeling.toLowerCase()),
        el("h2", {}, `You named it: ${feeling.toLowerCase()}.`),
        el("p", {}, "Putting a precise name to a feeling is a real step. What would help next?"),
        el("div", { class: "row" },
          el("button", { class: "btn", onclick: () => this.page.startBreathing({}) }, "Breathe for a minute"),
          el("button", { class: "btn quiet", onclick: () => this.page.startGrounding() }, "Ground with your senses"),
          ended.source !== "pal" && this.page.palSender
            ? el("button", { class: "btn quiet", onclick: () => this.page.sayToPal(`I picked a feeling on MyWheel: ${ended.path.join(", then ")}.`) }, "Tell MyPal")
            : null),
      );
    }
    const heading = ended.completed ? `${label} finished.` : `${label} stopped.`;
    const checkIn = answer => () => {
      if (this.page.sayToPal(`I ${ended.completed ? "finished" : "stopped"} ${label}. I feel ${answer}.`)) return;
      this.stage.replaceChildren(this.checkInReply(answer));
    };
    return el("div", { class: "ended" },
      el("h2", {}, heading),
      el("p", {}, "How do you feel now?"),
      el("div", { class: "row", role: "group", "aria-label": "How do you feel now?" },
        el("button", { class: "btn quiet", onclick: checkIn("calmer") }, "Calmer"),
        el("button", { class: "btn quiet", onclick: checkIn("about the same") }, "About the same"),
        el("button", { class: "btn quiet", onclick: checkIn("worse") }, "Worse"),
      ),
    );
  }

  /** Reply to a check-in when MyPal is not connected. */
  checkInReply(answer) {
    if (answer === "worse") {
      return el("div", { class: "ended" },
        el("h2", {}, "Thank you for saying so."),
        el("p", {}, "Some moments are bigger than a breathing exercise. Talking to a person can help."),
        el("div", { class: "row" },
          el("button", { class: "btn support-btn", onclick: () => this.page.openSupport() }, "See who you can talk to"),
          el("button", { class: "btn quiet", onclick: () => this.page.openWheel({}) }, "Name the feeling"),
        ),
      );
    }
    return el("div", { class: "ended" },
      el("h2", {}, answer === "calmer" ? "Good. Keep that with you." : "That is okay. Not every try shifts things."),
      el("p", {}, "You can run it again, or try another tool below."),
    );
  }

  // ---------- tools ----------

  toolView(tool, page) {
    if (tool === "breathing") return this.breathingView(page);
    if (tool === "grounding") return this.groundingView(page);
    if (tool === "wheel") return this.wheelView(page);
    return this.anchorView(page);
  }

  stopButton() {
    return el("button", { class: "btn quiet", onclick: () => this.page.stopTool() }, "Stop");
  }

  breathingView(page) {
    const { seconds, rounds } = page.active.params;
    this.word = el("p", { class: "breath-word", "aria-hidden": "true" }, "Breathe in");
    this.count = el("p", { class: "count", "aria-hidden": "true" }, String(seconds));
    this.progress = el("p", { class: "progress", role: "status" }, `Round 1 of ${rounds}`);
    return el("div", { class: "tool breathing", style: { "--side": `${seconds}s` } },
      el("div", { class: "box", "aria-hidden": "true" }, el("span", { class: "dot" })),
      this.word, this.count,
      el("h2", { class: "visually-hidden" }, `MyBreath: box breathing, ${rounds} rounds of ${seconds} seconds`),
      this.progress,
      el("div", { class: "row" }, this.stopButton()),
    );
  }

  groundingView(page) {
    const index = page.active.step;
    const step = SENSE_STEPS[index];
    const next = SENSE_STEPS[index + 1];
    return el("div", { class: "tool grounding" },
      el("ol", { class: "senses", "aria-label": "Steps" },
        SENSE_STEPS.map((s, i) => el("li", { class: i === index ? "now" : i < index ? "past" : "", "aria-current": i === index ? "step" : null },
          el("span", { class: "n" }, String(s.count)), el("span", { class: "s" }, s.sense)))),
      el("h2", { class: "breath-word grounding-word", tabindex: "-1" }, step.title),
      el("p", { class: "hint" }, step.hint),
      el("div", { class: "row" },
        el("button", { class: "btn", onclick: () => this.page.advanceGrounding() },
          next ? `Next: ${next.title.toLowerCase()}` : "Finish"),
        this.stopButton()),
    );
  }

  wheelView(page) {
    const path = page.active.path;
    let options;
    if (path.length === 0) options = EMOTIONS.map(e => ({ name: e.name, color: e.color }));
    else {
      const core = EMOTIONS.find(e => e.name === path[0]);
      if (path.length === 1) options = core.children.map(m => ({ name: m.name, color: core.color }));
      else options = core.children.find(m => m.name === path[1]).children.map(n => ({ name: n, color: core.color }));
    }
    const prompt = path.length === 0 ? "What are you feeling, broadly?" : path.length === 1
      ? `${path[0]}. Can you get more precise?` : `${path[1]}. Which word fits best?`;
    return el("div", { class: "tool wheel" },
      el("h2", { class: "wheel-prompt", tabindex: "-1" }, prompt),
      path.length ? el("p", { class: "trail" }, path.join(", then ")) : null,
      el("div", { class: "chips", role: "group", "aria-label": "Feelings" },
        options.map(o => el("button", {
          class: "chip", style: { "--chip": o.color },
          onclick: () => this.page.chooseEmotion([...path, o.name]),
        }, o.name))),
      el("div", { class: "row" },
        path.length ? el("button", { class: "btn quiet", onclick: () => this.page.wheelBack() }, "Back") : null,
        this.stopButton()),
    );
  }

  anchorView(page) {
    const { intention, minutes } = page.active.params;
    this.count = el("p", { class: "count anchor-count", role: "timer", "aria-live": "off" }, `${minutes}:00`);
    this.progress = el("p", { class: "progress" }, `${minutes} minutes on one thing. Everything else can wait.`);
    this.word = null;
    return el("div", { class: "tool anchor" },
      el("p", { class: "anchor-label" }, "Your one thing"),
      el("h2", { class: "breath-word anchor-word" }, intention),
      this.count, this.progress,
      el("div", { class: "row" }, this.stopButton()),
    );
  }

  /** The visitor chose MyAnchor from the picker: ask for the intention first. */
  anchorSetupView() {
    const input = el("input", { id: "anchor-intention", name: "intention", maxlength: "80", required: true, autocomplete: "off", placeholder: "Read chapter 4" });
    const select = el("select", { id: "anchor-minutes", name: "minutes" },
      ANCHOR_MINUTES.map(m => el("option", { value: String(m), selected: m === 25 }, `${m} minutes`)));
    const error = el("p", { class: "field-error", role: "alert" });
    const form = el("form", {
      class: "anchor-setup",
      onsubmit: event => {
        event.preventDefault();
        const result = this.page.startAnchor({ intention: input.value, minutes: Number(select.value) });
        if (!result.ok) { error.textContent = result.reason; input.focus(); }
      },
    },
      el("h2", {}, "What is the one thing?"),
      el("label", { for: "anchor-intention" }, "Intention"), input,
      el("label", { for: "anchor-minutes" }, "For how long"), select,
      error,
      el("div", { class: "row" }, el("button", { class: "btn", type: "submit" }, "Start focusing")),
    );
    this.stopTicker();
    this.mountedTool = null;
    this.stage.replaceChildren(form);
    this.stage.dataset.tool = "anchor-setup";
    input.focus();
  }

  // ---------- timing ----------

  startTicker() {
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), 250);
  }

  stopTicker() {
    clearInterval(this.ticker);
    this.ticker = null;
  }

  tick() {
    const page = this.page;
    if (!page?.active) return;
    const done = page.completeIfDone();
    if (done) return;
    const { tool, progress } = page.describeActive();
    if (tool === "breathing") {
      const word = PHASE_WORDS[progress.phase];
      if (this.word.textContent !== word) {
        this.word.textContent = word;
        this.word.dataset.phase = progress.phase;
      }
      this.count.textContent = String(progress.secondsLeftInPhase);
      const text = `Round ${progress.round} of ${progress.rounds}. ${word}.`;
      if (this.progress.dataset.round !== String(progress.round)) {
        this.progress.dataset.round = String(progress.round);
        this.progress.textContent = `Round ${progress.round} of ${progress.rounds}`;
        this.progress.setAttribute("aria-label", text);
      }
    } else if (tool === "anchor") {
      const s = progress.secondsLeft;
      this.count.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }

  // ---------- picker ----------

  markPicker(tool) {
    if (!this.picker) return;
    for (const button of this.picker.querySelectorAll("button[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    }
  }

  // ---------- MyPal suggestion card ----------

  showProposal(proposal, page) {
    this.page = page;
    const label = ON_PAGE_TOOLS[proposal.tool].label;
    const start = el("button", { class: "btn", onclick: () => page.answerProposal(proposal.id, true) }, `Start ${label}`);
    const decline = el("button", { class: "btn quiet", onclick: () => page.answerProposal(proposal.id, false) }, "Not now");
    this.suggestion.replaceChildren(
      el("p", {}, el("strong", {}, "MyPal suggests "), proposal.summary),
      el("div", { class: "row" }, start, decline),
    );
    this.suggestion.dataset.id = String(proposal.id);
    this.suggestion.hidden = false;
  }

  hideProposal(id) {
    if (this.suggestion.dataset.id === String(id)) {
      this.suggestion.hidden = true;
      this.suggestion.replaceChildren();
      delete this.suggestion.dataset.id;
    }
  }

  // ---------- MySafe panel ----------

  showSupport({ source } = {}) {
    if (!this.support.dataset.built) this.buildSupport();
    this.support.hidden = false;
    this.support.dataset.source = source || "visitor";
    this.doc.body.classList.add("support-open");
    this.support.querySelector("#support-title").focus();
  }

  hideSupport() {
    this.support.hidden = true;
    this.doc.body.classList.remove("support-open");
    this.doc.getElementById("open-support")?.focus();
  }

  buildSupport() {
    const byCountry = new Map();
    for (const line of HELPLINES) {
      if (!byCountry.has(line.country)) byCountry.set(line.country, []);
      byCountry.get(line.country).push(line);
    }
    const emergency = EMERGENCY.map(e => `${e.number} in ${e.country === "United States" ? "the US" : e.country}`).join(", ");
    this.support.replaceChildren(
      el("div", { class: "support-inner" },
        el("h2", { id: "support-title", tabindex: "-1" }, "You do not have to handle this alone"),
        el("p", { class: "support-urgent" },
          `If you might act on thoughts of hurting yourself, or you are in danger now, call your local emergency number: ${emergency}.`),
        el("p", {}, "These helplines are free. You can call even if you are not sure it is serious enough."),
        [...byCountry.entries()].map(([country, lines]) => el("section", { class: "support-country" },
          el("h3", {}, country),
          el("ul", {}, lines.map(line => el("li", {},
            el("span", { class: "line-name" }, line.name),
            line.tel ? el("a", { href: `tel:${line.tel}` }, line.contact) : el("span", {}, line.contact),
            el("span", { class: "line-hours" }, line.hours)))))),
        el("p", {}, el("a", { href: ELSEWHERE.url, target: "_blank", rel: "noopener" }, ELSEWHERE.label)),
        el("p", { class: "support-note" },
          "MyPal is a self-help companion, not a counsellor or a crisis service. On myzenn.com, MySafe can connect you with a professional."),
        el("div", { class: "row" }, el("button", { class: "btn quiet", onclick: () => this.page.closeSupport() }, "Close")),
      ),
    );
    this.support.addEventListener("keydown", event => {
      if (event.key === "Escape") this.page.closeSupport();
    });
    this.support.dataset.built = "true";
  }
}

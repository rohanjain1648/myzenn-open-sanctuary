// Mounts the planner's assistant. Load it with <script type="module" src="site.js">.
// The plan works without it; if the runtime fails, the status line says so.
import { FetchAudit, Inspector } from "./inspector.js";
import { SafetyNet } from "./vendor/myzenn-safety-net.js";
import { STUDENT } from "./data/week.js";
import { StudentContext, SupportBanner } from "./context.js";

// Record every request from the start, before the runtime makes its first one.
FetchAudit.install(window);

export class AssistantMount {
  static GREETING = `Hi ${STUDENT.name.split(" ")[0]}. I can read and change your plan for this week. If stress gets in the way, I can bring in MyZenn's calm companion. I will ask you first.`;
  static NO_KEY = "The planner needs an AI provider key to talk. You can still use the plan without one. To connect it, open AI provider settings below the chat.";

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const links = await AssistantMount.publishedLinks(siteBase);
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      const { engine, trace } = booted;
      AssistantMount.engine = engine;
      const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");

      AssistantMount.armSafetyNet(engine, { holdUrgent: () => needsKey });
      AssistantMount.carryPrivateContext(engine);

      const peers = AssistantMount.peerLabels(links);
      const inspector = new Inspector(document.querySelector("#inspector"), {
        peers,
        privateContext: () => StudentContext.lastTurn,
        label: field => StudentContext.label(field),
        value: field => StudentContext.value(field),
      });
      inspector.attach(trace);
      // A visitor is never asked for a URL. The planner calls only the networks its
      // publisher bound in links.json.
      engine.onLinkRequired = async () => null;
      engine.onConsent = info => ConsentCard.ask(info, {
        peers,
        allowRule: AssistantMount.allowRule(engine),
        routerHost: AssistantMount.hostOf(engine.top?.llm?.baseUrl),
        onDecision: decision => inspector.noteConsent(info, decision),
      });

      if (needsKey) {
        status.textContent = "The planner's assistant is not connected yet. The plan still works.";
        AssistantMount.firstMessage(AssistantMount.NO_KEY);
        const settings = document.querySelector(".pal-settings");
        if (settings) settings.open = false;
      } else {
        status.textContent = "The planner's assistant is connected.";
        AssistantMount.firstMessage(AssistantMount.GREETING);
      }
      document.body.dataset.assistant = needsKey ? "needs-key" : "ready";
      return engine;
    } catch (error) {
      status.textContent = "The planner's assistant could not load. The plan still works.";
      document.body.dataset.assistant = "failed";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /** The publisher's link map, which also tells the page where MyZenn lives. */
  static async publishedLinks(siteBase) {
    try {
      const response = await fetch(new URL("links.json", siteBase), { cache: "no-store" });
      const doc = await response.json();
      const links = doc?.networks?.exam_planner || {};
      const calm = links.myzenn_calm;
      if (calm) {
        const support = document.querySelector("#myzenn-support-link");
        if (support) support.href = new URL("/#support", calm).href;
        const home = document.querySelector("#myzenn-home-link");
        if (home) home.href = new URL("/", calm).href;
      }
      return links;
    } catch {
      return {};
    }
  }

  static peerLabels(links) {
    const peers = new Map();
    if (links.myzenn_calm) {
      peers.set(new URL(links.myzenn_calm).host, { name: "MyZenn calm companion", site: "MyZenn", reference: "myzenn_calm" });
    }
    return peers;
  }

  static allowRule(engine) {
    try {
      const network = engine.top.network;
      return network.getAgentSpec(network.findFrontMan())?.allow?.to_downstream?.sly_data || [];
    } catch {
      return [];
    }
  }

  static hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  }

  /** Give each turn the student's private context, in place of the runtime's demo token. */
  static carryPrivateContext(engine) {
    const streamTurn = engine.streamTurn.bind(engine);
    engine.streamTurn = (text, options = {}) => streamTurn(text, { ...options, slyData: StudentContext.forTurn() });
  }

  /** MyZenn's drop-in safety net: support shows before any model replies. */
  static armSafetyNet(engine, { holdUrgent }) {
    const show = () => SupportBanner.show();
    for (const step of [
      () => SafetyNet.watchInput(document.querySelector("#agent-app"), show, { holdUrgent }),
      () => SafetyNet.attach(engine, show),
    ]) {
      try {
        step();
      } catch (error) {
        console.error("A safety-net layer could not start", error);
      }
    }
  }

  static firstMessage(text) {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) first.textContent = text;
  }
}

/**
 * The planner's own consent card for contacting another site. It names the site and
 * its origin, the message it will get, which private fields cross and which stay, and
 * where the peer's agents run. The runtime calls it before any contact with the peer.
 */
export class ConsentCard {
  static ask(info, { peers, allowRule, routerHost, onDecision }) {
    return new Promise(resolve => {
      const messages = document.querySelector("#ns-msgs");
      const peer = peers.get(info.peerOrigin);
      const name = peer?.name || info.peerLabel || info.peerOrigin;
      const context = StudentContext.lastTurn || {};
      const crossing = allowRule.filter(field => Object.hasOwn(context, field));
      const kept = Object.keys(context).filter(field => !crossing.includes(field));
      const label = field => StudentContext.label(field);

      const card = document.createElement("div");
      card.className = "ns-msg bot consent-card";
      card.setAttribute("role", "group");
      const heading = document.createElement("h3");
      heading.tabIndex = -1;
      heading.textContent = `Bring in the ${name}?`;
      const lead = document.createElement("p");
      lead.textContent = `The planner wants to load ${peer?.site ? `${peer.site}'s agents` : "another site's agents"} from ${info.peerOrigin} into this tab, to help with how you feel.`;
      const facts = document.createElement("dl");
      const add = (term, text) => {
        const row = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.textContent = text;
        row.append(dt, dd);
        facts.append(row);
      };
      add("It gets", `This message: “${String(info.requestText || "").slice(0, 220)}”${crossing.length ? `, and your ${crossing.map(field => `${label(field)} (${StudentContext.value(field) ?? "hidden"})`).join(", ")}.` : ". Nothing from your profile."}`);
      const withheld = [...kept.map(label), "AI key"];
      add("It does not get", `Your ${withheld.length > 1 ? `${withheld.slice(0, -1).join(", ")} or ${withheld.at(-1)}` : withheld[0]}.`);
      add("It runs", `Here, in this tab, on your AI provider${routerHost ? ` (${routerHost})` : ""}.`);
      const actions = document.createElement("div");
      actions.className = "consent-actions";
      const finish = (decision, note) => {
        actions.replaceWith(Object.assign(document.createElement("p"), { className: "consent-done", textContent: note }));
        onDecision?.(decision);
        resolve(decision);
      };
      for (const [decision, text, note, quiet] of [
        ["allow", "Allow", "Allowed.", false],
        ["always", "Allow for this visit", `Allowed for the rest of this visit to ${info.peerOrigin}.`, true],
        ["decline", "Not now", `Declined. Nothing was sent to ${info.peerOrigin}.`, true],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        if (quiet) button.className = "ghost";
        button.addEventListener("click", () => finish(decision, note), { once: true });
        actions.append(button);
      }
      card.append(heading, lead, facts, actions);
      messages.append(card);
      messages.scrollTop = messages.scrollHeight;
      heading.focus();
    });
  }
}

if (typeof window !== "undefined") {
  await AssistantMount.start();
}

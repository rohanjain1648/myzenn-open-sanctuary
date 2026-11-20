// "What crossed to MyZenn": a live record of every contact between this page and
// another agent site, built from two independent sources:
// - the runtime's own trace (what the planner sent, which agents ran where), and
// - a log of every fetch() this page made (which origin, which file, and whether an
//   Authorization header was attached; never the header's value).
// The second source is what shows that MyZenn never receives the visitor's AI key.

export class FetchAudit {
  static entries = [];
  static listeners = new Set();

  /**
   * Wrap window.fetch once, before the runtime loads, so every request is recorded.
   * Only the origin, path, method and whether an Authorization header is present are
   * kept. Header values are never read into the log.
   */
  static install(win) {
    if (win.__fetchAudit) return;
    const original = win.fetch.bind(win);
    win.fetch = (input, init) => {
      try {
        FetchAudit.record(input, init, win.location.href);
      } catch {
        // The audit must never stop a request.
      }
      return original(input, init);
    };
    win.__fetchAudit = FetchAudit;
  }

  static record(input, init, base) {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), base);
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
    const entry = {
      host: url.host,
      origin: url.origin,
      path: url.pathname.replace(/\/\.\//g, "/"),
      method: String(init?.method ?? (isRequest ? input.method : "GET")).toUpperCase(),
      withKey: headers.has("authorization"),
      at: Date.now(),
    };
    FetchAudit.entries.push(entry);
    for (const listener of FetchAudit.listeners) listener(entry);
    return entry;
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function list(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export class Inspector {
  /**
   * :param root: The panel element.
   * :param peers: Map of peer host to {name, site}, for readable labels.
   * :param privateContext: Returns the private context the last turn carried.
   * :param label: Readable name of a private field.
   * :param value: Readable value of a field that may cross, shown only to the student.
   */
  constructor(root, { peers, privateContext, label = field => field, value = () => null }) {
    this.root = root;
    this.peers = peers;
    this.privateContext = privateContext;
    this.label = label;
    this.value = value;
    this.hops = []; // newest last
    this.pendingFetch = new Map(); // peer host -> remote_fetch info
  }

  attach(trace) {
    trace.addEventListener("event", event => this.handle(event.detail));
    FetchAudit.listeners.add(() => this.render());
    this.render();
  }

  peerName(host) {
    return this.peers.get(host)?.name || host;
  }

  /** The consent card reports each decision, including declines, here. */
  noteConsent(info, decision) {
    if (decision === "decline") {
      this.hops.push({ host: info.peerOrigin, request: info.requestText, declined: true, at: Date.now(), agents: new Set(), models: 0, routers: new Set(), sandboxed: [], errors: [] });
      this.render();
    } else {
      this.lastConsent = { host: info.peerOrigin, at: Date.now(), always: decision === "always" };
    }
  }

  handle(ev) {
    if (ev.kind === "remote_fetch") {
      if (ev.phase === "start") this.pendingFetch.set(ev.peerOrigin, { at: ev.wall, ok: null });
      else if (ev.phase === "end") {
        const fetched = this.pendingFetch.get(ev.peerOrigin) || {};
        fetched.ok = ev.status !== "error";
        fetched.error = ev.error || null;
        this.pendingFetch.set(ev.peerOrigin, fetched);
        if (ev.status === "error") {
          this.hops.push(this.newHop(ev.peerOrigin, null, ev.wall));
          this.hops.at(-1).errors.push(`Could not load the network: ${ev.error}`);
          this.render();
        }
      }
      return;
    }
    if (ev.kind === "remote_call" && ev.phase === "start") {
      const hop = this.newHop(ev.peerOrigin, ev.id, ev.wall);
      hop.request = ev.requestPayload?.user_message?.text || "";
      hop.sentFields = Object.keys(ev.requestPayload?.sly_data || {});
      hop.context = this.privateContext() || {};
      hop.loaded = this.pendingFetch.has(ev.peerOrigin) ? "fresh" : "cached";
      this.pendingFetch.delete(ev.peerOrigin);
      this.hops.push(hop);
      this.render();
      return;
    }
    const hop = this.hops.findLast(candidate => candidate.span && candidate.host === ev.origin && !candidate.finished)
      || (ev.kind === "remote_call" ? this.hops.findLast(candidate => candidate.span === ev.id) : null);
    if (!hop) return;
    if (ev.kind === "remote_call" && ev.phase === "end") {
      hop.finished = true;
      if (ev.status === "error") hop.errors.push(ev.error);
      this.render();
    } else if (ev.kind === "agent" && ev.phase === "start") {
      hop.agents.add(ev.agent);
      this.render();
    } else if (ev.kind === "model_call" && ev.phase === "end") {
      hop.models += 1;
      if (ev.routerHost) hop.routers.add(ev.routerHost);
      this.render();
    } else if (ev.kind === "tool_call" && ev.toolKind === "coded (sandbox)" && (ev.phase === "end")) {
      hop.sandboxed.push({ tool: ev.tool, ok: ev.status !== "error", error: ev.error });
      this.render();
    } else if (ev.kind === "agent_result" && ev.text && ev.agent) {
      // The front agent's result arrives last; keep the latest.
      hop.answer = ev.text;
      hop.answerAgent = ev.agent;
      this.render();
    }
  }

  newHop(host, span, at) {
    return {
      host, span, at, request: "", sentFields: [], context: {}, loaded: "fresh",
      agents: new Set(), models: 0, routers: new Set(), sandboxed: [], errors: [], finished: false,
    };
  }

  render() {
    const body = this.root.querySelector(".inspector-body");
    if (!this.hops.length) {
      body.replaceChildren(el("p", { class: "inspector-empty" },
        "Nothing has crossed yet. If you tell the planner that stress is getting in the way, it asks you before it contacts MyZenn."));
      return;
    }
    body.replaceChildren(...[...this.hops].reverse().map((hop, index) => this.renderHop(hop, index === 0)));
  }

  renderHop(hop, latest) {
    const name = this.peerName(hop.host);
    if (hop.declined) {
      return el("article", { class: "hop is-declined" },
        el("h3", {}, `You declined ${name}`),
        el("p", { class: "hop-meta" }, `${clock(hop.at)}. Nothing was sent to ${hop.host}, and nothing was loaded from it.`),
        hop.request ? el("p", { class: "hop-quote" }, `“${hop.request}”`) : null);
    }
    const requests = FetchAudit.entries.filter(entry => entry.host === hop.host);
    const leaked = requests.filter(entry => entry.withKey);
    // Model calls only: the runtime also makes a keyless GET to the router origin at boot.
    const routerCalls = FetchAudit.entries.filter(entry => hop.routers.has(entry.host) && entry.method === "POST");
    const fieldsSent = hop.sentFields.map(field => {
      const value = this.value(field);
      return value ? `${this.label(field)} (${value})` : this.label(field);
    });
    const kept = Object.keys(hop.context).filter(field => !hop.sentFields.includes(field)).map(field => this.label(field));
    const ran = [...hop.agents];
    for (const tool of hop.sandboxed) ran.push(`${tool.tool} (sandboxed code${tool.ok ? "" : `, failed: ${tool.error}`})`);

    const facts = [
      ["Sent", hop.request ? `“${hop.request}”` : "Nothing yet."],
      ["Private fields sent", fieldsSent.length ? list(fieldsSent) : "None."],
      ["Kept on this site", kept.length ? list(kept) : "Nothing else was in this turn's private context."],
      ["Read from " + hop.host, requests.length
        ? el("span", {}, el("ul", { class: "hop-files" }, requests.map(entry => el("li", {}, `${entry.method} ${entry.path}`))),
          leaked.length
            ? el("span", { class: "hop-alarm" }, `Your AI key was attached to ${leaked.length} of these requests. That should never happen.`)
            : el("span", { class: "hop-ok" }, `Your AI key was attached to none of them.${hop.loaded === "cached" ? " The network was already loaded earlier in this visit." : ""}`))
        : (hop.loaded === "cached" ? "Nothing new: the network was already loaded earlier in this visit." : "Nothing yet.")],
      ["Ran in this tab", ran.length
        ? `${list(ran)}, using your AI provider${hop.routers.size ? ` (${[...hop.routers].join(", ")})` : ""}. ${hop.models} model call${hop.models === 1 ? "" : "s"}${routerCalls.length && routerCalls.every(entry => entry.withKey) ? ", each with your key, sent only there." : "."}`
        : "Starting…"],
    ];
    return el("article", { class: `hop${latest ? " is-latest" : ""}` },
      el("h3", {}, name),
      el("p", { class: "hop-meta" }, `${clock(hop.at)}. ${hop.loaded === "fresh" ? `Loaded from ${hop.host} into this tab` : `Run again in this tab`}, with your OK.`),
      el("dl", { class: "hop-facts" }, facts.map(([term, value]) => el("div", {}, el("dt", {}, term), el("dd", {}, value)))),
      hop.errors.length ? el("p", { class: "hop-alarm" }, hop.errors.join(" ")) : null,
      hop.answer
        ? el("details", { class: "hop-answer" }, el("summary", {}, `What came back from ${hop.answerAgent}`), el("p", {}, hop.answer))
        : null);
  }
}

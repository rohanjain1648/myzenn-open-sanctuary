// Spec checks: run the failures that spec section 6 says must stop visibly, live, in
// this browser, through the same runtime the planner uses. Each check boots its own
// engine on a small fixture network that uses the runtime's deterministic mock model
// ("browser://mock" calls each tool once), so no key is needed and nothing is sent to
// any provider. The page shows the runtime's own message and the requests it made.

import { Engine } from "../runtime/engine.js";
import { TraceBus } from "../runtime/trace.js";
import { FetchAudit } from "../inspector.js";

FetchAudit.install(window);

export const CHECKS = [
  {
    id: "denied",
    title: "A site the network does not allow",
    rule: "The runtime must refuse an origin that is not in the calling network's allowed_peers, before any contact.",
    top: "/checks/denied",
    expect: /is not in .*allowed_peers; refusing to contact it/,
    evidence: run => {
      const contacted = run.requests.filter(entry => entry.host === "unlisted.example");
      return { ok: contacted.length === 0, text: `Requests to unlisted.example: ${contacted.length}.` };
    },
  },
  {
    id: "exact",
    title: "A network name that is close but not exact",
    rule: "The runtime must run only the network whose name exactly matches the URL, and fail rather than pick another.",
    top: "/checks/exact",
    expect: /No published network named 'calmer'.*refusing to run a different network/,
    evidence: run => {
      const read = run.requests.map(entry => entry.path).filter(path => path.startsWith("/checks/peers/"));
      return { ok: read.length === 1 && read[0] === "/checks/peers/agent-manifest.json", text: `Read from the peer site: ${read.join(", ") || "nothing"}. No network definition was fetched.` };
    },
  },
  {
    id: "invalid",
    title: "An invalid network",
    rule: "The runtime must reject a malformed network, such as one that calls a missing agent, before any model call.",
    top: "/checks/invalid",
    expect: /Network 'broken' .* failed validation: .*ghost_agent/,
    evidence: run => {
      const started = run.agents.filter(entry => entry.network === "broken");
      return { ok: started.length === 0, text: `Agents of the broken network that started: ${started.length}.` };
    },
  },
  {
    id: "cycle",
    title: "A composition cycle",
    rule: "The runtime must stop a chain of networks that calls back into itself.",
    top: "/checks/cycle-a",
    expect: /already in this request's call chain/,
    evidence: run => {
      const networks = [...new Set(run.agents.map(entry => entry.network))];
      return { ok: networks.join(",") === "loop_a,loop_b", text: `Networks that ran: ${networks.join(" then ")}. loop_a was not entered a second time.` };
    },
  },
  {
    id: "budget",
    title: "A request over its budget",
    rule: "The runtime must enforce a finite limit on remote calls per request.",
    top: "/checks/budget",
    expect: /Skipped .*p5: the per-query limit of 4 third-party calls was reached/,
    evidence: run => {
      const fetched = run.requests.filter(entry => /\/checks\/peers\/p\d\.network\.json$/.test(entry.path)).map(entry => entry.path.match(/p\d/)[0]);
      return { ok: !fetched.includes("p5"), text: `Peer networks fetched: ${fetched.join(", ")}. p5 was never fetched.` };
    },
  },
  {
    id: "tampered",
    title: "Peer code that changed after publishing",
    rule: "A coded-tool bundle whose bytes no longer match the manifest's SRI digest must not run.",
    top: "/checks/tampered",
    expect: /integrity check failed/,
    evidence: run => {
      const ran = run.results.some(text => /echoed/.test(text));
      return { ok: !ran, text: `The bundle was fetched, its digest compared, and the tool ${ran ? "RAN" : "never ran"}.` };
    },
  },
];

/**
 * Run one check and return what happened.
 *
 * :return: {pass, message, evidence, requests, agents, results, consents}
 */
export async function runCheck(check) {
  const base = location.origin;
  const trace = new TraceBus();
  const results = [];
  const agents = [];
  trace.addEventListener("event", event => {
    const ev = event.detail;
    if (ev.kind === "tool" && ev.phase === "end" && ev.resultPreview) results.push(ev.resultPreview);
    if (ev.kind === "agent" && ev.phase === "start") agents.push({ agent: ev.agent, network: ev.network });
  });
  const engine = new Engine({ originUrl: `${base}${check.top}`, trace, sandboxWorkerUrl: `${base}/runtime/sandbox-worker.js` });
  // The fixtures live on this site. Trust this origin for the run; every other origin
  // stays subject to each fixture's own closed allowed_peers list.
  engine.runtimeAllowedPeers.add(base);
  const consents = [];
  engine.onConsent = async info => {
    consents.push(info.peerOrigin);
    return "allow";
  };
  const start = FetchAudit.entries.length;
  let failure = null;
  try {
    await engine.runTurn("Run the check.");
  } catch (error) {
    failure = error.message;
  }
  const requests = FetchAudit.entries.slice(start);
  const messages = [...results.filter(text => /^(Error from tool|Skipped)/.test(text)), ...(failure ? [failure] : [])];
  const message = messages.join("\n");
  const run = { requests, agents, results, consents };
  const evidence = check.evidence(run);
  return { pass: check.expect.test(message) && evidence.ok, message: message || "(no error was reported)", evidence: evidence.text, ...run };
}

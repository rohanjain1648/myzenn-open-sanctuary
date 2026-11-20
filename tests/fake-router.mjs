// A scripted, OpenAI-compatible router for checking the two sites in a real browser
// without an LLM key. It never calls a model: it recognises which agent is calling by
// the tools it offers and replies with a fixed script, streamed the way the runtime
// reads it. It is a test tool only; the published sites never point at it.
//
//   node tests/fake-router.mjs            listens on http://127.0.0.1:8749/v1
//
// In a tab, use router http://127.0.0.1:8749/v1 with any dummy key.

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = "fake-scripted-router";
const DANGER = /(do not|don't|dont) want to live|kill myself|end my life|suicid/i;
const STRESS = /stress|panic|racing|focus|anxious|overwhelm|nervous|can't|cannot/i;

/** Parse a tool result: internal and peer agents return a {text} envelope. */
function resultText(content) {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.text === "string" ? parsed.text : content;
  } catch {
    return content;
  }
}

/** The scripted reply for one chat-completions request: {content} or {toolCall}. */
export function scriptedReply(body) {
  const names = (body.tools || []).map(tool => tool.function.name);
  const messages = body.messages || [];
  const results = messages.filter(message => message.role === "tool");
  const lastUser = String([...messages].reverse().find(message => message.role === "user")?.content || "");
  const last = results.at(-1);

  // The planner's front agent.
  if (names.includes("myzenn_calm")) {
    if (!results.length) {
      if (DANGER.test(lastUser)) return { toolCall: { name: "myzenn_calm", args: { request: "The student says they do not want to live any more." } } };
      if (STRESS.test(lastUser)) {
        return { toolCall: { name: "myzenn_calm", args: { request: "A student has a chemistry exam tomorrow. Their heart is racing and they cannot focus on revision." } } };
      }
      return { toolCall: { name: "website_get_week_plan", args: {} } };
    }
    const calm = results.find(message => message.name === "myzenn_calm");
    const answer = calm ? resultText(calm.content) : "";
    if (last.name === "website_get_week_plan" && !calm) {
      const plan = JSON.parse(last.content).result;
      const today = plan.blocks.filter(block => block.dayName === plan.now.day && !block.over && !block.done);
      return { content: `Left today: ${today.map(block => `${block.title} at ${block.start}`).join("; ")}.` };
    }
    if (last.name === "myzenn_calm") {
      if (/^Show this to the person now/.test(answer) || !/^\{|\d\./.test(answer) && /helpline|emergency/i.test(answer)) {
        return { content: `From MyZenn:\n\n${answer}` };
      }
      if (/declined|Skipped|Error/.test(answer)) {
        return { content: `${answer.split(".")[0]}. I can add a short break to your plan instead, if you like.` };
      }
      return { toolCall: { name: "website_add_block", args: { day: "Wed", start: "15:45", minutes: 15, kind: "break", title: "Reset break" } } };
    }
    if (last.name === "website_add_block") {
      const receipt = JSON.parse(last.content);
      const outcome = receipt.result?.ok
        ? "I added a 15-minute reset break at 15:45, before your chemistry block."
        : receipt.result?.declined ? "No problem. I left your plan as it is." : `I could not add the break: ${receipt.result?.reason}`;
      return { content: `From MyZenn:\n\n${answer}\n\n${outcome}` };
    }
    return { content: "Done." };
  }

  // MyZenn's calm_companion.
  if (names.includes("technique_library")) {
    if (!results.length) {
      return DANGER.test(lastUser)
        ? { toolCall: { name: "support_lines", args: {} } }
        : { toolCall: { name: "technique_library", args: { request: "box_breathing. Exam tomorrow, racing heart, cannot focus." } } };
    }
    if (last.name === "support_lines") {
      if (/^Error/.test(last.content)) return { content: `Show this to the person now: please call your local emergency number. (${last.content})` };
      const lines = JSON.parse(last.content);
      const sets = lines.countryShared ? [lines] : lines.byCountry;
      const parts = sets.map(set => `${set.country}: emergency ${set.emergency}; ${set.helplines.slice(0, 2).map(line => `${line.name}, ${line.contact}`).join("; ")}`);
      return { content: `Show this to the person now: I am really glad you said this. A person can help right now. ${parts.join(". ")}. Elsewhere: ${lines.directory.url}` };
    }
    const steps = resultText(last.content).split("\n").filter(line => /^\d\./.test(line)).join("\n");
    return { content: `Exam nerves can make your heart race, and that is a normal reaction. Box breathing takes about 2 minutes:\n${steps}\nFor a guided version: https://myzenn.com/mysanctuary/mybreath` };
  }

  // MyZenn's technique_library.
  if (/MyZenn's library of short self-help techniques/.test(String(messages[0]?.content || ""))) {
    return { content: "box_breathing, about 2 minutes, https://myzenn.com/mysanctuary/mybreath\n1. Sit back and let your shoulders drop.\n2. Breathe in through your nose for a count of 4.\n3. Hold for 4.\n4. Breathe out slowly through your mouth for 4.\n5. Hold, empty, for 4.\n6. Repeat for 4 rounds, then breathe normally and notice how you feel." };
  }
  return { content: "(fake router) No script for this agent." };
}

let callNumber = 0;

/** Encode a reply as an OpenAI chat-completions event stream. */
export function sse(reply) {
  const chunks = reply.toolCall
    ? [{ model: MODEL, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${++callNumber}`, type: "function", function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args || {}) } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]
    : [{ model: MODEL, choices: [{ index: 0, delta: { content: reply.content } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
  return `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function serve(port) {
  const log = [];
  createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "alibaba/qwen-3.5-35b-a3b" }] }));
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      req.on("data", chunk => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        const reply = scriptedReply(body);
        log.push({ at: new Date().toISOString(), key: req.headers.authorization ? "present" : "missing", tools: (body.tools || []).length, reply: reply.toolCall?.name || "text" });
        console.log(JSON.stringify(log.at(-1)));
        res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream" });
        res.end(sse(reply));
      });
      return;
    }
    res.writeHead(404, { ...CORS, "Content-Type": "text/plain" }).end("Not found");
  }).listen(port, "127.0.0.1", () => console.log(`Fake scripted router: http://127.0.0.1:${port}/v1`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serve(Number(process.argv[2] || 8749));
}

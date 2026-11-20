// End-to-end check of both sites in a real, headless Chrome, with no LLM key.
//
//   node tools/serve.mjs                 (MyZenn on :8741, planner on :8742)
//   node tests/fake-router.mjs           (scripted router on :8749)
//   node tests/browser-check.mjs [outDir]
//
// It drives Chrome over the DevTools protocol with a throwaway profile, so nothing is
// saved in anyone's browser. The dummy key and the fake router live only in that
// tab's session storage. It runs the stress flow and the danger flow on the planner,
// checks the consent card, the plan suggestion, the inspector, MyZenn's sandboxed tool
// in the real worker, and that no request to MyZenn carried a key. Screenshots go to
// outDir. Set CHROME_PATH if Chrome is not in the default place.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PLANNER = process.env.PLANNER_URL || "http://127.0.0.1:8742/";
const MYZENN = process.env.MYZENN_URL || "http://127.0.0.1:8741/";
const MYZENN_HOST = new URL(MYZENN).host;
const ROUTER = "http://127.0.0.1:8749/v1";
const OUT = path.resolve(process.argv[2] || "browser-check-output");
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Page {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? "").join(" "));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const value = await this.eval(expression);
        if (value) return value;
      } catch {
        // The page may be navigating.
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }

  async shot(name, { width = 1440, height = 900 } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(250);
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }
}

async function launch() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "oas-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
  ], { stdio: "ignore" });
  let port = null;
  for (let i = 0; i < 100 && !port; i += 1) {
    await sleep(100);
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0].trim();
    } catch {
      port = null;
    }
  }
  if (!port) throw new Error("Chrome did not start.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(entry => entry.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const page = new Page(socket);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return {
    page,
    async close() {
      socket.close();
      chrome.kill();
      await sleep(500);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Send a chat message the way a visitor does: fill the input and press Send. */
async function say(page, text) {
  await page.eval(`(() => {
    const input = document.querySelector("#ns-input");
    input.value = ${JSON.stringify(text)};
    document.querySelector("#ns-send").click();
    return true;
  })()`);
}

const lastBot = `[...document.querySelectorAll("#ns-msgs .ns-msg.bot")].map(m => m.textContent).at(-1) || ""`;

async function plannerFlows(page) {
  await page.goto(PLANNER);
  await page.waitFor("document.body.dataset.assistant");
  check("planner loads; assistant asks for a key", await page.eval("document.body.dataset.assistant") === "needs-key");
  await page.shot("01-planner-no-key");

  // A dummy key and the fake router, in this tab's session storage only.
  await page.eval(`import("./runtime/byok.js").then(m => { m.saveTabByokSetup({ key: "sk-dummy-local-test", router: ${JSON.stringify(ROUTER)}, model: "alibaba/qwen-3.5-35b-a3b" }); return true; })`);
  await page.goto(PLANNER);
  await page.waitFor("document.body.dataset.assistant === 'ready'");
  check("planner assistant connects with the tab's setup", true);

  // Stress flow, with the country shared.
  await page.eval(`(() => { const box = document.querySelector("#share-country"); if (!box.checked) box.click(); return box.checked; })()`);
  await say(page, "Chemistry is tomorrow and my heart is racing. I cannot focus.");
  await page.waitFor(`document.querySelector(".consent-card .consent-actions")`);
  const consent = await page.eval(`document.querySelector(".consent-card").innerText`);
  check("consent card names MyZenn and its origin", /MyZenn calm companion/.test(consent) && consent.includes(MYZENN_HOST), consent.split("\n")[0]);
  check("consent card says the country crosses, the rest stays", /country \(India\)/.test(consent) && /name, email, school, mock scores or AI key/.test(consent));
  const beforeConsent = await page.eval(`window.__fetchAudit.entries.filter(e => e.host === ${JSON.stringify(MYZENN_HOST)}).length`);
  check("no request reached MyZenn before consent", beforeConsent === 0, `${beforeConsent} requests`);
  await page.shot("02-consent-card");
  await page.eval(`[...document.querySelectorAll(".consent-actions button")].find(b => b.textContent === "Allow").click(), true`);

  await page.waitFor(`!document.querySelector("#planner-suggestion").hidden`, 20000);
  const suggestion = await page.eval(`document.querySelector("#planner-suggestion").innerText`);
  check("the plan shows the suggested break before it happens", /add Reset break, Wednesday 15:45 to 16:00/.test(suggestion), suggestion.replace(/\s+/g, " "));
  check("the suggested break is drawn on the plan", await page.eval(`!!document.querySelector(".block.is-ghost")`));
  await page.shot("03-plan-suggestion");
  await page.eval(`[...document.querySelectorAll("#planner-suggestion button")].find(b => b.textContent === "Add it").click(), true`);

  await page.waitFor(`/From MyZenn/.test(${lastBot})`, 20000);
  const answer = await page.eval(lastBot);
  check("the planner shows MyZenn's answer and the added break", /Box breathing/.test(answer) && /added a 15-minute reset break/.test(answer));
  check("the break is on the plan", await page.eval(`[...document.querySelectorAll(".block")].some(b => /Reset break/.test(b.textContent))`));
  await page.shot("04-answer");

  const audit = await page.eval(`window.__fetchAudit.entries.map(e => ({ host: e.host, path: e.path, method: e.method, withKey: e.withKey }))`);
  const toMyZenn = audit.filter(entry => entry.host === MYZENN_HOST);
  // Model calls only. At boot the runtime also asks the router origin for an
  // agent-manifest.json, without the key, to detect a published mock router.
  const toRouter = audit.filter(entry => entry.host === "127.0.0.1:8749" && entry.path === "/v1/chat/completions");
  check("MyZenn's network files were read from MyZenn", toMyZenn.some(entry => entry.path === "/agents/myzenn_calm.network.json"), toMyZenn.map(entry => entry.path).join(", "));
  check("no request to MyZenn carried a key", toMyZenn.length > 0 && toMyZenn.every(entry => !entry.withKey));
  check("every model call went to the visitor's router, with the key", toRouter.length >= 5 && toRouter.every(entry => entry.withKey), `${toRouter.length} calls`);
  const inspector = await page.eval(`document.querySelector("#inspector").innerText`);
  check("inspector shows the request, the shared country and the withheld fields",
    /Private fields sent\s*country \(India\)/.test(inspector) && /Kept on this site\s*name, email, school and mock scores/.test(inspector), inspector.slice(0, 160).replace(/\s+/g, " "));
  check("inspector confirms no key went to MyZenn", /Your AI key was attached to none of them/.test(inspector));
  check("inspector lists MyZenn's agents running in this tab", /calm_companion and technique_library/.test(inspector));
  await page.eval(`document.querySelector("#inspector").scrollIntoView(), true`);
  await page.shot("05-inspector");

  // Danger flow: the safety net shows help at once; MyZenn's sandboxed tool runs.
  await page.eval(`document.querySelector("#ns-newchat").click(), true`);
  await say(page, "I do not want to live any more.");
  await page.waitFor(`!document.querySelector("#support-banner").hidden`, 3000);
  check("the safety net shows support before any model replies", true);
  await page.waitFor(`document.querySelector(".consent-card:last-of-type .consent-actions")`);
  await page.eval(`[...document.querySelectorAll(".consent-actions button")].find(b => b.textContent === "Allow").click(), true`);
  await page.waitFor(`/From MyZenn/.test(${lastBot})`, 25000);
  const danger = await page.eval(lastBot);
  check("MyZenn's sandboxed tool returned India's helplines in the real worker", /Tele-MANAS/.test(danger) && /112/.test(danger), danger.slice(0, 140));
  const bundleRead = await page.eval(`window.__fetchAudit.entries.some(e => e.host === ${JSON.stringify(MYZENN_HOST)} && e.path === "/agents/myzenn_calm.tools.js" && !e.withKey)`);
  check("the tool bundle came from MyZenn without a key", bundleRead);
  await page.eval(`window.scrollTo(0, 0), true`);
  await page.shot("06-danger");

  await page.shot("07-planner-phone", { width: 390, height: 844 });
  check("no horizontal page scroll on a phone", await page.eval(`document.documentElement.scrollWidth <= innerWidth`));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

async function specChecks(page) {
  await page.goto(`${PLANNER}checks/`);
  await page.waitFor(`document.querySelectorAll(".check").length === 6`);
  await page.eval(`document.querySelector("#run-all").click(), true`);
  await page.waitFor(`[...document.querySelectorAll(".check")].every(c => c.dataset.state === "pass" || c.dataset.state === "fail")`, 60000);
  const states = await page.eval(`[...document.querySelectorAll(".check")].map(c => [c.id, c.dataset.state, c.querySelector(".check-message")?.textContent.slice(0, 90)])`);
  for (const [id, state, message] of states) check(`spec check ${id.replace("check-", "")} stops visibly`, state === "pass", message);
  await page.shot("09-spec-checks", { width: 1440, height: 1800 });
}

async function myzennFlows(page) {
  await page.goto(`${MYZENN}#support`);
  await page.waitFor(`!document.querySelector("#support").hidden`, 5000);
  check("MyZenn opens its support panel from #support", true);
  await page.shot("08-myzenn-support");
}

await mkdir(OUT, { recursive: true });
const browser = await launch();
try {
  // FLOWS=checks,myzenn runs a subset, such as on a public deploy where the scripted
  // router on 127.0.0.1 is out of reach.
  const flows = (process.env.FLOWS || "planner,checks,myzenn").split(",");
  if (flows.includes("planner")) await plannerFlows(browser.page);
  if (flows.includes("checks")) await specChecks(browser.page);
  if (flows.includes("myzenn")) await myzennFlows(browser.page);
} catch (error) {
  check("browser flow finished", false, error.message);
  await browser.page.shot("error").catch(() => {});
} finally {
  const errors = browser.page.errors.filter(text => !/Password field is not contained in a form/.test(text));
  check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exitCode = failed ? 1 : 0;

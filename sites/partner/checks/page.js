// Draws the spec checks and runs them on request.
import { CHECKS, runCheck } from "./checks.js";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined));
  return node;
}

const list = document.getElementById("checks");
const summary = document.getElementById("summary");
const outcomes = new Map();
const items = new Map();

for (const check of CHECKS) {
  const result = el("div", { class: "check-result", "aria-live": "polite" });
  const button = el("button", { class: "btn quiet", type: "button", onclick: () => run(check) }, "Run");
  const item = el("li", { class: "check", id: `check-${check.id}`, "data-state": "idle" },
    el("div", { class: "check-head" },
      el("h2", {}, check.title),
      el("span", { class: "check-state" }, "Not run"),
      button),
    el("p", { class: "check-rule" }, check.rule),
    result);
  items.set(check.id, { item, result, button });
  list.append(item);
}

async function run(check) {
  const { item, result, button } = items.get(check.id);
  button.disabled = true;
  item.dataset.state = "running";
  item.querySelector(".check-state").textContent = "Running";
  result.replaceChildren();
  const outcome = await runCheck(check);
  outcomes.set(check.id, outcome.pass);
  item.dataset.state = outcome.pass ? "pass" : "fail";
  item.querySelector(".check-state").textContent = outcome.pass ? "Stopped, as required" : "Not stopped";
  result.replaceChildren(
    el("p", { class: "check-label" }, "The runtime said"),
    el("pre", { class: "check-message" }, outcome.message),
    el("p", { class: "check-evidence" }, outcome.evidence),
  );
  button.disabled = false;
  button.textContent = "Run again";
  const passed = [...outcomes.values()].filter(Boolean).length;
  summary.textContent = `${passed} of ${outcomes.size} ${outcomes.size === 1 ? "check" : "checks"} stopped as required.`;
}

document.getElementById("run-all").addEventListener("click", async () => {
  for (const check of CHECKS) await run(check);
});

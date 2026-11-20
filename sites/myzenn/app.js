// Page start-up: draw the stage, wire the page's own controls and the catalog.
// MyPal (site.js) is optional; everything here works without it.
import { App } from "./sanctuary.js";
import { StageView } from "./stage-view.js";
import { TOOLS, CATEGORIES, toolUrl } from "./data/catalog.js";

const view = new StageView(document);
App.page.view = view;
view.render(App.page);

document.getElementById("tool-picker").addEventListener("click", event => {
  const button = event.target.closest("button[data-tool]");
  if (!button) return;
  const tool = button.dataset.tool;
  if (tool === "breathing") App.page.startBreathing({});
  else if (tool === "grounding") App.page.startGrounding();
  else if (tool === "wheel") App.page.openWheel({});
  else if (tool === "anchor") view.anchorSetupView();
});

for (const button of document.querySelectorAll("[data-open-support]")) {
  button.addEventListener("click", () => App.page.openSupport());
}

// Other sites can link straight to MyZenn's support panel: <origin>/#support.
if (location.hash === "#support") App.page.openSupport();
window.addEventListener("hashchange", () => {
  if (location.hash === "#support") App.page.openSupport();
});

// The catalog: every MySanctuary tool, grouped by what it is for.
const catalog = document.getElementById("catalog-list");
for (const category of CATEGORIES) {
  const tools = TOOLS.filter(t => t.category === category.id);
  if (!tools.length) continue;
  const group = document.createElement("section");
  group.className = "catalog-group";
  const heading = document.createElement("h3");
  heading.textContent = category.name;
  const note = document.createElement("p");
  note.className = "catalog-note";
  note.textContent = category.note;
  const list = document.createElement("ul");
  for (const tool of tools) {
    const item = document.createElement("li");
    const name = document.createElement("a");
    name.href = toolUrl(tool);
    name.textContent = tool.name;
    name.className = "catalog-name";
    const summary = document.createElement("span");
    summary.className = "catalog-summary";
    summary.textContent = tool.summary;
    const meta = document.createElement("span");
    meta.className = "catalog-meta";
    meta.textContent = tool.onPage ? `${tool.duration}, also on this page` : tool.duration;
    item.append(name, summary, meta);
    list.append(item);
  }
  group.append(heading, note, list);
  catalog.append(group);
}

// The address other agentic websites use to load MyZenn's portable network.
const networkUrl = new URL("agents/myzenn_calm", document.baseURI).href;
for (const node of document.querySelectorAll("[data-network-url]")) node.textContent = networkUrl;
const copy = document.getElementById("copy-network-url");
copy?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(networkUrl);
    copy.textContent = "Copied";
  } catch {
    copy.textContent = "Select and copy the address";
  }
  setTimeout(() => { copy.textContent = "Copy address"; }, 2500);
});

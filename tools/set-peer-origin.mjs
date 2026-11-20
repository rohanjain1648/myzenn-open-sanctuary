// Points the planner at the MyZenn site it should load the calm companion from.
//
//   node tools/set-peer-origin.mjs https://myzenn-open-sanctuary.vercel.app
//
// It rewrites the four places that name MyZenn's origin, so they always agree:
// links.json (the binding the runtime uses), agent-manifest.json allowed_peers and
// linking.imports, and the fallback links in index.html. Run `npm run build` after.
// The local dev server (tools/serve.mjs) maps this origin back to the local MyZenn.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARTNER = path.join(ROOT, "sites", "partner");

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node tools/set-peer-origin.mjs <MyZenn site origin, such as https://example.vercel.app>");
  process.exit(2);
}
const origin = new URL(raw).origin;
const target = `${origin}/agents/myzenn_calm`;

const linksFile = path.join(PARTNER, "links.json");
const links = JSON.parse(await readFile(linksFile, "utf8"));
const previous = new URL(links.networks.exam_planner.myzenn_calm).origin;
links.networks.exam_planner.myzenn_calm = target;
await writeFile(linksFile, `${JSON.stringify(links, null, 2)}\n`);

const manifestFile = path.join(PARTNER, "agent-manifest.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
manifest.allowed_peers = [...new Set([...manifest.allowed_peers.filter(peer => peer !== previous), origin])];
for (const entry of manifest.linking.imports) if (entry.reference === "myzenn_calm") entry.url = target;
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

const htmlFile = path.join(PARTNER, "index.html");
const html = await readFile(htmlFile, "utf8");
await writeFile(htmlFile, html.split(`${previous}/`).join(`${origin}/`));

console.log(`The planner now loads MyZenn's calm companion from ${target} (was ${previous}).`);

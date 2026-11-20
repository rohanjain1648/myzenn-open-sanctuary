// Local server for both sites, on two ports, so the browser treats them as two
// origins, as they will be on the web.
//
//   node tools/serve.mjs            MyZenn on http://127.0.0.1:8741, partner on :8742
//   node tools/serve.mjs 9001 9002  other ports
//
// It sends the headers production must send too:
// - Access-Control-Allow-Origin: * on public agent files only (manifests, network
//   definitions, link maps, discovery files, and everything under /agents/), so
//   another origin can load them, as spec section 3.3 requires;
// - the Content-Security-Policy that runtime/sandbox-worker.js needs before it runs
//   any coded tool;
// - Cache-Control: no-store, so an edited ES module never mixes with a stale one.
// It binds to 127.0.0.1 only.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [myzennPort = "8741", partnerPort = "8742"] = process.argv.slice(2);

const SITES = [
  { name: "MyZenn Open Sanctuary", dir: path.join(ROOT, "sites", "myzenn"), port: Number(myzennPort) },
  { name: "Exam Week Planner (demo partner)", dir: path.join(ROOT, "sites", "partner"), port: Number(partnerPort) },
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".hocon": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const SANDBOX_CSP = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";

/** True for files other origins may read: the public agent artifacts. */
export function isPublicAgentFile(urlPath) {
  return urlPath.startsWith("/agents/")
    || urlPath.startsWith("/.well-known/")
    || /\/(agent-manifest|links|agent-mcp)\.json$/.test(urlPath)
    || urlPath.endsWith(".network.json");
}

function headersFor(urlPath, filePath) {
  const headers = {
    "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (isPublicAgentFile(urlPath)) headers["Access-Control-Allow-Origin"] = "*";
  if (urlPath.endsWith("/runtime/sandbox-worker.js")) headers["Content-Security-Policy"] = SANDBOX_CSP;
  return headers;
}

/**
 * In local development the planner should load the local MyZenn, not the deployed one.
 * links.json names the production origin; text files from the planner's folder are
 * served with that origin swapped for the local MyZenn origin. Files on disk are
 * unchanged.
 */
let peerSwap = null;
try {
  const links = JSON.parse(await readFile(path.join(ROOT, "sites", "partner", "links.json"), "utf8"));
  const production = new URL(links.networks.exam_planner.myzenn_calm).origin;
  const local = `http://127.0.0.1:${SITES[0].port}`;
  if (production !== local) peerSwap = { production, local };
} catch {
  peerSwap = null;
}

function serve(site) {
  return createServer(async (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    let filePath = path.normalize(path.join(site.dir, urlPath));
    if (!filePath.startsWith(site.dir)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    try {
      if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      let body = await readFile(filePath);
      if (peerSwap && site === SITES[1] && /\.(json|html|js)$/.test(filePath)) {
        body = Buffer.from(body.toString("utf8").split(peerSwap.production).join(peerSwap.local));
      }
      res.writeHead(200, headersFor(urlPath, filePath));
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
      // A missing public file still answers with CORS, so a caller sees a clean 404
      // instead of a CORS error.
      if (isPublicAgentFile(urlPath)) headers["Access-Control-Allow-Origin"] = "*";
      res.writeHead(404, headers).end("Not found");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const site of SITES) {
    serve(site).listen(site.port, "127.0.0.1", () => {
      console.log(`${site.name}: http://127.0.0.1:${site.port}/`);
      if (peerSwap && site === SITES[1]) console.log(`  (loads MyZenn from ${peerSwap.local} instead of ${peerSwap.production})`);
    });
  }
}

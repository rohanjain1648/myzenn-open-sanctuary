// Builds and checks a portable agent network: one that other agentic websites load
// into their own visitors' browsers (Worldwide Agentic Web MVP spec, section 3.2).
//
// Usage:
//   node tools/portable-network.mjs <dir>/<network>.hocon --manifest <dir>/agent-manifest.json
//        [--runtime <dir with hocon.js and kernel.js>] [--check]
//
// It writes <network>.network.json with the browser runtime's own parser and fills in
// the manifest's coded_tools.integrity (a sha384 SRI digest of the bundle), so a
// caller's runtime refuses a bundle that changed after publishing. --check writes
// nothing and fails when an output is missing or out of date.
//
// Why not the agentify-website build script: that script builds a site's own
// assistant. A portable network differs in three ways it would reject or miss:
// - it must not publish website actions, because a caller's runtime would try to
//   open a cross-site action bridge for them, which a static site cannot serve;
// - it may use a coded tool (a JS class run in the caller's sandboxed worker);
// - every private-context field a coded tool reads must be declared in the
//   manifest, so callers know exactly which field their allow rule must pass.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_INSTRUCTIONS = 4000;
// The same checks as the runtime's sandbox (runtime/sandbox.js): a bundle may not load
// other modules.
const DYNAMIC_IMPORT = /\bimport\s*[(.]/;
const STATIC_IMPORT = /(^|[\n;])\s*import\b[\s"'{*]/;

export class PortableNetworkBuilder {
  /**
   * :param options: {hocon, manifest, runtime, check}. Paths may be relative to the
   *   current directory. runtime defaults to the agentify-website skill's copy.
   */
  constructor(options) {
    this.options = options;
    this.errors = [];
    this.warnings = [];
    this.outputs = new Map(); // file path -> text this build writes there
    this.summary = [];
  }

  static parseArgs(argv) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const options = {
      hocon: null,
      manifest: null,
      runtime: path.join(here, "..", "vendor", "agentify-website", "runtime"),
      check: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--check") options.check = true;
      else if (arg === "--manifest" || arg === "--runtime") {
        if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
        options[arg.slice(2)] = argv[i + 1];
        i += 1;
      } else if (!options.hocon) options.hocon = arg;
      else throw new Error(`Unexpected argument: ${arg}`);
    }
    if (!options.hocon || !options.manifest) {
      throw new Error("Usage: node tools/portable-network.mjs <network>.hocon --manifest <agent-manifest.json> [--runtime DIR] [--check]");
    }
    return options;
  }

  /** Run every step. Returns 0 when there are no errors. */
  async run() {
    const runtime = await this.loadRuntime();
    const networkName = path.basename(this.options.hocon, ".hocon");
    const dir = path.dirname(this.options.hocon);
    const text = (await readFile(this.options.hocon, "utf8")).replace(/\r\n/g, "\n");
    this.checkSubset(text);
    let raw;
    try {
      raw = runtime.parseHocon(text);
    } catch (error) {
      this.errors.push(`HOCON: ${error.message}`);
      return this.report(networkName);
    }
    const network = new runtime.AgentNetwork(raw, networkName);
    for (const message of runtime.validateNetwork(network).errors) this.errors.push(`Runtime validation: ${message}`);
    let frontMan = null;
    try {
      frontMan = network.findFrontMan();
    } catch (error) {
      this.errors.push(`Front agent: ${error.message}`);
    }
    const manifestText = (await readFile(this.options.manifest, "utf8")).replace(/\r\n/g, "\n");
    let manifest = null;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      this.errors.push(`Manifest: ${error.message}`);
      return this.report(networkName);
    }
    this.checkManifest(manifest, networkName, frontMan, network.config);
    this.checkAgents(network.config, frontMan);
    const bundle = await this.checkCodedTools(manifest, network.config, dir);

    this.outputs.set(path.join(dir, `${networkName}.network.json`), `${JSON.stringify(raw, null, 2)}\n`);
    if (bundle) {
      const digest = createHash("sha384").update(bundle).digest("base64");
      const updated = { ...manifest, coded_tools: { ...manifest.coded_tools, integrity: `sha384-${digest}` } };
      this.outputs.set(this.options.manifest, `${JSON.stringify(updated, null, 2)}\n`);
      this.summary.push(`Bundle integrity: sha384-${digest.slice(0, 16)}…`);
    }
    if (this.options.check) await this.compareOutputs();
    else if (!this.errors.length) await this.writeOutputs();
    return this.report(networkName, network.config, frontMan);
  }

  async loadRuntime() {
    const dir = path.resolve(this.options.runtime);
    const hocon = await import(pathToFileURL(path.join(dir, "hocon.js")).href);
    const kernel = await import(pathToFileURL(path.join(dir, "kernel.js")).href);
    return { parseHocon: hocon.parseHocon, AgentNetwork: kernel.AgentNetwork, validateNetwork: kernel.validateNetwork };
  }

  checkSubset(text) {
    text.split("\n").forEach((line, index) => {
      if (/^\s*(#|\/\/)/.test(line)) return;
      if (/^\s*include\s/.test(line)) this.errors.push(`Line ${index + 1}: "include" is not supported by the browser parser.`);
      if (line.includes("${")) this.errors.push(`Line ${index + 1}: "\${...}" substitution is not supported. Use commondefs.replacement_strings.`);
    });
  }

  checkManifest(manifest, networkName, frontMan, config) {
    const entry = (manifest.networks || []).find(n => n.name === networkName);
    if (!entry) {
      this.errors.push(`Manifest: no networks[] entry named "${networkName}". Callers resolve <site base>/${networkName} by this exact name.`);
      return;
    }
    if (entry.hocon !== `./${networkName}.network.json`) this.errors.push(`Manifest: hocon is "${entry.hocon}", expected "./${networkName}.network.json".`);
    if (frontMan && entry.front_man !== frontMan) this.errors.push(`Manifest: front_man is "${entry.front_man}", but the front agent is "${frontMan}".`);
    if (JSON.stringify(entry.sample_queries || []) !== JSON.stringify(config.metadata?.sample_queries || [])) {
      this.errors.push("Manifest: sample_queries differ from metadata.sample_queries in the HOCON.");
    }
    if (Object.hasOwn(manifest, "actions")) {
      this.errors.push("Manifest: a portable network must not declare \"actions\". A caller's runtime would try to open a cross-site action bridge for them, which a static site cannot serve. Publish the site's own assistant from a separate manifest.");
    }
    if (manifest.deployment?.mode !== "static") this.errors.push("Manifest: deployment.mode must be \"static\".");
    if (!(manifest.linking?.exports || []).some(e => e.network === networkName)) {
      this.warnings.push(`Manifest: linking.exports has no entry for "${networkName}", so discovery tools will not list it.`);
    }
  }

  checkAgents(config, frontMan) {
    const networkModel = String(config.llm_config?.model_name || "").trim();
    for (const agent of config.tools || []) {
      const name = agent.name || "(unnamed)";
      if (agent.toolbox) this.errors.push(`${name}: toolbox tools need a server and cannot run in a caller's browser.`);
      if (agent.class) continue;
      const instructions = typeof agent.instructions === "string" ? agent.instructions : "";
      if (!instructions.trim()) this.errors.push(`${name}: an LLM agent needs instructions.`);
      const model = String(agent.llm_config?.model_name || "").trim() || networkModel;
      if (!model || model === "mock-1") this.errors.push(`${name}: no model is named. Set llm_config.model_name.`);
      const placeholder = instructions.match(/\{[A-Za-z0-9_]+\}/);
      if (placeholder) this.errors.push(`${name}: placeholder ${placeholder[0]} is not defined in commondefs.replacement_strings.`);
      const website = instructions.match(/website_[A-Za-z]\w*/);
      if (website) this.errors.push(`${name}: mentions ${website[0]}, but a portable network has no website actions.`);
      if (instructions.length > MAX_INSTRUCTIONS) {
        this.warnings.push(`${name}: instructions are ${instructions.length} characters after expansion (budget ${MAX_INSTRUCTIONS}).`);
      }
      if (!String(agent.function?.description || "").trim()) this.errors.push(`${name}: function.description is required.`);
      this.summary.push(`${name}${name === frontMan ? " (front)" : ""}: ${instructions.length} instruction chars; tools: [${(agent.tools || []).join(", ")}]`);
    }
  }

  /** Check coded tools against the bundle and the declared private fields. Returns the bundle text or null. */
  async checkCodedTools(manifest, config, dir) {
    const coded = (config.tools || []).filter(agent => agent.class);
    const declared = manifest.coded_tools?.bundle;
    if (!coded.length) {
      if (declared) this.warnings.push("Manifest: coded_tools.bundle is declared, but no tool has a class.");
      return null;
    }
    if (!declared) {
      this.errors.push("Manifest: coded tools need coded_tools.bundle.");
      return null;
    }
    const file = path.join(dir, declared);
    let bundle;
    try {
      bundle = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    } catch {
      this.errors.push(`Bundle ${declared} does not exist.`);
      return null;
    }
    if (DYNAMIC_IMPORT.test(bundle) || STATIC_IMPORT.test(bundle)) {
      this.errors.push(`Bundle ${declared} loads other modules. Callers' sandboxes refuse bundles that are not self-contained.`);
    }
    const reads = new Set(manifest.private_context?.reads || []);
    for (const tool of coded) {
      const leaf = String(tool.class).split(".").pop();
      if (!new RegExp(`export\\s+class\\s+${leaf}\\b`).test(bundle)) this.errors.push(`${tool.name}: class ${leaf} is not exported by ${declared}.`);
      const allowed = tool.allow?.to_downstream?.sly_data;
      if (!Array.isArray(allowed)) {
        this.errors.push(`${tool.name}: add allow.to_downstream.sly_data, listing the private fields it reads ([] for none). Without it the tool gets none.`);
        continue;
      }
      if (allowed.includes("*")) this.errors.push(`${tool.name}: "*" passes every private field. Name each field.`);
      for (const field of allowed) {
        if (!reads.has(field)) this.errors.push(`${tool.name}: reads "${field}", which manifest private_context.reads does not declare.`);
      }
      this.summary.push(`${tool.name}: coded tool ${leaf}; private fields it may read: [${allowed.join(", ")}]`);
    }
    return bundle;
  }

  async compareOutputs() {
    for (const [file, text] of this.outputs) {
      let current = null;
      try {
        current = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
      } catch {
        this.errors.push(`${file} does not exist. Build without --check.`);
        continue;
      }
      if (current !== text) this.errors.push(`${file} is out of date. Build without --check.`);
    }
  }

  async writeOutputs() {
    for (const [file, text] of this.outputs) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  }

  report(networkName) {
    console.log(`Portable network: ${networkName}`);
    for (const line of this.summary) console.log(`  - ${line}`);
    for (const warning of this.warnings) console.log(`WARNING: ${warning}`);
    for (const error of this.errors) console.log(`ERROR: ${error}`);
    if (this.errors.length) {
      console.log(`FAILED with ${this.errors.length} error(s).`);
      return 1;
    }
    console.log(this.options.check ? "OK: up to date." : "OK: wrote these files:");
    if (!this.options.check) for (const file of this.outputs.keys()) console.log(`  - ${file}`);
    return 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await new PortableNetworkBuilder(PortableNetworkBuilder.parseArgs(process.argv.slice(2))).run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

# MyZenn Open Sanctuary

An entry for the Open Agentic Web Challenge. It has three parts, all static files that
run agent networks in the visitor's browser, on the visitor's own LLM key:
**MyZenn Open Sanctuary** is an entry for the **Open Agentic Web Challenge** (conforming to the Worldwide Agentic Web MVP Profile 0.2). It brings MyZenn's wellbeing companion (**MyPal**) and self-help exercises (**MySanctuary**) to the open agentic web as static files that run entirely in the visitor's browser, on the visitor's own LLM key, with zero server-side conversation storage.

| Part | Where | What it is |
| --- | --- | --- |
| MyZenn Open Sanctuary | `sites/myzenn/` | MyZenn's agentic website. MyPal listens, helps the visitor name a feeling, and starts a breathing, grounding or focus exercise on the page, after the visitor presses Start. |
| MyZenn calm companion | `sites/myzenn/agents/` | A portable network that any agentic website can load from `<MyZenn site>/agents/myzenn_calm`. It returns one short self-help technique, or the right helplines when someone may be in danger. |
| Exam Week Planner | `sites/partner/` | A fictional partner site with its own planner agent. When a student is stressed, it asks first, then loads MyZenn's calm companion into the student's browser. A panel shows what crossed between the two sites. |
Wellbeing conversations are among the most sensitive text people type online, and stress spikes usually happen *while someone is inside another tool* (like a study planner or workspace), not while browsing a meditation app. Open Sanctuary demonstrates how the open agentic web solves both problems: any agentic website can load MyZenn's portable network by URL, execute it locally inside the visitor's tab on the visitor's chosen LLM router, enforce strict user consent before any cross-origin fetch, and keep private context isolated by default.

The design and the reasons behind it are in [docs/design.md](docs/design.md).
Full design rationale and architectural decisions are documented in [`docs/design.md`](docs/design.md).

## Run it
---

Needs Node.js 22 or newer. Nothing to install.
## System Overview

The repository contains three distinct parts that work together across two origins:

| Part | Location | Origin / URL | Description |
| :--- | :--- | :--- | :--- |
| **1. MyZenn Open Sanctuary** | `sites/myzenn/` | `http://127.0.0.1:8741` | MyZenn's agentic website (`myzenn_sanctuary` network). **MyPal** (`mypal`) listens, helps visitors name what they feel, consults a specialist (`sanctuary_guide`) across MyZenn's 18-tool catalog, and proposes interactive exercises directly in the page. |
| **2. MyZenn Calm Companion** | `sites/myzenn/agents/` | `http://127.0.0.1:8741/agents/myzenn_calm` | A **portable agent network** (`myzenn_calm`) that any third-party agentic website can load. Combines `calm_companion`, `technique_library`, and a sandboxed coded tool (`support_lines`) verified by `sha384` Subresource Integrity (SRI). |
| **3. Exam Week Planner** | `sites/partner/` | `http://127.0.0.1:8742` | A fictional partner site (`exam_planner` network) with its own revision schedule and `study_planner` agent. When a student is overwhelmed, it asks for consent, loads `myzenn_calm` cross-origin into the student's browser, and shows a live **"What crossed to MyZenn"** privacy inspector. |

---

## Architecture & Agent Networks

```text
+-------------------------------------------------------------------------+
| Origin 1: MyZenn Open Sanctuary (http://127.0.0.1:8741)                 |
|                                                                         |
|  Root Site (/agent-manifest.json -> myzenn_sanctuary)                   |
|   ├── mypal (front agent) ──> website_* actions (in-page proposals)     |
|   │     └── sanctuary_guide (specialist over 18 MySanctuary tools)      |
|   └── In-page exercises: MyBreath, MySenses, MyWheel, MyAnchor, MySafe  |
|                                                                         |
|  Portable Export (/agents/agent-manifest.json -> myzenn_calm)           |
|   └── calm_companion (front agent, no website_* actions)                |
|         ├── technique_library (specialist: breathing, grounding, etc.)  |
|         └── support_lines (SupportLines coded tool in myzenn_calm.tools.js)
+-------------------------------------------------------------------------+
                                    ▲
                                    │ Cross-origin GET (/agents/*)
                                    │ • Only after explicit visitor consent
                                    │ • No API key ever sent to Origin 1
                                    │ • Bundle verified via sha384 SRI
                                    │ • sly_data filtered to ["country"] only
                                    │
+-------------------------------------------------------------------------+
| Origin 2: Exam Week Planner (http://127.0.0.1:8742)                     |
|                                                                         |
|  Partner Site (/agent-manifest.json -> exam_planner)                    |
|   ├── study_planner (front agent) ──> website_* actions (week schedule) |
|   │     └── link slot: "myzenn_calm" (bound via links.json)             |
|   ├── Private student profile (name, email, school, mock_scores)        |
|   │     └── allow.to_downstream.sly_data: ["country"] (opt-in toggle)   |
|   └── "What crossed to MyZenn" live cross-origin & privacy inspector    |
+-------------------------------------------------------------------------+
```

### 1. On-Site Network: `myzenn_sanctuary` (`sites/myzenn/`)

Published at the root of Origin 1 (`sites/myzenn/agent-manifest.json`), this network powers the MyZenn Open Sanctuary web application:

- **Agents**:
  - `mypal` (front agent): Listens empathetically, helps visitors articulate emotions without diagnosing or making clinical claims, and proposes in-page exercises or opens crisis support.
  - `sanctuary_guide` (internal specialist): Reads the full 18-tool MySanctuary catalog via `website_get_sanctuary_catalog` and recommends the best-fitting tool with a clear rationale.
- **Interactive In-Page Exercises** (usable with or without an LLM key):
  - **MyBreath**: Box-breathing pacer with configurable side duration (`3–6` seconds) and rounds (`2–8`).
  - **MySenses**: Interactive `5-4-3-2-1` sensory grounding stepper.
  - **MyWheel**: Multi-tiered emotion wheel (ported from MyZenn's emotion taxonomy) to help name feelings from core to nuanced states.
  - **MyAnchor**: Single-task intention setter and focus timer (`5–50` minutes).
  - **MySafe**: Always-accessible crisis helpline and safety resource drawer.
- **Site Actions (`sites/myzenn/site-actions.js`)**:
  - **Read actions**: `get_sanctuary_state` (active exercise, progress, last emotion chosen), `get_sanctuary_catalog` (all 18 MySanctuary tools with wellness-only copy and links to `myzenn.com`), `get_support_resources` (verified emergency and helpline directory).
  - **Write actions (with visitor consent cards)**: `start_breathing`, `start_grounding`, `open_emotion_wheel`, `start_focus_anchor`. Rather than mutating the page silently, each write action renders an in-page proposal card (e.g., *"MyPal suggests: Box breathing · 4 rounds · 4 s — Start / Not now"*) and executes only when the visitor clicks **Start**.
  - **Immediate safety action**: `show_support` opens the **MySafe** crisis resource panel immediately without gating behind a confirmation click.

### 2. Portable Network: `myzenn_calm` (`sites/myzenn/agents/`)

Published under `/agents/` with its own standalone manifest (`sites/myzenn/agents/agent-manifest.json`) and **no `actions` block**.

> **Why a separate `/agents/` manifest?** When a peer manifest declares website `actions`, a caller's browser runtime attempts to open a cross-site action bridge, which a static host cannot serve. Exporting `myzenn_calm` from `/agents/agent-manifest.json` without `actions` makes the network cleanly callable by any static or dynamic agentic website on the web.

- **`calm_companion` (front agent)**: Returns warm, grounded, plain-text self-help guidance and links to the corresponding interactive exercise on `myzenn.com`.
- **`technique_library` (specialist agent)**: Holds structured, wellness-reviewed scripts for box breathing, `5-4-3-2-1` grounding, body scan, naming a feeling, and taking one small step.
- **`support_lines` (`SupportLines` coded tool in `myzenn_calm.tools.js`)**:
  - Generated at build time from `sites/myzenn/data/support.js` so the model can never hallucinate helpline numbers.
  - Runs inside the caller's isolated Web Worker sandbox (`runtime/sandbox-worker.js`) with **no network access (`connect-src 'none'`) and no DOM access**.
  - Protected by a **`sha384` Subresource Integrity (SRI)** digest in `coded_tools.integrity`; if the bundle bytes change after publishing, the calling runtime refuses to execute it.
  - Reads at most one `sly_data` private context field—`country` (declared in `private_context.reads: ["country"]`)—when the caller's allow rule permits it, returning country-specific emergency numbers and helplines (or all countries' lines if `country` is not shared).

### 3. Partner Demo Site: Exam Week Planner (`sites/partner/`)

Published on Origin 2 (`sites/partner/agent-manifest.json`), the planner represents a third-party student productivity app:

- **Agent & Actions (`exam_planner` / `study_planner`)**:
  - Reads the student's revision timetable (`get_week_plan`) and proposes schedule updates (`add_block`, `move_block`, `mark_block_done`).
  - Validates domain rules before showing any proposal (rejects past slots, time overlaps, moving fixed exams, or blocks outside `07:00–22:00`).
  - Previews proposed schedule changes directly on the timetable with **Accept / Not now** buttons.
- **Cross-Origin Composition via Link Slot**:
  - The HOCON network declares `myzenn_calm` as a tool on `study_planner`.
  - `sites/partner/links.json` binds `"myzenn_calm"` to `"http://127.0.0.1:8741/agents/myzenn_calm"`, and `allowed_peers` explicitly allowlists `"http://127.0.0.1:8741"`.
- **Private Context (`sly_data`) Isolation**:
  - The page holds a private student profile (`student_name`, `email`, `school`, `mock_scores`, and an opt-in `country` checkbox).
  - The planner's schedule tool strips personal profile fields so they never enter LLM prompts, and `study_planner` sets `allow.to_downstream.sly_data = ["country"]`.
  - Even if the student has a full profile loaded, `student_name`, `email`, `school`, and `mock_scores` can never cross to MyZenn.
- **"What crossed to MyZenn" Inspector (`sites/partner/inspector.js`)**:
  - Provides live transparency after every cross-site turn: displays the exact request text sent to `myzenn_calm`, which private fields were shared vs. kept local, every HTTP request made to MyZenn's origin (confirming `Authorization` was **never** attached), and which peer agents executed locally on the caller's router.

---

## Safety & Privacy Architecture

1. **Deterministic Pre-LLM Safety Net (`safety-net.js`)**:
   - Both sites run `safety-net.js` (`vendor/myzenn-safety-net.js` on the partner site) to screen visitor messages against a reviewed crisis phrase list *before* any network or LLM call is made.
   - If a crisis phrase is detected, the **MySafe** crisis resource panel opens immediately on screen—even if no API key is configured, the router is offline, or the model fails.
2. **Two-Layer Crisis Protocol**:
   - In addition to the deterministic pre-screen, agent instructions enforce a model-level safety rule: if a message suggests self-harm or immediate danger, `mypal` calls `website_show_support` + `website_get_support_resources`, and `calm_companion` invokes the deterministic `support_lines` coded tool.
3. **Consent Before Every Cross-Origin Contact & Write**:
   - Contacting `myzenn_calm` from the planner requires explicit approval via a consent dialog showing the peer origin, the outgoing message, the private fields that will cross (`country` or none), and the private fields kept local. Declining sends zero requests to MyZenn.
   - Every page-mutating action on both sites (`start_breathing`, `add_block`, `move_block`, etc.) requires an explicit click from the visitor before state changes.
4. **BYOK & Router Isolation**:
   - Visitors bring their own key for any CORS-enabled OpenAI-compatible router (defaults to hosted Otari, `https://api.otari.ai/api/v1` with `alibaba/qwen-3.5-35b-a3b`).
   - When the planner loads `myzenn_calm`, MyZenn's agents execute inside the planner's browser tab using the **planner visitor's router and key**. MyZenn's manifest cannot override the caller's router, and the visitor's API key is never transmitted to MyZenn's origin.

---

## Getting Started

### Prerequisites

- **Node.js 22 or newer** (`node --version`).
- Zero external `npm` dependencies are required—everything runs out of the box using standard Node.js APIs and the vendored browser runtime.

### Running Locally

Start both static servers on separate ports (so the browser enforces real cross-origin isolation):

```shell
npm run serve      # MyZenn on http://127.0.0.1:8741, the planner on http://127.0.0.1:8742
npm run serve
```

The pages and their exercises work without a key. To talk to the agents, open
**AI provider settings** under the chat and enter a key for a router that allows browser
calls (the default is hosted Otari). On `127.0.0.1` the runtime also keeps saved setups
in a cookie that any local site can read, so use a key with a low spending limit, and
delete the saved setup when you are done.
This launches:
- **MyZenn Open Sanctuary**: `http://127.0.0.1:8741`
- **Exam Week Planner (demo partner)**: `http://127.0.0.1:8742`

## Build and test
To use custom ports:

```shell
npm run build      # write generated files: network JSON, discovery files, tool bundle and its SRI digest
npm run check      # the same checks, writing nothing; fails when anything is out of date
npm test           # Node tests: both sites, and every spec section 6 check across two origins
node tools/serve.mjs 9001 9002
```

`npm test` uses the real runtime with scripted models, so it calls no provider. The
cross-origin suite (`tests/cross-origin.test.mjs`) loads MyZenn's network into the
planner's engine and checks: consent before any contact, exact network names, that the
key never reaches MyZenn, that MyZenn cannot change the router, that only the allowed
private field crosses, the tool bundle's integrity check, and that a denied origin, an
invalid network, a cycle and an over-budget request each stop with a visible error.
### Configuring an AI Provider Key (Optional for UI, Required for Live Chat)

A real-browser check, with no key:
- All in-page exercises on MyZenn (`MyBreath`, `MySenses`, `MyWheel`, `MyAnchor`, `MySafe`) and manual controls on the Exam Week Planner work immediately **without an API key**.
- To chat with the agents, click **AI provider settings** below the chat composer and enter an API key for a CORS-enabled OpenAI-compatible router (the default is hosted Otari at `https://api.otari.ai/api/v1`).
- **Localhost security note**: On `127.0.0.1`, browsers scope cookies by host rather than port, meaning saved provider setups in cookies are readable by any local site on `127.0.0.1`. Use a key with a low spending limit and click **Delete saved setup** when finished.

---

## Build, Verification & Testing

### Build & Integrity Check

```shell
npm run build      # Generate tool bundle, compile HOCON networks, update SRI digests, verify runtime copies
npm run check      # Dry-run verification (writes nothing; exits non-zero if any generated file is out of date)
```

What `tools/build.mjs` does in sequence:
1. **Generates `sites/myzenn/agents/myzenn_calm.tools.js`** from `sites/myzenn/data/support.js` so the portable network's coded tool always carries the exact same helpline data as the main site.
2. **Builds the portable network (`tools/portable-network.mjs`)**: Parses `myzenn_calm.hocon` with the browser runtime's own parser, validates agent definitions and `private_context.reads`, checks that `myzenn_calm.tools.js` is self-contained (no static or dynamic `import`), writes `myzenn_calm.network.json`, and updates the `sha384` SRI digest in `sites/myzenn/agents/agent-manifest.json`.
3. **Builds both site assistants**: Runs `vendor/agentify-website/scripts/build_network.mjs` on `sites/myzenn/myzenn_sanctuary.hocon` and `sites/partner/exam_planner.hocon`.
4. **Verifies runtime integrity**: Confirms that `sites/myzenn/runtime/` and `sites/partner/runtime/` match `vendor/agentify-website/runtime/` byte-for-byte (32 files each).

### Automated Node Test Suite

```shell
npm test
```

Runs three test suites using Node's built-in test runner (`node --test`) and the real browser runtime engine with deterministic scripted models (no live LLM calls or API keys needed):

1. **`sites/myzenn/tests/sanctuary.test.mjs`**:
   - Validates `myzenn_sanctuary` network topology (`mypal` -> `sanctuary_guide`), manifest alignment, and care rules in expanded instructions.
   - Verifies the 18-tool catalog (unique IDs, `myzenn.com` URLs, absence of medical/clinical claims) and helpline data integrity.
   - Tests all `website_*` read and write actions, visitor confirmation proposals, declines, schema boundary rejections, emotion wheel path validation, and deterministic `SafetyNet` crisis screening.
2. **`sites/partner/tests/planner.test.mjs`**:
   - Validates `exam_planner` network, `links.json` binding to `http://127.0.0.1:8741/agents/myzenn_calm`, and `allow.to_downstream.sly_data: ["country"]`.
   - Verifies that building the tool table makes zero network requests to MyZenn prior to consent.
   - Tests schedule reads (confirming private student profile fields are excluded), `add_block` / `move_block` / `mark_block_done` proposal flows, and slot validation edge cases.
3. **`tests/cross-origin.test.mjs`**:
   - Executes end-to-end cross-origin runs through the real `Engine`, `TraceBus`, and `ToolSandbox` over a simulated multi-origin web (`FakeWeb`) that enforces CORS headers.

### Real Headless Browser Check (No API Key Needed)

To run a full end-to-end verification in real headless Chrome (testing real Web Workers, CSP headers, DOM proposals, cross-origin fetches, and screenshot capture):

```shell
# Terminal 1: start both sites (:8741 and :8742)
npm run serve
node tests/fake-router.mjs                 # a scripted, OpenAI-compatible router on :8749 (tests only)
node tests/browser-check.mjs out/          # headless Chrome, throwaway profile; screenshots in out/

# Terminal 2: start the local scripted OpenAI-compatible router (:8749)
node tests/fake-router.mjs

# Terminal 3: run headless Chrome checks and save screenshots to out/
node tests/browser-check.mjs out/
```

## Layout
If Chrome is installed in a non-default location, set `CHROME_PATH=/path/to/chrome`.

---

## Spec Section 6 Interoperability Matrix

Every check from Section 6 of the Worldwide Agentic Web MVP Spec is demonstrated and tested:

| Spec §6 Check | How It Is Implemented | Verified By |
| :--- | :--- | :--- |
| **Two-agent network + manifest on HTTPS/HTTP** | `myzenn_sanctuary` (`mypal` + `sanctuary_guide`) and `myzenn_calm` (`calm_companion` + `technique_library` + `support_lines` coded tool). | `npm run check`, `sanctuary.test.mjs` |
| **Default router + BYOK path** | Hosted Otari (`https://api.otari.ai/api/v1`) configured as default; in-page provider settings panel supports any CORS-enabled OpenAI-compatible router + key. | `browser-check.mjs`, `cross-origin.test.mjs` |
| **Internal specialist + grounded website capability** | `mypal` consults `sanctuary_guide` and invokes `website_*` actions; `study_planner` invokes timetable `website_*` actions. | `sanctuary.test.mjs`, `planner.test.mjs` |
| **Consent before cross-origin contact & exact network resolution** | Planner prompts visitor before any fetch to `:8741`, then resolves `/agents/agent-manifest.json` -> `/agents/myzenn_calm.network.json`. Near-miss network names fail closed. | `cross-origin.test.mjs` (`peerRequestsBefore === 0`) |
| **Peer never receives API key & cannot override router** | Requests to `:8741` never carry an `Authorization` header; `llm_router` in peer manifest is ignored in favor of caller's router. | `cross-origin.test.mjs`, "What crossed to MyZenn" panel |
| **Private context (`sly_data`) blocked by default** | Only `country` is listed in `allow.to_downstream.sly_data` and `private_context.reads`; name, email, school, and mock scores never cross; trace logs redact allowed values. | `cross-origin.test.mjs`, `planner.test.mjs` |
| **Sandboxed coded tool with SRI verification** | `myzenn_calm.tools.js` is verified against `sha384` SRI before running in a locked-down Web Worker (`connect-src 'none'`). Modified bundles are rejected. | `cross-origin.test.mjs`, `browser-check.mjs` |
| **Denied origin, invalid network, cycle, and over-budget stop visibly** | Unlisted peer origins, broken agent references, A->B->A call cycles, and >4 remote calls per query halt cleanly with explicit error messages. | `cross-origin.test.mjs` |

---

## Repository Layout

```text
sites/myzenn/            MyZenn's site: page, exercises, safety net, MyPal's network
  agents/                the portable myzenn_calm network (manifest, network, coded tool)
  runtime/               the challenge's browser runtime, copied unchanged
sites/partner/           the fictional planner: page, planner agent, inspector
tools/build.mjs          builds and checks everything; tools/portable-network.mjs builds portable networks
tools/serve.mjs          local server for both sites, with the CORS and CSP headers production needs
tests/                   cross-origin tests, fake router, browser check
vendor/agentify-website/ the challenge's agentify-website skill and runtime, unchanged (Apache-2.0)
docs/design.md           design notes
myzenn-open-sanctuary/
├── docs/
│   └── design.md                        # Full product, architecture, and safety design doc
├── sites/
│   ├── myzenn/                          # Origin 1: MyZenn Open Sanctuary (:8741)
│   │   ├── index.html, styles.css       # Sanctuary UI, exercises stage, MyPal chat, MySafe drawer
│   │   ├── app.js, site.js              # Runtime bootstrap, BYOK settings, trace & UI wiring
│   │   ├── sanctuary.js, stage-view.js  # In-page exercises (MyBreath, MySenses, MyWheel, MyAnchor)
│   │   ├── site-actions.js              # Registered website_* read/write actions
│   │   ├── safety-net.js                # Deterministic pre-LLM crisis phrase screen
│   │   ├── data/                        # Catalog (18 tools), emotion wheel taxonomy, helplines
│   │   ├── myzenn_sanctuary.hocon       # Source HOCON for on-site agent network
│   │   ├── myzenn_sanctuary.network.json# Compiled on-site agent network
│   │   ├── agent-manifest.json          # Root site manifest (with website actions)
│   │   ├── agents/                      # Portable network export (/agents/myzenn_calm)
│   │   │   ├── agent-manifest.json      # Portable manifest (no website actions, has sha384 SRI)
│   │   │   ├── myzenn_calm.hocon        # Source HOCON for portable calm companion
│   │   │   ├── myzenn_calm.network.json # Compiled portable network
│   │   │   └── myzenn_calm.tools.js     # Generated self-contained coded tool (SupportLines)
│   │   ├── runtime/                     # Unchanged copy of vendored browser runtime
│   │   └── tests/                       # On-site network, action, and safety unit/integration tests
│   └── partner/                         # Origin 2: Exam Week Planner demo partner (:8742)
│       ├── index.html, styles.css       # Revision planner UI, student profile toggle, chat
│       ├── app.js, planner.js           # Timetable logic, slot validation, proposal cards
│       ├── week-view.js, context.js     # Schedule view and private StudentContext manager
│       ├── inspector.js                 # "What crossed to MyZenn" live cross-origin privacy panel
│       ├── site-actions.js              # Registered website_* timetable actions
│       ├── exam_planner.hocon           # Source HOCON with myzenn_calm link slot & sly_data rules
│       ├── exam_planner.network.json    # Compiled planner network
│       ├── agent-manifest.json          # Partner manifest (allowed_peers: ["http://127.0.0.1:8741"])
│       ├── links.json                   # Binds myzenn_calm -> http://127.0.0.1:8741/agents/myzenn_calm
│       ├── vendor/myzenn-safety-net.js  # Reusable copy of MyZenn's deterministic safety screen
│       ├── runtime/                     # Unchanged copy of vendored browser runtime
│       └── tests/                       # Partner network, timetable, and privacy tests
├── tools/
│   ├── build.mjs                        # Master build & verification script (--check supported)
│   ├── portable-network.mjs             # Reusable builder/validator for portable agent networks
│   └── serve.mjs                        # Dual-origin local server with production CORS & CSP headers
├── tests/
│   ├── cross-origin.test.mjs            # Full Spec §6 cross-origin interoperability test suite
│   ├── fake-router.mjs                  # Scripted OpenAI-compatible SSE router for local browser tests
│   ├── browser-check.mjs                # Headless Chrome DevTools end-to-end runner & screenshotter
│   ├── http-to-file-hooks.mjs           # Node module loader hook mapping local HTTP origins to disk
│   └── scripted_model.mjs               # Deterministic LLM stub for unit tests
└── vendor/
    └── agentify-website/                # Challenge runtime and build scripts, unchanged (Apache-2.0)
```

`reference/` holds MyZenn source copied for porting. It is git-ignored and never published.
*(Note: `reference/` holds private MyZenn source files used for porting; it is git-ignored and never published.)*

## Limits
---

- MyPal and the planner are self-help and planning tools. They do not diagnose or treat
  anything, and they are not crisis services.
- Helpline numbers in `sites/myzenn/data/support.js` must be checked against each
  service's official site before launch (`CHECKED_ON` is still empty).
- The runtime runs `write` actions without asking. Both sites show each write to the
  visitor first and act only on their click; MyZenn's support panel is the one exception.
- A network another site loads returns text only; its on-screen widgets are not shown
  on the calling site.
## Reusable Tools for Other Builders

Beyond the two demo sites, this repository ships standalone utilities that other Open Agentic Web builders can adopt directly:

1. **Portable Network Builder (`tools/portable-network.mjs`)**:
   - Compiles and validates networks meant to be loaded cross-origin under `/agents/` (enforcing no `actions` block, checking coded tool self-containment, verifying `private_context.reads` against `allow.to_downstream.sly_data`, and writing `sha384` SRI digests).
   - Usage:
     ```shell
     node tools/portable-network.mjs <dir>/<network>.hocon --manifest <dir>/agent-manifest.json [--check]
     ```
2. **Production CORS & Sandbox CSP Reference (`tools/serve.mjs`)**:
   - Shows the exact HTTP headers required in production: `Access-Control-Allow-Origin: *` scoped strictly to public agent artifacts (`/agents/*`, `/.well-known/*`, `agent-manifest.json`, `links.json`, `*.network.json`), and `Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'` on `runtime/sandbox-worker.js`.
3. **Deterministic Wellbeing Safety Net (`sites/myzenn/safety-net.js`)**:
   - Zero-dependency module that any agentic website can drop in to pre-screen user input for crisis indicators and display emergency resources without relying on LLM latency or availability.

---

## Limitations & Disclaimers

- **Not a medical or crisis service**: MyPal, the calm companion, and the Exam Week Planner are self-help and planning tools. They do not diagnose, treat, or prevent any medical or mental-health condition.
- **Helpline verification before launch**: Helpline numbers in `sites/myzenn/data/support.js` must be re-verified against each service's official website prior to public deployment (`CHECKED_ON` is intentionally left blank until pre-launch verification).
- **Write-action confirmation**: The underlying browser runtime executes `write` actions without an automatic prompt; both sites implement explicit in-page proposal cards so no exercise starts and no timetable block changes until the visitor clicks to accept (`show_support` is the sole exception so crisis help is never gated).
- **Text-only cross-site return values**: When a partner site loads `myzenn_calm`, the portable network returns structured text steps and links; MyZenn's interactive on-page widgets (`MyBreath`, `MySenses`, etc.) run on MyZenn's own site rather than rendering inside the partner's DOM.

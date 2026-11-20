# MyZenn Open Sanctuary — Design

Status: working design, 13 Nov 2026. Entry for the Open Agentic Web Challenge (deadline
11 Jan 2027, 08:00 PT). Items marked **(call)** are builder decisions open to change.

## 1. Intent

MyZenn is a live mental-wellness product (myzenn.com) with four modules: MyGuru
(assessment), MyPal (AI companion), MySanctuary (18 self-help tools) and MySafe
(escalation to human help). Today all of it lives inside one app, on one company's
servers.

Open Sanctuary puts MyZenn's companion and its calming tools on the open agentic web in
two ways:

1. **On MyZenn's own site.** MyPal listens, helps the visitor name what they feel, and
   starts the right MySanctuary tool *in the page* (breathing, grounding, emotion wheel,
   focus anchor). The agent drives the page; it is not only a chat box.
2. **On anyone else's site.** MyZenn publishes a portable "calm" agent network that any
   agentic website can load. A study planner, a workplace tool or a job board can hand a
   stressed user to MyZenn's network, which then runs **in that user's browser, on that
   user's own LLM key**, and never sees the partner's private data.

Why the open agentic web fits this problem: wellbeing conversations are the most
sensitive data people type. In this architecture the conversation never touches
MyZenn's or the partner's servers, the user picks the model provider, private context is
blocked by default between sites, and every cross-site contact needs the user's consent.
The project shows those rules doing real work, not just being checked off.

## 2. Audience and problem

- **Primary:** students in exam season (MyZenn's home market is India, where exam stress
  is widely reported) and young professionals who hit a stress spike *while using some
  other tool* — not while browsing a wellness app.
- **Problem:** help arrives in the wrong place. A stressed student is in their planner,
  not in a meditation app. Every site that wants to offer support today must build (and
  safely run) its own wellbeing bot, or skip it.
- **What Open Sanctuary changes:** a site adds one URL to its agent network and gets
  MyZenn's grounded, safety-reviewed support, with no integration code, no data sharing
  contract and no inference bill.

## 3. Goals, non-goals, anti-goals

Goals
- Pass Stage 1 (spec conformance) with margin: every §6 interoperability check
  demonstrated in the browser.
- A complete product on both sites, not a proof of concept (Design criterion).
- A credible, specific impact story with a real company and audience (Impact).
- Ship reusable pieces for other builders (Impact, "tools shared with the community").

Non-goals
- No accounts, no server-side storage, no payments.
- No MyGuru clinical assessment (PHQ/GAD-style scoring) on the open site.
- No change to the live myzenn.com app or the company repo.

Anti-goals (a failure even if it "works")
- Any diagnosis, treatment or medical claim, or wording that implies one.
- Safety that depends on the model: crisis resources must appear even if the LLM is
  slow, wrong or absent.
- Fabricated facts (helplines, tool claims, outcomes).
- A partner's private data reaching MyZenn's network without an explicit allow rule.

## 4. Constraints

- Spec: MVP Profile 0.2 (`cognizant-ai-labs/agentic-web`, as of 11 Nov 2026). Rules say
  "conforms to the spec as of the start of the Submission Period".
- Runtime: the patched nsdeploy runtime from the challenge repo's `agentify-website`
  skill, vendored unchanged in `vendor/agentify-website` (commit `3c18918`).
- New work: fresh repo, first commit after 11 Nov 2026. MyZenn source is copied into
  `reference/` for porting and is git-ignored, so company code is never published.
- Two different origins are needed for the cross-site demo.
- Video under 2 minutes, narrated by the entrant, no third-party marks or music.

## 5. Approaches considered

| | What | Trade-off |
|---|---|---|
| A | Agent only on MyZenn's site | Simplest, strong Design, but skips cross-site, the spec's core |
| B | Only a network other sites load | Strongest Idea/Tech, but no product of its own to show |
| **C (picked)** | MyZenn site with its own agent **and** a portable network a partner site loads | Most work is shared; the video shows both halves |

## 6. Architecture

```
sites/myzenn/                         origin 1 (e.g. agents.myzenn.com)
  index.html, styles.css              MyZenn Open Sanctuary page
  sanctuary.js                        page object: tools, state, operations
  tools/*.js                          in-page tools ported from MyZenn
  safety-net.js                       deterministic crisis screen + MySafe panel
  site-actions.js                     wraps page operations as website_* tools
  site.js                             boots runtime, consent UI, dialogs
  myzenn_sanctuary.hocon/.network.json   on-site network
  agent-manifest.json, links.json     root manifest (with actions)
  agents/                             PORTABLE export, no page actions
    agent-manifest.json               lists myzenn_calm only
    myzenn_calm.hocon/.network.json
  runtime/                            vendored runtime, unchanged

sites/partner/                        origin 2 (demo partner, fictional)
  Exam Week Planner: planner page + its own network, which names
  "myzenn_calm"; links.json binds it to https://<origin 1>/agents/myzenn_calm
```

### 6.1 MyZenn site — `myzenn_sanctuary` network

- `mypal` (front agent): reflects feelings back, helps name them, picks and starts a
  tool, shows MySafe resources. Owns all `website_*` tools.
- `sanctuary_guide` (specialist, "separate knowledge" test): reads the 18-tool catalog
  through `website_get_sanctuary_catalog` and recommends a best fit with a reason.

In-page tools (vanilla JS ports): **MyBreath** (box-breathing pacer), **MySenses**
(5-4-3-2-1 grounding stepper), **MyWheel** (emotion picker from MyZenn's wheel data),
**MyAnchor** (intention + focus timer), **MySafe** (helplines, safety steps). The other
13 tools appear in a catalog that links to myzenn.com.

Site actions:

| Action | Effect | Notes |
|---|---|---|
| `get_sanctuary_state` | read | active tool, its progress, last emotion picked, version |
| `get_sanctuary_catalog` | read | 18 tools, wellness-only wording |
| `start_breathing` | write | count 3–6 s, rounds 2–8 |
| `start_grounding` | write | |
| `open_emotion_wheel` | write | optional core emotion to open at |
| `start_focus_anchor` | write | intention, 5–50 min |
| `stop_tool` | write | |
| `show_support` | write | opens MySafe panel; never blocked |

**Consent for writes (call).** The patched runtime runs `write` actions with no prompt,
but spec §3.1 asks for the destination and arguments to be shown first. Our write
handlers therefore open a small in-page card ("MyPal suggests: Box breathing · 4 rounds
· 4 s — Start / Not now") and act only on the visitor's click. `show_support` is the
exception: it opens immediately, because hiding help behind a click is the wrong
failure. In a wellness product, "the agent suggests, you choose" is also the right UX.

**Safety net (call).** `safety-net.js` screens each visitor message *before* it reaches
the model, using a reviewed phrase list. A match opens MySafe at once, with helplines,
whether or not a key is set. MyPal's instructions add a second, model-level layer.

### 6.2 Portable network — `myzenn_calm`

Published at `<origin 1>/agents/myzenn_calm`, with its own manifest and **no**
`actions` block. (The runtime tries to open a cross-site action bridge for any peer
manifest that has one, which a static site cannot serve; the challenge skill notes that
networks built with it "cannot be called by other agent sites yet". This layout is how
we make ours callable, and it is part of what we document for others.)

- `calm_companion` (front): short, warm, never diagnoses; picks one technique and
  returns its steps as text, plus a link to the full tool on myzenn.com. (A peer's
  widgets are not shown on the calling site, so the answer is plain text.)
- `technique_library` (specialist): holds the scripts for box breathing, 5-4-3-2-1,
  a body scan, naming the feeling and one small step, ported from MyZenn's exercise
  library and emotion wheel.
- `support_lines` (coded tool): a self-contained JS class that runs in the caller's
  sandboxed worker, with no network. It reads one private field, `country`, when the
  caller allows it, and returns that country's emergency number and helplines. The
  numbers come from `data/support.js` at build time, so the model cannot invent them.
  The manifest carries a sha384 SRI digest of the bundle, and callers refuse a bundle
  that changed. `private_context.reads` in the manifest tells callers which field to
  allow.
- Crisis protocol in instructions: call `support_lines`, return resources first, tell
  the caller to show them now.

### 6.3 Partner site — Exam Week Planner (demo, fictional) **(call)**

A small planner with its own network (`exam_planner`, front agent `study_planner`) and
its own look, so the two sites are clearly different: read the demo week, add or move
blocks, tick blocks off. Each change is shown on the plan (a dashed preview plus Add /
Not now) before it happens.

The planner names MyZenn by a link slot, `myzenn_calm`; its publisher-owned
`links.json` binds that name to `<MyZenn site>/agents/myzenn_calm`, so the network file
is the same locally and in production. When a student says "I can't focus, chemistry
is tomorrow", the planner's own consent card names MyZenn and its origin, the message
it will get, which private fields cross and which stay, and where it runs. After the
OK, the runtime loads MyZenn's network into the student's tab and runs it on the
student's key; the planner shows MyZenn's answer and suggests a 15-minute break.

Private context: the planner carries `student_name`, `email`, `school`, `mock_scores`
and, only when the student ticks "Let MyZenn see my country", `country`. Its front
agent's published allow rule passes `country` and nothing else. The "What crossed to
MyZenn" panel shows, per contact: the message sent, the private fields sent and kept,
every file the browser read from MyZenn's origin and whether a key was attached (from
a log of every `fetch` the page makes, never the header's value), and which of
MyZenn's agents ran in the tab, on which router.

The planner also uses MyZenn's safety net unchanged (`vendor/myzenn-safety-net.js`),
as any partner could.

### 6.4 Inference

Default router hosted Otari, model `alibaba/qwen-3.5-35b-a3b` (the challenge default),
plus BYOK for any CORS-enabled OpenAI-compatible router. The peer always inherits the
caller's router; the key is never sent to MyZenn's origin.

## 7. How we show each §6 interoperability check

| Spec check | Where it is shown | Automated test |
|---|---|---|
| Two-agent network + manifest on HTTPS | `myzenn_sanctuary` (2 agents), `myzenn_calm` (2 agents + coded tool) | build + `sites/*/tests` |
| Run with default router; BYOK path | Otari default; settings panel with another router | browser check (fake router) |
| Internal agent + grounded capability | `mypal` → `sanctuary_guide`; `website_*` actions | `sites/myzenn/tests` |
| Load exact named network from second origin after approval | Planner → `/agents/myzenn_calm`, consent card | `tests/cross-origin` |
| Peer never gets the key or changes the router | "What crossed to MyZenn" panel | `tests/cross-origin`, browser check |
| Private context absent unless allowed | Country toggle + allow rule; panel lists sent and kept fields | `tests/cross-origin` |
| Invalid network, cycle, over-budget, denied origin stop visibly | Planner's `/checks/` page runs each live (plus near-miss name and tampered bundle) on the runtime's mock model, no key | `tests/cross-origin`, browser check |

## 8. Safety and wording rules

- Port MyZenn tool copy with wellness-only wording: drop claims such as "lowers blood
  pressure", "prevents panic attacks", "strengthens immune system", "effective for
  clinical anxiety".
- Helplines come from MyZenn's MySafe list; every number is re-verified before launch.
- No storage of conversation content. Emotion picks and tool progress live in page
  memory only.
- Instructions forbid diagnosis, medication advice and promises of confidentiality the
  site cannot keep.

## 9. Milestones

| Dates | Milestone |
|---|---|
| 13–22 Nov | MyZenn site: page, 4 tools, safety net, on-site network, tests |
| 23 Nov–6 Dec | Portable network, partner site, cross-origin + `sly_data` demo |
| 7–20 Dec | Deploy both origins; community tools; registry listings |
| 21 Dec–8 Jan | Polish, user tests, video, Devpost write-up, screenshots |

## 10. Community deliverables (Impact) **(call)**

1. **How-to: making a network callable by other sites**: the `/agents/` export
   pattern, CORS headers, consent and `sly_data` rules (fills the "Connect to other agent
   networks — TODO" in the challenge README). `tools/portable-network.mjs` already builds
   and checks such a network, including coded tools and their SRI digest.
2. **Cross-origin conformance tests**: `tests/cross-origin.test.mjs` checks every
   section 6 cross-site rule through the real runtime with a fake web and router; it can
   be generalised to take any two site URLs.
3. **Conformance checker**: a CLI and a page that take a site URL and check manifest,
   network, links, CORS and the static parts of §6 (fills the README's "Testing — TODO").
4. **Wellbeing guard**: `safety-net.js` packaged so any agentic site can drop in a
   deterministic crisis screen and resource panel.

## 11. Open questions for the founder

1. Hosting and domain: `agents.myzenn.com` on Vercel for origin 1? Which origin for the
   partner?
2. Default inference for judges: judges may not have a key. A tiny rate-limited proxy
   funded with Otari credits would let anyone try it; it adds a server function.
3. Entrant: individual, or the company as an Organization (repo is under an org)?
4. Helpline list: keep MyZenn's India-first list, and add which international ones?

## 12. Left to the builder

Visual design within MyZenn's system (teal, DM Sans + Outfit, calm glass surfaces),
copy, exact instruction text, test cases, the spec-checks page layout, and the
checker's output format.

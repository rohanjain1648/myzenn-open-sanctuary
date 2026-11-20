// Registers the sanctuary's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". The names in
// "actions.agentTools" become model tools called website_<name>.
//
// Consent: the runtime runs "write" actions without a prompt, but the spec asks the
// runtime to show the visitor the destination and arguments before a write (section
// 3.1). So every write that starts a tool first shows the visitor a card on the page
// ("MyPal suggests box breathing, 4 rounds of 4 seconds. Start / Not now") and acts
// only on their click. show_support is the one deliberate exception: it only opens a
// panel of helplines, and hiding help behind a click is the wrong way to fail.
//
// Import the page object by the same URL the page uses, so both share one state.
import { App, BREATHING_LIMITS, ANCHOR_MINUTES } from "./sanctuary.js";
import { CORE_EMOTIONS } from "./data/emotions.js";

const NOT_NOW = "The visitor chose not to start it. Nothing changed.";

/**
 * Ask the visitor through the page, then run the operation only if they accept.
 *
 * :param tool: The tool to propose.
 * :param params: The checked arguments, shown on the card.
 * :param summary: The card's sentence, after "MyPal suggests".
 * :param run: Runs the operation once accepted.
 * :return: The operation's result, or {ok: false, reason} when declined.
 */
async function withConsent(tool, params, summary, run) {
  const answer = await App.page.propose(tool, params, summary);
  if (!answer.accepted) return { ok: false, declined: true, reason: answer.reason || NOT_NOW };
  return run();
}

function minutesText(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

export class SanctuaryActions {
  static registerActions(actions) {
    for (const definition of SanctuaryActions.definitions()) actions.register(definition);
  }

  static definitions() {
    return [
      {
        name: "get_sanctuary_state",
        description: "Read what is on the sanctuary page now: the running tool and its progress, a suggestion waiting for the visitor, the feeling they last named on MyWheel, whether the support panel is open, and tools they ended this visit.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => App.page.getState(),
      },
      {
        name: "get_sanctuary_catalog",
        description: "Read all 18 MySanctuary tools: name, category, duration, summary, what each is good for, a tip, whether it runs on this page, and its myzenn.com link.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => App.page.getCatalog(),
      },
      {
        name: "get_support_resources",
        description: "Read the verified emergency numbers and free helplines this site lists, by country, and a directory for other countries. Use only these contacts.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => App.page.getSupport(),
      },
      {
        name: "show_support",
        description: "Open the support panel with emergency numbers and helplines on the page at once, without asking. Use when the visitor may be in danger or asks to talk to a person.",
        effect: "write",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => App.page.openSupport({ source: "pal" }),
      },
      {
        name: "start_breathing",
        description: "Suggest MyBreath box breathing on the page: in, hold, out, hold, each for `seconds`. The visitor sees Start and Not now; it starts only if they press Start. Returns the new state, or ok false with a reason.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            seconds: { type: "integer", minimum: BREATHING_LIMITS.seconds[0], maximum: BREATHING_LIMITS.seconds[1], description: "Seconds per side. 4 by default; 3 if the visitor is very keyed up." },
            rounds: { type: "integer", minimum: BREATHING_LIMITS.rounds[0], maximum: BREATHING_LIMITS.rounds[1], description: "Rounds of the square. 4 by default." },
          },
        },
        execute: args => {
          const check = App.page.checkBreathing(args);
          if (!check.ok) return check;
          const { seconds, rounds } = check.params;
          return withConsent("breathing", check.params,
            `box breathing: ${rounds} rounds of ${seconds} seconds per side, ${minutesText(seconds * 4 * rounds)}.`,
            () => App.page.startBreathing(check.params, { source: "pal" }));
        },
      },
      {
        name: "start_grounding",
        description: "Suggest MySenses, the 5-4-3-2-1 grounding exercise, on the page. The visitor goes at their own pace. It starts only if they press Start.",
        effect: "write",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => withConsent("grounding", {},
          "the 5-4-3-2-1 grounding exercise, at your own pace, about 3 minutes.",
          () => App.page.startGrounding({ source: "pal" })),
      },
      {
        name: "open_emotion_wheel",
        description: "Suggest MyWheel on the page, to help the visitor name a feeling precisely. When they finish, the page sends their choice to you as a message. It opens only if they press Start.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            core: { type: "string", enum: CORE_EMOTIONS, description: "Start from this core feeling, only if the visitor already used this word." },
          },
        },
        execute: args => {
          const check = App.page.checkWheel(args);
          if (!check.ok) return check;
          const from = check.params.core ? `, starting from ${check.params.core.toLowerCase()}` : "";
          return withConsent("wheel", check.params,
            `naming the feeling with MyWheel${from}.`,
            () => App.page.openWheel(check.params, { source: "pal" }));
        },
      },
      {
        name: "start_focus_anchor",
        description: "Suggest MyAnchor on the page: one intention and a focus timer. It starts only if the visitor presses Start. Refuses an empty or long intention with a reason.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["intention"],
          properties: {
            intention: { type: "string", minLength: 1, maxLength: 120, description: "One small next step, in the visitor's words, such as: read chapter 4." },
            minutes: { type: "integer", enum: ANCHOR_MINUTES, description: "Minutes the visitor chose. 25 if they did not say." },
          },
        },
        execute: args => {
          const check = App.page.checkAnchor(args);
          if (!check.ok) return check;
          const { intention, minutes } = check.params;
          return withConsent("anchor", check.params,
            `MyAnchor: ${minutes} minutes on one thing, “${intention}”.`,
            () => App.page.startAnchor(check.params, { source: "pal" }));
        },
      },
    ];
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SanctuaryActions.registerActions;

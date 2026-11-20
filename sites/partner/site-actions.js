// Registers the planner's operations with the agent runtime. agent-manifest.json loads
// this module through "actions.module"; the names in "actions.agentTools" become model
// tools called website_<name>.
//
// Every write first shows the student a card on the plan ("The planner wants to add a
// break, Wednesday 15:45 to 16:00. Add it / Not now") and runs only on their click.
// The runtime runs "write" actions without asking, but spec section 3.1 asks that the
// user see the destination and arguments before a write.
//
// Import the page object by the same URL the page uses, so both share one state.
import { App, toMinutes, toTime } from "./planner.js";
import { DAYS, DAY_NAMES, BLOCK_MINUTES, SUBJECTS } from "./data/week.js";

/**
 * Ask the student through the page, then run the operation only if they accept.
 *
 * :return: The operation's result, or {ok: false, declined: true, reason}.
 */
async function withConsent(action, params, summary, run) {
  const answer = await App.page.propose(action, params, summary);
  if (!answer.accepted) return { ok: false, declined: true, reason: answer.reason };
  return run();
}

function when(day, start, minutes) {
  return `${DAY_NAMES[day]} ${start} to ${toTime(toMinutes(start) + minutes)}`;
}

export class PlannerActions {
  static registerActions(actions) {
    for (const definition of PlannerActions.definitions()) actions.register(definition);
  }

  static definitions() {
    return [
      {
        name: "get_week_plan",
        description: "Read this demo week's plan: the day and time now, each block (id, day, start, end, subject, title, done, over), the next block, the exams, and any change waiting for the student's answer.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => App.page.getState(),
      },
      {
        name: "add_block",
        description: "Suggest adding a study block or a break to the plan. The student sees it and presses Add or Not now; it is added only then. Refuses a past, overlapping or out-of-hours time with a reason.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["day", "start"],
          properties: {
            day: { type: "string", enum: DAYS, description: "Day of this week." },
            start: { type: "string", minLength: 4, maxLength: 5, description: "Start time, HH:MM, 24-hour." },
            minutes: { type: "integer", enum: BLOCK_MINUTES, description: "Length. 15 for a break and 60 for study if the student did not say." },
            kind: { type: "string", enum: ["study", "break"], description: "study (needs a subject) or break." },
            subject: { type: "string", enum: Object.keys(SUBJECTS), description: "Subject of a study block." },
            title: { type: "string", maxLength: 80, description: "Short title in the student's words, optional." },
          },
        },
        execute: args => {
          const check = App.page.checkAdd(args);
          if (!check.ok) return check;
          const { block } = check;
          return withConsent("add", block, `add ${block.title}, ${when(block.day, block.start, block.minutes)}.`,
            () => App.page.addBlock(block));
        },
      },
      {
        name: "move_block",
        description: "Suggest moving a block to another day or time; it keeps its length. The student presses Move or Not now. Exams cannot move. Refuses a past or overlapping time with a reason.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id", "day", "start"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 10, description: "Block id from website_get_week_plan, read this turn." },
            day: { type: "string", enum: DAYS, description: "New day." },
            start: { type: "string", minLength: 4, maxLength: 5, description: "New start time, HH:MM, 24-hour." },
          },
        },
        execute: args => {
          const check = App.page.checkMove(args);
          if (!check.ok) return check;
          const { block, to } = check;
          return withConsent("move", { id: block.id, ...to },
            `move ${block.title} from ${when(block.day, block.start, block.minutes)} to ${when(to.day, to.start, block.minutes)}.`,
            () => App.page.moveBlock({ id: block.id, ...to }));
        },
      },
      {
        name: "mark_block_done",
        description: "Suggest ticking off a block the student says they finished. The student presses Tick it off or Not now.",
        effect: "write",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 10, description: "Block id from website_get_week_plan, read this turn." },
          },
        },
        execute: args => {
          const check = App.page.checkDone(args.id);
          if (!check.ok) return check;
          return withConsent("done", { id: check.block.id }, `tick off ${check.block.title}.`,
            () => App.page.markDone(check.block.id));
        },
      },
    ];
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = PlannerActions.registerActions;

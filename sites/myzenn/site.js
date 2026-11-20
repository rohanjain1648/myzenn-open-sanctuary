// Mounts MyPal in the sanctuary page. Load it with <script type="module" src="site.js">.
// The page and its tools work without it; if the runtime fails, the status line says so.
import { App } from "./sanctuary.js";
import { SafetyNet } from "./safety-net.js";

export class AssistantMount {
  /** MyPal's first message once the visitor has a key. */
  static GREETING = "Hi, I am MyPal. Tell me what is going on, in your own words. I can help you name a feeling and start a breathing, grounding or focus exercise on this page. I am a self-help companion, not a therapist.";

  /** Shown until the visitor adds a key. The page's tools work without one. */
  static NO_KEY = "MyPal needs an AI provider key to talk. You can still use every tool on this page without one. To connect MyPal, open the settings below this chat.";

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      const engine = booted.engine;
      AssistantMount.engine = engine;
      // Safety first: screen each message before the model sees it. The input watch
      // also covers messages the runtime refuses, such as when no key is set yet.
      const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
      AssistantMount.armSafetyNet(engine, { holdUrgent: () => needsKey });
      if (needsKey) {
        status.textContent = "MyPal is not connected yet. Every tool on this page still works.";
        AssistantMount.firstMessage(AssistantMount.NO_KEY);
        // The runtime opens the settings when no key is set. Keep the page calm and
        // let the first message point to them instead.
        const settings = document.querySelector(".pal-settings");
        if (settings) settings.open = false;
      } else {
        status.textContent = "MyPal is connected and can use the tools on this page.";
        AssistantMount.firstMessage(AssistantMount.GREETING);
        App.page.palSender = AssistantMount.send;
      }
      document.body.dataset.pal = needsKey ? "needs-key" : "ready";
      return engine;
    } catch (error) {
      status.textContent = "MyPal could not load. Every tool on this page still works.";
      document.body.dataset.pal = "failed";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Arm both safety-net layers. Each is set up on its own, so a failure in one
   * neither stops the other nor stops MyPal from loading.
   *
   * :param holdUrgent: True when no model is connected. An urgent message then stays
   *   with the page, which shows support, instead of getting a setup error from the chat.
   */
  static armSafetyNet(engine, { holdUrgent }) {
    const showSupport = () => App.page.openSupport({ source: "safety-net" });
    const steps = [
      () => SafetyNet.watchInput(document.querySelector("#agent-app"), showSupport, { holdUrgent }),
      () => SafetyNet.attach(engine, showSupport),
    ];
    for (const step of steps) {
      try {
        step();
      } catch (error) {
        console.error("A safety-net layer could not start", error);
      }
    }
  }

  /** Replace the runtime's general first message. "New chat" keeps it. */
  static firstMessage(text) {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) first.textContent = text;
  }

  /**
   * Send a message as the visitor, through the chat's own input, so it shows in the
   * conversation and goes through the safety net like anything they type.
   *
   * :return: True when the message was handed to the chat.
   */
  static send(text) {
    const input = document.querySelector("#ns-input");
    const button = document.querySelector("#ns-send");
    if (!input || !button || button.disabled) return false;
    input.value = text;
    button.click();
    return true;
  }
}

if (typeof window !== "undefined") {
  await AssistantMount.start();
}

// Safety net: a deterministic check that runs on every visitor message before any
// model sees it. When a message suggests the visitor may be in danger, the page shows
// support resources at once, whether or not an LLM key is set and whatever the model
// later says. The model-level rules in the network are a second layer, not the first.
//
// It is plain JavaScript with no dependencies, so any agentic website can reuse it.
// The phrase list is deliberately broad: showing support to someone who did not need
// it costs little; missing someone who did costs a lot.

const PHRASES = [
  // English
  "kill myself", "killing myself", "end my life", "ending my life", "take my own life",
  "want to die", "wanna die", "wish i was dead", "wish i were dead", "better off dead",
  "suicide", "suicidal", "no reason to live", "nothing to live for", "don't want to live",
  "dont want to live", "do not want to live", "not want to be alive", "can't go on",
  "cant go on", "hurt myself", "harm myself", "self harm", "self-harm", "cut myself",
  "cutting myself", "overdose", "jump off", "hang myself",
  // Hindi and Hinglish, in Latin script
  "marna chahta", "marna chahti", "mar jaana chahta", "mar jaana chahti", "mar jana chahta",
  "mar jana chahti", "jeena nahi chahta", "jeena nahi chahti", "jeene ka mann nahi",
  "khudkushi", "aatmahatya", "atmahatya",
  // Hindi, in Devanagari
  "मरना चाहता", "मरना चाहती", "आत्महत्या", "ख़ुदकुशी", "खुदकुशी", "जीना नहीं चाहता", "जीना नहीं चाहती",
];

export class SafetyNet {
  /**
   * Check one message.
   *
   * :param text: What the visitor typed.
   * :return: {urgent: boolean, matched: string|null}. matched is the phrase found,
   *   for tests and logs; it is never shown to the visitor.
   */
  static screen(text) {
    const normal = SafetyNet.normalize(text);
    for (const phrase of PHRASES) {
      if (normal.includes(phrase)) return { urgent: true, matched: phrase };
    }
    return { urgent: false, matched: null };
  }

  /**
   * Lower-case, unify apostrophes and collapse whitespace, so "Don’t  want" matches.
   *
   * :param text: Any string.
   * :return: The normalized string.
   */
  static normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Screen every message the runtime sends to the model.
   *
   * The runtime's chat calls engine.streamTurn(text, options) for each new message and
   * stream.steer(text) for guidance added during a running turn. Both are wrapped. The
   * message still goes to the model, so the conversation continues with support.
   *
   * :param engine: The runtime Engine.
   * :param onUrgent: Called with the screen result when a message matches.
   */
  static attach(engine, onUrgent) {
    const streamTurn = engine.streamTurn.bind(engine);
    engine.streamTurn = (text, options) => {
      SafetyNet.check(text, onUrgent);
      const stream = streamTurn(text, options);
      if (stream && typeof stream.steer === "function") {
        const steer = stream.steer.bind(stream);
        stream.steer = guidance => {
          SafetyNet.check(guidance, onUrgent);
          return steer(guidance);
        };
      }
      return stream;
    };
  }

  /**
   * Screen what the visitor sends from the chat box, before the runtime handles it.
   *
   * attach() alone is not enough: with no LLM key, the runtime's chat refuses the
   * message before it reaches engine.streamTurn, so nothing would be screened. These
   * listeners run in the capture phase on the chat's container, ahead of the runtime's
   * own handlers on the input and the Send button, whatever happens next.
   *
   * :param root: An element that contains the chat input and Send button.
   * :param onUrgent: Called with the screen result when a message matches.
   * :param inputSelector: The chat input.
   * :param sendSelector: The Send button.
   * :param holdUrgent: Returns true when an urgent message should stop here instead
   *   of reaching the chat, such as when no model is connected and the chat could only
   *   answer with a setup error. The message stays in the input.
   */
  static watchInput(root, onUrgent, { inputSelector = "#ns-input", sendSelector = "#ns-send", holdUrgent = () => false } = {}) {
    const screenInput = event => {
      const input = root.querySelector(inputSelector);
      if (!input) return;
      const result = SafetyNet.check(input.value, onUrgent);
      if (result.urgent && holdUrgent()) {
        event.preventDefault?.();
        event.stopPropagation?.();
      }
    };
    root.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target?.matches?.(inputSelector)) screenInput(event);
    }, true);
    root.addEventListener("click", event => {
      if (event.target?.closest?.(sendSelector)) screenInput(event);
    }, true);
  }

  /**
   * Run the screen and call onUrgent on a match. Errors in onUrgent are logged, never
   * thrown, so they cannot stop the visitor's message.
   */
  static check(text, onUrgent) {
    const result = SafetyNet.screen(text);
    if (!result.urgent) return result;
    try {
      onUrgent(result);
    } catch (error) {
      console.error("Safety net could not show support", error);
    }
    return result;
  }
}

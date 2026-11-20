// The student's private context and the support banner, shared by app.js and site.js.
// This module does not wait for the assistant, so the plan never waits for it either.
import { STUDENT } from "./data/week.js";

/** The student's private context. The planner's allow rule decides what may leave. */
export class StudentContext {
  static shareCountry = false;
  static lastTurn = null;

  /** Private context for one turn. country is included only when the student agreed. */
  static forTurn() {
    const context = {
      student_name: STUDENT.name,
      email: STUDENT.email,
      school: STUDENT.school,
      mock_scores: { ...STUDENT.mockScores },
    };
    if (StudentContext.shareCountry) context.country = STUDENT.country;
    StudentContext.lastTurn = context;
    return context;
  }

  /** A readable label for a private field, for the consent card and the inspector. */
  static label(field) {
    return {
      student_name: "name",
      email: "email",
      school: "school",
      mock_scores: "mock scores",
      country: "country",
    }[field] || field;
  }

  /** A readable value, shown only to the student, for fields that may cross. */
  static value(field) {
    return field === "country" ? STUDENT.countryName : null;
  }
}

export class SupportBanner {
  static show() {
    const banner = document.querySelector("#support-banner");
    if (!banner) return;
    banner.hidden = false;
    banner.querySelector("h2")?.focus();
  }

  static hide() {
    const banner = document.querySelector("#support-banner");
    if (banner) banner.hidden = true;
  }
}

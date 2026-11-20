// Page start-up: draw the plan and wire the student's own controls. The assistant
// (site.js) is optional; everything here works without it.
import { App } from "./planner.js";
import { WeekView } from "./week-view.js";
import { STUDENT } from "./data/week.js";
import { StudentContext, SupportBanner } from "./context.js";

const view = new WeekView(document);
App.page.view = view;
view.mount(App.page);

// The private profile. It stays on this site; the toggle decides whether the country
// may cross to MyZenn, within the planner's published allow rule.
document.getElementById("profile-name").textContent = STUDENT.name;
document.getElementById("profile-email").textContent = STUDENT.email;
document.getElementById("profile-school").textContent = STUDENT.school;
document.getElementById("profile-scores").textContent = Object.entries(STUDENT.mockScores)
  .map(([subject, score]) => `${subject[0].toUpperCase()}${subject.slice(1)} ${score}`).join(", ");
document.getElementById("profile-country").textContent = STUDENT.countryName;

const share = document.getElementById("share-country");
share.checked = StudentContext.shareCountry;
share.addEventListener("change", () => {
  StudentContext.shareCountry = share.checked;
});

document.getElementById("support-close")?.addEventListener("click", () => SupportBanner.hide());

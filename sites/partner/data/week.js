// A fixed demo week for a fictional student, so the demo and the tests behave the same
// on any day. "Now" is Wednesday at 15:30; the chemistry exam is on Thursday morning.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

export const NOW = { day: "Wed", time: "15:30" };

/** The planner's day runs from 07:00 to 22:00. */
export const DAY_START = "07:00";
export const DAY_END = "22:00";
export const BLOCK_MINUTES = [15, 30, 45, 60, 90, 120];

export const SUBJECTS = {
  chemistry: { name: "Chemistry" },
  physics: { name: "Physics" },
  maths: { name: "Maths" },
  english: { name: "English" },
};

export const EXAMS = [
  { subject: "chemistry", day: "Thu", start: "09:30", title: "Chemistry exam" },
  { subject: "physics", day: "Sat", start: "09:30", title: "Physics exam" },
  { subject: "maths", day: "Mon", start: "09:30", title: "Maths exam", nextWeek: true },
];

/** Blocks on this week's plan. Exams this week are blocks too, so nothing overlaps them. */
export const SEED_BLOCKS = [
  { id: "b01", day: "Mon", start: "16:00", minutes: 90, kind: "study", subject: "physics", title: "Physics: forces and motion", done: true },
  { id: "b02", day: "Mon", start: "19:00", minutes: 60, kind: "study", subject: "maths", title: "Maths: quadratics", done: true },
  { id: "b03", day: "Tue", start: "16:00", minutes: 120, kind: "study", subject: "chemistry", title: "Chemistry: bonding", done: true },
  { id: "b04", day: "Tue", start: "20:00", minutes: 60, kind: "study", subject: "english", title: "English: poetry notes", done: true },
  { id: "b05", day: "Wed", start: "16:00", minutes: 90, kind: "study", subject: "chemistry", title: "Chemistry: organic reactions", done: false },
  { id: "b06", day: "Wed", start: "18:00", minutes: 60, kind: "study", subject: "chemistry", title: "Chemistry: past paper", done: false },
  { id: "b07", day: "Wed", start: "20:00", minutes: 60, kind: "study", subject: "physics", title: "Physics: optics", done: false },
  { id: "b08", day: "Thu", start: "09:30", minutes: 180, kind: "exam", subject: "chemistry", title: "Chemistry exam", done: false },
  { id: "b09", day: "Thu", start: "16:00", minutes: 90, kind: "study", subject: "physics", title: "Physics: practice questions", done: false },
  { id: "b10", day: "Thu", start: "19:00", minutes: 60, kind: "study", subject: "maths", title: "Maths: calculus", done: false },
  { id: "b11", day: "Fri", start: "16:00", minutes: 120, kind: "study", subject: "physics", title: "Physics: past paper", done: false },
  { id: "b12", day: "Fri", start: "19:00", minutes: 60, kind: "study", subject: "english", title: "English: essay plans", done: false },
  { id: "b13", day: "Sat", start: "09:30", minutes: 180, kind: "exam", subject: "physics", title: "Physics exam", done: false },
  { id: "b14", day: "Sat", start: "16:00", minutes: 60, kind: "study", subject: "maths", title: "Maths: revision", done: false },
  { id: "b15", day: "Sun", start: "10:00", minutes: 120, kind: "study", subject: "maths", title: "Maths: past paper", done: false },
  { id: "b16", day: "Sun", start: "17:00", minutes: 60, kind: "break", subject: null, title: "Rest", done: false },
];

/**
 * The student's private profile. It stays on this site: the page shows it, the
 * planner's private context carries it, and the planner's published allow rule lets
 * only "country" cross to MyZenn, and only when the student turns that on.
 * Every value is fictional.
 */
export const STUDENT = {
  name: "Aanya Sharma",
  email: "aanya.sharma@example.com",
  school: "Demo Senior Secondary School",
  mockScores: { chemistry: 58, physics: 71, maths: 64 },
  country: "IN",
  countryName: "India",
};

// The 18 MySanctuary tools, ported from MyZenn's tool list with wellness-only wording.
// Claims about blood pressure, immunity, panic prevention or clinical use were removed:
// this site offers self-help practices, not treatment.
//
// "onPage" names the tool this page can run itself. The rest open on myzenn.com.

export const MYZENN_ORIGIN = "https://myzenn.com";

export const CATEGORIES = [
  { id: "grounding", name: "Grounding", note: "For when your thoughts are racing" },
  { id: "relaxation", name: "Relaxation", note: "For winding down" },
  { id: "mindfulness", name: "Mindfulness", note: "For a few quiet minutes" },
  { id: "insight", name: "Insight", note: "For understanding what you feel" },
  { id: "focus", name: "Focus", note: "For getting started and staying with a task" },
  { id: "mood", name: "Mood", note: "For a lift" },
  { id: "movement", name: "Movement", note: "For tension held in the body" },
  { id: "social", name: "Social", note: "For conversations that feel hard" },
  { id: "relationship", name: "Relationship", note: "For couples" },
  { id: "learning", name: "Learning", note: "For understanding how minds work" },
];

export const TOOLS = [
  {
    id: "mybreath", name: "MyBreath", category: "grounding", duration: "4 min", onPage: "breathing",
    path: "/mysanctuary/mybreath",
    summary: "Box breathing: in, hold, out and hold, each for the same count, following a square.",
    goodFor: "Settling quickly before an exam, a meeting or sleep, or when you feel keyed up.",
    tip: "Breathe into your belly. If four seconds feels long, start with three.",
  },
  {
    id: "mysenses", name: "MySenses", category: "grounding", duration: "3 min", onPage: "grounding",
    path: "/mysanctuary/mysenses",
    summary: "The 5-4-3-2-1 exercise: notice five things you see, four you can touch, three you hear, two you smell and one you taste.",
    goodFor: "Bringing attention back to the room when thoughts are spiralling.",
    tip: "Be specific: a blue pen with a silver clip, not just a pen.",
  },
  {
    id: "mywheel", name: "MyWheel", category: "insight", duration: "Open", onPage: "wheel",
    path: "/mysanctuary/mywheel",
    summary: "An emotion wheel that moves from a broad feeling, like sad, to a precise one, like isolated.",
    goodFor: "When you only know that you feel bad. Naming a feeling precisely often makes it easier to handle.",
    tip: "Take your time on the outer ring. A second feeling often sits under the first.",
  },
  {
    id: "myanchor", name: "MyAnchor", category: "focus", duration: "5 to 50 min", onPage: "anchor",
    path: "/mysanctuary/myanchor",
    summary: "Set one clear intention, work on only that for a set time, then rest.",
    goodFor: "Starting a task you keep putting off, or studying in short, steady blocks.",
    tip: "Make the intention tiny: open the chapter, not finish the syllabus.",
  },
  {
    id: "mybody", name: "MyBody", category: "relaxation", duration: "8 min",
    path: "/mysanctuary/mybody",
    summary: "A guided body scan from your toes to the top of your head.",
    goodFor: "Noticing where you hold tension and letting it go, especially before sleep.",
    tip: "Lie down if you can. Notice sensations without trying to change them.",
  },
  {
    id: "mypeace", name: "MyPeace", category: "mindfulness", duration: "5 to 15 min",
    path: "/mysanctuary/mypeace",
    summary: "Guided meditations that use breath awareness and gentle noting.",
    goodFor: "A short reset in the middle of the day, or a longer quiet session.",
    tip: "When your mind wanders, notice it and come back. That is the practice.",
  },
  {
    id: "myvr", name: "MyVR", category: "relaxation", duration: "Open",
    path: "/vr-selection",
    summary: "360-degree calming places, from forests to beaches, with matching sound.",
    goodFor: "A change of scenery when you cannot leave your desk.",
    tip: "Use full screen and headphones, and breathe slowly while you look around.",
  },
  {
    id: "mylaughter", name: "MyLaughter", category: "mood", duration: "8 min",
    path: "/mysanctuary/laughter-therapy",
    summary: "Laughter yoga: warm-ups and breathing that turn pretend laughter into real laughter.",
    goodFor: "Shaking off a heavy mood. It feels silly at first, which is part of it.",
    tip: "Start with a smile and a slow exhale if a laugh will not come.",
  },
  {
    id: "myplay", name: "MyPlay", category: "focus", duration: "Open",
    path: "/games",
    summary: "Gentle memory and pattern games with no timer and no score pressure.",
    goodFor: "A healthy distraction from going over the same worry again and again.",
    tip: "Play lightly. The point is attention, not a high score.",
  },
  {
    id: "myyoga", name: "MyYoga", category: "movement", duration: "Open",
    path: "/yoga",
    summary: "Guided poses and short flows for energy in the morning or calm at night.",
    goodFor: "Releasing stiffness after long hours of sitting.",
    tip: "Never push into pain. Matching breath to movement matters more than form.",
  },
  {
    id: "myparticles", name: "MyParticles", category: "relaxation", duration: "Open",
    path: "/mysanctuary/zen-particles",
    summary: "Glowing particles that follow your finger or cursor, with soft sound.",
    goodFor: "Resting tired attention for a few minutes.",
    tip: "Trace a slow figure eight and let your eyes soften.",
  },
  {
    id: "myresources", name: "MyResources", category: "learning", duration: "Open",
    path: "/mysanctuary/resources",
    summary: "A curated library of articles, talks and music about stress, sleep, focus and mood.",
    goodFor: "Understanding why you feel the way you do.",
    tip: "Read one thing at a time, when you have the energy for it.",
  },
  {
    id: "myspaces", name: "MySpaces", category: "relaxation", duration: "Open",
    path: "/mysanctuary/myspaces",
    summary: "Explorable 3D meditation spaces, including temples, gardens and forests from many traditions.",
    goodFor: "Finding a place that feels safe to sit in, in your mind.",
    tip: "Move slowly and stop wherever feels most peaceful.",
  },
  {
    id: "myorbit", name: "MyOrbit", category: "focus", duration: "Open",
    path: "/mysanctuary/focus-board",
    summary: "A visual task board where tasks orbit, move into focus and land when done.",
    goodFor: "Keeping tasks in view if lists overwhelm you or you lose track easily.",
    tip: "Keep only one or two tasks in focus at once.",
  },
  {
    id: "myflow", name: "MyFlow", category: "social", duration: "Open",
    path: "/mysanctuary/myflow",
    summary: "Shows the rhythm of a conversation so you can see who is talking and who is listening.",
    goodFor: "Practising active listening and noticing if you interrupt or go quiet.",
    tip: "Try it first on a low-stakes call with a friend.",
  },
  {
    id: "mychimes", name: "MyChimes", category: "relaxation", duration: "Open",
    path: "/mysanctuary/mychimes",
    summary: "A pentatonic instrument where every note sounds good together.",
    goodFor: "Playing music with no wrong notes and no pressure.",
    tip: "Let each note fade before you play the next one.",
  },
  {
    id: "mystage", name: "MyStage", category: "social", duration: "10 to 15 min",
    path: "/mysanctuary/mystage",
    summary: "Rehearse a difficult conversation, like asking for a raise, with an AI role-play partner.",
    goodFor: "Finding your words before a conversation you are dreading.",
    tip: "Try the same scene a few times with different approaches.",
  },
  {
    id: "mybond", name: "MyBond", category: "relationship", duration: "Open",
    path: "/mysanctuary/mybond",
    summary: "Tools for couples: shared breathing, love languages, a gratitude ritual and more.",
    goodFor: "Staying close and talking openly with a partner.",
    tip: "Try the gratitude ritual for seven days in a row.",
  },
];

/** Full URL of a tool on myzenn.com. */
export function toolUrl(tool) {
  return `${MYZENN_ORIGIN}${tool.path}`;
}

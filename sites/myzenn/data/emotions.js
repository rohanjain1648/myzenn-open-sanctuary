// Emotion wheel, ported from MyZenn's MyWheel data: 7 core feelings, each with more
// precise feelings, each with two that are more precise still.
// One change: "Aroused" under Playful became "Lighthearted" for a general audience.

export const EMOTIONS = [
  { name: "Happy", color: "#f2e46b", children: [
    { name: "Optimistic", children: ["Inspired", "Hopeful"] },
    { name: "Trusting", children: ["Intimate", "Sensitive"] },
    { name: "Peaceful", children: ["Thankful", "Loving"] },
    { name: "Powerful", children: ["Creative", "Courageous"] },
    { name: "Accepted", children: ["Valued", "Respected"] },
    { name: "Proud", children: ["Confident", "Successful"] },
    { name: "Interested", children: ["Inquisitive", "Curious"] },
    { name: "Content", children: ["Joyful", "Free"] },
    { name: "Playful", children: ["Cheeky", "Lighthearted"] },
  ] },
  { name: "Surprised", color: "#b9a8e3", children: [
    { name: "Excited", children: ["Energetic", "Eager"] },
    { name: "Amazed", children: ["Awe", "Astonished"] },
    { name: "Confused", children: ["Perplexed", "Disillusioned"] },
    { name: "Startled", children: ["Dismayed", "Shocked"] },
  ] },
  { name: "Bad", color: "#86cfa3", children: [
    { name: "Bored", children: ["Indifferent", "Apathetic"] },
    { name: "Busy", children: ["Pressured", "Rushed"] },
    { name: "Stressed", children: ["Overwhelmed", "Out of control"] },
    { name: "Tired", children: ["Sleepy", "Unfocused"] },
  ] },
  { name: "Fearful", color: "#f4cf86", children: [
    { name: "Scared", children: ["Helpless", "Frightened"] },
    { name: "Anxious", children: ["Overwhelmed", "Worried"] },
    { name: "Insecure", children: ["Inadequate", "Inferior"] },
    { name: "Weak", children: ["Worthless", "Insignificant"] },
    { name: "Rejected", children: ["Excluded", "Persecuted"] },
    { name: "Threatened", children: ["Nervous", "Exposed"] },
  ] },
  { name: "Angry", color: "#f59aa2", children: [
    { name: "Let down", children: ["Betrayed", "Resentful"] },
    { name: "Humiliated", children: ["Disrespected", "Ridiculed"] },
    { name: "Bitter", children: ["Indignant", "Violated"] },
    { name: "Mad", children: ["Furious", "Jealous"] },
    { name: "Aggressive", children: ["Provoked", "Hostile"] },
    { name: "Frustrated", children: ["Infuriated", "Annoyed"] },
    { name: "Distant", children: ["Withdrawn", "Numb"] },
    { name: "Critical", children: ["Sceptical", "Dismissive"] },
  ] },
  { name: "Disgusted", color: "#a3a9b8", children: [
    { name: "Disapproving", children: ["Judgmental", "Embarrassed"] },
    { name: "Disappointed", children: ["Appalled", "Revolted"] },
    { name: "Awful", children: ["Nauseated", "Detestable"] },
    { name: "Repelled", children: ["Horrified", "Hesitant"] },
  ] },
  { name: "Sad", color: "#8fc6c6", children: [
    { name: "Hurt", children: ["Embarrassed", "Disappointed"] },
    { name: "Depressed", children: ["Inferior", "Empty"] },
    { name: "Guilty", children: ["Remorseful", "Ashamed"] },
    { name: "Despair", children: ["Powerless", "Grief"] },
    { name: "Vulnerable", children: ["Fragile", "Victimised"] },
    { name: "Lonely", children: ["Abandoned", "Isolated"] },
  ] },
];

export const CORE_EMOTIONS = EMOTIONS.map(e => e.name);

/**
 * Check that a path through the wheel exists.
 *
 * :param path: 1 to 3 names, from core to most precise.
 * :return: True when every step is a child of the one before.
 */
export function isEmotionPath(path) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 3) return false;
  const core = EMOTIONS.find(e => e.name === path[0]);
  if (!core) return false;
  if (path.length === 1) return true;
  const middle = core.children.find(m => m.name === path[1]);
  if (!middle) return false;
  return path.length === 2 || middle.children.includes(path[2]);
}

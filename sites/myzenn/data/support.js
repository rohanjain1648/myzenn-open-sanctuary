// MySafe support resources. Started from MyZenn's MySafe list, with two corrections:
// Crisis Text Line's 741741 number is for the US (not India), and 044-24640050 is
// SNEHA in Chennai. Tele-MANAS and 988 were added.
//
// LAUNCH CHECK: call or check the official site of every entry before the site goes
// public, then set CHECKED_ON. An unverified number in a crisis is worse than none.
export const CHECKED_ON = null;

export const EMERGENCY = [
  { country: "India", number: "112" },
  { country: "United States", number: "911" },
];

export const HELPLINES = [
  { country: "India", name: "Tele-MANAS (Government of India)", contact: "14416", hours: "24 hours", tel: "14416" },
  { country: "India", name: "Vandrevala Foundation", contact: "1860 2662 345", hours: "24 hours", tel: "18602662345" },
  { country: "India", name: "AASRA", contact: "98204 66726", hours: "24 hours", tel: "+919820466726" },
  { country: "India", name: "iCall (TISS)", contact: "91529 87821", hours: "Monday to Saturday, daytime", tel: "+919152987821" },
  { country: "India", name: "SNEHA, Chennai", contact: "044 2464 0050", hours: "24 hours", tel: "+914424640050" },
  { country: "United States", name: "988 Suicide & Crisis Lifeline", contact: "Call or text 988", hours: "24 hours", tel: "988" },
  { country: "United States", name: "Crisis Text Line", contact: "Text HOME to 741741", hours: "24 hours", tel: null },
];

export const ELSEWHERE = {
  label: "Find a free helpline in your country",
  url: "https://findahelpline.com",
};

/** Plain data for the read action and for other agents. */
export function supportResources() {
  return {
    emergency: EMERGENCY.map(e => ({ ...e })),
    helplines: HELPLINES.map(({ tel, ...rest }) => ({ ...rest })),
    elsewhere: { ...ELSEWHERE },
    checkedOn: CHECKED_ON,
  };
}

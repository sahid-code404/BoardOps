/** Returns a time-based greeting based on the user's local time. */
export function getTimeGreeting(): { greeting: string; emoji: string } {
  const hour = new Date().getHours();

  if (hour < 5) return { greeting: "Good Night", emoji: "🌙" };
  if (hour < 12) return { greeting: "Good Morning", emoji: "☀️" };
  if (hour < 17) return { greeting: "Good Afternoon", emoji: "🌤️" };
  if (hour < 21) return { greeting: "Good Evening", emoji: "🌆" };
  return { greeting: "Good Night", emoji: "🌙" };
}

/** Gradient color pairs for user names — each user gets a consistent random gradient. */
const NAME_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-indigo-500 to-purple-500",
  "from-cyan-500 to-blue-500",
  "from-teal-500 to-green-500",
  "from-orange-500 to-red-500",
  "from-pink-500 to-rose-500",
  "from-purple-500 to-indigo-500",
  "from-green-500 to-emerald-500",
];

/** Returns a gradient class for a given name — consistent per name (same name = same gradient). */
export function getGradientForName(name: string): string {
  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return NAME_GRADIENTS[hash % NAME_GRADIENTS.length];
}

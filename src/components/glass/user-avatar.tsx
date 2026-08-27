"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Shared user avatar pill.
 *
 * Renders the user's uploaded avatar picture when `avatarUrl` is set,
 * otherwise falls back to a deterministic gradient circle with initials.
 *
 * Used across all "user pills" (funds, payments, kitchen, billing, users,
 * profile) so avatar pictures are honoured everywhere a user updates them.
 */

const AVATAR_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-indigo-500 to-purple-500",
];

const AVATAR_SIZES = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
} as const;

type AvatarSize = keyof typeof AVATAR_SIZES;

function gradientFor(name: string) {
  const idx = name
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

export type UserAvatarProps = {
  name: string;
  avatarUrl?: string | null;
  /** Optional room metadata accepted by resident/user call sites. */
  room?: string | null;
  /** Named size used by shared call sites. */
  size?: AvatarSize;
  /** Tailwind size + rounding classes, e.g. "h-10 w-10 rounded-xl" */
  className?: string;
  /** Font size / weight classes for the initials fallback */
  fallbackClassName?: string;
};

export function UserAvatar({
  name,
  avatarUrl,
  size,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  return (
    <Avatar className={cn("shrink-0", size && AVATAR_SIZES[size], className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "bg-gradient-to-br text-white font-semibold",
          gradientFor(name || "U"),
          fallbackClassName
        )}
      >
        {initials(name || "")}
      </AvatarFallback>
    </Avatar>
  );
}

export { gradientFor, initials };

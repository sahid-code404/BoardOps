"use client";

import { cn } from "@/lib/utils";

export function ShimmerSkeleton({
  className,
  rounded = "rounded-2xl",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={cn(
        "shimmer bg-muted/40",
        rounded,
        className
      )}
    />
  );
}

export function ShimmerText({ className }: { className?: string }) {
  return <ShimmerSkeleton className={cn("h-4 w-full", className)} rounded="rounded-lg" />;
}

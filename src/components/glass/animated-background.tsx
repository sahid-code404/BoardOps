"use client";

import { cn } from "@/lib/utils";

/** Animated mesh gradient background with floating blobs.
 *
 * Uses pure-CSS opacity keyframes (`.blob-1`…`.blob-4`) instead of Framer
 * Motion so the animation runs on the compositor thread with zero JS per
 * frame. The noise overlay was removed — it forced an extra full-screen
 * composite layer on every paint. */
export function AnimatedBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className
      )}
    >
      {/* Base mesh */}
      <div className="absolute inset-0 mesh-bg opacity-90" />

      {/* Animated blobs — opacity pulses driven by CSS keyframes */}
      <div
        className="blob-1 absolute -top-32 -left-32 h-96 w-96 rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--mesh-1) 0%, transparent 70%)",
        }}
      />
      <div
        className="blob-2 absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--mesh-2) 0%, transparent 70%)",
        }}
      />
      <div
        className="blob-3 absolute -bottom-40 left-1/4 h-[30rem] w-[30rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--mesh-3) 0%, transparent 70%)",
        }}
      />
      <div
        className="blob-4 absolute top-1/2 left-1/2 h-72 w-72 rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--mesh-4) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

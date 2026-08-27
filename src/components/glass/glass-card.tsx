"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLMotionProps<"div"> & {
  glow?: "primary" | "success" | "warning" | "danger" | "none";
  hover?: boolean;
  strong?: boolean;
};

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = "none", hover = true, strong = false, children, ...props }, ref) => {
    const glowClass =
      glow === "primary"
        ? "glow-primary"
        : glow === "success"
          ? "glow-success"
          : glow === "warning"
            ? "glow-warning"
            : glow === "danger"
              ? "glow-danger"
              : "";
    return (
      <motion.div
        ref={ref}
        className={cn(
          strong ? "glass-strong" : "glass",
          "rounded-3xl",
          glowClass,
          hover && "transition-transform duration-300",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
GlassCard.displayName = "GlassCard";

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";

export function GlassNav<T extends string>({
  items,
  value,
  onChange,
  className,
  size = "md",
}: {
  items: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const [hovered, setHovered] = useState<T | null>(null);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 glass-soft rounded-full p-1 relative",
        className
      )}
      onMouseLeave={() => setHovered(null)}
    >
      <AnimatePresence>
        {hovered && hovered !== value && (
          <motion.div
            className="absolute top-1 bottom-1 rounded-full bg-secondary/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              left: `calc(${items.findIndex((i) => i.value === hovered) * (100 / items.length)}% + 4px)`,
              width: `calc(${100 / items.length}% - 8px)`,
            }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
      </AnimatePresence>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            onMouseEnter={() => setHovered(item.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center rounded-full font-medium transition-colors",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.div
                className="absolute inset-0 rounded-full bg-primary shadow-lg shadow-primary/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {item.icon}
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

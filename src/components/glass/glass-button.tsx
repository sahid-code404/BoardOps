"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
type Size = "sm" | "md" | "lg" | "icon" | "fab";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:brightness-110",
  secondary:
    "glass-soft text-foreground hover:bg-secondary/80",
  ghost: "text-foreground/80 hover:text-foreground hover:bg-secondary/40",
  danger:
    "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30 hover:shadow-destructive/50 hover:brightness-110",
  success:
    "bg-success text-success-foreground shadow-lg shadow-success/30 hover:brightness-110",
  outline: "border border-border glass-soft text-foreground hover:bg-secondary/40",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-sm rounded-2xl gap-1.5",
  md: "h-11 px-5 text-sm rounded-2xl gap-2",
  lg: "h-13 px-7 text-base rounded-3xl gap-2.5 py-3",
  icon: "h-11 w-11 rounded-2xl",
  fab: "h-14 w-14 rounded-full shadow-xl",
};

export interface GlassButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : motion.button;
    const motionProps = asChild
      ? {}
      : {
          whileTap: { scale: 0.96 },
          whileHover: { scale: 1.02 },
          transition: { type: "spring" as const, stiffness: 400, damping: 25 },
        };
    return (
      <Comp
        ref={ref as never}
        className={cn(
          "relative inline-flex items-center justify-center font-medium select-none",
          "transition-colors duration-200 outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        disabled={disabled || loading}
        {...motionProps}
        {...(props as object)}
      >
        {loading && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          </span>
        )}
        <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>
          {children}
        </span>
      </Comp>
    );
  }
);
GlassButton.displayName = "GlassButton";

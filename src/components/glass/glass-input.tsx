"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface GlassInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  hint?: string;
}

export const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className, label, error, icon, trailing, hint, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const hasValue = props.value !== undefined && props.value !== "";
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground"
          >
            {label}
          </label>
        )}
        <motion.div
          whileFocus={{ scale: 1.005 }}
          className={cn(
            "relative flex items-center w-full",
            "glass-soft rounded-2xl",
            "px-4 transition-all duration-200",
            "border-2 border-transparent",
            error
              ? "border-destructive/60"
              : "focus-within:border-primary/50 focus-within:glow-primary"
          )}
        >
          {icon && (
            <span className="mr-2.5 shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "flex-1 bg-transparent py-3 text-sm",
              "placeholder:text-muted-foreground/60",
              "outline-none border-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "text-foreground",
              className
            )}
            {...props}
            data-has-value={hasValue}
          />
          {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
        </motion.div>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 ml-1 text-xs text-destructive"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <p className="mt-1.5 ml-1 text-xs text-muted-foreground/70">{hint}</p>
        ) : null}
      </div>
    );
  }
);
GlassInput.displayName = "GlassInput";

export interface GlassTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const GlassTextarea = React.forwardRef<HTMLTextAreaElement, GlassTextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            "flex w-full glass-soft rounded-2xl px-4 py-3 text-sm",
            "placeholder:text-muted-foreground/60",
            "outline-none border-2 border-transparent",
            "focus:border-primary/50 transition-all",
            "disabled:cursor-not-allowed disabled:opacity-50 resize-none",
            className
          )}
          {...props}
        />
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 ml-1 text-xs text-destructive"
          >
            {error}
          </motion.p>
        )}
      </div>
    );
  }
);
GlassTextarea.displayName = "GlassTextarea";

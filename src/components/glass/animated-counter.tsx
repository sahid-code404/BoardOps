"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useMotionValue, useSpring, motion } from "framer-motion";

export function AnimatedCounter({
  value,
  duration = 1.4,
  format,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 });
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  useEffect(() => {
    return spring.on("change", (v) => {
      // If the value has decimals, show 2 decimal places; otherwise show as integer
      const hasDecimals = value % 1 !== 0;
      const n = hasDecimals ? Math.round(v * 100) / 100 : Math.round(v);
      const formatted = hasDecimals
        ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : n.toLocaleString("en-IN");
      setDisplay(format ? format(n) : formatted);
    });
  }, [spring, format, value]);

  return (
    <motion.span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </motion.span>
  );
}

"use client";

import * as React from "react";
import { Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

// ─────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────

function parse24(value: string): { hour24: number; minute: number } {
  const safe = value && /^\d{1,2}:\d{2}$/.test(value) ? value : "08:00";
  const [h, m] = safe.split(":").map(Number);
  return { hour24: ((h % 24) + 24) % 24, minute: ((m % 60) + 60) % 60 };
}

function to12(hour24: number): { hour12: number; period: "AM" | "PM" } {
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, period };
}

function to24(hour12: number, period: "AM" | "PM"): number {
  let h = hour12 % 12;
  if (period === "PM") h += 12;
  return h;
}

function formatDisplay(value: string): string {
  const { hour24, minute } = parse24(value);
  const { hour12, period } = to12(hour24);
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export interface DigitalClockPickerProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

export function DigitalClockPicker({
  value, onChange, label, error, className, id, ariaLabel,
}: DigitalClockPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"hour" | "minute">("hour");

  const { hour24, minute } = parse24(value);
  const { hour12, period } = to12(hour24);

  const commit = (next: { hour12?: number; minute?: number; period?: "AM" | "PM" }) => {
    const h12 = next.hour12 ?? hour12;
    const m = next.minute ?? minute;
    const p = next.period ?? period;
    const h24 = to24(h12, p);
    onChange(`${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const triggerId = React.useId();

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id ?? triggerId} className="ml-1 block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id ?? triggerId}
            aria-label={ariaLabel ?? label ?? "Pick a time"}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              "group relative flex h-10 w-full items-center justify-between gap-2 rounded-2xl px-3 text-left text-sm",
              "glass cursor-pointer outline-none transition-all",
              "hover:bg-glass-strong/60 focus-visible:ring-2 focus-visible:ring-primary/40",
              error && "ring-1 ring-destructive/60"
            )}
          >
            <span className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
              <span className="font-medium tabular-nums">{formatDisplay(value)}</span>
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[260px] max-w-[calc(100vw-2rem)] p-0 rounded-3xl border-glass-border glass-strong"
        >
          <ClockDial
            mode={mode}
            onModeChange={setMode}
            hour12={hour12}
            minute={minute}
            period={period}
            onHour={(h) => commit({ hour12: h })}
            onMinute={(m) => commit({ minute: m })}
            onPeriod={(p) => commit({ period: p })}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>

      {error && <p className="ml-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ClockDial — circular clock face with draggable pointer
// ─────────────────────────────────────────────────────────────

function ClockDial({
  mode, onModeChange, hour12, minute, period,
  onHour, onMinute, onPeriod, onDone,
}: {
  mode: "hour" | "minute";
  onModeChange: (m: "hour" | "minute") => void;
  hour12: number;
  minute: number;
  period: "AM" | "PM";
  onHour: (h: number) => void;
  onMinute: (m: number) => void;
  onPeriod: (p: "AM" | "PM") => void;
  onDone: () => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = React.useState(false);

  // Dial geometry
  const size = 220;
  const center = size / 2;
  const radius = 85; // distance from center to numbers
  const numberRadius = 16; // number circle radius

  // Values to display on the dial
  const values = mode === "hour"
    ? Array.from({ length: 12 }, (_, i) => i + 1) // 1..12
    : Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,10,...,55

  const currentValue = mode === "hour" ? hour12 : (Math.round(minute / 5) * 5 % 60);

  // Calculate angle for a value (0° = 12 o'clock position, clockwise)
  const angleForValue = (val: number) => {
    if (mode === "hour") {
      return ((val % 12) / 12) * 360;
    }
    return (val / 60) * 360;
  };

  // Calculate position on the circle
  const posForAngle = (angleDeg: number) => {
    const rad = (angleDeg - 90) * (Math.PI / 180); // -90 to start at top
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  // Pointer position
  const pointerAngle = angleForValue(currentValue);
  const pointerPos = posForAngle(pointerAngle);

  // Handle pointer/drag interaction
  const handlePointer = React.useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left - center;
    const y = clientY - rect.top - center;
    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90; // 0 = top
    if (angle < 0) angle += 360;

    if (mode === "hour") {
      // 12 positions, snap to nearest
      const idx = Math.round(angle / 30) % 12;
      const hour = idx === 0 ? 12 : idx;
      onHour(hour);
    } else {
      // 12 positions (5-min steps), snap to nearest
      const idx = Math.round(angle / 30) % 12;
      const min = idx * 5;
      onMinute(min);
    }
  }, [mode, onHour, onMinute, center]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    handlePointer(e.clientX, e.clientY);
  };

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (dragging) handlePointer(e.clientX, e.clientY);
  }, [dragging, handlePointer]);

  const handleTouchMove = React.useCallback((e: TouchEvent) => {
    if (dragging && e.touches[0]) {
      e.preventDefault();
      handlePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [dragging, handlePointer]);

  const handleUp = React.useCallback(() => setDragging(false), []);

  React.useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [dragging, handleMouseMove, handleTouchMove, handleUp]);

  return (
    <div className="flex flex-col">
      {/* Header — time readout + Done */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={() => onModeChange("hour")}
          className={cn(
            "text-3xl font-bold tabular-nums transition-colors",
            mode === "hour" ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {hour12}
        </button>
        <span className="text-3xl font-bold text-muted-foreground">:</span>
        <button
          type="button"
          onClick={() => onModeChange("minute")}
          className={cn(
            "text-3xl font-bold tabular-nums transition-colors",
            mode === "minute" ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {String(minute).padStart(2, "0")}
        </button>
        <span className="ml-1 text-sm font-semibold text-muted-foreground">{period}</span>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold bg-primary text-primary-foreground shadow-sm hover:scale-[1.03] active:scale-95 transition-transform"
        >
          <Check className="size-3.5" />
          Done
        </button>
      </div>

      {/* Clock dial */}
      <div className="flex justify-center px-2 pb-2">
        <svg
          ref={svgRef}
          width={size}
          height={size}
          className="touch-none select-none cursor-pointer"
          onMouseDown={handleMouseDown}
          onTouchStart={(e) => {
            e.preventDefault();
            setDragging(true);
            if (e.touches[0]) handlePointer(e.touches[0].clientX, e.touches[0].clientY);
          }}
        >
          {/* Outer circle */}
          <circle cx={center} cy={center} r={radius + numberRadius + 4} fill="none" className="stroke-border/30" strokeWidth={1} />

          {/* Pointer line — drawn FIRST (behind numbers) */}
          {/* Stop short of the number circle so it doesn't overlap */}
          {(() => {
            const lineEndRadius = radius - numberRadius - 4;
            const rad = (pointerAngle - 90) * (Math.PI / 180);
            const lineEndX = center + lineEndRadius * Math.cos(rad);
            const lineEndY = center + lineEndRadius * Math.sin(rad);
            return (
              <>
                <line
                  x1={center}
                  y1={center}
                  x2={lineEndX}
                  y2={lineEndY}
                  className="stroke-primary"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                {/* Center dot */}
                <circle cx={center} cy={center} r={6} className="fill-primary" />
                <circle cx={center} cy={center} r={2.5} className="fill-primary-foreground" />
              </>
            );
          })()}

          {/* Hour/minute numbers around the circle — drawn AFTER line (on top) */}
          {values.map((val) => {
            const angle = angleForValue(val);
            const pos = posForAngle(angle);
            const active = val === currentValue;
            const label = mode === "minute" ? String(val).padStart(2, "0") : String(val);
            return (
              <g key={val}>
                {/* Number circle background */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={active ? numberRadius + 2 : numberRadius - 2}
                  className={active ? "fill-primary" : "fill-muted/30"}
                  style={{ transition: "all 0.15s ease" }}
                />
                {/* Number text */}
                <text
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn(
                    "font-bold tabular-nums select-none",
                    active ? "fill-primary-foreground text-[18px]" : "fill-foreground text-[15px]"
                  )}
                  style={{ transition: "all 0.15s ease" }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* AM / PM */}
      <div className="px-4 pb-3">
        <div className="glass-soft inline-flex w-full rounded-full p-1">
          {(["AM", "PM"] as const).map((p) => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPeriod(p)}
                aria-pressed={active}
                className={cn(
                  "h-8 flex-1 rounded-full text-xs font-bold transition-all",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default DigitalClockPicker;

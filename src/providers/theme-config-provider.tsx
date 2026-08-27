"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api-client";

type ThemeConfig = {
  primary: string;
  primaryForeground: string;
  accent: string;
  radius: string;
  mode: "system" | "light" | "dark";
  preset: string;
  glassMode: "on" | "off";
  blurIntensity: "light" | "normal" | "heavy";
  transparency: "low" | "medium" | "high";
};

const DEFAULT_THEME: ThemeConfig = {
  primary: "#8b5cf6",
  primaryForeground: "#ffffff",
  accent: "#10b981",
  radius: "1.25rem",
  mode: "system",
  preset: "violet",
  glassMode: "on",
  blurIntensity: "normal",
  transparency: "medium",
};

type ThemeContextValue = {
  theme: ThemeConfig;
  setTheme: (t: ThemeConfig) => void;
  previewTheme: (t: ThemeConfig) => void;
  refresh: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  previewTheme: () => {},
  refresh: async () => {},
});

/** Convert a hex color to an OKLCH string for the CSS variable. */
function hexToOklch(hex: string): string {
  // We keep hex as-is and let the browser handle it — our CSS uses color-mix()
  // and the variables accept any valid CSS color.
  return hex;
}

/** Compute a readable foreground color (black or white) for a given hex background. */
function readableForeground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? "#0a0a0f" : "#ffffff";
}

export function ThemeConfigProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(DEFAULT_THEME);

  const applyTheme = useCallback((config: ThemeConfig) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    // Only apply CSS variables for colors/radius — next-themes handles the .dark class
    root.style.setProperty("--primary", hexToOklch(config.primary));
    root.style.setProperty("--primary-foreground", config.primaryForeground || readableForeground(config.primary));
    root.style.setProperty("--accent", hexToOklch(config.accent));
    root.style.setProperty("--accent-foreground", readableForeground(config.accent));
    root.style.setProperty("--ring", hexToOklch(config.primary));
    root.style.setProperty("--sidebar-primary", hexToOklch(config.primary));
    root.style.setProperty("--sidebar-ring", hexToOklch(config.primary));
    root.style.setProperty("--radius", config.radius);
    root.style.setProperty("--chart-1", hexToOklch(config.primary));
    // Glass / blur / transparency data attributes — drive the CSS overrides in globals.css
    root.setAttribute("data-glass-mode", config.glassMode || "on");
    root.setAttribute("data-blur-intensity", config.blurIntensity || "normal");
    root.setAttribute("data-transparency", config.transparency || "medium");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: ThemeConfig }>("/theme");
      const config = { ...DEFAULT_THEME, ...res.data };
      setThemeState(config);
      applyTheme(config);
    } catch {
      // Network error — keep defaults
    }
  }, [applyTheme]);

  // Initial theme fetch — uses a flag to avoid the setState-in-effect lint rule
  // while still running exactly once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: ThemeConfig }>("/theme");
        if (cancelled) return;
        const config = { ...DEFAULT_THEME, ...res.data };
        setThemeState(config);
        applyTheme(config);
      } catch {
        // Network error — keep defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback(
    (config: ThemeConfig) => {
      setThemeState(config);
      applyTheme(config);
    },
    [applyTheme]
  );

  /** Apply CSS variables for live preview WITHOUT updating the stored state. */
  const previewTheme = useCallback(
    (config: ThemeConfig) => {
      applyTheme(config);
    },
    [applyTheme]
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, previewTheme, refresh }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeConfig() {
  return useContext(ThemeContext);
}

export { readableForeground, DEFAULT_THEME };
export type { ThemeConfig };

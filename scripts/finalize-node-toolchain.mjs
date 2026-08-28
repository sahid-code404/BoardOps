import { readFile, writeFile } from "node:fs/promises";

async function replaceExact(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected source fragment was not found in ${path}`);
  }
  await writeFile(path, source.replace(before, after), "utf8");
}

await writeFile(
  "src/hooks/use-mobile.ts",
  `import * as React from "react"\n\nconst MOBILE_BREAKPOINT = 768\nconst MOBILE_QUERY = \`(max-width: \${MOBILE_BREAKPOINT - 1}px)\`\n\nfunction subscribe(callback: () => void) {\n  const mql = window.matchMedia(MOBILE_QUERY)\n  mql.addEventListener("change", callback)\n  return () => mql.removeEventListener("change", callback)\n}\n\nfunction getSnapshot() {\n  return window.matchMedia(MOBILE_QUERY).matches\n}\n\nfunction getServerSnapshot() {\n  return false\n}\n\nexport function useIsMobile() {\n  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)\n}\n`,
  "utf8"
);

await replaceExact(
  "src/components/ui/carousel.tsx",
  `  React.useEffect(() => {\n    if (!api) return\n    onSelect(api)\n    api.on("reInit", onSelect)\n    api.on("select", onSelect)\n\n    return () => {\n      api?.off("select", onSelect)\n    }\n  }, [api, onSelect])`,
  `  React.useEffect(() => {\n    if (!api) return\n\n    const frame = requestAnimationFrame(() => onSelect(api))\n    api.on("reInit", onSelect)\n    api.on("select", onSelect)\n\n    return () => {\n      cancelAnimationFrame(frame)\n      api.off("reInit", onSelect)\n      api.off("select", onSelect)\n    }\n  }, [api, onSelect])`
);

await replaceExact(
  "src/components/features/calendar/calendar-view.tsx",
  `  const [mode, setMode] = React.useState<ViewMode>("agenda");\n  const [cursor, setCursor] = React.useState<Date>(new Date());\n\n  // Mobile defaults to agenda, desktop defaults to month\n  React.useEffect(() => {\n    setMode(isMobile ? "agenda" : "month");\n  }, [isMobile]);`,
  `  const [modeOverride, setModeOverride] = React.useState<ViewMode | null>(null);\n  const [cursor, setCursor] = React.useState<Date>(new Date());\n\n  // Follow the responsive default until the user explicitly chooses a view.\n  const mode: ViewMode = modeOverride ?? (isMobile ? "agenda" : "month");`
);
await replaceExact(
  "src/components/features/calendar/calendar-view.tsx",
  `            onChange={setMode}`,
  `            onChange={setModeOverride}`
);

await replaceExact(
  "src/components/features/personalization/personalization-view.tsx",
  `  const { theme, previewTheme, refresh } = useThemeConfig();\n  const [local, setLocal] = useState<ThemeConfig>(theme);\n  const [saving, setSaving] = useState(false);\n  const [loading, setLoading] = useState(true);`,
  `  const { theme, previewTheme, refresh } = useThemeConfig();\n  const [draft, setLocal] = useState<ThemeConfig | null>(null);\n  const local = draft ?? theme;\n  const [saving, setSaving] = useState(false);\n  const [loading, setLoading] = useState(true);`
);
await replaceExact(
  "src/components/features/personalization/personalization-view.tsx",
  `\n  useEffect(() => {\n    setLocal(theme);\n  }, [theme]);\n`,
  `\n`
);
await replaceExact(
  "src/components/features/personalization/personalization-view.tsx",
  `      await refresh();\n    } catch (e: unknown) {`,
  `      await refresh();\n      setLocal(null);\n    } catch (e: unknown) {`
);
await replaceExact(
  "src/components/features/personalization/personalization-view.tsx",
  `      toast.success("Theme reset to defaults");\n      await refresh();\n    } catch (e: unknown) {`,
  `      toast.success("Theme reset to defaults");\n      await refresh();\n      setLocal(null);\n    } catch (e: unknown) {`
);

await replaceExact(
  "src/components/features/auth/profile-view.tsx",
  `      <EditProfileDialog\n        open={editOpen}`,
  `      <EditProfileDialog\n        key={editOpen ? "edit-open" : "edit-closed"}\n        open={editOpen}`
);
await replaceExact(
  "src/components/features/auth/profile-view.tsx",
  `      <TwoFactorDialog\n        open={twoFactorOpen}`,
  `      <TwoFactorDialog\n        key={twoFactorOpen ? "2fa-open" : "2fa-closed"}\n        open={twoFactorOpen}`
);
await replaceExact(
  "src/components/features/auth/profile-view.tsx",
  `\n  useEffect(() => {\n    if (open) {\n      setForm({\n        name: user.name,\n        phone: user.phone || "",\n        room: user.room || "",\n        gender: user.gender || "",\n        emergencyContact: user.emergencyContact || "",\n        theme: user.theme || "system",\n        language: user.language || "en",\n        timezone: user.timezone || "UTC",\n      });\n    }\n  }, [open, user]);\n`,
  `\n`
);
await replaceExact(
  "src/components/features/auth/profile-view.tsx",
  `\n  useEffect(() => {\n    if (open) {\n      setStep("main");\n      setSecret("");\n      setQrCode("");\n      setCode("");\n      setBackupCodes([]);\n      setDisablePassword("");\n    }\n  }, [open]);\n`,
  `\n`
);

console.log("Node/npm toolchain codemod applied successfully.");

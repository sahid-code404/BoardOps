"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/stores/use-app-store";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileSidebar } from "./mobile-sidebar";
import { TopBar } from "./top-bar";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const view = useAppStore((s) => s.view);

  return (
    <div className="min-h-screen flex flex-col">
      <MobileSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 px-3 sm:px-4 lg:px-6 pb-28 pt-4 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-6xl"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}

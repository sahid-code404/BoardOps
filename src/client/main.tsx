import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Page from "@/app/page";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeConfigProvider } from "@/providers/theme-config-provider";
import { ThemeProvider } from "@/providers/theme-provider";

import "@/app/globals.css";
import "./native.css";

const root = document.getElementById("root");
if (!root) throw new Error("BoardOps root element was not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange={false}
    >
      <QueryProvider>
        <ThemeConfigProvider>
          <Page />
          <Toaster />
          <SonnerToaster position="top-center" />
        </ThemeConfigProvider>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>
);

import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { fetchHealth } from "./api/health";
import "./modern.css";

function FoundationPage() {
  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: 1,
  });

  return (
    <main className="modern-shell">
      <section className="modern-card" aria-labelledby="modern-title">
        <div className="modern-eyebrow">BoardOps migration runtime</div>
        <h1 id="modern-title">Cloudflare modular monolith</h1>
        <p className="modern-copy">
          This shell proves the direct React/Vite → Hono Worker → Drizzle/D1
          path while the existing BoardOps application remains the frozen
          behavior reference.
        </p>

        <div className="modern-status" data-state={health.status}>
          {health.isPending && "Checking local D1…"}
          {health.isError && `Runtime check failed: ${health.error.message}`}
          {health.data && (
            <>
              <strong>Runtime ready</strong>
              <span>
                Worker: {health.data.data.runtime} · D1: {health.data.data.database.reachable ? "reachable" : "unreachable"}
              </span>
              <span>Request ID: {health.data.requestId}</span>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export function ModernApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<FoundationPage />} />
      </Routes>
    </BrowserRouter>
  );
}

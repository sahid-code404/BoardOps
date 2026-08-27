import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/modern/infrastructure/db/introspected",
  dbCredentials: {
    url: "/tmp/boardops-introspect.sqlite",
  },
});

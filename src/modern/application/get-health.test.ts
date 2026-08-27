/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { getHealth } from "./get-health";
import type { SystemRepository } from "./ports/system-repository";

class FakeSystemRepository implements SystemRepository {
  constructor(private readonly reachable: boolean) {}

  async pingDatabase(): Promise<boolean> {
    return this.reachable;
  }
}

describe("modern getHealth", () => {
  test("reports the Cloudflare modular-monolith runtime and database status", async () => {
    const result = await getHealth(new FakeSystemRepository(true), "0.3.0-test");

    expect(result).toEqual({
      service: "boardops",
      runtime: "cloudflare-workers",
      architecture: "modular-monolith",
      version: "0.3.0-test",
      database: { reachable: true },
    });
  });

  test("does not hide an unreachable database result", async () => {
    const result = await getHealth(new FakeSystemRepository(false), "test");
    expect(result.database.reachable).toBe(false);
  });
});

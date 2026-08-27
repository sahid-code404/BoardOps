import type { SystemRepository } from "@modern/application/ports/system-repository";
import type { ModernDatabase } from "./client";
import { users } from "./schema";

export class DrizzleSystemRepository implements SystemRepository {
  constructor(private readonly db: ModernDatabase) {}

  async pingDatabase(): Promise<boolean> {
    await this.db.select({ id: users.id }).from(users).limit(1);
    return true;
  }
}

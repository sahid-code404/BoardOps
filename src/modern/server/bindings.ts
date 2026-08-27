export type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export type EmailBinding = {
  send(message: unknown): Promise<void>;
};

export type ModernBindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  AUTH_RATE_LIMITER: RateLimitBinding;
  EMAIL: EmailBinding;
  EMAIL_FROM?: string;
  APP_VERSION?: string;
};

export type ModernVariables = {
  requestId: string;
};

export type BoardOpsBindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  AUTH_RATE_LIMITER: RateLimit;
  EMAIL: SendEmail;
  EMAIL_FROM?: string;
};

export type BoardOpsVariables = {
  requestId: string;
};

export type BoardOpsEnv = {
  Bindings: BoardOpsBindings;
  Variables: BoardOpsVariables;
};

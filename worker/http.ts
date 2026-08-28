export type ApiSuccess<T> = {
  success: true;
  data: T;
  requestId?: string;
};

export type ApiFailure = {
  success: false;
  error: string;
  details?: unknown;
  requestId?: string;
};

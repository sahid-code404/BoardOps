export type ApiSuccess<T> = {
  success: true;
  data: T;
  requestId: string;
};

export type ApiFailure = {
  success: false;
  error: string;
  details?: unknown;
  requestId: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function isApiSuccess<T>(value: ApiResult<T>): value is ApiSuccess<T> {
  return value.success;
}

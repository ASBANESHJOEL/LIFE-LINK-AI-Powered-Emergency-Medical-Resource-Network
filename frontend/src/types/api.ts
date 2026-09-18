export interface ApiErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
  code?: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

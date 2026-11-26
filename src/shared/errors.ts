export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function errorInfo(error: unknown): { code: string; message: string } {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  )
    return { code: error.code, message: error.message };
  if (error instanceof Error)
    return { code: 'code' in error ? String(error.code) : 'UNKNOWN', message: error.message };
  return { code: 'UNKNOWN', message: String(error) };
}

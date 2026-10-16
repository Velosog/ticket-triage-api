/**
 * An error that maps to an HTTP problem response. `code` is a stable,
 * machine-readable identifier clients can branch on; `detail` is safe to show.
 */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly statusCode: number,
    readonly code: string,
    detail: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

export const unauthorized = (): AppError =>
  new AppError(
    401,
    'unauthenticated',
    'A valid API key is required (Authorization: Bearer <key>).',
    {},
    {
      'www-authenticate': 'Bearer',
    },
  );

export const notFound = (what = 'resource'): AppError =>
  new AppError(404, 'not_found', `The requested ${what} was not found.`);

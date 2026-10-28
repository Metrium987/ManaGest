/**
 * API errors carry stable codes; the client translates them to French.
 * No user-facing prose is produced on the server.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, string>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const fail = (
  status: number,
  code: string,
  details?: Record<string, string>,
): never => {
  throw new ApiError(status, code, details);
};

export const unauthorized = () => fail(401, 'UNAUTHENTICATED');
export const forbidden = () => fail(403, 'FORBIDDEN');
export const notFound = () => fail(404, 'NOT_FOUND');
export const badRequest = (code = 'BAD_REQUEST') => fail(400, code);

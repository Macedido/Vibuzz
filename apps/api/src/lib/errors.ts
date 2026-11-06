export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new AppError(404, 'not_found', `${what} não encontrado.`);
export const forbidden = (msg = 'Sem permissão.') => new AppError(403, 'forbidden', msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const blocked = (msg: string, details?: unknown) => new AppError(422, 'content_blocked', msg, details);

/** Raised by AI providers. `retryable` drives fallback to the next model. */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string,
    public retryable: boolean,
  ) {
    super(`[${provider}] ${message}`);
  }
}

export class NotConfiguredError extends AppError {
  constructor(what: string) {
    super(503, 'not_configured', `Integração não configurada: ${what}. Veja docs/SETUP.md.`);
  }
}

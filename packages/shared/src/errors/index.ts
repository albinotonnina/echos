export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ProcessingError extends AppError {
  constructor(
    message: string,
    retryable: boolean = false,
  ) {
    super(message, 'PROCESSING_ERROR', 500, retryable);
    this.name = 'ProcessingError';
  }
}

export class RateLimitError extends AppError {
  constructor(
    public readonly retryAfterMs: number,
  ) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class SecurityError extends AppError {
  constructor(message: string) {
    super(message, 'SECURITY_ERROR', 403);
    this.name = 'SecurityError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string,
    retryable: boolean = true,
  ) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, retryable);
    this.name = 'ExternalServiceError';
  }
}

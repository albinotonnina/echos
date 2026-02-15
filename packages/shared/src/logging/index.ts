import pino from 'pino';

const redactPaths = [
  'apiKey',
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  '*.apiKey',
  '*.token',
  '*.password',
  '*.secret',
];

export function createLogger(name: string, level: string = 'info'): pino.Logger {
  const options: pino.LoggerOptions = {
    name,
    level,
    redact: redactPaths,
    serializers: {
      err: pino.stdSerializers.err,
    },
  };

  if (process.env['NODE_ENV'] !== 'production') {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  return pino(options);
}

export function createAuditLogger(name: string = 'audit'): pino.Logger {
  return pino({
    name,
    level: 'info',
    redact: redactPaths,
    serializers: {
      err: pino.stdSerializers.err,
    },
  });
}

export interface AuditEvent {
  event: string;
  userId?: number;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export function auditLog(logger: pino.Logger, event: AuditEvent): void {
  logger.info({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
}

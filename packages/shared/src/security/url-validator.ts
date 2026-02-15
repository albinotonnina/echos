import { z } from 'zod';
import { ValidationError, SecurityError } from '../errors/index.js';

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
  /^::1$/,
  /^::$/,
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal', 'metadata.google'];

export function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }
  return PRIVATE_IP_RANGES.some((range) => range.test(hostname));
}

const urlSchema = z.string().url();

export function validateUrl(input: string): string {
  const parsed = urlSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(`Invalid URL: ${input}`);
  }

  const url = new URL(parsed.data);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SecurityError(`Blocked protocol: ${url.protocol}`);
  }

  if (isPrivateIp(url.hostname)) {
    throw new SecurityError('URL points to private/internal network');
  }

  return parsed.data;
}

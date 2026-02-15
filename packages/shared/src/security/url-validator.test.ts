import { describe, it, expect } from 'vitest';
import { validateUrl, isPrivateIp } from './url-validator.js';

describe('isPrivateIp', () => {
  it('should detect localhost', () => {
    expect(isPrivateIp('localhost')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });

  it('should detect private IP ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
  });

  it('should detect metadata endpoints', () => {
    expect(isPrivateIp('metadata.google.internal')).toBe(true);
  });

  it('should allow public IPs', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('example.com')).toBe(false);
  });
});

describe('validateUrl', () => {
  it('should accept valid HTTP URLs', () => {
    expect(validateUrl('https://example.com')).toBe('https://example.com');
    expect(validateUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('should reject invalid URLs', () => {
    expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
    expect(() => validateUrl('')).toThrow('Invalid URL');
  });

  it('should reject non-HTTP protocols', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow('Blocked protocol');
    expect(() => validateUrl('ftp://example.com')).toThrow('Blocked protocol');
  });

  it('should reject private/internal URLs (SSRF prevention)', () => {
    expect(() => validateUrl('http://localhost')).toThrow('private/internal');
    expect(() => validateUrl('http://127.0.0.1')).toThrow('private/internal');
    expect(() => validateUrl('http://192.168.1.1')).toThrow('private/internal');
    expect(() => validateUrl('http://10.0.0.1')).toThrow('private/internal');
    expect(() => validateUrl('http://metadata.google.internal')).toThrow('private/internal');
  });
});

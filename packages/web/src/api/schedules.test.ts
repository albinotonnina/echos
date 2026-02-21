import { describe, it, expect } from 'vitest';
import { isValidCronField, isValidCron } from './schedules.js';

describe('isValidCronField', () => {
  describe('wildcard', () => {
    it('accepts *', () => {
      expect(isValidCronField('*', 0, 59)).toBe(true);
    });
  });

  describe('numeric values', () => {
    it('accepts a value within range', () => {
      expect(isValidCronField('0', 0, 59)).toBe(true);
      expect(isValidCronField('59', 0, 59)).toBe(true);
      expect(isValidCronField('23', 0, 23)).toBe(true);
    });

    it('rejects a value below minimum', () => {
      expect(isValidCronField('0', 1, 12)).toBe(false);
    });

    it('rejects a value above maximum', () => {
      expect(isValidCronField('60', 0, 59)).toBe(false);
    });

    it('rejects non-numeric strings', () => {
      expect(isValidCronField('abc', 0, 59)).toBe(false);
      expect(isValidCronField('every', 0, 59)).toBe(false);
    });
  });

  describe('ranges', () => {
    it('accepts a valid range', () => {
      expect(isValidCronField('1-5', 0, 59)).toBe(true);
      expect(isValidCronField('0-23', 0, 23)).toBe(true);
    });

    it('rejects a range where start > end', () => {
      expect(isValidCronField('5-1', 0, 59)).toBe(false);
    });

    it('rejects a range where end exceeds maximum', () => {
      expect(isValidCronField('1-60', 0, 59)).toBe(false);
    });

    it('rejects a range where start is below minimum', () => {
      expect(isValidCronField('0-5', 1, 12)).toBe(false);
    });

    it('rejects malformed ranges', () => {
      expect(isValidCronField('1-2-3', 0, 59)).toBe(false);
      expect(isValidCronField('-5', 0, 59)).toBe(false);
    });
  });

  describe('steps', () => {
    it('accepts */step', () => {
      expect(isValidCronField('*/5', 0, 59)).toBe(true);
      expect(isValidCronField('*/1', 0, 59)).toBe(true);
    });

    it('accepts range/step', () => {
      expect(isValidCronField('1-5/2', 0, 59)).toBe(true);
    });

    it('rejects step of 0', () => {
      expect(isValidCronField('*/0', 0, 59)).toBe(false);
    });

    it('rejects non-numeric step', () => {
      expect(isValidCronField('*/x', 0, 59)).toBe(false);
    });

    it('rejects missing step after /', () => {
      expect(isValidCronField('*/', 0, 59)).toBe(false);
    });
  });

  describe('comma-separated lists', () => {
    it('accepts a valid list', () => {
      expect(isValidCronField('1,3,5', 0, 59)).toBe(true);
      expect(isValidCronField('0,6', 0, 7)).toBe(true);
    });

    it('rejects a list containing an out-of-range value', () => {
      expect(isValidCronField('1,60', 0, 59)).toBe(false);
    });

    it('accepts a list mixing ranges and values', () => {
      expect(isValidCronField('1,3-5,7', 0, 59)).toBe(true);
    });
  });
});

describe('isValidCron', () => {
  describe('valid expressions', () => {
    it('accepts every-minute wildcard expression', () => {
      expect(isValidCron('* * * * *')).toBe(true);
    });

    it('accepts a specific time (8 AM daily)', () => {
      expect(isValidCron('0 8 * * *')).toBe(true);
    });

    it('accepts every 5 minutes', () => {
      expect(isValidCron('*/5 * * * *')).toBe(true);
    });

    it('accepts a range in the minute field', () => {
      expect(isValidCron('0-30 * * * *')).toBe(true);
    });

    it('accepts a list in the day-of-week field (Mon-Fri)', () => {
      expect(isValidCron('0 9 * * 1-5')).toBe(true);
    });

    it('accepts 0 and 7 for Sunday in day-of-week', () => {
      expect(isValidCron('0 0 * * 0')).toBe(true);
      expect(isValidCron('0 0 * * 7')).toBe(true);
    });

    it('accepts extra whitespace between fields', () => {
      expect(isValidCron('0  8  *  *  *')).toBe(true);
    });
  });

  describe('invalid expressions', () => {
    it('rejects a plain English string', () => {
      expect(isValidCron('every day')).toBe(false);
    });

    it('rejects fewer than 5 fields', () => {
      expect(isValidCron('* * * *')).toBe(false);
    });

    it('rejects more than 5 fields (6-field with seconds)', () => {
      expect(isValidCron('0 * * * * *')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isValidCron('')).toBe(false);
    });

    it('rejects an out-of-range minute', () => {
      expect(isValidCron('60 * * * *')).toBe(false);
    });

    it('rejects an out-of-range hour', () => {
      expect(isValidCron('* 24 * * *')).toBe(false);
    });

    it('rejects an out-of-range month (0)', () => {
      expect(isValidCron('* * * 0 *')).toBe(false);
    });

    it('rejects an out-of-range month (13)', () => {
      expect(isValidCron('* * * 13 *')).toBe(false);
    });

    it('rejects an out-of-range day-of-week (8)', () => {
      expect(isValidCron('* * * * 8')).toBe(false);
    });

    it('rejects non-numeric field values', () => {
      expect(isValidCron('abc * * * *')).toBe(false);
    });
  });
});

export function isValidCronField(field: string, min: number, max: number): boolean {
  if (field.includes(',')) {
    return field.split(',').every((f) => isValidCronField(f, min, max));
  }
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    if (!step || !/^\d+$/.test(step) || parseInt(step, 10) < 1) return false;
    return range === '*' || isValidCronField(range!, min, max);
  }
  if (field.includes('-')) {
    const parts = field.split('-');
    if (parts.length !== 2) return false;
    const [start, end] = parts;
    if (!/^\d+$/.test(start!) || !/^\d+$/.test(end!)) return false;
    const s = parseInt(start!, 10);
    const e = parseInt(end!, 10);
    return s >= min && e <= max && s <= e;
  }
  if (field === '*') return true;
  if (/^\d+$/.test(field)) {
    const n = parseInt(field, 10);
    return n >= min && n <= max;
  }
  return false;
}

// Validates a standard 5-field cron expression: minute hour day-of-month month day-of-week
// Does not support 6-field (with seconds) expressions.
// Day-of-week accepts 0-7 where both 0 and 7 represent Sunday.
export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    isValidCronField(minute!, 0, 59) &&
    isValidCronField(hour!, 0, 23) &&
    isValidCronField(dayOfMonth!, 1, 31) &&
    isValidCronField(month!, 1, 12) &&
    isValidCronField(dayOfWeek!, 0, 7)
  );
}

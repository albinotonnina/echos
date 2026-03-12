import { timingSafeEqual, createHash } from 'node:crypto';

/**
 * Compare two strings in constant time to prevent timing-based side-channel
 * attacks.
 *
 * A naive `a === b` comparison short-circuits on the first differing
 * character, leaking information about _how close_ a guess is to the real
 * secret. This function always does the same amount of work regardless of
 * where the strings differ.
 *
 * Both strings are hashed with SHA-256 before comparison so that the buffers
 * passed to `crypto.timingSafeEqual` are always the same length (avoiding the
 * length side-channel that would exist if we compared raw UTF-8 buffers of
 * different lengths directly).
 *
 * @param a - The candidate value (e.g. value from the request header).
 * @param b - The reference value (e.g. the configured secret).
 * @returns `true` if and only if `a === b`.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  // CodeQL[js/insufficient-password-hash]: SHA-256 is used here for fixed-length
  // normalisation before crypto.timingSafeEqual, not for password storage. Hashing
  // ensures both buffers are always 32 bytes so timingSafeEqual never receives
  // mismatched-length inputs (which would throw and leak a length side-channel).
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Request ID Generator (T027)
 *
 * Generates UUID v4 for request_id.
 * Validates optional idempotency_key is valid UUID (RFC 4122).
 */

import { randomUUID } from 'crypto';

/**
 * RFC 4122 UUID regex pattern
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generates a new UUID v4 request ID
 *
 * @returns UUID v4 string (36 chars with hyphens)
 *
 * @example
 * const requestId = generateRequestId();
 * console.log(requestId); // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Validates that a string is a valid UUID v4 (RFC 4122 format)
 *
 * @param uuid String to validate
 * @returns true if valid UUID, false otherwise
 *
 * @example
 * isValidUuid('550e8400-e29b-41d4-a716-446655440000'); // true
 * isValidUuid('invalid'); // false
 * isValidUuid('550e8400e29b41d4a716446655440000'); // false (no hyphens)
 */
export function isValidUuid(uuid: string): boolean {
  if (typeof uuid !== 'string') {
    return false;
  }

  return UUID_REGEX.test(uuid);
}

/**
 * Validates idempotency key (must be valid UUID if provided)
 *
 * @param idempotencyKey Optional idempotency key
 * @returns Validated idempotency key, or undefined if not provided
 * @throws Error if provided but not valid UUID
 *
 * @example
 * validateIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'); // returns the key
 * validateIdempotencyKey(undefined); // returns undefined
 * validateIdempotencyKey('invalid'); // throws Error
 */
export function validateIdempotencyKey(idempotencyKey?: string): string | undefined {
  if (!idempotencyKey) {
    return undefined;
  }

  if (!isValidUuid(idempotencyKey)) {
    throw new Error(
      'idempotency_key must be a valid UUID (RFC 4122). Example: 550e8400-e29b-41d4-a716-446655440000',
    );
  }

  return idempotencyKey;
}

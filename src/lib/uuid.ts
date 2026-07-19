/**
 * RFC-4122 v4 UUID generator.
 *
 * Used for client-generated primary keys so an offline insert carries its final
 * server id — `crypto.randomUUID` isn't reliably present on Hermes, so we defer
 * to expo-crypto's native CSPRNG-backed implementation. Canonical 8-4-4-4-12
 * format.
 */
import { randomUUID } from 'expo-crypto';

export function uuidv4(): string {
  return randomUUID();
}

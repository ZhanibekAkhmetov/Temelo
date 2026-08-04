/**
 * Device-generated string ID: timestamp (base36) + random suffix.
 * Sufficient for this in-memory prototype; not a UUID implementation.
 */
export function createId(): string {
  const timestampPart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${timestampPart}-${randomPart}`;
}

import { COLLECTIONS } from '@/constants/app';
import { createDoc, listPage, type Cursor, type Page } from './firestore';
import { serverTimestamp } from 'firebase/firestore';
import type { AppUser, AuditAction, AuditLog } from '@/types';

/**
 * Audit trail.
 *
 * Writes are fire-and-forget: an audit failure must never break the action the
 * user was performing. Firestore rules make `auditLogs` append-only — nobody,
 * including admins, can edit or delete an entry from the client.
 */

interface LogInput {
  actor: Pick<AppUser, 'uid' | 'fullName' | 'role'> | null;
  action: AuditAction;
  collection: string;
  documentId?: string;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export async function log(input: LogInput): Promise<void> {
  try {
    await createDoc(COLLECTIONS.auditLogs, {
      actorId: input.actor?.uid ?? 'system',
      actorName: input.actor?.fullName ?? 'System',
      actorRole: input.actor?.role ?? 'system',
      action: input.action,
      collection: input.collection,
      documentId: input.documentId ?? null,
      summary: input.summary,
      changes: input.changes ?? null,
      at: serverTimestamp(),
    });
  } catch (error) {
    console.warn('[audit] could not write audit entry', error);
  }
}

/**
 * Computes a field-level diff so UPDATE entries say what actually changed
 * rather than dumping the whole document.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: string[] = ['updatedAt', 'createdAt', 'id']
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const from = before[key];
    const to = after[key];
    if (to === undefined) continue;
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from: from ?? null, to };
    }
  }
  return changes;
}

export function listLogs(options: {
  cursor?: Cursor;
  actorId?: string;
  action?: AuditAction;
  collectionName?: string;
  pageSize?: number;
}): Promise<Page<AuditLog>> {
  return listPage<AuditLog>(COLLECTIONS.auditLogs, {
    filters: [
      options.actorId ? ['actorId', '==', options.actorId] : null,
      options.action ? ['action', '==', options.action] : null,
      options.collectionName ? ['collection', '==', options.collectionName] : null,
    ],
    orderByField: 'at',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

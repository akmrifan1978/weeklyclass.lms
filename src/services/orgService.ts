import { COLLECTIONS } from '@/constants/app';
import type { AppUser, Branch, ClassRoom, Country, Organization, Subject } from '@/types';
import {
  createDoc,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  type Cursor,
  type Page,
} from './firestore';
import * as audit from './auditService';

/**
 * The organisation hierarchy that makes the platform work worldwide:
 *
 *   Organization -> Branch (in a Country) -> Class -> Teacher + Students
 *
 * No country, city or timezone is hard-coded anywhere in the app; admins add
 * them from the dashboard.
 */

// --- Countries -------------------------------------------------------------

export function listCountries(): Promise<Country[]> {
  return listAll<Country>(COLLECTIONS.countries, {
    orderByField: 'name',
    direction: 'asc',
    pageSize: 300,
  });
}

export async function createCountry(
  data: Pick<Country, 'name' | 'code'> & Partial<Country>,
  actor: AppUser
): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.countries,
    { status: 'active', ...data, code: data.code.toUpperCase() },
    { actorId: actor.uid }
  );
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.countries,
    documentId: id,
    summary: `Added country ${data.name}`,
  });
  return id;
}

// --- Organizations ---------------------------------------------------------

export function listOrganizations(): Promise<Organization[]> {
  return listAll<Organization>(COLLECTIONS.organizations, {
    orderByField: 'name',
    direction: 'asc',
    pageSize: 100,
  });
}

export async function createOrganization(
  data: Pick<Organization, 'name'> & Partial<Organization>,
  actor: AppUser
): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.organizations,
    { status: 'active', ...data },
    { actorId: actor.uid }
  );
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.organizations,
    documentId: id,
    summary: `Added organization ${data.name}`,
  });
  return id;
}

// --- Branches --------------------------------------------------------------

export function listBranches(countryCode?: string): Promise<Branch[]> {
  return listAll<Branch>(COLLECTIONS.branches, {
    filters: [countryCode ? ['countryCode', '==', countryCode] : null],
    orderByField: 'name',
    direction: 'asc',
    pageSize: 200,
  });
}

export function getBranch(id: string): Promise<Branch | null> {
  return getById<Branch>(COLLECTIONS.branches, id);
}

export async function saveBranch(
  data: Partial<Branch> & { name: string; countryCode: string; organizationId: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  if (id) {
    const before = await getBranch(id);
    await updateDocById<Branch>(COLLECTIONS.branches, id, data);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.branches,
      documentId: id,
      summary: `Updated branch ${data.name}`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      ),
    });
    return id;
  }
  const newId = await createDoc(
    COLLECTIONS.branches,
    { status: 'active', ...data },
    { actorId: actor.uid }
  );
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.branches,
    documentId: newId,
    summary: `Added branch ${data.name}`,
  });
  return newId;
}

export async function deleteBranch(id: string, actor: AppUser): Promise<void> {
  const before = await getBranch(id);
  await softDelete(COLLECTIONS.branches, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.branches,
    documentId: id,
    summary: `Removed branch ${before?.name ?? id}`,
  });
}

// --- Classes ---------------------------------------------------------------

export function listClasses(options: {
  branchId?: string;
  teacherId?: string;
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<ClassRoom>> {
  return listPage<ClassRoom>(COLLECTIONS.classes, {
    filters: [
      options.branchId ? ['branchId', '==', options.branchId] : null,
      options.teacherId ? ['teacherIds', 'array-contains', options.teacherId] : null,
    ],
    orderByField: 'name',
    direction: 'asc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 100,
  });
}

/** Classes a teacher is assigned to — the scope for everything they can act on. */
export async function classesForTeacher(teacherId: string): Promise<ClassRoom[]> {
  const page = await listClasses({ teacherId, pageSize: 100 });
  return page.items;
}

export function getClass(id: string): Promise<ClassRoom | null> {
  return getById<ClassRoom>(COLLECTIONS.classes, id);
}

export async function saveClass(
  data: Partial<ClassRoom> & { name: string; branchId: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    language: 'en' as const,
    status: 'active' as const,
    teacherIds: [],
    ...data,
    // Keep `teacherIds` authoritative so class-scoped rules have one source.
    ...(data.teacherId
      ? { teacherIds: Array.from(new Set([...(data.teacherIds ?? []), data.teacherId])) }
      : {}),
  };

  if (id) {
    const before = await getClass(id);
    await updateDocById<ClassRoom>(COLLECTIONS.classes, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.classes,
      documentId: id,
      summary: `Updated class ${data.name}`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.classes, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.classes,
    documentId: newId,
    summary: `Added class ${data.name}`,
  });
  return newId;
}

export async function deleteClass(id: string, actor: AppUser): Promise<void> {
  const before = await getClass(id);
  await softDelete(COLLECTIONS.classes, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.classes,
    documentId: id,
    summary: `Removed class ${before?.name ?? id}`,
  });
}

// --- Subjects --------------------------------------------------------------

export function listSubjects(): Promise<Subject[]> {
  return listAll<Subject>(COLLECTIONS.subjects, {
    orderByField: 'name',
    direction: 'asc',
    pageSize: 100,
  });
}

export async function createSubject(name: string, actor: AppUser): Promise<string> {
  return createDoc(COLLECTIONS.subjects, { name, status: 'active' }, { actorId: actor.uid });
}

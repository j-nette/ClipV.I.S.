export interface OrbPosition {
  x: number;
  y: number;
  z: number;
}

export interface StoredOrb {
  id: string;
  /** World-space fallback, used by legacy or detached orbs. */
  position: OrbPosition;
  /** Stable scene object identifier when the orb is attached to a box. */
  objectId?: string;
  /** Position in the attached object's local space. */
  localPosition?: OrbPosition;
  title: string;
  description: string;
  createdAt: string;
}

export const ORB_STORAGE_KEY = 'clipvis.info.data.orbs';

export function createStoredOrb(
  position: OrbPosition,
  attachment?: { objectId: string; localPosition: OrbPosition },
): StoredOrb {
  return {
    id: makeId(),
    position,
    objectId: attachment?.objectId,
    localPosition: attachment?.localPosition,
    title: '',
    description: '',
    createdAt: new Date().toISOString(),
  };
}

export function loadStoredOrbs(storage: Storage = window.localStorage): StoredOrb[] {
  const raw = storage.getItem(ORB_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredOrb);
  } catch {
    return [];
  }
}

export function saveStoredOrbs(orbs: StoredOrb[], storage: Storage = window.localStorage): void {
  storage.setItem(ORB_STORAGE_KEY, JSON.stringify(orbs));
}

export function clearStoredOrbs(storage: Storage = window.localStorage): void {
  storage.removeItem(ORB_STORAGE_KEY);
}

function isStoredOrb(value: unknown): value is StoredOrb {
  if (!value || typeof value !== 'object') return false;
  const orb = value as Partial<StoredOrb>;
  return (
    typeof orb.id === 'string' &&
    typeof orb.title === 'string' &&
    typeof orb.description === 'string' &&
    typeof orb.createdAt === 'string' &&
    !!orb.position &&
    typeof orb.position.x === 'number' &&
    typeof orb.position.y === 'number' &&
    typeof orb.position.z === 'number' &&
    (orb.objectId === undefined || typeof orb.objectId === 'string') &&
    (orb.localPosition === undefined ||
      (typeof orb.localPosition.x === 'number' &&
        typeof orb.localPosition.y === 'number' &&
        typeof orb.localPosition.z === 'number'))
  );
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `orb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
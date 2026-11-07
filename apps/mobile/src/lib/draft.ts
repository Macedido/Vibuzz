import type { CharacterSheet } from '@vibuzz/shared';

/** Hands an AI-generated sheet to the editor screen (in-memory, one shot). */
export interface Draft {
  kind: 'single' | 'group';
  sheet: CharacterSheet;
  members?: CharacterSheet[];
  avatarPath?: string | null;
  imagePaths?: string[];
  notes?: string[];
  tags?: string[];
}

let pending: Draft | null = null;

export function setDraft(d: Draft) {
  pending = d;
}

export function takeDraft(): Draft | null {
  const d = pending;
  pending = null;
  return d;
}

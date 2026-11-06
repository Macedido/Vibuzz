export const MEMORY_CATEGORIES = [
  'episodic',
  'personal',
  'emotional',
  'social',
  'narrative',
  'preference',
  'short_term',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  episodic: 'Acontecimentos',
  personal: 'Sobre você',
  emotional: 'Emocional',
  social: 'Relações',
  narrative: 'História',
  preference: 'Preferências',
  short_term: 'Curto prazo',
};

export const MEMORY_STATUSES = ['active', 'superseded', 'invalidated', 'needs_rebuild'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const RELATIONSHIP_KINDS = [
  'friendship',
  'trust',
  'rivalry',
  'enmity',
  'family',
  'acquaintance',
  'romantic',
  'other',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = {
  friendship: 'Amizade',
  trust: 'Confiança',
  rivalry: 'Rivalidade',
  enmity: 'Inimizade',
  family: 'Família',
  acquaintance: 'Conhecidos',
  romantic: 'Afetivo',
  other: 'Outro',
};

/** Narrative state kept per conversation branch. */
export interface SceneState {
  location: string;
  present: string[];
  objectives: string[];
  items: string[];
  dangers: string[];
  situation: string;
  recentEvents: string[];
}

export const EMPTY_SCENE: SceneState = {
  location: '',
  present: [],
  objectives: [],
  items: [],
  dangers: [],
  situation: '',
  recentEvents: [],
};

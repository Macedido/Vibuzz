import { z } from 'zod';

/** Limits keep prompts bounded and protect cost. */
export const FIELD_LIMITS = {
  short: 120,
  medium: 1200,
  long: 6000,
} as const;

const short = z.string().trim().max(FIELD_LIMITS.short);
const medium = z.string().trim().max(FIELD_LIMITS.medium);
const long = z.string().trim().max(FIELD_LIMITS.long);

export const relationSchema = z.object({
  /** Name of the other person/character as the creator wrote it. */
  name: short,
  /** friendship, family, rivalry... free text so creators are not boxed in. */
  kind: short,
  description: medium.optional().default(''),
  /** Set when the relation points to another member of the same group. */
  memberId: z.string().uuid().optional(),
});
export type Relation = z.infer<typeof relationSchema>;

/**
 * The structured character sheet ("ficha"). Every field is optional except
 * the name, so creators never have to fill everything.
 */
export const characterSheetSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.short),
  gender: short.optional().default(''),
  age: short.optional().default(''),
  tagline: z.string().trim().max(160).optional().default(''),
  appearance: long.optional().default(''),
  biography: long.optional().default(''),
  personality: long.optional().default(''),
  backstory: long.optional().default(''),
  speechStyle: medium.optional().default(''),
  likes: medium.optional().default(''),
  dislikes: medium.optional().default(''),
  fears: medium.optional().default(''),
  goals: medium.optional().default(''),
  habits: medium.optional().default(''),
  behaviors: medium.optional().default(''),
  relations: z.array(relationSchema).max(30).optional().default([]),
  universe: long.optional().default(''),
  scenario: long.optional().default(''),
  firstMessage: long.optional().default(''),
  instructions: long.optional().default(''),
});
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
export type CharacterSheetInput = z.input<typeof characterSheetSchema>;

export const SHEET_FIELDS: { key: keyof CharacterSheet; label: string; size: 'short' | 'medium' | 'long'; hint?: string }[] = [
  { key: 'name', label: 'Nome', size: 'short' },
  { key: 'gender', label: 'Gênero', size: 'short' },
  { key: 'age', label: 'Idade', size: 'short', hint: 'Opcional' },
  { key: 'tagline', label: 'Frase de apresentação', size: 'short', hint: 'Aparece nos cards' },
  { key: 'appearance', label: 'Descrição física', size: 'long' },
  { key: 'biography', label: 'Biografia', size: 'long' },
  { key: 'personality', label: 'Personalidade', size: 'long' },
  { key: 'backstory', label: 'História e passado', size: 'long' },
  { key: 'speechStyle', label: 'Maneira de falar', size: 'medium' },
  { key: 'likes', label: 'Gostos', size: 'medium' },
  { key: 'dislikes', label: 'Desgostos', size: 'medium' },
  { key: 'fears', label: 'Medos', size: 'medium' },
  { key: 'goals', label: 'Objetivos', size: 'medium' },
  { key: 'habits', label: 'Hábitos', size: 'medium' },
  { key: 'behaviors', label: 'Comportamentos', size: 'medium' },
  { key: 'universe', label: 'Universo', size: 'long' },
  { key: 'scenario', label: 'Cenário inicial', size: 'long' },
  { key: 'firstMessage', label: 'Primeira mensagem', size: 'long' },
  { key: 'instructions', label: 'Instruções adicionais', size: 'long', hint: 'Regras de comportamento para a IA' },
];

/** Fields the AI creator may regenerate one at a time. */
export const REGENERABLE_FIELDS = SHEET_FIELDS.map((f) => f.key).filter((k) => k !== 'name');

export const personaSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.short),
  gender: short.optional().default(''),
  age: short.optional().default(''),
  biography: long.optional().default(''),
  personality: medium.optional().default(''),
  appearance: medium.optional().default(''),
  history: long.optional().default(''),
  extra: medium.optional().default(''),
});
export type PersonaFields = z.infer<typeof personaSchema>;

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MATURITY = ['general', 'teen', 'mature'] as const;
export type Maturity = (typeof MATURITY)[number];

/** Builds an empty, valid sheet. */
export function emptySheet(name = ''): CharacterSheet {
  return characterSheetSchema.parse({ name: name || 'Sem nome' });
}

/** Lists the field keys whose values differ between two sheets (for "preview changes"). */
export function diffSheets(a: CharacterSheet, b: CharacterSheet): (keyof CharacterSheet)[] {
  const keys = Object.keys({ ...a, ...b }) as (keyof CharacterSheet)[];
  return keys.filter((k) => JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? ''));
}

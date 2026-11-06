import { z } from 'zod';

export const IMAGE_KINDS = ['single_character', 'multiple_characters', 'scenery', 'no_reference', 'ambiguous'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const visionSubjectSchema = z.object({
  /** Stable label inside this analysis, e.g. "pessoa 1 (esquerda)". */
  label: z.string(),
  position: z.string().default(''),
  /** Only what can be seen. */
  observable: z.object({
    hair: z.string().default(''),
    eyes: z.string().default(''),
    skin: z.string().default(''),
    build: z.string().default(''),
    clothing: z.string().default(''),
    accessories: z.string().default(''),
    expression: z.string().default(''),
    style: z.string().default(''),
    other: z.string().default(''),
  }),
  apparentAgeRange: z.string().default(''),
  /** Things that cannot be known from the picture. */
  notDeterminable: z.array(z.string()).default([]),
});
export type VisionSubject = z.infer<typeof visionSubjectSchema>;

export const visionAnalysisSchema = z.object({
  kind: z.enum(IMAGE_KINDS),
  summary: z.string(),
  subjects: z.array(visionSubjectSchema).default([]),
  scene: z
    .object({
      setting: z.string().default(''),
      elements: z.array(z.string()).default([]),
      mood: z.string().default(''),
      lighting: z.string().default(''),
    })
    .default({ setting: '', elements: [], mood: '', lighting: '' }),
  artStyle: z.string().default(''),
  /** True when the creator must pick which subject is the character. */
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().default(''),
  safety: z
    .object({
      flagged: z.boolean().default(false),
      reason: z.string().default(''),
      /** Subject appears to be a minor (affects romance/mature use). */
      possibleMinor: z.boolean().default(false),
    })
    .default({ flagged: false, reason: '', possibleMinor: false }),
});
export type VisionAnalysis = z.infer<typeof visionAnalysisSchema>;

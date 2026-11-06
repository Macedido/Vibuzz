/** Categories are seeded in the database with the same slugs. */
export const CATEGORIES = [
  { slug: 'romance', name: 'Romance', mature: false },
  { slug: 'terror', name: 'Terror', mature: false },
  { slug: 'suspense', name: 'Suspense', mature: false },
  { slug: 'fantasia', name: 'Fantasia', mature: false },
  { slug: 'ficcao-cientifica', name: 'Ficção científica', mature: false },
  { slug: 'anime', name: 'Anime', mature: false },
  { slug: 'vida-cotidiana', name: 'Vida cotidiana', mature: false },
  { slug: 'aventura', name: 'Aventura', mature: false },
  { slug: 'drama', name: 'Drama', mature: false },
  { slug: 'comedia', name: 'Comédia', mature: false },
  { slug: 'rpg', name: 'RPG', mature: false },
  { slug: 'misterio', name: 'Mistério', mature: false },
  { slug: 'realistas', name: 'Personagens realistas', mature: false },
  { slug: 'universos', name: 'Universos fictícios', mature: false },
] as const;
export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

export const DISCOVER_SORTS = ['popular', 'recent', 'most_chatted', 'trending', 'most_liked'] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export const SORT_LABELS: Record<DiscoverSort, string> = {
  popular: 'Mais populares',
  recent: 'Mais recentes',
  most_chatted: 'Mais conversados',
  trending: 'Em alta',
  most_liked: 'Mais curtidos',
};

/** Minimum age to create an account, and age to unlock mature content. */
export const MIN_AGE = 13;
export const ADULT_AGE = 18;

export function ageFromBirthdate(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate + 'T00:00:00Z');
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

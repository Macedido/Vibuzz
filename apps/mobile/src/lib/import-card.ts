import { characterSheetSchema, type CharacterSheet } from '@vibuzz/shared';

/**
 * Character cards from other apps: Character Card V1/V2/V3 (TavernAI, SillyTavern,
 * Chub…) as JSON or as a PNG with the card in a text chunk ("chara" / "ccv3").
 */
export interface ImportedCard {
  sheet: CharacterSheet;
  tags: string[];
  source: string;
}

type Card = Record<string, unknown> & { data?: Record<string, unknown>; spec?: string };

const str = (v: unknown, max = 8000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Text chunks of a PNG (tEXt and iTXt, uncompressed). */
export function pngTextChunks(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) return out;
  let p = 8;
  const dec = new TextDecoder('latin1');
  const utf8 = new TextDecoder();
  while (p + 8 <= bytes.length) {
    const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    const kind = dec.decode(bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (kind === 'tEXt') {
      const z = data.indexOf(0);
      if (z > 0) out[dec.decode(data.subarray(0, z))] = dec.decode(data.subarray(z + 1));
    } else if (kind === 'iTXt') {
      const z = data.indexOf(0);
      if (z > 0 && data[z + 1] === 0) {
        let q = z + 3;
        q = data.indexOf(0, q) + 1; // language tag
        q = data.indexOf(0, q) + 1; // translated keyword
        out[dec.decode(data.subarray(0, z))] = utf8.decode(data.subarray(q));
      }
    } else if (kind === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

function decodeBase64Json(b64: string): Card | null {
  try {
    const bin = atob(b64.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Card;
  } catch {
    return null;
  }
}

/** Maps any card version onto a Vibuzz sheet ({{user}}/{{char}} are kept). */
export function cardToSheet(card: Card): ImportedCard {
  const d = (card.data && typeof card.data === 'object' ? card.data : card) as Record<string, unknown>;
  const name = str(d.name, 80) || str(d.char_name, 80) || 'Personagem importado';
  const greetings = Array.isArray(d.alternate_greetings) ? (d.alternate_greetings as unknown[]).map((g) => str(g)).filter(Boolean) : [];
  const instructions = [str(d.system_prompt), str(d.post_history_instructions), str(d.creator_notes, 1200)].filter(Boolean).join('\n\n');
  const examples = str(d.mes_example ?? d.example_dialogue, 3000);
  const sheet = characterSheetSchema.parse({
    name,
    tagline: str(d.tagline ?? d.creator_notes, 140).split('\n')[0] ?? '',
    biography: str(d.description ?? d.char_persona),
    personality: str(d.personality),
    scenario: str(d.scenario ?? d.world_scenario),
    firstMessage: str(d.first_mes ?? d.char_greeting) || greetings[0] || '',
    speechStyle: examples ? `Exemplos de fala:\n${examples}` : '',
    instructions: instructions.slice(0, 4000),
  });
  const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map((t) => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 10) : [];
  return { sheet, tags, source: card.spec ? String(card.spec) : 'character card' };
}

/** Accepts the raw file (JSON text or PNG bytes). Throws a friendly error when nothing is found. */
export function parseCharacterFile(bytes: Uint8Array, fileName: string): ImportedCard {
  if (/\.png$/i.test(fileName) || (bytes[0] === 137 && bytes[1] === 80)) {
    const chunks = pngTextChunks(bytes);
    const raw = chunks.ccv3 ?? chunks.chara ?? chunks.Chara;
    const card = raw ? decodeBase64Json(raw) : null;
    if (!card) throw new Error('Essa imagem não tem uma ficha de personagem dentro.');
    return cardToSheet(card);
  }
  try {
    return cardToSheet(JSON.parse(new TextDecoder().decode(bytes)) as Card);
  } catch {
    throw new Error('Não entendi esse arquivo. Use um .json ou .png de ficha (Character Card V2/V3).');
  }
}

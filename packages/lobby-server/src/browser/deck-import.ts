/**
 * @module deck-import
 *
 * Deck file importers: the native `*.meccg-json` format (a pure JSON copy
 * of the deck data, as produced by the deck editor's download button) and
 * GCCG Middle-earth deck files (`*.deck`).
 *
 * GCCG is the old generic CCG client whose MECCG module exports decks as plain text with
 * `#`-fenced section headers (Deck / Pool / Sideboard / Sideboard vs. fw / Sites), category
 * comments like `# Hero Character (5)`, and card lines of the form
 * `<qty> <Name> [H|M|F|B] (SET)` where the alignment tag and the set code
 * are optional disambiguators. Files are typically ISO-8859-1 encoded.
 *
 * Parsed card names are resolved against the local card pool by name,
 * narrowed by the alignment tag and set code when present. Names that
 * cannot be resolved become entries with `card: null`, which the deck
 * browser and editor already render as missing cards with a request
 * button — so an import never silently drops a card.
 */

import { hasPlayFlag, type CardDefinition } from '@meccg/shared';
import { cardPool, type DeckListEntry, type FullDeck } from './app-state.js';

/** A parsed GCCG deck: all FullDeck sections plus unresolved card names. */
export interface ParsedGccgDeck {
  name: string;
  alignment: string;
  pool: DeckListEntry[];
  deck: { characters: DeckListEntry[]; hazards: DeckListEntry[]; resources: DeckListEntry[] };
  sites: DeckListEntry[];
  sideboard: DeckListEntry[];
  /** Anti-Fallen-wizard sideboard ("Sideboard vs. fw"), kept separate; it joins the sideboard only in game vs a FW opponent. */
  antiFwSideboard: DeckListEntry[];
  /** Card names (with qty) that could not be matched to the card pool. */
  unmatched: string[];
}

/** Extract loosely-typed traits from a card definition for matching. */
const traits = (def: CardDefinition) => def as unknown as {
  name: string; cardType: string; alignment?: string; race?: string;
};

/** GCCG set codes mapped to the card-id prefix used in the local pool. */
const SET_PREFIXES: Record<string, string> = {
  TW: 'tw', TD: 'td', DM: 'dm', LE: 'le', AS: 'as', WH: 'wh', BA: 'ba', PR: 'pr',
};

/**
 * GCCG alignment tags mapped to the card-alignment values they may match.
 * Minion and Fallen-wizard tags also accept dual/stage cards, mirroring
 * how the deck editor's alignment selectors treat them.
 */
const TAG_ALIGNMENTS: Record<string, string[]> = {
  H: ['wizard'],
  M: ['ringwraith', 'dual'],
  F: ['fallen-wizard', 'stage', 'dual'],
  B: ['balrog'],
};

/** Card races that mark a card as an avatar, mapped to the deck alignment. */
const AVATAR_RACE_TO_ALIGNMENT: Record<string, string> = {
  wizard: 'hero',
  ringwraith: 'minion',
  'fallen-wizard': 'fallen-wizard',
  balrog: 'balrog',
};

/**
 * Decode a deck file. Native `.meccg-json` exports are UTF-8, but old GCCG
 * exports are ISO-8859-1; try strict UTF-8 first so newer files with
 * multi-byte characters also decode correctly, and fall back to Latin-1
 * when that fails.
 */
export async function readDeckFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('iso-8859-1').decode(buf);
  }
}

/**
 * Parse text as a native `*.meccg-json` deck export: valid JSON carrying
 * the FullDeck fields. Returns the deck as-is when it matches, or null
 * when the text is not JSON or lacks the deck shape — the caller should
 * then fall back to the GCCG parser.
 */
export function parseMeccgJsonDeck(text: string): FullDeck | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { name?: unknown; alignment?: unknown; pool?: unknown; sites?: unknown; sideboard?: unknown; deck?: Record<string, unknown> };
  if (typeof d.name !== 'string' || typeof d.alignment !== 'string') return null;
  if (!Array.isArray(d.pool) || !Array.isArray(d.sites) || !Array.isArray(d.sideboard)) return null;
  if (typeof d.deck !== 'object' || d.deck === null) return null;
  if (!Array.isArray(d.deck.characters) || !Array.isArray(d.deck.hazards) || !Array.isArray(d.deck.resources)) return null;
  return data as FullDeck;
}

/**
 * Case-insensitive, unicode-normalized key for card-name matching. GCCG
 * files use ASCII apostrophes while the card pool uses typographic ones
 * (’), so apostrophe variants are unified.
 */
function nameKey(name: string): string {
  return name.normalize('NFC').replace(/[‘’]/g, "'").toLowerCase();
}

/**
 * Aggressively folded key for fuzzy matching: diacritics stripped,
 * apostrophes dropped, hyphens treated as spaces. Hand-typed GCCG decks
 * often write "Nain" for "Náin" or "Cave Drake" for "Cave-drake".
 */
function foldKey(name: string): string {
  return nameKey(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact and folded name → candidate card ids indexes, built once per import. */
interface NameIndex { exact: Map<string, string[]>; folded: Map<string, string[]> }

/** Build the name → candidate card ids indexes from the card pool. */
function buildNameIndex(): NameIndex {
  const exact = new Map<string, string[]>();
  const folded = new Map<string, string[]>();
  for (const [cardId, def] of Object.entries(cardPool)) {
    const key = nameKey(def.name);
    exact.set(key, [...(exact.get(key) ?? []), cardId]);
    const fold = foldKey(def.name);
    folded.set(fold, [...(folded.get(fold) ?? []), cardId]);
  }
  return { exact, folded };
}

/**
 * Resolve a parsed card line to a card id: candidates sharing the name are
 * narrowed by set code and alignment tag when given. If the narrowing
 * eliminates every candidate (e.g. a set we do not carry), fall back to the
 * unnarrowed name matches rather than losing the card. Ties resolve to the
 * lexicographically first id so imports are deterministic.
 */
function resolveCard(
  index: NameIndex, name: string, tag: string | undefined, set: string | undefined,
): string | null {
  const candidates = index.exact.get(nameKey(name)) ?? index.folded.get(foldKey(name)) ?? [];
  if (candidates.length === 0) return null;
  let narrowed = candidates;
  const prefix = set ? SET_PREFIXES[set.toUpperCase()] : undefined;
  if (prefix) {
    const bySet = narrowed.filter(id => id.startsWith(`${prefix}-`));
    if (bySet.length > 0) narrowed = bySet;
  }
  const alignments = tag ? TAG_ALIGNMENTS[tag.toUpperCase()] : undefined;
  if (alignments) {
    const byTag = narrowed.filter(id => alignments.includes(traits(cardPool[id]).alignment ?? ''));
    if (byTag.length > 0) narrowed = byTag;
  }
  return [...narrowed].sort()[0];
}

/** Whether a line is a `####`-style section fence. */
function isFence(line: string): boolean {
  return /^#{3,}\s*$/.test(line);
}

/**
 * Pick the deck's name from the file's opening comment block: the last
 * non-empty comment before the first section that is not the GCCG
 * version banner. Falls back to the given name (usually the filename).
 */
function parseDeckName(lines: string[], fallback: string): string {
  let name = '';
  for (const line of lines) {
    if (isFence(line)) break;
    const m = line.match(/^#\s+(\S.*?)\s*$/);
    if (m && !m[1].includes('GCCG')) name = m[1];
  }
  return name || fallback;
}

/**
 * Infer the deck alignment: an avatar among the deck characters decides it
 * (a deck is built around its avatar); otherwise any stage resource marks a
 * Fallen-wizard deck (only they may play stage cards), any minion-aligned
 * card a minion deck, and everything else defaults to hero.
 */
function inferAlignment(parsed: ParsedGccgDeck): string {
  const all = [
    ...parsed.deck.characters, ...parsed.pool, ...parsed.deck.resources,
    ...parsed.sideboard, ...parsed.antiFwSideboard, ...parsed.sites,
  ];
  for (const entry of [...parsed.deck.characters, ...parsed.pool]) {
    const race = entry.card ? traits(cardPool[entry.card]).race : undefined;
    const alignment = race ? AVATAR_RACE_TO_ALIGNMENT[race] : undefined;
    if (alignment) return alignment;
  }
  const alignments = all.map(e => (e.card ? traits(cardPool[e.card]).alignment : undefined));
  if (alignments.some(a => a === 'stage' || a === 'fallen-wizard')) return 'fallen-wizard';
  if (alignments.some(a => a === 'ringwraith')) return 'minion';
  return 'hero';
}

/**
 * Parse a GCCG `*.deck` file into deck sections with resolved card ids.
 * The play deck's split into characters/hazards/resources follows the
 * category comments (`# Hero Character (5)`, `# Hazard (30)`, ...); a line
 * without a preceding category falls back to its resolved card type.
 */
export function parseGccgDeck(text: string, fallbackName: string): ParsedGccgDeck {
  const lines = text.split(/\r?\n/);
  const index = buildNameIndex();
  const parsed: ParsedGccgDeck = {
    name: parseDeckName(lines, fallbackName),
    alignment: 'hero',
    pool: [],
    deck: { characters: [], hazards: [], resources: [] },
    sites: [],
    sideboard: [],
    antiFwSideboard: [],
    unmatched: [],
  };

  // The anti-FW sideboard ("Sideboard vs. fw") is its own deck section —
  // it must never be mixed into the main sideboard on import; the two are
  // merged only in game, against a Fallen-wizard opponent.
  const normalizeSection = (name: string) => {
    if (!name.startsWith('sideboard')) return name;
    return /\bf(w|allen)/.test(name) ? 'sideboard vs fw' : 'sideboard';
  };

  let section = '';
  let category = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isFence(line)) {
      // A section header is a fence/name/fence triple; consume all three
      // lines. A lone fence (should not occur) is skipped.
      if (i + 2 < lines.length && !isFence(lines[i + 1]) && isFence(lines[i + 2])) {
        section = normalizeSection(lines[i + 1].trim().toLowerCase());
        category = '';
        i += 2;
      }
      continue;
    }
    // Older GCCG versions (0.8.x) write bare section names without fences.
    const bare = normalizeSection(line.toLowerCase());
    if (bare === 'deck' || bare === 'pool' || bare === 'sideboard' || bare === 'sideboard vs fw' || bare === 'sites') {
      section = bare;
      category = '';
      continue;
    }
    const categoryMatch = line.match(/^#\s+(.+?)\s*(?:\(\d+\))?\s*$/);
    if (categoryMatch) {
      category = categoryMatch[1].toLowerCase();
      continue;
    }
    const cardMatch = line.match(/^(\d+)\s+(.+?)(?:\s+\[(\w+)\])?(?:\s+\((\w+)\))?\s*$/);
    if (!cardMatch || !section) continue;
    const [, qtyStr, name, tag, set] = cardMatch;
    const qty = parseInt(qtyStr, 10);
    // A trailing parenthesis is usually a set code, but dual-named cards
    // like "Doeth (Durthak)" carry one in the card name itself — when the
    // set-code reading matches nothing, retry with the parenthetical
    // restored into the name.
    const card = resolveCard(index, name, tag, set)
      ?? (set ? resolveCard(index, `${name} (${set})`, tag, undefined) : null);
    if (!card) parsed.unmatched.push(`${qty}x ${name}`);
    const entry: DeckListEntry = { name: card ? cardPool[card].name : name, card, qty };

    if (section === 'pool') parsed.pool.push(entry);
    else if (section === 'sideboard') parsed.sideboard.push(entry);
    else if (section === 'sideboard vs fw') parsed.antiFwSideboard.push(entry);
    else if (section === 'sites') parsed.sites.push(entry);
    else if (section === 'deck') {
      // The file's category comment is authoritative — the section split is
      // never re-derived from local card data. Agents such as My Precious
      // (dm-29) are hazards that the engine merely models with a character
      // cardType, so type-based bucketing would misfile them out of the
      // hazard section the file placed them in. The resolved card type is
      // only a fallback for category-less files.
      const cardType = card ? traits(cardPool[card]).cardType : '';
      const isCharacter = category
        ? category.includes('character')
        : cardType.includes('-character');
      const isHazard = category
        ? category.startsWith('hazard') || category.startsWith('agent')
        : cardType.startsWith('hazard');
      if (isCharacter) {
        parsed.deck.characters.push(entry);
      } else if (isHazard) {
        parsed.deck.hazards.push(entry);
      } else {
        parsed.deck.resources.push(entry);
      }
    }
  }

  parsed.alignment = inferAlignment(parsed);

  // Agents: GCCG exports agent cards under a "Minion Character" category,
  // but a hero deck can never field a minion character — there it is an
  // agent played as a hazard. Re-file once the deck alignment is known.
  if (parsed.alignment === 'hero') {
    const isAgent = (e: DeckListEntry) =>
      e.card !== null && traits(cardPool[e.card]).cardType === 'minion-character';
    const agents = parsed.deck.characters.filter(isAgent);
    if (agents.length > 0) {
      parsed.deck.characters = parsed.deck.characters.filter(e => !isAgent(e));
      parsed.deck.hazards.push(...agents);
    }
  }

  rebalanceDualPurpose(parsed);
  return parsed;
}

/**
 * Whether a deck entry resolves to a dual-purpose card: a hazard flagged
 * `playable-as-resource` (e.g. Twilight), which rule 1.3.3 lets a deck count
 * as either a hazard or a resource for deck construction.
 */
function isDualPurpose(entry: DeckListEntry): boolean {
  if (entry.card === null) return false;
  const def = cardPool[entry.card];
  return def !== undefined && 'effects' in def && hasPlayFlag(def, 'playable-as-resource');
}

/**
 * Even out the play deck's hazard and resource counts by re-filing
 * dual-purpose cards. Rule 1.30 requires equally many hazards and resources,
 * and GCCG files often list every copy of a dual card (e.g. Twilight) under a
 * single category — however the deck's author counted them, importing that
 * split verbatim can leave the sections unequal. Each moved copy shrinks the
 * difference by two, so ⌊difference/2⌋ copies are moved from the larger
 * section to the smaller (an odd difference gets as close as dual cards can).
 * A Fallen-wizard may count at most two copies of each dual card as
 * resources (rule 1.3.F2), so moves into the resources section stop at that
 * cap.
 */
function rebalanceDualPurpose(parsed: ParsedGccgDeck): void {
  const total = (entries: DeckListEntry[]) => entries.reduce((sum, e) => sum + e.qty, 0);
  const diff = total(parsed.deck.hazards) - total(parsed.deck.resources);
  let moves = Math.floor(Math.abs(diff) / 2);
  if (moves === 0) return;
  const intoResources = diff > 0;
  const [from, to] = intoResources
    ? [parsed.deck.hazards, parsed.deck.resources]
    : [parsed.deck.resources, parsed.deck.hazards];
  const resourceCopies = (card: string | null) =>
    total(parsed.deck.resources.filter(e => e.card === card));
  for (const entry of [...from]) {
    if (moves === 0) break;
    if (!isDualPurpose(entry)) continue;
    let qty = Math.min(entry.qty, moves);
    if (intoResources && parsed.alignment === 'fallen-wizard') {
      qty = Math.min(qty, Math.max(0, 2 - resourceCopies(entry.card)));
      if (qty === 0) continue;
    }
    entry.qty -= qty;
    if (entry.qty === 0) from.splice(from.indexOf(entry), 1);
    const existing = to.find(e => e.card === entry.card);
    if (existing) existing.qty += qty;
    else to.push({ name: entry.name, card: entry.card, qty });
    moves -= qty;
  }
}

/** Total number of card entries parsed into all sections of a deck. */
export function parsedCardCount(parsed: ParsedGccgDeck): number {
  return [
    ...parsed.pool, ...parsed.deck.characters, ...parsed.deck.hazards,
    ...parsed.deck.resources, ...parsed.sites, ...parsed.sideboard,
    ...parsed.antiFwSideboard,
  ].reduce((sum, e) => sum + e.qty, 0);
}

/** Convert a parsed deck into a FullDeck ready to be saved, under the given id. */
export function toFullDeck(parsed: ParsedGccgDeck, id: string): FullDeck {
  return {
    id,
    name: parsed.name,
    alignment: parsed.alignment,
    pool: parsed.pool,
    deck: parsed.deck,
    sites: parsed.sites,
    sideboard: parsed.sideboard,
    antiFwSideboard: parsed.antiFwSideboard,
  };
}

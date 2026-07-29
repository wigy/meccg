/**
 * @module decks
 *
 * Deck catalog loading for the simulation harness. Reads the on-disk deck
 * files (`data/decks/*.json`), expands `{card, qty}` entries into flat
 * definition-ID lists, and converts a deck into the engine's
 * {@link PlayerConfig} for game creation. The text clients reuse these
 * helpers to build their join messages from the same catalog.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId, PlayerConfig, PlayerId } from '@meccg/shared';

/** Deck file entry with optional card ID. */
export interface DeckEntry {
  name: string;
  card: string | null;
  qty: number;
}

/** On-disk deck structure (`data/decks/*.json`). */
export interface DeckFile {
  id: string;
  name: string;
  alignment: string;
  /** Human-reviewed as actually playable; absent means not approved. */
  approved?: boolean;
  pool: DeckEntry[];
  deck: { characters: DeckEntry[]; hazards: DeckEntry[]; resources: DeckEntry[] };
  sites: DeckEntry[];
  sideboard?: DeckEntry[];
}

/**
 * Deck catalog directory at the repository root. Both the tsx source layout
 * (`packages/sim/src`) and the compiled layout (`packages/sim/dist`) sit
 * three levels below the repo root.
 */
export const DECK_CATALOG_DIR = path.join(__dirname, '../../../data/decks');

/** Map deck-file alignment strings to engine alignments. */
export const DECK_ALIGNMENT_MAP: Record<string, Alignment> = {
  hero: Alignment.Wizard,
  minion: Alignment.Ringwraith,
  'fallen-wizard': Alignment.FallenWizard,
  balrog: Alignment.Balrog,
};

/** Expand `{card, qty}` deck entries into a flat list of definition IDs. */
export function expandEntries(entries: DeckEntry[]): CardDefinitionId[] {
  const ids: CardDefinitionId[] = [];
  for (const e of entries) {
    if (e.card !== null) {
      for (let i = 0; i < e.qty; i++) ids.push(e.card as CardDefinitionId);
    }
  }
  return ids;
}

/** A catalog deck expanded into the flat card lists the engine consumes. */
export interface LoadedDeck {
  /** Catalog ID (file basename). */
  readonly id: string;
  /** Deck display name. */
  readonly name: string;
  /** Engine alignment. */
  readonly alignment: Alignment;
  /** Deck-file alignment string (hero / minion / fallen-wizard / balrog). */
  readonly alignmentLabel: string;
  /**
   * Human-reviewed as actually playable (see `DeckList.approved`). Training
   * and rated play should use approved decks only: an unapproved deck may
   * produce games the engine cannot finish.
   */
  readonly approved: boolean;
  readonly draftPool: readonly CardDefinitionId[];
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly sideboard: readonly CardDefinitionId[];
  /**
   * The unexpanded catalog entry. The text clients forward it as
   * `JoinMessage.deckList` so a lobby-spawned seat validates against the same
   * structured deck the editor would send, and so the completed-game record
   * keeps the deck's identity (id, name) instead of an anonymous card list.
   */
  readonly file: DeckFile;
}

/** Load and expand a catalog deck by ID (e.g. "challenge-deck-a"). */
export function loadDeck(deckId: string): LoadedDeck {
  const filePath = path.join(DECK_CATALOG_DIR, `${deckId}.json`);
  const deck = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeckFile;
  return {
    id: deck.id,
    name: deck.name,
    approved: deck.approved === true,
    alignment: DECK_ALIGNMENT_MAP[deck.alignment] ?? Alignment.Wizard,
    alignmentLabel: deck.alignment,
    draftPool: expandEntries(deck.pool),
    playDeck: [
      ...expandEntries(deck.deck.characters),
      ...expandEntries(deck.deck.resources),
      ...expandEntries(deck.deck.hazards),
    ],
    siteDeck: expandEntries(deck.sites),
    sideboard: expandEntries(deck.sideboard ?? []),
    file: deck,
  };
}

/** List `{id, name}` of every deck in the catalog. */
export function listDecks(): { id: string; name: string; approved: boolean }[] {
  const files = fs.readdirSync(DECK_CATALOG_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(DECK_CATALOG_DIR, f), 'utf-8')) as DeckFile;
    return { id: d.id, name: d.name, approved: d.approved === true };
  });
}

/**
 * Catalog decks a human has approved as actually playable. This is the
 * correct default for training data and rated matches — see
 * `DeckList.approved` for why unapproved decks are unsafe to learn from.
 */
export function listApprovedDecks(): { id: string; name: string; approved: boolean }[] {
  return listDecks().filter(d => d.approved);
}

/** Convert a loaded deck into the engine's per-player game configuration. */
export function deckToPlayerConfig(deck: LoadedDeck, id: PlayerId, name: string): PlayerConfig {
  return {
    id,
    name,
    alignment: deck.alignment,
    draftPool: deck.draftPool,
    playDeck: deck.playDeck,
    siteDeck: deck.siteDeck,
    sideboard: deck.sideboard,
  };
}

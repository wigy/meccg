/**
 * @module sample-decks
 *
 * Named sample deck configurations used by both the web and text clients.
 * Each deck specifies a complete {@link JoinMessage} template (minus the
 * player name) including alignment, draft pool, play deck, site deck, and
 * starting items/havens.
 *
 * Clients present these as a selectable list so players can pick a deck
 * before connecting. Adding a new deck here makes it available everywhere.
 */

import type { JoinMessage, CardDefinitionId } from './types/index.js';
import { Alignment } from './types/common.js';
import {
  // Hero characters
  ARAGORN, BILBO, FRODO, SAM_GAMGEE, ELROND, CELEBORN, THEODEN,
  EOWYN, BEREGOND, ANBORN,
  GANDALF, LEGOLAS, GIMLI, FARAMIR, BEORN, GLORFINDEL_II,
  // Hero items
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  // Minion items
  SAW_TOOTHED_BLADE, ORC_DRAUGHTS,
  // Creatures
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  // Hero sites
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  // Minion characters
  THE_MOUTH, LIEUTENANT_OF_DOL_GULDUR, GORBAG, SHAGRAT,
  // Minion sites
  DOL_GULDUR, MINAS_MORGUL, ETTENMOORS, THE_WHITE_TOWERS_MINION, WEATHERTOP,
} from './card-ids.js';

/** A named sample deck that can be selected before connecting. */
export interface SampleDeck {
  /** Short identifier used on the command line (e.g. "hero", "minion"). */
  readonly id: string;
  /** Display name shown in UI selectors. */
  readonly label: string;
  /** Build a complete JoinMessage for this deck with the given player name. */
  buildJoinMessage(playerName: string): JoinMessage;
}

/** Repeat a set of cards N times (for filling play decks). */
function repeatCards(cards: CardDefinitionId[], times: number): CardDefinitionId[] {
  const result: CardDefinitionId[] = [];
  for (let i = 0; i < times; i++) {
    result.push(...cards);
  }
  return result;
}

/** Hero wizard deck — balanced fellowship with major items and hazard creatures. */
const heroDeck: SampleDeck = {
  id: 'hero',
  label: 'Gandalf\'s Company (Hero)',
  buildJoinMessage(playerName: string): JoinMessage {
    const characters = [GANDALF, LEGOLAS, GIMLI, FARAMIR, BEORN, GLORFINDEL_II];
    const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
    const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
    return {
      type: 'join',
      name: playerName,
      alignment: Alignment.Wizard,
      draftPool: [ARAGORN, BILBO, FRODO, SAM_GAMGEE, ELROND, CELEBORN, THEODEN,
        EOWYN, BEREGOND, ANBORN],
      startingMinorItems: [DAGGER_OF_WESTERNESSE, HORN_OF_ANOR],
      playDeck: [...characters, ...repeatCards([...resources, ...hazards], 5)],
      siteDeck: [RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM],
      startingHavens: [RIVENDELL],
    };
  },
};

/** Minion deck — servants of Sauron operating from dark havens. */
const minionDeck: SampleDeck = {
  id: 'minion',
  label: 'Forces of Darkness (Minion)',
  buildJoinMessage(playerName: string): JoinMessage {
    const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
    return {
      type: 'join',
      name: playerName,
      alignment: Alignment.Ringwraith,
      draftPool: [THE_MOUTH, LIEUTENANT_OF_DOL_GULDUR, GORBAG, SHAGRAT],
      startingMinorItems: [SAW_TOOTHED_BLADE, ORC_DRAUGHTS],
      playDeck: repeatCards(hazards, 10),
      siteDeck: [DOL_GULDUR, MINAS_MORGUL, ETTENMOORS, THE_WHITE_TOWERS_MINION, WEATHERTOP],
      startingHavens: [DOL_GULDUR],
    };
  },
};

/** All available sample decks, in display order. */
export const SAMPLE_DECKS: readonly SampleDeck[] = [heroDeck, minionDeck];

/**
 * Find a sample deck by its short ID (case-insensitive).
 * Returns undefined if no deck matches.
 */
export function findSampleDeck(id: string): SampleDeck | undefined {
  const lower = id.toLowerCase();
  return SAMPLE_DECKS.find(d => d.id === lower);
}

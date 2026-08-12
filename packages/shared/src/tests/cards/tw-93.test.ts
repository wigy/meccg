/**
 * @module tw-93.test
 *
 * Card test: The Balance of Things (tw-93)
 * Type: hazard-event (long-event), Neutral, Unique
 *
 * "Unique. Each character has the corruption points doubled for one of his
 *  sources of corruption (the player controlling the character chooses)."
 *
 * Mechanic tested (new `corruption-source-multiplier` effect): while this
 * long-event sits in either player's `cardsInPlay`, every character in play has
 * ONE of its corruption sources scaled by the multiplier (2 — "doubled"). The
 * controlling player minimises the corruption they suffer, so the engine
 * doubles the character's SMALLEST corruption source. A "source" is a distinct
 * corruption-bearing card the character holds: an item worth corruption points
 * (structural `corruptionPoints`) or a card contributing corruption via a
 * `stat-modifier` on `corruption-points` (e.g. Durin's Axe on a Dwarf). A
 * character with no corruption source is unaffected. The effect reaches
 * characters controlled by BOTH players ("each character").
 *
 * Fixture alignment: neutral hazard, exercised against hero companies — hero
 * characters (Gimli tw-159 dwarf, Beorn tw-126 man) at hero havens (Rivendell
 * tw-421, Lórien tw-408) bearing hero items with printed corruption points:
 * Athelas (tw-195, cp 1), Red Arrow (tw-312, cp 2), Palantír of Amon Sûl
 * (tw-296, cp 3). Durin's Axe (tw-212, cp 0 structural, +3 corruption via a
 * `stat-modifier` gated on a Dwarf bearer) exercises the effect-sourced path.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  addCardInPlay, attachItemToChar,
  charIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Alignment } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const BALANCE_OF_THINGS = 'tw-93' as CardDefinitionId; // neutral long-event hazard
const GIMLI = 'tw-159' as CardDefinitionId;            // hero-character, dwarf
const BEORN = 'tw-126' as CardDefinitionId;            // hero-character, man
const RIVENDELL = 'tw-421' as CardDefinitionId;        // hero haven
const LORIEN = 'tw-408' as CardDefinitionId;           // hero haven
const ATHELAS = 'tw-195' as CardDefinitionId;          // hero item, cp 1
const RED_ARROW = 'tw-312' as CardDefinitionId;        // hero item, cp 2
const PALANTIR_AMON_SUL = 'tw-296' as CardDefinitionId;// hero item, cp 3
const DURINS_AXE = 'tw-212' as CardDefinitionId;       // hero item, base 2 corruption + 1 more on a Dwarf (stat-modifier)

/** Corruption points of a character after recomputing derived stats. */
function cpOf(state: ReturnType<typeof buildTestState>, playerIdx: number): number {
  const charId = charIdAt(state, playerIdx);
  return state.players[playerIdx].characters[charId].effectiveStats.corruptionPoints;
}

function heroState(company1: { site: CardDefinitionId; characters: CardDefinitionId[] },
                   company2: { site: CardDefinitionId; characters: CardDefinitionId[] }) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [company1], hand: [], siteDeck: [LORIEN] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [company2], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('The Balance of Things (tw-93)', () => {
  beforeEach(() => resetMint());

  test('doubles only the SMALLEST of several corruption sources', () => {
    let base = heroState(
      { site: RIVENDELL, characters: [GIMLI] },
      { site: LORIEN, characters: [BEORN] },
    );
    // Gimli bears three corruption items: 1 + 2 + 3 = 6.
    base = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, ATHELAS);
    base = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, RED_ARROW);
    base = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GIMLI, PALANTIR_AMON_SUL));
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(6);

    // Balance in play doubles the smallest source (Athelas, 1): 6 + 1 = 7.
    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(7);
  });

  test('doubles a single corruption source', () => {
    let base = heroState(
      { site: RIVENDELL, characters: [BEORN] },
      { site: LORIEN, characters: [GIMLI] },
    );
    base = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, BEORN, RED_ARROW)); // cp 2
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(2);

    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(4);
  });

  test('a character with no corruption source is unaffected', () => {
    const base = heroState(
      { site: RIVENDELL, characters: [BEORN] },
      { site: LORIEN, characters: [GIMLI] },
    );
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(0);

    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(0);
  });

  test('affects characters controlled by BOTH players ("each character")', () => {
    let base = heroState(
      { site: RIVENDELL, characters: [GIMLI] }, // player 0
      { site: LORIEN, characters: [BEORN] },    // player 1
    );
    base = recomputeDerived(
      attachItemToChar(
        attachItemToChar(base, RESOURCE_PLAYER, GIMLI, RED_ARROW), // cp 2
        HAZARD_PLAYER, BEORN, PALANTIR_AMON_SUL,                   // cp 3
      ),
    );
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(2);
    expect(cpOf(base, HAZARD_PLAYER)).toBe(3);

    // Balance played into player 0's cardsInPlay doubles a source on BOTH
    // players' characters.
    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(4); // 2 + 2
    expect(cpOf(withBalance, HAZARD_PLAYER)).toBe(6);   // 3 + 3
  });

  test('doubles a corruption source contributed via a stat-modifier (Durin\'s Axe on a Dwarf)', () => {
    let base = heroState(
      { site: RIVENDELL, characters: [GIMLI] }, // dwarf → axe grants +3 corruption
      { site: LORIEN, characters: [BEORN] },    // man → axe grants nothing
    );
    base = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, DURINS_AXE);
    base = recomputeDerived(attachItemToChar(base, HAZARD_PLAYER, BEORN, DURINS_AXE));
    // Dwarf: base 2 + effect 1 = 3 corruption; Man: base 2 only.
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(3);
    expect(cpOf(base, HAZARD_PLAYER)).toBe(2);

    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(4); // smallest source (effect, 1) doubled: 3 + 1
    expect(cpOf(withBalance, HAZARD_PLAYER)).toBe(4);   // item's base cp (2) is a source too: 2 + 2
  });

  test('picks the smallest source across effect-sourced and item-sourced corruption', () => {
    let base = heroState(
      { site: RIVENDELL, characters: [GIMLI] },
      { site: LORIEN, characters: [BEORN] },
    );
    // Durin's Axe (base item cp 2 + effect 1 on Dwarf) + Athelas (item, cp 1): total 4.
    base = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, DURINS_AXE);
    base = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GIMLI, ATHELAS));
    expect(cpOf(base, RESOURCE_PLAYER)).toBe(4);

    // Smallest source is the axe's effect or Athelas (both 1): 4 + 1 = 5.
    const withBalance = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BALANCE_OF_THINGS));
    expect(cpOf(withBalance, RESOURCE_PLAYER)).toBe(5);
  });
});

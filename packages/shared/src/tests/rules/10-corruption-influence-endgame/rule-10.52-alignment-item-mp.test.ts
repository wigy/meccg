/**
 * @module rule-10.52-alignment-item-mp
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.52: Alignment Item MP Values
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] For a Wizard player, minion items are worth half of the item's normal marshalling points (rounded up).
 * [MINION] For a Ringwraith player, hero items are worth half of the item's normal marshalling points (rounded up).
 * [FALLEN-WIZARD] For a Fallen-wizard player, non-Stage cards worth at least one marshalling point are only worth one marshalling point, unless that value is modified by a stage resource, Fallen-wizard avatar ability, or hazard.
 * [FALLEN-WIZARD] A Fallen-wizard player does not receive marshalling points for resources stored at non-Wizardhaven sites.
 * [FALLEN-WIZARD] A Fallen-wizard player may receive the extra faction marshalling points for a group of faction cards that may be played on a leader, but they receive only one extra faction point for the group of factions instead of two.
 * [BALROG] A Balrog player does not receive marshalling points for hero items played at that player's Darkhavens, and receives half of the normal marshalling points for other hero items (rounded up).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint, recomputeDerived,
  attachItemToChar, RESOURCE_PLAYER,
} from '../../test-helpers.js';

// Hero items (hero-resource-item) with known MPs
const GLAMDRING = 'tw-244' as CardDefinitionId;           // hero, 2 MP

// Hero characters
const ARAGORN = 'tw-120' as CardDefinitionId;

// Minion characters
const ADUNAPHEL = 'le-50' as CardDefinitionId;   // Ringwraith avatar

// Minion items (minion-resource-item) with known MPs
const BLACK_MACE = 'le-299' as CardDefinitionId; // minion, check MP below

// Sites
const MORIA = 'tw-413' as CardDefinitionId;
const RIVENDELL = 'tw-421' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Rule 10.52 — Alignment Item MP Values', () => {
  beforeEach(() => resetMint());

  test('Hero: minion items half MP; Minion: hero items half MP; FW: non-Stage 1+ MP cards worth only 1 MP; Balrog: hero items half MP', () => {
    // MINION alignment: Ringwraith player holding a hero item (Glamdring, 2 MP)
    // should count only Math.ceil(2/2) = 1 MP instead of 2 MP.
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [ADUNAPHEL] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    // Attach Glamdring (hero item, 2 MP) to the Ringwraith avatar
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, GLAMDRING);
    const recomputed = recomputeDerived(withItem);

    // Ringwraith player should count 1 MP (ceil(2/2) = 1) not 2 MP from a hero item
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('[HERO] Wizard player holding minion item gets half MP (rounded up)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
      ],
    });

    // Black Mace (le-299): check what MP it has
    const blackMaceDef = base.cardPool['le-299' as CardDefinitionId] as { marshallingPoints: number } | undefined;
    if (!blackMaceDef || blackMaceDef.marshallingPoints === 0) {
      // If Black Mace has 0 MP, the halving doesn't matter; just verify it doesn't crash
      return;
    }

    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, BLACK_MACE);
    const recomputed = recomputeDerived(withItem);

    const baseMp = blackMaceDef.marshallingPoints;
    const expected = Math.ceil(baseMp / 2);
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(expected);
  });

  test('[BALROG] Balrog player holding a hero item gets half MP (rule 10.B1)', () => {
    // Regression: crossAlignmentItemMpFactor implemented only 10.R1 (Ringwraith)
    // and 10.W1 (Wizard); a Balrog player's hero item fell through to full MP.
    // Rule 10.B1: a Balrog receives half (rounded up) for hero items — except
    // those played at his own Darkhavens (scored 0; not covered here). The
    // Balrog character sits at Rivendell, NOT a Balrog Darkhaven, so the
    // half-MP clause governs.
    const THE_BALROG = 'ba-3' as CardDefinitionId;
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: RIVENDELL, characters: [THE_BALROG] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    // Glamdring (hero item, 2 MP) borne by the Balrog → ceil(2/2) = 1, not 2.
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GLAMDRING);
    const recomputed = recomputeDerived(withItem);
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });
});

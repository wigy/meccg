/**
 * @module le-53.test
 *
 * Card test: Hoarmûrath the Ringwraith (le-53)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 8, body 9, direct influence 3, mind null.
 * Skills: scout, ranger, sage. Homesite: Any site in Udûn.
 *
 * Card text:
 *   "Unique. Manifestation of Hoarmûrath of Dír. Can use sorcery. +1 direct
 *    influence in Heralded Lord mode. +2 prowess in Fell Rider mode. As your
 *    Ringwraith, if at a Darkhaven [{DH}], you may keep one more card than
 *    normal in your hand."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                                          |
 * |---|--------------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | +1 direct influence in Heralded Lord mode        | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode === heralded-lord`|
 * | 2 | +2 prowess in Fell Rider mode                    | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode === fell-rider`   |
 * | 3 | +1 hand size at a Darkhaven                      | IMPLEMENTED | hand-size-modifier gated on `self.atDarkhaven`                  |
 * | 4 | Can use sorcery                                  | N/A         | No engine consumer: spell-casting is not gated by caster skill |
 * | 5 | Manifestation of Hoarmûrath of Dír (tw-44)       | IMPLEMENTED | `manifestId` chain + on-event self-enters-play discard (rule 3.06) |
 *
 * The Ringwraith mode is established by a mode card (Black Rider le-170, Fell
 * Rider le-183, Heralded Lord le-190) bound to the company via
 * `CardInPlay.companyId`. The avatar's per-mode stat changes are surfaced through
 * `bearer.ringwraithMode` and flow into `effectiveStats` — which is the single
 * source of truth for direct influence used by follower control and faction
 * influence (`availableDI`).
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { HAND_SIZE } from '../../constants.js';

const HOARMURATH = 'le-53' as CardDefinitionId;

// Ringwraith mode cards (permanent-event resources bound to the company).
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Darkhavens (siteType: haven, ringwraith alignment).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Non-haven minion shadow-hold.
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId;

// Hero site so the opposing player has a legal starting position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
const RIVENDELL = 'tw-404' as CardDefinitionId;

describe('Hoarmûrath the Ringwraith (le-53)', () => {
  beforeEach(() => resetMint());

  // ─── Mode stat changes ──────────────────────────────────────────────────────

  test('base stats with no mode card: prowess 8, direct influence 3', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const hoarmurath = getCharacter(state, RESOURCE_PLAYER, HOARMURATH);
    expect(hoarmurath.effectiveStats.prowess).toBe(8);
    expect(hoarmurath.effectiveStats.directInfluence).toBe(3);
  });

  test('+1 direct influence in Heralded Lord mode, stacking on the mode card\'s company-wide swing', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyId);
    state = recomputeDerived(state);

    const hoarmurath = getCharacter(state, RESOURCE_PLAYER, HOARMURATH);
    // Heralded Lord (le-190) itself swings -2 prowess / +3 direct influence
    // across the entire company; his own +1 stacks on top of that.
    expect(hoarmurath.effectiveStats.directInfluence).toBe(7); // 3 + 1 (his own) + 3 (mode card)
    expect(hoarmurath.effectiveStats.prowess).toBe(6); // 8 - 2 (mode card); his Fell Rider bonus does not apply
  });

  test('+2 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);
    state = recomputeDerived(state);

    const hoarmurath = getCharacter(state, RESOURCE_PLAYER, HOARMURATH);
    expect(hoarmurath.effectiveStats.prowess).toBe(10); // 8 + 2
    expect(hoarmurath.effectiveStats.directInfluence).toBe(3); // Heralded Lord bonus does not apply
  });

  test('a mode card bound to a DIFFERENT company does not modify Hoarmûrath', () => {
    // The mode bonus is keyed to the bearer's own company. A Heralded Lord card
    // bound to a second company must not raise Hoarmûrath's DI.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [HOARMURATH] },
            { site: MINAS_MORGUL, characters: [] },
          ],
          hand: [],
          siteDeck: [GOBLIN_GATE_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const otherCompanyId = companyIdAt(state, RESOURCE_PLAYER, 1);
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, otherCompanyId);
    state = recomputeDerived(state);

    const hoarmurath = getCharacter(state, RESOURCE_PLAYER, HOARMURATH);
    expect(hoarmurath.effectiveStats.directInfluence).toBe(3); // unchanged
  });

  // ─── Darkhaven hand-size bonus ──────────────────────────────────────────────

  test('hand size is base + 1 when Hoarmûrath is at a Darkhaven (Dol Guldur)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // Opponent (no Hoarmûrath) keeps base hand size.
    expect(resolveHandSize(state, HAZARD_PLAYER)).toBe(HAND_SIZE);
  });

  test('hand-size bonus applies at any Darkhaven (Minas Morgul)', () => {
    // Unlike a named-site gate, "at a Darkhaven" must fire at every dark haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  test('no hand-size bonus when Hoarmûrath is at a non-Darkhaven site', () => {
    // Goblin-gate is a minion shadow-hold, not a haven → self.atDarkhaven false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE_MINION, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });
});

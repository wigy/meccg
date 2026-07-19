/**
 * @module le-304.test
 *
 * Card test: Broad-headed Spear (le-304)
 * Type: minion-resource-item (major, weapon)
 *
 * "Weapon. Warrior only: +2 to prowess to a maximum of 8."
 *
 * Only the prowess bonus applies, and only to a warrior bearer; a
 * non-warrior may still carry the item but gains no benefit. The cap
 * of 8 is absolute: a warrior already at or above it gets no further
 * increase.
 *
 * Fixture alignment: this is a minion resource item (alignment
 * "ringwraith"), so the tests build state with minion characters
 * (Lagduf le-18, Layos le-19, Lieutenant of Morgul le-22) at minion
 * sites (Moria le-392 shadow-hold, Ettenmoors le-373 ruins-and-lairs).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  charIdAt, RESOURCE_PLAYER,
  viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const BROAD_HEADED_SPEAR = 'le-304' as CardDefinitionId;

// Minion fixtures — only referenced in this test file, so declared
// locally per the `card-ids.ts` constants policy in CLAUDE.md.
const LAGDUF = 'le-18' as CardDefinitionId;               // warrior only, prow 5
const LAYOS = 'le-19' as CardDefinitionId;                // sage/diplomat (non-warrior), prow 3
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prow 8

const MINAS_MORGUL = 'le-390' as CardDefinitionId;        // minion-site, haven
const MORIA_MINION = 'le-392' as CardDefinitionId;        // shadow-hold, allows major
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;   // ruins-and-lairs, allows only minor

describe('Broad-headed Spear (le-304)', () => {
  beforeEach(() => resetMint());

  // ─── Prowess +2 max 8 (warrior only) ───────────────────────────────

  test('prowess +2 applied to warrior bearer (Lagduf 5 → 7)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [{ defId: LAGDUF, items: [BROAD_HEADED_SPEAR] }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId].effectiveStats.prowess).toBe(7);
  });

  test('prowess NOT applied to non-warrior bearer (Layos stays at 3)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [{ defId: LAYOS, items: [BROAD_HEADED_SPEAR] }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId].effectiveStats.prowess).toBe(3);
  });

  test('prowess capped at 8 for warrior bearer (Lieutenant of Morgul 8 → 8)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [{ defId: LIEUTENANT_OF_MORGUL, items: [BROAD_HEADED_SPEAR] }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId].effectiveStats.prowess).toBe(8);
  });

  test('body not modified by Broad-headed Spear', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [{ defId: LAGDUF, items: [BROAD_HEADED_SPEAR] }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId].effectiveStats.body).toBe(8);
  });

  // ─── Playability ───────────────────────────────────────────────────

  test('playable as major item at a shadow-hold (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA_MINION,
      hand: [BROAD_HEADED_SPEAR],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a site whose playable list excludes major (Ettenmoors, minor only)', () => {
    const state = buildSitePhaseState({
      site: ETTENMOORS_MINION,
      hand: [BROAD_HEADED_SPEAR],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Non-unique: up to 3 copies allowed ─────────────────────────────

  test('non-unique: a second copy can be played while one is already in play', () => {
    const state = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [{ defId: LAGDUF, items: [BROAD_HEADED_SPEAR] }],
      hand: [BROAD_HEADED_SPEAR],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});

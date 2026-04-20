/**
 * @module le-313.test
 *
 * Card test: High Helm (le-313)
 * Type: minion-resource-item (major, helmet)
 *
 * "Unique. Helmet. +2 to direct influence. +1 to body to a maximum of 9.
 *  Warrior only: +1 to prowess to a maximum of 8."
 *
 * The direct-influence and body bonuses apply to any bearer; only the
 * prowess bonus is restricted to warriors. All stat caps are absolute:
 * bearers already at or above the cap get no benefit.
 *
 * Fixture alignment: this is a minion resource item (alignment
 * "ringwraith"), so the tests build state with minion characters
 * (Lagduf le-18, Layos le-19, Lieutenant of Morgul le-22) at minion
 * sites (Moria le-392 shadow-hold, Ettenmoors le-373 ruins-and-lairs,
 * Dol Guldur le-367 haven).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  charIdAt, RESOURCE_PLAYER,
  viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const HIGH_HELM = 'le-313' as CardDefinitionId;

// Minion fixtures — only referenced in this test file, so declared
// locally per the `card-ids.ts` constants policy in CLAUDE.md.
const LAGDUF = 'le-18' as CardDefinitionId;               // warrior only, prow 5, body 8, DI 0
const LAYOS = 'le-19' as CardDefinitionId;                // sage/diplomat (non-warrior), prow 3, body 8, DI 2
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prow 8, body 9, DI 2

const DOL_GULDUR = 'le-367' as CardDefinitionId;          // minion-site, haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;        // minion-site, haven
const MORIA_MINION = 'le-392' as CardDefinitionId;        // shadow-hold, allows major
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;   // ruins-and-lairs, allows only minor
const BANDIT_LAIR_MINION = 'le-351' as CardDefinitionId;  // ruins-and-lairs, allows minor/gold-ring

describe('High Helm (le-313)', () => {
  beforeEach(() => resetMint());

  // ─── Direct-influence +2 (unconditional) ───────────────────────────

  test('direct-influence +2 applied to warrior bearer (Lagduf 0 → 2)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.directInfluence).toBe(2);
  });

  test('direct-influence +2 applied to non-warrior bearer (Layos 2 → 4)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAYOS, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.directInfluence).toBe(4);
  });

  // ─── Body +1 max 9 (unconditional) ─────────────────────────────────

  test('body +1 applied to warrior bearer (Lagduf 8 → 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.body).toBe(9);
  });

  test('body +1 applied to non-warrior bearer (Layos 8 → 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAYOS, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.body).toBe(9);
  });

  test('body capped at 9 for bearer already at cap (Lieutenant of Morgul 9 → 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LIEUTENANT_OF_MORGUL, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.body).toBe(9);
  });

  // ─── Prowess +1 max 8 (warrior only) ───────────────────────────────

  test('prowess +1 applied to warrior bearer (Lagduf 5 → 6)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.prowess).toBe(6);
  });

  test('prowess NOT applied to non-warrior bearer (Layos stays at 3)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAYOS, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.prowess).toBe(3);
  });

  test('prowess capped at 8 for warrior already at cap (Lieutenant of Morgul 8 → 8)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [{ defId: LIEUTENANT_OF_MORGUL, items: [HIGH_HELM] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BANDIT_LAIR_MINION] },
      ],
    });

    const bearerId = charIdAt(state, RESOURCE_PLAYER);
    expect(state.players[RESOURCE_PLAYER].characters[bearerId as string].effectiveStats.prowess).toBe(8);
  });

  // ─── Playability ───────────────────────────────────────────────────

  test('playable as major item at a shadow-hold (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA_MINION,
      hand: [HIGH_HELM],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a site whose playable list excludes major (Ettenmoors, minor only)', () => {
    const state = buildSitePhaseState({
      site: ETTENMOORS_MINION,
      hand: [HIGH_HELM],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Uniqueness ────────────────────────────────────────────────────

  test('unique: a second copy cannot be played while one is already in play', () => {
    // Lagduf at Moria already wears one High Helm; a second copy in hand
    // is blocked by the legal-action uniqueness check.
    const state = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [{ defId: LAGDUF, items: [HIGH_HELM] }],
      hand: [HIGH_HELM],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });
});

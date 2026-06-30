/**
 * @module rule-meba-balrog
 *
 * MECCG — Middle-earth: The Balrog (MEBA) rule-engine behaviours.
 * Source: https://meccg.com/rules/by-expansion/the-balrog/
 *
 * Focused confirmation tests for the Balrog-specific engine rules implemented
 * alongside `specs/2026-06-30-balrog-rules.md`. Covers:
 * - §3  The Balrog bears but cannot use items (item has no effect).
 * - §18 Balrog automatic-attacks are ignored once the Balrog is in play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import {
  buildTestState, resetMint, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, Phase,
} from '../test-helpers.js';

const THE_BALROG = 'ba-3' as CardDefinitionId;          // Balrog avatar (mind null)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;    // non-unique Orc, mind 2
const GLAMDRING = 'tw-244' as CardDefinitionId;         // hero weapon, 1 corruption point
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // a minion Darkhaven
const THE_UNDER_GATES_DM = 'dm-38' as CardDefinitionId; // carries the Balrog automatic-attack

describe('MEBA §3 — The Balrog bears but cannot use items', () => {
  beforeEach(() => resetMint());

  test('an item borne by the Balrog avatar contributes no corruption points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: THE_BALROG, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const balrog = state.players[RESOURCE_PLAYER].characters[balrogId];
    expect(balrog.effectiveStats.corruptionPoints).toBe(0);
  });

  test('the same item borne by an Orc in the Balrog company still applies its corruption points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: CROOK_LEGGED_ORC, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const orc = state.players[RESOURCE_PLAYER].characters[orcId];
    expect(orc.effectiveStats.corruptionPoints).toBe(1);
  });
});

describe('MEBA §18 — ignore Balrog automatic-attacks once the Balrog is in play', () => {
  beforeEach(() => resetMint());

  test('The Under-gates Balrog attack fires before the Balrog is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DOL_GULDUR, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const siteDef = state.cardPool[THE_UNDER_GATES_DM] as SiteCard;
    expect(getActiveAutoAttacks(state, siteDef).some(a => a.creatureType === 'Balrog')).toBe(true);
  });

  test('the Balrog attack is suppressed once the Balrog avatar is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DOL_GULDUR, characters: [THE_BALROG] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const siteDef = state.cardPool[THE_UNDER_GATES_DM] as SiteCard;
    expect(getActiveAutoAttacks(state, siteDef).some(a => a.creatureType === 'Balrog')).toBe(false);
  });
});

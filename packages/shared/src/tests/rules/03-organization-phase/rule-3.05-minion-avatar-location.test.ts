/**
 * @module rule-3.05-minion-avatar-location
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.05: Minion Avatar Play Location
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith avatar can only be played at the avatar's home site, Minas Morgul, or Dol Guldur.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, Phase, Alignment,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

const ADUNAPHEL = 'le-50' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Rule 3.05 — Minion Avatar Play Location', () => {
  beforeEach(() => resetMint());

  test('[MINION] Ringwraith avatar (Adûnaphel) can be played at Minas Morgul', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [ADUNAPHEL],
          siteDeck: [MINAS_MORGUL],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
    const sitesPlayedAt = viable.map(a => a.atSite);
    const minasMorgulSite = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL);
    expect(sitesPlayedAt).toContain(minasMorgulSite!.instanceId);
  });

  test('[MINION] Ringwraith avatar (Adûnaphel) can be played at Dol Guldur', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [ADUNAPHEL],
          siteDeck: [DOL_GULDUR],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
    const sitesPlayedAt = viable.map(a => a.atSite);
    const dolGuldurSite = state.players[0].siteDeck.find(s => s.definitionId === DOL_GULDUR);
    expect(sitesPlayedAt).toContain(dolGuldurSite!.instanceId);
  });

  test('[MINION] Ringwraith avatar cannot be played at Carn Dûm (haven, but not Minas Morgul or Dol Guldur)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [ADUNAPHEL],
          siteDeck: [CARN_DUM],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(0);
  });
});

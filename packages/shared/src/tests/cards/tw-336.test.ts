/**
 * @module tw-336.test
 *
 * Card test: Sword of Gondolin (tw-336)
 * Type: hero-resource-item (major, weapon)
 * Effects: 1
 *
 * "Weapon. Warrior only: +2 to prowess to a maximum of 8."
 *
 * Non-warriors may carry the Sword but receive no prowess bonus.
 * Warriors gain +2 prowess capped at 8.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  pool,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
  buildTestState, Phase, dispatch, getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CharacterCard, CardDefinitionId } from '../../index.js';

const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sword of Gondolin (tw-336)', () => {
  beforeEach(() => resetMint());

  test('playable on Aragorn (warrior) at a shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [SWORD_OF_GONDOLIN],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeDefined();
  });

  test('playable on Frodo (non-warrior may still carry)', () => {
    const state = buildSitePhaseState({
      characters: [FRODO],
      site: MORIA,
      hand: [SWORD_OF_GONDOLIN],
    });

    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const actions = computeLegalActions(state, PLAYER_1);

    const onFrodo = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === frodoId,
    );
    expect(onFrodo).toBeDefined();
  });

  test('prowess NOT applied to Frodo (non-warrior carrying Sword)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: FRODO, items: [SWORD_OF_GONDOLIN] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(baseDef.prowess);
  });

  test('prowess +2 capped at 8 for Aragorn (base prowess 6)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [SWORD_OF_GONDOLIN] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(8);
  });

  test('prowess +2 below cap for Legolas (base prowess 5 → 7)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: LEGOLAS, items: [SWORD_OF_GONDOLIN] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.prowess).toBe(5);
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(7);
  });

  test('body not modified by Sword of Gondolin', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [SWORD_OF_GONDOLIN] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(baseDef.body);
  });
});

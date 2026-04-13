/**
 * @module tw-254.test
 *
 * Card test: Hauberk of Bright Mail (tw-254)
 * Type: hero-resource-item (major, armor)
 * Effects: 2
 *
 * "Unique. Armor. Warrior only: +2 to body to a maximum of 9."
 *
 * This tests:
 * 1. play-target: only playable on characters with warrior skill
 * 2. stat-modifier: body +2 (max 9)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS,
  HAUBERK_OF_BRIGHT_MAIL,
  MORIA, LORIEN, MINAS_TIRITH,
  pool,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
  buildTestState, Phase, dispatch, getCharacter,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CharacterCard } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Hauberk of Bright Mail (tw-254)', () => {
  beforeEach(() => resetMint());

  test('playable on Aragorn (warrior) at a shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [HAUBERK_OF_BRIGHT_MAIL],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeDefined();
  });

  test('not playable on Frodo (not a warrior)', () => {
    const state = buildSitePhaseState({
      characters: [FRODO],
      site: MORIA,
      hand: [HAUBERK_OF_BRIGHT_MAIL],
    });

    const frodoId = findCharInstanceId(state, 0, FRODO);
    const actions = computeLegalActions(state, PLAYER_1);

    const onFrodo = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === frodoId,
    );
    expect(onFrodo).toBeUndefined();
  });

  test('playable on warrior but not non-warrior in same company', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN, FRODO],
      site: MORIA,
      hand: [HAUBERK_OF_BRIGHT_MAIL],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const frodoId = findCharInstanceId(state, 0, FRODO);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    const onFrodo = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === frodoId,
    );
    expect(onAragorn).toBeDefined();
    expect(onFrodo).toBeUndefined();
  });

  test('body +2 capped at 9 for Aragorn (base body 9)', () => {
    // Aragorn base body 9. Hauberk adds +2 → 11, capped at 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [HAUBERK_OF_BRIGHT_MAIL] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(s, 0, ARAGORN).effectiveStats.body).toBe(9);
  });

  test('body +2 uncapped for Legolas (base body 8)', () => {
    // Legolas base body 8. Hauberk adds +2 → 10, but capped at 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: LEGOLAS, items: [HAUBERK_OF_BRIGHT_MAIL] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);
    expect(getCharacter(s, 0, LEGOLAS).effectiveStats.body).toBe(9);
  });

  test('prowess not modified by Hauberk', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [HAUBERK_OF_BRIGHT_MAIL] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(getCharacter(s, 0, ARAGORN).effectiveStats.prowess).toBe(baseDef.prowess);
  });
});

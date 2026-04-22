/**
 * @module td-161.test
 *
 * Card test: Valiant Sword (td-161)
 * Type: hero-resource-item (major, hoard, weapon)
 *
 * "Hoard item. Weapon. +2 to bearer's prowess to a maximum of 9.
 *  Warrior only: +1 to body to a maximum of 9."
 *
 * Per CRF: the prowess bonus is unconditional. The body bonus only
 * applies if the bearer has the warrior skill — non-warriors may still
 * carry the sword and gain the prowess bonus, but not the body bonus.
 * Being a hoard item, playability is gated by `item-play-site` to sites
 * with the `hoard` keyword (Dragon's lairs).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS, GIMLI,
  MORIA, LORIEN, MINAS_TIRITH,
  pool,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
  buildTestState, Phase, dispatch, getCharacter, viableActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const VALIANT_SWORD = 'td-161' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('Valiant Sword (td-161)', () => {
  beforeEach(() => resetMint());

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [VALIANT_SWORD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('playable at a hoard site (The Lonely Mountain) on Aragorn (warrior)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LONELY_MOUNTAIN,
      hand: [VALIANT_SWORD],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onAragorn = plays.find(
      a => a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeDefined();
  });

  test('also playable on Frodo (non-warriors may carry, just no body bonus)', () => {
    const state = buildSitePhaseState({
      characters: [FRODO],
      site: LONELY_MOUNTAIN,
      hand: [VALIANT_SWORD],
    });

    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onFrodo = plays.find(
      a => a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === frodoId,
    );
    expect(onFrodo).toBeDefined();
  });

  test('prowess +2 applied to warrior bearer (Legolas 5 → 7)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: LEGOLAS, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.prowess).toBe(5);
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(7);
  });

  test('prowess +2 also applied to non-warrior bearer (Frodo 1 → 3)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: FRODO, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.prowess).toBe(1);
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(3);
  });

  test('prowess +2 capped at 9 for high-prowess warrior (Aragorn 6 → 8, no cap hit)', () => {
    // Aragorn base prowess 6. +2 = 8, below cap of 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: ARAGORN, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(8);
  });

  test('body +1 applied to warrior bearer (Legolas 8 → 9)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: LEGOLAS, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.body).toBe(9);
  });

  test('body +1 capped at 9 for Aragorn (base body 9, no increase)', () => {
    // Aragorn base body 9. +1 = 10, capped at 9.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: ARAGORN, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(9);
  });

  test('body bonus NOT applied to Frodo (non-warrior carrying Valiant Sword)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: FRODO, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    // Frodo has no warrior skill, so Valiant Sword's body bonus does not apply.
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(baseDef.body);
  });

  test('warrior bearer (Gimli 5→7 prowess, 8→9 body) — both bonuses together', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GIMLI, items: [VALIANT_SWORD] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[GIMLI as string] as CharacterCard;
    expect(baseDef.prowess).toBe(5);
    expect(baseDef.body).toBe(8);
    expect(getCharacter(s, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(7);
    expect(getCharacter(s, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(9);
  });
});

/**
 * @module td-96.test
 *
 * Card test: Adamant Helmet (td-96)
 * Type: hero-resource-item (minor, hoard item, helmet)
 *
 * Printed text:
 *   "Hoard item. Helmet. +1 to body to a maximum of 9.
 *    Cancels all dark enchantments targetting bearer."
 *
 * Rule coverage:
 *
 * | # | Rule                                                  | Status         |
 * |---|-------------------------------------------------------|----------------|
 * | 1 | Hoard item — playable only at hoard sites             | IMPLEMENTED    |
 * | 2 | Bearer receives +1 body                               | IMPLEMENTED    |
 * | 3 | Bearer body capped at 9                               | IMPLEMENTED    |
 * | 4 | Cancels existing dark enchantments on bearer          | IMPLEMENTED    |
 * | 5 | Prevents new dark enchantments attaching to bearer    | IMPLEMENTED    |
 *
 * Rules 4 and 5 are implemented via the generic `ward-bearer` DSL effect
 * (see docs/card-effects-dsl.md). The ward filter matches any hazard card
 * tagged with the `dark-enchantment` keyword.
 *
 * "Helmet" is an italicized type classification on the printed card; it
 * does not grant a mechanical effect of its own, so no test is needed for
 * it (it functions only as a slot/keyword tag for other cards to filter on).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  resetMint, pool, dispatch,
  buildSitePhaseState, buildTestState,
  viableActions,
  getCharacter,
  attachHazardToChar, attachItemToChar,
  findCharInstanceId,
  makeMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, PlayHeroResourceAction } from '../../index.js';
import { Phase } from '../../index.js';

const ADAMANT_HELMET = 'td-96' as CardDefinitionId;
const DRAGONS_CURSE = 'td-16' as CardDefinitionId; // dark-enchantment hazard
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // hoard site (Smaug's lair)

describe('Adamant Helmet (td-96)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: +1 body bonus (below cap) ───────────────────────────────────

  test('bearer with base body 6 gets +1 body (below max 9)', () => {
    // Théoden: base body 6, +1 = 7, well below the max of 9.
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: THEODEN, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const theoden = getCharacter(state, RESOURCE_PLAYER, THEODEN);
    expect(theoden.effectiveStats.body).toBe(7);
  });

  test('bearer with base body 8 gets +1 body exactly at max 9', () => {
    // Legolas: base body 8, +1 = 9, lands exactly on the cap.
    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    expect(legolas.effectiveStats.body).toBe(9);
  });

  // ─── Rule 3: body bonus capped at max 9 ──────────────────────────────────

  test('bearer with base body 9 is capped at max 9 (not 10)', () => {
    // Aragorn: base body 9, +1 = 10, must be capped to 9.
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.body).toBe(9);
  });

  // ─── No prowess change ───────────────────────────────────────────────────

  test('does not modify bearer prowess', () => {
    const baseDef = pool[ARAGORN as string] as CharacterCard;

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.prowess).toBe(baseDef.prowess);
  });

  // ─── Rule 4: cancels existing dark enchantments on entry ─────────────────

  test('playing the Helmet discards a dark enchantment already on bearer', () => {
    const base = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    const aragornIdBefore = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragornBefore = state.players[RESOURCE_PLAYER].characters[aragornIdBefore as string];
    expect(aragornBefore.hazards).toHaveLength(1);
    expect(aragornBefore.hazards[0].definitionId).toBe(DRAGONS_CURSE);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource') as { action: PlayHeroResourceAction }[];
    const onAragorn = plays.find(p => p.action.attachToCharacterId === aragornIdBefore);
    expect(onAragorn).toBeDefined();

    const after = dispatch(state, onAragorn!.action);

    const aragornAfter = after.players[RESOURCE_PLAYER].characters[aragornIdBefore as string];
    expect(aragornAfter.hazards).toHaveLength(0);
    expect(aragornAfter.items.map(i => i.definitionId)).toContain(ADAMANT_HELMET);

    // Dragon's Curse lands in the hazard player's discard pile.
    const hazardDiscardDefs = after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId);
    expect(hazardDiscardDefs).toContain(DRAGONS_CURSE);
  });

  test('only discards hazards matching the ward filter (non-enchantment hazards stay)', () => {
    // Drop a non-dark-enchantment hazard onto Aragorn (Foolish Words: td-25).
    const FOOLISH_WORDS = 'td-25' as CardDefinitionId;
    const base = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource') as { action: PlayHeroResourceAction }[];
    const after = dispatch(state, plays[0].action);

    const aragornAfter = after.players[RESOURCE_PLAYER].characters[aragornId as string];
    // Foolish Words is a lore-based hazard, not a dark enchantment — it must survive.
    expect(aragornAfter.hazards.map(h => h.definitionId)).toContain(FOOLISH_WORDS);
  });

  // ─── Rule 5: prevents new dark enchantments targeting bearer ─────────────

  test('hazard player cannot target a warded bearer with a dark enchantment', () => {
    // Build an M/H state where Aragorn already wears the Helmet and the
    // hazard player holds Dragon's Curse. The Helmet's ward must remove
    // Aragorn from the legal target list for Dragon's Curse.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [DRAGONS_CURSE], siteDeck: [LORIEN] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ADAMANT_HELMET);
    state = { ...state, phaseState: makeMHState() };

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: { targetCharacterId?: string } }[];
    // No viable Dragon's Curse play against Aragorn.
    const targetingAragorn = plays.filter(p => p.action.targetCharacterId === aragornId);
    expect(targetingAragorn).toHaveLength(0);
  });

  test('ward is character-local: another non-warded character remains a legal target', () => {
    // Aragorn wears the Helmet; Théoden does not. Dragon's Curse may still
    // target Théoden.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, THEODEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [DRAGONS_CURSE], siteDeck: [LORIEN] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, ADAMANT_HELMET);
    state = { ...state, phaseState: makeMHState() };

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: { targetCharacterId?: string } }[];

    expect(plays.some(p => p.action.targetCharacterId === aragornId)).toBe(false);
    expect(plays.some(p => p.action.targetCharacterId === theodenId)).toBe(true);
  });
});

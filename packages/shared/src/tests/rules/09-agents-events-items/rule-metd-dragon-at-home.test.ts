/**
 * @module rule-metd-dragon-at-home
 *
 * METD §4 / §4.5 — Dragon "At-Home" permanent-events.
 *
 * While an At-Home is in play, the resident Dragon's lair gains an
 * additional automatic-attack — *unless* the matching Ahunt long-event
 * is also in play (the rule's "Unless [Dragon] Ahunt is in play" clause).
 */

import { describe, expect, test } from 'vitest';
import type { CardDefinitionId, GameState, SiteCard } from '../../../index.js';
import { getActiveAutoAttacks } from '../../../engine/manifestations.js';
import {
  addCardInPlay, buildSimpleTwoPlayerState, buildSitePhaseState, setupAutoAttackStep,
  runAutoAttackCombatMulti, HAZARD_PLAYER, RESOURCE_PLAYER,
  BALIN, ELROND, GLORFINDEL_II,
} from '../../test-helpers.js';

const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const EARC_AT_HOME = 'td-22' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('METD §4 — Dragon At-Home augmentation', () => {
  test('lair has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildSimpleTwoPlayerState();
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
  });

  test('At-Home in play appends an extra Dragon attack to its lair', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, SMAUG_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    // Printed (1 strike, 14 prow) + Smaug-At-Home extra (2 strikes, 18 prow).
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 1, prowess: 14 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18 });
  });

  test('matching Ahunt suppresses the At-Home augmentation', () => {
    const state = addCardInPlay(addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, SMAUG_AT_HOME), HAZARD_PLAYER, SMAUG_AHUNT);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  test('At-Home for a different Dragon does not augment this lair', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, EARC_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  // ─── glossary g.man.3 — defeating an At-Home manifestation removes it ──────

  test('defeating the augmented attack removes the At-Home permanent-event from play', () => {
    // Balin (prowess 4) defeats the lair's printed Dragon attack (1 strike,
    // 14 prowess) on a forced roll of 12; Elrond + Glorfindel II (prowess 7
    // and 8) then defeat the augmented Smaug-at-Home attack (2 strikes, 18
    // prowess) the same way — mirrors td-126.test.ts's `setupLairCompany`.
    let state: GameState = setupAutoAttackStep(buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [BALIN, ELROND, GLORFINDEL_II],
    }));
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    expect(getActiveAutoAttacks(state, state.cardPool[LONELY_MOUNTAIN] as SiteCard)).toHaveLength(2);

    // Attack 0: printed Dragon (1 strike, 14 prowess).
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
    expect(state.combat).toBeNull();
    // Smaug at Home still guards the lair — only its own augmented attack
    // being defeated removes it, not the printed attack.
    expect(state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SMAUG_AT_HOME)).toBe(true);

    // Attack 1: augmented at-home Dragon (2 strikes, 18 prowess).
    state = runAutoAttackCombatMulti(state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]).state;
    expect(state.combat).toBeNull();

    // g.man.3: the defeated Dragon manifestation is removed from play — the
    // permanent-event leaves the hazard player's cardsInPlay for good...
    expect(state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SMAUG_AT_HOME)).toBe(false);
    // ...and (CRF 3.IV.1.3, "defeated Dragon manifestations may be used as
    // trophies") lands in the defending player's kill pile.
    expect(state.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === SMAUG_AT_HOME)).toBe(true);

    // "the corresponding Dragon's lair loses its automatic-attack for the
    // rest of the game" — once the manifestation is in a terminal pile,
    // `isManifestationDefeated` strips the lair's *printed* Dragon attack
    // too (not just the At-Home augmentation), so nothing remains.
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(0);
  });
});

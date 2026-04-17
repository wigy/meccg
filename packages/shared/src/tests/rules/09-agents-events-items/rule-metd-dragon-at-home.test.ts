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
import type { CardDefinitionId, SiteCard } from '../../../index.js';
import { getActiveAutoAttacks } from '../../../engine/manifestations.js';
import { addCardInPlay, buildSimpleTwoPlayerState } from '../../test-helpers.js';

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
    const state = addCardInPlay(buildSimpleTwoPlayerState(), 1, SMAUG_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    // Printed (1 strike, 14 prow) + Smaug-At-Home extra (2 strikes, 18 prow).
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 1, prowess: 14 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18 });
  });

  test('matching Ahunt suppresses the At-Home augmentation', () => {
    const state = addCardInPlay(addCardInPlay(buildSimpleTwoPlayerState(), 1, SMAUG_AT_HOME), 1, SMAUG_AHUNT);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  test('At-Home for a different Dragon does not augment this lair', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), 1, EARC_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });
});

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
import { ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH } from '../../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, SiteCard } from '../../../index.js';
import { CardStatus, Phase } from '../../../index.js';
import { getActiveAutoAttacks } from '../../../engine/manifestations.js';
import { PLAYER_1, PLAYER_2, buildTestState } from '../../test-helpers.js';

const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

function baseState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

function withInPlay(state: ReturnType<typeof baseState>, ownerIdx: 0 | 1, defId: CardDefinitionId) {
  const card: CardInPlay = {
    instanceId: `${state.players[ownerIdx].id}-99` as CardInstanceId,
    definitionId: defId,
    status: CardStatus.Untapped,
  };
  const updatedPlayer = { ...state.players[ownerIdx], cardsInPlay: [...state.players[ownerIdx].cardsInPlay, card] };
  const players = ownerIdx === 0
    ? [updatedPlayer, state.players[1]]
    : [state.players[0], updatedPlayer];
  return { ...state, players: players as unknown as typeof state.players };
}

describe('METD §4 — Dragon At-Home augmentation', () => {
  test('lair has only its printed Dragon attack when no At-Home is in play', () => {
    const state = baseState();
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
  });

  test('At-Home in play appends an extra Dragon attack to its lair', () => {
    const state = withInPlay(baseState(), 1, SMAUG_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    // Printed (1 strike, 14 prow) + Smaug-At-Home extra (2 strikes, 18 prow).
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 1, prowess: 14 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18 });
  });

  test('matching Ahunt suppresses the At-Home augmentation', () => {
    const s1 = withInPlay(baseState(), 1, SMAUG_AT_HOME);
    const state = withInPlay(s1, 1, SMAUG_AHUNT);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    // Only the printed attack remains.
    expect(attacks).toHaveLength(1);
  });

  test('At-Home for a different Dragon does not augment this lair', () => {
    const EARC_AT_HOME = 'td-22' as CardDefinitionId;
    const state = withInPlay(baseState(), 1, EARC_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    // Lonely Mountain is Smaug's lair — only its own At-Home augments it.
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });
});

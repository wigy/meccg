/**
 * @module bearer-cannot-untap-source-gone.test
 *
 * Regression from random self-play (sim seed 103003, decks f vs l): To
 * Satisfy the Questioner (le-246) locks its bearer — "the character may not
 * untap until this card is stored" — via a `bearer-cannot-untap` constraint.
 * When the bearer was eliminated the card was discarded with him, but the
 * `until-cleared` lock stayed. Nothing can ever store that card again, and a
 * character re-entering play keeps its instance id, so the same character
 * brought back into play would stay tapped forever. The lock binds only while
 * its source card is still borne by the character.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  findCharInstanceId, expectCharStatus,
} from '../../test-helpers.js';
import { characterHasCannotUntapConstraint } from '../../../engine/reducer-utils.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../../index.js';

const REFORGING = 'tw-314' as CardDefinitionId;
const REFORGING_ID = 'p1-reforging' as CardInstanceId;

/** Tapped Aragorn under a Reforging-style lock; `bearsCard` decides whether he still carries it. */
function lockedAragorn(bearsCard: boolean): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Untap,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const p1 = base.players[RESOURCE_PLAYER];
  const aragorn = p1.characters[aragornId];
  return {
    ...base,
    players: [
      {
        ...p1,
        characters: {
          ...p1.characters,
          [aragornId]: bearsCard
            ? { ...aragorn, items: [...aragorn.items, { instanceId: REFORGING_ID, definitionId: REFORGING, status: CardStatus.Untapped }] }
            : aragorn,
        },
      },
      base.players[1],
    ],
    activeConstraints: [
      ...base.activeConstraints,
      {
        id: 'lock-1' as unknown as GameState['activeConstraints'][number]['id'],
        source: REFORGING_ID,
        sourceDefinitionId: REFORGING,
        scope: { kind: 'until-cleared' },
        target: { kind: 'character', characterId: aragornId },
        kind: { type: 'bearer-cannot-untap', cardInstanceId: REFORGING_ID },
      },
    ],
  };
}

describe('bearer-cannot-untap binds only while the source card is borne', () => {
  beforeEach(() => resetMint());

  test('control: a character still bearing the card stays tapped through the untap phase', () => {
    const state = lockedAragorn(true);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(characterHasCannotUntapConstraint(state, aragornId)).toBe(true);

    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('once the card has left the character, a leftover lock no longer keeps him tapped', () => {
    const state = lockedAragorn(false);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(characterHasCannotUntapConstraint(state, aragornId)).toBe(false);

    const after = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });
});

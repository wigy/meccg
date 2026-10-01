/**
 * @module dm-131.test
 *
 * Card test: First of the Order (dm-131)
 * Type: hero-resource-event (short), alignment: wizard. Non-unique.
 * Effects: play-target (character named Saruman), on-event self-enters-play →
 *          add-constraint check-modifier (corruption +2, target
 *          action-target-character, lasting, scope turn)
 *
 * "Playable on Saruman. Saruman receives +2 to all corruption checks for the
 *  rest of the turn."
 *
 * | # | Rule fragment                                     | Status      |
 * |---|---------------------------------------------------|-------------|
 * | 1 | Playable on Saruman (and on no one else)          | IMPLEMENTED |
 * | 2 | +2 to Saruman's corruption checks                 | IMPLEMENTED |
 * | 3 | …to ALL of them (not consumed by the first check) | IMPLEMENTED |
 * | 4 | …only Saruman's, not his company-mates'           | IMPLEMENTED |
 * | 5 | …for the rest of the turn (swept at turn end)     | IMPLEMENTED |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  SARUMAN, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  RESOURCE_PLAYER,
  buildTestState, resetMint, makePlayDeck,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId,
  enqueueCorruptionCheck, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';
import { sweepExpired } from '../../engine/pending.js';

const FIRST_OF_THE_ORDER = 'dm-131' as CardDefinitionId;

describe('First of the Order (dm-131)', () => {
  beforeEach(() => resetMint());

  const orgState = (characters: CardDefinitionId[]) => buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters }],
        hand: [FIRST_OF_THE_ORDER],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
    ],
  });

  const plays = (state: ReturnType<typeof orgState>) =>
    viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction);

  const modifierFor = (state: ReturnType<typeof orgState>, charId: ReturnType<typeof findCharInstanceId>) => {
    const s = enqueueCorruptionCheck(state, PLAYER_1, charId);
    return viableActions(s, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === charId)!.corruptionModifier;
  };

  test('playable only on Saruman, never on a company-mate', () => {
    const state = orgState([SARUMAN, ARAGORN]);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);

    const actions = plays(state);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(sarumanId);
  });

  test('not playable when Saruman is not in play', () => {
    const state = orgState([ARAGORN]);
    expect(plays(state)).toHaveLength(0);
  });

  test('playing it gives Saruman +2 to his corruption checks and discards the event', () => {
    const state = orgState([SARUMAN, ARAGORN]);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const sarumanBase = modifierFor(state, sarumanId);
    const aragornBase = modifierFor(state, aragornId);

    const after = dispatch(state, plays(state)[0]);

    expectInDiscardPile(after, RESOURCE_PLAYER, findHandCardId(state, RESOURCE_PLAYER, FIRST_OF_THE_ORDER));
    expect(modifierFor(after, sarumanId)).toBe(sarumanBase + 2);
    // Only Saruman benefits — his company-mate's checks are unchanged.
    expect(modifierFor(after, aragornId)).toBe(aragornBase);
  });

  test('the +2 applies to ALL of Saruman\'s checks — it is not consumed by the first one', () => {
    const state = orgState([SARUMAN, ARAGORN]);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const sarumanBase = modifierFor(state, sarumanId);

    let s = dispatch(state, plays(state)[0]);
    s = enqueueCorruptionCheck(s, PLAYER_1, sarumanId);
    const roll = viableActions(s, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === sarumanId)!;
    expect(roll.corruptionModifier).toBe(sarumanBase + 2);
    s = dispatch(s, roll);

    expect(s.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption'
      && c.target.kind === 'character' && c.target.characterId === sarumanId)).toBe(true);
    expect(modifierFor(s, sarumanId)).toBe(sarumanBase + 2);
  });

  test('the +2 lasts only for the rest of the turn', () => {
    const state = orgState([SARUMAN]);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const sarumanBase = modifierFor(state, sarumanId);

    const played = dispatch(state, plays(state)[0]);
    // Survives the end of the phase it was played in.
    const afterPhase = sweepExpired(played, { kind: 'phase-end', phase: Phase.Organization });
    expect(modifierFor(afterPhase, sarumanId)).toBe(sarumanBase + 2);

    const afterTurn = sweepExpired(played, { kind: 'turn-end' });
    expect(modifierFor(afterTurn, sarumanId)).toBe(sarumanBase);
  });
});

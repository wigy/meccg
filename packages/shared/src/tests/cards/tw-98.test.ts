/**
 * @module tw-98.test
 *
 * Card test: The Precious (tw-98)
 * Type: hazard-event (short, character-targeting, corruption)
 * Effects: 1 (play-target character
 *   filter: company bears The One Ring, target is not the bearer
 *   cost: corruption-check -2, alsoDiscardItemName "The One Ring")
 *
 * "A character in the same company (hazard player's choice) as The One Ring
 *  (not the bearer himself) must make a corruption check modified by -2. If
 *  he fails, discard The One Ring along with the target character."
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                    |
 * |---|-------------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Target filter: company bears The One Ring       | IMPLEMENTED | company.itemNames ctx (movement-hazard)   |
 * | 2 | Target filter: excludes the Ring's own bearer   | IMPLEMENTED | target.possessions $not $includes         |
 * | 3 | Corruption check modifier -2 on resolve         | IMPLEMENTED | play-target cost:check enqueue in chain   |
 * | 4 | Failed check also discards The One Ring         | IMPLEMENTED | alsoDiscardItemId (pending-reducers.ts)   |
 * | 5 | Passed check leaves target, bearer & Ring alone | IMPLEMENTED | success branch dequeues, no side effect   |
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState,
  PLAYER_1, PLAYER_2,
  FRODO, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, resolveChain,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { THE_ONE_RING } from '../../index.js';
import type { PlayHazardAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const THE_PRECIOUS = 'tw-98' as CardDefinitionId;

/** Viable + non-viable The Precious play-hazard actions in the given M/H state. */
function preciousPlays(state: ReturnType<typeof buildTestState>) {
  const card = state.players[1].hand.find(c => c.definitionId === THE_PRECIOUS)!;
  return computeLegalActions(state, PLAYER_2)
    .filter(ea => ea.action.type === 'play-hazard'
      && (ea.action).cardInstanceId === card.instanceId);
}

/** Build an M/H state with Frodo (optionally bearing the Ring) and Aragorn in one company. */
function buildState(frodoHasRing: boolean) {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: RIVENDELL,
          characters: [
            frodoHasRing ? { defId: FRODO, items: [THE_ONE_RING] } : FRODO,
            ARAGORN,
          ],
        }],
        hand: [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [THE_PRECIOUS],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

describe('The Precious (tw-98)', () => {
  beforeEach(() => resetMint());

  test('not playable when no company member bears The One Ring', () => {
    const mh = buildState(false);
    const plays = preciousPlays(mh);
    expect(plays.length).toBeGreaterThan(0);
    for (const a of plays) expect(a.viable).toBe(false);
  });

  test('playable on the company-mate, but not on the Ring-bearer himself', () => {
    const mh = buildState(true);
    const frodoId = charIdAt(mh, RESOURCE_PLAYER, 0, 0);
    const targetId = charIdAt(mh, RESOURCE_PLAYER, 0, 1);

    const plays = preciousPlays(mh);
    const viable = plays.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect((viable[0].action as PlayHazardAction).targetCharacterId).toBe(targetId);

    const frodoAttempt = plays.find(a => (a.action as PlayHazardAction).targetCharacterId === frodoId);
    expect(frodoAttempt?.viable).toBe(false);
  });

  test('resolving enqueues a -2 corruption check on the target, carrying the Ring for a failed check', () => {
    const mh = buildState(true);
    const frodoId = charIdAt(mh, RESOURCE_PLAYER, 0, 0);
    const targetId = charIdAt(mh, RESOURCE_PLAYER, 0, 1);
    const ringId = mh.players[0].characters[frodoId].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const viable = preciousPlays(mh).filter(a => a.viable);
    expect(viable).toHaveLength(1);
    const played = reduce(mh, viable[0].action);
    expect(played.error).toBeUndefined();

    const s = resolveChain(played.state);
    expect(s.chain).toBeNull();

    // The Precious spent to the hazard player's discard pile.
    expect(s.players[1].discardPile.some(c => c.definitionId === THE_PRECIOUS)).toBe(true);

    const pending = s.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(targetId);
    expect(pending[0].kind.reason).toBe('The Precious');
    expect(pending[0].kind.alsoDiscardItemId).toBe(ringId);

    const cc = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(cc).toHaveLength(1);
    expect((cc[0].action as CorruptionCheckAction).corruptionModifier).toBe(-2);
    expect((cc[0].action as CorruptionCheckAction).characterId).toBe(targetId);
  });

  test('a failed check discards both the target character and The One Ring, leaving the bearer in play', () => {
    const mh = buildState(true);
    const frodoId = charIdAt(mh, RESOURCE_PLAYER, 0, 0);
    const targetId = charIdAt(mh, RESOURCE_PLAYER, 0, 1);
    const ringId = mh.players[0].characters[frodoId].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const played = reduce(mh, preciousPlays(mh).filter(a => a.viable)[0].action);
    expect(played.error).toBeUndefined();
    const s = resolveChain(played.state);
    expect(s.chain).toBeNull();

    const cc = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(cc).toHaveLength(1);

    // Force a hard fail: the minimum possible 2d6 roll (2) plus the card's
    // -2 modifier is 0, well below any hero's corruption points — a clean
    // "eliminate" outcome.
    const resolved = reduce({ ...s, cheatRollTotal: 2 }, cc[0].action);
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    // Aragorn is gone from play, moved to either the discard or out-of-play pile
    // (whichever the standard failed-check outcome routes him to).
    expect(after.players[0].characters[targetId]).toBeUndefined();
    const targetGone = after.players[0].discardPile.some(c => c.instanceId === targetId)
      || after.players[0].outOfPlayPile.some(c => c.instanceId === targetId);
    expect(targetGone).toBe(true);

    // The One Ring is discarded too, even though it never sat on Aragorn.
    expect(after.players[0].discardPile.some(c => c.instanceId === ringId)).toBe(true);
    expect(after.players[0].outOfPlayPile.some(c => c.instanceId === ringId)).toBe(false);

    // Frodo, the Ring's actual bearer, is untouched and no longer carries it.
    expect(after.players[0].characters[frodoId]).toBeDefined();
    expect(after.players[0].characters[frodoId].items.some(i => i.instanceId === ringId)).toBe(false);
  });

  test('a passed check leaves the target, the bearer, and the Ring untouched', () => {
    const mh = buildState(true);
    const frodoId = charIdAt(mh, RESOURCE_PLAYER, 0, 0);
    const targetId = charIdAt(mh, RESOURCE_PLAYER, 0, 1);
    const ringId = mh.players[0].characters[frodoId].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const played = reduce(mh, preciousPlays(mh).filter(a => a.viable)[0].action);
    expect(played.error).toBeUndefined();
    const s = resolveChain(played.state);
    expect(s.chain).toBeNull();

    const cc = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(cc).toHaveLength(1);

    // Maximum possible 2d6 roll (12) minus the -2 modifier is comfortably a pass.
    const resolved = reduce({ ...s, cheatRollTotal: 12 }, cc[0].action);
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    expect(after.players[0].characters[targetId]).toBeDefined();
    expect(after.players[0].characters[frodoId]).toBeDefined();
    expect(after.players[0].characters[frodoId].items.some(i => i.instanceId === ringId)).toBe(true);
    expect(after.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(false);
  });
});

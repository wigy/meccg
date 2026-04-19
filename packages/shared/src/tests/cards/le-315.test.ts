/**
 * @module le-315.test
 *
 * Card test: The Least of Gold Rings (le-315)
 * Type: minion-resource-item (subtype: gold-ring)
 * Corruption: 4, Marshalling Points: 2
 *
 * "Bearer must make a corruption check at the end of each of his untap
 *  phases. Discard this ring when tested. If tested, obtain a random
 *  value to determine which ring card may be immediately played:
 *  The One Ring (12+); a Dwarven Ring (10,11,12+);
 *  a Magic Ring (1,2,3,4,5,6,7); a Lesser Ring (any result)."
 *
 * Engine support:
 * | # | Feature                                    | Status      | Notes                                  |
 * |---|--------------------------------------------|-------------|----------------------------------------|
 * | 1 | +4 corruption points to bearer             | IMPLEMENTED | itemDef.corruptionPoints summed        |
 * | 2 | Forced corruption check at end of untap    | IMPLEMENTED | on-event untap-phase-end fires for any |
 * |   |                                            |             | site (haven or non-haven)              |
 * | 3 | Discard when tested (gold-ring test action)| IMPLEMENTED | grant-action test-gold-ring discards   |
 * |   |                                            |             | the targeted gold ring item            |
 *
 * The "if tested, roll determines which ring may be played" thresholds
 * (12+ One Ring, 10–12+ Dwarven, 1–7 Magic, any Lesser) are informational
 * — the player follows up the gold-ring test by playing the appropriate
 * special ring card. No engine support is needed beyond the dice roll
 * already returned by `test-gold-ring`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  attachItemToChar,
  charIdAt, dispatch, viableActions, RESOURCE_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, CorruptionCheckAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;

describe('The Least of Gold Rings (le-315)', () => {
  beforeEach(() => resetMint());

  // ── Effect: +4 corruption points on bearer ─────────────────────────

  test('bearer gains +4 effective corruption points while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LEAST_OF_GOLD_RINGS));
    expect(withRing.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(4);
  });

  // ── Effect: corruption check at end of each untap phase ────────────

  test('untap → org transition at a non-haven enqueues a corruption check', () => {
    // Aragorn at Moria (a ruins-and-lairs, not a haven). Unlike Lure of
    // the Senses, the gold ring's untap-phase corruption check fires
    // regardless of the bearer's site type.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LEAST_OF_GOLD_RINGS);
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('The Least of Gold Rings');

    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(aragornId);
  });

  test('untap → org transition at a haven also enqueues a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LEAST_OF_GOLD_RINGS);
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('The Least of Gold Rings');
  });

  test('corruption check uses the bearer\'s effective corruption points (4)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, LEAST_OF_GOLD_RINGS));
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    const viable = viableActions(afterPass, PLAYER_1, 'corruption-check');
    expect(viable).toHaveLength(1);
    const cc = viable[0].action as CorruptionCheckAction;
    // Aragorn has 0 base CP, +4 from the ring = 4. Aragorn's corruptionModifier is 0.
    expect(cc.corruptionPoints).toBe(4);
    expect(cc.corruptionModifier).toBe(0);
  });

  test('no corruption check enqueued when the ring is not attached', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const afterUntap = dispatch(base, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('untap-phase-end fires only for the active player', () => {
    // Ring is on the hazard player's character. Resource player's untap
    // → org transition must NOT enqueue a corruption check on the
    // opposing player — the card text says "his untap phase".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Attach ring to the hazard player's Legolas, not the active player's Aragorn.
    const withRing = attachItemToChar(base, 1, LEGOLAS, LEAST_OF_GOLD_RINGS);
    const afterUntap = dispatch(withRing, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  // ── Effect: discard when tested ────────────────────────────────────

  test('test-gold-ring action targets the ring and discards it on resolve', () => {
    // Gandalf in Aragorn's company tests the gold ring. While narratively
    // odd (a hero testing a minion ring), the engine's gold-ring test
    // mechanism is generic — verify the ring is discarded when tested.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [GANDALF, { defId: ARAGORN, items: [LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const ringTests = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'test-gold-ring',
    );
    expect(ringTests).toHaveLength(1);

    const after = dispatch(base, ringTests[0].action);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEAST_OF_GOLD_RINGS);
  });
});

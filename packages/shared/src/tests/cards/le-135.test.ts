/**
 * @module le-135.test
 *
 * Card test: The Roving Eye (le-135)
 * Type: hazard-event (short, character-targeting, corruption)
 * Effects: 1 (play-target character
 *            filter: non-Wizard, non-Ringwraith bearing Palantír/greater/non-gold ring
 *            cost: corruption-check -2, failureMode discard-instead-of-eliminate)
 *
 * "Playable on a non-Wizard, non-Ringwraith character bearing a Palantír,
 *  greater item, or ring that is not a gold ring. Target character is forced
 *  to make corruption check modified by -2. If the character would normally be
 *  eliminated as a result of this check, he is instead discarded (along with
 *  all non-follower cards played with him)."
 *
 * Engine support:
 * | # | Feature                                       | Status      | Notes                                          |
 * |---|-----------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Target filter: bears Palantír/greater/ring    | IMPLEMENTED | itemKeywords/itemSubtypes ctx (movement-hazard)|
 * | 2 | Target filter: non-Wizard, non-Ringwraith     | IMPLEMENTED | target.race $ne wizard/ringwraith              |
 * | 3 | Corruption check modifier -2 on resolve       | IMPLEMENTED | play-target cost:check enqueue in chain        |
 * | 4 | Eliminate downgraded to discard               | IMPLEMENTED | failureMode discard-instead-of-eliminate       |
 *
 * The non-Wizard clause and the non-Ringwraith clause are the same `$ne`
 * condition on `target.race`; both are exercised (Gandalf, Dwar the Ringwraith).
 *
 * Playable: YES
 * Certified: 2026-07-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, THE_MITHRIL_COAT, PALANTIR_OF_ORTHANC, PRECIOUS_GOLD_RING,
  charIdAt, resolveChain,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { THE_ONE_RING } from '../../index.js';
import type { PlayHazardAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const ROVING_EYE = 'le-135' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId; // ring, subtype special (not gold-ring)
const DWAR = 'le-52' as CardDefinitionId; // Dwar the Ringwraith (race ringwraith)

/** Viable Roving-Eye play-hazard actions in the given M/H state. */
function rovingEyePlays(state: ReturnType<typeof buildTestState>) {
  const card = state.players[1].hand.find(c => c.definitionId === ROVING_EYE)!;
  return computeLegalActions(state, PLAYER_2)
    .filter(ea => ea.action.type === 'play-hazard'
      && (ea.action).cardInstanceId === card.instanceId);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('The Roving Eye (le-135)', () => {
  beforeEach(() => resetMint());

  test('not playable on a character bearing only a major item (no Palantír/greater/ring)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const plays = rovingEyePlays(mh);
    expect(plays.length).toBeGreaterThan(0);
    for (const a of plays) expect(a.viable).toBe(false);
  });

  test('playable on a character bearing a greater item', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const viable = rovingEyePlays(mh).filter(a => a.viable);
    expect(viable.length).toBe(1);
    expect((viable[0].action as PlayHazardAction).targetCharacterId).toBe(charIdAt(mh, RESOURCE_PLAYER));
  });

  test('playable on a character bearing a Palantír', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    expect(rovingEyePlays(mh).filter(a => a.viable).length).toBe(1);
  });

  test('playable on a character bearing a non-gold ring', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [LESSER_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    expect(rovingEyePlays(mh).filter(a => a.viable).length).toBe(1);
  });

  test('not playable on a character bearing only a gold ring', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const plays = rovingEyePlays(mh);
    expect(plays.length).toBeGreaterThan(0);
    for (const a of plays) expect(a.viable).toBe(false);
  });

  test('not playable on a Wizard even when bearing a qualifying item', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const plays = rovingEyePlays(mh);
    expect(plays.length).toBeGreaterThan(0);
    for (const a of plays) expect(a.viable).toBe(false);
  });

  test('not playable on a Ringwraith even when bearing a qualifying item', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: DWAR, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const plays = rovingEyePlays(mh);
    expect(plays.length).toBeGreaterThan(0);
    for (const a of plays) expect(a.viable).toBe(false);
  });

  test('resolving enqueues a corruption check with -2 modifier on the target', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const aragornId = charIdAt(mh, RESOURCE_PLAYER);

    const play = rovingEyePlays(mh).filter(a => a.viable);
    expect(play.length).toBe(1);
    const played = reduce(mh, play[0].action);
    expect(played.error).toBeUndefined();

    // Auto-resolve the chain (both players hold no reactions).
    const s = resolveChain(played.state);
    expect(s.chain).toBeNull();

    // Roving Eye spent to the hazard player's discard pile.
    expect(s.players[1].discardPile.some(c => c.definitionId === ROVING_EYE)).toBe(true);

    const pending = s.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);
    expect(pending[0].kind.reason).toBe('The Roving Eye');
    expect(pending[0].kind.failureMode).toBe('discard-instead-of-eliminate');

    const cc = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(cc).toHaveLength(1);
    expect((cc[0].action as CorruptionCheckAction).corruptionModifier).toBe(-2);
    expect((cc[0].action as CorruptionCheckAction).characterId).toBe(aragornId);
  });

  test('a would-be elimination is downgraded to a discard (character + non-follower items to discard pile)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ROVING_EYE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = { ...state, phaseState: makeMHState() };
    const aragornId = charIdAt(mh, RESOURCE_PLAYER);
    const ringId = mh.players[0].characters[aragornId].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    // Play and resolve the chain.
    const played = reduce(mh, rovingEyePlays(mh).filter(a => a.viable)[0].action);
    expect(played.error).toBeUndefined();
    const s = resolveChain(played.state);
    expect(s.chain).toBeNull();

    // Resolve the corruption check with the lowest possible roll so the modified
    // total (2 - 2 = 0) sits ≥2 below Aragorn's CP (The One Ring alone = 6):
    // that is an "eliminate" outcome, which this card downgrades to a discard.
    const cc = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(cc).toHaveLength(1);
    const resolved = reduce({ ...s, cheatRollTotal: 2 }, cc[0].action);
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    // Aragorn is discarded, NOT eliminated (out-of-play pile).
    expect(after.players[0].characters[aragornId]).toBeUndefined();
    expect(after.players[0].discardPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(after.players[0].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);

    // The non-follower item played with him goes to the discard pile too.
    expect(after.players[0].discardPile.some(c => c.instanceId === ringId)).toBe(true);
    expect(after.players[0].outOfPlayPile.some(c => c.instanceId === ringId)).toBe(false);
  });
});

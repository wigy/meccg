/**
 * @module td-80.test
 *
 * Card test: Were-worm (td-80)
 * Type: hazard-creature
 * Race: drake
 * Stats: prowess 13, strikes 1, kill-marshalling-points 2, body 6
 * Keyed to: wilderness {w}
 * Effects: 1 (on-event: character-wounded-by-self → force-discard-one-company-item, chooser: attacker)
 *
 * "Drake. One strike. Attacker chooses defending characters. Defending
 *  company must discard one item of attacker's choice for each character
 *  wounded by Were-worm."
 *
 * Rules covered by tests:
 * 1. Combat initiates with 1 strike and prowess 13.
 * 2. A wound enqueues a discard-one-company-item pending resolution for the
 *    ATTACKING player — CRF 22: "Wounding an ally discards an item," and the
 *    card text is explicit that the item is "of attacker's choice", unlike
 *    Brigands (tw-17) where the choice belongs to the defender.
 * 3. The attacker may choose any item in the defending company to discard,
 *    and it moves to the defender's discard pile.
 * 4. No pending resolution when no character is wounded.
 * 5. No pending resolution when the company has no items, even if wounded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, dispatch, expectCharItemCount,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const WERE_WORM = 'td-80' as CardDefinitionId;
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

describe('Were-worm (td-80)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with 1 strike and prowess 13', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [WERE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character triggers discard-one-company-item pending resolution for the attacker', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [WERE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING);

    // Strike roll 2: well below the ~8 needed against prowess 13 → wounded.
    // Body check roll 2 → survives (2 < body 9).
    const s = runCreatureCombat(afterChain, ARAGORN, 2, 2);
    expect(s.combat).toBeNull();

    // One discard-one-company-item pending resolution, actor is the ATTACKER (P2).
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_2);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    // The defender (item owner) has no such resolution — the choice is not theirs.
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);

    const viable = viableActions(s, PLAYER_2, 'discard-item-from-company');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('attacker chooses which item to discard and it moves to the defender\'s discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [WERE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING);

    const s = runCreatureCombat(afterChain, ARAGORN, 2, 2);
    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_2)).toHaveLength(1);

    // Two items available for the attacker to pick from.
    const discardActions = viableActions(s, PLAYER_2, 'discard-item-from-company');
    expect(discardActions).toHaveLength(2);

    const chosen = discardActions[0].action;
    const chosenInstanceId = (chosen as { itemInstanceId: string }).itemInstanceId;

    const afterDiscard = dispatch(s, chosen);

    expectCharItemCount(afterDiscard, RESOURCE_PLAYER, ARAGORN, 1);
    const discardPileIds = afterDiscard.players[0].discardPile.map(c => c.instanceId);
    expect(discardPileIds).toContain(chosenInstanceId);

    expect(afterDiscard.pendingResolutions.filter(r => r.actor === PLAYER_2)).toHaveLength(0);
  });

  test('no pending resolution when no character is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [WERE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING);

    // High roll comfortably beats the strike — Aragorn defeats it, no wound.
    // Untapped defeats trigger a body check against the creature itself
    // (need 7+ vs body 6); roll 12 comfortably eliminates it.
    const s = runCreatureCombat(afterChain, ARAGORN, 12, 12);
    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_2)).toHaveLength(0);
  });

  test('no pending resolution when the company has no items, even if wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [WERE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING);

    const s = runCreatureCombat(afterChain, ARAGORN, 2, 2);
    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_2)).toHaveLength(0);
  });
});

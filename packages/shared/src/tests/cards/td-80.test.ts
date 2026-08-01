/**
 * @module td-80.test
 *
 * Card test: Were-worm (td-80)
 * Type: hazard-creature (Drake), non-unique.
 * Strikes: 1, Prowess: 13, Body: 6, kill MP 2.
 * Keyed to `{w}` — one Wilderness in the site path.
 *
 * Card text: "Drake. One strike. Attacker chooses defending characters.
 * Defending company must discard one item of attacker's choice for each
 * character wounded by Were-worm."
 *
 * Rule coverage:
 *
 * | # | Rule                                   | Mechanism                                          |
 * |---|-----------------------------------------|-----------------------------------------------------|
 * | 1 | One strike at 13 prowess, body 6        | printed stats → CombatState                        |
 * | 2 | Attacker chooses defending characters   | combat-attacker-chooses-defenders (cancel-window)   |
 * | 3 | Discard an item per wounded character    | on-event: character-wounded-by-self →              |
 * |   |                                          | force-discard-one-company-item, chooser: attacker  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, dispatch, expectCharItemCount,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WERE_WORM = 'td-80' as CardDefinitionId;
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

describe('Were-worm (td-80)', () => {
  beforeEach(() => resetMint());

  test('combat opens in the cancel-window with 1 strike at 13 prowess, body 6', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [WERE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders opens a cancel-window before assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.attackerChoosesDefenders).toBe(true);
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.creatureBody).toBe(6);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  test('the hazard player (attacker) assigns the strike, the defender does not', () => {
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

  test('cancel-window: defender may only pass, then attacker assigns the strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [WERE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, wormId, companyId, WILDERNESS_KEYING,
    );

    // Cancel-window: defender may only pass; attacker has nothing to do yet.
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableFor(afterChain, PLAYER_2)).toHaveLength(0);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
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

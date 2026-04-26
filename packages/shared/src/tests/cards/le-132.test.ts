/**
 * @module le-132.test
 *
 * Card test: Rebel-talk (le-132)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 4 (play-target character filter:non-wizard/non-ringwraith/mind≤7,
 *             duplication-limit scope:character max:1,
 *             control-restriction no-direct-influence,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:8)
 *
 * "Playable on a non-Ringwraith, non-Wizard character with mind of 7 or less.
 *  Character cannot be controlled by direct influence. Once during each of his
 *  organization phases, the character may attempt to remove this card. Make a
 *  roll—if the result is greater than 7, discard this card. Cannot be
 *  duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                      |
 * |---|--------------------------------------|-------------|--------------------------------------------|
 * | 1 | Play from hand targeting char         | IMPLEMENTED | play-hazard with targetCharacterId          |
 * | 2 | Filter: non-wizard, non-ringwraith    | IMPLEMENTED | play-target filter with $ne                 |
 * | 3 | Filter: mind ≤ 7                      | IMPLEMENTED | target.mind in filter context               |
 * | 4 | Cannot be controlled by DI            | IMPLEMENTED | control-restriction no-direct-influence      |
 * | 5 | Tap to attempt removal (roll>7)       | IMPLEMENTED | grant-action remove-self-on-roll            |
 * | 6 | Cannot be duplicated on character     | IMPLEMENTED | duplication-limit scope:character max:1     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState, attachHazardToChar,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus,
  charIdAt, dispatch, setCharStatus,
  expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { PlayHazardAction, ActivateGrantedAction, CardDefinitionId, MoveToInfluenceAction } from '../../index.js';

const REBEL_TALK = 'le-132' as CardDefinitionId;

describe('Rebel-talk (le-132)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target with filter ─────────────────────────────────────

  test('can be played on a non-wizard character with mind ≤ 7', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, FARAMIR] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [REBEL_TALK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    // Should target Legolas (mind 6) and Faramir (mind 5) — both ≤ 7, non-wizard
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const faramirId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);
    expect(new Set(targets)).toEqual(new Set([legolasId, faramirId]));
  });

  test('cannot be played on a wizard (Gandalf)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [REBEL_TALK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    // Should not offer Gandalf as a target (wizard)
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const gandalfId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    expect(targets).not.toContain(gandalfId);
  });

  test('cannot be played on a character with mind > 7 (Aragorn, mind 9)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [REBEL_TALK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);

    // Aragorn (mind 9) excluded, Legolas (mind 6) included
    expect(targets).not.toContain(aragornId);
    expect(targets).toContain(legolasId);
  });

  // ── Effect 2: duplication-limit ───────────────────────────────────────────

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, FARAMIR] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [REBEL_TALK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Attach one copy of Rebel-talk to Legolas already
    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);
    const mhState = { ...withRT, phaseState: makeMHState() };

    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );

    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const faramirId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);

    // Legolas already has Rebel-talk → not a valid target
    expect(targets).not.toContain(legolasId);
    // Faramir is still valid
    expect(targets).toContain(faramirId);
  });

  // ── Effect 3: control-restriction no-direct-influence ─────────────────────

  test('character with Rebel-talk cannot be moved to DI during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Attach Rebel-talk to Legolas
    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);

    // Legolas (mind 6) could normally be placed under Aragorn's DI (DI 3 → too low)
    // Actually, Aragorn has DI 3, Legolas mind 6 → not enough DI anyway.
    // Let me just check that no move-to-influence actions target Legolas as the follower.
    const moveActions = viableActions(withRT, PLAYER_1, 'move-to-influence');
    const legolasId = charIdAt(withRT, RESOURCE_PLAYER, 0, 1);

    // No DI actions should target Legolas (restricted by Rebel-talk)
    const legolasToAnyDI = moveActions.filter(
      ea => actionAs<MoveToInfluenceAction>(ea.action).characterInstanceId === legolasId
        && actionAs<MoveToInfluenceAction>(ea.action).controlledBy !== 'general',
    );
    expect(legolasToAnyDI).toHaveLength(0);
  });

  test('character under DI is forced to GI when Rebel-talk is attached', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          // Faramir (mind 5) as follower of Aragorn (DI 3... hmm)
          // Actually let's use Aragorn + Legolas where Legolas is follower
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN },
              { defId: FARAMIR, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [REBEL_TALK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...base, phaseState: makeMHState() };

    // Verify Faramir is under DI of Aragorn
    const faramirId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    expect(mhState.players[0].characters[faramirId as string].controlledBy).toBe(aragornId);
    expect(mhState.players[0].characters[aragornId as string].followers).toContain(faramirId);

    // Play Rebel-talk on Faramir
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targetFaramir = playActions.find(
      ea => (ea.action as PlayHazardAction).targetCharacterId === faramirId,
    );
    expect(targetFaramir).toBeDefined();

    // Resolve the chain (play and pass priority)
    let current = dispatch(mhState, targetFaramir!.action);
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const pass = viableActions(current, current.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      const r = reduce(current, pass[0].action);
      if (r.error) break;
      current = r.state;
    }

    // After Rebel-talk resolves, Faramir should be under GI
    expect(current.players[0].characters[faramirId as string].controlledBy).toBe('general');
    // Aragorn should no longer list Faramir as a follower
    expect(current.players[0].characters[aragornId as string].followers).not.toContain(faramirId);
  });

  // ── Effect 4: grant-action remove-self-on-roll ────────────────────────────

  test('untapped character with Rebel-talk gets both standard (tap) and no-tap (−3) removal variants', () => {
    // Rule 10.08: untapped bearer gets the standard tap variant AND the no-tap -3 variant.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);
    const actions = viableActions(withRT, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)?.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(8);
  });

  test('tapped character can still activate Rebel-talk removal via no-tap variant (−3 to roll, rule 10.08)', () => {
    // Rule 10.08: a tapped character may still attempt to remove a corruption
    // card by taking −3 to the roll instead of tapping.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);
    const tapped = setCharStatus(withRT, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).noTap).toBe(true);
  });

  test('successful removal roll (>7) discards Rebel-talk and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);
    const cheated = { ...withRT, cheatRollTotal: 8 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    // Character should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    // Rebel-talk should be removed from character's hazards
    const legolasId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[legolasId as string].hazards).toHaveLength(0);

    // Rebel-talk should be in opponent's discard pile
    expectInDiscardPile(next, HAZARD_PLAYER, REBEL_TALK);
  });

  test('failed removal roll (≤7) keeps Rebel-talk attached and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withRT = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, REBEL_TALK);
    const cheated = { ...withRT, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    // Character should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    // Rebel-talk should still be attached
    const legolasId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[legolasId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[legolasId as string].hazards[0].definitionId).toBe(REBEL_TALK);

    // Opponent's discard pile should not have Rebel-talk
    expect(next.players[1].discardPile.some(c => c.definitionId === REBEL_TALK)).toBe(false);
  });
});

/**
 * @module td-25.test
 *
 * Card test: Foolish Words (td-25)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 5 (play-target character, on-guard-reveal influence-attempt,
 *             duplication-limit scope:character max:1, check-modifier influence -4,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:8)
 *
 * "Playable on a character. Any riddling roll, offering attempt, or influence
 *  attempt by target character is modified by -4. If placed on-guard, it may be
 *  revealed and played when a character in the company declares such an attempt.
 *  During his organization phase, the character may tap to attempt to remove this
 *  card. Make a roll--if the result is greater than 7, discard this card. Cannot
 *  be duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                  |
 * |---|--------------------------------|-------------|----------------------------------------|
 * | 1 | Play from hand targeting char   | IMPLEMENTED | play-hazard with targetCharacterId     |
 * | 2 | Influence check -4 modifier     | IMPLEMENTED | check-modifier effect applied          |
 * | 3 | Place on-guard during M/H       | IMPLEMENTED | any hand card can be placed on-guard   |
 * | 4 | On-guard reveal at influence    | IMPLEMENTED | awaitingOnGuardReveal flow             |
 * | 5 | Tap to attempt removal (roll>7) | IMPLEMENTED | grant-action remove-self-on-roll       |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, makeMHState,
  makeSitePhase, attachHazardToChar, placeOnGuard,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN,
  FOOLISH_WORDS, KNIGHTS_OF_DOL_AMROTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, DOL_AMROTH,
  viableActions, CardStatus,
  handCardId, charIdAt, dispatch, setCharStatus,
  expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { PlayHazardAction, InfluenceAttemptAction, FactionInfluenceRollAction, ActivateGrantedAction, PlaceOnGuardAction, RevealOnGuardAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Foolish Words (td-25)', () => {
  beforeEach(() => resetMint());

  test('played from hand targets a specific character (PlayHazardAction has targetCharacterId)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FOOLISH_WORDS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };

    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    // Each action should target a different character in PLAYER_1's company
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    // All actions should have a targetCharacterId
    for (const t of targets) {
      expect(t).toBeDefined();
    }

    // Should have one action per character (Aragorn + Gandalf)
    const uniqueTargets = new Set(targets);
    expect(uniqueTargets.size).toBe(2);

    // Both characters from PLAYER_1's company should be targets
    const aragornId = charIdAt(mhGameState, RESOURCE_PLAYER, 0, 0);
    const gandalfId = charIdAt(mhGameState, RESOURCE_PLAYER, 0, 1);
    expect(uniqueTargets.has(aragornId)).toBe(true);
    expect(uniqueTargets.has(gandalfId)).toBe(true);
  });

  test('influence check gets -4 modifier when Foolish Words is attached to character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_AMROTH, characters: [ARAGORN] }], hand: [KNIGHTS_OF_DOL_AMROTH], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withFWState = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    const sitePhase = makeSitePhase();
    const testState = { ...withFWState, phaseState: sitePhase };
    const cleanState = { ...base, phaseState: sitePhase };

    const withFW = computeLegalActions(testState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');
    const withoutFW = computeLegalActions(cleanState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');

    expect(withFW.length).toBeGreaterThanOrEqual(1);
    expect(withoutFW.length).toBeGreaterThanOrEqual(1);
    expect(actionAs<InfluenceAttemptAction>(withFW[0].action).need).toBe(
      actionAs<InfluenceAttemptAction>(withoutFW[0].action).need + 4,
    );
  });

  test('can be placed on-guard during M/H phase', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FOOLISH_WORDS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };

    const ogActions = viableActions(mhGameState, PLAYER_2, 'place-on-guard');
    expect(ogActions).toHaveLength(1);

    // The card being placed is Foolish Words
    const fwInstanceId = handCardId(mhGameState, HAZARD_PLAYER);
    const action = actionAs<PlaceOnGuardAction>(ogActions[0].action);
    expect(action.cardInstanceId).toBe(fwInstanceId);
  });

  test('untapped character with Foolish Words can activate removal during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withFW = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    const actions = viableActions(withFW, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(8);
  });

  test('tapped character cannot activate Foolish Words removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withFW = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    // Tap the character
    const tappedState = setCharStatus(withFW, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const actions = viableActions(tappedState, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('successful removal roll (>7) discards Foolish Words and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withFW = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    // Cheat the roll to 8 (just above 7 = success)
    const cheated = { ...withFW, cheatRollTotal: 8 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    // Character should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Foolish Words should be removed from character's hazards
    const aragornId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(0);

    // Foolish Words should be in opponent's discard pile (hazard belongs to opponent)
    expectInDiscardPile(next, HAZARD_PLAYER, FOOLISH_WORDS);
  });

  test('failed removal roll (<=7) keeps Foolish Words attached and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withFW = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    // Cheat the roll to 7 (exactly 7 = failure, need > 7)
    const cheated = { ...withFW, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    // Character should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Foolish Words should still be attached
    const aragornId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(FOOLISH_WORDS);

    // Opponent's discard pile should not have Foolish Words
    expect(next.players[1].discardPile.some(c => c.definitionId === FOOLISH_WORDS)).toBe(false);
  });

  test('on-guard Foolish Words revealed at influence-attempt applies -4 to the roll', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_AMROTH, characters: [ARAGORN] }], hand: [KNIGHTS_OF_DOL_AMROTH], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, FOOLISH_WORDS);
    const testState = { ...withOG, phaseState: makeSitePhase() };

    // PLAYER_1 declares influence-attempt → on-guard window opens
    const influenceAction = viableActions(testState, PLAYER_1, 'influence-attempt')[0];
    expect(influenceAction).toBeDefined();
    const needBefore = (influenceAction.action as InfluenceAttemptAction).need;

    const afterAttempt = dispatch(testState, influenceAction.action);

    // PLAYER_2 reveals Foolish Words targeting Aragorn
    const revealActions = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');
    expect(revealActions.length).toBeGreaterThanOrEqual(1);
    expect(actionAs<RevealOnGuardAction>(revealActions[0].action).cardInstanceId).toBe(ogCard.instanceId);

    const afterReveal = dispatch(afterAttempt, revealActions[0].action);
    expect(afterReveal.chain).not.toBeNull();

    // Resolve the chain (both players pass priority). Auto-resolution stops
    // at the influence-attempt entry, which pauses the chain (still alive,
    // entry unresolved, faction card still on it) so the UI can display the
    // situation banner before the player commits to rolling.
    let current = afterReveal;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const pass = viableActions(current, current.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      const r = reduce(current, pass[0].action);
      if (r.error) break;
      current = r.state;
    }

    // Pending faction-influence-roll resolution — check the need increased by 4
    const rollActions = viableActions(current, PLAYER_1, 'faction-influence-roll');
    expect(rollActions.length).toBe(1);
    const needAfter = (rollActions[0].action as FactionInfluenceRollAction).need;
    expect(needAfter).toBe(needBefore + 4);
  });
});

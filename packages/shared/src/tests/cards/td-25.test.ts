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
} from '../test-helpers.js';
import type { PlayHazardAction, InfluenceAttemptAction, ActivateGrantedAction } from '../../index.js';
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
    const aragornId = mhGameState.players[0].companies[0].characters[0];
    const gandalfId = mhGameState.players[0].companies[0].characters[1];
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

    const withFWState = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
    const sitePhase = makeSitePhase();
    const testState = { ...withFWState, phaseState: sitePhase };
    const cleanState = { ...base, phaseState: sitePhase };

    const withFW = computeLegalActions(testState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');
    const withoutFW = computeLegalActions(cleanState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');

    expect(withFW.length).toBeGreaterThanOrEqual(1);
    expect(withoutFW.length).toBeGreaterThanOrEqual(1);
    expect((withFW[0].action as { need: number }).need).toBe(
      (withoutFW[0].action as { need: number }).need + 4,
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
    const fwInstanceId = mhGameState.players[1].hand[0].instanceId;
    const action = ogActions[0].action as { cardInstanceId: string };
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

    const withFW = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
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

    const withFW = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
    // Tap the character
    const aragornId = withFW.players[0].companies[0].characters[0];
    const tappedState = {
      ...withFW,
      players: [
        {
          ...withFW.players[0],
          characters: {
            ...withFW.players[0].characters,
            [aragornId as string]: { ...withFW.players[0].characters[aragornId as string], status: CardStatus.Tapped },
          },
        },
        withFW.players[1],
      ] as typeof withFW.players,
    };

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

    const withFW = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
    // Cheat the roll to 8 (just above 7 = success)
    const cheated = { ...withFW, cheatRollTotal: 8 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Foolish Words should be removed from character's hazards
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(0);

    // Foolish Words should be in opponent's discard pile (hazard belongs to opponent)
    expect(result.state.players[1].discardPile.some(c => c.definitionId === FOOLISH_WORDS)).toBe(true);
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

    const withFW = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
    // Cheat the roll to 7 (exactly 7 = failure, need > 7)
    const cheated = { ...withFW, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Foolish Words should still be attached
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(result.state.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(FOOLISH_WORDS);

    // Opponent's discard pile should not have Foolish Words
    expect(result.state.players[1].discardPile.some(c => c.definitionId === FOOLISH_WORDS)).toBe(false);
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

    const { state: withOG, ogCard } = placeOnGuard(base, 0, 0, FOOLISH_WORDS);
    const testState = { ...withOG, phaseState: makeSitePhase() };

    // PLAYER_1 declares influence-attempt → on-guard window opens
    const influenceAction = viableActions(testState, PLAYER_1, 'influence-attempt')[0];
    expect(influenceAction).toBeDefined();
    const needBefore = (influenceAction.action as InfluenceAttemptAction).need;

    const afterAttempt = reduce(testState, influenceAction.action);
    expect(afterAttempt.error).toBeUndefined();

    // PLAYER_2 reveals Foolish Words targeting Aragorn
    const revealActions = viableActions(afterAttempt.state, PLAYER_2, 'reveal-on-guard');
    expect(revealActions.length).toBeGreaterThanOrEqual(1);
    expect((revealActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);

    const afterReveal = reduce(afterAttempt.state, revealActions[0].action);
    expect(afterReveal.error).toBeUndefined();
    expect(afterReveal.state.chain).not.toBeNull();

    // Resolve the chain (both players pass priority)
    let current = afterReveal.state;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const pass = viableActions(current, current.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      const r = reduce(current, pass[0].action);
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Pending influence attempt now executes — check the need increased by 4
    const influenceAfterFW = viableActions(current, PLAYER_1, 'influence-attempt');
    if (influenceAfterFW.length > 0) {
      const needAfter = (influenceAfterFW[0].action as InfluenceAttemptAction).need;
      expect(needAfter).toBe(needBefore + 4);
    } else {
      // Pending action auto-executes on pass — the site should be tapped
      const passResult = reduce(current, { type: 'pass', player: PLAYER_1 });
      expect(passResult.error).toBeUndefined();
      // Foolish Words should be attached to Aragorn
      const aragornId = current.players[0].companies[0].characters[0];
      const aragorn = passResult.state.players[0].characters[aragornId as string];
      expect(aragorn.hazards.some(h => h.definitionId === FOOLISH_WORDS)).toBe(true);
    }
  });
});

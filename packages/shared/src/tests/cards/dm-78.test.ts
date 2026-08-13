/**
 * @module dm-78.test
 *
 * Card test: Pale Dream-maker (dm-78)
 * Type: hazard-event (permanent)
 *
 * "Corruption. Dark Enchantment. Playable on a non-Wizard character wounded
 *  by an Undead attack this turn; does not count against the hazard limit.
 *  Target character receives 2 corruption points and makes a corruption
 *  check each time his player discards a card from his hand during his
 *  turn. His direct influence is zero while bearing this card. Cannot be
 *  duplicated on a given character. During the organization phase, a sage
 *  in target character's company (other than character) may tap to attempt
 *  to remove this card. Make a roll: if the result is greater than 6,
 *  discard this card."
 *
 * Engine Support:
 * | # | Rule                                          | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Playable on a non-Wizard character wounded by | IMPLEMENTED | play-target character filter on the new       |
 * |   | an Undead attack this turn                    |             | `target.woundedByRaceThisTurn` context field, |
 * |   |                                                |             | populated in `combat-finalize.ts` and cleared |
 * |   |                                                |             | for every character in `enterUntapPhase`.     |
 * | 2 | Does not count against the hazard limit       | IMPLEMENTED | play-flag: no-hazard-limit.                   |
 * | 3 | +2 corruption points while attached           | IMPLEMENTED | stat-modifier corruption-points +2.           |
 * | 4 | Corruption check each time bearer's player    | IMPLEMENTED | on-event `card-discarded-from-hand`, fired    |
 * |   | discards a card from hand during his turn     |             | from the new `hand-discard-trigger.ts`        |
 * |   |                                                |             | prev/next diff hooked into `postReduce`.      |
 * | 5 | Direct influence is zero while bearing        | IMPLEMENTED | stat-modifier direct-influence op:set value:0.|
 * | 6 | Cannot be duplicated on a given character     | IMPLEMENTED | duplication-limit scope:character max:1.      |
 * | 7 | Sage in target's company (other than          | IMPLEMENTED | grant-action remove-self-on-roll, cost tap    |
 * |   | character) may tap to attempt removal (>6)    |             | "sage-in-company-excluding-bearer", threshold |
 * |   |                                                |             | 6, excluding the bearer from eligible sages.  |
 * | 8 | Keywords: corruption, dark-enchantment        | DATA        | Present in keywords[].                        |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, phaseStateAs,
  attachHazardToChar, recomputeDerived, setWoundedByRaceThisTurn,
  PLAYER_1, PLAYER_2,
  ARAGORN, ELROND, GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, findCharInstanceId, dispatch, executeAction, makeCancelWindowCombat, makeMHState,
  viableActions, grantedActionsFor, expectInDiscardPile, expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, EndOfTurnPhaseState, GameState, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';
import { CardStatus, Race } from '../../index.js';

const PALE_DREAM_MAKER = 'dm-78' as CardDefinitionId;
const STIRRING_BONES = 'dm-111' as CardDefinitionId; // Undead hazard creature

describe('Pale Dream-maker (dm-78)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable on a non-Wizard character wounded by Undead this turn ─

  test('an Undead attack that wounds a character records it, making the card playable on that character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [RIVENDELL] },
      ],
    });
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: STIRRING_BONES,
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 9,
    });
    const aragornId = findCharInstanceId(combatState, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);      // untapped defense: roll 2 + prowess 3 = 5 < 9 → wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 9);     // roll 9: 9 <= body 9 → survives wounded

    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[aragornId].woundedByRaceThisTurn).toEqual([Race.Undead]);

    const stateAtPlayHazards = { ...s, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const plays = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === aragornId)).toHaveLength(1);
  });

  test('NOT offered on a character who has not been wounded this turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered against a Wizard, even if wounded by an Undead attack this turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wounded = setWoundedByRaceThisTurn(base, RESOURCE_PLAYER, GANDALF, [Race.Undead]);
    const stateAtPlayHazards = { ...wounded, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered when wounded by a non-Undead race attack this turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wounded = setWoundedByRaceThisTurn(base, RESOURCE_PLAYER, ARAGORN, [Race.Orc]);
    const stateAtPlayHazards = { ...wounded, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('wound history clears at the start of a new turn, so the play window closes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wounded = setWoundedByRaceThisTurn(base, RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const eotState = phaseStateAs<EndOfTurnPhaseState>(wounded);
    const atSignalEnd: GameState = {
      ...wounded,
      phaseState: { ...eotState, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
    };

    const aragornId = charIdAt(atSignalEnd, RESOURCE_PLAYER);
    expect(atSignalEnd.players[RESOURCE_PLAYER].characters[aragornId].woundedByRaceThisTurn).toEqual([Race.Undead]);

    // Player 1 ends their turn — a new turn begins for player 2.
    const nextTurn = dispatch(atSignalEnd, { type: 'pass', player: PLAYER_1 });
    expect(nextTurn.phaseState.phase).toBe(Phase.Untap);
    expect(nextTurn.activePlayer).toBe(PLAYER_2);
    expect(nextTurn.players[RESOURCE_PLAYER].characters[aragornId].woundedByRaceThisTurn).toEqual([]);

    const stateAtPlayHazards = { ...nextTurn, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 2: does not count against the hazard limit ────────────────────────

  test('remains offered even when the hazard limit for this company is already reached', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wounded = setWoundedByRaceThisTurn(base, RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const atCap: GameState = {
      ...wounded,
      phaseState: {
        ...makeMHState({ activeCompanyIndex: 0 }),
        hazardsPlayedThisCompany: 5,
        hazardLimitAtReveal: 2,
      } as MovementHazardPhaseState,
    };
    const aragornId = charIdAt(atCap, RESOURCE_PLAYER);
    const plays = viableActions(atCap, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === aragornId)).toHaveLength(1);
  });

  // ─── Rule 3: +2 corruption points while attached ─────────────────────────────

  test('attached Pale Dream-maker adds 2 corruption points to the bearer', () => {
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
    expect(base.players[0].characters[aragornId].effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, PALE_DREAM_MAKER));
    expect(withCard.players[0].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });

  // ─── Rule 5: direct influence is zero while bearing this card ───────────────

  test('bearer\'s direct influence is set to zero while the card is attached', () => {
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
    expect(base.players[0].characters[aragornId].effectiveStats.directInfluence).toBe(3);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, PALE_DREAM_MAKER));
    expect(withCard.players[0].characters[aragornId].effectiveStats.directInfluence).toBe(0);
  });

  // ─── Rule 6: cannot be duplicated on a given character ───────────────────────

  test('cannot be duplicated on a character who already bears a copy', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PALE_DREAM_MAKER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wounded = setWoundedByRaceThisTurn(base, RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const withOne = attachHazardToChar(wounded, RESOURCE_PLAYER, ARAGORN, PALE_DREAM_MAKER);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 4: corruption check on each hand discard during the bearer's own turn ──

  test('bearer\'s controller discarding a card during their own turn triggers a corruption check', () => {
    const dummyCards = Array.from({ length: 9 }, () => LEGOLAS);
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: dummyCards, siteDeck: [MORIA], playDeck: [LEGOLAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, PALE_DREAM_MAKER);
    const eotState = phaseStateAs<EndOfTurnPhaseState>(withCard);
    const resetState: GameState = {
      ...withCard,
      phaseState: { ...eotState, step: 'reset-hand', discardDone: [true, true] },
    };

    const discardActions = viableActions(resetState, PLAYER_1, 'discard-card');
    expect(discardActions.length).toBeGreaterThan(0);
    const next = dispatch(resetState, discardActions[0].action);

    const aragornId = charIdAt(next, RESOURCE_PLAYER);
    const pending = next.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);
    expect(pending[0].kind.reason).toBe('Pale Dream-maker');
  });

  test('a discard during a DIFFERENT player\'s turn does NOT trigger the bearer\'s check', () => {
    // Same fixture, but it is player 2's end-of-turn cycle — player 1 (the
    // bearer's own controller) discarding here is not "during his turn".
    const dummyCards = Array.from({ length: 9 }, () => LEGOLAS);
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: dummyCards, siteDeck: [MORIA], playDeck: [LEGOLAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, PALE_DREAM_MAKER);
    const eotState = phaseStateAs<EndOfTurnPhaseState>(withCard);
    const resetState: GameState = {
      ...withCard,
      phaseState: { ...eotState, step: 'reset-hand', discardDone: [true, true] },
    };

    const discardActions = viableActions(resetState, PLAYER_1, 'discard-card');
    expect(discardActions.length).toBeGreaterThan(0);
    const next = dispatch(resetState, discardActions[0].action);

    expect(next.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Rule 7: sage-tap removal (excluding the bearer) during organization ────

  test('bearer alone in his company (even as a sage) is NOT offered self-removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ELROND, PALE_DREAM_MAKER);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);

    expect(grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);
    expect(viableActions(withCard, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('a different sage in the bearer\'s company may tap to attempt removal; the bearer is excluded', () => {
    // Elrond (sage, bearer) and Gandalf (sage, companion) share a company.
    // Only Gandalf may tap — Elrond is excluded by "(other than character)".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ELROND, PALE_DREAM_MAKER);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    const gandalfId = findCharInstanceId(withCard, RESOURCE_PLAYER, GANDALF);

    expect(grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);

    const gandalfOffers = grantedActionsFor(withCard, gandalfId, 'remove-self-on-roll', PLAYER_1);
    expect(gandalfOffers).toHaveLength(1);
    expect(gandalfOffers[0].rollThreshold).toBe(7);
  });

  test('successful removal roll (>6) discards the card and taps the acting sage, not the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ELROND, PALE_DREAM_MAKER);
    const gandalfId = findCharInstanceId(withCard, RESOURCE_PLAYER, GANDALF);
    const offers = grantedActionsFor(withCard, gandalfId, 'remove-self-on-roll', PLAYER_1);
    expect(offers).toHaveLength(1);

    const cheated = { ...withCard, cheatRollTotal: 7 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Untapped);

    const elrondId = findCharInstanceId(next, RESOURCE_PLAYER, ELROND);
    expect(next.players[RESOURCE_PLAYER].characters[elrondId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, PALE_DREAM_MAKER);
  });

  test('failed removal roll (<=6) keeps the card attached but still taps the acting sage', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ELROND, PALE_DREAM_MAKER);
    const gandalfId = findCharInstanceId(withCard, RESOURCE_PLAYER, GANDALF);
    const offers = grantedActionsFor(withCard, gandalfId, 'remove-self-on-roll', PLAYER_1);

    const cheated = { ...withCard, cheatRollTotal: 6 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const elrondId = findCharInstanceId(next, RESOURCE_PLAYER, ELROND);
    const hazards = next.players[RESOURCE_PLAYER].characters[elrondId].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(PALE_DREAM_MAKER);
  });
});

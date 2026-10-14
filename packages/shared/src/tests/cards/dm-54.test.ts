/**
 * @module dm-54.test
 *
 * Card test: Endless Whispers (dm-54)
 * Type: hazard-event (permanent)
 *
 * "Dark Enchantment. Playable on a non-Wizard character wounded by an Undead
 *  attack this turn; does not count against the hazard limit. Target
 *  character can never become untapped while bearing this card. Any effect
 *  that would move him to an untapped state makes him tapped instead. Cannot
 *  be duplicated on a given character. During the organization phase, a sage
 *  in target character's company may tap to attempt to remove this card.
 *  Make a roll: if the result is greater than 7, discard this card."
 *
 * Engine Support:
 * | # | Rule                                          | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Playable on a non-Wizard character wounded by | IMPLEMENTED | play-target filter on                         |
 * |   | an Undead attack this turn                    |             | `target.woundedByRaceThisTurn` (as dm-78).    |
 * | 2 | Does not count against the hazard limit       | IMPLEMENTED | play-flag: no-hazard-limit.                   |
 * | 3 | Never becomes untapped; any untap effect taps | IMPLEMENTED | play-flag: bearer-never-untaps — post-reduce  |
 * |   | him instead                                   |             | prev/next diff (`never-untaps.ts`) + honoured |
 * |   |                                                |             | by `characterHasCannotUntapConstraint`.       |
 * | 4 | Cannot be duplicated on a given character     | IMPLEMENTED | duplication-limit scope:character max:1.      |
 * | 5 | A sage in target's company may tap to attempt | IMPLEMENTED | grant-action remove-self-on-roll, cost tap    |
 * |   | removal (>7)                                  |             | "sage-in-company", threshold 8.               |
 *
 * Playable: YES — every rule is implemented and exercised below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, attachItemToChar, setCharStatus, setWoundedByRaceThisTurn,
  PLAYER_1, PLAYER_2,
  ARAGORN, ELROND, GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, findCharInstanceId, dispatch, makeMHState,
  viableActions, grantedActionsFor, expectInDiscardPile, expectCharStatus, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, GameState, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';
import { CardStatus, Race } from '../../index.js';

const ENDLESS_WHISPERS = 'dm-54' as CardDefinitionId;
const JEWEL_OF_BELERIAND = 'as-70' as CardDefinitionId; // "the bearer untaps if tapped" on a roll > 6

/** Moves `state` into the active player's untap phase, before untapping. */
function inUntapPhase(state: GameState): GameState {
  return {
    ...state,
    phaseState: {
      phase: Phase.Untap,
      untapped: false,
      hazardSideboardDestination: null,
      hazardSideboardFetched: 0,
      hazardSideboardAccessed: false,
      resourcePlayerPassed: false,
      hazardPlayerPassed: false,
    } as GameState['phaseState'],
  };
}

function mhState(hand: CardDefinitionId[], chars = [ARAGORN]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: chars }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
}

function orgState(chars: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: chars }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Endless Whispers (dm-54)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable on a non-Wizard character wounded by Undead this turn ─

  test('playable on a character wounded by an Undead attack this turn, and attaches on resolution', () => {
    const base = setWoundedByRaceThisTurn(mhState([ENDLESS_WHISPERS]), RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const aragornId = charIdAt(state, RESOURCE_PLAYER);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const onAragorn = plays.filter(p => p.action.targetCharacterId === aragornId);
    expect(onAragorn).toHaveLength(1);

    const resolved = resolveChain(dispatch(state, onAragorn[0].action));
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].hazards.map(h => h.definitionId))
      .toContain(ENDLESS_WHISPERS);
  });

  test('NOT playable on a character who has not been wounded this turn', () => {
    const state = { ...mhState([ENDLESS_WHISPERS]), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable on a character wounded by a non-Undead attack', () => {
    const base = setWoundedByRaceThisTurn(mhState([ENDLESS_WHISPERS]), RESOURCE_PLAYER, ARAGORN, [Race.Orc]);
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable on a Wizard, even if wounded by an Undead attack', () => {
    const base = setWoundedByRaceThisTurn(mhState([ENDLESS_WHISPERS], [GANDALF]), RESOURCE_PLAYER, GANDALF, [Race.Undead]);
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 2: does not count against the hazard limit ────────────────────────

  test('still playable, and attaches, when the hazard limit is already reached', () => {
    const base = setWoundedByRaceThisTurn(mhState([ENDLESS_WHISPERS]), RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const state: GameState = {
      ...base,
      phaseState: {
        ...makeMHState({ activeCompanyIndex: 0 }),
        hazardsPlayedThisCompany: 2,
        hazardLimitAtReveal: 2,
      } as MovementHazardPhaseState,
    };
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const plays = (viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[])
      .filter(p => p.action.targetCharacterId === aragornId);
    expect(plays).toHaveLength(1);

    const resolved = resolveChain(dispatch(state, plays[0].action));
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].hazards.map(h => h.definitionId))
      .toContain(ENDLESS_WHISPERS);
  });

  // ─── Rule 3: never becomes untapped; untap effects tap him instead ──────────

  test('a tapped bearer stays tapped through the untap phase', () => {
    const tapped = setCharStatus(orgState([ARAGORN, LEGOLAS]), RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(setCharStatus(tapped, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped), RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);

    const after = dispatch(inUntapPhase(withCard), { type: 'untap', player: PLAYER_1 });
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    // Control: a companion without the card untaps normally.
    expectCharStatus(after, RESOURCE_PLAYER, LEGOLAS, CardStatus.Untapped);
  });

  test('a wounded bearer at a Haven heals only to tapped, never to untapped', () => {
    const wounded = setCharStatus(orgState([ARAGORN]), RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const withCard = attachHazardToChar(wounded, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);

    const healed = dispatch(inUntapPhase(withCard), { type: 'untap', player: PLAYER_1 });
    expectCharStatus(healed, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // And the following untap phase still does not untap him.
    const again = dispatch(inUntapPhase(healed), { type: 'untap', player: PLAYER_1 });
    expectCharStatus(again, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('an effect that would untap the bearer (Jewel of Beleriand) leaves him tapped instead', () => {
    const base = attachItemToChar(orgState([ARAGORN]), RESOURCE_PLAYER, ARAGORN, JEWEL_OF_BELERIAND);
    const tapped = setCharStatus(base, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(tapped, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);

    const jewel = viableActions(withCard, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    );
    expect(jewel).toBeDefined();
    const next = dispatch({ ...withCard, cheatRollTotal: 12 }, jewel!.action);
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Control: without Endless Whispers the same roll untaps him.
    const control = dispatch({ ...tapped, cheatRollTotal: 12 }, viableActions(tapped, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    )!.action);
    expectCharStatus(control, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('once the card is removed, the character untaps normally again', () => {
    const tapped = setCharStatus(orgState([ARAGORN, ELROND]), RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(tapped, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    const offer = grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)[0];
    const removed = dispatch({ ...withCard, cheatRollTotal: 8 }, offer);
    expectInDiscardPile(removed, HAZARD_PLAYER, ENDLESS_WHISPERS);

    const after = dispatch(inUntapPhase(removed), { type: 'untap', player: PLAYER_1 });
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  // ─── Rule 4: cannot be duplicated on a given character ──────────────────────

  test('cannot be played on a character who already bears a copy', () => {
    const wounded = setWoundedByRaceThisTurn(mhState([ENDLESS_WHISPERS]), RESOURCE_PLAYER, ARAGORN, [Race.Undead]);
    const withOne = attachHazardToChar(wounded, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const state = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 5: sage in the company taps to attempt removal (> 7) ──────────────

  test('no removal is offered without a sage in the bearer\'s company', () => {
    const withCard = attachHazardToChar(orgState([ARAGORN, LEGOLAS]), RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const aragornId = charIdAt(withCard, RESOURCE_PLAYER);
    expect(grantedActionsFor(withCard, aragornId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);
    expect(viableActions(withCard, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('an untapped sage in the company is offered removal with a roll threshold of 8', () => {
    const tapped = setCharStatus(orgState([ARAGORN, ELROND]), RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(tapped, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    const offers = grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1);
    expect(offers).toHaveLength(1);
    expect(offers[0].rollThreshold).toBe(8);
  });

  test('the bearer himself, if an untapped sage, may tap to attempt removal', () => {
    const withCard = attachHazardToChar(orgState([ELROND]), RESOURCE_PLAYER, ELROND, ENDLESS_WHISPERS);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    expect(grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(1);
  });

  test('a roll of 8 (> 7) discards the card and taps the sage', () => {
    const tapped = setCharStatus(orgState([ARAGORN, ELROND]), RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(tapped, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    const offer = grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)[0];

    const next = dispatch({ ...withCard, cheatRollTotal: 8 }, offer);
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, ENDLESS_WHISPERS);
  });

  test('a roll of 7 (not > 7) keeps the card attached but still taps the sage', () => {
    const tapped = setCharStatus(orgState([ARAGORN, ELROND]), RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const withCard = attachHazardToChar(tapped, RESOURCE_PLAYER, ARAGORN, ENDLESS_WHISPERS);
    const elrondId = findCharInstanceId(withCard, RESOURCE_PLAYER, ELROND);
    const offer = grantedActionsFor(withCard, elrondId, 'remove-self-on-roll', PLAYER_1)[0];

    const next = dispatch({ ...withCard, cheatRollTotal: 7 }, offer);
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards.map(h => h.definitionId))
      .toEqual([ENDLESS_WHISPERS]);
  });
});

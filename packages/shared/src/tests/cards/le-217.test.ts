/**
 * @module le-217.test
 *
 * Card test: Orc Stealth (le-217)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 1 (strike-modifier: cancel mode, filter — race orc + skill scout)
 *
 * "Orc scout only. Cancel one strike against an Orc scout."
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike for an Orc-scout
 *    defender when Orc Stealth is in hand, with need 0 (outright cancel).
 * 2. Playing it cancels the current strike immediately (no roll, no chain):
 *    the defender stays untapped, the card is discarded, and combat advances
 *    to the next unresolved strike.
 * 3. Not available for a non-Orc scout (an Elf with the scout skill).
 * 4. Not available for an Orc without the scout skill.
 * 5. Not playable as a short event during organization (combat-only).
 *
 * Fixtures:
 *   GORBAG (le-11)   — minion Orc, warrior + scout, prowess 6, body 9
 *   CALENDAL (le-4)  — minion Elf, scout + sage (non-Orc), prowess 4, body 8
 *   LAGDUF (le-18)   — minion Orc, warrior only (non-scout), prowess 5, body 8
 *   MORIA_LE (le-392)     — minion shadow-hold (company site during M/H)
 *   DOL_GULDUR (le-367)   — minion haven (opponent site)
 *   MINAS_MORGUL (le-390) — minion haven (site deck)
 *   CAVE_DRAKE (tw-63)    — hazard creature, 2 strikes, prowess 10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  buildTestState, resetMint,
  handCardId, dispatch, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
  findCharInstanceId, companyIdAt, makeMHState, playCreatureHazardAndResolve,
  assignBothStrikesTo,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId,
  PlayStrikeEventAction,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

const ORC_STEALTH = 'le-217' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const CALENDAL = 'le-4' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const MORIA_LE = 'le-392' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Build a M/H combat state with minion characters and a Cave-drake. */
function setupMinionCombat(opts: {
  minionChars: readonly CardDefinitionId[];
  resourceHand?: readonly CardDefinitionId[];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA_LE, characters: [...opts.minionChars] }],
        hand: [...(opts.resourceHand ?? [])],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
        hand: [CAVE_DRAKE],
        siteDeck: [MORIA_LE],
      },
    ],
  });
  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hollin', 'Enedhwaith'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...state, phaseState: mhState };
  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const wildernessKeying = { method: 'region-type' as const, value: 'wilderness' };
  const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, wildernessKeying);
  expect(s0.combat).not.toBeNull();
  return s0;
}

describe('Orc Stealth (le-217)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike for an Orc scout, with need 0', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [ORC_STEALTH],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const actions = computeLegalActions(s1, PLAYER_1);
    const osActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(osActions.length).toBe(1);
    expect(actionAs<PlayStrikeEventAction>(osActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
    expect(actionAs<PlayStrikeEventAction>(osActions[0].action).need).toBe(0);
  });

  test('canceling the strike leaves the defender untapped, discards the card, and finalizes combat', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [ORC_STEALTH],
    });
    // Both of Cave-drake's strikes are assigned to GORBAG (one strike +
    // one excess), so this single strike assignment is the only one.
    const s1 = assignBothStrikesTo(s0, GORBAG);
    expect(s1.combat!.strikeAssignments.length).toBe(1);

    const osAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;

    // No cheatRollTotal set — cancel mode never rolls dice.
    const s2 = dispatch(s1, osAction.action);

    // GORBAG paid no cost — still untapped.
    expectCharStatus(s2, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);

    // Card discarded from hand.
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, ORC_STEALTH);

    // The sole strike was canceled with no roll, so combat resolves
    // immediately (no chain, no unresolved strikes left) to the enclosing phase.
    expect(s2.combat).toBeNull();
  });

  test('not available for a non-Orc defender (Elf scout)', () => {
    const s0 = setupMinionCombat({
      minionChars: [CALENDAL, GORBAG],
      resourceHand: [ORC_STEALTH],
    });
    const calendalId = findCharInstanceId(s0, RESOURCE_PLAYER, CALENDAL);
    let s = dispatch(s0, { type: 'pass', player: PLAYER_1 });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: calendalId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: calendalId, excess: true });

    const actions = computeLegalActions(s, PLAYER_1);
    expect(actions.filter(a => a.viable && a.action.type === 'play-strike-event').length).toBe(0);
  });

  test('not available for an Orc without the scout skill', () => {
    const s0 = setupMinionCombat({
      minionChars: [LAGDUF, GORBAG],
      resourceHand: [ORC_STEALTH],
    });
    const s1 = assignBothStrikesTo(s0, LAGDUF);

    const actions = computeLegalActions(s1, PLAYER_1);
    expect(actions.filter(a => a.viable && a.action.type === 'play-strike-event').length).toBe(0);
  });

  test('Orc Stealth is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, CALENDAL] }],
          hand: [ORC_STEALTH],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const osShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(osShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});

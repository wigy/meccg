/**
 * @module dm-135.test
 *
 * Card test: Healing of Nimrodel (dm-135)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: true, company.atHaven: true }
 *   3. on-event self-enters-play → add-constraint `end-of-mh-heal-and-untap`,
 *      scope:turn, target:target-company, requiresDestinationSiteType: "haven"
 *
 * Text:
 *   "Playable during the organization phase on a moving company whose site of
 *    origin is a Haven [{H}]. If the company moves to another Haven [{H}] this
 *    turn, at the end of the movement/hazard phase all wounded characters in
 *    the company heal (from wounded to untapped) and all tapped characters
 *    untap."
 *
 * The card is played before the move resolves, so like Master of Esgaroth
 * (td-135) it leaves a turn-scoped constraint on the company whose destination
 * gate is evaluated when the company's movement/hazard phase ends
 * (`fireEndOfMHHealAndUntap`, mh-hazard-play.ts). On a match every tapped or
 * wounded character in the company becomes untapped and the constraint is
 * consumed; otherwise the card is inert.
 *
 * Engine Support:
 * | # | Rule (card text)                                    | Status      | Mechanism                                                |
 * |---|-----------------------------------------------------|-------------|----------------------------------------------------------|
 * | 1 | Playable during the organization phase              | IMPLEMENTED | play-window phase:organization step:end-of-org           |
 * | 2 | on a moving company                                 | IMPLEMENTED | play-target company filter company.moving                |
 * | 3 | whose site of origin is a Haven                     | IMPLEMENTED | play-target company filter company.atHaven               |
 * | 4 | If the company moves to another Haven this turn     | IMPLEMENTED | end-of-mh-heal-and-untap requiresDestinationSiteType     |
 * | 5 | at the end of the M/H phase wounded heal to untapped| IMPLEMENTED | fireEndOfMHHealAndUntap (Inverted → Untapped)            |
 * | 6 | … and all tapped characters untap                   | IMPLEMENTED | fireEndOfMHHealAndUntap (Tapped → Untapped)              |
 *
 * Playable: YES
 * Certified: 2026-10-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  makeMHState, viableActions,
  companyIdAt, findHandCardId, findCharInstanceId, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, CardStatus, SiteType, ARAGORN, LEGOLAS, GIMLI, LORIEN, RIVENDELL } from '../../index.js';
import type {
  CardDefinitionId, GameState, PlayShortEventAction,
} from '../../index.js';

const HEALING_OF_NIMRODEL = 'dm-135' as CardDefinitionId;
const BREE = 'tw-378' as CardDefinitionId;        // border-hold, nearest haven Rivendell
const WEATHERTOP = 'tw-436' as CardDefinitionId;  // ruins-and-lairs — not a Haven

/**
 * Organization-phase state: the hero company (Aragorn wounded, Legolas
 * tapped, Gimli untapped) sits at `origin` and, when `dest` is given, has
 * declared movement to it.
 */
function orgState(origin: CardDefinitionId, dest?: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{
          site: origin,
          characters: [
            { defId: ARAGORN, status: CardStatus.Inverted },
            { defId: LEGOLAS, status: CardStatus.Tapped },
            { defId: GIMLI, status: CardStatus.Untapped },
          ],
          ...(dest ? { destinationSite: dest } : {}),
        }],
        hand: [HEALING_OF_NIMRODEL],
        siteDeck: [],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: BREE, characters: [] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
}

function nimrodelPlays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, HEALING_OF_NIMRODEL);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

/** Play the card from Rivendell on the company moving to `dest`. */
function playOnMovingCompany(dest: CardDefinitionId): GameState {
  const base = orgState(RIVENDELL, dest);
  return dispatch(base, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(base, RESOURCE_PLAYER, HEALING_OF_NIMRODEL),
    targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
  });
}

/** Enter the company's M/H phase (play-hazards step) after playing the card. */
function inMH(dest: CardDefinitionId): GameState {
  return { ...playOnMovingCompany(dest), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

/** Run the company's movement/hazard phase to its end (both players pass). */
function afterMovingTo(dest: CardDefinitionId): GameState {
  let state = inMH(dest);
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

function statuses(state: GameState): { aragorn: CardStatus; legolas: CardStatus; gimli: CardStatus } {
  const chars = state.players[RESOURCE_PLAYER].characters;
  return {
    aragorn: chars[findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN)].status,
    legolas: chars[findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS)].status,
    gimli: chars[findCharInstanceId(state, RESOURCE_PLAYER, GIMLI)].status,
  };
}

describe('Healing of Nimrodel (dm-135)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on a moving company whose origin is a Haven', () => {
    const base = orgState(RIVENDELL, LORIEN);
    const plays = nimrodelPlays(base);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyIdAt(base, RESOURCE_PLAYER));
  });

  test('not playable on a company that is not moving', () => {
    expect(nimrodelPlays(orgState(RIVENDELL))).toHaveLength(0);
  });

  test('not playable on a moving company whose site of origin is not a Haven', () => {
    expect(nimrodelPlays(orgState(BREE, RIVENDELL))).toHaveLength(0);
  });

  test('not playable outside the organization phase', () => {
    const base = orgState(RIVENDELL, LORIEN);
    const mh: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(nimrodelPlays(mh)).toHaveLength(0);
  });

  test('playing it installs the Haven-gated heal-and-untap constraint on the company', () => {
    const base = orgState(RIVENDELL, LORIEN);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HEALING_OF_NIMRODEL);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playOnMovingCompany(LORIEN);

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'end-of-mh-heal-and-untap', requiresDestinationSiteType: SiteType.Haven });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    // The short event goes to the discard pile; nothing heals at play time.
    expect(next.players[0].discardPile.some(c => c.instanceId === cardId)).toBe(true);
    expect(statuses(next)).toEqual({ aragorn: CardStatus.Inverted, legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
  });

  test('nothing heals or untaps until the movement/hazard phase ends', () => {
    let state = inMH(LORIEN);
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(state.phaseState.phase).toBe(Phase.MovementHazard);
    expect(statuses(state)).toEqual({ aragorn: CardStatus.Inverted, legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
  });

  test('moving to another Haven: at the end of the M/H phase wounded characters heal to untapped and tapped characters untap', () => {
    const arrived = afterMovingTo(LORIEN);

    expect(arrived.players[0].companies[0].currentSite?.definitionId).toBe(LORIEN);
    expect(arrived.phaseState.phase).toBe(Phase.Site);
    expect(statuses(arrived)).toEqual({ aragorn: CardStatus.Untapped, legolas: CardStatus.Untapped, gimli: CardStatus.Untapped });
    // The constraint is consumed once applied.
    expect(arrived.activeConstraints.some(c => c.kind.type === 'end-of-mh-heal-and-untap')).toBe(false);
  });

  test('moving to a non-Haven: no healing or untapping', () => {
    const arrived = afterMovingTo(WEATHERTOP);

    expect(arrived.players[0].companies[0].currentSite?.definitionId).toBe(WEATHERTOP);
    expect(statuses(arrived)).toEqual({ aragorn: CardStatus.Inverted, legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
  });

  test('a company that did not move gets nothing even while at a Haven', () => {
    // Constraint present but the company never moved (no destination): the
    // "moves to another Haven" condition is not met.
    const played = playOnMovingCompany(LORIEN);
    const stayed: GameState = {
      ...played,
      players: [
        {
          ...played.players[0],
          companies: played.players[0].companies.map(c => ({ ...c, destinationSite: null })),
        },
        played.players[1],
      ],
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
    let state = dispatch(stayed, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(state.players[0].companies[0].currentSite?.definitionId).toBe(RIVENDELL);
    expect(statuses(state)).toEqual({ aragorn: CardStatus.Inverted, legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
  });
});

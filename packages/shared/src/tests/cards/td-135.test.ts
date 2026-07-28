/**
 * @module td-135.test
 *
 * Card test: Master of Esgaroth (td-135)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: true }
 *   3. on-event self-enters-play → add-constraint `extra-mh-phase`,
 *      scope:turn, target:target-company,
 *      requiresDestinationSiteType: "border-hold"
 *
 * Text:
 *   "Playable at the end of the organization phase on a moving company. If the
 *    company moves to a Border-hold [{B}], it can take a second movement/hazard
 *    phase immediately following its first movement/hazard phase."
 *
 * This is the organization-phase sibling of Forced March (le-185). Forced March
 * is played at the *end* of the M/H phase, when the destination is already
 * known, so its `grant-extra-mh-phase` effect can gate the play window itself.
 * Master of Esgaroth is played before the move resolves, so it is playable on
 * *any* moving company and leaves behind a turn-scoped `extra-mh-phase`
 * constraint whose "moves to a Border-hold" clause is evaluated later, when the
 * company's movement/hazard phase ends (`advanceAfterCompanyMH`). On a match the
 * constraint is consumed and the company enters the shared
 * `extra-mh-move-offer` step — the same second-phase machinery Forced March
 * uses. Consuming the constraint is what bounds the grant to exactly one extra
 * phase, however the second move ends.
 *
 * Engine Support:
 * | # | Rule (card text)                                       | Status      | Mechanism                                              |
 * |---|--------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Playable at the end of the organization phase           | IMPLEMENTED | play-window phase:organization step:end-of-org         |
 * | 2 | on a moving company                                     | IMPLEMENTED | play-target company filter { company.moving: true }    |
 * | 3 | If the company moves to a Border-hold …                 | IMPLEMENTED | extra-mh-phase requiresDestinationSiteType border-hold |
 * | 4 | … it can take a second movement/hazard phase            | IMPLEMENTED | extra-mh-move-offer step → fresh reveal-new-site       |
 * | 5 | "immediately following its first" (exactly one extra)   | IMPLEMENTED | constraint consumed when the extra phase is granted    |
 * | 6 | (inert when the company moves elsewhere / does not move)| IMPLEMENTED | site-type + `moved` gate in advanceAfterCompanyMH      |
 *
 * Playable: YES
 * Certified: 2026-07-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch, Phase,
  makeMHState, viableActions, viableFor,
  companyIdAt, findHandCardId, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, SiteType, ARAGORN, LEGOLAS, LORIEN, RIVENDELL } from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayShortEventAction,
} from '../../index.js';
import type { ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const MASTER_OF_ESGAROTH = 'td-135' as CardDefinitionId;
const BREE = 'tw-378' as CardDefinitionId;         // border-hold, nearest haven Rivendell
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;  // border-hold, reachable from Bree
const WEATHERTOP = 'tw-436' as CardDefinitionId;   // ruins-and-lairs — NOT a Border-hold

/**
 * Organization-phase state: the hero company sits at Rivendell and, when `dest`
 * is given, has declared movement to it (making it a "moving company"). Cameth
 * Brin stays in the site deck as a second-phase destination.
 */
function orgState(dest?: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN], ...(dest ? { destinationSite: dest } : {}) }],
        hand: [MASTER_OF_ESGAROTH],
        siteDeck: [CAMETH_BRIN],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
}

/** Play Master of Esgaroth on the moving company during the organization phase. */
function playOnMovingCompany(dest: CardDefinitionId): GameState {
  const base = orgState(dest);
  return dispatch(base, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_ESGAROTH),
    targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
  });
}

/**
 * Play the card, then run the company's movement/hazard phase to its end (both
 * players pass the play-hazards step, committing the move to `dest`).
 */
function afterMovingTo(dest: CardDefinitionId): GameState {
  const played = playOnMovingCompany(dest);
  let state: GameState = { ...played, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

describe('Master of Esgaroth (td-135)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on a moving company', () => {
    const base = orgState(BREE);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_ESGAROTH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable on a company that is not moving', () => {
    const base = orgState(); // no declared destination
    const cardId = findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_ESGAROTH);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('the organization-phase play window is enforced — not playable during the M/H phase', () => {
    const base = orgState(BREE);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_ESGAROTH);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const plays = viableActions(inMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it installs the Border-hold-gated extra-phase constraint on the company', () => {
    const base = orgState(BREE);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_ESGAROTH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playOnMovingCompany(BREE);

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({
      type: 'extra-mh-phase',
      requiresDestinationSiteType: SiteType.BorderHold,
    });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    // The spent short event leaves hand for the discard pile.
    expect(next.players[0].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(next.players[0].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  test('moving to a Border-hold: a second movement/hazard phase is offered', () => {
    const arrived = afterMovingTo(BREE);
    const mh = arrived.phaseState as MovementHazardPhaseState;
    const company = arrived.players[0].companies[0];

    expect(mh.phase).toBe(Phase.MovementHazard);
    expect(mh.step).toBe('extra-mh-move-offer');
    expect(company.currentSite?.definitionId).toBe(BREE);

    // Cameth Brin (still in the site deck, reachable from Bree) is offered as
    // the second phase's destination, alongside the option to decline.
    const camethInst = arrived.players[0].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;
    const actions = viableFor(arrived, PLAYER_1).map(ea => ea.action);
    const extraMoves = actions.filter((a): a is ExtraMHMoveAction => a.type === 'extra-mh-move');
    expect(extraMoves.some(a => a.destinationSite === camethInst.instanceId)).toBe(true);
    expect(actions.some(a => a.type === 'pass')).toBe(true);
  });

  test('granting the extra phase consumes the constraint, so only one extra phase is possible', () => {
    const arrived = afterMovingTo(BREE);
    expect(arrived.activeConstraints.some(c => c.kind.type === 'extra-mh-phase')).toBe(false);
  });

  test('accepting the extra move re-enters a fresh movement/hazard phase', () => {
    const arrived = afterMovingTo(BREE);
    const companyId = arrived.players[0].companies[0].id;
    const camethInst = arrived.players[0].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;

    const moved = dispatch(arrived, {
      type: 'extra-mh-move',
      player: PLAYER_1,
      companyId,
      destinationSite: camethInst.instanceId,
    });
    const mh = moved.phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('reveal-new-site');
    expect(mh.hazardsPlayedThisCompany).toBe(0);
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(CAMETH_BRIN);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === CAMETH_BRIN)).toBe(false);

    // The company declares a path for the second phase like any other move.
    const declare = viableFor(moved, PLAYER_1)
      .map(ea => ea.action)
      .find(a => a.type === 'declare-path');
    expect(declare).toBeDefined();
  });

  test('declining the extra move finishes the company', () => {
    const arrived = afterMovingTo(BREE);
    const done = dispatch(arrived, { type: 'pass', player: PLAYER_1 });
    // The only company is handled → the M/H phase ends and the Site phase begins.
    expect(done.phaseState.phase).toBe(Phase.Site);
  });

  test('moving to a non-Border-hold: no extra phase, and the card stays inert', () => {
    const arrived = afterMovingTo(WEATHERTOP);

    expect(arrived.players[0].companies[0].currentSite?.definitionId).toBe(WEATHERTOP);
    // No offer step — the M/H phase finished outright.
    expect(arrived.phaseState.phase).toBe(Phase.Site);
    // The constraint was never satisfied, so it is still in force (and inert).
    expect(arrived.activeConstraints.some(c => c.kind.type === 'extra-mh-phase')).toBe(true);
  });

  test('a company that did not move gets no extra phase even at a Border-hold', () => {
    // Company already at Bree (a Border-hold) with no declared destination: the
    // constraint is present but `moved` stays false, so nothing is granted.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [CAMETH_BRIN],
          playDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
          playDeck: [],
        },
      ],
    });
    const constrained = addConstraint(
      { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) },
      {
        source: mint(),
        sourceDefinitionId: MASTER_OF_ESGAROTH,
        scope: { kind: 'turn' },
        target: { kind: 'company', companyId: companyIdAt(base, RESOURCE_PLAYER) },
        kind: { type: 'extra-mh-phase', requiresDestinationSiteType: SiteType.BorderHold },
      },
    );

    let state = dispatch(constrained, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(state.phaseState.phase).toBe(Phase.Site);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const played = playOnMovingCompany(BREE);
    expect(played.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(played, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});

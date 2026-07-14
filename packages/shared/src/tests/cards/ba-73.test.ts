/**
 * @module ba-73.test
 *
 * Card test: Roam the Waste (ba-73)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the organization phase if Strangling
 *    Coils is in play. You may bring this card from your sideboard into your
 *    play deck and reshuffle during your organization phase. Each of your
 *    companies this turn is considered to have one fewer Wilderness [{w}] and
 *    one fewer Shadow-land [{s}] in its site path."
 *
 * Four distinct rules:
 *   1. Play gate — `play-window` (organization) + `play-condition`
 *      (`card-in-play`, "Strangling Coils"). Strangling Coils (ba-76) is a
 *      demon-fána held in The Balrog's items; the gate is attachment-aware.
 *   2. Main effect — a player-scoped, turn-scoped `site-path-reduction`
 *      constraint added on play (`on-event self-enters-play` →
 *      `add-constraint site-path-reduction target player`, reductions
 *      `{ wilderness: 1, shadow: 1 }`). When each of the player's companies
 *      resolves its movement site path, up to one Wilderness and one
 *      Shadow-land token are removed from the path, which flows to creature
 *      keying (and every other site-path consumer).
 *   3. Sideboard self-relocation — a `move` (`select: self`, `from: sideboard`,
 *      `to: deck`, `shuffleAfter`) surfaced during the organization phase as a
 *      dedicated `card-sideboard-to-deck` action; taps nothing.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | NOT playable in org phase while Strangling Coils is not in play        | IMPLEMENTED |
 * | 2 | Playable in org phase once Strangling Coils is in play (item on Balrog)| IMPLEMENTED |
 * | 3 | NOT playable during the site phase (play-window: organization)         | IMPLEMENTED |
 * | 4 | Playing it adds a player-scoped site-path-reduction constraint; discard| IMPLEMENTED |
 * | 5 | Resolving a company path drops one Wilderness + one Shadow-land token  | IMPLEMENTED |
 * | 6 | Only *one* of each type is removed ("one fewer", not all)             | IMPLEMENTED |
 * | 7 | The reduction denies a creature keyable only to the removed terrain    | IMPLEMENTED |
 * | 8 | Sideboard copy offers card-sideboard-to-deck in the org phase          | IMPLEMENTED |
 * | 9 | Dispatching it moves the card sideboard → play deck                    | IMPLEMENTED |
 * | 10| No card-sideboard-to-deck offered when no such card is in sideboard    | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   BA_73 (ba-73)            - minion short event (this card)
 *   STRANGLING_COILS (ba-76) - minion demon-fána (the gate card, item on Balrog)
 *   THE_BALROG (ba-3)        - minion balrog avatar
 *   ORC_CAPTAIN (le-31)      - minion orc (company member for the path test)
 *   DOL_GULDUR (le-367)      - minion haven (site of origin)
 *   VARIAG_CAMP (le-411)     - minion border-hold (destination site)
 *   GIANT (le-74)            - hazard creature keyed only to Wilderness [{w}]
 *   HOLLIN (tw-466)          - Wilderness region
 *   REDHORN_GATE (tw-481)    - Wilderness region
 *   IMLAD_MORGUL (tw-468)    - Shadow-land region
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, dispatch, makeMHState,
  viableActions, findHandCardId, expectInDiscardPile,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, MovementHazardPhaseState, CreatureCard } from '../../index.js';
import { Alignment, RegionType } from '../../index.js';
import { MovementType } from '../../types/common.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';
import { checkCreatureKeying } from '../../engine/mh-hazard-play.js';

const BA_73 = 'ba-73' as CardDefinitionId;
const STRANGLING_COILS = 'ba-76' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const GIANT = 'le-74' as CardDefinitionId;

const HOLLIN = 'tw-466' as CardDefinitionId;       // Wilderness
const REDHORN_GATE = 'tw-481' as CardDefinitionId; // Wilderness
const IMLAD_MORGUL = 'tw-468' as CardDefinitionId; // Shadow-land

/** The ba-73 play-short-event action, if the card is offered as viable. */
function roamPlayAction(state: GameState): PlayShortEventAction | undefined {
  const inst = findHandCardId(state, RESOURCE_PLAYER, BA_73);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .find(a => a.cardInstanceId === inst);
}

/**
 * Build an M/H `reveal-new-site` state for a moving PLAYER_1 (Ringwraith)
 * company (The Balrog + an Orc) at Dol Guldur bound for Variag Camp. Dispatch a
 * region-movement `declare-path` against it to resolve the site path.
 */
function movingBalrogCompany(): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_BALROG, ORC_CAPTAIN], destinationSite: VARIAG_CAMP }],
        hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: true }) };
}

/** Add the player-scoped, turn-scoped site-path-reduction constraint. */
function withReduction(state: GameState): GameState {
  return addConstraint(state, {
    source: 'roam-1' as CardInstanceId,
    sourceDefinitionId: BA_73,
    scope: { kind: 'turn' },
    target: { kind: 'player', playerId: PLAYER_1 },
    kind: { type: 'site-path-reduction', reductions: { wilderness: 1, shadow: 1 } },
  });
}

describe('Roam the Waste (ba-73)', () => {
  beforeEach(() => resetMint());

  // ─── Play gate (Strangling Coils) ───────────────────────────────────────────

  test('NOT playable during the organization phase while Strangling Coils is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [BA_73], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(roamPlayAction(state)).toBeUndefined();
  });

  test('playable during the organization phase once Strangling Coils is in play (item on The Balrog)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [STRANGLING_COILS] }] }],
          hand: [BA_73], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(roamPlayAction(state)).toBeDefined();
  });

  test('NOT playable during the site phase even with Strangling Coils in play (play-window: organization)', () => {
    const base = buildSitePhaseState({
      characters: [{ defId: THE_BALROG, items: [STRANGLING_COILS] }],
      site: VARIAG_CAMP,
      hand: [BA_73],
    });
    const state = {
      ...base,
      players: [{ ...base.players[0], alignment: Alignment.Ringwraith }, base.players[1]] as typeof base.players,
    };
    expect(roamPlayAction(state)).toBeUndefined();
  });

  // ─── Main effect: site-path-reduction constraint ─────────────────────────────

  test('playing it adds a player-scoped site-path-reduction constraint (scope turn) and discards the card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [STRANGLING_COILS] }] }],
          hand: [BA_73], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, BA_73);
    const after = dispatch(state, roamPlayAction(state)!);

    const reductions = after.activeConstraints.filter(
      c => c.kind.type === 'site-path-reduction' && c.target.kind === 'player',
    );
    expect(reductions).toHaveLength(1);
    const constraint = reductions[0];
    expect(constraint.scope.kind).toBe('turn');
    if (constraint.target.kind === 'player') expect(constraint.target.playerId).toBe(PLAYER_1);
    if (constraint.kind.type === 'site-path-reduction') {
      expect(constraint.kind.reductions).toEqual({ wilderness: 1, shadow: 1 });
    }

    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  // ─── Effect consequence: reduced site path on movement ───────────────────────

  test('resolving a moving company path drops one Wilderness and one Shadow-land token', () => {
    // Declared path: Wilderness, Wilderness, Shadow-land.
    const declarePath = (s: GameState) => dispatch(s, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region,
      regionPath: [HOLLIN, REDHORN_GATE, IMLAD_MORGUL],
    });

    // Baseline (no constraint): the full path is preserved.
    const baseline = declarePath(movingBalrogCompany()).phaseState as MovementHazardPhaseState;
    expect(baseline.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow]);

    // With Roam the Waste: one Wilderness and one Shadow-land are removed —
    // exactly one of each, so a single Wilderness remains.
    const reduced = declarePath(withReduction(movingBalrogCompany())).phaseState as MovementHazardPhaseState;
    expect(reduced.resolvedSitePath).toEqual([RegionType.Wilderness]);
  });

  test('a single Wilderness/Shadow path is emptied by the reduction', () => {
    const declarePath = (s: GameState) => dispatch(s, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region,
      regionPath: [HOLLIN, IMLAD_MORGUL],
    });

    const baseline = declarePath(movingBalrogCompany()).phaseState as MovementHazardPhaseState;
    expect(baseline.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Shadow]);

    const reduced = declarePath(withReduction(movingBalrogCompany())).phaseState as MovementHazardPhaseState;
    expect(reduced.resolvedSitePath).toEqual([]);
  });

  test('the reduction denies keying a creature that could only key to the removed Wilderness', () => {
    // Path is one Wilderness + one Shadow-land; a Giant keys only to Wilderness.
    const declarePath = (s: GameState) => dispatch(s, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region,
      regionPath: [HOLLIN, IMLAD_MORGUL],
    });
    // Baseline: the Wilderness token is present → Giant is keyable.
    const baseState = declarePath(movingBalrogCompany());
    const baseMh = baseState.phaseState as MovementHazardPhaseState;
    const giantDef = baseState.cardPool[GIANT] as CreatureCard;
    expect(checkCreatureKeying(baseState, giantDef, baseMh)).toBeUndefined();

    // With Roam the Waste: the sole Wilderness token is removed → Giant cannot
    // be keyed to this company's (now empty) site path.
    const reducedState = declarePath(withReduction(movingBalrogCompany()));
    const reducedMh = reducedState.phaseState as MovementHazardPhaseState;
    expect(checkCreatureKeying(reducedState, giantDef, reducedMh)).toBeDefined();
  });

  // ─── Sideboard self-relocation ───────────────────────────────────────────────

  test('a sideboard copy offers a card-sideboard-to-deck action during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_73], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const offers = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId });
    expect(offers).toHaveLength(1);
    expect(offers[0].cardInstanceId).toBe(sideboardInst);
  });

  test('dispatching card-sideboard-to-deck moves the card from the sideboard into the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_73], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].sideboard.map(c => c.instanceId)).not.toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
  });

  test('no card-sideboard-to-deck action when no such card sits in the sideboard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'card-sideboard-to-deck',
    )).toHaveLength(0);
  });
});

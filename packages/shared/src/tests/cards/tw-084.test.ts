/**
 * @module tw-084.test
 *
 * Card test: River (tw-84)
 * Type: hazard-event (short, targets the active company)
 * Effects: 2 (play-target site, on-event company-arrives-at-site → add-constraint
 *             site-phase-do-nothing scope:company-site-phase with cancelWhen:
 *             untapped ranger)
 *
 * "Playable on a site. A company moving to this site this turn must do
 *  nothing during its site phase. A ranger in such a company may tap to
 *  cancel this effect, even at the start of his company's site phase."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Playable on the moving company's site    | IMPLEMENTED | legal in M/H play-hazards for active company |
 * | 2 | Adds do-nothing-unless-ranger constraint | IMPLEMENTED | chain-reducer applyShortEventArrivalTrigger |
 * | 3 | Constraint collapses enter-or-skip menu  | IMPLEMENTED | constraint filter (legal-actions/pending) |
 * | 4 | Ranger may tap to cancel                 | IMPLEMENTED | constraint cancelWhen emits cancel-constraint action |
 * | 9 | Ranger cancel available during M/H phase | IMPLEMENTED | applySitePhaseDoNothing + MH reducer handles cancel |
 * | 5 | Constraint clears at company-site-end    | IMPLEMENTED | sweepExpired in advanceSiteToNextCompany |
 * | 6 | Non-ranger characters cannot cancel      | IMPLEMENTED | constraint filter checks Skill.Ranger  |
 * | 7 | Tapped ranger cannot cancel              | IMPLEMENTED | constraint filter checks CardStatus    |
 * | 8 | River goes to discard after resolution   | IMPLEMENTED | short-event → discard + add-constraint on resolve |
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVER,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  mint, CardStatus,
  makeMHState,
  charIdAt, companyIdAt, dispatch, expectCharStatus, setCharStatus,
  viableFor, viableActions, viableActionTypes, phaseStateAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  SitePhaseState, ActivateGrantedAction, CardInstanceId, CompanyId, GameState,
  PlayHazardAction, ActiveConstraint,
} from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

/**
 * Add both constraints that River produces when it resolves: the
 * `site-phase-do-nothing` restriction and the parallel
 * `granted-action` that lets a qualifying ranger tap to cancel. Both
 * share the same `source` so `remove-constraint` sweeps them together.
 */
function addRiverConstraints(state: GameState, source: CardInstanceId, companyId: CompanyId): GameState {
  const site: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: RIVER,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: { type: 'site-phase-do-nothing' },
  };
  const grant: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: RIVER,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: {
      type: 'granted-action',
      action: 'cancel-river',
      cost: { tap: 'character' },
      when: {
        $and: [
          { 'actor.skills': { $includes: 'ranger' } },
          { 'actor.status': 'untapped' },
        ],
      },
      apply: { type: 'remove-constraint', select: 'constraint-source' },
    },
  };
  return addConstraint(addConstraint(state, site), grant);
}

describe('River (tw-84)', () => {
  beforeEach(() => resetMint());


  test('constraint offers a ranger tap action and pass for an affected company at enter-or-skip', () => {
    // P1's company has Aragorn (ranger). At enter-or-skip the constraint
    // should drop `enter-site` and offer `pass` plus a
    // `cancel-constraint` action targeting Aragorn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const riverInstance = mint();
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtStep = { ...base, phaseState: sitePhaseState };
    const constrained = addRiverConstraints(stateAtStep, riverInstance, targetCompanyId);

    // Inject the river instance into the cardPool indirectly: the filter
    // calls resolveInstanceId to look up the source card. Since the source
    // is just an opaque ID, we instead pre-mint a real River card and put
    // it on the active company's site as if it were placed there.
    // For this test, we patch the player's cardsInPlay to include the
    // River so resolveInstanceId can find it.
    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    const actions = viableFor(withRiverInPlay, PLAYER_1);
    const types = actions.map(ea => ea.action.type);
    expect(types).toContain('pass');
    expect(types).not.toContain('enter-site');

    const rangerTaps = actions.filter(
      ea => ea.action.type === 'activate-granted-action' &&
        (ea.action).actionId === 'cancel-river',
    );
    expect(rangerTaps).toHaveLength(1);

    const aragornId = charIdAt(withRiverInPlay, RESOURCE_PLAYER);
    expect((rangerTaps[0].action as ActivateGrantedAction).characterId).toBe(aragornId);
  });

  test('a non-ranger company is locked into pass with no cancel option', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const riverInstance = mint();
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtStep = { ...base, phaseState: sitePhaseState };
    const constrained = addRiverConstraints(stateAtStep, riverInstance, targetCompanyId);

    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    expect(viableActionTypes(withRiverInPlay, PLAYER_1)).toEqual(['pass']);
  });

  test('a tapped ranger cannot offer tap-to-cancel', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Tap Aragorn
    const tappedBase = setCharStatus(base, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const targetCompanyId = companyIdAt(tappedBase, RESOURCE_PLAYER);
    const riverInstance = mint();
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtStep = { ...tappedBase, phaseState: sitePhaseState };
    const constrained = addRiverConstraints(stateAtStep, riverInstance, targetCompanyId);

    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    expect(viableActionTypes(withRiverInPlay, PLAYER_1)).toEqual(['pass']);
  });

  test('constraint clears at company-site-end via sweepExpired', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const constrained = addRiverConstraints(base, 'river-1' as CardInstanceId, targetCompanyId);
    expect(constrained.activeConstraints).toHaveLength(2);

    const swept = sweepExpired(constrained, { kind: 'company-site-end', companyId: targetCompanyId });
    expect(swept.activeConstraints).toHaveLength(0);
  });

  test('River is offered as a playable hazard against the moving company', () => {
    // Build an M/H state where P1's company is moving from Rivendell to
    // Moria, and P2 has River in hand. The legal-action emitter should
    // offer a play-hazard action for River targeting the active company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RIVER], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const moriaCard = base.players[0].siteDeck[0];
    const baseWithDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...baseWithDest, phaseState: mhState };
    const targetCompanyId = companyIdAt(stateAtPlayHazards, RESOURCE_PLAYER);
    const riverInstance = stateAtPlayHazards.players[1].hand[0].instanceId;

    const playActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    const riverPlay = playActions.find(a => a.cardInstanceId === riverInstance);
    expect(riverPlay).toBeDefined();
    expect(riverPlay!.targetCompanyId).toBe(targetCompanyId);
  });

  test('playing River through reduce discards it and adds the ranger-tap constraint', () => {
    // Build M/H state with a moving company so the play-hazard action
    // is legal, then play River through reduce() and resolve the chain.
    // As a short-event, the card should go to P2's discard pile; when it
    // resolves, it should add an ActiveConstraint on the active company
    // directly — no deferred pending-site-effect state.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RIVER], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const moriaCard = base.players[0].siteDeck[0];
    const baseWithDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...baseWithDest, phaseState: mhState };

    const riverInstance = stateAtPlayHazards.players[1].hand[0].instanceId;
    const targetCompanyId = companyIdAt(stateAtPlayHazards, RESOURCE_PLAYER);

    const playResult = reduce(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: riverInstance,
      targetCompanyId,
    });
    expect(playResult.error).toBeUndefined();
    expect(playResult.state.chain).not.toBeNull();

    // River should already be in discard (short events go there on play)
    const riverInDiscard = playResult.state.players[1].discardPile.find(c => c.instanceId === riverInstance);
    expect(riverInDiscard).toBeDefined();

    // Resolve the chain (both players pass priority).
    let current = playResult.state;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // River is NOT in cardsInPlay (it's a short event).
    const riverInPlay = current.players[1].cardsInPlay.find(c => c.instanceId === riverInstance);
    expect(riverInPlay).toBeUndefined();

    // Two active constraints were added on the active company, both
    // sourced from River: site-phase-do-nothing (restriction) plus
    // granted-action (ranger-cancel).
    const riverConstraints = current.activeConstraints.filter(c => c.source === riverInstance);
    expect(riverConstraints).toHaveLength(2);
    const kinds = riverConstraints.map(c => c.kind.type).sort();
    expect(kinds).toEqual(['granted-action', 'site-phase-do-nothing']);
    const grant = riverConstraints.find(c => c.kind.type === 'granted-action')!;
    if (grant.kind.type === 'granted-action') {
      expect(grant.kind.action).toBe('cancel-river');
      expect(grant.kind.apply.type).toBe('remove-constraint');
    }
    for (const c of riverConstraints) {
      expect(c.sourceDefinitionId).toBe(RIVER);
      expect(c.target).toEqual({ kind: 'company', companyId: targetCompanyId });
      expect(c.scope).toEqual({ kind: 'company-site-phase', companyId: targetCompanyId });
    }
  });

  test('tapping a ranger through reduce() removes the River constraint and taps the character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const riverInstance = mint();
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtStep = { ...base, phaseState: sitePhaseState };
    const constrained = addRiverConstraints(stateAtStep, riverInstance, targetCompanyId);

    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    const aragornId = charIdAt(withRiverInPlay, RESOURCE_PLAYER);

    // Tap Aragorn to cancel River via the reducer.
    const nextState = dispatch(withRiverInPlay, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: aragornId,
      sourceCardId: riverInstance,
      sourceCardDefinitionId: RIVER,
      actionId: 'cancel-river',
      rollThreshold: 0,
    } as ActivateGrantedAction);

    // Aragorn should now be tapped.
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // The River constraint should be gone.
    expect(nextState.activeConstraints).toHaveLength(0);

    // Still in enter-or-skip — the company can now enter the site.
    expect(phaseStateAs<SitePhaseState>(nextState).step).toBe('enter-or-skip');

    // With the constraint removed, legal actions should include enter-site.
    expect(viableActionTypes(nextState, PLAYER_1)).toContain('enter-site');
  });

  test('cancel-constraint is offered during M/H phase so a ranger can pre-empt River', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const riverInstance = mint();
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtMH = { ...base, phaseState: mhState };
    const constrained = addRiverConstraints(stateAtMH, riverInstance, targetCompanyId);

    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    const cancelActions = viableActions(withRiverInPlay, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-river');
    expect(cancelActions).toHaveLength(1);

    const aragornId = charIdAt(withRiverInPlay, RESOURCE_PLAYER);
    expect((cancelActions[0].action as ActivateGrantedAction).characterId).toBe(aragornId);
  });

  test('tapping a ranger during M/H via reduce() removes the River constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const riverInstance = mint();
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtMH = { ...base, phaseState: mhState };
    const constrained = addRiverConstraints(stateAtMH, riverInstance, targetCompanyId);

    const withRiverInPlay = {
      ...constrained,
      players: [
        {
          ...constrained.players[0],
          cardsInPlay: [
            ...constrained.players[0].cardsInPlay,
            { instanceId: riverInstance, definitionId: RIVER, status: CardStatus.Untapped },
          ],
        },
        constrained.players[1],
      ] as typeof constrained.players,
    };

    const aragornId = charIdAt(withRiverInPlay, RESOURCE_PLAYER);

    const nextState = dispatch(withRiverInPlay, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: aragornId,
      sourceCardId: riverInstance,
      sourceCardDefinitionId: RIVER,
      actionId: 'cancel-river',
      rollThreshold: 0,
    } as ActivateGrantedAction);

    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(nextState.activeConstraints).toHaveLength(0);
    expect(nextState.phaseState.phase).toBe(Phase.MovementHazard);
  });
});

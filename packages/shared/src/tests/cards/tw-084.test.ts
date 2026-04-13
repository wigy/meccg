/**
 * @module tw-084.test
 *
 * Card test: River (tw-84)
 * Type: hazard-event (short, targets the active company)
 * Effects: 2 (play-target site, on-event company-arrives-at-site → add-constraint
 *             site-phase-do-nothing-unless-ranger-taps scope:company-site-phase)
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
 * | 4 | Ranger may tap to cancel                 | IMPLEMENTED | constraint filter offers tap-ranger-to-cancel-river |
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
  pool, mint, CardStatus,
  makeMHState,
} from '../test-helpers.js';
import type {
  HazardEventCard,
  SitePhaseState, ActivateGrantedAction, CardInstanceId,
  PlayHazardAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

describe('River (tw-84)', () => {
  beforeEach(() => resetMint());

  test('card definition has the expected effects', () => {
    const def = pool[RIVER as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');

    const playTarget = def.effects?.find(e => e.type === 'play-target');
    expect(playTarget).toBeDefined();
    expect(playTarget?.target).toBe('site');

    const onEvent = def.effects?.find(e => e.type === 'on-event');
    expect(onEvent).toBeDefined();
    expect(onEvent?.event).toBe('company-arrives-at-site');
    expect(onEvent?.apply.type).toBe('add-constraint');
    expect(onEvent?.apply.constraint).toBe('site-phase-do-nothing-unless-ranger-taps');
    expect(onEvent?.apply.scope).toBe('company-site-phase');
  });

  test('constraint offers a ranger tap action and pass for an affected company at enter-or-skip', () => {
    // P1's company has Aragorn (ranger). At enter-or-skip the constraint
    // should drop `enter-site` and offer `pass` plus a
    // `tap-ranger-to-cancel-river` action targeting Aragorn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = base.players[0].companies[0].id;
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
    const constrained = addConstraint(stateAtStep, {
      // Use a real River instance id so the filter can resolve a definition.
      source: riverInstance,
      sourceDefinitionId: RIVER,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });

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

    const actions = computeLegalActions(withRiverInPlay, PLAYER_1).filter(ea => ea.viable);
    const types = actions.map(ea => ea.action.type);
    expect(types).toContain('pass');
    expect(types).not.toContain('enter-site');

    const rangerTaps = actions.filter(
      ea => ea.action.type === 'activate-granted-action' &&
        (ea.action).actionId === 'tap-ranger-to-cancel-river',
    );
    expect(rangerTaps).toHaveLength(1);

    const aragornId = withRiverInPlay.players[0].companies[0].characters[0];
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

    const targetCompanyId = base.players[0].companies[0].id;
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
    const constrained = addConstraint(stateAtStep, {
      source: riverInstance,
      sourceDefinitionId: RIVER,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });

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

    const actions = computeLegalActions(withRiverInPlay, PLAYER_1).filter(ea => ea.viable);
    const types = actions.map(ea => ea.action.type);
    expect(types).toEqual(['pass']);
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
    const aragornId = base.players[0].companies[0].characters[0];
    const tappedBase = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [aragornId as string]: { ...base.players[0].characters[aragornId as string], status: CardStatus.Tapped },
          },
        },
        base.players[1],
      ] as typeof base.players,
    };

    const targetCompanyId = tappedBase.players[0].companies[0].id;
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
    const constrained = addConstraint(stateAtStep, {
      source: riverInstance,
      sourceDefinitionId: RIVER,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });

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

    const actions = computeLegalActions(withRiverInPlay, PLAYER_1).filter(ea => ea.viable);
    const types = actions.map(ea => ea.action.type);
    expect(types).toEqual(['pass']);
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

    const targetCompanyId = base.players[0].companies[0].id;
    const constrained = addConstraint(base, {
      source: 'river-1' as CardInstanceId,
      sourceDefinitionId: RIVER,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

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
    const targetCompanyId = stateAtPlayHazards.players[0].companies[0].id;
    const riverInstance = stateAtPlayHazards.players[1].hand[0].instanceId;

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
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
    const targetCompanyId = stateAtPlayHazards.players[0].companies[0].id;

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

    // An active constraint was added on the active company, sourced from River.
    const riverConstraints = current.activeConstraints.filter(c => c.source === riverInstance);
    expect(riverConstraints).toHaveLength(1);
    expect(riverConstraints[0].kind.type).toBe('site-phase-do-nothing-unless-ranger-taps');
    expect(riverConstraints[0].sourceDefinitionId).toBe(RIVER);
    expect(riverConstraints[0].target).toEqual({ kind: 'company', companyId: targetCompanyId });
    expect(riverConstraints[0].scope).toEqual({ kind: 'company-site-phase', companyId: targetCompanyId });
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

    const targetCompanyId = base.players[0].companies[0].id;
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
    const constrained = addConstraint(stateAtStep, {
      source: riverInstance,
      sourceDefinitionId: RIVER,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });

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

    const aragornId = withRiverInPlay.players[0].companies[0].characters[0];

    // Tap Aragorn to cancel River via the reducer.
    const result = reduce(withRiverInPlay, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: aragornId,
      sourceCardId: riverInstance,
      sourceCardDefinitionId: RIVER,
      actionId: 'tap-ranger-to-cancel-river',
      rollThreshold: 0,
    } as ActivateGrantedAction);

    expect(result.error).toBeUndefined();

    // Aragorn should now be tapped.
    const aragornAfter = result.state.players[0].characters[aragornId as string];
    expect(aragornAfter.status).toBe(CardStatus.Tapped);

    // The River constraint should be gone.
    expect(result.state.activeConstraints).toHaveLength(0);

    // Still in enter-or-skip — the company can now enter the site.
    expect((result.state.phaseState as SitePhaseState).step).toBe('enter-or-skip');

    // With the constraint removed, legal actions should include enter-site.
    const actions = computeLegalActions(result.state, PLAYER_1).filter(ea => ea.viable);
    const types = actions.map(ea => ea.action.type);
    expect(types).toContain('enter-site');
  });
});

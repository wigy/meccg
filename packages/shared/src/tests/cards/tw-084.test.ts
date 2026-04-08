/**
 * @module tw-084.test
 *
 * Card test: River (tw-84)
 * Type: hazard-event (permanent, site-targeting)
 * Effects: 2 (play-target site, on-event self-enters-play → add-constraint
 *             site-phase-do-nothing-unless-ranger-taps scope:company-site-phase)
 *
 * "Playable on a site. A company moving to this site this turn must do
 *  nothing during its site phase. A ranger in such a company may tap to
 *  cancel this effect, even at the start of his company's site phase."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Play target = site                       | DATA        | play-target target:"site"              |
 * | 2 | Adds do-nothing-unless-ranger constraint | IMPLEMENTED | on-event self-enters-play apply        |
 * | 3 | Constraint collapses enter-or-skip menu  | IMPLEMENTED | constraint filter (legal-actions/pending) |
 * | 4 | Ranger may tap to cancel                 | IMPLEMENTED | constraint filter offers tap-ranger-to-cancel-river |
 * | 5 | Constraint clears at company-site-end    | IMPLEMENTED | sweepExpired in advanceSiteToNextCompany |
 * | 6 | Non-ranger characters cannot cancel      | IMPLEMENTED | constraint filter checks Skill.Ranger  |
 * | 7 | Tapped ranger cannot cancel              | IMPLEMENTED | constraint filter checks CardStatus    |
 *
 * Playable: PARTIAL — full play-from-hand wiring, the
 * `company-arrives-at-site` event, and the CRF 22 first-action timing
 * restriction are left as a follow-up. The constraint behaviour and the
 * ranger-tap-to-cancel offer are fully tested.
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVER,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool, mint, CardStatus,
} from '../test-helpers.js';
import type {
  HazardEventCard,
  SitePhaseState, ActivateGrantedAction, CardInstanceId,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

describe('River (tw-84)', () => {
  beforeEach(() => resetMint());

  test('card definition has the expected effects', () => {
    const def = pool[RIVER as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('permanent');

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
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing-unless-ranger-taps' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'company-site-end', companyId: targetCompanyId });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});

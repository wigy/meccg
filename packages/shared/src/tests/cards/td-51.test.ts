/**
 * @module td-51.test
 *
 * Card test: Noose of the Sea (td-51)
 * Type: hazard-event (long)
 * Effects: 1 (suspend-short-event-effects: playedDuring organization,
 *             suspendDuring movement-hazard + site, sitePathRegionType coastal)
 *
 * "Affects each company with a Coastal Sea [{c}] in its site path. The
 *  on-going effects of all resource short-events that were played during
 *  the organization phase are cancelled for the duration of the
 *  movement/hazard phase and the site phase. Such short-events have no
 *  effect on this card (i. e., it may not be canceled by such a
 *  short-event)."
 *
 * Engine support (`engine/short-event-suspension.ts`): after every reducer
 * step, each constraint installed by a resource short-event during the
 * organization phase and bound to a company whose site path this turn
 * includes a Coastal Sea is moved from `activeConstraints` into
 * `suspendedConstraints` while the game is in the movement/hazard or site
 * phase and Noose of the Sea is in play; it is moved back as soon as either
 * condition lapses. A resource short-event declared during the organization
 * phase may not pick Noose of the Sea as its discard-in-play target.
 *
 * Stealth (tw-332, an end-of-organization short-event whose on-going effect
 * is "no creature hazards may be played on his company this turn") is the
 * probe effect throughout.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, ELROND, LEGOLAS,
  STEALTH, CAVE_DRAKE, MARVELS_TOLD, EYE_OF_SAURON,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  makeMHState, makeSitePhase,
  viableActions, dispatch, resolveChain,
  findHandCardId, charIdAt, companyIdAt, actionAs,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, GameState, PlayHazardAction, PlayShortEventAction,
} from '../../index.js';
import { CardStatus, Phase, RegionType, SiteType } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const NOOSE_OF_THE_SEA = 'td-51' as CardDefinitionId;

describe('Noose of the Sea (td-51)', () => {
  beforeEach(() => resetMint());

  /** Organization phase: Aragorn (scout) + Elrond (sage) at Rivendell, Stealth in hand. */
  let afterStealth: GameState;

  beforeEach(() => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [STEALTH, MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NOOSE_OF_THE_SEA, CAVE_DRAKE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    afterStealth = resolveChain(dispatch(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: findHandCardId(org, RESOURCE_PLAYER, STEALTH),
      targetScoutInstanceId: charIdAt(org, RESOURCE_PLAYER, 0, 0),
    }));
  });

  test('cancels an organization-phase short-event effect on a company with a Coastal Sea in its site path', () => {
    const companyId = companyIdAt(afterStealth, RESOURCE_PLAYER);
    const mh: GameState = {
      ...afterStealth,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal],
        resolvedSitePathNames: ['Hithaeglir', 'Bay of Belfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    const drakeId = findHandCardId(mh, HAZARD_PLAYER, CAVE_DRAKE);

    // Stealth protects the company: no creature may be played on it.
    expect(mh.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    expect(viableActions(mh, PLAYER_2, 'play-hazard')
      .map(ea => actionAs<PlayHazardAction>(ea.action))
      .filter(a => a.cardInstanceId === drakeId && a.targetCompanyId === companyId)).toHaveLength(0);

    const afterNoose = resolveChain(dispatch(mh, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(mh, HAZARD_PLAYER, NOOSE_OF_THE_SEA),
      targetCompanyId: companyId,
    }));

    expect(afterNoose.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NOOSE_OF_THE_SEA)).toBe(true);
    // Stealth's on-going effect is cancelled for the M/H phase: the
    // constraint is lifted out of play and Cave-drake becomes playable.
    expect(afterNoose.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(false);
    expect(afterNoose.suspendedConstraints?.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    expect(viableActions(afterNoose, PLAYER_2, 'play-hazard')
      .map(ea => actionAs<PlayHazardAction>(ea.action))
      .filter(a => a.cardInstanceId === drakeId && a.targetCompanyId === companyId).length).toBeGreaterThan(0);
  });

  test('does not affect a company without a Coastal Sea in its site path', () => {
    const companyId = companyIdAt(afterStealth, RESOURCE_PLAYER);
    const mh: GameState = {
      ...afterStealth,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    const afterNoose = resolveChain(dispatch(mh, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(mh, HAZARD_PLAYER, NOOSE_OF_THE_SEA),
      targetCompanyId: companyId,
    }));

    expect(afterNoose.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NOOSE_OF_THE_SEA)).toBe(true);
    expect(afterNoose.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    const drakeId = findHandCardId(afterNoose, HAZARD_PLAYER, CAVE_DRAKE);
    const drakePlays = viableActions(afterNoose, PLAYER_2, 'play-hazard')
      .map(ea => actionAs<PlayHazardAction>(ea.action))
      .filter(a => a.cardInstanceId === drakeId && a.targetCompanyId === companyId);
    expect(drakePlays).toHaveLength(0);
  });

  test('does not cancel a short-event effect that was not played during the organization phase', () => {
    const companyId = companyIdAt(afterStealth, RESOURCE_PLAYER);
    const base: GameState = {
      ...afterStealth,
      activeConstraints: [],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal],
        resolvedSitePathNames: ['Hithaeglir', 'Bay of Belfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    // The same on-going effect, but installed during the M/H phase.
    const mh = addConstraint(base, {
      source: mint(),
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    expect(mh.activeConstraints[0].addedInPhase).toBe(Phase.MovementHazard);

    const afterNoose = resolveChain(dispatch(mh, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(mh, HAZARD_PLAYER, NOOSE_OF_THE_SEA),
      targetCompanyId: companyId,
    }));
    expect(afterNoose.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NOOSE_OF_THE_SEA)).toBe(true);
    expect(afterNoose.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    expect(afterNoose.suspendedConstraints ?? []).toHaveLength(0);
  });

  describe('after Noose of the Sea cancelled Stealth during the M/H phase', () => {
    let afterNoose: GameState;

    beforeEach(() => {
      const companyId = companyIdAt(afterStealth, RESOURCE_PLAYER);
      const mh: GameState = {
        ...afterStealth,
        phaseState: makeMHState({
          resolvedSitePath: [RegionType.Coastal],
          resolvedSitePathNames: ['Bay of Belfalas'],
          destinationSiteType: SiteType.RuinsAndLairs,
          destinationSiteName: 'Moria',
        }),
      };
      afterNoose = resolveChain(dispatch(mh, {
        type: 'play-hazard',
        player: PLAYER_2,
        cardInstanceId: findHandCardId(mh, HAZARD_PLAYER, NOOSE_OF_THE_SEA),
        targetCompanyId: companyId,
      }));
      expect(afterNoose.suspendedConstraints).toHaveLength(1);
    });

    test('the cancellation ends with the site phase', () => {
      const site: GameState = { ...afterNoose, phaseState: makeSitePhase() };
      expect(site.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(false);
      // Passing the company's site phase moves on to the end-of-turn phase,
      // where Stealth's turn-long effect is back in force.
      const endOfTurn = dispatch(site, { type: 'pass', player: PLAYER_1 });
      expect(endOfTurn.phaseState.phase).toBe(Phase.EndOfTurn);
      expect(endOfTurn.suspendedConstraints ?? []).toHaveLength(0);
      expect(endOfTurn.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    });

    test('a short-event played outside the organization phase may cancel it, restoring the effect', () => {
      // Marvels Told played during the site phase is not "such a
      // short-event": it may discard Noose of the Sea.
      const site: GameState = { ...afterNoose, phaseState: makeSitePhase() };
      const nooseId = site.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === NOOSE_OF_THE_SEA)!.instanceId;
      const play = viableActions(site, PLAYER_1, 'play-short-event')
        .map(ea => actionAs<PlayShortEventAction>(ea.action))
        .find(a => a.discardTargetInstanceId === nooseId);
      expect(play).toBeDefined();

      const declared = dispatch(site, play!);
      // A step inside the site phase: still cancelled while Marvels Told
      // waits on the chain.
      expect(declared.phaseState.phase).toBe(Phase.Site);
      expect(declared.suspendedConstraints).toHaveLength(1);
      const resolved = resolveChain(declared);
      expect(resolved.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NOOSE_OF_THE_SEA)).toBe(false);
      expect(resolved.suspendedConstraints ?? []).toHaveLength(0);
      expect(resolved.activeConstraints.some(c => c.kind.type === 'no-creature-hazards-on-company')).toBe(true);
    });
  });

  test('may not be discarded by a resource short-event played during the organization phase', () => {
    const nooseInPlay: CardInPlay = { instanceId: mint(), definitionId: NOOSE_OF_THE_SEA, status: CardStatus.Untapped };
    const eyeInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };
    const players: Parameters<typeof buildTestState>[0]['players'] = [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [nooseInPlay, eyeInPlay] },
    ];

    const org = buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, players });
    const orgTargets = viableActions(org, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action).discardTargetInstanceId);
    expect(orgTargets).toContain(eyeInPlay.instanceId);
    expect(orgTargets).not.toContain(nooseInPlay.instanceId);

    // Outside the organization phase it is an ordinary target.
    const longEvent = buildTestState({ activePlayer: PLAYER_1, phase: Phase.LongEvent, players });
    const longEventTargets = viableActions(longEvent, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action).discardTargetInstanceId);
    expect(longEventTargets).toContain(nooseInPlay.instanceId);
  });
});

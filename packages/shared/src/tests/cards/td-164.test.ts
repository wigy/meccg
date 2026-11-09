/**
 * @module td-164.test
 *
 * Card test: Washed and Refreshed (td-164)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: true }
 *   3. on-event self-enters-play → add-constraint `untap-on-site-reveal`,
 *      scope:turn, target:target-company, value: 4 (region threshold)
 *
 * Text:
 *   "Playable at the end of the organization phase on a moving company. When
 *    the company's new site is revealed, the company may untap a number of
 *    characters equal to the number of regions less than four in its site
 *    path."
 *
 * The site path is not known when the card is played (movement type is only
 * declared at the reveal-new-site step), so the card leaves a turn-scoped
 * `untap-on-site-reveal` constraint on the company. When the new site is
 * revealed and the path declared, `fireUntapOnSiteReveal` (mh-steps.ts)
 * consumes it and, for `4 - regions` > 0, enqueues an optional
 * `untap-company-characters` resolution: the player untaps tapped characters
 * one at a time (`restore-character-by-effect`) up to that count, or passes.
 *
 * Engine Support:
 * | # | Rule (card text)                                   | Status      | Mechanism                                        |
 * |---|----------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Playable at the end of the organization phase      | IMPLEMENTED | play-window phase:organization step:end-of-org   |
 * | 2 | on a moving company                                | IMPLEMENTED | play-target company filter company.moving        |
 * | 3 | When the company's new site is revealed            | IMPLEMENTED | fireUntapOnSiteReveal at declare-path            |
 * | 4 | may untap N characters, N = regions less than four | IMPLEMENTED | untap-company-characters (remaining = 4 - path)  |
 *
 * Playable: YES
 * Certified: 2026-11-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  makeMHState, viableActions, viableFor,
  companyIdAt, findHandCardId, findCharInstanceId, expectCharStatus, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, CardStatus, ARAGORN, LEGOLAS, GIMLI, FRODO, LORIEN, RIVENDELL } from '../../index.js';
import type { CardDefinitionId, GameState, PlayShortEventAction } from '../../index.js';

const WASHED_AND_REFRESHED = 'td-164' as CardDefinitionId;
const ETTENMOORS = 'tw-395' as CardDefinitionId;  // site path [w] — 1 region
const BREE = 'tw-378' as CardDefinitionId;        // site path [w w] — 2 regions
const BAG_END = 'tw-372' as CardDefinitionId;     // site path [w w f] — 3 regions
// Rivendell → Lórien haven path: [w b w w] — 4 regions

const ALL_TAPPED = [
  { defId: ARAGORN, status: CardStatus.Tapped },
  { defId: LEGOLAS, status: CardStatus.Tapped },
  { defId: GIMLI, status: CardStatus.Tapped },
  { defId: FRODO, status: CardStatus.Tapped },
];

describe('Washed and Refreshed (td-164)', () => {
  beforeEach(() => resetMint());

  test('playable at the end of the organization phase on a moving company only', () => {
    const moving = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: ALL_TAPPED, destinationSite: BREE }], hand: [WASHED_AND_REFRESHED], siteDeck: [], playDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const cardId = findHandCardId(moving, RESOURCE_PLAYER, WASHED_AND_REFRESHED);
    const plays = viableActions(moving, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyIdAt(moving, RESOURCE_PLAYER));

    resetMint();
    const staying = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: ALL_TAPPED }], hand: [WASHED_AND_REFRESHED], siteDeck: [], playDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    expect(viableActions(staying, PLAYER_1, 'play-short-event')).toHaveLength(0);

    // Not playable outside the organization phase.
    const mh: GameState = { ...moving, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableActions(mh, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test.each([
    { dest: ETTENMOORS, regions: 1, untaps: 3 },
    { dest: BREE, regions: 2, untaps: 2 },
    { dest: BAG_END, regions: 3, untaps: 1 },
  ])('site path of $regions region(s): when the new site is revealed the company may untap $untaps character(s)', ({ dest, untaps }) => {
    const org = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: ALL_TAPPED, destinationSite: dest }], hand: [WASHED_AND_REFRESHED], siteDeck: [], playDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const companyId = companyIdAt(org, RESOURCE_PLAYER);
    const played = dispatch(org, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(org, RESOURCE_PLAYER, WASHED_AND_REFRESHED),
      targetCompanyId: companyId,
    });
    // Playing the card untaps nothing yet; it leaves the company-bound constraint.
    const constraint = played.activeConstraints.find(c => c.kind.type === 'untap-on-site-reveal');
    expect(constraint?.kind).toEqual({ type: 'untap-on-site-reveal', regionThreshold: 4 });
    expect(constraint?.target).toEqual({ kind: 'company', companyId });
    expect(constraint?.scope.kind).toBe('turn');
    for (const c of [ARAGORN, LEGOLAS, GIMLI, FRODO]) expectCharStatus(played, RESOURCE_PLAYER, c, CardStatus.Tapped);

    const atReveal: GameState = { ...played, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
    const declare = viableFor(atReveal, PLAYER_1).map(a => a.action)
      .find(a => a.type === 'declare-path' && a.movementType === 'starter');
    expect(declare).toBeDefined();
    let state = dispatch(atReveal, declare!);

    expect(state.activeConstraints.some(c => c.kind.type === 'untap-on-site-reveal')).toBe(false);
    expect(state.pendingResolutions).toHaveLength(1);
    expect(state.pendingResolutions[0].actor).toBe(PLAYER_1);
    expect(state.pendingResolutions[0].kind).toEqual({
      type: 'untap-company-characters', companyId, remaining: untaps, sourceDefinitionId: WASHED_AND_REFRESHED,
    });

    // Untap characters one at a time up to the allowance.
    const order = [ARAGORN, LEGOLAS, GIMLI, FRODO];
    for (let i = 0; i < untaps; i++) {
      const viable = viableFor(state, PLAYER_1).map(a => a.action);
      expect(viable.filter(a => a.type === 'restore-character-by-effect')).toHaveLength(4 - i);
      expect(viable.some(a => a.type === 'pass')).toBe(true);
      state = dispatch(state, {
        type: 'restore-character-by-effect', player: PLAYER_1,
        characterInstanceId: findCharInstanceId(state, RESOURCE_PLAYER, order[i]),
      });
    }
    expect(state.pendingResolutions).toHaveLength(0);
    order.forEach((c, i) => expectCharStatus(state, RESOURCE_PLAYER, c, i < untaps ? CardStatus.Untapped : CardStatus.Tapped));
  });

  test('site path of four regions: no untap is offered', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: ALL_TAPPED, destinationSite: LORIEN }], hand: [WASHED_AND_REFRESHED], siteDeck: [], playDeck: [] },
        { id: PLAYER_2, companies: [{ site: BREE, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const played = dispatch(org, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(org, RESOURCE_PLAYER, WASHED_AND_REFRESHED),
      targetCompanyId: companyIdAt(org, RESOURCE_PLAYER),
    });
    const atReveal: GameState = { ...played, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
    const declare = viableFor(atReveal, PLAYER_1).map(a => a.action)
      .find(a => a.type === 'declare-path' && a.movementType === 'starter');
    const state = dispatch(atReveal, declare!);

    expect(state.activeConstraints.some(c => c.kind.type === 'untap-on-site-reveal')).toBe(false);
    expect(state.pendingResolutions.some(r => r.kind.type === 'untap-company-characters')).toBe(false);
    for (const c of [ARAGORN, LEGOLAS, GIMLI, FRODO]) expectCharStatus(state, RESOURCE_PLAYER, c, CardStatus.Tapped);
  });

  test('the untap is optional: passing stops early, and wounded characters are not offered', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{
            site: RIVENDELL, destinationSite: ETTENMOORS,
            characters: [
              { defId: ARAGORN, status: CardStatus.Inverted },
              { defId: LEGOLAS, status: CardStatus.Tapped },
              { defId: GIMLI, status: CardStatus.Tapped },
            ],
          }],
          hand: [WASHED_AND_REFRESHED], siteDeck: [], playDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const played = dispatch(org, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(org, RESOURCE_PLAYER, WASHED_AND_REFRESHED),
      targetCompanyId: companyIdAt(org, RESOURCE_PLAYER),
    });
    const atReveal: GameState = { ...played, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
    const declare = viableFor(atReveal, PLAYER_1).map(a => a.action)
      .find(a => a.type === 'declare-path' && a.movementType === 'starter');
    let state = dispatch(atReveal, declare!);

    // Allowance is 3, but only the two tapped (not wounded) characters are offered.
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const offered = viableFor(state, PLAYER_1).map(a => a.action)
      .filter(a => a.type === 'restore-character-by-effect');
    expect(offered).toHaveLength(2);
    expect(offered.some(a => a.type === 'restore-character-by-effect' && a.characterInstanceId === aragornId)).toBe(false);

    state = dispatch(state, {
      type: 'restore-character-by-effect', player: PLAYER_1,
      characterInstanceId: findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS),
    });
    expect(state.pendingResolutions).toHaveLength(1);
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(state.pendingResolutions).toHaveLength(0);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expectCharStatus(state, RESOURCE_PLAYER, LEGOLAS, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, GIMLI, CardStatus.Tapped);
  });
});

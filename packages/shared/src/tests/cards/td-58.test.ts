/**
 * @module td-58.test
 *
 * Card test: Rumor of Wealth (td-58)
 * Type: hazard-event (short)
 *
 * "Playable on a Ruins & Lairs [{R}] that is not a Dragon's lair. Any one
 *  Dragon hazard creature (except Eärcaraxë) may be played (and does not
 *  count against the hazard limit) at the site during the site phase this
 *  turn after the successful play of a major or greater item. Can be
 *  revealed on-guard."
 *
 * Effects:
 *   1. play-target site: siteType ruins-and-lairs, lairOf absent (excludes
 *      Dragon's lairs)
 *   2. on-event company-arrives-at-site → add-constraint dragon-ambush-window
 *      (played from hand during M/H)
 *   3. on-guard-reveal trigger:resource-play playedFilter (item, subtype
 *      major/greater) → add-constraint dragon-ambush-window (revealed
 *      on-guard in response to the qualifying item play)
 *
 * Engine support:
 * - `dragon-ambush-window` ActiveConstraint (scope company-site-phase, target
 *   company, optional creatureFilter) installed either via
 *   `applyShortEventArrivalTrigger` (hand play during M/H) or the new
 *   on-guard-reveal add-constraint branch in `chain-reducer.ts` (on-guard
 *   reveal during the site phase).
 * - `fireDragonAmbushWindow` (reducer-site.ts) checks the constraint whenever
 *   an item successfully attaches during the site phase; a major/greater
 *   item enqueues a `dragon-ambush-offer` pending resolution for the hazard
 *   player.
 * - `dragonAmbushOfferActions` / `applyDragonAmbushOfferResolution` let the
 *   hazard player play one matching Dragon hazard creature straight from
 *   hand (bypassing the M/H keying pipeline and the hazard limit via the
 *   4-arg `initiateChain` form) or pass, leaving the constraint armed.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  MINAS_TIRITH, ISENGARD,
  GLAMDRING, STING, CAVE_DRAKE,
  buildSitePhaseState, buildHazardMovingState, placeOnGuard, resetMint,
  viableActions, dispatch, resolveChain,
  charIdAt, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, Condition,
  PlayHazardAction, PlayHeroResourceAction, PlayDragonAmbushCreatureAction,
} from '../../index.js';

const RUMOR_OF_WEALTH = 'td-58' as CardDefinitionId;
const ISLE_OF_THE_ULOND = 'td-178' as CardDefinitionId; // hero-site, ruins-and-lairs, lairOf Eärcaraxë
const EARCARAXE = 'td-20' as CardDefinitionId; // unique dragon hazard-creature — the one named exclusion

const DRAGON_AMBUSH_FILTER: Condition = {
  $and: [
    { race: 'dragon' },
    { name: { $ne: 'Eärcaraxë' } },
  ],
};

describe('Rumor of Wealth (td-58)', () => {
  beforeEach(() => resetMint());

  // ─── Playability (site keying) ─────────────────────────────────────────

  test('playable at a Ruins & Lairs destination that is not a Dragon\'s lair (Isengard)', () => {
    const state = buildHazardMovingState(ISENGARD, 'Isengard', [RUMOR_OF_WEALTH]);
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(ISENGARD);
  });

  test('not playable at a Ruins & Lairs Dragon\'s lair (Isle of the Ulond)', () => {
    const state = buildHazardMovingState(ISLE_OF_THE_ULOND, 'Isle of the Ulond', [RUMOR_OF_WEALTH]);
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('not playable at a Free-hold destination (Minas Tirith)', () => {
    const state = buildHazardMovingState(MINAS_TIRITH, 'Minas Tirith', [RUMOR_OF_WEALTH]);
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Hand play during M/H installs the ambush window ───────────────────

  test('resolves to discard and installs a dragon-ambush-window constraint on the company', () => {
    const state = buildHazardMovingState(ISENGARD, 'Isengard', [RUMOR_OF_WEALTH]);
    const idId = state.players[1].hand[0].instanceId;
    const play = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const after = resolveChain(dispatch(state, play));

    expect(after.players[1].hand).toHaveLength(0);
    expect(after.players[1].cardsInPlay).toHaveLength(0);
    expect(after.players[1].discardPile.map(c => c.instanceId)).toContain(idId);

    const companyId = after.players[0].companies[0].id;
    const c = after.activeConstraints.find(k => k.kind.type === 'dragon-ambush-window');
    expect(c).toBeDefined();
    expect(c!.target).toEqual({ kind: 'company', companyId });
    expect(c!.scope).toEqual({ kind: 'company-site-phase', companyId });
    expect(c!.kind).toMatchObject({ type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER });
  });

  // ─── Site phase: qualifying item play opens the ambush offer ───────────

  test('a major item successfully played at the guarded site offers the hazard player a Dragon ambush', () => {
    let state: GameState = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING] });
    const companyId = state.players[0].companies[0].id;
    state = addConstraint(state, {
      source: 'row-1' as CardInstanceId,
      sourceDefinitionId: RUMOR_OF_WEALTH,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER },
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    expect(play).toBeDefined();
    const after = dispatch(state, play);

    const offers = after.pendingResolutions.filter(r => r.kind.type === 'dragon-ambush-offer');
    expect(offers).toHaveLength(1);
    expect(offers[0].actor).toBe(PLAYER_2);
    expect(offers[0].kind).toMatchObject({ type: 'dragon-ambush-offer', companyId, creatureFilter: DRAGON_AMBUSH_FILTER });
  });

  test('a minor item does not open the ambush offer (subtype gate)', () => {
    let state: GameState = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [STING] });
    const companyId = state.players[0].companies[0].id;
    state = addConstraint(state, {
      source: 'row-1' as CardInstanceId,
      sourceDefinitionId: RUMOR_OF_WEALTH,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER },
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);

    expect(after.pendingResolutions.filter(r => r.kind.type === 'dragon-ambush-offer')).toHaveLength(0);
  });

  test('no offer fires when no dragon-ambush-window constraint is bound to the company', () => {
    const state = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING] });
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);

    expect(after.pendingResolutions.filter(r => r.kind.type === 'dragon-ambush-offer')).toHaveLength(0);
  });

  // ─── Resolving the ambush offer ─────────────────────────────────────────

  test('the hazard player may play a matching Dragon hazard creature from hand, bypassing the hazard limit', () => {
    let state: GameState = buildSitePhaseState({
      site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING],
      opponentHand: [CAVE_DRAKE],
    });
    const companyId = state.players[0].companies[0].id;
    state = addConstraint(state, {
      source: 'row-1' as CardInstanceId,
      sourceDefinitionId: RUMOR_OF_WEALTH,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER },
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const afterItem = dispatch(state, play);

    const offer = afterItem.pendingResolutions.find(r => r.kind.type === 'dragon-ambush-offer')!;
    expect(offer).toBeDefined();

    const ambushActions = viableActions(afterItem, PLAYER_2, 'play-dragon-ambush-creature');
    expect(ambushActions.length).toBeGreaterThan(0);
    const ambushPlay = ambushActions[0].action as PlayDragonAmbushCreatureAction;
    const afterAmbush = dispatch(afterItem, ambushPlay);

    // Constraint consumed; combat initiated with the played Dragon creature.
    expect(afterAmbush.activeConstraints.find(c => c.kind.type === 'dragon-ambush-window')).toBeUndefined();
    expect(afterAmbush.pendingResolutions.filter(r => r.kind.type === 'dragon-ambush-offer')).toHaveLength(0);
    expect(afterAmbush.chain).not.toBeNull();
  });

  test('Eärcaraxë is excluded from the ambush offer even though it is a Dragon hazard creature', () => {
    let state: GameState = buildSitePhaseState({
      site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING],
      opponentHand: [EARCARAXE],
    });
    const companyId = state.players[0].companies[0].id;
    state = addConstraint(state, {
      source: 'row-1' as CardInstanceId,
      sourceDefinitionId: RUMOR_OF_WEALTH,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER },
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const afterItem = dispatch(state, play);

    expect(afterItem.pendingResolutions.some(r => r.kind.type === 'dragon-ambush-offer')).toBe(true);
    expect(viableActions(afterItem, PLAYER_2, 'play-dragon-ambush-creature')).toHaveLength(0);
    expect(viableActions(afterItem, PLAYER_2, 'pass')).toHaveLength(1);
  });

  test('passing the ambush offer leaves the dragon-ambush-window constraint armed for a later item play', () => {
    let state: GameState = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING] });
    const companyId = state.players[0].companies[0].id;
    state = addConstraint(state, {
      source: 'row-1' as CardInstanceId,
      sourceDefinitionId: RUMOR_OF_WEALTH,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'dragon-ambush-window', creatureFilter: DRAGON_AMBUSH_FILTER },
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const afterItem = dispatch(state, play);
    expect(afterItem.pendingResolutions.some(r => r.kind.type === 'dragon-ambush-offer')).toBe(true);

    const afterPass = dispatch(afterItem, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.pendingResolutions.filter(r => r.kind.type === 'dragon-ambush-offer')).toHaveLength(0);
    expect(afterPass.activeConstraints.find(c => c.kind.type === 'dragon-ambush-window')).toBeDefined();
  });

  // ─── On-guard reveal path ───────────────────────────────────────────────

  test('can be placed on-guard and revealed when a major item is about to be played, installing the ambush window', () => {
    let state: GameState = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [GLAMDRING] });
    ({ state } = placeOnGuard(state, RESOURCE_PLAYER, 0, RUMOR_OF_WEALTH));

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    expect(play).toBeDefined();

    const afterIntercept = dispatch(state, play);
    const revealActions = viableActions(afterIntercept, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(1);

    const afterReveal = resolveChain(dispatch(afterIntercept, revealActions[0].action));

    const companyId = state.players[0].companies[0].id;
    expect(afterReveal.activeConstraints.find(c => c.kind.type === 'dragon-ambush-window' && c.target.kind === 'company' && c.target.companyId === companyId)).toBeDefined();

    // The deferred item play still resolves once the active player passes the closed window.
    const afterDeferred = dispatch(afterReveal, { type: 'pass', player: PLAYER_1 });
    expect(afterDeferred.pendingResolutions.some(r => r.kind.type === 'dragon-ambush-offer')).toBe(true);
  });

  test('cannot be revealed on-guard against a Dragon\'s lair (Isle of the Ulond)', () => {
    let state: GameState = buildSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [ARAGORN], hand: [GLAMDRING] });
    ({ state } = placeOnGuard(state, RESOURCE_PLAYER, 0, RUMOR_OF_WEALTH));

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    expect(play).toBeDefined();

    const afterIntercept = dispatch(state, play);
    const revealActions = viableActions(afterIntercept, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(0);
  });
});

/**
 * @module ba-1.test
 *
 * Card test: Strider (ba-1)
 * Type: hero-character (manifestation of Aragorn II tw-120, `manifestId: "tw-120"`)
 * Effects: 3
 *
 * "Unique. Manifestation of Aragorn II. You may bring Aragorn II into play
 *  with Strider's company, removing Strider from the game and automatically
 *  transferring all cards on Strider to Aragorn II. +3 direct influence
 *  against the Rangers of the North faction. Tap Strider to search your
 *  discard pile for any one item, ally, or faction playable at his current
 *  site. You may bring it to your hand. The site must be in Arthedain,
 *  Cardolan, Rhudaur, or The Shire."
 *
 * Rules tested:
 * 1. Manifestation uniqueness (CoE g.man.1): Strider cannot be played while
 *    Aragorn II is in play, and vice versa. The character draft sets aside
 *    simultaneous picks of the two manifestations (CoE 1.9).
 * 2. manifestation-swap: the replacement play is offered (organization and
 *    site phases) while Aragorn II is in hand; resolving it removes Strider
 *    from the game (out-of-play pile), transfers items/hazards/followers to
 *    Aragorn II in Strider's company slot, does not consume the
 *    one-character-per-turn slot, and is gated on the freed influence
 *    covering Aragorn II's mind (9 vs Strider's 8: one spare GI needed).
 *    Per the CRF, Aragorn II enters play untapped.
 * 3. stat-modifier: +3 DI during faction-influence-check against Rangers of
 *    the North only (not other factions).
 * 4. grant-action fetch-playable-to-hand: tap Strider to fetch one
 *    item/ally/faction from the discard pile to hand, restricted to cards
 *    playable at his current site by the site's own rules
 *    (playableAtBearerSite), gated on the site's region being Arthedain,
 *    Cardolan, Rhudaur, or The Shire.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus, Alignment,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  BREE, RIVENDELL, LORIEN, MINAS_TIRITH, MORIA, HENNETH_ANNUN,
  RANGERS_OF_THE_NORTH, RANGERS_OF_ITHILIEN,
  DAGGER_OF_WESTERNESSE, ORC_PATROL, FOOLISH_WORDS,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch, findCharInstanceId, attachHazardToChar,
  createGame, runActions, draftInstId, makePlayDeck, pool,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { GameConfig } from '../test-helpers.js';
import { BARROW_DOWNS } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, GameState,
  InfluenceAttemptAction, OrganizationPhaseState, PlayCharacterAction,
} from '../../index.js';
import { computeLegalActions } from '../../index.js';

const STRIDER = 'ba-1' as CardDefinitionId;
const HALBARAD = 'tw-162' as CardDefinitionId; // mind 1 — follower fixture

/** All play-character actions for the given hand instance. */
function playCharacterActionsFor(state: GameState, instanceId: string) {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.action.type === 'play-character')
    .filter(ea => (ea.action as PlayCharacterAction).characterInstanceId as string === instanceId);
}

/** The viable manifestation-swap play actions (play-character with swapForInstanceId). */
function swapActions(state: GameState) {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'play-character')
    .filter(ea => (ea.action as PlayCharacterAction).swapForInstanceId !== undefined);
}

describe('Strider (ba-1)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: manifestation uniqueness (CoE g.man.1) ────────────────────────

  test('Strider cannot be played while Aragorn II is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [STRIDER],
          siteDeck: [BREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });

    const striderInHand = state.players[0].hand.find(c => c.definitionId === STRIDER)!;
    const plays = playCharacterActionsFor(state, striderInHand.instanceId as string);
    expect(plays.length).toBeGreaterThanOrEqual(1);
    for (const play of plays) {
      expect(play.viable).toBe(false);
      expect(play.reason).toMatch(/manifestation/i);
    }
  });

  test('Aragorn II cannot be played normally while Strider is in play, but the swap play is offered', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [STRIDER] }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const aragornInHand = state.players[0].hand.find(c => c.definitionId === ARAGORN)!;
    const plays = playCharacterActionsFor(state, aragornInHand.instanceId as string);

    // Normal play (no swap) is blocked by g.man.1.
    const normalPlays = plays.filter(ea => (ea.action as PlayCharacterAction).swapForInstanceId === undefined);
    expect(normalPlays.length).toBeGreaterThanOrEqual(1);
    for (const play of normalPlays) {
      expect(play.viable).toBe(false);
    }

    // The manifestation-swap play is offered, replacing Strider under the
    // same (general-influence) control at his company's site.
    const swaps = plays.filter(ea => (ea.action as PlayCharacterAction).swapForInstanceId !== undefined);
    expect(swaps).toHaveLength(1);
    expect(swaps[0].viable).toBe(true);
    const swap = swaps[0].action as PlayCharacterAction;
    expect(swap.swapForInstanceId).toBe(striderId);
    expect(swap.controlledBy).toBe('general');
    expect(swap.atSite).toBe(state.players[0].companies[0].currentSite!.instanceId);
  });

  test('character draft sets aside Strider and Aragorn II as manifestation duplicates (CoE 1.9)', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [STRIDER, BILBO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Round 1: P1 reveals Strider, P2 reveals Aragorn II → manifestation
    // duplicates of the same entity; both are set aside.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, STRIDER) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // Round 2: each picks their remaining character; pools exhaust and the
    // draft finalizes into starting companies.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BILBO) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
    ]);

    const draftedDefs = (idx: number) =>
      Object.values(state.players[idx].characters).map(c => c.definitionId as string);
    expect(draftedDefs(0)).toContain(BILBO as string);
    expect(draftedDefs(0)).not.toContain(STRIDER as string);
    expect(draftedDefs(1)).toContain(LEGOLAS as string);
    expect(draftedDefs(1)).not.toContain(ARAGORN as string);
  });

  // ─── Rule 2: manifestation-swap resolution ──────────────────────────────────

  test('swap removes Strider from the game and transfers items, hazards, and followers to Aragorn II', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BREE,
            characters: [
              { defId: STRIDER, items: [DAGGER_OF_WESTERNESSE] },
              { defId: HALBARAD, followerOf: 0 },
            ],
          }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    state = attachHazardToChar(state, 0, STRIDER, FOOLISH_WORDS, 1);

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const halbaradId = findCharInstanceId(state, RESOURCE_PLAYER, HALBARAD);
    const swaps = swapActions(state);
    expect(swaps).toHaveLength(1);

    const next = dispatch(state, swaps[0].action);
    const p1 = next.players[0];

    // Strider has left play: his card instance is removed from the game.
    expect(p1.characters[striderId]).toBeUndefined();
    expect(p1.outOfPlayPile.some(c => c.definitionId === STRIDER)).toBe(true);

    // Aragorn II is in play in Strider's company slot, untapped, under
    // general influence, with all cards on Strider transferred.
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    const aragorn = p1.characters[aragornId];
    expect(aragorn.status).toBe(CardStatus.Untapped);
    expect(aragorn.controlledBy).toBe('general');
    expect(aragorn.items.map(i => i.definitionId)).toContain(DAGGER_OF_WESTERNESSE);
    expect(aragorn.hazards.map(h => h.definitionId)).toContain(FOOLISH_WORDS);
    expect(aragorn.followers).toContain(halbaradId);
    expect(p1.characters[halbaradId].controlledBy).toBe(aragornId);
    expect(p1.companies[0].characters[0]).toBe(aragornId);
    expect(p1.companies[0].characters).not.toContain(striderId);

    // Aragorn II left the hand, and no card instance disappeared.
    expect(p1.hand.some(c => c.definitionId === ARAGORN)).toBe(false);

    // The replacement is an ability, not a character play: the
    // one-character-per-turn slot is untouched.
    expect((next.phaseState as OrganizationPhaseState).characterPlayedThisTurn).toBe(false);
  });

  test('swap is not offered when the freed influence cannot cover Aragorn II\'s mind', () => {
    // Strider 8 + Legolas 6 + Gimli 6 = 20 mind under GI → remaining GI 0.
    // Freed 8 < Aragorn II's mind 9 → the swap must not be offered.
    const blocked = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [STRIDER, LEGOLAS, GIMLI] }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    expect(swapActions(blocked)).toHaveLength(0);

    // Positive control: with 14 mind used the spare point exists → offered.
    const open = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [STRIDER, LEGOLAS] }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    expect(swapActions(open)).toHaveLength(1);
  });

  test('swap is offered during the site phase (CRF: any time a normal resource could be played)', () => {
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: BREE,
      hand: [ARAGORN],
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const swaps = swapActions(state);
    expect(swaps).toHaveLength(1);
    expect((swaps[0].action as PlayCharacterAction).swapForInstanceId).toBe(striderId);
  });

  // ─── Rule 3: +3 DI against the Rangers of the North faction ────────────────

  test('+3 DI against Rangers of the North reduces the required influence roll', () => {
    // Rangers of the North influence number = 10. Strider: base DI 2, +3 vs
    // this faction, +1 Dúnadan standard modification from the faction card.
    // need = 10 - (2 + 3 + 1) = 4.
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);
    const striderAttempt = attempts.find(a => a.influencingCharacterId === striderId);
    expect(striderAttempt).toBeDefined();
    expect(striderAttempt!.need).toBe(4);
  });

  test('+3 DI does not apply against other factions', () => {
    // Rangers of Ithilien influence number = 8. Strider: base DI 2, +1
    // Dúnadan standard modification — no +3 (wrong faction).
    // need = 8 - (2 + 1) = 5.
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: HENNETH_ANNUN,
      hand: [RANGERS_OF_ITHILIEN],
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);
    const striderAttempt = attempts.find(a => a.influencingCharacterId === striderId);
    expect(striderAttempt).toBeDefined();
    expect(striderAttempt!.need).toBe(5);
  });

  // ─── Rule 4: tap to fetch a playable item/ally/faction from discard ────────

  test('tap-fetch offers only cards playable at the current site (items at Barrow-downs)', () => {
    // Barrow-downs (Cardolan — qualifying region) plays minor/major items.
    // Discard: Dagger of Westernesse (minor item — fetchable), Rangers of the
    // North (faction playable at Bree only — not here), Orc-patrol (hazard —
    // fails the item/ally/faction filter).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARROW_DOWNS, characters: [STRIDER] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: [DAGGER_OF_WESTERNESSE, RANGERS_OF_THE_NORTH, ORC_PATROL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-to-hand');
    expect(activations).toHaveLength(1);

    const afterActivation = dispatch(state, activations[0].action);

    // Strider taps to pay the cost; the pending fetch targets his site.
    const striderId = findCharInstanceId(afterActivation, RESOURCE_PLAYER, STRIDER);
    expect(afterActivation.players[0].characters[striderId].status).toBe(CardStatus.Tapped);
    expect(afterActivation.pendingEffects).toHaveLength(1);
    const effect = (afterActivation.pendingEffects[0] as { effect: { type: string; to?: string; playableAtSite?: string } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(BARROW_DOWNS as string);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const discard = afterActivation.players[0].discardPile;
    const daggerInst = discard.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!;
    const factionInst = discard.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!;
    const patrolInst = discard.find(c => c.definitionId === ORC_PATROL)!;
    const offered = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(offered).toContain(daggerInst.instanceId as unknown as string);
    expect(offered).not.toContain(factionInst.instanceId as unknown as string);
    expect(offered).not.toContain(patrolInst.instanceId as unknown as string);

    // Resolving the fetch brings the item to hand (not the play deck).
    const afterFetch: GameState = dispatch(afterActivation, fetchActions[0].action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(afterFetch.players[0].discardPile).toHaveLength(2);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('tap-fetch at Bree offers the faction playable there but not items (no playable resources)', () => {
    // Bree (Arthedain — qualifying region) has no playable resource
    // categories, but Rangers of the North names Bree as its site.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [STRIDER] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: [DAGGER_OF_WESTERNESSE, RANGERS_OF_THE_NORTH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-to-hand');
    expect(activations).toHaveLength(1);
    const afterActivation = dispatch(state, activations[0].action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const discard = afterActivation.players[0].discardPile;
    const daggerInst = discard.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!;
    const factionInst = discard.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!;
    const offered = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(offered).toContain(factionInst.instanceId as unknown as string);
    expect(offered).not.toContain(daggerInst.instanceId as unknown as string);
  });

  test('tap-fetch is not offered outside Arthedain, Cardolan, Rhudaur, and The Shire', () => {
    // Lórien is in Wold & Foothills — the region gate fails even with
    // fetchable cards in the discard pile.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [STRIDER] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: [DAGGER_OF_WESTERNESSE, RANGERS_OF_THE_NORTH],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-to-hand');
    expect(activations).toHaveLength(0);
  });

  test('tap-fetch is not offered when Strider is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARROW_DOWNS, characters: [{ defId: STRIDER, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: [DAGGER_OF_WESTERNESSE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-to-hand');
    expect(activations).toHaveLength(0);
  });
});

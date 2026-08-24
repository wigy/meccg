/**
 * @module ba-1.test
 *
 * Card test: Strider (ba-1)
 * Type: hero-character (dúnadan warrior/scout/ranger, mind 8, DI 2,
 * homesite Bree, 3 MP, manifestId tw-120)
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
 * 1. Manifestation of Aragorn II (manifestId tw-120):
 *    - g.man.1 — Aragorn II cannot be played normally while Strider is in
 *      play, and vice versa (regardless of which player owns the copy).
 *    - Rule 1.9 — Strider and Aragorn II revealed in the same character
 *      draft round collide and are both set aside.
 * 2. manifestation-swap — bring Aragorn II from hand into Strider's company
 *    (offered wherever a normal resource could be played, per CRF 22):
 *    Aragorn II enters untapped at Strider's position with all of Strider's
 *    cards (items) and control relationships (followers) transferred;
 *    Strider's card is removed from the game (out-of-play pile); the play
 *    does not consume the one-character-per-turn slot.
 * 3. stat-modifier: +3 DI during faction-influence-check, gated on
 *    faction.name = "Rangers of the North" only.
 * 4. grant-action fetch-playable-from-discard: tap Strider to fetch one
 *    item/ally/faction playable at his current site from the discard pile
 *    to hand — only at a site in Arthedain/Cardolan/Rhudaur/The Shire.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus, Alignment,
  ARAGORN, LEGOLAS, BEREGOND, STING, GLAMDRING, ORC_PATROL,
  RANGERS_OF_THE_NORTH,
  BREE, RIVENDELL, LORIEN, MINAS_TIRITH, THRANDUILS_HALLS,
  buildTestState, buildSitePhaseState, resetMint, recomputeDerived,
  viableActions, nonViableOfType, dispatch, findCharInstanceId,
  createGame, makePlayDeck, pool, draftInstId, runActions,
  assertEveryInstanceReachable,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { GameConfig } from '../test-helpers.js';
import type {
  ActivateGrantedAction, CardDefinitionId,
  InfluenceAttemptAction, ManifestationSwapAction, OrganizationPhaseState,
} from '../../index.js';
import { computeLegalActions } from '../../index.js';

const STRIDER = 'ba-1' as CardDefinitionId;
const WOOD_ELVES = 'tw-367' as CardDefinitionId;      // faction at Thranduil's Halls
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;    // Cardolan, playable: minor, major
const HEALING_HERBS = 'tw-255' as CardDefinitionId;   // minor item, no effects

/** Standard opponent setup shared by the organization-phase fixtures. */
const OPPONENT_SETUP = {
  id: PLAYER_2,
  companies: [{ site: LORIEN, characters: [LEGOLAS] }],
  hand: [],
  siteDeck: [MINAS_TIRITH],
};

describe('Strider (ba-1)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Manifestation of Aragorn II — g.man.1 uniqueness ──────────────

  test('Aragorn II cannot be played normally while Strider is in play (g.man.1)', () => {
    // Strider's company sits at Rivendell (a haven) — Aragorn II would
    // normally be playable there, but the in-play manifestation blocks it.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [STRIDER] }], hand: [ARAGORN], siteDeck: [] },
        OPPONENT_SETUP,
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    expect(viableActions(state, PLAYER_1, 'play-character')).toHaveLength(0);

    const blocked = nonViableOfType(actions, 'play-character');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  test('Strider cannot be played while Aragorn II is in play (g.man.1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [STRIDER], siteDeck: [] },
        OPPONENT_SETUP,
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    expect(viableActions(state, PLAYER_1, 'play-character')).toHaveLength(0);

    const blocked = nonViableOfType(actions, 'play-character');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  test('Strider in play blocks the OPPONENT from playing Aragorn II (g.man.1: regardless of alignment)', () => {
    // Player 2 is the active player holding Aragorn II; player 1 has Strider
    // in play. g.man.1 applies across players.
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ARAGORN], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const blocked = nonViableOfType(actions, 'play-character');
    expect(viableActions(state, PLAYER_2, 'play-character')).toHaveLength(0);
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── Rule 1: Manifestation of Aragorn II — rule 1.9 draft collision ────────

  test('Strider and Aragorn II collide in the character draft and are both set aside (rule 1.9)', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [STRIDER, BEREGOND],
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
    // collision; both are set aside.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, STRIDER) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // Round 2: each drafts their remaining character; pools exhaust and the
    // draft finalizes.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BEREGOND) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
    ]);

    // Neither company contains the collided manifestations.
    const p1Defs = Object.values(state.players[0].characters).map(c => c.definitionId);
    const p2Defs = Object.values(state.players[1].characters).map(c => c.definitionId);
    expect(p1Defs).not.toContain(STRIDER);
    expect(p2Defs).not.toContain(ARAGORN);
    expect(p1Defs).toContain(BEREGOND);
    expect(p2Defs).toContain(LEGOLAS);
  });

  // ─── Rule 2: manifestation-swap (Strider → Aragorn II) ─────────────────────

  test('manifestation-swap is offered during the organization phase when Aragorn II is in hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [ARAGORN], siteDeck: [RIVENDELL] },
        OPPONENT_SETUP,
      ],
    });
    const swaps = viableActions(state, PLAYER_1, 'manifestation-swap');
    expect(swaps).toHaveLength(1);
    const action = swaps[0].action as ManifestationSwapAction;
    expect(action.characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, STRIDER));
  });

  test('manifestation-swap is not offered without Aragorn II in hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [RANGERS_OF_THE_NORTH], siteDeck: [RIVENDELL] },
        OPPONENT_SETUP,
      ],
    });
    expect(viableActions(state, PLAYER_1, 'manifestation-swap')).toHaveLength(0);
  });

  test('manifestation-swap is also offered during the site phase (CRF: any time a normal resource could be played)', () => {
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: BREE,
      hand: [ARAGORN],
    });
    expect(viableActions(state, PLAYER_1, 'manifestation-swap')).toHaveLength(1);
  });

  test('swap brings Aragorn II into Strider\'s company, removes Strider from the game, and transfers all cards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BREE,
            characters: [
              { defId: STRIDER, items: [STING] },
              { defId: BEREGOND, followerOf: 0 },
            ],
          }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        OPPONENT_SETUP,
      ],
    });
    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const striderItems = state.players[0].characters[striderId].items;
    expect(striderItems).toHaveLength(1); // Sting attached in fixture

    const swaps = viableActions(state, PLAYER_1, 'manifestation-swap');
    expect(swaps).toHaveLength(1);
    const next = dispatch(state, swaps[0].action);

    // Strider is gone from play and removed from the game (out-of-play pile).
    expect(next.players[0].characters[striderId]).toBeUndefined();
    expect(next.players[0].outOfPlayPile.some(c => c.instanceId === striderId)).toBe(true);

    // Aragorn II is in play, untapped, at Strider's position in the company.
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    const aragorn = next.players[0].characters[aragornId];
    expect(aragorn.status).toBe(CardStatus.Untapped);
    expect(next.players[0].companies[0].characters[0]).toBe(aragornId);
    expect(next.players[0].companies[0].characters).toHaveLength(2);

    // All cards on Strider transferred: Sting rides along.
    expect(aragorn.items.map(i => i.instanceId)).toEqual(striderItems.map(i => i.instanceId));

    // Control relationships transferred: Beregond now follows Aragorn II.
    expect(next.players[0].characters[beregondId].controlledBy).toBe(aragornId);
    expect(aragorn.followers).toContain(beregondId);

    // Aragorn II left the hand; no instance disappeared anywhere.
    expect(next.players[0].hand).toHaveLength(0);
    assertEveryInstanceReachable(next);
  });

  test('swap preserves the rule-9.16 "in use" declaration (effective stats do not revert)', () => {
    // Regression: replaceCharacterInPlace transferred items but dropped
    // itemsInUse, so a character with a declared non-first weapon reverted to
    // first-carried after the swap — silently changing effective prowess.
    // Strider carries Sting (+1, first) and Glamdring (+3); Glamdring is
    // declared in use, so only one weapon (rule 9.15) applies — the declared
    // Glamdring, +3.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [{ defId: STRIDER, items: [STING, GLAMDRING] }] }],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        OPPONENT_SETUP,
      ],
    });
    const striderId = findCharInstanceId(built, RESOURCE_PLAYER, STRIDER);
    const glamdringId = built.players[0].characters[striderId].items.find(i => i.definitionId === GLAMDRING)!.instanceId;
    // Declare Glamdring in use (rule 9.16), then recompute.
    const withInUse = recomputeDerived({
      ...built,
      players: [
        {
          ...built.players[0],
          characters: {
            ...built.players[0].characters,
            [striderId as string]: { ...built.players[0].characters[striderId], itemsInUse: [glamdringId] },
          },
        },
        built.players[1],
      ] as typeof built.players,
    });
    const striderProwess = withInUse.players[0].characters[striderId].effectiveStats.prowess;

    const swaps = viableActions(withInUse, PLAYER_1, 'manifestation-swap');
    const next = dispatch(withInUse, swaps[0].action);

    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    const aragorn = next.players[0].characters[aragornId];
    // The in-use election rode along with the items.
    expect(aragorn.itemsInUse).toContain(glamdringId);
    // Effective prowess reflects the declared Glamdring, not first-carried
    // Sting: strictly more than base + Sting's +1. (Glamdring's raw +3 is
    // capped at its own max, so assert the inequality rather than a hardcoded
    // total.) Without the fix itemsInUse is dropped, Sting (first) applies, and
    // prowess would be exactly base + 1.
    const aragornBase = (next.cardPool[ARAGORN] as { prowess: number }).prowess;
    expect(aragorn.effectiveStats.prowess).toBeGreaterThan(aragornBase + 1);
    // Sanity: the declaration mattered on Strider too (Glamdring active, not Sting).
    expect(striderProwess).toBeGreaterThan(0);
  });

  test('the swap is a resource-style play: it does not consume the one-character-per-turn slot', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [ARAGORN], siteDeck: [RIVENDELL] },
        OPPONENT_SETUP,
      ],
    });
    const swaps = viableActions(state, PLAYER_1, 'manifestation-swap');
    const next = dispatch(state, swaps[0].action);
    const orgState = next.phaseState as OrganizationPhaseState;
    expect(orgState.characterPlayedThisTurn).not.toBe(true);
  });

  // ─── Rule 3: +3 direct influence against Rangers of the North ──────────────

  test('+3 direct influence against the Rangers of the North faction', () => {
    // Strider (dúnadan, base DI 2) influences Rangers of the North at Bree.
    // Rangers influence number = 10; the faction card gives Dúnedain +1.
    //   need = 10 - (DI 2 + Strider bonus 3 + dúnadan mod 1) = 4
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === striderId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('the +3 DI bonus does not apply against other factions', () => {
    // Strider influences Wood-elves (influence number 9) at Thranduil's Halls.
    // No dúnadan modifier on Wood-elves, no Strider bonus:
    //   need = 9 - DI 2 = 7
    const state = buildSitePhaseState({
      characters: [STRIDER],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const striderId = findCharInstanceId(state, RESOURCE_PLAYER, STRIDER);
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === striderId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ─── Rule 4: tap to fetch a playable item/ally/faction from discard ────────

  test('fetch grant-action is offered at Bree (Arthedain) when Strider is untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [], siteDeck: [RIVENDELL], discardPile: [RANGERS_OF_THE_NORTH] },
        OPPONENT_SETUP,
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-from-discard');
    expect(actions).toHaveLength(1);
  });

  test('fetch grant-action is NOT offered when Strider is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [{ defId: STRIDER, status: CardStatus.Tapped }] }], hand: [], siteDeck: [RIVENDELL], discardPile: [RANGERS_OF_THE_NORTH] },
        OPPONENT_SETUP,
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-from-discard');
    expect(actions).toHaveLength(0);
  });

  test('fetch grant-action is NOT offered outside Arthedain/Cardolan/Rhudaur/The Shire', () => {
    // Lórien lies in Wold & Foothills — outside the four named regions.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [STRIDER] }], hand: [], siteDeck: [RIVENDELL], discardPile: [RANGERS_OF_THE_NORTH] },
        OPPONENT_SETUP,
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-from-discard');
    expect(actions).toHaveLength(0);
  });

  test('activation taps Strider and only offers cards playable at his current site, to hand', () => {
    // Discard pile: Rangers of the North (playable at Bree), Healing Herbs
    // (minor item — Bree has no printed playable resources), Orc-patrol
    // (hazard — excluded by the filter).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [STRIDER] }], hand: [], siteDeck: [RIVENDELL], discardPile: [RANGERS_OF_THE_NORTH, HEALING_HERBS, ORC_PATROL] },
        OPPONENT_SETUP,
      ],
    });

    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-from-discard')!;
    expect(activate).toBeDefined();
    const afterActivation = dispatch(state, activate.action);

    // Cost paid: Strider is tapped.
    const striderId = findCharInstanceId(afterActivation, RESOURCE_PLAYER, STRIDER);
    expect(afterActivation.players[0].characters[striderId].status).toBe(CardStatus.Tapped);

    // The pending fetch targets the hand and carries the site restriction.
    expect(afterActivation.pendingEffects).toHaveLength(1);
    const effect = (afterActivation.pendingEffects[0] as { effect: { type: string; to?: string; playableAtSite?: string } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(BREE);

    // Only the faction playable at Bree is offered.
    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);

    const rangersInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId)
      .toBe(rangersInstance.instanceId as unknown as string);

    // Resolving the fetch brings the faction to hand (not the play deck).
    const afterFetch = dispatch(afterActivation, fetchActions[0].action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(true);
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(false);
    expect(afterFetch.players[0].discardPile.map(c => c.definitionId)).toEqual([HEALING_HERBS, ORC_PATROL]);
    expect(afterFetch.pendingEffects).toHaveLength(0);
    assertEveryInstanceReachable(afterFetch);
  });

  test('an item is fetchable at a site whose printed resources allow it (Barrow-downs, Cardolan)', () => {
    // Barrow-downs (Cardolan) plays minor and major items — Healing Herbs
    // (minor) qualifies there, while the Rangers faction (playable at Bree
    // only) does not.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARROW_DOWNS, characters: [STRIDER] }], hand: [], siteDeck: [RIVENDELL], discardPile: [HEALING_HERBS, RANGERS_OF_THE_NORTH] },
        OPPONENT_SETUP,
      ],
    });

    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-playable-from-discard')!;
    expect(activate).toBeDefined();
    const afterActivation = dispatch(state, activate.action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);

    const herbsInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === HEALING_HERBS)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId)
      .toBe(herbsInstance.instanceId as unknown as string);
  });
});

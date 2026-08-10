/**
 * @module td-108.test
 *
 * Card test: Dragon-lore (td-108)
 * Type: hero-resource-event (permanent), alignment wizard
 *
 * Effects:
 *   - play-target site:      filter playableResources includes "information"
 *   - play-target character: filter untapped sage, cost tap character
 *   - play-flag:              untapped-site-required
 *   - play-flag:              tap-site-on-play
 *   - grant-action:           dragon-lore-search-item (activeSitePhase),
 *                             cost tap bearer + discard self; when
 *                             site.hasDragonAutoAttack + site.isTapped;
 *                             apply = enqueue-pending-fetch (deck + discard
 *                             pile → hand, playableAtBearerSite,
 *                             unlockTappedSitePlay, filter hero-resource-item)
 *
 * Text:
 *   "Playable on a sage during the site phase at an untapped site where
 *    Information is playable. Tap the sage and the site. During a site
 *    phase at a tapped Dragon's lair, tap bearer and discard Dragon-lore.
 *    Search your play deck and/or discard pile for any item playable at the
 *    Dragon's lair. This item may be immediately played with bearer's
 *    company."
 *
 * | # | Rule                                                            | Status |
 * |---|------------------------------------------------------------------|--------|
 * | 1 | Playable during the site phase only, on a sage                  | OK     |
 * | 2 | Site must be untapped and have Information playable              | OK     |
 * | 3 | Playing taps the sage AND the site, attaches to the sage         | OK     |
 * | 4 | Grant-action offered only at a tapped Dragon's lair, cost tap    | OK     |
 * |   |   bearer + discard self                                         | OK     |
 * | 5 | Activating searches deck+discard for an item playable at the     | OK     |
 * |   |   lair, brings it to hand                                       | OK     |
 * | 6 | The fetched item may be played immediately despite the tapped    | OK     |
 * |   |   site (one-shot allowance, consumed on play)                    | OK     |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus, Phase,
  buildTestState, buildSitePhaseState, makePlayDeck,
  resetMint,
  viableActions, dispatch, resolveChain,
  findCharInstanceId, findHandCardId,
  attachItemToChar,
  expectInDiscardPile,
  ARAGORN, BILBO,
  DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, SitePhaseState } from '../../index.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';
import { computeLegalActions } from '../../index.js';

const DRAGON_LORE = 'td-108' as CardDefinitionId;

// Isle of the Ulond (td-178): Ruins & Lairs, playable (information, minor,
// major), automatic-attack Dragon — a Dragon's lair with Information playable.
const ISLE_OF_THE_ULOND = 'td-178' as CardDefinitionId;
// Dimrill Dale (tw-385): Ruins & Lairs, playable (information),
// automatic-attack Orcs — has Information but is NOT a Dragon's lair.
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;
// Dunharrow (tw-389): Border-hold, no playable resources at all.
const DUNHARROW = 'tw-389' as CardDefinitionId;

// BILBO (tw-131) is a sage; ARAGORN II (tw-120) is not.

describe('Dragon-lore (td-108)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on a sage during the site phase only ────────────────

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: ISLE_OF_THE_ULOND, characters: [BILBO] }], hand: [DRAGON_LORE], siteDeck: [DIMRILL_DALE], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: DIMRILL_DALE, characters: [ARAGORN] }], hand: [], siteDeck: [DIMRILL_DALE] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a non-sage character (Aragorn)', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [ARAGORN], hand: [DRAGON_LORE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('only the sage is offered as a target when the company also has a non-sage', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [BILBO, ARAGORN], hand: [DRAGON_LORE] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    expect((actions[0].action as { targetCharacterId?: string }).targetCharacterId).toBe(bilboId);
  });

  test('NOT playable when the sage is tapped', () => {
    const state = buildSitePhaseState({
      site: ISLE_OF_THE_ULOND,
      characters: [{ defId: BILBO, status: CardStatus.Tapped }],
      hand: [DRAGON_LORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Rule 2: site must be untapped and have Information playable ──────────

  test('IS playable on a sage at an untapped site where Information is playable', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [BILBO], hand: [DRAGON_LORE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT playable at a site without Information (Dunharrow)', () => {
    const state = buildSitePhaseState({ site: DUNHARROW, characters: [BILBO], hand: [DRAGON_LORE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable when the site is already tapped', () => {
    const state = buildSitePhaseState({
      site: ISLE_OF_THE_ULOND, characters: [BILBO], hand: [DRAGON_LORE], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Rule 3: playing taps the sage AND the site, attaches to the sage ─────

  test('playing taps the sage and the site, and attaches to the sage', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND, characters: [BILBO], hand: [DRAGON_LORE] });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-permanent-event')[0].action));

    expect(after.players[RESOURCE_PLAYER].characters[bilboId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[bilboId].items
      .some(i => i.definitionId === DRAGON_LORE)).toBe(true);
  });

  // ── Rule 4: grant-action offered only at a tapped Dragon's lair ──────────

  function buildBearerState(opts: {
    site: CardDefinitionId;
    siteStatus: CardStatus;
    characters?: CardDefinitionId[];
    discardPile?: CardDefinitionId[];
    bilboTapped?: boolean;
  }): GameState {
    let state: GameState = buildSitePhaseState({
      site: opts.site,
      characters: opts.characters ?? [BILBO, ARAGORN],
      siteStatus: opts.siteStatus,
      discardPile: opts.discardPile ?? [],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, DRAGON_LORE);
    if (opts.bilboTapped) {
      const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
      state = {
        ...state,
        players: [
          {
            ...state.players[RESOURCE_PLAYER],
            characters: {
              ...state.players[RESOURCE_PLAYER].characters,
              [bilboId]: { ...state.players[RESOURCE_PLAYER].characters[bilboId], status: CardStatus.Tapped },
            },
          },
          state.players[1],
        ] as typeof state.players,
      };
    }
    return state;
  }

  function dragonLoreGrants(state: GameState) {
    return viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'dragon-lore-search-item');
  }

  test('offered at a tapped Dragon\'s lair (Isle of the Ulond)', () => {
    const state = buildBearerState({ site: ISLE_OF_THE_ULOND, siteStatus: CardStatus.Tapped });
    const grants = dragonLoreGrants(state);
    expect(grants).toHaveLength(1);
    expect(grants[0].characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, BILBO));
  });

  test('NOT offered at an untapped Dragon\'s lair', () => {
    const state = buildBearerState({ site: ISLE_OF_THE_ULOND, siteStatus: CardStatus.Untapped });
    expect(dragonLoreGrants(state)).toHaveLength(0);
  });

  test('NOT offered at a tapped site that is not a Dragon\'s lair (Dimrill Dale)', () => {
    const state = buildBearerState({ site: DIMRILL_DALE, siteStatus: CardStatus.Tapped });
    expect(dragonLoreGrants(state)).toHaveLength(0);
  });

  test('NOT offered when the bearer (sage) is already tapped', () => {
    const state = buildBearerState({ site: ISLE_OF_THE_ULOND, siteStatus: CardStatus.Tapped, bilboTapped: true });
    expect(dragonLoreGrants(state)).toHaveLength(0);
  });

  // ── Rule 5: activating searches deck+discard, brings the item to hand ────

  test('activating taps bearer, discards Dragon-lore, and enqueues a deck+discard fetch playable at the lair', () => {
    const state = buildBearerState({
      site: ISLE_OF_THE_ULOND, siteStatus: CardStatus.Tapped,
      discardPile: [DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING],
    });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const grant = dragonLoreGrants(state)[0];
    const after = dispatch(state, grant);

    // Cost paid: bearer tapped, Dragon-lore discarded from Bilbo's items.
    expect(after.players[RESOURCE_PLAYER].characters[bilboId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[bilboId].items
      .some(i => i.definitionId === DRAGON_LORE)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, DRAGON_LORE);

    // The pending fetch targets the hand, sources deck + discard pile, and
    // carries the Dragon's-lair site-playability restriction.
    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as {
      effect: { type: string; source: readonly string[]; to?: string; playableAtSite?: string; unlockTappedSitePlay?: boolean };
    }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toEqual(['deck', 'discard-pile']);
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(ISLE_OF_THE_ULOND);
    expect(effect.unlockTappedSitePlay).toBe(true);

    // Only the item playable at Isle of the Ulond (minor/major/information) is
    // offered — the gold ring (not in the site's playable resources) is not.
    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const daggerInstance = after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId)
      .toBe(daggerInstance.instanceId as unknown as string);
  });

  // ── Rule 6: the fetched item is immediately playable despite the tapped site ─

  test('the fetched item lands in hand and may be immediately played at the still-tapped site', () => {
    const state = buildBearerState({
      site: ISLE_OF_THE_ULOND, siteStatus: CardStatus.Tapped,
      discardPile: [DAGGER_OF_WESTERNESSE],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const grant = dragonLoreGrants(state)[0];
    const afterActivation = dispatch(state, grant);

    const fetchAction = computeLegalActions(afterActivation, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'fetch-from-pile')!.action;
    const afterFetch = dispatch(afterActivation, fetchAction);

    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect((afterFetch.phaseState as SitePhaseState).tappedSiteItemUnlock).toBeDefined();

    // The site is still tapped, yet the fetched item is offered — Aragorn
    // (untapped, in the same company) may receive it.
    const dagger = findHandCardId(afterFetch, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    expect(afterFetch.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    const itemActions = computeLegalActions(afterFetch, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === dagger,
    );
    const onAragorn = itemActions.find(ea => (ea.action as { attachToCharacterId: unknown }).attachToCharacterId === aragornId);
    expect(onAragorn).toBeDefined();

    const afterItem = dispatch(afterFetch, onAragorn!.action);
    expect(afterItem.players[RESOURCE_PLAYER].characters[aragornId].items
      .some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    // The one-shot allowance is consumed once the item is played.
    expect((afterItem.phaseState as SitePhaseState).tappedSiteItemUnlock).toBeUndefined();
  });

  test('without Dragon-lore\'s unlock, no item may be played at an already-tapped site', () => {
    const state = buildSitePhaseState({
      site: ISLE_OF_THE_ULOND, characters: [BILBO, ARAGORN], hand: [DAGGER_OF_WESTERNESSE], siteStatus: CardStatus.Tapped,
    });
    const itemActions = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE),
    );
    expect(itemActions).toHaveLength(0);
  });
});

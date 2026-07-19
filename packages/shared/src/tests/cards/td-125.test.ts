/**
 * @module tests/cards/td-125
 *
 * Card test for **Houses of Healing** (td-125).
 *
 * Houses of Healing is a hero (wizard) permanent resource-event, 0 MP.
 * Card text: "Playable on a Free-hold [{F}]. Site becomes a Haven [{H}]
 * for the purposes of healing. Discard Houses of Healing when the site
 * is returned to the location deck or discarded."
 *
 * Card shape (documented here, not asserted — see the testing policy):
 *   cardType `hero-resource-event`, `eventType: "permanent"`, non-unique,
 *   effects = play-target site (`filter.siteType: "free-hold"`) +
 *   on-event `self-enters-play` → add-constraint `site-type-override`
 *   (`overrideType: "haven"`, `purpose: "healing"`, `scope: "until-cleared"`).
 *
 * Rules exercised:
 *   1. Playable during the site phase on a Free-hold (Edoras).
 *   2. NOT playable at a non-Free-hold site (Moria, a Shadow-hold).
 *   3. Playing it binds the card to the site (`attachedToSite`) and adds a
 *      **healing-only** `site.type` override constraint (Edoras → haven).
 *   4. The override is scoped to healing: `getEffectiveSiteType` still reports
 *      the printed Free-hold type, so hazard keying / movement / bring-into-play
 *      / item-and-faction playability are unaffected.
 *   5. A wounded character at the bound Free-hold heals to Tapped during untap
 *      while Houses of Healing is in play (and stays wounded without it).
 *   6. Discarded (with its constraint cleared) once no company occupies the
 *      bound site — "when the site is returned to the location deck or discarded".
 */

import { describe, test, beforeEach, expect } from 'vitest';
import {
  buildSitePhaseState, buildTestState, resetMint,
  playPermanentEventAndResolve, handCardId, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions, reduce, Phase, CardStatus, SiteType,
  ELROND, LEGOLAS, EDORAS, MORIA, LORIEN, RIVENDELL,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, PlayPermanentEventAction,
} from '../../index.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const HOUSES_OF_HEALING = 'td-125' as CardDefinitionId;

describe('td-125 Houses of Healing', () => {
  beforeEach(() => resetMint());

  test('playable during the site phase on a Free-hold', () => {
    const state: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as PlayPermanentEventAction;
    expect(action.targetSiteDefinitionId).toBe(EDORAS);
  });

  test('not playable at a non-Free-hold site', () => {
    const state: GameState = buildSitePhaseState({
      site: MORIA, // Shadow-hold
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });

    const viablePlays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(viablePlays).toHaveLength(0);
  });

  test('playing it binds to the site and adds a healing-only haven override', () => {
    let state: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });
    const houseId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, houseId, undefined, {
      targetSiteDefinitionId: EDORAS,
    });

    const inPlay = state.players[RESOURCE_PLAYER].cardsInPlay
      .find(c => c.definitionId === HOUSES_OF_HEALING);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(EDORAS);

    const override = state.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && c.kind.attribute === 'site.type'
        && c.kind.op === 'override'
        && c.kind.value === 'haven'
        && (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'] === (EDORAS as unknown as string),
    );
    expect(override).toBeDefined();
    expect(override!.scope.kind).toBe('until-cleared');
    // Healing-only: the override carries the marker that keeps it out of the
    // general effective-type resolution.
    expect((override!.kind as { healingOnly?: boolean }).healingOnly).toBe(true);
  });

  test('the override is scoped to healing — effective site type stays Free-hold', () => {
    let state: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });
    const instanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const houseId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, houseId, undefined, {
      targetSiteDefinitionId: EDORAS,
    });

    // The healing-only override must NOT change the general effective type;
    // hazard keying, movement, bring-into-play and playability all read this.
    expect(getEffectiveSiteType(state, EDORAS, SiteType.FreeHold, instanceId))
      .toBe(SiteType.FreeHold);
  });

  test('a wounded character at the bound Free-hold heals during untap while in play', () => {
    // Play the card for real to obtain the genuine constraint...
    let played: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [{ defId: ELROND, status: CardStatus.Inverted }],
      hand: [HOUSES_OF_HEALING],
    });
    const houseId = handCardId(played, RESOURCE_PLAYER);
    played = playPermanentEventAndResolve(played, PLAYER_1, houseId, undefined, {
      targetSiteDefinitionId: EDORAS,
    });

    // ...then carry it into an untap-phase state with the wounded character.
    const untapState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [{ defId: ELROND, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const merged: GameState = {
      ...untapState,
      activeConstraints: [...untapState.activeConstraints, ...played.activeConstraints],
    };

    const result = reduce(merged, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const elrondId = findCharInstanceId(result.state, RESOURCE_PLAYER, ELROND);
    expect(result.state.players[RESOURCE_PLAYER].characters[elrondId].status)
      .toBe(CardStatus.Tapped);
  });

  test('without Houses of Healing a wounded character at a Free-hold stays wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [{ defId: ELROND, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const elrondId = findCharInstanceId(result.state, RESOURCE_PLAYER, ELROND);
    expect(result.state.players[RESOURCE_PLAYER].characters[elrondId].status)
      .toBe(CardStatus.Inverted);
  });

  test('persists while a company occupies the bound site', () => {
    let state: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });
    const houseId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, houseId, undefined, {
      targetSiteDefinitionId: EDORAS,
    });

    const swept = discardOrphanedSiteAttachedEvents(state);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOUSES_OF_HEALING))
      .toBe(true);
  });

  test('discarded with its constraint cleared once the site leaves play', () => {
    let state: GameState = buildSitePhaseState({
      site: EDORAS,
      characters: [ELROND],
      hand: [HOUSES_OF_HEALING],
    });
    const houseId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, houseId, undefined, {
      targetSiteDefinitionId: EDORAS,
    });
    const sourceId = state.players[RESOURCE_PLAYER].cardsInPlay
      .find(c => c.definitionId === HOUSES_OF_HEALING)!.instanceId;
    expect(state.activeConstraints.filter(c => c.source === sourceId).length).toBeGreaterThan(0);

    // The company moves on — no company now occupies Edoras (site returns to
    // the location deck).
    const movedCompany = {
      ...state.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...state.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: MORIA },
    };
    const moved: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], companies: [movedCompany] },
        state.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOUSES_OF_HEALING))
      .toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HOUSES_OF_HEALING))
      .toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});

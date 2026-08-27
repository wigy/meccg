/**
 * @module tests/cards/dm-148
 *
 * Card test for **Mallorn** (dm-148).
 *
 * Mallorn is a unique hero (wizard) permanent resource-event worth 3 MP.
 * Card text: "Unique. Playable at Bag End only if Earth of Galadriel's
 * Orchard is stored there. Bag End becomes a Haven [{H}] for the purposes
 * of healing and bringing characters into play. Bag End can untap during
 * its owner's untap phase. If Bag End is discarded, return it to its
 * location deck. All Hobbit factions are worth +1 marshalling points."
 *
 * Card shape (documented here, not asserted — see the testing policy):
 *   cardType `hero-resource-event`, `eventType: "permanent"`, unique.
 *   effects = play-target site (`filter.name: "Bag End"`) + play-condition
 *   `card-stored-at-site` (`cardName: "Earth of Galadriel's Orchard"`) +
 *   three `on-event: self-enters-play` → add-constraint effects
 *   (`site-type-override` with `purpose: "healing-and-character-play"`,
 *   `site-untaps-during-untap-phase`, `site-always-returns-to-deck`) +
 *   `faction-mp-bonus` (`bonus: 1`, `races: ["hobbit"]`).
 *
 * Rules exercised:
 *   1. Not playable at Bag End unless Earth of Galadriel's Orchard is
 *      stored there (a `card-stored-at-site` play-condition; presence in
 *      the marshalling-point pile stamped `storedAtSite`, not merely in
 *      play or in hand).
 *   2. Not playable at any site other than Bag End.
 *   3. Playing it binds the card to Bag End (`attachedToSite`) and installs
 *      all three `until-cleared` constraints.
 *   4. The haven override is scoped to healing + character-play only:
 *      `getEffectiveSiteType`'s general (non-character-play) callers still
 *      see Bag End as a Free-hold, so a regular minor item stays
 *      unstorable there.
 *   5. A wounded character at Bag End heals during untap while Mallorn is
 *      in play (and stays wounded without it).
 *   6. A non-homesite character may be recruited (general influence) at
 *      Bag End while Mallorn is in play (and may not without it).
 *   7. A tapped Bag End untaps during its owner's untap phase while
 *      Mallorn is in play (defying the normal "site cards never untap"
 *      rule; without Mallorn a tapped site stays tapped).
 *   8. A tapped Bag End (site of origin) is returned to the location deck
 *      instead of being discarded while Mallorn is in play (without it, a
 *      tapped non-haven site of origin is discarded as usual).
 *   9. Mallorn (and its constraints) persist even once no company occupies
 *      Bag End — the site is never truly out of circulation.
 *  10. Hobbit factions score +1 MP while Mallorn is in play (and only
 *      their printed MP without it).
 */

import { describe, test, beforeEach, expect } from 'vitest';
import {
  buildSitePhaseState, buildTestState, resetMint, mint,
  playPermanentEventAndResolve, handCardId, findCharInstanceId,
  attachItemToChar, addStoredCard,
  dispatch, makeMHState, viableActions, viablePlayCharacterActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, Alignment,
} from '../test-helpers.js';
import {
  reduce, Phase, CardStatus, SiteType,
  ARAGORN, LEGOLAS, HALDIR, RIVENDELL, LORIEN, CARN_DUM, BAG_END,
  DAGGER_OF_WESTERNESSE,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, PlayPermanentEventAction, PlayCharacterAction,
  ConstraintId, CardInPlay,
} from '../../index.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const MALLORN = 'dm-148' as CardDefinitionId;
const EARTH_OF_GALADRIELS_ORCHARD = 'tw-221' as CardDefinitionId;
const HOBBITS = 'tw-258' as CardDefinitionId;

/** Install Mallorn's three `until-cleared` constraints on Bag End, as if it were in play. */
function withMallornConstraints(state: GameState, sourceInstanceId = mint()): GameState {
  return {
    ...state,
    activeConstraints: [
      ...state.activeConstraints,
      {
        id: 'c-haven' as ConstraintId,
        source: sourceInstanceId,
        sourceDefinitionId: MALLORN,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: PLAYER_1 },
        kind: {
          type: 'attribute-modifier' as const,
          attribute: 'site.type' as const,
          op: 'override' as const,
          value: 'haven' as SiteType,
          filter: { 'site.definitionId': BAG_END as unknown as string },
          characterPlayOnly: true,
        },
      },
      {
        id: 'c-untap' as ConstraintId,
        source: sourceInstanceId,
        sourceDefinitionId: MALLORN,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: PLAYER_1 },
        kind: { type: 'site-flag' as const, flag: 'site-untaps-during-untap-phase' as const, siteDefinitionId: BAG_END },
      },
      {
        id: 'c-return' as ConstraintId,
        source: sourceInstanceId,
        sourceDefinitionId: MALLORN,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: PLAYER_1 },
        kind: { type: 'site-flag' as const, flag: 'site-always-returns-to-deck' as const, siteDefinitionId: BAG_END },
      },
    ],
  };
}

const cip = (definitionId: CardDefinitionId, instanceId: string): CardInPlay =>
  ({ instanceId: instanceId as GameState['players'][number]['cardsInPlay'][number]['instanceId'], definitionId, status: CardStatus.Untapped });

describe('dm-148 Mallorn', () => {
  beforeEach(() => resetMint());

  // ─── Playable at Bag End only if the Orchard is stored there ─────────────

  test('not playable at Bag End without Earth of Galadriel\'s Orchard stored there', () => {
    const state = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('playable at Bag End once Earth of Galadriel\'s Orchard is stored there', () => {
    let state: GameState = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    state = addStoredCard(state, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD, BAG_END).state;

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    expect(playActions).toHaveLength(1);
    expect(playActions[0].targetSiteDefinitionId).toBe(BAG_END);
  });

  test('not playable at Bag End when the Orchard is stored at a different site', () => {
    let state: GameState = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    state = addStoredCard(state, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD, RIVENDELL).state;
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('not playable at a non-Bag End site even with the Orchard stored at Bag End', () => {
    let state: GameState = buildSitePhaseState({ site: RIVENDELL, characters: [ARAGORN], hand: [MALLORN] });
    state = addStoredCard(state, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD, BAG_END).state;
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Playing it binds to the site and installs all three constraints ─────

  test('playing it binds to Bag End and installs the haven, untap, and return-to-deck constraints', () => {
    let state: GameState = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    state = addStoredCard(state, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD, BAG_END).state;
    const mallornId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, mallornId, undefined, {
      targetSiteDefinitionId: BAG_END,
    });

    const inPlay = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MALLORN);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(BAG_END);

    const havenOverride = state.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && c.kind.attribute === 'site.type'
        && c.kind.op === 'override'
        && c.kind.value === 'haven'
        && (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'] === (BAG_END as unknown as string),
    );
    expect(havenOverride).toBeDefined();
    expect(havenOverride!.scope.kind).toBe('until-cleared');
    expect((havenOverride!.kind as { characterPlayOnly?: boolean }).characterPlayOnly).toBe(true);

    const untapFlag = state.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'site-untaps-during-untap-phase' && c.kind.siteDefinitionId === BAG_END,
    );
    expect(untapFlag).toBeDefined();

    const returnFlag = state.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'site-always-returns-to-deck' && c.kind.siteDefinitionId === BAG_END,
    );
    expect(returnFlag).toBeDefined();
  });

  // ─── Haven override is scoped to healing + character-play only ───────────

  test('the haven override does not change the effective site type for general purposes', () => {
    const state = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    const instanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const constrained = withMallornConstraints(state);

    expect(getEffectiveSiteType(constrained, BAG_END, SiteType.FreeHold, instanceId))
      .toBe(SiteType.FreeHold);
  });

  test('a regular minor item is still not storable at Bag End', () => {
    let state: GameState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    state = withMallornConstraints(state);

    expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
  });

  // ─── Haven for healing ─────────────────────────────────────────────────

  test('a wounded character at Bag End heals during untap while Mallorn is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const constrained = withMallornConstraints(state);

    const result = reduce(constrained, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
  });

  test('without Mallorn, a wounded character at Bag End stays wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Inverted);
  });

  // ─── Haven for bringing characters into play ──────────────────────────

  test('lets a non-homesite character be recruited at Bag End while Mallorn is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, hand: [HALDIR], siteDeck: [], companies: [{ site: BAG_END, characters: [ARAGORN] }] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
      ],
    });
    const bagEndInst = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const constrained = withMallornConstraints(state);

    const viable = viablePlayCharacterActions(constrained, PLAYER_1);
    expect(viable.some((a: PlayCharacterAction) => a.atSite === bagEndInst)).toBe(true);
  });

  test('does NOT let a non-homesite character be recruited at Bag End without Mallorn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, hand: [HALDIR], siteDeck: [], companies: [{ site: BAG_END, characters: [ARAGORN] }] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
      ],
    });
    const bagEndInst = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some((a: PlayCharacterAction) => a.atSite === bagEndInst)).toBe(false);
  });

  // ─── Bag End untaps during the owner's untap phase ────────────────────

  test('a tapped Bag End untaps during the owner\'s untap phase while Mallorn is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const company = state.players[0].companies[0];
    const tapped: GameState = {
      ...state,
      players: [
        { ...state.players[0], companies: [{ ...company, currentSite: { ...company.currentSite!, status: CardStatus.Tapped } }] },
        state.players[1],
      ] as GameState['players'],
    };
    const constrained = withMallornConstraints(tapped);

    const result = reduce(constrained, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('without Mallorn, a tapped Bag End stays tapped after the untap phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const company = state.players[0].companies[0];
    const tapped: GameState = {
      ...state,
      players: [
        { ...state.players[0], companies: [{ ...company, currentSite: { ...company.currentSite!, status: CardStatus.Tapped } }] },
        state.players[1],
      ] as GameState['players'],
    };

    const result = reduce(tapped, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  // ─── If Bag End is discarded, return it to its location deck ─────────

  test('tapped Bag End (site of origin) returns to the location deck while Mallorn is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const lorienSite = built.players[0].siteDeck.find(c => c.definitionId === LORIEN)!;
    const bagEndOriginId = company.currentSite!.instanceId;

    const state: GameState = withMallornConstraints({
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: {
              instanceId: lorienSite.instanceId,
              definitionId: lorienSite.definitionId,
              status: CardStatus.Untapped,
            },
            siteOfOrigin: bagEndOriginId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ] as GameState['players'],
    });

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    expect(p1.siteDeck.some(c => c.instanceId === bagEndOriginId)).toBe(true);
    expect(p1.siteDiscardPile.some(c => c.instanceId === bagEndOriginId)).toBe(false);
  });

  test('without Mallorn, a tapped Bag End (site of origin) is discarded instead', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const lorienSite = built.players[0].siteDeck.find(c => c.definitionId === LORIEN)!;
    const bagEndOriginId = company.currentSite!.instanceId;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: {
              instanceId: lorienSite.instanceId,
              definitionId: lorienSite.definitionId,
              status: CardStatus.Untapped,
            },
            siteOfOrigin: bagEndOriginId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ] as GameState['players'],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    expect(p1.siteDiscardPile.some(c => c.instanceId === bagEndOriginId)).toBe(true);
    expect(p1.siteDeck.some(c => c.instanceId === bagEndOriginId)).toBe(false);
  });

  // ─── Mallorn persists even once Bag End is unoccupied ─────────────────

  test('Mallorn (and its constraints) persist once no company occupies Bag End', () => {
    let state: GameState = buildSitePhaseState({ site: BAG_END, characters: [ARAGORN], hand: [MALLORN] });
    state = addStoredCard(state, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD, BAG_END).state;
    const mallornId = handCardId(state, RESOURCE_PLAYER);
    state = playPermanentEventAndResolve(state, PLAYER_1, mallornId, undefined, {
      targetSiteDefinitionId: BAG_END,
    });
    const sourceId = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MALLORN)!.instanceId;
    expect(state.activeConstraints.filter(c => c.source === sourceId).length).toBeGreaterThan(0);

    // Company moves away — no company now occupies Bag End.
    const movedCompany = {
      ...state.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...state.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: LORIEN },
    };
    const moved: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], companies: [movedCompany] },
        state.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MALLORN)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MALLORN)).toBe(false);
    expect(swept.activeConstraints.filter(c => c.source === sourceId).length).toBeGreaterThan(0);
  });

  // ─── All Hobbit factions are worth +1 marshalling points ──────────────

  test('grants +1 MP to Hobbit factions while Mallorn is in play', () => {
    const withMallorn = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [], siteDeck: [LORIEN], cardsInPlay: [cip(MALLORN, 'm1'), cip(HOBBITS, 'h1')] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }],
          hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(withMallorn.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('without Mallorn in play, a Hobbit faction gives only its printed MP', () => {
    const noMallorn = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [], siteDeck: [LORIEN], cardsInPlay: [cip(HOBBITS, 'h1')] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }],
          hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(noMallorn.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });
});

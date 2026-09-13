/**
 * @module tw-301.test
 *
 * Card test: Palantír of Osgiliath (tw-301)
 * Type: hero-resource-item (greater), alignment wizard, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * "Unique. Palantír. If the bearer's company is ever below 4 characters and
 *  the company moves, discard. 5 marshalling pts. if stored in a Haven [{H}].
 *  With its bearer able to use a Palantír, tap Palantír of Osgiliath to force
 *  the discard of any hazard permanent-event or to duplicate the effect of
 *  any Palantír in play. Bearer makes a corruption check."
 *
 * CRF 22 ruling: "Only copies tapping effects of other Palantíri, not
 * continuous effects."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                                               |
 * |---|----------------------------------------------------|---------------------------------------------------------------------------|
 * | 1 | Discard if company <4 chars and moves              | on-event bearer-company-moves, when company.characterCount $lt 4          |
 * | 2 | 5 MP if stored in a Haven                          | storable-at siteTypes ["haven"], marshallingPoints 5                      |
 * | 3 | Tap: force discard of any hazard permanent-event   | grant-action osgiliath-discard-hazard-permanent-event, targets.scope "opponent-cards-in-play" filtered to hazard-event/permanent, discard-target-in-play |
 * | 4 | Tap: duplicate Amon Sûl's ability (peek hand)      | grant-action osgiliath-duplicate-amon-sul, when Amon Sûl in play → reveal-opponent-hand |
 * | 5 | Tap: duplicate Annúminas' ability (sage-only fetch)| grant-action osgiliath-duplicate-annuminas, when Annúminas in play → enqueue-pending-fetch filter keywords sage-only |
 * | 6 | Tap: duplicate Elostirion's ability (remove corr.) | grant-action osgiliath-duplicate-elostirion, when Elostirion in play + bearer sage → own-hazard-corruption-cards + discard-target-corruption-card |
 * | 7 | Tap: duplicate Orthanc's ability (discard fetch)   | grant-action osgiliath-duplicate-orthanc, when Orthanc in play + playDeckSize >= 5 → enqueue-pending-fetch from discard-pile to deck |
 * | 8 | Tap: duplicate Minas Tirith's ability (shuffle top)| grant-action osgiliath-duplicate-minas-tirith, when Minas Tirith in play → shuffle-deck-top own + opponent |
 * | - | Bearer makes a corruption check (every mode)       | enqueue-corruption-check / postCorruptionCheck in every mode's apply      |
 *
 * All five "duplicate" abilities (4-8) are modeled as sibling `grant-action`s
 * on Osgiliath itself — the same precedent Palantír of Amon Sûl (tw-296) set
 * for its two borrowed abilities — rather than a generic lookup into the
 * other Palantírs' own `effects`. Each borrowed ability's own extra
 * requirement (Elostirion's "bearer is a sage", Orthanc's "5+ cards in play
 * deck") is evaluated against Osgiliath's own bearer/player, since "with its
 * bearer able to use a Palantír" already scopes the whole ability to
 * Osgiliath's bearer before the borrowing clause. Osgiliath's own tap cost
 * makes every mode mutually exclusive (only one grant-action can fire before
 * the item is tapped), so no shared-action-name / oncePerTurn lock is needed.
 *
 * Fixtures: Saruman (tw-181, Wizard/sage, native `can-use-palantir`) bears
 * Osgiliath throughout. Legolas (tw-168, Elf) is a company-mate used for the
 * Elostirion-duplicate's "an Elf or a Wizard" target filter. Bane of the
 * Ithil-stone (tw-13, hazard-event/permanent, no character binding) is placed
 * in the opponent's bare `cardsInPlay` for the discard-hazard-permanent-event
 * mode.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus,
  CardDefinitionId,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId, attachHazardToChar,
  ARAGORN, LEGOLAS, SARUMAN, RIVENDELL, MORIA, MINAS_TIRITH, LORIEN,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState, StoreItemAction, CardInPlay, CardInstanceId } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const OSGILIATH = 'tw-301' as CardDefinitionId;
const AMON_SUL = 'tw-296' as CardDefinitionId;
const ANNUMINAS = 'tw-297' as CardDefinitionId;
const ELOSTIRION = 'tw-298' as CardDefinitionId;
const ORTHANC = 'tw-300' as CardDefinitionId;
const PAL_MINAS_TIRITH = 'tw-299' as CardDefinitionId;
const FAR_SIGHT = 'tw-238' as CardDefinitionId;       // "Sage only" resource event
const RINGLORE = 'tw-318' as CardDefinitionId;        // "Sage only" resource event
const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId; // hazard-event, keywords: ["corruption"]
const BANE_OF_ITHIL_STONE = 'tw-13' as CardDefinitionId;  // hazard-event, eventType "permanent", bare in cardsInPlay

const OPPONENT_BANE_INSTANCE = 'p2-bane' as CardInstanceId;
const OPPONENT_BANE: CardInPlay = {
  instanceId: OPPONENT_BANE_INSTANCE,
  definitionId: BANE_OF_ITHIL_STONE,
  status: CardStatus.Untapped,
};

/** Hero organization-phase state; PLAYER_1's company bears Osgiliath. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  bearerItems?: CardDefinitionId[];
  companyMates?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  site?: CardDefinitionId;
  opponentCardsInPlay?: CardInPlay[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: opts.site ?? MORIA,
          characters: [
            { defId: opts.bearer ?? SARUMAN, items: opts.bearerItems ?? [OSGILIATH] },
            ...(opts.companyMates ?? []).map(defId => ({ defId })),
          ],
        }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: opts.playDeck ?? makePlayDeck(),
        discardPile: opts.discardPile ?? [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: ['tw-347' as CardDefinitionId],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
        cardsInPlay: opts.opponentCardsInPlay ?? [],
      },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Palantír of Osgiliath (tw-301)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: discard if the bearer's company is below 4 characters and moves ──

  test('discarded when the bearer\'s company (3 chars) moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: SARUMAN, items: [OSGILIATH] }, LEGOLAS, ARAGORN] }],
          hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const dest = base.players[0].siteDeck[0];
    const withDest: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };

    const sarumanId = findCharInstanceId(withDest, RESOURCE_PLAYER, SARUMAN);
    expect(withDest.players[0].characters[sarumanId].items.length).toBe(1);

    const afterMove = dispatch(dispatch(withDest, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterMove.players[0].characters[sarumanId].items.some(i => i.definitionId === OSGILIATH)).toBe(false);
    expect(afterMove.players[0].discardPile.some(c => c.definitionId === OSGILIATH)).toBe(true);
  });

  test('NOT discarded when the company has 4+ characters and moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: SARUMAN, items: [OSGILIATH] }, LEGOLAS, ARAGORN, LEGOLAS],
          }],
          hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const dest = base.players[0].siteDeck[0];
    const withDest: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
    const sarumanId = findCharInstanceId(withDest, RESOURCE_PLAYER, SARUMAN);

    const afterMove = dispatch(dispatch(withDest, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterMove.players[0].characters[sarumanId].items.some(i => i.definitionId === OSGILIATH)).toBe(true);
  });

  // ── Effect 2: storable-at Haven, 5 MP ──

  test('store-item action is available at a Haven (Rivendell)', () => {
    const state = buildOrgState({ site: RIVENDELL });

    const stores = viableActions(state, PLAYER_1, 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(stores.length).toBe(1);
  });

  test('store-item action is NOT available at a free-hold (Minas Tirith)', () => {
    const state = buildOrgState({ site: MINAS_TIRITH });

    const stores = viableActions(state, PLAYER_1, 'store-item');
    expect(stores.length).toBe(0);
  });

  test('storing at a Haven scores 5 MP (override), vs 3 MP borne on a character', () => {
    const stateRecomputed = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: SARUMAN, items: [OSGILIATH] }] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(stateRecomputed.players[0].marshallingPoints.item).toBe(3);

    const stores = viableActions(stateRecomputed, PLAYER_1, 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(stores.length).toBe(1);
    const afterStore = dispatch(stateRecomputed, stores[0]);
    expect(afterStore.players[0].marshallingPoints.item).toBe(5);
  });

  // ── Effect 3: tap to force the discard of any hazard permanent-event ──

  test('discard-hazard-permanent-event grant-action requires a matching card in the opponent\'s play AND the bearer to use a Palantír', () => {
    const noTarget = buildOrgState({});
    expect(grantActions(noTarget, 'osgiliath-discard-hazard-permanent-event').length).toBe(0);

    const withTarget = buildOrgState({ opponentCardsInPlay: [OPPONENT_BANE] });
    expect(grantActions(withTarget, 'osgiliath-discard-hazard-permanent-event').length).toBe(1);

    const cannotUsePalantir = buildOrgState({ bearer: ARAGORN, opponentCardsInPlay: [OPPONENT_BANE] });
    expect(grantActions(cannotUsePalantir, 'osgiliath-discard-hazard-permanent-event').length).toBe(0);
  });

  test('activating discards the opponent\'s hazard permanent-event and enqueues a corruption check', () => {
    const state = buildOrgState({ opponentCardsInPlay: [OPPONENT_BANE] });
    const action = grantActions(state, 'osgiliath-discard-hazard-permanent-event')[0];
    expect(action.targetCardId).toBe(OPPONENT_BANE_INSTANCE);

    const after = dispatch(state, action);

    expect(after.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === OPPONENT_BANE_INSTANCE)).toBe(true);

    const sarumanId = findCharInstanceId(after, RESOURCE_PLAYER, SARUMAN);
    expect(after.players[0].characters[sarumanId].items.find(i => i.definitionId === OSGILIATH)?.status).toBe(CardStatus.Tapped);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 4: tap to duplicate Amon Sûl's ability (look at opponent's hand) ──

  test('duplicate-Amon-Sûl grant-action requires Amon Sûl in play', () => {
    const withoutAmonSul = buildOrgState({});
    expect(grantActions(withoutAmonSul, 'osgiliath-duplicate-amon-sul').length).toBe(0);

    const withAmonSul = buildOrgState({ bearerItems: [OSGILIATH, AMON_SUL] });
    expect(grantActions(withAmonSul, 'osgiliath-duplicate-amon-sul').length).toBe(1);
  });

  test('activating duplicate-Amon-Sûl reveals the whole opponent hand and enqueues a corruption check', () => {
    const state = buildOrgState({ bearerItems: [OSGILIATH, AMON_SUL] });
    const oppHand = state.players[1].hand;
    expect(oppHand.length).toBeGreaterThan(0);

    const action = grantActions(state, 'osgiliath-duplicate-amon-sul')[0];
    const after = dispatch(state, action);

    for (const c of oppHand) {
      expect(after.revealedInstances[c.instanceId]).toBeDefined();
    }
    expect(after.players[1].hand.length).toBe(oppHand.length);

    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 5: tap to duplicate Annúminas' ability (sage-only fetch) ──

  test('duplicate-Annúminas grant-action requires Annúminas in play', () => {
    const withoutAnnuminas = buildOrgState({});
    expect(grantActions(withoutAnnuminas, 'osgiliath-duplicate-annuminas').length).toBe(0);

    const withAnnuminas = buildOrgState({ bearerItems: [OSGILIATH, ANNUMINAS] });
    expect(grantActions(withAnnuminas, 'osgiliath-duplicate-annuminas').length).toBe(1);
  });

  test('activating duplicate-Annúminas offers only "sage only" cards, moves choice to hand, enqueues a corruption check', () => {
    const state = buildOrgState({
      bearerItems: [OSGILIATH, ANNUMINAS],
      playDeck: [FAR_SIGHT, ARAGORN],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'osgiliath-duplicate-annuminas')[0];
    const afterActivation = dispatch(state, action);

    expect(afterActivation.pendingEffects.length).toBe(1);
    expect(afterActivation.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    // Only the two "Sage only" cards qualify.
    expect(fetchActions.length).toBe(2);

    const pickRinglore = fetchActions.find(ea => {
      const a = ea.action as { cardInstanceId: string };
      const card = [...afterActivation.players[0].playDeck, ...afterActivation.players[0].discardPile]
        .find(c => c.instanceId === a.cardInstanceId);
      return card?.definitionId === RINGLORE;
    })!;
    const afterFetch = dispatch(afterActivation, pickRinglore.action);

    expect(afterFetch.players[0].hand.some(c => c.definitionId === RINGLORE)).toBe(true);
    expect(afterFetch.pendingEffects.length).toBe(0);
    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 6: tap to duplicate Elostirion's ability (remove corruption) ──

  test('duplicate-Elostirion grant-action requires Elostirion in play, the bearer to be a sage, AND an eligible corruption card', () => {
    const noElostirion = buildOrgState({ companyMates: [LEGOLAS] });
    expect(grantActions(noElostirion, 'osgiliath-duplicate-elostirion').length).toBe(0);

    const withElostirionNoCorruption = buildOrgState({ bearerItems: [OSGILIATH, ELOSTIRION], companyMates: [LEGOLAS] });
    expect(grantActions(withElostirionNoCorruption, 'osgiliath-duplicate-elostirion').length).toBe(0);

    const withCorruptionOnLegolas = attachHazardToChar(
      buildOrgState({ bearerItems: [OSGILIATH, ELOSTIRION], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(withCorruptionOnLegolas, 'osgiliath-duplicate-elostirion').length).toBe(1);
  });

  test('duplicate-Elostirion grant-action NOT available when the bearer is not a sage', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearer: ARAGORN, bearerItems: [OSGILIATH, ELOSTIRION], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'osgiliath-duplicate-elostirion').length).toBe(0);
  });

  test('activating duplicate-Elostirion discards the chosen corruption card to its owner\'s pile and enqueues a corruption check', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearerItems: [OSGILIATH, ELOSTIRION], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const corruptionInstId = state.players[0].characters[legolasId].hazards[0].instanceId;

    const action = grantActions(state, 'osgiliath-duplicate-elostirion')[0];
    expect(action.targetCardId).toBe(corruptionInstId);

    const after = dispatch(state, action);

    expect(after.players[0].characters[legolasId].hazards.length).toBe(0);
    expect(after.players[1].discardPile.some(c => c.instanceId === corruptionInstId)).toBe(true);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 7: tap to duplicate Orthanc's ability (discard-pile fetch) ──

  test('duplicate-Orthanc grant-action requires Orthanc in play AND at least 5 cards in the play deck', () => {
    const withoutOrthanc = buildOrgState({});
    expect(grantActions(withoutOrthanc, 'osgiliath-duplicate-orthanc').length).toBe(0);

    const withOrthancSmallDeck = buildOrgState({
      bearerItems: [OSGILIATH, ORTHANC],
      playDeck: [MORIA, MORIA, MORIA] as CardDefinitionId[],
    });
    expect(grantActions(withOrthancSmallDeck, 'osgiliath-duplicate-orthanc').length).toBe(0);

    const withOrthancFullDeck = buildOrgState({ bearerItems: [OSGILIATH, ORTHANC] });
    expect(grantActions(withOrthancFullDeck, 'osgiliath-duplicate-orthanc').length).toBe(1);
  });

  test('activating duplicate-Orthanc offers cards from the discard pile, moves choice to the play deck, enqueues a corruption check', () => {
    const state = buildOrgState({
      bearerItems: [OSGILIATH, ORTHANC],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'osgiliath-duplicate-orthanc')[0];
    const afterActivation = dispatch(state, action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions.length).toBe(1);
    expect((fetchActions[0].action as { source: string }).source).toBe('discard-pile');

    const after = dispatch(afterActivation, fetchActions[0].action);
    expect(after.players[0].discardPile.some(c => c.definitionId === RINGLORE)).toBe(false);
    expect(after.players[0].playDeck.some(c => c.definitionId === RINGLORE)).toBe(true);
    expect(after.players[0].hand.some(c => c.definitionId === RINGLORE)).toBe(false);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 8: tap to duplicate Minas Tirith's ability (shuffle top 5 of both decks) ──

  test('duplicate-Minas-Tirith grant-action requires Palantír of Minas Tirith in play', () => {
    const withoutIt = buildOrgState({});
    expect(grantActions(withoutIt, 'osgiliath-duplicate-minas-tirith').length).toBe(0);

    const withIt = buildOrgState({ bearerItems: [OSGILIATH, PAL_MINAS_TIRITH] });
    expect(grantActions(withIt, 'osgiliath-duplicate-minas-tirith').length).toBe(1);
  });

  test('activating duplicate-Minas-Tirith shuffles the top 5 of both play decks (same cards, unchanged length) and enqueues a corruption check', () => {
    const deckCards = [ARAGORN, LEGOLAS, MORIA, RIVENDELL, MINAS_TIRITH, ARAGORN, LEGOLAS] as CardDefinitionId[];
    const state = buildOrgState({ bearerItems: [OSGILIATH, PAL_MINAS_TIRITH], playDeck: deckCards });
    const ownDeckBefore = state.players[RESOURCE_PLAYER].playDeck;
    const oppDeckBefore = state.players[HAZARD_PLAYER].playDeck;

    const action = grantActions(state, 'osgiliath-duplicate-minas-tirith')[0];
    const after = dispatch(state, action);

    const ownDeckAfter = after.players[RESOURCE_PLAYER].playDeck;
    expect(ownDeckAfter).toHaveLength(ownDeckBefore.length);
    expect(ownDeckAfter.slice(0, 5).map(c => c.definitionId).sort())
      .toEqual(ownDeckBefore.slice(0, 5).map(c => c.definitionId).sort());
    expect(ownDeckAfter.slice(5).map(c => c.definitionId))
      .toEqual(ownDeckBefore.slice(5).map(c => c.definitionId));

    const oppDeckAfter = after.players[HAZARD_PLAYER].playDeck;
    expect(oppDeckAfter).toHaveLength(oppDeckBefore.length);
    expect(oppDeckAfter.slice(0, 5).map(c => c.definitionId).sort())
      .toEqual(oppDeckBefore.slice(0, 5).map(c => c.definitionId).sort());

    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});

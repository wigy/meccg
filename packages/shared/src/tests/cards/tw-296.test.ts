/**
 * @module tw-296.test
 *
 * Card test: Palantír of Amon Sûl (tw-296)
 * Type: hero-resource-item (greater), alignment wizard, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * "Unique. Palantír. If the bearer's company is ever below 2 characters and
 *  the company moves, discard the Palantír. 5 marshalling points if stored
 *  in a Haven [{H}]. With its bearer able to use a Palantír, tap Palantír of
 *  Amon Sûl to look at your opponent's hand or tap it to use the abilities
 *  of either the Palantír of Annúminas or the Palantír of Elostirion if
 *  either one is in play. Bearer makes a corruption check."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                                              |
 * |---|----------------------------------------------------|------------------------------------------------------------------------|
 * | 1 | Discard if company <2 chars and moves             | on-event bearer-company-moves, when company.characterCount $lt 2        |
 * | 2 | 5 MP if stored in a Haven                         | storable-at siteTypes ["haven"], marshallingPoints 5                   |
 * | 3 | Tap: look at opponent's hand                      | grant-action amon-sul-peek-hand → reveal-opponent-hand + corruption check |
 * | 4 | Tap: use Annúminas' ability (sage-only fetch)     | grant-action amon-sul-use-annuminas, when Annúminas in play → enqueue-pending-fetch filter keywords sage-only |
 * | 5 | Tap: use Elostirion's ability (remove corruption) | grant-action amon-sul-use-elostirion, when Elostirion in play + bearer sage → own-hazard-corruption-cards target + discard-target-corruption-card |
 *
 * Both borrowed abilities (4/5) are modeled as sibling `grant-action`s on
 * Amon Sûl itself rather than a lookup into Palantír of Annúminas' (tw-297)
 * or Palantír of Elostirion's (tw-298) own `effects` — those two cards are
 * not yet certified. Elostirion's extra requirement ("if the bearer is a
 * sage") is evaluated against Amon Sûl's own bearer, since "with its bearer
 * able to use a Palantír" already scopes the whole ability to Amon Sûl's
 * bearer before the borrowing clause.
 *
 * Fixtures: Saruman (tw-181, Wizard/sage, native `can-use-palantir`) bears
 * Amon Sûl throughout. Legolas (tw-168, Elf) and Aragorn II (tw-120,
 * Dúnadan) are company-mates used to test the "an Elf or a Wizard" target
 * filter on the borrowed Elostirion ability. Align Palantír (tw-190, a
 * `can-use-palantir` play-flag carrier) is attached directly to a non-sage
 * bearer to prove the sage gate is independent of the Palantír-use gate.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus,
  CardDefinitionId,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId, attachHazardToChar,
  ARAGORN, LEGOLAS, SARUMAN, RIVENDELL, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState, StoreItemAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const AMON_SUL = 'tw-296' as CardDefinitionId;
const ANNUMINAS = 'tw-297' as CardDefinitionId;
const ELOSTIRION = 'tw-298' as CardDefinitionId;
const ALIGN_PALANTIR = 'tw-190' as CardDefinitionId; // grants can-use-palantir, no sage requirement of its own
const FAR_SIGHT = 'tw-238' as CardDefinitionId;       // "Sage only" resource event
const RINGLORE = 'tw-318' as CardDefinitionId;        // "Sage only" resource event
const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId; // hazard-event, keywords: ["corruption"]
const LORIEN = 'tw-408' as CardDefinitionId;

/** Hero organization-phase state; PLAYER_1's company bears Amon Sûl. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  bearerItems?: CardDefinitionId[];
  companyMates?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  site?: CardDefinitionId;
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
            { defId: opts.bearer ?? SARUMAN, items: opts.bearerItems ?? [AMON_SUL] },
            ...(opts.companyMates ?? []).map(defId => ({ defId })),
          ],
        }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: opts.playDeck ?? makePlayDeck(),
        discardPile: opts.discardPile ?? [],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: ['tw-347' as CardDefinitionId], siteDeck: [MORIA] },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Palantír of Amon Sûl (tw-296)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: discard if the bearer's company is below 2 characters and moves ──

  test('discarded when a lone bearer moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: SARUMAN, items: [AMON_SUL] }] }], hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck() },
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

    expect(afterMove.players[0].characters[sarumanId].items.some(i => i.definitionId === AMON_SUL)).toBe(false);
    expect(afterMove.players[0].discardPile.some(c => c.definitionId === AMON_SUL)).toBe(true);
  });

  test('NOT discarded when the company has 2+ characters and moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: SARUMAN, items: [AMON_SUL] }, { defId: LEGOLAS }] }],
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

    expect(afterMove.players[0].characters[sarumanId].items.some(i => i.definitionId === AMON_SUL)).toBe(true);
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: SARUMAN, items: [AMON_SUL] }] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
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

  // ── Effect 3: tap to look at the opponent's hand ──

  test('peek-hand grant-action is available when the bearer can use a Palantír', () => {
    const state = buildOrgState({});
    expect(grantActions(state, 'amon-sul-peek-hand').length).toBe(1);
  });

  test('peek-hand grant-action is NOT available when the bearer cannot use a Palantír', () => {
    const state = buildOrgState({ bearer: ARAGORN });
    expect(grantActions(state, 'amon-sul-peek-hand').length).toBe(0);
  });

  test('activating peek-hand reveals the whole opponent hand and enqueues a corruption check', () => {
    const state = buildOrgState({});
    const oppHand = state.players[1].hand;
    expect(oppHand.length).toBeGreaterThan(0);

    const action = grantActions(state, 'amon-sul-peek-hand')[0];
    const after = dispatch(state, action);

    for (const c of oppHand) {
      expect(after.revealedInstances[c.instanceId]).toBeDefined();
    }
    // The cards never left the opponent's hand.
    expect(after.players[1].hand.length).toBe(oppHand.length);

    const sarumanId = findCharInstanceId(after, RESOURCE_PLAYER, SARUMAN);
    expect(after.players[0].characters[sarumanId].items[0].status).toBe(CardStatus.Tapped);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 4: tap to use Annúminas' ability (borrowed) ──

  test('use-Annúminas grant-action requires Annúminas to be in play', () => {
    const withoutAnnuminas = buildOrgState({});
    expect(grantActions(withoutAnnuminas, 'amon-sul-use-annuminas').length).toBe(0);

    const withAnnuminas = buildOrgState({ bearerItems: [AMON_SUL, ANNUMINAS] });
    expect(grantActions(withAnnuminas, 'amon-sul-use-annuminas').length).toBe(1);
  });

  test('use-Annúminas grant-action NOT available when the bearer cannot use a Palantír', () => {
    // Aragorn bears both Palantírs but has no way to use either.
    const state = buildOrgState({ bearer: ARAGORN, bearerItems: [AMON_SUL, ANNUMINAS] });
    expect(grantActions(state, 'amon-sul-use-annuminas').length).toBe(0);
  });

  test('activating use-Annúminas offers only "sage only" cards from the play deck and discard pile', () => {
    const state = buildOrgState({
      bearerItems: [AMON_SUL, ANNUMINAS],
      playDeck: [FAR_SIGHT, ARAGORN],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'amon-sul-use-annuminas')[0];
    expect(action).toBeDefined();
    const afterActivation = dispatch(state, action);

    expect(afterActivation.pendingEffects.length).toBe(1);
    expect(afterActivation.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    // Only the two "Sage only" cards qualify — Aragorn (a character card in
    // the deck) does not carry the sage-only keyword.
    expect(fetchActions.length).toBe(2);
  });

  test('fetching moves the chosen card to hand, reshuffles the play deck, and enqueues a corruption check', () => {
    const state = buildOrgState({
      bearerItems: [AMON_SUL, ANNUMINAS],
      playDeck: [FAR_SIGHT],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'amon-sul-use-annuminas')[0];
    const afterActivation = dispatch(state, action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const pickRinglore = fetchActions.find(ea => {
      const a = ea.action as { cardInstanceId: string };
      const card = [...afterActivation.players[0].playDeck, ...afterActivation.players[0].discardPile]
        .find(c => c.instanceId === a.cardInstanceId);
      return card?.definitionId === RINGLORE;
    })!;
    expect(pickRinglore).toBeDefined();

    const afterFetch = dispatch(afterActivation, pickRinglore.action);

    expect(afterFetch.players[0].hand.some(c => c.definitionId === RINGLORE)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === RINGLORE)).toBe(false);
    expect(afterFetch.pendingEffects.length).toBe(0);

    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 5: tap to use Elostirion's ability (borrowed) ──

  test('use-Elostirion grant-action requires Elostirion in play, the bearer to be a sage, AND an eligible corruption card', () => {
    const noElostirion = buildOrgState({ companyMates: [LEGOLAS] });
    expect(grantActions(noElostirion, 'amon-sul-use-elostirion').length).toBe(0);

    const withElostirionNoCorruption = buildOrgState({ bearerItems: [AMON_SUL, ELOSTIRION], companyMates: [LEGOLAS] });
    expect(grantActions(withElostirionNoCorruption, 'amon-sul-use-elostirion').length).toBe(0);

    const withCorruptionOnLegolas = attachHazardToChar(
      buildOrgState({ bearerItems: [AMON_SUL, ELOSTIRION], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(withCorruptionOnLegolas, 'amon-sul-use-elostirion').length).toBe(1);
  });

  test('use-Elostirion grant-action NOT available when the bearer is not a sage (even if he can use a Palantír)', () => {
    // Align Palantír grants can-use-palantir with no sage requirement of its
    // own; Aragorn (not a sage) bears it plus both Palantírs.
    const state = attachHazardToChar(
      buildOrgState({ bearer: ARAGORN, bearerItems: [AMON_SUL, ELOSTIRION, ALIGN_PALANTIR], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    // canUsePalantir is satisfied (Align Palantír), but the sage gate fails.
    expect(grantActions(state, 'amon-sul-peek-hand').length).toBe(1);
    expect(grantActions(state, 'amon-sul-use-elostirion').length).toBe(0);
  });

  test('target filter: a corruption card on a non-Elf, non-Wizard company-mate is NOT offered', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearerItems: [AMON_SUL, ELOSTIRION], companyMates: [ARAGORN] }),
      RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'amon-sul-use-elostirion').length).toBe(0);
  });

  test('target filter: a corruption card on the Wizard bearer himself is offered', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearerItems: [AMON_SUL, ELOSTIRION] }),
      RESOURCE_PLAYER, SARUMAN, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'amon-sul-use-elostirion').length).toBe(1);
  });

  test('activating use-Elostirion discards the chosen corruption card to its owner\'s pile and enqueues a corruption check', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearerItems: [AMON_SUL, ELOSTIRION], companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const corruptionInstId = state.players[0].characters[legolasId].hazards[0].instanceId;

    const action = grantActions(state, 'amon-sul-use-elostirion')[0];
    expect(action.targetCardId).toBe(corruptionInstId);

    const after = dispatch(state, action);

    expect(after.players[0].characters[legolasId].hazards.length).toBe(0);
    // Corruption cards are owned by the opponent (hazard player).
    expect(after.players[1].discardPile.some(c => c.instanceId === corruptionInstId)).toBe(true);

    const sarumanId = findCharInstanceId(after, RESOURCE_PLAYER, SARUMAN);
    expect(after.players[0].characters[sarumanId].items.find(i => i.definitionId === AMON_SUL)?.status).toBe(CardStatus.Tapped);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});

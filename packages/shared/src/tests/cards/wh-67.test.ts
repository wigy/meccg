/**
 * @module wh-67.test — Earth-eater (Fallen-wizard Stage resource)
 *
 * Earth-eater is a Stage-alignment permanent-event worth 1 miscellaneous
 * marshalling point (authoritative DB `data/cards.json`, WH-67).
 *
 * Card text:
 *   "Technology. Playable during the site phase if one of your companies
 *    enters the Deep Mines site and you have more Delver's Harvest cards in
 *    play than you have Earth-eater cards. Tap Earth-eater to take a minion
 *    non-unique weapon/armor/shield/helmet major item from your sideboard or
 *    discard pile to your hand."
 *
 * Modeling (see `docs/card-effects-dsl.md`):
 *   - Same site-phase timing exception as Delver's Harvest (wh-65): a
 *     `play-condition` `requires: 'active-company'` gated on the active
 *     company's current site being "Deep Mines".
 *   - The "more Delver's Harvest than Earth-eater" clause is a new
 *     `play-condition` `requires: 'card-count-exceeds'` (`cardName`:
 *     "Delver's Harvest", `comparedToCardName`: "Earth-eater"), evaluated via
 *     `countPlayerHeldCopies` in `legal-actions/site.ts`.
 *   - The tap ability is a bearer-less `grant-action` (`cost: { tap: "self"
 *     }`, `apply: "enqueue-pending-fetch"`), offered by the newly generalized
 *     `bareCardGrantActions` (`legal-actions/organization.ts`, formerly
 *     faction-only) and resolved by `handleInPlayCardGrantAction`
 *     (`grant-action-apply.ts`), which gained `enqueue-pending-fetch` support
 *     for bearer-less sources.
 *
 * | # | Rule                                                              | Status |
 * |---|--------------------------------------------------------------------|--------|
 * | 1 | playable in the site phase when the company is at Deep Mines       | OK     |
 * | 2 | not playable at any other site                                     | OK     |
 * | 3 | not playable during the organization phase (5.F1 timing)          | OK     |
 * | 4 | requires more Delver's Harvest in play than Earth-eater             | OK     |
 * | 5 | on play it enters play and scores 1 miscellaneous MP               | OK     |
 * | 6 | tap grant-action offered only while untapped                       | OK     |
 * | 7 | activation taps it and fetches a matching item to hand             | OK     |
 * | 8 | fetch filter excludes unique / non-major / non-matching items      | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  resetMint,
  mint,
  viableActions,
  findHandCardId,
  buildFallenWizardSitePhaseState,
  buildFallenWizardOrgPhaseState,
  playPermanentEventAndResolve,
  addP1CardsInPlay,
  recomputeDerived,
  dispatch,
} from '../test-helpers.js';
import { computeLegalActions, CardStatus } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId, CardInstance, GameState } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──
const EARTH_EATER = 'wh-67' as CardDefinitionId;
const DELVERS_HARVEST = 'wh-65' as CardDefinitionId;
const DEEP_MINES = 'wh-55' as CardDefinitionId;        // Fallen-wizard R&L site
const ISENGARD = 'wh-56' as CardDefinitionId;          // Fallen-wizard Wizardhaven
const SARUMAN_FW = 'wh-9' as CardDefinitionId;         // Fallen-wizard avatar
const BROAD_HEADED_SPEAR = 'le-304' as CardDefinitionId; // minion, major, weapon, non-unique
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // minion, major, shield, UNIQUE
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;  // minion, MINOR, shield, non-unique

/** A CardInPlay entry for a bare (uncompany-bound) permanent event. */
function bareCardInPlay(definitionId: CardDefinitionId, status: CardStatus = CardStatus.Untapped) {
  return { instanceId: mint(), definitionId, status };
}

describe('Earth-eater (wh-67)', () => {
  beforeEach(() => resetMint());

  // --- Rule 1/2: playable in the site phase only at Deep Mines --------------

  test('offered during the site phase at Deep Mines when Delver\'s Harvest outnumbers Earth-eater', () => {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    s = addP1CardsInPlay(s, [bareCardInPlay(DELVERS_HARVEST)]);

    const actions = viableActions(s, PLAYER_1, 'play-permanent-event');
    const earthEaterId = findHandCardId(s, RESOURCE_PLAYER, EARTH_EATER);
    const offeredIds = actions.map(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId);
    expect(offeredIds).toContain(earthEaterId);
  });

  test('not offered during the site phase at a site other than Deep Mines', () => {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: ISENGARD,
      hand: [EARTH_EATER],
    });
    s = addP1CardsInPlay(s, [bareCardInPlay(DELVERS_HARVEST)]);
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // --- Rule 3: site-phase timing — never offered in the organization phase --

  test('not offered during the organization phase (site-phase timing, 5.F1)', () => {
    let s = buildFallenWizardOrgPhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    s = addP1CardsInPlay(s, [bareCardInPlay(DELVERS_HARVEST)]);
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // --- Rule 4: requires more Delver's Harvest in play than Earth-eater ------

  test('not offered when no Delver\'s Harvest is in play (0 is not more than 0)', () => {
    const s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('not offered when Delver\'s Harvest and Earth-eater counts are equal', () => {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    s = addP1CardsInPlay(s, [bareCardInPlay(DELVERS_HARVEST), bareCardInPlay(EARTH_EATER)]);
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('offered once Delver\'s Harvest count exceeds Earth-eater count', () => {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    s = addP1CardsInPlay(s, [
      bareCardInPlay(DELVERS_HARVEST), bareCardInPlay(DELVERS_HARVEST), bareCardInPlay(EARTH_EATER),
    ]);
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  // --- Rule 5: on play it enters play and scores 1 miscellaneous MP ---------

  test('playing it at Deep Mines puts it in play and scores 1 miscellaneous MP', () => {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [EARTH_EATER],
    });
    s = recomputeDerived(addP1CardsInPlay(s, [bareCardInPlay(DELVERS_HARVEST)]));
    expect(s.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1); // Delver's Harvest already scores 1

    const earthEaterId = findHandCardId(s, RESOURCE_PLAYER, EARTH_EATER);
    const after = playPermanentEventAndResolve(s, PLAYER_1, earthEaterId);

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === EARTH_EATER);
    expect(inPlay).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === EARTH_EATER)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // --- Rule 6/7/8: tap grant-action fetches a matching item to hand ---------

  function seedInPlayWithPiles(status: CardStatus = CardStatus.Untapped): GameState {
    let s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [],
    });
    s = addP1CardsInPlay(s, [bareCardInPlay(EARTH_EATER, status)]);
    const discardCard: CardInstance = { instanceId: mint(), definitionId: BROAD_HEADED_SPEAR };
    const sideboardCard: CardInstance = { instanceId: mint(), definitionId: SABLE_SHIELD };
    const sideboardCard2: CardInstance = { instanceId: mint(), definitionId: BLACK_HIDE_SHIELD };
    const [p1, p2] = s.players;
    return {
      ...s,
      players: [
        { ...p1, discardPile: [...p1.discardPile, discardCard], sideboard: [...p1.sideboard, sideboardCard, sideboardCard2] },
        p2,
      ],
    };
  }

  test('fetch grant-action offered while Earth-eater is untapped', () => {
    const s = seedInPlayWithPiles();
    const actions = viableActions(s, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'earth-eater-fetch');
    expect(actions).toHaveLength(1);
  });

  test('fetch grant-action NOT offered while Earth-eater is tapped', () => {
    const s = seedInPlayWithPiles(CardStatus.Tapped);
    const actions = viableActions(s, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'earth-eater-fetch');
    expect(actions).toHaveLength(0);
  });

  test('activation taps Earth-eater and only offers non-unique major weapon/armor/shield/helmet items, to hand', () => {
    const s = seedInPlayWithPiles();
    const activate = viableActions(s, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'earth-eater-fetch')!;
    expect(activate).toBeDefined();
    const afterActivation = dispatch(s, activate.action);

    // Cost paid: Earth-eater itself is tapped (bearer-less source).
    const earthEaterCip = afterActivation.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === EARTH_EATER)!;
    expect(earthEaterCip.status).toBe(CardStatus.Tapped);

    // The pending fetch targets the hand from the discard pile and sideboard.
    expect(afterActivation.pendingEffects).toHaveLength(1);
    const effect = (afterActivation.pendingEffects[0] as { effect: { type: string; to?: string; source?: readonly string[] } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.source).toEqual(['discard-pile', 'sideboard']);

    // Only the non-unique major weapon (Broad-headed Spear) qualifies — the
    // unique major shield (Sable Shield) and the non-unique MINOR shield
    // (Black-hide Shield) are both excluded.
    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const spearInstance = afterActivation.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === BROAD_HEADED_SPEAR)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId)
      .toBe(spearInstance.instanceId as unknown as string);

    // Resolving the fetch brings the spear to hand (not the play deck).
    const afterFetch = dispatch(afterActivation, fetchActions[0].action);
    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === BROAD_HEADED_SPEAR)).toBe(true);
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === BROAD_HEADED_SPEAR)).toBe(false);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BROAD_HEADED_SPEAR)).toBe(false);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });
});

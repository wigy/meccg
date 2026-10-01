/**
 * @module dm-146.test
 *
 * Card test: Into the Smoking Cone (dm-146)
 * Type: hero-resource-event (permanent), alignment wizard, non-unique.
 * Marshalling points: 0 while in play, 6 miscellaneous once stored.
 *
 * Card text: "Playable on a company with a sage during the site phase at a
 * site where gold ring items are playable. Tap this card if the company plays
 * a ring special item; this card never untaps. If this card is tapped, the
 * company can discard (for no effect) a Lost Knowledge card it controls during
 * its site phase at Mount Doom and invert this card on the playing surface
 * (rotate it 180°). If inverted, you can store this card at a Haven [{H}]—only
 * if stored do you receive its marshalling points. If stored, all ring items
 * give one less corruption point. Once inverted, no other copy of this card
 * can be inverted."
 *
 * Effects & engine support:
 * | # | Rule                                                        | Mechanism                                                                  |
 * |---|-------------------------------------------------------------|----------------------------------------------------------------------------|
 * | 1 | Playable on a company with a sage, at a gold-ring site       | play-target company, filter `target.hasSage` + `target.playableResources`  |
 * | 2 | … during the site phase                                     | play-window phase site → offered by the play-resources step only           |
 * | 3 | Tap if the company plays a ring special item                | tap-on-company-item-play, itemFilter subtype special + keyword ring        |
 * | 4 | This card never untaps                                      | play-flag no-auto-untap                                                    |
 * | 5 | If tapped, discard a Lost Knowledge card at Mount Doom to   | grant-action, cost { invert: self, discardCompanyKeywordCard:              |
 * |   | invert this card                                            | "lost-knowledge" }, when site.name = Mount Doom                            |
 * | 6 | If inverted, storable at a Haven — only then 6 MP           | storable-at haven, requiresInverted, marshallingPoints 6                   |
 * | 7 | If stored, all ring items give one less corruption point    | in-play-item-modifier ring items -1 CP, activeWhileStored (floor 0)        |
 * | 8 | Once inverted, no other copy can be inverted                | grant-action singletonLock                                                 |
 *
 * Lost Knowledge cards: Forgotten Scrolls (dm-169), Lost Tome (dm-172) —
 * tagged with the `lost-knowledge` keyword.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, makePlayDeck,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  addCardInPlay, addStoredCard, attachItemToChar, addCardToHand,
  setInPlayCardStatus, inPlayCardStatus, getCharacter, isGrantedAction,
  companyIdAt, findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve, enqueueGoldRingTest,
  viableActions, dispatch, recomputeDerived,
  ARAGORN, ELROND, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  PRECIOUS_GOLD_RING, DAGGER_OF_WESTERNESSE,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayPermanentEventAction, ActivateGrantedAction, StoreItemAction,
} from '../../index.js';

const SMOKING_CONE = 'dm-146' as CardDefinitionId;
const SMOKING_CONE_NAME = 'Into the Smoking Cone';
const INVERT_ACTION = 'invert-into-the-smoking-cone';
const LOST_TOME = 'dm-172' as CardDefinitionId;             // Lost Knowledge
const FORGOTTEN_SCROLLS = 'dm-169' as CardDefinitionId;     // Lost Knowledge
const MAGIC_RING_OF_COURAGE = 'tw-271' as CardDefinitionId; // ring special item
const MAGIC_RING_OF_STEALTH = 'tw-274' as CardDefinitionId; // ring special item, 2 CP
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;           // minor + gold-ring
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;          // minor + major items, no gold-ring

describe('Into the Smoking Cone (dm-146)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1-2: playable on a company with a sage, site phase, gold-ring site ──

  test('playable during the site phase on a company with a sage at a gold-ring site', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ELROND], hand: [SMOKING_CONE] });
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    expect((plays[0].action as PlayPermanentEventAction).targetCompanyId).toBe(companyId);

    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, SMOKING_CONE), undefined, { targetCompanyId: companyId });
    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SMOKING_CONE);
    expect(card).toBeDefined();
    expect(card!.companyId).toBe(companyId);
    expect(card!.status).toBe(CardStatus.Untapped);
    // Not stored → no marshalling points.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('also playable at another gold-ring site (Bandit Lair)', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR, characters: [ELROND], hand: [SMOKING_CONE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });

  test('NOT playable when the company has no sage', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [SMOKING_CONE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable at a site where gold ring items are not playable', () => {
    const state = buildSitePhaseState({ site: BARROW_DOWNS, characters: [ELROND], hand: [SMOKING_CONE] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELROND] }], hand: [SMOKING_CONE], siteDeck: [RIVENDELL], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Rule 3: tap when the company plays a ring special item ────────────────

  test('playing a ring special item after a gold-ring test taps the card; declining does not', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, PRECIOUS_GOLD_RING);
    state = addCardToHand(state, RESOURCE_PLAYER, MAGIC_RING_OF_COURAGE);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(state, RESOURCE_PLAYER));
    const ringId = state.players[RESOURCE_PLAYER].characters[elrondId].items[0].instanceId;
    state = enqueueGoldRingTest(state, PLAYER_1, ringId, elrondId);

    const afterRoll = dispatch({ ...state, cheatRollTotal: 3 }, viableActions(state, PLAYER_1, 'gold-ring-test-roll')[0].action);
    expect(inPlayCardStatus(afterRoll, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Untapped);

    // Declining the replacement ring plays no ring special item.
    const declined = dispatch(afterRoll, { type: 'pass', player: PLAYER_1 });
    expect(inPlayCardStatus(declined, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Untapped);

    const playRing = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playRing).toHaveLength(1);
    const after = dispatch(afterRoll, playRing[0].action);
    expect(after.players[RESOURCE_PLAYER].characters[elrondId].items.some(i => i.definitionId === MAGIC_RING_OF_COURAGE)).toBe(true);
    expect(inPlayCardStatus(after, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Tapped);
  });

  test('playing a gold ring item (not a special ring) at the site does not tap the card', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [ELROND], hand: [PRECIOUS_GOLD_RING] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER));
    const ringId = findHandCardId(state, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .find(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === ringId);
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);
    expect(getCharacter(after, RESOURCE_PLAYER, ELROND).items.some(i => i.definitionId === PRECIOUS_GOLD_RING)).toBe(true);
    expect(inPlayCardStatus(after, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Untapped);
  });

  // ─── Rule 4: never untaps ──────────────────────────────────────────────────

  test('a tapped copy stays tapped through its controller untap phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const tapped = setInPlayCardStatus(
      addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER)),
      RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped,
    );
    const after = dispatch(tapped, { type: 'untap', player: PLAYER_1 });
    expect(inPlayCardStatus(after, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Tapped);
  });

  // ─── Rules 5 & 8: invert at Mount Doom by discarding a Lost Knowledge card ──

  test('a tapped copy at Mount Doom can be inverted by discarding a Lost Knowledge card', () => {
    let state: GameState = buildSitePhaseState({ site: MOUNT_DOOM, characters: [ELROND] });
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, LOST_TOME);
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, DAGGER_OF_WESTERNESSE);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(state, RESOURCE_PLAYER));
    state = setInPlayCardStatus(state, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);

    const offered = viableActions(state, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action));
    // Only the Lost Tome is a legal discard — the dagger is not Lost Knowledge.
    expect(offered).toHaveLength(1);
    const invert = offered[0].action as ActivateGrantedAction;
    const tomeId = getCharacter(state, RESOURCE_PLAYER, ELROND).items.find(i => i.definitionId === LOST_TOME)!.instanceId;
    expect(invert.targetCardId).toBe(tomeId);

    const after = dispatch(state, invert);
    expect(inPlayCardStatus(after, RESOURCE_PLAYER, SMOKING_CONE)).toBe(CardStatus.Inverted);
    const items = getCharacter(after, RESOURCE_PLAYER, ELROND).items;
    expect(items.some(i => i.instanceId === tomeId)).toBe(false);
    expect(items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === tomeId)).toBe(true);
    expect(after.singletonTapLocks).toContain(SMOKING_CONE_NAME);
    // Already inverted — not offered again.
    expect(viableActions(after, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(0);
  });

  test('one invert action per Lost Knowledge card the company controls', () => {
    let state: GameState = buildSitePhaseState({ site: MOUNT_DOOM, characters: [ELROND] });
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, LOST_TOME);
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, FORGOTTEN_SCROLLS);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(state, RESOURCE_PLAYER));
    state = setInPlayCardStatus(state, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);
    expect(viableActions(state, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(2);
  });

  test('NOT offered while the card is untapped, without a Lost Knowledge card, or away from Mount Doom', () => {
    let atDoom: GameState = buildSitePhaseState({ site: MOUNT_DOOM, characters: [ELROND] });
    atDoom = attachItemToChar(atDoom, RESOURCE_PLAYER, ELROND, LOST_TOME);
    atDoom = addCardInPlay(atDoom, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(atDoom, RESOURCE_PLAYER));
    // Untapped: the invert needs a tapped card.
    expect(viableActions(atDoom, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(0);
    // Tapped: offered.
    const tappedAtDoom = setInPlayCardStatus(atDoom, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);
    expect(viableActions(tappedAtDoom, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(1);

    // Tapped at Mount Doom, but only a non-Lost-Knowledge item.
    let noLore: GameState = buildSitePhaseState({ site: MOUNT_DOOM, characters: [ELROND] });
    noLore = attachItemToChar(noLore, RESOURCE_PLAYER, ELROND, DAGGER_OF_WESTERNESSE);
    noLore = addCardInPlay(noLore, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(noLore, RESOURCE_PLAYER));
    noLore = setInPlayCardStatus(noLore, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);
    expect(viableActions(noLore, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(0);

    // Tapped with a Lost Tome, but at Moria.
    let atMoria: GameState = buildSitePhaseState({ site: MORIA, characters: [ELROND] });
    atMoria = attachItemToChar(atMoria, RESOURCE_PLAYER, ELROND, LOST_TOME);
    atMoria = addCardInPlay(atMoria, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(atMoria, RESOURCE_PLAYER));
    atMoria = setInPlayCardStatus(atMoria, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);
    expect(viableActions(atMoria, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(0);
  });

  test('once one copy is inverted, no other copy can be inverted', () => {
    let state: GameState = buildSitePhaseState({ site: MOUNT_DOOM, characters: [ELROND] });
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, LOST_TOME);
    state = attachItemToChar(state, RESOURCE_PLAYER, ELROND, FORGOTTEN_SCROLLS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(addCardInPlay(state, RESOURCE_PLAYER, SMOKING_CONE, companyId), RESOURCE_PLAYER, SMOKING_CONE, companyId);
    state = setInPlayCardStatus(state, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped);
    const copies = state.players[RESOURCE_PLAYER].cardsInPlay.filter(c => c.definitionId === SMOKING_CONE);
    expect(copies).toHaveLength(2);
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))
      .map(ea => ea.action as ActivateGrantedAction);
    // Both copies × both Lost Knowledge cards.
    expect(offered).toHaveLength(4);

    const first = offered.find(a => a.sourceCardId === copies[0].instanceId)!;
    const after = dispatch(state, first);
    const second = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === copies[1].instanceId);
    expect(second?.status).toBe(CardStatus.Tapped);
    // The second copy is still tapped and a Lost Knowledge card remains, but the lock forbids it.
    expect(viableActions(after, PLAYER_1, 'activate-granted-action').filter(ea => isGrantedAction(INVERT_ACTION)(ea.action))).toHaveLength(0);
    // The reducer refuses a stale action for the other copy too.
    const stale = offered.find(a => a.sourceCardId === copies[1].instanceId && a.targetCardId !== first.targetCardId)!;
    expect(() => dispatch(after, stale)).toThrow();
  });

  // ─── Rule 6: storable at a Haven only once inverted; MP only when stored ────

  test('an untapped or merely tapped copy at a Haven is NOT storable and scores nothing', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const untapped = addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER));
    const tapped = recomputeDerived(setInPlayCardStatus(untapped, RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Tapped));
    for (const state of [recomputeDerived(untapped), tapped]) {
      expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
      expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
    }
  });

  test('an inverted copy IS storable at a Haven and scores 6 misc MP once stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(setInPlayCardStatus(
      addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER)),
      RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Inverted,
    ));
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
    const cardId = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SMOKING_CONE)!.instanceId;

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const storeAction = storeActions[0].action as StoreItemAction;
    expect(storeAction.itemInstanceId).toBe(cardId);

    const after = dispatch(state, storeAction);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    const stored = after.players[RESOURCE_PLAYER].killPile.find(c => c.instanceId === cardId);
    expect(stored?.storedAtSite).toBe(RIVENDELL);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(6);
  });

  test('an inverted copy is NOT storable away from a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELROND] }], hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = setInPlayCardStatus(
      addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER)),
      RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Inverted,
    );
    expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
  });

  // ─── Rule 7: if stored, all ring items give one less corruption point ──────

  test('a stored copy reduces every ring item by one corruption point (to a minimum of 0); an unstored one does not', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_STEALTH);  // 2 CP
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);     // 1 CP
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);  // not a ring
    // "All ring items" — the opponent's too.
    base = attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, MAGIC_RING_OF_STEALTH);    // 2 CP
    base = recomputeDerived(base);
    const aragornBase = getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;
    const legolasBase = getCharacter(base, HAZARD_PLAYER, LEGOLAS).effectiveStats.corruptionPoints;

    const stored = recomputeDerived(addStoredCard(base, RESOURCE_PLAYER, SMOKING_CONE, RIVENDELL).state);
    // Aragorn: Magic Ring of Stealth 2 → 1, Precious Gold Ring 1 → 0; dagger unchanged.
    expect(getCharacter(stored, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(aragornBase - 2);
    // Legolas (opponent): Magic Ring of Stealth 2 → 1.
    expect(getCharacter(stored, HAZARD_PLAYER, LEGOLAS).effectiveStats.corruptionPoints).toBe(legolasBase - 1);

    // In play — even inverted — but not stored: no reduction.
    const inPlay = recomputeDerived(setInPlayCardStatus(
      addCardInPlay(base, RESOURCE_PLAYER, SMOKING_CONE, companyIdAt(base, RESOURCE_PLAYER)),
      RESOURCE_PLAYER, SMOKING_CONE, CardStatus.Inverted,
    ));
    expect(getCharacter(inPlay, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(aragornBase);
  });
});

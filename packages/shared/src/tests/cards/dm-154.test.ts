/**
 * @module dm-154.test
 *
 * Card test: Pass the Doors of Dol Guldur (dm-154)
 * Type: hero-resource-event (permanent), Stolen Knowledge, alignment wizard,
 * non-unique. Marshalling points: 0 while carried, 4 miscellaneous once stored.
 *
 * Card text: "Stolen Knowledge. Playable on a company if the company discards
 * (for no effect) a Stolen Knowledge card it controls. You can tap this card
 * during the same site phase the company successfully plays Rescue Prisoners at
 * Dol Guldur (or rescues characters taken prisoner if the rescue site is Dol
 * Guldur); this card never untaps. If tapped, this card can be stored at a
 * Haven [{H}]—only if stored do you receive its marshalling points. If stored,
 * all automatic-attacks at all Dark-holds [{D}] and all Shadow-holds [{S}] are
 * with one less prowess and one less strike (to a minimum of one). Once tapped,
 * no other copy of this card can be tapped."
 *
 * Effects & engine support:
 * | # | Rule                                                            | Mechanism                                                                        |
 * |---|-----------------------------------------------------------------|----------------------------------------------------------------------------------|
 * | 1 | Stolen Knowledge (card-category tag)                            | keywords: ["stolen-knowledge"] — also makes a copy a legal discard candidate      |
 * | 2 | Playable on a company                                           | play-target company (binds `CardInPlay.companyId`)                               |
 * | 3 | … if the company discards a Stolen Knowledge card it controls   | play-condition discard-keyword-card, cardKeyword "stolen-knowledge",              |
 * |   |                                                                 | sources ["character-items", "cards-in-play"] — one play action per candidate      |
 * | 4 | "(for no effect)"                                               | the play-cost payer moves the card straight to the discard pile, running nothing  |
 * | 5 | Tap during the same site phase the company rescues at Dol Guldur | grant-action "tap-pass-the-doors", cost { tap: "self" }, when                     |
 * |   |                                                                 | `company.prisonersRescuedAtDolGuldurThisSitePhase` (set by every rescue path)     |
 * | 6 | This card never untaps                                          | play-flag no-auto-untap                                                          |
 * | 7 | If tapped, storable at a Haven — only then does it score        | storable-at { siteTypes: ["haven"], requiresTapped: true, marshallingPoints: 4 }  |
 * | 8 | If stored, D/S automatic-attacks: -1 prowess, -1 strike, min 1   | two stat-modifiers, target all-automatic-attacks, activeWhileStored, min 1,       |
 * |   |                                                                 | when site.siteType ∈ {dark-hold, shadow-hold}                                     |
 * | 9 | Once tapped, no other copy of this card can be tapped           | grant-action singletonLock → `GameState.singletonTapLocks` (never cleared)        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, makePlayDeck,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  addCardInPlay, addStoredCard, attachItemToChar, setupAutoAttackStep,
  companyIdAt, findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve, runCardTriggeredAttackCombat,
  viableActions, dispatch, pool,
  ARAGORN, GIMLI, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { Phase, CardStatus, reduce } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, SiteCard,
  PlayPermanentEventAction, ActivateGrantedAction, SelectCardBearerAction, StoreItemAction,
} from '../../index.js';

const PASS_THE_DOORS = 'dm-154' as CardDefinitionId;
const PASS_THE_DOORS_NAME = 'Pass the Doors of Dol Guldur';
const DARK_NUMBERS = 'dm-123' as CardDefinitionId;            // Stolen Knowledge, attaches to a character
const KNOWLEDGE_OF_THE_ENEMY = 'dm-147' as CardDefinitionId;  // Stolen Knowledge, attaches to a character
const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId;        // NOT Stolen Knowledge — negative fixture

const RESCUE_PRISONERS = 'tw-315' as CardDefinitionId;
const DOL_GULDUR = 'tw-387' as CardDefinitionId;              // hero printing, dark-hold
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;         // dark-hold — Trolls 3 strikes / 10 prowess
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;             // ruins-and-lairs — Men 3 strikes / 6 prowess
const TINY_DARK_HOLD = 'test-tiny-dark-hold' as CardDefinitionId; // synthesised: Orcs 1 strike / 1 prowess
const SMALL_DARK_HOLD = 'test-small-dark-hold' as CardDefinitionId; // synthesised: Orcs 2 strikes / 2 prowess

/** The grant-action id declared by dm-154's tap ability. */
const TAP_ACTION = 'tap-pass-the-doors';

/** A synthesised Dark-hold whose only automatic-attack is already at the floor. */
const TINY_DARK_HOLD_DEF = {
  ...(pool[THE_UNDER_COURTS as string] as SiteCard),
  id: TINY_DARK_HOLD,
  name: 'Test Tiny Dark-hold',
  automaticAttacks: [{ creatureType: 'Orcs', strikes: 1, prowess: 1 }],
  effects: [],
} as unknown as SiteCard;

/** The same synthesised Dark-hold, one point above the floor on both stats. */
const SMALL_DARK_HOLD_DEF = {
  ...(pool[THE_UNDER_COURTS as string] as SiteCard),
  id: SMALL_DARK_HOLD,
  name: 'Test Small Dark-hold',
  automaticAttacks: [{ creatureType: 'Orcs', strikes: 2, prowess: 2 }],
  effects: [],
} as unknown as SiteCard;

describe('Pass the Doors of Dol Guldur (dm-154)', () => {
  beforeEach(() => resetMint());

  // ─── Effects 2-4: playable on a company by discarding a Stolen Knowledge card ──

  test('NOT playable when the company controls no Stolen Knowledge card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [PASS_THE_DOORS],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Book of Mazarbul is an ordinary item, not a Stolen Knowledge card.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('IS playable once the company controls a Stolen Knowledge card, one action per candidate', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }],
          hand: [PASS_THE_DOORS],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const oneCandidate = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DARK_NUMBERS);
    const single = viableActions(oneCandidate, PLAYER_1, 'play-permanent-event');
    expect(single).toHaveLength(1);
    expect((single[0].action as PlayPermanentEventAction).targetCompanyId).toBe(companyId);
    expect((single[0].action as PlayPermanentEventAction).discardCardInstanceId).toBeDefined();

    // A second controlled Stolen Knowledge card gives the player a choice.
    const twoCandidates = attachItemToChar(oneCandidate, RESOURCE_PLAYER, GIMLI, KNOWLEDGE_OF_THE_ENEMY);
    const both = viableActions(twoCandidates, PLAYER_1, 'play-permanent-event');
    expect(both).toHaveLength(2);
    const discardIds = both.map(ea => (ea.action as PlayPermanentEventAction).discardCardInstanceId);
    expect(new Set(discardIds).size).toBe(2);
  });

  test('a Stolen Knowledge card in ANOTHER company is not a legal discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: MORIA, characters: [{ defId: GIMLI, items: [DARK_NUMBERS] }] },
          ],
          hand: [PASS_THE_DOORS],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Only Gimli's company controls a Stolen Knowledge card, so only that
    // company may play the card — Aragorn's company offers nothing.
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayPermanentEventAction).targetCompanyId)
      .toBe(companyIdAt(state, RESOURCE_PLAYER, 1));
  });

  test('playing it discards the chosen Stolen Knowledge card for no effect and binds to the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DARK_NUMBERS] }] }],
          hand: [PASS_THE_DOORS],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const action = viableActions(base, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;

    const after = playPermanentEventAndResolve(base, PLAYER_1, action.cardInstanceId, undefined, {
      targetCompanyId: action.targetCompanyId,
      discardCardInstanceId: action.discardCardInstanceId,
    });

    // The played card is in play, untapped, bound to the company that paid for it.
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === PASS_THE_DOORS);
    expect(inPlay).toBeDefined();
    expect(inPlay!.companyId).toBe(companyId);
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // The Stolen Knowledge card is gone from its bearer and sits in the discard pile.
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DARK_NUMBERS)).toBe(true);

    // "for no effect": Dark Numbers' own discard ability (+3 to an influence
    // attempt, a turn-scoped check-modifier constraint) never fired.
    expect(after.activeConstraints.some(c => c.kind.type === 'check-modifier')).toBe(false);
  });

  test('a company-bound copy already in play is itself a legal Stolen Knowledge discard', () => {
    // dm-154 carries the Stolen Knowledge keyword, and a company-bound
    // permanent event lives in `cardsInPlay` rather than on a character — the
    // `cards-in-play` discard source.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [PASS_THE_DOORS],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const state = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyId);
    const inPlayId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.discardCardInstanceId).toBe(inPlayId);

    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, undefined, {
      targetCompanyId: action.targetCompanyId,
      discardCardInstanceId: action.discardCardInstanceId,
    });
    // The old copy left play for the discard pile; the new one took its place.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === inPlayId)).toBe(true);
    const remaining = after.players[RESOURCE_PLAYER].cardsInPlay.filter(c => c.definitionId === PASS_THE_DOORS);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].instanceId).not.toBe(inPlayId);
  });

  // ─── Effect 5: the tap window opens only on a rescue at Dol Guldur ──────────

  test('the tap ability is NOT offered before the company has rescued prisoners at Dol Guldur', () => {
    const base = buildSitePhaseState({ site: DOL_GULDUR, characters: [ARAGORN] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION);
    expect(offered).toHaveLength(0);
  });

  test('the tap ability IS offered once the company has rescued prisoners at Dol Guldur', () => {
    const base = buildSitePhaseState({ site: DOL_GULDUR, characters: [ARAGORN] });
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    const cardId = withCard.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const ready: GameState = {
      ...withCard,
      phaseState: { ...(withCard.phaseState as SitePhaseState), prisonersRescuedAtDolGuldurThisSitePhase: true },
    };

    const offered = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION);
    expect(offered).toHaveLength(1);
    expect((offered[0].action as ActivateGrantedAction).sourceCardId).toBe(cardId);
  });

  test('successfully playing Rescue Prisoners at Dol Guldur opens the tap window', () => {
    const base = buildSitePhaseState({
      site: DOL_GULDUR,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
      characters: [ARAGORN, GIMLI, LEGOLAS],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    expect((state.phaseState as SitePhaseState).prisonersRescuedAtDolGuldurThisSitePhase).toBeFalsy();

    const rescueCardId = findHandCardId(state, RESOURCE_PLAYER, RESCUE_PRISONERS);
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, rescueCardId);
    // Aragorn and Gimli take the two Spider strikes; Legolas stays untapped.
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [
      { characterDefId: ARAGORN, roll: 1 },
      { characterDefId: GIMLI, roll: 1 },
    ]);
    const legolasId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, LEGOLAS);
    const bearerAction = viableActions(afterCombat, PLAYER_1, 'select-card-bearer')
      .find(ea => (ea.action as SelectCardBearerAction).characterId === legolasId)!;
    const afterKeep = dispatch(afterCombat, bearerAction.action);

    expect((afterKeep.phaseState as SitePhaseState).prisonersRescuedAtDolGuldurThisSitePhase).toBe(true);
    const offered = viableActions(afterKeep, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION);
    expect(offered).toHaveLength(1);
  });

  test('the same rescue at a site that is NOT Dol Guldur does not open the tap window', () => {
    const base = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
      characters: [ARAGORN, GIMLI, LEGOLAS],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));

    const rescueCardId = findHandCardId(state, RESOURCE_PLAYER, RESCUE_PRISONERS);
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, rescueCardId);
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [
      { characterDefId: ARAGORN, roll: 1 },
      { characterDefId: GIMLI, roll: 1 },
    ]);
    const legolasId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, LEGOLAS);
    const bearerAction = viableActions(afterCombat, PLAYER_1, 'select-card-bearer')
      .find(ea => (ea.action as SelectCardBearerAction).characterId === legolasId)!;
    const afterKeep = dispatch(afterCombat, bearerAction.action);

    expect((afterKeep.phaseState as SitePhaseState).prisonersRescuedAtDolGuldurThisSitePhase).toBeFalsy();
    expect(viableActions(afterKeep, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)).toHaveLength(0);
  });

  test('activating the ability taps the card in place, and it cannot be activated twice', () => {
    const base = buildSitePhaseState({ site: DOL_GULDUR, characters: [ARAGORN] });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyId);
    const cardId = withCard.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const ready: GameState = {
      ...withCard,
      phaseState: { ...(withCard.phaseState as SitePhaseState), prisonersRescuedAtDolGuldurThisSitePhase: true },
    };
    const tapAction = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)!;
    const after = dispatch(ready, tapAction.action);

    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardId);
    expect(card).toBeDefined();
    expect(card!.status).toBe(CardStatus.Tapped);
    expect(card!.companyId).toBe(companyId);
    expect(after.singletonTapLocks).toContain(PASS_THE_DOORS_NAME);
    // The ability is spent — the tapped copy is never offered again.
    expect(viableActions(after, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)).toHaveLength(0);
  });

  // ─── Effect 6: this card never untaps ──────────────────────────────────────

  test('a tapped copy stays tapped through its controller untap phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    const p1 = withCard.players[RESOURCE_PLAYER];
    const tapped: GameState = {
      ...withCard,
      players: [
        { ...p1, cardsInPlay: p1.cardsInPlay.map(c => ({ ...c, status: CardStatus.Tapped })) },
        withCard.players[HAZARD_PLAYER],
      ] as typeof withCard.players,
    };

    const after = dispatch(tapped, { type: 'untap', player: PLAYER_1 });
    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === PASS_THE_DOORS);
    expect(card?.status).toBe(CardStatus.Tapped);
  });

  // ─── Effect 7: storable at a Haven only once tapped; MP only when stored ────

  test('an untapped copy at a Haven is NOT offered for storage and scores nothing', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('a tapped copy IS storable at a Haven and scores 4 misc MP once stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyId);
    const cardId = withCard.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const p1 = withCard.players[RESOURCE_PLAYER];
    const tapped: GameState = {
      ...withCard,
      players: [
        { ...p1, cardsInPlay: p1.cardsInPlay.map(c => ({ ...c, status: CardStatus.Tapped })) },
        withCard.players[HAZARD_PLAYER],
      ] as typeof withCard.players,
    };
    // Still worth nothing while it merely sits in play, tapped.
    expect(tapped.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);

    const storeActions = viableActions(tapped, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const storeAction = storeActions[0].action as StoreItemAction;
    expect(storeAction.itemInstanceId).toBe(cardId);
    expect(storeAction.companyId).toBe(companyId);
    expect(storeAction.characterId).toBeUndefined();

    const after = dispatch(tapped, storeAction);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    const stored = after.players[RESOURCE_PLAYER].killPile.find(c => c.instanceId === cardId);
    expect(stored).toBeDefined();
    expect(stored!.storedAtSite).toBe(RIVENDELL);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(4);
    // No bearer means no corruption check (CoE 2.II.4's check falls on the bearer).
    expect(after.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(false);
  });

  test('a tapped copy is NOT storable away from a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(base, RESOURCE_PLAYER));
    const p1 = withCard.players[RESOURCE_PLAYER];
    const tapped: GameState = {
      ...withCard,
      players: [
        { ...p1, cardsInPlay: p1.cardsInPlay.map(c => ({ ...c, status: CardStatus.Tapped })) },
        withCard.players[HAZARD_PLAYER],
      ] as typeof withCard.players,
    };
    expect(viableActions(tapped, PLAYER_1, 'store-item')).toHaveLength(0);
  });

  // ─── Effect 8: stored, D/S automatic-attacks lose 1 prowess and 1 strike ───

  test('a stored copy weakens a Shadow-hold automatic-attack by 1 prowess and 1 strike', () => {
    // Moria (shadow-hold): Orcs, 4 strikes / 7 prowess.
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: MORIA })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat!.strikesTotal).toBe(4);
    expect(base.combat!.strikeProwess).toBe(7);

    const withStored = addStoredCard(buildSitePhaseState({ site: MORIA }), RESOURCE_PLAYER, PASS_THE_DOORS, RIVENDELL).state;
    const weakened = dispatch(setupAutoAttackStep(withStored), { type: 'pass', player: PLAYER_1 });
    expect(weakened.combat!.strikesTotal).toBe(3);
    expect(weakened.combat!.strikeProwess).toBe(6);
  });

  test('a stored copy weakens a Dark-hold automatic-attack by 1 prowess and 1 strike', () => {
    // The Under-courts (dark-hold): Trolls, 3 strikes / 10 prowess.
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat!.strikesTotal).toBe(3);
    expect(base.combat!.strikeProwess).toBe(10);

    const withStored = addStoredCard(buildSitePhaseState({ site: THE_UNDER_COURTS }), RESOURCE_PLAYER, PASS_THE_DOORS, RIVENDELL).state;
    const weakened = dispatch(setupAutoAttackStep(withStored), { type: 'pass', player: PLAYER_1 });
    expect(weakened.combat!.strikesTotal).toBe(2);
    expect(weakened.combat!.strikeProwess).toBe(9);
  });

  test('the reduction floors at one prowess and one strike', () => {
    // No printed Dark-hold has a 1/1 or 2/2 automatic-attack, so the "(to a
    // minimum of one)" clause is exercised against synthesised ones. The 2/2
    // site first proves the reduction does reach these sites (2/2 → 1/1); the
    // 1/1 site then shows it stops there instead of dropping to 0/0.
    const patch = {
      [TINY_DARK_HOLD as string]: TINY_DARK_HOLD_DEF,
      [SMALL_DARK_HOLD as string]: SMALL_DARK_HOLD_DEF,
    };
    const patched = (site: CardDefinitionId, stored: boolean): GameState => {
      const built = buildSitePhaseState({ site });
      const withPool: GameState = { ...built, cardPool: { ...built.cardPool, ...patch } };
      const seeded = stored
        ? addStoredCard(withPool, RESOURCE_PLAYER, PASS_THE_DOORS, RIVENDELL).state
        : withPool;
      return dispatch(setupAutoAttackStep(seeded), { type: 'pass', player: PLAYER_1 });
    };

    const smallBase = patched(SMALL_DARK_HOLD, false);
    expect(smallBase.combat!.strikesTotal).toBe(2);
    expect(smallBase.combat!.strikeProwess).toBe(2);
    const smallReduced = patched(SMALL_DARK_HOLD, true);
    expect(smallReduced.combat!.strikesTotal).toBe(1);
    expect(smallReduced.combat!.strikeProwess).toBe(1);

    const tinyBase = patched(TINY_DARK_HOLD, false);
    expect(tinyBase.combat!.strikesTotal).toBe(1);
    expect(tinyBase.combat!.strikeProwess).toBe(1);
    const tinyFloored = patched(TINY_DARK_HOLD, true);
    expect(tinyFloored.combat!.strikesTotal).toBe(1);
    expect(tinyFloored.combat!.strikeProwess).toBe(1);
  });

  test('automatic-attacks at other site types are unaffected', () => {
    // Bandit Lair (ruins-and-lairs): Men, 3 strikes / 6 prowess.
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: BANDIT_LAIR })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat!.strikesTotal).toBe(3);
    expect(base.combat!.strikeProwess).toBe(6);

    const withStored = addStoredCard(buildSitePhaseState({ site: BANDIT_LAIR }), RESOURCE_PLAYER, PASS_THE_DOORS, RIVENDELL).state;
    const unaffected = dispatch(setupAutoAttackStep(withStored), { type: 'pass', player: PLAYER_1 });
    expect(unaffected.combat!.strikesTotal).toBe(3);
    expect(unaffected.combat!.strikeProwess).toBe(6);
  });

  test('an UNSTORED copy in play does not weaken a Dark-hold automatic-attack', () => {
    // "If stored, …" — the effect is dormant while the card merely sits in play,
    // even bound to the very company facing the attack.
    const state = buildSitePhaseState({ site: THE_UNDER_COURTS });
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, PASS_THE_DOORS, companyIdAt(state, RESOURCE_PLAYER));
    const combat = dispatch(setupAutoAttackStep(withCard), { type: 'pass', player: PLAYER_1 });
    expect(combat.combat!.strikesTotal).toBe(3);
    expect(combat.combat!.strikeProwess).toBe(10);
  });

  // ─── Effect 9: once tapped, no other copy of this card can be tapped ───────

  test('tapping one copy permanently locks every other copy', () => {
    const base = buildSitePhaseState({ site: DOL_GULDUR, characters: [ARAGORN] });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const twoCopies = addCardInPlay(
      addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyId),
      RESOURCE_PLAYER, PASS_THE_DOORS, companyId,
    );
    const cardIds = twoCopies.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId);
    expect(cardIds).toHaveLength(2);
    const ready: GameState = {
      ...twoCopies,
      phaseState: { ...(twoCopies.phaseState as SitePhaseState), prisonersRescuedAtDolGuldurThisSitePhase: true },
    };
    // Both copies are offered while the lock is unclaimed.
    expect(viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)).toHaveLength(2);

    const firstAction = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).sourceCardId === cardIds[0])!.action;
    const afterTap = dispatch(ready, firstAction);
    expect(afterTap.singletonTapLocks).toContain(PASS_THE_DOORS_NAME);

    // The untouched second copy is no longer offered, and stays untapped.
    expect(viableActions(afterTap, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)).toHaveLength(0);
    expect(afterTap.players[RESOURCE_PLAYER].cardsInPlay
      .find(c => c.instanceId === cardIds[1])!.status).toBe(CardStatus.Untapped);

    // …and the reducer rejects the second copy's activation even when replayed.
    const secondAction = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).sourceCardId === cardIds[1])!.action;
    const rejected = reduce(afterTap, secondAction);
    expect(rejected.error).toBeDefined();
    expect(rejected.state.players[RESOURCE_PLAYER].cardsInPlay
      .find(c => c.instanceId === cardIds[1])!.status).toBe(CardStatus.Untapped);
  });

  test('the lock survives the tapped copy leaving play for the marshalling-point pile', () => {
    const base = buildSitePhaseState({ site: DOL_GULDUR, characters: [ARAGORN] });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const twoCopies = addCardInPlay(
      addCardInPlay(base, RESOURCE_PLAYER, PASS_THE_DOORS, companyId),
      RESOURCE_PLAYER, PASS_THE_DOORS, companyId,
    );
    const cardIds = twoCopies.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId);
    const ready: GameState = {
      ...twoCopies,
      phaseState: { ...(twoCopies.phaseState as SitePhaseState), prisonersRescuedAtDolGuldurThisSitePhase: true },
    };
    const firstAction = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).sourceCardId === cardIds[0])!.action;
    const afterTap = dispatch(ready, firstAction);

    // The tapped copy is later stored at a Haven, leaving `cardsInPlay` for the
    // marshalling-point pile (the real store flow is covered above).
    const p1 = afterTap.players[RESOURCE_PLAYER];
    const stored: GameState = {
      ...afterTap,
      players: [
        {
          ...p1,
          cardsInPlay: p1.cardsInPlay.filter(c => c.instanceId !== cardIds[0]),
          killPile: [...p1.killPile, { instanceId: cardIds[0], definitionId: PASS_THE_DOORS, storedAtSite: RIVENDELL }],
        },
        afterTap.players[HAZARD_PLAYER],
      ] as typeof afterTap.players,
    };
    expect(stored.singletonTapLocks).toContain(PASS_THE_DOORS_NAME);

    // The surviving copy is still barred, even with a fresh rescue window open.
    expect(viableActions(stored, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === TAP_ACTION)).toHaveLength(0);
  });
});

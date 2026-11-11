/**
 * @module td-127.test
 *
 * Card test: Legendary Hoard (td-127)
 * Type: hero-resource-event (permanent), non-unique, wizard, 0 MP
 *
 * Text:
 *   "Playable on an at home Dragon manifestation. Target Dragon's
 *    automatic-attack cannot be cancelled. Rotate this card 90˚ each time a
 *    manifestation of target Dragon is played. If the site receiving the
 *    Dragon's automatic-attack is untapped, a number of items played there do
 *    not tap the site: not rotated: 1 item; rotated once: 2 items; rotated
 *    twice or more: 3 items. If target Dragon is required to be discarded or
 *    removed from play, invert Dragon on table until this card is discarded.
 *    Discard this card when any item is played at target Dragon's lair that
 *    taps the site. Cannot be duplicated on a given Dragon."
 *
 * Effects:
 * | # | Effect Type       | Notes                                                          |
 * |---|-------------------|----------------------------------------------------------------|
 * | 1 | play-target       | `permanent-event` (either player's), filter `target.atHome`     |
 * | 2 | duplication-limit | scope `target`, max 1 — "Cannot be duplicated on a given Dragon" |
 * | 3 | dragon-hoard      | freeItemsByRotation [1, 2, 3] — every other rule, see           |
 * |   |                   | `engine/legendary-hoard.ts`                                     |
 *
 * Readings: "Target Dragon's automatic-attack" is the additional lair attack
 * the at-home manifestation contributes (g.man.3: the lair's printed Dragon
 * attack is not a manifestation). The free-item allowance is per turn (a
 * company's visit to the lair). While inverted the at-home card is held with
 * the hoard (out of `cardsInPlay`): its effects stop and the Dragon counts as
 * defeated (the lair loses its Dragon automatic-attacks); when the hoard is
 * discarded the Dragon goes to the pile it was headed for (e.g. the
 * defender's marshalling-point pile as kill points).
 *
 * Playable: YES
 * Certified: 2026-11-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BALIN, GIMLI, ELROND, GLORFINDEL_II, DAGGER_OF_WESTERNESSE, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  buildTestState, buildSitePhaseState, resetMint, makeMHState, dispatch,
  addCardInPlay, pushCardInPlay, addCardToHand, findHandCardId, handCardId, companyIdAt, viableActionsForHandCard,
  playHazardAndResolve, playPermanentEventAndResolve,
  setupAutoAttackStep, runAutoAttackCombatMulti, assertEveryInstanceReachable,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';
import type { PlayerSetup } from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { reduce } from '../../engine/reducer.js';
import { CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, SiteCard, PlayPermanentEventAction,
} from '../../index.js';

const LEGENDARY_HOARD = 'td-127' as CardDefinitionId;
const SMAUG = 'tw-90' as CardDefinitionId;                  // the basic creature manifestation
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;          // Dragon 2×18/8 at The Lonely Mountain
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const ITANGAST_AT_HOME = 'td-38' as CardDefinitionId;       // a different Dragon
const LONELY_MOUNTAIN_HERO = 'tw-428' as CardDefinitionId;  // Smaug's lair (lairOf tw-90)

/** Instance id `addCardInPlay` mints for the first card in the hazard player's cardsInPlay. */
const AT_HOME_ID = `${PLAYER_2 as string}-1000` as CardInstanceId;
const HOARD_ID = 'hoard-1' as CardInstanceId;
/** Legendary Hoard already in play on Smaug at Home (`AT_HOME_ID`). */
const HOARD_ON_SMAUG = { instanceId: HOARD_ID, definitionId: LEGENDARY_HOARD, status: CardStatus.Untapped, attachedTo: AT_HOME_ID };
const LAIR_COMPANY = [ARAGORN, BALIN, GIMLI, ELROND, GLORFINDEL_II];
const ORG_PLAYERS: [PlayerSetup, PlayerSetup] = [
  { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LEGENDARY_HOARD], siteDeck: [MINAS_TIRITH] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
];

describe('Legendary Hoard (td-127)', () => {
  beforeEach(() => resetMint());

  // ─── "Playable on an at home Dragon manifestation" ────────────────────────

  test('playable on the opponent\'s in-play at-home Dragon; the resolved card is bound to it', () => {
    const state = addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, SMAUG_AT_HOME);
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, LEGENDARY_HOARD).map(a => a.action as PlayPermanentEventAction);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetPermanentEventInstanceId).toBe(AT_HOME_ID);

    const after = playPermanentEventAndResolve(state, PLAYER_1, plays[0].cardInstanceId, undefined, {
      targetPermanentEventInstanceId: AT_HOME_ID,
    });
    const hoard = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === LEGENDARY_HOARD);
    expect(hoard).toBeDefined();
    expect(hoard!.attachedTo).toBe(AT_HOME_ID);
  });

  test('not playable without an at-home Dragon, nor on a non-at-home permanent-event', () => {
    const bare = buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS });
    expect(viableActionsForHandCard(bare, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, LEGENDARY_HOARD)).toHaveLength(0);
    const withDoors = addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(viableActionsForHandCard(withDoors, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, LEGENDARY_HOARD).map(a => a.action as PlayPermanentEventAction)).toHaveLength(0);
  });

  test('cannot be duplicated on a given Dragon, but may go on a different one', () => {
    let state = pushCardInPlay(addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, LEGENDARY_HOARD).map(a => a.action as PlayPermanentEventAction)).toHaveLength(0);
    state = addCardInPlay(state, HAZARD_PLAYER, ITANGAST_AT_HOME);
    const itangastId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === ITANGAST_AT_HOME)!.instanceId;
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, LEGENDARY_HOARD).map(a => a.action as PlayPermanentEventAction);
    expect(plays.map(p => p.targetPermanentEventInstanceId)).toEqual([itangastId]);
  });

  // ─── "Target Dragon's automatic-attack cannot be cancelled" ───────────────

  test('the at-home lair attack becomes uncancelable only while hoarded', () => {
    const plain = addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, SMAUG_AT_HOME);
    const lonely = plain.cardPool[LONELY_MOUNTAIN_HERO] as SiteCard;
    expect(getActiveAutoAttacks(plain, lonely)[1].combatRules ?? []).not.toContain('cannot-be-canceled');

    const hoarded = pushCardInPlay(addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    const attacks = getActiveAutoAttacks(hoarded, lonely);
    expect(attacks).toHaveLength(2);
    expect(attacks[0].combatRules ?? []).not.toContain('cannot-be-canceled'); // printed lair attack
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18, combatRules: ['cannot-be-canceled'] });
  });

  test('the hoarded at-home attack starts as an uncancelable combat', () => {
    let state = pushCardInPlay(addCardInPlay(setupAutoAttackStep(buildSitePhaseState({
      site: LONELY_MOUNTAIN_HERO, characters: [BALIN, ELROND, GLORFINDEL_II],
    })), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state; // printed attack
    const triggered = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(triggered.error).toBeUndefined();
    expect(triggered.state.combat?.strikesTotal).toBe(2);
    expect(triggered.state.combat?.uncancelable).toBe(true);
  });

  // ─── "Rotate this card 90˚ each time a manifestation of target Dragon is played" ──

  test('rotates when a manifestation of the target Dragon is played, not for another Dragon', () => {
    const base = pushCardInPlay(addCardInPlay(buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ITANGAST_AT_HOME, SMAUG_AHUNT], siteDeck: [MINAS_TIRITH] },
      ],
    }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    const mhState: GameState = { ...base, phaseState: makeMHState() };
    const companyId = companyIdAt(mhState, RESOURCE_PLAYER);

    const afterOther = playHazardAndResolve(mhState, PLAYER_2, handCardId(mhState, HAZARD_PLAYER, 0), companyId);
    expect(afterOther.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.rotations ?? 0).toBe(0);

    const ahuntId = findHandCardId(afterOther, HAZARD_PLAYER, SMAUG_AHUNT);
    const afterAhunt = playHazardAndResolve(afterOther, PLAYER_2, ahuntId, companyId);
    expect(afterAhunt.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.rotations).toBe(1);
  });

  // ─── Free items at the untapped lair, by rotation ─────────────────────────

  test('not rotated: 1 item does not tap the lair; the next item taps it and discards the hoard', () => {
    const state = pushCardInPlay(addCardInPlay(buildSitePhaseState({ site: LONELY_MOUNTAIN_HERO, characters: LAIR_COMPANY, hand: Array.from({ length: 2 }, () => DAGGER_OF_WESTERNESSE) }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    const afterFirst = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(afterFirst.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(afterFirst.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.hoardFreeItems?.count).toBe(1);

    const afterSecond = dispatch(afterFirst, viableActionsForHandCard(afterFirst, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(afterSecond.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(afterSecond.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)).toBeUndefined();
    expect(afterSecond.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LEGENDARY_HOARD)).toBe(true);
    // The at-home Dragon itself is untouched by the hoard's discard.
    expect(afterSecond.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === AT_HOME_ID)).toBe(true);
  });

  test('rotated once: 2 items do not tap the lair', () => {
    let state = pushCardInPlay(addCardInPlay(buildSitePhaseState({ site: LONELY_MOUNTAIN_HERO, characters: LAIR_COMPANY, hand: Array.from({ length: 3 }, () => DAGGER_OF_WESTERNESSE) }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, { ...HOARD_ON_SMAUG, rotations: 1 });
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)).toBeDefined();
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)).toBeUndefined();
  });

  test('rotated twice or more: 3 items do not tap the lair', () => {
    let state = pushCardInPlay(addCardInPlay(buildSitePhaseState({ site: LONELY_MOUNTAIN_HERO, characters: LAIR_COMPANY, hand: Array.from({ length: 4 }, () => DAGGER_OF_WESTERNESSE) }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, { ...HOARD_ON_SMAUG, rotations: 5 });
    for (let i = 0; i < 3; i++) state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.hoardFreeItems?.count).toBe(3);
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)).toBeUndefined();
  });

  test('the per-turn allowance resets on a new turn', () => {
    // A free item recorded on an earlier turn does not count against this turn.
    let state = pushCardInPlay(addCardInPlay(buildSitePhaseState({ site: LONELY_MOUNTAIN_HERO, characters: LAIR_COMPANY, hand: Array.from({ length: 1 }, () => DAGGER_OF_WESTERNESSE) }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    state = {
      ...state,
      players: [
        { ...state.players[0], cardsInPlay: state.players[0].cardsInPlay.map(c => (c.instanceId === HOARD_ID ? { ...c, hoardFreeItems: { turnNumber: state.turnNumber - 1, count: 1 } } : c)) },
        state.players[1],
      ] as unknown as GameState['players'],
    };
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.hoardFreeItems).toEqual({ turnNumber: state.turnNumber, count: 1 });
  });

  // ─── "If target Dragon is required to be discarded or removed from play,
  //      invert Dragon on table until this card is discarded" ─────────────────

  test('defeating the hoarded at-home attack inverts the Dragon with the hoard; discarding the hoard sends it to the kill pile', () => {
    let state = pushCardInPlay(addCardInPlay(setupAutoAttackStep(buildSitePhaseState({
      site: LONELY_MOUNTAIN_HERO, characters: LAIR_COMPANY,
    })), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
    state = runAutoAttackCombatMulti(state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]).state;
    expect(state.combat).toBeNull();

    // Not in the kill pile and not in play: held inverted with the hoard.
    expect(state.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === AT_HOME_ID)).toBe(false);
    expect(state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === AT_HOME_ID)).toBe(false);
    const hoard = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!;
    expect(hoard.invertedDragon).toMatchObject({ card: { instanceId: AT_HOME_ID }, pile: 'killPile', pileOwner: PLAYER_1 });
    assertEveryInstanceReachable(state);

    // The Dragon counts as defeated: the lair has no Dragon automatic-attacks left.
    const lonely = state.cardPool[LONELY_MOUNTAIN_HERO] as SiteCard;
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(0);

    // The hoard keeps working at the lair: first item free, second taps → hoard discarded.
    while (state.phaseState.phase === Phase.Site && state.phaseState.step !== 'play-resources') {
      state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    }
    state = addCardToHand(addCardToHand(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE), RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.invertedDragon).toBeDefined();
    state = dispatch(state, viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)[0].action);
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)).toBeUndefined();
    expect(state.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === AT_HOME_ID)).toBe(true);
    assertEveryInstanceReachable(state);
  });

  test('removal from play by the manifestation cascade (another Smaug manifestation defeated) also inverts the Dragon', () => {
    let state = pushCardInPlay(addCardInPlay(buildTestState({ activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true, players: ORG_PLAYERS }), HAZARD_PLAYER, SMAUG_AT_HOME), RESOURCE_PLAYER, HOARD_ON_SMAUG);
    state = {
      ...state,
      players: [
        { ...state.players[0], killPile: [...state.players[0].killPile, { instanceId: 'smaug-1' as CardInstanceId, definitionId: SMAUG }] },
        state.players[1],
      ] as unknown as GameState['players'],
    };
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === AT_HOME_ID)).toBe(false);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === AT_HOME_ID)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === HOARD_ID)!.invertedDragon).toMatchObject({ pile: 'outOfPlayPile', pileOwner: PLAYER_2 });
    assertEveryInstanceReachable(after);
  });

  test('without a hoard, defeating the at-home attack sends the Dragon straight to the kill pile', () => {
    let state = addCardInPlay(setupAutoAttackStep(buildSitePhaseState({
      site: LONELY_MOUNTAIN_HERO, characters: [BALIN, ELROND, GLORFINDEL_II],
    })), HAZARD_PLAYER, SMAUG_AT_HOME);
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
    state = runAutoAttackCombatMulti(state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]).state;
    expect(state.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === AT_HOME_ID)).toBe(true);
  });
});

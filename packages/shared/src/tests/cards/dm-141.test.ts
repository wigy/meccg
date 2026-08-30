/**
 * @module dm-141.test
 *
 * Card test: Hour of Need (dm-141)
 * Type: hero-resource-event (short)
 * Effects: 4
 *   1. deck-restriction excluded-from-deck when deck.alignment fallen-wizard (rule 1.18)
 *   2. play-window: organization / end-of-org
 *   3. play-target character, filter { untapped, skills includes diplomat,
 *      NOT skills includes warrior, race != wizard, company.siteUntapped,
 *      NOT company.siteIsUnderDeeps }
 *   4. on-event self-enters-play → faction-influence-region-penalty (penaltyBase: 2)
 *
 * Text: "Playable during the organization phase on an untapped non-warrior,
 * non-Wizard diplomat at an untapped non-Under-deeps site, if you have a
 * faction in your hand. Play a faction from your hand. Tap diplomat who then
 * makes an influence attempt on this faction. Count out the number of
 * contiguous regions from the diplomat's site to the site where the faction
 * is normally playable (including the regions containing both sites)—subtract
 * two plus this number from the diplomat's attempt. If the attempt is
 * unsuccessful, discard the diplomat and faction. If the attempt is
 * successful you cannot play a minor item and you must tap the character's
 * site. Cannot be included in a Fallen-wizard's deck."
 *
 * Engine Support:
 * | # | Rule (card text)                                              | Status      | Mechanism                                                        |
 * |---|----------------------------------------------------------------|-------------|-------------------------------------------------------------------|
 * | 1 | Playable during the organization phase                         | IMPLEMENTED | play-window phase:organization step:end-of-org                    |
 * | 2 | Untapped non-warrior, non-Wizard diplomat                      | IMPLEMENTED | play-target filter (skills/$not/race)                             |
 * | 3 | At an untapped non-Under-deeps site                            | IMPLEMENTED | company.siteUntapped / company.siteIsUnderDeeps context fields    |
 * | 4 | If you have a faction in your hand                             | IMPLEMENTED | end-of-org emitter crosses each diplomat with each hand faction   |
 * | 5 | Play a faction from your hand; tap diplomat; influence attempt  | IMPLEMENTED | faction-influence-region-penalty (resolveFactionInfluenceRegionPenalty) |
 * | 6 | Region-count penalty (2 + inclusive region distance)            | IMPLEMENTED | influenceRegionPenalty / regionDistanceInclusive                  |
 * | 7 | Unsuccessful: discard diplomat and faction                     | IMPLEMENTED | discardCharacterToDiscardPile + faction discard                   |
 * | 8 | Successful: no minor item; must tap the character's site       | IMPLEMENTED | site tap + minor-item-play-blocked site-flag constraint           |
 * | 9 | Cannot be included in a Fallen-wizard's deck                   | IMPLEMENTED | deck-restriction excluded-from-deck                               |
 *
 * Playable: YES
 * Certified: 2026-08-30
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, FRODO, ELROND, SARUMAN, MEN_OF_ANORIEN, LORIEN, MINAS_TIRITH, RIVENDELL, MORIA,
  DAGGER_OF_WESTERNESSE,
  handCardId, findHandCardId, findCharInstanceId, companyIdAt,
  viableActions, dispatch, mint,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';
import { CardStatus } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const HOUR_OF_NEED = 'dm-141' as CardDefinitionId;
const LAKE_TOWN = 'tw-406' as CardDefinitionId; // hero border-hold, region Northern Rhovanion
const MEN_OF_NORTHERN_RHOVANION = 'tw-281' as CardDefinitionId; // hero faction, influence # 7, playable only at Lake-town
const UNDER_GATES = 'dm-38' as CardDefinitionId; // hero shadow-hold with the under-deeps keyword

describe('Hour of Need (dm-141)', () => {
  beforeEach(() => resetMint());

  // ─── Play-target eligibility ─────────────────────────────────────────────

  test('offers one action per (diplomat, hand faction) pair', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    const factionId = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_NORTHERN_RHOVANION);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(frodoId);
    expect(plays[0].targetFactionCardId).toBe(factionId);
  });

  test('offers one action per faction when multiple factions are in hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION, MEN_OF_ANORIEN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(2);
    const factionIds = new Set(plays.map(a => a.targetFactionCardId));
    expect(factionIds).toEqual(new Set([
      findHandCardId(base, RESOURCE_PLAYER, MEN_OF_NORTHERN_RHOVANION),
      findHandCardId(base, RESOURCE_PLAYER, MEN_OF_ANORIEN),
    ]));
  });

  test('not offered without a faction in hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered on a character without the diplomat skill', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [ARAGORN] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered on a warrior diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [ELROND] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered on a Wizard diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [SARUMAN] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered when the diplomat is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    const frodo = base.players[RESOURCE_PLAYER].characters[frodoId];
    const tapped: GameState = {
      ...base,
      players: [
        { ...base.players[0], characters: { ...base.players[0].characters, [frodoId]: { ...frodo, status: CardStatus.Tapped } } },
        base.players[1],
      ] as typeof base.players,
    };
    const plays = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered when the site is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const company = base.players[RESOURCE_PLAYER].companies[0];
    const tapped: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...company, currentSite: { ...company.currentSite!, status: CardStatus.Tapped } }] },
        base.players[1],
      ] as typeof base.players,
    };
    const plays = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered at an Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: UNDER_GATES, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  // ─── Resolution ───────────────────────────────────────────────────────────

  function playHourOfNeed(state: GameState, cheatRollTotal: number): GameState {
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HOUR_OF_NEED);
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_NORTHERN_RHOVANION);
    return dispatch({ ...state, cheatRollTotal }, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: frodoId,
      targetFactionCardId: factionId,
    });
  }

  test('a successful attempt brings the faction into play, taps the diplomat and site, and blocks minor items there', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const siteDefId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.definitionId;

    // influence # 7; free DI 1 (Frodo, no followers); same-region (Lake-town)
    // inclusive distance 1 ⇒ penalty -(2+1) = -3 ⇒ net modifier -2.
    // roll forced to 12 ⇒ 12 - 2 = 10 ≥ 7 ⇒ succeeds.
    const after = playHourOfNeed(base, 12);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);
    const faction = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)!;
    expect(faction.status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);

    // diplomat tapped, still in the company (not discarded)
    expect(after.players[RESOURCE_PLAYER].characters[frodoId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(frodoId);

    // diplomat's site tapped
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);

    // minor-item-play-blocked constraint added, turn-scoped, bound to the site
    const constraint = after.activeConstraints.find(c => c.kind.type === 'site-flag' && c.kind.flag === 'minor-item-play-blocked');
    expect(constraint).toBeDefined();
    expect(constraint!.kind).toMatchObject({ siteDefinitionId: siteDefId });
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target).toEqual({ kind: 'company', companyId });
  });

  test('a failed attempt discards both the diplomat and the faction, and never taps the site', () => {
    // A companion (Elrond) keeps the company alive after Frodo is discarded,
    // so the site's post-attempt status can still be inspected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO, ELROND] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HOUR_OF_NEED);
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);

    // roll forced to 2 ⇒ 2 + 1 - 3 = 0 < 7 ⇒ fails.
    const after = playHourOfNeed(base, 2);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);

    // diplomat discarded — no longer in play or in the company
    expect(after.players[RESOURCE_PLAYER].characters[frodoId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === frodoId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies.every(c => !c.characters.includes(frodoId))).toBe(true);

    // site never tapped by a failed attempt
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    expect(after.activeConstraints.some(c => c.kind.type === 'site-flag' && c.kind.flag === 'minor-item-play-blocked')).toBe(false);
  });

  test('a greater region distance raises the penalty enough to turn a same-region success into a failure', () => {
    const sameRegion = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LAKE_TOWN, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Same region as Lake-town (distance 1): 9 + 1 - (2 + 1) = 7 ≥ 7 ⇒ succeeds exactly.
    const sameRegionAfter = playHourOfNeed(sameRegion, 9);
    expect(sameRegionAfter.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);

    const distantRegion = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [HOUR_OF_NEED, MEN_OF_NORTHERN_RHOVANION], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Rivendell (Rhudaur) is a different region than Northern Rhovanion, so the
    // inclusive distance is at least 2 — the same forced roll now fails:
    // 9 + 1 - (2 + distance) ≤ 9 + 1 - 4 = 6 < 7.
    const distantAfter = playHourOfNeed(distantRegion, 9);
    expect(distantAfter.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(distantAfter.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);
  });

  // ─── minor-item-play-blocked primitive ───────────────────────────────────

  test('minor-item-play-blocked prevents a minor item at the bound site', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [DAGGER_OF_WESTERNESSE] });
    const itemId = handCardId(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const siteDefId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.definitionId;

    const before = viableActions(base, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId);
    expect(before.length).toBeGreaterThan(0);

    const blocked = addConstraint(base, {
      source: mint(),
      sourceDefinitionId: HOUR_OF_NEED,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'site-flag', flag: 'minor-item-play-blocked', siteDefinitionId: siteDefId },
    });
    const after = viableActions(blocked, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId);
    expect(after).toHaveLength(0);
  });
});

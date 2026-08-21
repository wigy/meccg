/**
 * @module tw-25.test
 *
 * Card test: Crebain (tw-25)
 * Type: hazard-creature (Animals), non-unique.
 * Strikes: 1/each (runtime = defending company size), Prowess: 5,
 * Body: — (no creature body check), kill MP 1.
 *
 * Text:
 *   "Animals. Each character in the company faces one strike. After the
 *    attack, the defender must reveal one random card from his hand for
 *    each character in the defending company."
 *
 * Canonical cost (`data/cards.json` TW-25 `attributes.playable`):
 * `{b}{w}{s}{d}{R}{S}{D}` — a single `keyedTo` entry combining region types
 * (border/wilderness/shadow/dark, one each) with site types
 * (ruins-and-lairs/shadow-hold/dark-hold), the same combined-entry shape
 * already certified on Barrow-wight (le-61/tw-15).
 *
 * Effects:
 * | # | Rule (card text)                                          | Encoding                                |
 * |---|------------------------------------------------------------|------------------------------------------|
 * | 1 | "Each character in the company faces one strike."          | combat-one-strike-per-character           |
 * | 2 | "After the attack, the defender must reveal one random     | on-event attack-not-canceled →            |
 * |   |  card from his hand for each character in the defending    | reveal-hand-cards-per-character           |
 * |   |  company."                                                  |                                            |
 *
 * `reveal-hand-cards-per-character` is a new triggered-action verb
 * (`packages/shared/src/types/effects.ts`), consumed alongside
 * `company-tap-characters` in the existing `attack-not-canceled` scan
 * (`combat-finalize.ts`): at combat finalization it picks
 * `min(defending company size, defender hand size)` random cards from the
 * defending player's hand (seeded shuffle) and reveals their identity via
 * `revealInstances` — the cards stay in hand, only their visibility changes.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, GIMLI, LEGOLAS,
  GLAMDRING, STING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeWildernessMHState, makeBorderMHState, makeShadowMHState, makeMHState,
  playCreatureHazardAndResolve, continueAutoAttackCombat,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const CREBAIN = 'tw-25' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const DARK_KEYING = { method: 'region-type' as const, value: RegionType.Dark };

/** Defending company at Moria facing the hazard player holding Crebain. */
function baseState(defenders: CardDefinitionId[], defenderHand: CardDefinitionId[] = []): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: defenders }],
        hand: defenderHand,
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [CREBAIN],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** Play Crebain keyed by `keying` and resolve the chain into combat. */
function attackWith(state: GameState, keying: { method: 'region-type'; value: string }): GameState {
  return playCreatureHazardAndResolve(
    state,
    PLAYER_2,
    handCardId(state, HAZARD_PLAYER),
    companyIdAt(state, RESOURCE_PLAYER),
    keying,
  );
}

describe('Crebain (tw-25)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: {b}{w}{s}{d}{R}{S}{D} ────────────────────────────────────

  test('keyable to Wilderness', () => {
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: makeWildernessMHState() };
    expect(viableActions(ready, PLAYER_2, 'play-hazard').some(a => a.viable)).toBe(true);
  });

  test('keyable to Border', () => {
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: makeBorderMHState() };
    expect(viableActions(ready, PLAYER_2, 'play-hazard').some(a => a.viable)).toBe(true);
  });

  test('keyable to Shadow-lands', () => {
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: makeShadowMHState() };
    expect(viableActions(ready, PLAYER_2, 'play-hazard').some(a => a.viable)).toBe(true);
  });

  test('keyable to Dark-domain', () => {
    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: darkMH };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === DARK_KEYING.method && a.keyedBy?.value === DARK_KEYING.value && p.viable;
    })).toBe(true);
  });

  test('NOT keyable off a coastal-sea path to a Free-hold (neither region nor site type match)', () => {
    const coastalMH = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: coastalMH };
    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 1: "Each character in the company faces one strike" ─────────

  test('1-character company: strikesTotal = 1, prowess 5', () => {
    const afterChain = attackWith({ ...baseState([ARAGORN]), phaseState: makeWildernessMHState() }, WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(5);
    expect(afterChain.combat!.eachCharacterFacesOneStrike).toBe(true);
  });

  test('2-character company: strikesTotal = 2', () => {
    const afterChain = attackWith({ ...baseState([ARAGORN, LEGOLAS]), phaseState: makeWildernessMHState() }, WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
  });

  test('3-character company: strikesTotal = 3', () => {
    const afterChain = attackWith({ ...baseState([ARAGORN, LEGOLAS, GIMLI]), phaseState: makeWildernessMHState() }, WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
  });

  // ─── Rule 2: reveal one random hand card per defending character ──────

  test('1-character company: exactly 1 random hand card is revealed after the attack', () => {
    const hand = [GLAMDRING, STING, BILBO];
    const start = { ...baseState([ARAGORN], hand), phaseState: makeWildernessMHState() };
    const afterChain = attackWith(start, WILDERNESS_KEYING);
    const originalHandIds = new Set(start.players[RESOURCE_PLAYER].hand.map(c => c.instanceId));

    const finalState = continueAutoAttackCombat(
      afterChain,
      [{ characterDefId: ARAGORN, roll: 10, bodyRoll: 12 }],
      PLAYER_1, PLAYER_2,
    ).state;

    expect(finalState.combat).toBeNull();
    // The 3-card hand is untouched — only the reveal record changes.
    const finalHandIds = finalState.players[RESOURCE_PLAYER].hand.map(c => c.instanceId);
    expect(new Set(finalHandIds)).toEqual(originalHandIds);

    const revealedHandIds = Object.keys(finalState.handRevealedInstances)
      .filter(id => originalHandIds.has(id as never));
    expect(revealedHandIds).toHaveLength(1);
  });

  test('2-character company: exactly 2 distinct random hand cards are revealed after the attack', () => {
    const hand = [GLAMDRING, STING, BILBO];
    const start = { ...baseState([ARAGORN, LEGOLAS], hand), phaseState: makeWildernessMHState() };
    const afterChain = attackWith(start, WILDERNESS_KEYING);
    const originalHandIds = new Set(start.players[RESOURCE_PLAYER].hand.map(c => c.instanceId));

    const finalState = continueAutoAttackCombat(
      afterChain,
      [
        { characterDefId: ARAGORN, roll: 10, bodyRoll: 12 },
        { characterDefId: LEGOLAS, roll: 10, bodyRoll: 12 },
      ],
      PLAYER_1, PLAYER_2,
    ).state;

    expect(finalState.combat).toBeNull();
    const revealedHandIds = Object.keys(finalState.handRevealedInstances)
      .filter(id => originalHandIds.has(id as never));
    expect(revealedHandIds).toHaveLength(2);
  });

  test('reveal count is clipped to hand size when the hand is smaller than the company', () => {
    const hand = [GLAMDRING];
    const start = { ...baseState([ARAGORN, LEGOLAS, GIMLI], hand), phaseState: makeWildernessMHState() };
    const afterChain = attackWith(start, WILDERNESS_KEYING);
    const originalHandIds = new Set(start.players[RESOURCE_PLAYER].hand.map(c => c.instanceId));
    expect(originalHandIds.size).toBe(1);

    const finalState = continueAutoAttackCombat(
      afterChain,
      [
        { characterDefId: ARAGORN, roll: 10, bodyRoll: 12 },
        { characterDefId: LEGOLAS, roll: 10, bodyRoll: 12 },
        { characterDefId: GIMLI, roll: 10, bodyRoll: 12 },
      ],
      PLAYER_1, PLAYER_2,
    ).state;

    expect(finalState.combat).toBeNull();
    const revealedHandIds = Object.keys(finalState.handRevealedInstances)
      .filter(id => originalHandIds.has(id as never));
    // Only 1 card exists in hand — cannot reveal 3 — reveals the 1 available.
    expect(revealedHandIds).toHaveLength(1);
  });

  test('an empty hand reveals nothing and does not error', () => {
    const start = { ...baseState([ARAGORN], []), phaseState: makeWildernessMHState() };
    const afterChain = attackWith(start, WILDERNESS_KEYING);

    const finalState = continueAutoAttackCombat(
      afterChain,
      [{ characterDefId: ARAGORN, roll: 10, bodyRoll: 12 }],
      PLAYER_1, PLAYER_2,
    ).state;

    expect(finalState.combat).toBeNull();
    expect(finalState.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(Object.keys(finalState.handRevealedInstances)).toHaveLength(0);
  });

  test('the reveal fires even when every strike is lost by the creature (attack still "not canceled")', () => {
    const hand = [GLAMDRING, STING];
    const start = { ...baseState([ARAGORN], hand), phaseState: makeWildernessMHState() };
    const afterChain = attackWith(start, WILDERNESS_KEYING);
    const originalHandIds = new Set(start.players[RESOURCE_PLAYER].hand.map(c => c.instanceId));

    // Roll 12 with untapped defense: Aragorn beats Crebain's prowess 5 easily.
    const finalState = continueAutoAttackCombat(
      afterChain,
      [{ characterDefId: ARAGORN, roll: 12, tapToFight: false }],
      PLAYER_1, PLAYER_2,
    ).state;

    expect(finalState.combat).toBeNull();
    const revealedHandIds = Object.keys(finalState.handRevealedInstances)
      .filter(id => originalHandIds.has(id as never));
    expect(revealedHandIds).toHaveLength(1);
  });
});

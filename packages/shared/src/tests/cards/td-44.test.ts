/**
 * @module td-44.test
 *
 * Card test: Leucaruth at Home (td-44)
 * Type: hazard-event (Permanent-event), neutral, unique,
 *       keyword `dragon-manifestation`, manifestId tw-48 (Leucaruth).
 *
 * Text:
 *   "Unique. Unless Leucaruth Ahunt is in play, Irerock has an additional
 *    automatic-attack: Dragon — 2 strikes at 17/8. In addition, only one
 *    unique Dragon manifestation may be played per turn."
 *
 * Effects:
 * | # | Effect Type        | Status | Notes                                                        |
 * |---|--------------------|--------|--------------------------------------------------------------|
 * | 1 | dragon-at-home     | OK     | +Dragon (2 strikes, 17 prowess, 8 body) on Irerock — hero      |
 * |   |                    |        | tw-402 and minion as-151, both `lairOf` tw-48; suppressed      |
 * |   |                    |        | while Leucaruth Ahunt (td-43) is in play                       |
 * | 2 | prohibit-card-play | OK     | `filter` = unique Dragon manifestation (g.man.3: a unique      |
 * |   |                    |        | `race: dragon` card — creature or Roused faction — or a        |
 * |   |                    |        | `dragon-manifestation` Ahunt/At Home event), `maxPerTurn: 1`   |
 *
 * Rule coverage:
 * | # | Rule                                                                     | Status      |
 * |---|--------------------------------------------------------------------------|-------------|
 * | 1 | Irerock gains a second automatic-attack: Dragon 2 strikes at 17/8         | IMPLEMENTED |
 * | 2 | Both site versions are augmented (hero tw-402, minion as-151)            | IMPLEMENTED |
 * | 3 | Leucaruth Ahunt (td-43) in play suppresses the augmentation              | IMPLEMENTED |
 * | 4 | Only Leucaruth's lair is augmented                                       | IMPLEMENTED |
 * | 5 | First unique Dragon manifestation of the turn remains playable           | IMPLEMENTED |
 * | 6 | A second one the same turn is not playable (event and Roused faction)    | IMPLEMENTED |
 * | 7 | Leucaruth at Home's own play counts as that turn's manifestation         | IMPLEMENTED |
 * | 8 | A unique Dragon creature played earlier this turn counts                 | IMPLEMENTED |
 * | 9 | Plays from a previous turn do not count                                  | IMPLEMENTED |
 * | 10| Non-manifestation hazards are unaffected                                 | IMPLEMENTED |
 * | 11| Without Leucaruth at Home in play there is no per-turn limit             | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, RIVENDELL, MINAS_TIRITH, MORIA,
  buildTestState, buildSitePhaseState, resetMint, makeMHState,
  addCardInPlay, companyIdAt, playHazardAndResolve, findHandCardId,
  dispatch, viableActionsForHandCard, firstFactionInfluenceAttempt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard } from '../../index.js';

const LEUCARUTH_AT_HOME = 'td-44' as CardDefinitionId;
const LEUCARUTH_AHUNT = 'td-43' as CardDefinitionId;
const IREROCK_HERO = 'tw-402' as CardDefinitionId;      // Leucaruth's lair (lairOf tw-48), hero version
const IREROCK_MINION = 'as-151' as CardDefinitionId;    // Leucaruth's lair (lairOf tw-48), minion version
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;   // Smaug's lair — a different Dragon
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;      // unique Dragon manifestation (permanent-event)
const SCATHA_AHUNT = 'td-61' as CardDefinitionId;       // unique Dragon manifestation (long-event)
const SMAUG = 'tw-90' as CardDefinitionId;              // unique Dragon creature
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;     // non-manifestation hazard permanent-event
const SMAUG_ROUSED = 'le-285' as CardDefinitionId;      // unique Dragon manifestation (Roused faction)
const LONELY_MOUNTAIN_MINION = 'le-387' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;

/** Movement/hazard state with the given cards in the hazard player's hand. */
function mhState(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** Pretend `defIds` were already played during the state's current turn. */
function withPlayed(state: GameState, defIds: CardDefinitionId[], turnNumber = state.turnNumber): GameState {
  return { ...state, cardsPlayedThisTurn: { turnNumber, definitionIds: defIds } };
}

function canPlayHazard(state: GameState, defId: CardDefinitionId): boolean {
  return viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, defId).length > 0;
}

function sitesState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Leucaruth at Home (td-44)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Irerock has only its printed Dragon attack when no At-Home is in play', () => {
    const state = sitesState();
    const attacks = getActiveAutoAttacks(state, state.cardPool[IREROCK_HERO] as SiteCard);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
  });

  test('At-Home in play appends the extra Dragon (2 strikes at 17/8) to hero Irerock', () => {
    const state = addCardInPlay(sitesState(), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    const attacks = getActiveAutoAttacks(state, state.cardPool[IREROCK_HERO] as SiteCard);
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 17, body: 8 });
  });

  test('At-Home also augments the minion version of Irerock (as-151)', () => {
    const state = addCardInPlay(sitesState(), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    const attacks = getActiveAutoAttacks(state, state.cardPool[IREROCK_MINION] as SiteCard);
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 17, body: 8 });
  });

  test('Leucaruth Ahunt in play suppresses the At-Home augmentation', () => {
    const state = addCardInPlay(addCardInPlay(sitesState(), HAZARD_PLAYER, LEUCARUTH_AT_HOME), HAZARD_PLAYER, LEUCARUTH_AHUNT);
    expect(getActiveAutoAttacks(state, state.cardPool[IREROCK_HERO] as SiteCard)).toHaveLength(1);
    expect(getActiveAutoAttacks(state, state.cardPool[IREROCK_MINION] as SiteCard)).toHaveLength(1);
  });

  test("At-Home augments only Leucaruth's lair, not a different Dragon's lair", () => {
    const state = addCardInPlay(sitesState(), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    expect(getActiveAutoAttacks(state, state.cardPool[LONELY_MOUNTAIN] as SiteCard)).toHaveLength(1);
  });

  // ─── only one unique Dragon manifestation per turn ────────────────────────

  test('the first unique Dragon manifestation of the turn is still playable', () => {
    const state = addCardInPlay(mhState([SMAUG_AT_HOME, SCATHA_AHUNT]), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    expect(canPlayHazard(state, SMAUG_AT_HOME)).toBe(true);
    expect(canPlayHazard(state, SCATHA_AHUNT)).toBe(true);
  });

  test('after one is played, a second unique Dragon manifestation is not playable that turn', () => {
    const start = addCardInPlay(mhState([SMAUG_AT_HOME, SCATHA_AHUNT]), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    const after = playHazardAndResolve(start, PLAYER_2, findHandCardId(start, HAZARD_PLAYER, SMAUG_AT_HOME), companyIdAt(start, RESOURCE_PLAYER));

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(SMAUG_AT_HOME);
    expect(after.cardsPlayedThisTurn?.definitionIds).toContain(SMAUG_AT_HOME);
    expect(canPlayHazard(after, SCATHA_AHUNT)).toBe(false);
  });

  test("Leucaruth at Home's own play is that turn's unique Dragon manifestation", () => {
    const start = mhState([LEUCARUTH_AT_HOME, SMAUG_AT_HOME]);
    const after = playHazardAndResolve(start, PLAYER_2, findHandCardId(start, HAZARD_PLAYER, LEUCARUTH_AT_HOME), companyIdAt(start, RESOURCE_PLAYER));

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(LEUCARUTH_AT_HOME);
    expect(canPlayHazard(after, SMAUG_AT_HOME)).toBe(false);
  });

  test('a unique Dragon creature played earlier this turn counts toward the limit', () => {
    const state = withPlayed(addCardInPlay(mhState([SCATHA_AHUNT]), HAZARD_PLAYER, LEUCARUTH_AT_HOME), [SMAUG]);
    expect(canPlayHazard(state, SCATHA_AHUNT)).toBe(false);
  });

  test('manifestations played on a previous turn do not count', () => {
    const base = addCardInPlay(mhState([SCATHA_AHUNT]), HAZARD_PLAYER, LEUCARUTH_AT_HOME);
    const state = withPlayed(base, [SMAUG_AT_HOME], base.turnNumber - 1);
    expect(canPlayHazard(state, SCATHA_AHUNT)).toBe(true);
  });

  test('non-manifestation hazards stay playable after a manifestation was played', () => {
    const state = withPlayed(addCardInPlay(mhState([DOORS_OF_NIGHT]), HAZARD_PLAYER, LEUCARUTH_AT_HOME), [SMAUG_AT_HOME]);
    expect(canPlayHazard(state, DOORS_OF_NIGHT)).toBe(true);
  });

  test('control: without Leucaruth at Home in play, a second manifestation is playable', () => {
    const state = withPlayed(mhState([SCATHA_AHUNT]), [SMAUG_AT_HOME]);
    expect(canPlayHazard(state, SCATHA_AHUNT)).toBe(true);
  });

  test("a Dragon's Roused faction cannot be influenced once a manifestation was played this turn", () => {
    const base = addCardInPlay(
      buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN_MINION, hand: [SMAUG_ROUSED] }),
      HAZARD_PLAYER, LEUCARUTH_AT_HOME,
    );
    const factionId = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    expect(firstFactionInfluenceAttempt(base, factionId)).toBeDefined();
    expect(firstFactionInfluenceAttempt(withPlayed(base, [SCATHA_AHUNT]), factionId)).toBeUndefined();
  });

  test('influencing a Roused faction is recorded as playing a manifestation', () => {
    const base = addCardInPlay(
      buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN_MINION, hand: [SMAUG_ROUSED] }),
      HAZARD_PLAYER, LEUCARUTH_AT_HOME,
    );
    const attempt = firstFactionInfluenceAttempt(base, base.players[RESOURCE_PLAYER].hand[0].instanceId);
    expect(attempt).toBeDefined();
    const after = dispatch(base, attempt!);
    expect(after.cardsPlayedThisTurn).toEqual({ turnNumber: base.turnNumber, definitionIds: [SMAUG_ROUSED] });
  });
});

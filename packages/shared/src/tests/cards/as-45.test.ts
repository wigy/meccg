/**
 * @module as-45.test
 *
 * Card test: Alliance of Free Peoples (as-45)
 * Type: hero-resource-event, alignment wizard, non-unique.
 * Subtype: Permanent-event. Marshalling Points: 0 (misc).
 *
 * Text:
 *   "If at least one hero Dwarf faction, one hero Elf faction, and one hero Man
 *    faction is in play, all hero Dwarf factions, hero Elf factions, and hero
 *    Man factions give an additional marshalling point. Discard when any hero
 *    Dwarf faction, hero Elf faction, or hero Man faction is discarded from play.
 *    Cannot be duplicated."
 *
 * Effects:
 * | # | Effect Type                  | Status | Notes                                             |
 * |---|------------------------------|--------|---------------------------------------------------|
 * | 1 | faction-mp-bonus             | OK     | +1 MP to each Dwarf/Elf/Man faction while the     |
 * |   |                              |        | controller fields all three races                 |
 * | 2 | discard-on-card-leaves-play  | OK     | self-discard when a Dwarf/Elf/Man faction leaves   |
 * | 3 | duplication-limit (game)     | OK     | "Cannot be duplicated" — one copy in play at once  |
 *
 * Rule coverage:
 * | # | Rule                                                                     | Status      |
 * |---|--------------------------------------------------------------------------|-------------|
 * | 1 | +1 MP to each Dwarf/Elf/Man faction while all three races are in play     | IMPLEMENTED |
 * | 2 | No bonus without the card (the +MP comes from Alliance)                   | IMPLEMENTED |
 * | 3 | No bonus while the race-diversity gate fails (a race missing)             | IMPLEMENTED |
 * | 4 | Every qualifying faction is boosted (two Men → both +1)                   | IMPLEMENTED |
 * | 5 | A Dúnadan faction is NOT boosted ("Man" is literal race)                  | IMPLEMENTED |
 * | 6 | Discarded when a qualifying faction leaves play (even if the gate holds)  | IMPLEMENTED |
 * | 7 | NOT discarded when a non-qualifying (Wose) faction leaves play            | IMPLEMENTED |
 * | 8 | Cannot be played while a copy is already in play (duplication-limit)      | IMPLEMENTED |
 * | 9 | Playable as a permanent-event when no copy is in play                     | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   ALLIANCE (as-45)              - this card
 *   BLUE_MOUNTAIN_DWARVES (tw-200)- dwarf faction, 3 MP
 *   ELVES_OF_LINDON (tw-226)      - elf faction, 2 MP
 *   RIDERS_OF_ROHAN (tw-317)      - man faction, 3 MP
 *   WOODMEN (tw-368)              - man faction, 2 MP (second Man)
 *   KNIGHTS_DOL_AMROTH (tw-263)   - dúnadan faction, 3 MP (not a "Man" faction)
 *   WOSES_DRUADAN (tw-370)        - wose faction (non-qualifying)
 *   ARAGORN (tw-120), RIVENDELL (tw-421) - hero company / haven
 *   CARN_DUM (le-359)             - opponent (minion) site
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, findHandCardId,
  addCardInPlay,
  ARAGORN, RIVENDELL, LORIEN,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { applyDiscardOnCardLeaves } from '../../engine/discard-on-card-leaves.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  PlayPermanentEventAction,
} from '../../index.js';

const ALLIANCE = 'as-45' as CardDefinitionId;
const BLUE_MOUNTAIN_DWARVES = 'tw-200' as CardDefinitionId;
const ELVES_OF_LINDON = 'tw-226' as CardDefinitionId;
const RIDERS_OF_ROHAN = 'tw-317' as CardDefinitionId;
const WOODMEN = 'tw-368' as CardDefinitionId;
const KNIGHTS_DOL_AMROTH = 'tw-263' as CardDefinitionId;
const WOSES_DRUADAN = 'tw-370' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

/** A CardInPlay entry with an explicit instance id (for stable prev/next diffs). */
const cip = (definitionId: CardDefinitionId, instanceId: string): CardInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped });

/** Build a hero-vs-minion state with a fixed set of the hero's in-play cards. */
const heroState = (inPlay: CardInPlay[], phase: Phase = Phase.Organization): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [], siteDeck: [LORIEN], cardsInPlay: inPlay },
      { id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
    ],
  });

describe('Alliance of Free Peoples (as-45)', () => {
  beforeEach(() => resetMint());

  // ─── Conditional faction marshalling-point bonus ─────────────────────────────

  test('grants +1 MP to each Dwarf/Elf/Man faction while all three races are in play', () => {
    // Base faction MP: Dwarf 3 + Elf 2 + Man 3 = 8. Alliance's gate holds
    // (all three races present) → +1 to each of the three factions = 11.
    const withAlliance = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
    ]);
    expect(withAlliance.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(11);
  });

  test('without the card in play, the same factions give their printed MP (no bonus)', () => {
    const noAlliance = heroState([
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
    ]);
    expect(noAlliance.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(8);
  });

  test('grants no bonus while the race-diversity gate fails (no Man faction in play)', () => {
    // Dwarf 3 + Elf 2 = 5, but no Man faction → gate fails → Alliance adds nothing.
    const gateFails = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
    ]);
    expect(gateFails.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(5);
  });

  test('boosts every qualifying faction — two Man factions each gain +1', () => {
    // Dwarf 3 + Elf 2 + Man(Rohan) 3 + Man(Woodmen) 2 = 10 base; gate holds →
    // +1 to all four qualifying factions = 14.
    const twoMen = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
      cip(WOODMEN, 'm2'),
    ]);
    expect(twoMen.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(14);
  });

  test('does NOT boost a Dúnadan faction ("Man" is the literal faction race)', () => {
    // Dwarf 3 + Elf 2 + Man 3 + Dúnadan(Knights of Dol Amroth) 3 = 11 base.
    // Gate holds → +1 to the three Dwarf/Elf/Man factions only = 14 (not 15).
    const withDunadan = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
      cip(KNIGHTS_DOL_AMROTH, 'k1'),
    ]);
    expect(withDunadan.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(14);
  });

  // ─── Self-discard when a qualifying faction leaves play ───────────────────────

  test('is discarded when a Man faction leaves play — even while the gate still holds', () => {
    // Two Man factions present, so removing one keeps the gate satisfied, yet the
    // printed "any … faction … discarded" still discards Alliance.
    const prev = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
      cip(WOODMEN, 'm2'),
    ]);
    const p0 = prev.players[RESOURCE_PLAYER];
    const woodmen = p0.cardsInPlay.find(c => c.definitionId === WOODMEN)!;
    // Simulate the Woodmen faction being discarded from play.
    const next: GameState = {
      ...prev,
      players: [
        { ...p0,
          cardsInPlay: p0.cardsInPlay.filter(c => c.instanceId !== woodmen.instanceId),
          discardPile: [...p0.discardPile, { instanceId: woodmen.instanceId, definitionId: WOODMEN }] },
        prev.players[1],
      ] as GameState['players'],
    };

    const after = applyDiscardOnCardLeaves(prev, next);
    const ap0 = after.players[RESOURCE_PLAYER];
    expect(ap0.cardsInPlay.some(c => c.definitionId === ALLIANCE)).toBe(false);
    expect(ap0.discardPile.some(c => c.definitionId === ALLIANCE)).toBe(true);
  });

  test('is NOT discarded when a non-qualifying (Wose) faction leaves play', () => {
    const prev = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
      cip(WOSES_DRUADAN, 'w1'),
    ]);
    const p0 = prev.players[RESOURCE_PLAYER];
    const woses = p0.cardsInPlay.find(c => c.definitionId === WOSES_DRUADAN)!;
    const next: GameState = {
      ...prev,
      players: [
        { ...p0,
          cardsInPlay: p0.cardsInPlay.filter(c => c.instanceId !== woses.instanceId),
          discardPile: [...p0.discardPile, { instanceId: woses.instanceId, definitionId: WOSES_DRUADAN }] },
        prev.players[1],
      ] as GameState['players'],
    };

    const after = applyDiscardOnCardLeaves(prev, next);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ALLIANCE)).toBe(true);
  });

  test('stays in play when nothing left the controller\'s play area this step', () => {
    const prev = heroState([
      cip(ALLIANCE, 'a1'),
      cip(BLUE_MOUNTAIN_DWARVES, 'd1'),
      cip(ELVES_OF_LINDON, 'e1'),
      cip(RIDERS_OF_ROHAN, 'm1'),
    ]);
    const after = applyDiscardOnCardLeaves(prev, prev);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ALLIANCE)).toBe(true);
  });

  // ─── "Cannot be duplicated" (duplication-limit, scope game) ───────────────────

  test('is playable as a permanent-event when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ALLIANCE], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const inst = findHandCardId(state, RESOURCE_PLAYER, ALLIANCE);
    const play = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .find(a => a.cardInstanceId === inst);
    expect(play).toBeDefined();
  });

  test('cannot be played while a copy is already in play (Cannot be duplicated)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ALLIANCE], siteDeck: [LORIEN], cardsInPlay: [cip(ALLIANCE, 'a1')] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const inst = findHandCardId(state, RESOURCE_PLAYER, ALLIANCE);
    const play = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .find(a => a.cardInstanceId === inst);
    expect(play).toBeUndefined();
  });
});

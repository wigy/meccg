/**
 * @module ba-25.test
 *
 * Card test: The Sun Shone Fiercely (ba-25)
 * Type: hazard-event (long, environment)
 * Effects: 3 (duplication-limit, 2 stat-modifiers)
 *
 * "Environment. -1 prowess to all Orc, Troll, Dwarf, and Ringwraith characters
 *  not at, nor moving to or from, an Under-deeps site. This modification is -2
 *  if Doors of Night is not in play. Cannot be duplicated."
 *
 * Modeled as a base -2 prowess penalty on all-characters of race
 * orc/troll/dwarf/ringwraith whose company is NOT at/moving-to/from an
 * Under-deeps site, plus a +1 softening when Doors of Night is in play
 * (net -1 with DoN, -2 without) — the additive GoM/DoN idiom used by Sun
 * (tw-335). The Under-deeps exemption reads the character's company's
 * `currentSite` / `destinationSite` via `bearer.atOrMovingUnderDeeps`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint, getCharacter, baseProwess,
  addCardInPlay, makeMHState, viableActions,
  GIMLI, ARAGORN, GALADRIEL, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const SUN_SHONE = 'ba-25' as CardDefinitionId;

// Matching races (penalised).
const GORBAG = 'le-11' as CardDefinitionId;                 // orc, prowess 6
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;  // troll, prowess 7
const THE_WITCH_KING = 'le-58' as CardDefinitionId;         // ringwraith, prowess 9

// Non-under-deeps minion free-hold, for minion-aligned fixtures.
const BAG_END_LE = 'le-350' as CardDefinitionId;
// Under-deeps site (dark-hold) — grants the exemption.
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;

function doorsOfNightInPlay(): CardInPlay {
  return { instanceId: 'don-1' as CardInstanceId, definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped };
}

describe('The Sun Shone Fiercely (ba-25)', () => {
  beforeEach(() => resetMint());

  // ─── Base penalty: -1 with Doors of Night, -2 without ─────────────────────

  test('Dwarf character: -1 prowess when Doors of Night is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }, doorsOfNightInPlay()] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI) - 1);
  });

  test('Dwarf character: -2 prowess when Doors of Night is NOT in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI) - 2);
  });

  // ─── Every matching race is penalised (Orc / Troll / Ringwraith) ──────────

  test.each([
    { label: 'Orc', defId: GORBAG },
    { label: 'Troll', defId: LIEUTENANT_DOL_GULDUR },
    { label: 'Ringwraith', defId: THE_WITCH_KING },
  ])('$label character is penalised -2 (no Doors of Night)', ({ defId }) => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: BAG_END_LE, characters: [defId] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, defId).effectiveStats.prowess).toBe(baseProwess(defId) - 2);
  });

  // ─── Non-matching races are unaffected ────────────────────────────────────

  test.each([
    { label: 'Dúnadan (Aragorn)', defId: ARAGORN },
    { label: 'Elf (Galadriel)', defId: GALADRIEL },
  ])('$label is unaffected', ({ defId }) => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [defId] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, defId).effectiveStats.prowess).toBe(baseProwess(defId));
  });

  // ─── Under-deeps exemption: at / moving-to / moving-from ──────────────────

  test('exempt while AT an Under-deeps site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [GIMLI] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    // No penalty despite the environment (and no Doors of Night).
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI));
  });

  test('exempt while MOVING TO an Under-deeps site (destination)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI], destinationSite: UNDER_GALLERIES }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI));
  });

  test('exempt while MOVING FROM an Under-deeps site (currentSite is the origin during M/H)', () => {
    // A company moving away from the Under-deeps: its currentSite is still the
    // Under-deeps origin (only replaced by the destination at step 8), with a
    // surface destination planned. Still exempt.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [GIMLI], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI));
  });

  // ─── Environment affects both players' characters ─────────────────────────

  test('affects the opponent of the environment controller', () => {
    // The environment sits in P1's cardsInPlay; it still penalises P2's Dwarf.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });
    const withEnv = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, SUN_SHONE));

    expect(getCharacter(withEnv, HAZARD_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI) - 2);
  });

  // ─── Cannot be duplicated (duplication-limit scope game) ──────────────────

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [SUN_SHONE], siteDeck: [],
          cardsInPlay: [{ instanceId: 'sun-1' as CardInstanceId, definitionId: SUN_SHONE, status: CardStatus.Untapped }] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('is playable when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [SUN_SHONE], siteDeck: [] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });
});

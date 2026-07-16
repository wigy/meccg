/**
 * @module wh-8.test
 *
 * Card test: Radagast (wh-8)
 * Type: hero-character (Fallen-wizard avatar)
 *
 * Printed text:
 *   "Unique. Your unique factions that are neither Man, Dwarf, Dúnadan, Hobbit,
 *    Orc, nor Troll are each worth 2 marshalling points. Your hero allies each
 *    are worth full marshalling points. Hero allies Radagast controls have no
 *    movement restrictions. When Radagast's new site is revealed, he may draw
 *    one additional card for each Wilderness [{w}] in his company's site path."
 *
 * Card shape (data):
 *   - Fallen-wizard avatar; `race: 'fallen-wizard'`.
 *   - effects:
 *     1. faction-mp-override — the player's *unique* factions whose race is NOT
 *        one of Man/Dwarf/Dúnadan/Hobbit/Orc/Troll are each worth 2 MP, replacing
 *        both the printed value and the MEWH §4 flat-1 Fallen-wizard clamp.
 *     2. fw-ally-mp-full (player-wide, filter cardType hero-resource-ally) — the
 *        player's hero allies score full printed MP instead of the §4 1-MP clamp.
 *     3. ally-movement-restriction-exemption (filter cardType hero-resource-ally)
 *        — the player's hero allies are exempt from their printed "Discard if the
 *        company moves to …" restriction (their `bearer-company-moves` self-
 *        discard, CRF 22).
 *     4. draw-modifier — +1 resource draw per Wilderness in the moving company's
 *        site path (`value: "sitePath.wildernessCount"`).
 *
 * These tests drive the recompute / movement / draw-step pipelines; the card
 * shape is documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  addCardInPlay, recomputeDerived, attachAllyToChar,
  makeMHState, makePlayDeck, dispatch, findCharInstanceId, getCharacter,
  phaseStateAs, buildMHOrderEffectsDrawState, assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Alignment, RegionType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const RADAGAST_FW = 'wh-8' as CardDefinitionId; // the card under test
const SARUMAN_FW  = 'wh-9' as CardDefinitionId; // a different FW avatar (no Radagast rules) — control

// Unique factions of races NOT in Radagast's excluded list → re-valued to 2.
const WOOD_ELVES   = 'tw-367' as CardDefinitionId; // elf, unique, printed 3
const GREAT_EAGLES = 'tw-344' as CardDefinitionId; // eagle, unique, printed 3
// A unique faction of an *excluded* race (Man) — stays FW-clamped to 1.
const MEN_OF_DALE  = 'td-138' as CardDefinitionId; // man, unique, printed 2
// A *non-unique* faction of a non-excluded race — the "unique" qualifier keeps it clamped.
const PANOPLY_WINGS = 'wh-37' as CardDefinitionId; // animal, non-unique, printed 1

// A hero ally with printed MP 2 — clamped to 1 for a FW without Radagast.
const TREEBEARD = 'tw-353' as CardDefinitionId; // hero-resource-ally, printed 2

// A hero ally carrying a printed movement restriction (bearer-company-moves
// self-discard): discarded if its company moves outside its allowed sites.
const MISTRESS_LOBELIA = 'dm-178' as CardDefinitionId; // hero-resource-ally

/** A Fallen-wizard (player 0) at Isengard with the given avatar, plus an idle opponent. */
function fwState(avatar: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar] }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

describe('Radagast (wh-8)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: unique non-Man/Dwarf/Dúnadan/Hobbit/Orc/Troll factions → 2 MP ─

  test('unique factions of non-excluded races are each re-valued to 2 MP', () => {
    // Wood-elves (elf, printed 3) and Great Eagles (eagle, printed 3). Without
    // Radagast each would be FW-clamped to 1 (total 2); with Radagast each is 2.
    let state = fwState(RADAGAST_FW);
    for (const f of [WOOD_ELVES, GREAT_EAGLES]) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(4);
  });

  test('control: without Radagast the same factions are FW-clamped to 1 each', () => {
    // Saruman (a FW avatar without the faction override) → §4 clamp → 1 + 1 = 2.
    let state = fwState(SARUMAN_FW);
    for (const f of [WOOD_ELVES, GREAT_EAGLES]) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('a unique faction of an excluded race (Men of Dale / Man) is NOT re-valued', () => {
    // Man is in Radagast's excluded list → the rule does not match → §4 clamp → 1.
    let state = fwState(RADAGAST_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, MEN_OF_DALE);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('a NON-unique faction of a non-excluded race is NOT re-valued (unique qualifier)', () => {
    // A Panoply of Wings (animal, non-unique) — the rule only re-values *unique*
    // factions, so it stays FW-clamped to 1 even though animal is non-excluded.
    let state = fwState(RADAGAST_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, PANOPLY_WINGS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule 2: hero allies worth full marshalling points ─────────────────────

  test('a hero ally scores full printed MP (2) while Radagast is in play', () => {
    // Treebeard (hero-resource-ally, printed 2). MEWH §4 would clamp him to 1;
    // Radagast's fw-ally-mp-full lifts hero allies to full printed MP.
    let state = fwState(RADAGAST_FW);
    state = attachAllyToChar(state, RESOURCE_PLAYER, RADAGAST_FW, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('control: without Radagast the same hero ally is FW-clamped to 1', () => {
    let state = fwState(SARUMAN_FW);
    state = attachAllyToChar(state, RESOURCE_PLAYER, SARUMAN_FW, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Rule 3: hero allies Radagast controls have no movement restrictions ───

  /**
   * Build a Fallen-wizard M/H fixture: `avatar`'s company at Isengard bearing
   * Mistress Lobelia, moving to Rivendell (a site outside Lobelia's allowed set,
   * so her printed `bearer-company-moves` self-discard would normally fire).
   */
  function movingFwState(avatar: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [avatar] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, avatar, MISTRESS_LOBELIA);
    const destCard = withAlly.players[0].siteDeck[0];
    const p0 = {
      ...withAlly.players[0],
      companies: [{
        ...withAlly.players[0].companies[0],
        destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
      }],
    };
    return {
      ...withAlly,
      players: [p0, withAlly.players[1]] as typeof withAlly.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
  }

  /** Drive the company's movement to completion (both players pass through step 8). */
  function completeMove(state: GameState): GameState {
    const afterResource = dispatch(state, { type: 'pass', player: PLAYER_1 });
    return dispatch(afterResource, { type: 'pass', player: PLAYER_2 });
  }

  test('a hero ally with a printed move restriction is KEPT when its company moves under Radagast', () => {
    const state = movingFwState(RADAGAST_FW);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST_FW);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST_FW).allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);

    const after = completeMove(state);

    // Radagast lifts the movement restriction → Lobelia survives the move to Rivendell.
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MISTRESS_LOBELIA)).toBe(false);
    assertEveryInstanceReachable(after);
  });

  test('control: without Radagast the same hero ally IS discarded on the disallowed move', () => {
    // Saruman avatar — no movement-restriction exemption → Lobelia's own
    // `bearer-company-moves` self-discard fires on the move to Rivendell.
    const state = movingFwState(SARUMAN_FW);
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN_FW);

    const after = completeMove(state);

    expect(after.players[RESOURCE_PLAYER].characters[sarumanId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MISTRESS_LOBELIA)).toBe(true);
    assertEveryInstanceReachable(after);
  });

  // ─── Rule 4: +1 resource draw per Wilderness in the site path ──────────────

  test('+2 resource draws when the site path has 2 Wildernesses', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST_FW, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
      pathNames: ['Hollin', 'Enedhwaith'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Moria base resource draws = 2, +2 wildernesses → 4. Hazard draws unchanged.
    expect(resultMH.resourceDrawMax).toBe(4);
    expect(resultMH.hazardDrawMax).toBe(3);
  });

  test('no extra resource draws when the site path has no Wildernesses', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [RADAGAST_FW, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Shadow, RegionType.Dark],
      pathNames: ['Imlad Morgul', 'Gorgoroth'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    // Shadow/Dark regions don't count → Moria's base resource draws = 2.
    expect(resultMH.resourceDrawMax).toBe(2);
  });

  test('control: without Radagast in the company, wildernesses do not boost resource draws', () => {
    const testState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN, LEGOLAS],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
      pathNames: ['Hollin', 'Enedhwaith'],
    });

    const result = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const resultMH = phaseStateAs<MovementHazardPhaseState>(result);

    expect(resultMH.step).toBe('draw-cards');
    expect(resultMH.resourceDrawMax).toBe(2);
  });

  test('sanity: computeLegalActions runs for a Radagast FW company (no crash)', () => {
    const state = fwState(RADAGAST_FW);
    expect(() => computeLegalActions(state, PLAYER_1)).not.toThrow();
  });
});

/**
 * @module td-71.test
 *
 * Card test: Smaug at Home (td-71)
 * Type: hazard-event (permanent), unique, keyword `dragon-manifestation`,
 * manifestId tw-90 (Smaug), 5 kill MP
 *
 * Text:
 *   "Unique. Unless Smaug Ahunt is in play, The Lonely Mountain has an
 *    additional automatic-attack: Dragon — 2 strikes at 18/8. In addition,
 *    each moving company draws one less card to a minimum of one at the start
 *    of its movement/hazard phase."
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                                          |
 * |---|----------------|--------|----------------------------------------------------------------|
 * | 1 | dragon-at-home | OK     | +Dragon (2 strikes, 18 prow, 8 body) on The Lonely Mountain      |
 * |   |                |        | (hero tw-428 and minion le-387, both lairOf tw-90); suppressed   |
 * |   |                |        | while Smaug Ahunt (td-70, same manifestId) is in play            |
 * | 2 | draw-modifier  | OK     | draw resource, value -1, min 1, appliesTo "any-company" — the   |
 * |   |                |        | moving company's own (resource) draws shrink by one, floored at |
 * |   |                |        | one, and the modifier reaches across the table from the hazard  |
 * |   |                |        | player's cardsInPlay                                            |
 *
 * "…each moving company draws…" is the company's own draw pool (the resource
 * player's lighter box, CoE 2.IV.v), the same reading as A Short Rest (td-95)
 * "each moving company may draw an extra card". The hazard player's draws are
 * untouched. "To a minimum of one" floors the *reduction* only: a company that
 * may draw no resource cards at all (no character with mind ≥ 3) is not handed
 * one. Only the auto-attack clause is gated on Smaug Ahunt — the draw clause
 * ("In addition, …") keeps working while the Ahunt is in play.
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, RIVENDELL, MINAS_TIRITH, MORIA,
  buildTestState, resetMint, makeMHState, dispatch,
  addCardInPlay, handCardId, companyIdAt, playHazardAndResolve,
  buildMHOrderEffectsDrawState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, Alignment, RegionType } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SiteCard, MovementHazardPhaseState,
} from '../../index.js';

const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const LONELY_MOUNTAIN_HERO = 'tw-428' as CardDefinitionId;   // Smaug's lair (lairOf tw-90), hero version
const LONELY_MOUNTAIN_MINION = 'le-387' as CardDefinitionId; // Smaug's lair (lairOf tw-90), minion version
const DANCING_SPIRE = 'tw-383' as CardDefinitionId;          // a different Dragon's lair (Daelomin, tw-26)
const BARLIMAN = 'tw-125' as CardDefinitionId;               // mind 1 — no draw-eligible character
const WEATHERTOP = 'tw-436' as CardDefinitionId;             // resourceDraws 1, hazardDraws 1

// Moria's printed draw boxes (the baseline destination in the draw scenarios).
const MORIA_RESOURCE_DRAWS = 2;
const MORIA_HAZARD_DRAWS = 3;

describe('Smaug at Home (td-71)', () => {
  beforeEach(() => resetMint());

  // ─── placement in play ────────────────────────────────────────────────────

  test('enters the general play area — not bound to the hazarded company', () => {
    // Smaug at Home declares no `play-target`: it augments The Lonely Mountain
    // and every moving company's draws, regardless of company. The company named
    // by the play-hazard action is only the company being hazarded (hazard-limit
    // bookkeeping) and must NOT bind the card.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SMAUG_AT_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);
    const companyId = companyIdAt(mhState, RESOURCE_PLAYER);
    const s = playHazardAndResolve(mhState, PLAYER_2, cardId, companyId);

    const inPlay = s.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SMAUG_AT_HOME);
    expect(inPlay).toBeDefined();
    expect(inPlay!.companyId).toBeUndefined();
  });

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('The Lonely Mountain has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const lonely = state.cardPool[LONELY_MOUNTAIN_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
  });

  test('At-Home in play appends the extra Dragon (2 strikes, 18 prowess) to hero The Lonely Mountain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SMAUG_AT_HOME);
    const lonely = state.cardPool[LONELY_MOUNTAIN_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18, body: 8 });
  });

  test('At-Home also augments the minion version of The Lonely Mountain (le-387)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SMAUG_AT_HOME);
    const lonelyMinion = state.cardPool[LONELY_MOUNTAIN_MINION] as SiteCard;
    const attacks = getActiveAutoAttacks(state, lonelyMinion);
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 18, body: 8 });
  });

  test('Smaug Ahunt in play suppresses the At-Home augmentation', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(addCardInPlay(base, HAZARD_PLAYER, SMAUG_AT_HOME), HAZARD_PLAYER, SMAUG_AHUNT);
    expect(getActiveAutoAttacks(state, state.cardPool[LONELY_MOUNTAIN_HERO] as SiteCard)).toHaveLength(1);
    expect(getActiveAutoAttacks(state, state.cardPool[LONELY_MOUNTAIN_MINION] as SiteCard)).toHaveLength(1);
  });

  test("At-Home augments only Smaug's lair, not a different Dragon's lair", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SMAUG_AT_HOME);
    // Dancing Spire is Daelomin's lair (lairOf tw-26) → unaffected by Smaug at Home.
    expect(getActiveAutoAttacks(state, state.cardPool[DANCING_SPIRE] as SiteCard)).toHaveLength(1);
  });

  // ─── draw-modifier: each moving company draws one less ─────────────────────

  test("the hazard player's At-Home reduces the moving company's resource draws by one", () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('draw-cards');
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS - 1);
    // Only the company's own pool shrinks — the hazard player still draws fully.
    expect(mh.hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  test('no reduction without Smaug at Home in play (the card is the source)', () => {
    const state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS);
    expect(mh.hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  test('"each moving company" also covers the controller\'s own moving companies', () => {
    // The card stays in play across turns: when the player holding it is the
    // moving (resource) player, their own companies draw one less too.
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, SMAUG_AT_HOME);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS - 1);
  });

  test('a one-draw site keeps its single draw ("to a minimum of one")', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: WEATHERTOP, // resourceDraws 1
      heroSiteDeck: [WEATHERTOP],
      pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(1);
  });

  test('a company with no character of mind ≥ 3 still draws nothing (the floor is not a grant)', () => {
    // CoE 2.IV.v: the resource player may only draw with an avatar or a
    // character of mind ≥ 3 in the moving company. Barliman Butterbur (mind 1)
    // alone → 0 resource draws, and "minimum of one" must not raise that.
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [BARLIMAN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(0);
    expect(mh.hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  test('the draw reduction survives Smaug Ahunt (only the auto-attack clause is gated)', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME), HAZARD_PLAYER, SMAUG_AHUNT);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.step).toBe('draw-cards');
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS - 1);
  });

  test('end-to-end: the moving player can only draw the reduced number of cards', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    let after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((after.phaseState as MovementHazardPhaseState).resourceDrawMax).toBe(1);

    const handBefore = after.players[RESOURCE_PLAYER].hand.length;
    // Before drawing, one draw is offered; the hazard player still has three.
    expect(computeLegalActions(after, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'draw-cards')).toHaveLength(1);

    after = dispatch(after, { type: 'draw-cards', player: PLAYER_1, count: 1 });
    const post = after.phaseState as MovementHazardPhaseState;
    expect(post.resourceDrawCount).toBe(1);
    expect(after.players[RESOURCE_PLAYER].hand.length).toBe(handBefore + 1);
    // The reduced max is spent: no further draw is legal for the moving player,
    // while the hazard player may still draw.
    expect(computeLegalActions(after, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'draw-cards')).toHaveLength(0);
    expect(computeLegalActions(after, PLAYER_2).filter(ea => ea.viable && ea.action.type === 'draw-cards')).toHaveLength(1);
  });
});

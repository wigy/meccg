/**
 * @module td-73.test
 *
 * Card test: Stormcrow (td-73)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "The direct influence of each Wizard is reduced by 2 (by 4 if Doors of
 *    Night is in play). Discard all resource permanent-events that have been
 *    played on each company with a Wizard (i. e., on the company as a whole,
 *    not individual characters, e. g., Fellowship). No such cards may be
 *    played on each Wizard's company. Discard this card when any play deck is
 *    exhausted. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect                                            | Status | Notes                                                    |
 * |---|---------------------------------------------------|--------|----------------------------------------------------------|
 * | 1 | stat-modifier direct-influence -2 (Wizards)       | OK     | all-characters, when target.race=wizard                  |
 * | 2 | stat-modifier direct-influence -2 (+DoN)          | OK     | additional -2 gated on Doors of Night in play (net -4)   |
 * | 3 | prohibit-company-events companyHasRace=wizard     | OK     | discard sweep + org-phase play prohibition               |
 * | 4 | on-event play-deck-exhausted → discard-self       | OK     | completeDeckExhaust in reducer-utils                     |
 * | 5 | duplication-limit scope:game max:1                | OK     | movement-hazard duplication check                        |
 *
 * Note: a company-bound resource permanent-event (Fellowship tw-240, played on
 * the company as a whole via `play-target: company` → `CardInPlay.companyId`)
 * is exactly the "played on the company as a whole" card; character-attached
 * permanent-events set `attachedTo`, not `companyId`, and are untouched.
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, DOORS_OF_NIGHT,
  Phase, CardStatus,
  P1_COMPANY,
  buildTestState, resetMint,
  dispatch, getCharacter, viableActions,
  expectInDiscardPile, makeMHState,
  SAPLING_OF_THE_WHITE_TREE,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  pool,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, CharacterCard, EndOfTurnPhaseState } from '../../index.js';

const STORMCROW = 'td-73' as CardDefinitionId;
const FELLOWSHIP = 'tw-240' as CardDefinitionId;

/** Gandalf's printed direct influence, the baseline the -2/-4 reduction acts on. */
const GANDALF_BASE_DI = (pool[GANDALF as string] as CharacterCard).directInfluence;

const stormcrowInPlay: CardInPlay = {
  instanceId: 'stormcrow-1' as CardInstanceId,
  definitionId: STORMCROW,
  status: CardStatus.Untapped,
};

describe('Stormcrow (td-73)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: each Wizard's direct influence is reduced by 2 ──────────────────

  test('reduces a Wizard\'s direct influence by 2 while Stormcrow is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(GANDALF_BASE_DI - 2);
  });

  test('leaves a non-Wizard character\'s direct influence unchanged', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    const aragornBaseDI = (pool[ARAGORN as string] as CharacterCard).directInfluence;
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(aragornBaseDI);
  });

  test('the reduction is 4 when Doors of Night is in play', () => {
    const doorsInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay, doorsInPlay] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(GANDALF_BASE_DI - 4);
  });

  test('a Wizard\'s direct influence is unreduced when no Stormcrow is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(GANDALF_BASE_DI);
  });

  // ── Rule 2: discard resource permanent-events on a company with a Wizard ────

  test('discards a Fellowship played on a Wizard\'s company', () => {
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    // Fellowship survives buildTestState (recompute only). A reduce triggers the
    // postReduce sweep that discards it because its company holds a Wizard.
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'fellowship-1')).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, FELLOWSHIP);
  });

  test('leaves a Fellowship on a Wizard-less company untouched', () => {
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // No Wizard in the company → the Fellowship is not swept.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'fellowship-1')).toBe(true);
  });

  // ── Rule 3: no such card may be played on a Wizard's company ────────────────

  test('Fellowship cannot be played on a Wizard\'s company while Stormcrow is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN, LEGOLAS, GIMLI] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('Fellowship is playable on the same company when no Stormcrow is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN, LEGOLAS, GIMLI] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  test('Fellowship remains playable on a Wizard-less company even with Stormcrow in play', () => {
    // Only a company containing a Wizard is prohibited; a Wizard-less 4-member
    // company at a Haven is still a valid Fellowship target.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  // ── Rule 4: discard when any play deck is exhausted ─────────────────────────

  test('discarded when a play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    // Before completion, Stormcrow is still in play.
    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === STORMCROW)).toBe(true);

    // Completing the exhaust fires play-deck-exhausted → discards Stormcrow.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expectInDiscardPile(afterPass, HAZARD_PLAYER, STORMCROW);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === STORMCROW)).toBe(false);
  });

  // ── Rule 5: cannot be duplicated ────────────────────────────────────────────

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [STORMCROW], siteDeck: [MINAS_TIRITH], cardsInPlay: [stormcrowInPlay] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('is playable as a hazard when no copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [STORMCROW], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });
});

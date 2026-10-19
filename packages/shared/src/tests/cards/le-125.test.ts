/**
 * @module le-125.test
 *
 * Card test: Minions Stir (le-125)
 * Type: hazard-event (long)
 * Effects: 5
 *   1. duplication-limit scope: game max: 1 — cannot be duplicated
 *   2. stat-modifier prowess +1 to all Orc and Troll attacks
 *   3. stat-modifier strikes +1 to all Orc and Troll attacks
 *   4. stat-modifier prowess +1 more to Orc attacks when Doors of Night is in play
 *   5. stat-modifier strikes +1 more to Orc attacks when Doors of Night is in play
 *
 * Card text:
 *   "The number of strikes and prowess of each Orc and Troll attack are each
 *   increased by one (by two for Orc attacks if Doors of Night is in play).
 *   Cannot be duplicated."
 *
 * Test fixtures:
 *   - Moria (tw-413): Orcs auto-attack — 4 strikes, 7 prowess.
 *   - Ettenmoors (tw-395): Trolls auto-attack — 1 strike, 9 prowess.
 *   - Gladden Fields (tw-396): Undead auto-attack — 1 strike, 8 prowess.
 *   - Orc-patrol (tw-074): hazard creature — Orcs, 3 strikes, 6 prowess.
 *
 * | # | Effect                                    | Status      | Notes                              |
 * |---|-------------------------------------------|-------------|------------------------------------|
 * | 1 | duplication-limit (game, max 1)           | IMPLEMENTED | reducer duplicate-check            |
 * | 2 | stat-modifier prowess +1 (Orc/Troll)      | IMPLEMENTED | target: all-attacks                |
 * | 3 | stat-modifier strikes +1 (Orc/Troll)      | IMPLEMENTED | target: all-attacks                |
 * | 4 | stat-modifier prowess +1 (Orc + DoN)      | IMPLEMENTED | inPlay condition in attack context |
 * | 5 | stat-modifier strikes +1 (Orc + DoN)      | IMPLEMENTED | inPlay condition in attack context |
 *
 * Playable: YES
 * Certified: 2026-10-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
  makeMHState, makeShadowMHState,
  handCardId, companyIdAt, dispatch, resolveChain,
  DOORS_OF_NIGHT,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const MINIONS_STIR = 'le-125' as CardDefinitionId;
const ETTENMOORS = 'tw-395' as CardDefinitionId;
const GLADDEN_FIELDS = 'tw-396' as CardDefinitionId;
const ORC_PATROL = 'tw-074' as CardDefinitionId;

const stirInPlay: CardInPlay = {
  instanceId: 'stir-1' as CardInstanceId,
  definitionId: MINIONS_STIR,
  status: CardStatus.Untapped,
};

const doorsInPlay: CardInPlay = {
  instanceId: 'doors-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

describe('Minions Stir (le-125)', () => {
  beforeEach(() => resetMint());

  test.each([
    ['Orc automatic-attack +1/+1 (Moria 4/7 → 5/8)', MORIA, false, 5, 8],
    ['Orc automatic-attack +2/+2 with Doors of Night (Moria 4/7 → 6/9)', MORIA, true, 6, 9],
    ['Troll automatic-attack +1/+1 (Ettenmoors 1/9 → 2/10)', ETTENMOORS, false, 2, 10],
    ['Troll automatic-attack only +1/+1 with Doors of Night — the +2 is Orc-only', ETTENMOORS, true, 2, 10],
    ['Undead automatic-attack unaffected (Gladden Fields 1/8)', GLADDEN_FIELDS, true, 1, 8],
  ] as const)('%s', (_label, site, withDoors, strikes, prowess) => {
    const cardsInPlay = withDoors ? [stirInPlay, doorsInPlay] : [stirInPlay];
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site }), cardsInPlay));
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(strikes);
    expect(after.combat!.strikeProwess).toBe(prowess);
  });

  test('without Minions Stir the Orc automatic-attack is printed (Moria 4/7)', () => {
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [doorsInPlay]));
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test.each([
    ['Orc hazard creature +1/+1 (Orc-patrol 3/6 → 4/7)', false, 4, 7],
    ['Orc hazard creature +2/+2 with Doors of Night (Orc-patrol 3/6 → 5/8)', true, 5, 8],
  ] as const)('%s', (_label, withDoors, strikes, prowess) => {
    const cardsInPlay = withDoors ? [stirInPlay, doorsInPlay] : [stirInPlay];
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_PATROL], siteDeck: [MORIA], cardsInPlay },
      ],
    });
    const state = { ...base, phaseState: makeShadowMHState() };
    const after = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'shadow' },
    }));
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(strikes);
    expect(after.combat!.strikeProwess).toBe(prowess);
  });

  test('can be played as a hazard when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MINIONS_STIR], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    expect(viableActions(ready, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });

  test('cannot be duplicated (not playable while a copy is in play)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MINIONS_STIR], siteDeck: [MINAS_TIRITH], cardsInPlay: [stirInPlay] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});

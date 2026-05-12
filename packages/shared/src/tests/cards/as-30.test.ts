/**
 * @module as-30.test
 *
 * Card test: Full of Froth and Rage (as-30)
 * Type: hazard-event (permanent)
 * Effects: 3
 *   1. stat-modifier prowess +2 to all Spider and Animal attacks
 *   2. on-event: attack-defeated — discard self when a Spider or Animal attack is defeated
 *   3. duplication-limit scope: game max: 1 — cannot be duplicated
 *
 * Card text:
 *   "All Spider and Animal attacks receive +2 prowess. Discard if a Spider or
 *    Animal attack is defeated. Cannot be duplicated."
 *
 * Test sites:
 *   - tw-422 (Ruined Signal Tower): hero-site, Spiders — 2 strikes, 8 prowess
 *   - as-144 (Eagles’ Eyrie): minion-site, Animals — 2 strikes, 10 prowess
 *   - tw-396 (Gladden Fields): hero-site, Undead — 1 strike, 8 prowess (control)
 *
 * | # | Effect                                    | Status      | Notes                                        |
 * |---|-------------------------------------------|-------------|----------------------------------------------|
 * | 1 | stat-modifier prowess +2 (Spider/Animal)  | IMPLEMENTED | target: all-attacks, collectGlobalEffects    |
 * | 2 | on-event: attack-defeated, discard-self   | IMPLEMENTED | reducer-combat.ts allDefeated scan           |
 * | 3 | duplication-limit (game, max 1)           | IMPLEMENTED | reducer.ts duplicate-check                  |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
  makeMHState,
  findCharInstanceId,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const FULL_OF_FROTH_AND_RAGE = 'as-30' as CardDefinitionId;
// Ruined Signal Tower (tw-422): hero-site, Spiders — 2 strikes, 8 prowess
const RUINED_SIGNAL_TOWER = 'tw-422' as CardDefinitionId;
// Eagles’ Eyrie (as-144): minion-site, Animals — 2 strikes, 10 prowess
const EAGLES_EYRIE_AS = 'as-144' as CardDefinitionId;
// Gladden Fields (tw-396): hero-site, Undead — 1 strike, 8 prowess (not Spider/Animal)
const GLADDEN_FIELDS = 'tw-396' as CardDefinitionId;

/** Full of Froth and Rage as a card in player 2's cardsInPlay. */
const frothInPlay: CardInPlay = {
  instanceId: 'froth-1' as CardInstanceId,
  definitionId: FULL_OF_FROTH_AND_RAGE,
  status: CardStatus.Untapped,
};

describe('Full of Froth and Rage (as-30)', () => {
  beforeEach(() => resetMint());

  test('Spider auto-attack prowess increased by +2 (8 → 10)', () => {
    // Ruined Signal Tower: Spiders — 2 strikes, 8 prowess
    // With Full of Froth and Rage: 10 prowess
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: RUINED_SIGNAL_TOWER }), [frothInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(10);
  });

  test('Animal auto-attack prowess increased by +2 (10 → 12)', () => {
    // Eagles’ Eyrie (as-144): Animals — 2 strikes, 10 prowess
    // With Full of Froth and Rage: 12 prowess
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: EAGLES_EYRIE_AS }), [frothInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(12);
  });

  test('non-Spider/non-Animal (Undead) auto-attack is unaffected', () => {
    // Gladden Fields: Undead — 1 strike, 8 prowess (should be unchanged)
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GLADDEN_FIELDS }), [frothInPlay]),
    );

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('discards itself when all strikes of a Spider auto-attack are defeated', () => {
    // Ruined Signal Tower: Spiders — 2 strikes, 10 prowess (8 + 2 from Full of Froth and Rage).
    // Two characters needed so both strikes can be separately assigned and won.
    // Aragorn prowess 6: needs roll > 4 to succeed against 10. Roll 12 → 18 > 10 → success.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: RUINED_SIGNAL_TOWER, characters: [ARAGORN, LEGOLAS] }),
        [frothInPlay],
      ),
    );

    // Trigger auto-attack (2 strikes, 10 prowess)
    let r = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(r.error).toBeUndefined();
    expect(r.state.combat?.strikesTotal).toBe(2);
    expect(r.state.combat?.strikeProwess).toBe(10);

    // Aragorn takes strike 1
    const aragornId = findCharInstanceId(r.state, 0, ARAGORN);
    r = reduce(r.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();

    // Legolas takes strike 2 — all assigned → choose-strike-order
    const legolasId = findCharInstanceId(r.state, 0, LEGOLAS);
    r = reduce(r.state, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    expect(r.error).toBeUndefined();
    expect(r.state.combat?.phase).toBe('choose-strike-order');

    // Defender chooses strike order
    const orderActions = viableActions(r.state, PLAYER_1, 'choose-strike-order');
    expect(orderActions.length).toBeGreaterThan(0);
    r = reduce(r.state, orderActions[0].action);
    expect(r.error).toBeUndefined();
    expect(r.state.combat?.phase).toBe('resolve-strike');

    // Aragorn resolves first (success: 12 + 6 = 18 > 10)
    const resolveActions1 = viableActions({ ...r.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions1.length).toBeGreaterThan(0);
    r = reduce({ ...r.state, cheatRollTotal: 12 }, resolveActions1[0].action);
    expect(r.error).toBeUndefined();

    // Legolas resolves second (success: 12 + 6 = 18 > 10)
    const resolveActions2 = viableActions({ ...r.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions2.length).toBeGreaterThan(0);
    r = reduce({ ...r.state, cheatRollTotal: 12 }, resolveActions2[0].action);
    expect(r.error).toBeUndefined();

    // allDefeated = true → Full of Froth and Rage fires attack-defeated → discards
    expect(r.state.players[1].cardsInPlay.map(c => c.definitionId)).not.toContain(FULL_OF_FROTH_AND_RAGE);
    expect(r.state.players[1].discardPile.map(c => c.definitionId)).toContain(FULL_OF_FROTH_AND_RAGE);
  });

  test('does not discard when a non-Spider/non-Animal (Undead) attack is defeated', () => {
    // Gladden Fields: Undead — 1 strike, 8 prowess. Full of Froth and Rage should NOT fire.
    // Defeat the Undead attack, then verify the card is still in play.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GLADDEN_FIELDS }), [frothInPlay]),
    );

    // Trigger auto-attack (1 strike, 8 prowess — unmodified by Full of Froth and Rage)
    let r = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(r.error).toBeUndefined();
    expect(r.state.combat?.strikesTotal).toBe(1);

    // Aragorn takes the strike
    const aragornId = findCharInstanceId(r.state, 0, ARAGORN);
    r = reduce(r.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();

    // Resolve with high roll (success: 12 + 6 = 18 > 8)
    const resolveActions = viableActions({ ...r.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    r = reduce({ ...r.state, cheatRollTotal: 12 }, resolveActions[0].action);
    expect(r.error).toBeUndefined();

    // Undead defeated, but Full of Froth and Rage should still be in play (not discarded)
    expect(r.state.players[1].cardsInPlay.map(c => c.definitionId)).toContain(FULL_OF_FROTH_AND_RAGE);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FULL_OF_FROTH_AND_RAGE], siteDeck: [MINAS_TIRITH], cardsInPlay: [frothInPlay] },
      ],
    });
    const mhState = makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 });
    const readyState = { ...state, phaseState: mhState };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});

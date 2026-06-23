/**
 * @module dm-83.test
 *
 * Card test: Redoubled Force (dm-83)
 * Type: hazard-event (permanent)
 * Effects: 4
 *   1. stat-modifier prowess +2 to all Orc/Troll automatic-attacks
 *   2. stat-modifier strikes +3 to all Orc/Troll automatic-attacks
 *   3. on-event: attack-defeated — discard self when an Orc/Troll automatic-attack is defeated
 *   4. duplication-limit scope: game max: 1 — cannot be duplicated
 *
 * Card text:
 *   "All Orc and Troll automatic-attacks receive +3 strikes and +2 prowess.
 *    Discard this card when such an automatic-attack is defeated. Cannot be
 *    duplicated."
 *
 * The boost targets `all-automatic-attacks` (site automatic-attacks only),
 * NOT `all-attacks` — so an Orc/Troll *hazard creature* is unaffected. The
 * discard is gated on `attack.isAutomaticAttack` so defeating an Orc/Troll
 * creature does NOT discard the card.
 *
 * Test sites (all single-attack, no special site effects):
 *   - Goblin-gate (tw-398): Orcs 3 strikes, 6 prowess → 6 strikes, 8 prowess
 *   - Ettenmoors (tw-395): Trolls 1 strike, 9 prowess → 4 strikes, 11 prowess
 *   - Dimrill Dale (tw-385): Orcs 1 strike, 6 prowess → 4 strikes, 8 prowess
 *   - Isengard (tw-404): Wolves 3 strikes, 7 prowess — unaffected (not Orc/Troll)
 * Test creatures:
 *   - Orc-patrol (tw-074): Orcs 3 strikes, 6 prowess — unaffected (not an auto-attack)
 *   - Orc-lieutenant (tw-073): Orcs 1 strike, 7 prowess — defeated without discard
 *
 * | # | Effect                                | Status      | Notes                              |
 * |---|---------------------------------------|-------------|-------------------------------------|
 * | 1 | stat-modifier prowess +2 (Orc/Troll)  | IMPLEMENTED | target: all-automatic-attacks       |
 * | 2 | stat-modifier strikes +3 (Orc/Troll)  | IMPLEMENTED | target: all-automatic-attacks       |
 * | 3 | on-event: attack-defeated, discard    | IMPLEMENTED | gated on attack.isAutomaticAttack   |
 * | 4 | duplication-limit (game, max 1)       | IMPLEMENTED | reducer.ts duplicate-check          |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, FRODO,
  ORC_PATROL, ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, ISENGARD,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
  makeMHState,
  setupCombatWithCaveDrake,
  runAutoAttackCombatMulti,
  runCreatureCombat,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const REDOUBLED_FORCE = 'dm-83' as CardDefinitionId;
const GOBLIN_GATE = 'tw-398' as CardDefinitionId; // Orcs 3 strikes, 6 prowess (shadow-hold)
const ETTENMOORS = 'tw-395' as CardDefinitionId; // Trolls 1 strike, 9 prowess (ruins-and-lairs)
const DIMRILL_DALE = 'tw-385' as CardDefinitionId; // Orcs 1 strike, 6 prowess (ruins-and-lairs)

/** Redoubled Force as a card in the hazard player's (P2) cardsInPlay. */
const redoubledInPlay: CardInPlay = {
  instanceId: 'rf-1' as CardInstanceId,
  definitionId: REDOUBLED_FORCE,
  status: CardStatus.Untapped,
};

describe('Redoubled Force (dm-83)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1 & 2: Orc/Troll automatic-attack boost ───────────────────────

  test('Orc automatic-attack receives +2 prowess (6 → 8) and +3 strikes (3 → 6)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GOBLIN_GATE }), [redoubledInPlay]),
    );
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
    expect(result.state.combat!.strikesTotal).toBe(6);
  });

  test('Troll automatic-attack receives +2 prowess (9 → 11) and +3 strikes (1 → 4)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS }), [redoubledInPlay]),
    );
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(11);
    expect(result.state.combat!.strikesTotal).toBe(4);
  });

  test('without Redoubled Force, the Orc automatic-attack is unmodified (6 prowess, 3 strikes)', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: GOBLIN_GATE }));
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(6);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });

  test('non-Orc/Troll (Wolf) automatic-attack is unaffected', () => {
    // Isengard: Wolves 3 strikes, 7 prowess — not Orc/Troll, should be unchanged.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [redoubledInPlay]),
    );
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });

  test('Orc hazard CREATURE is NOT boosted (boost is automatic-attacks only)', () => {
    // Orc-patrol: 3 strikes, 6 prowess. As a hazard creature (not an
    // automatic-attack) it must be unaffected by Redoubled Force.
    const s = setupCombatWithCaveDrake({
      heroChars: [ARAGORN],
      creatureDefId: ORC_PATROL,
      hazardCardsInPlay: [redoubledInPlay],
    });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.creatureRace).toBe('orc');
    expect(s.combat!.strikeProwess).toBe(6);
    expect(s.combat!.strikesTotal).toBe(3);
  });

  // ─── Effect 3: discard when an Orc/Troll automatic-attack is defeated ──────

  test('discards itself when an Orc automatic-attack is fully defeated', () => {
    // Dimrill Dale: Orcs 1 strike (→ 4), 6 prowess (→ 8). Four characters each
    // win their strike (roll 12, tap to fight) → all strikes defeated.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: DIMRILL_DALE, characters: [ARAGORN, LEGOLAS, GIMLI, FARAMIR] }),
        [redoubledInPlay],
      ),
    );
    const { state: after } = runAutoAttackCombatMulti(state, [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
      { characterDefId: FARAMIR, roll: 12 },
    ]);
    expect(after.combat).toBeNull();
    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).not.toContain(REDOUBLED_FORCE);
    expect(after.players[1].discardPile.map(c => c.definitionId)).toContain(REDOUBLED_FORCE);
  });

  test('does NOT discard when the Orc automatic-attack is not fully defeated', () => {
    // Same Dimrill Dale attack (4 strikes), but Frodo (prowess 1) loses his
    // strike (roll 2 → 3 ≤ 8). Not all strikes defeated → card stays in play.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: DIMRILL_DALE, characters: [ARAGORN, LEGOLAS, GIMLI, FRODO] }),
        [redoubledInPlay],
      ),
    );
    const { state: after } = runAutoAttackCombatMulti(state, [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
      { characterDefId: FRODO, roll: 2 },
    ]);
    expect(after.combat).toBeNull();
    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).toContain(REDOUBLED_FORCE);
    expect(after.players[1].discardPile.map(c => c.definitionId)).not.toContain(REDOUBLED_FORCE);
  });

  test('does NOT discard when a defeated Orc attack is a hazard creature (not an automatic-attack)', () => {
    // Orc-lieutenant: 1 strike, 7 prowess. Aragorn wins the strike → creature
    // defeated, but it is not an automatic-attack so Redoubled Force stays.
    const s = setupCombatWithCaveDrake({
      heroChars: [ARAGORN],
      creatureDefId: ORC_LIEUTENANT,
      hazardCardsInPlay: [redoubledInPlay],
    });
    expect(s.combat).not.toBeNull();
    const after = runCreatureCombat(s, ARAGORN, 12, null);
    expect(after.combat).toBeNull();
    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).toContain(REDOUBLED_FORCE);
    expect(after.players[1].discardPile.map(c => c.definitionId)).not.toContain(REDOUBLED_FORCE);
  });

  // ─── Effect 4: cannot be duplicated ───────────────────────────────────────

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [REDOUBLED_FORCE], siteDeck: [MINAS_TIRITH], cardsInPlay: [redoubledInPlay] },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable);
    expect(actions).toHaveLength(0);
  });
});

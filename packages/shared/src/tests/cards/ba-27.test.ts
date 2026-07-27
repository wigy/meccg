/**
 * @module ba-27.test
 *
 * Card test: Ungoliant's Progeny (ba-27)
 * Type: hazard-event (permanent), Unique, Spawn, 4 kill marshalling points.
 *
 * Card text:
 *   "Unique. Spawn. The Wind-deeps and The Rusted-deeps each have an additional
 *    automatic-attack: Spawn — 2 strikes with 16/8 prowess/body. In addition,
 *    for each Spider attack your opponent faces, you can choose for it to be at
 *    +1 prowess and detainment."
 *
 * Two abilities:
 *   1. `permanent-event-auto-attack` (`onDefeat: 'remove-from-play'`) — adds a
 *      Spawn 2×16/8 automatic-attack to The Wind-deeps (ba-104) and The
 *      Rusted-deeps (ba-96). When that attack is defeated the event moves to the
 *      defender's kill pile (CoE rule 964, same block as Balrog of Moria tw-12).
 *   2. `attacker-attack-option` (`creatureRace: 'spider', prowessModifier: 1,
 *      detainment: true`) — an optional, per-attack combat modifier the
 *      attacking (hazard) player may apply to any Spider attack their opponent
 *      faces: +1 prowess and detainment. Offered as `apply-attacker-attack-option`
 *      in the attacker's resolve-strike Step 1 window before any strike resolves.
 *
 * Engine support:
 * | # | Feature                                     | Status      | Notes                                          |
 * |---|---------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Spawn 2×16/8 auto-attack at ba-104 / ba-96   | IMPLEMENTED | collectPermanentEventAttacks (manifestations)  |
 * | 2 | onDefeat: remove-from-play → kill pile        | IMPLEMENTED | combat-finalize.ts finalizeCombat block        |
 * | 3 | Optional +1 prowess & detainment on Spiders   | IMPLEMENTED | attackerAttackOptionActions / handler          |
 * | 4 | Gated on Spider attacks only, once per attack | IMPLEMENTED | creatureRace gate + attackerAttackOptionApplied |
 *
 * Playable: YES
 * Certified: 2026-07-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  CardStatus,
  buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  runAutoAttackCombatMulti,
  makeSingleCharCombatState,
  executeAction,
  dispatch,
  findCharInstanceId, findInPile, viableActions,
  resetMint,
} from '../test-helpers.js';
import { reduce } from '../../engine/reducer.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, GameState } from '../../index.js';
import { Race } from '../../index.js';

const UNGOLIANTS_PROGENY = 'ba-27' as CardDefinitionId;
const WIND_DEEPS = 'ba-104' as CardDefinitionId;    // The Wind-deeps (Orcs 3×7)
const RUSTED_DEEPS = 'ba-96' as CardDefinitionId;    // The Rusted-deeps (Drake 2×11)

const spawnInPlay: CardInPlay = {
  instanceId: 'progeny-1' as CardInstanceId,
  definitionId: UNGOLIANTS_PROGENY,
  status: CardStatus.Untapped,
};

const atSecondAttack = (state: GameState): GameState => ({
  ...state,
  phaseState: { ...state.phaseState, automaticAttacksResolved: 1 },
} as GameState);

describe("Ungoliant's Progeny (ba-27)", () => {
  beforeEach(() => resetMint());

  // ─── Ability 1: additional Spawn automatic-attack ──────────────────────────

  test('The Wind-deeps gains a Spawn 2×16/8 as its 2nd auto-attack when ba-27 is in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: WIND_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(16);
    expect(next.combat!.creatureBody).toBe(8);
    expect(next.combat!.creatureRace).toBe('spawn');
  });

  test('The Rusted-deeps also gains the Spawn 2×16/8 as its 2nd auto-attack', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: RUSTED_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(16);
    expect(next.combat!.creatureBody).toBe(8);
  });

  test('without ba-27 in play, The Wind-deeps has no 2nd auto-attack', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: WIND_DEEPS, characters: [ARAGORN] }));
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  test('the printed 1st auto-attack (Orcs 3×7) is unchanged with ba-27 in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: WIND_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(7);
  });

  // ─── onDefeat: remove-from-play → defender's kill pile ─────────────────────

  test("defeating the Spawn attack removes ba-27 from play and awards it to the defender's kill pile", () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: WIND_DEEPS, characters: [ARAGORN, GIMLI] }),
        [spawnInPlay],
      ),
    );
    // Both Spawn strikes (prowess 16) are defeated: each character taps and rolls
    // 12 (Aragorn 6+12=18, Gimli 5+12=17, both > 16).
    const result = runAutoAttackCombatMulti(atSecondAttack(base), [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();
    // ba-27 left the hazard player's cardsInPlay …
    expect(result.state.players[1].cardsInPlay.find(c => c.instanceId === spawnInPlay.instanceId)).toBeUndefined();
    // … and landed in the defending (resource) player's kill pile — kill MPs awarded.
    expect(findInPile(result.state, RESOURCE_PLAYER, 'killPile', spawnInPlay.instanceId)).toBeDefined();
    expect(findInPile(result.state, 1, 'killPile', spawnInPlay.instanceId)).toBeUndefined();
  });

  test('surviving the Spawn attack leaves ba-27 in play (no kill MPs)', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: WIND_DEEPS, characters: [ARAGORN, GIMLI] }),
        [spawnInPlay],
      ),
    );
    // Characters stay untapped and roll low → wounded (strikes not defeated); the
    // attack is not defeated so ba-27 remains in play.
    const result = runAutoAttackCombatMulti(atSecondAttack(base), [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 2 },
      { characterDefId: GIMLI, roll: 2, tapToFight: false, bodyRoll: 2 },
    ]);
    expect(result.state.players[1].cardsInPlay.find(c => c.instanceId === spawnInPlay.instanceId)).toBeDefined();
    expect(findInPile(result.state, RESOURCE_PLAYER, 'killPile', spawnInPlay.instanceId)).toBeUndefined();
  });

  // ─── Ability 2: optional +1 prowess & detainment on a Spider attack ────────

  test('the hazard player may apply +1 prowess and detainment to a Spider attack while ba-27 is in play', () => {
    // Fabricated single-strike Spider attack (prowess 8) against a lone hero.
    const combat = addP2CardsInPlay(
      makeSingleCharCombatState({ heroDefId: GIMLI, creatureRace: Race.Spider, creatureProwess: 8, creatureBody: null, preAssigned: true }),
      [spawnInPlay],
    );
    expect(combat.combat!.phase).toBe('resolve-strike');
    expect(combat.combat!.detainment).toBe(false);

    // The attacking (hazard) player is offered the option; the defender is not.
    const options = viableActions(combat, PLAYER_2, 'apply-attacker-attack-option');
    expect(options).toHaveLength(1);
    expect(viableActions(combat, PLAYER_1, 'apply-attacker-attack-option')).toHaveLength(0);

    // Applying it: prowess 8 → 9 and the attack becomes detainment.
    const applied = dispatch(combat, options[0].action);
    expect(applied.combat!.strikeProwess).toBe(9);
    expect(applied.combat!.detainment).toBe(true);

    // One-shot: the option is no longer offered.
    expect(viableActions(applied, PLAYER_2, 'apply-attacker-attack-option')).toHaveLength(0);
  });

  test('a character wounded by the boosted Spider attack is tapped (detainment), not wounded or eliminated', () => {
    const combat = addP2CardsInPlay(
      makeSingleCharCombatState({ heroDefId: GIMLI, creatureRace: Race.Spider, creatureProwess: 8, creatureBody: null, preAssigned: true }),
      [spawnInPlay],
    );
    const gimliId = findCharInstanceId(combat, RESOURCE_PLAYER, GIMLI);
    const option = viableActions(combat, PLAYER_2, 'apply-attacker-attack-option')[0];
    const applied = dispatch(combat, option.action);

    // Gimli stays untapped (prowess 5) and rolls 2 → total 7 < 9 → strike
    // succeeds. Under detainment he is tapped, not wounded (no body check).
    const resolved = executeAction(applied, PLAYER_1, 'resolve-strike', 2, false);
    expect(resolved.combat).toBeNull();
    const gimli = resolved.players[RESOURCE_PLAYER].characters[gimliId];
    expect(gimli).toBeDefined();
    expect(gimli.status).toBe(CardStatus.Tapped);
    expect(resolved.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === gimliId)).toBeUndefined();
  });

  test('without ba-27 in play, a Spider attack offers no attacker-attack-option', () => {
    const combat = makeSingleCharCombatState({ heroDefId: GIMLI, creatureRace: Race.Spider, creatureProwess: 8, creatureBody: null, preAssigned: true });
    expect(viableActions(combat, PLAYER_2, 'apply-attacker-attack-option')).toHaveLength(0);
  });

  test('the option is not offered for a non-Spider attack even with ba-27 in play', () => {
    // Orc attack — creatureRace 'orc' ≠ 'spider', so the option does not apply.
    const combat = addP2CardsInPlay(
      makeSingleCharCombatState({ heroDefId: LEGOLAS, creatureRace: Race.Orc, creatureProwess: 8, creatureBody: null, preAssigned: true }),
      [spawnInPlay],
    );
    expect(viableActions(combat, PLAYER_2, 'apply-attacker-attack-option')).toHaveLength(0);
  });

  test('the defending player cannot apply the attacker option', () => {
    const combat = addP2CardsInPlay(
      makeSingleCharCombatState({ heroDefId: GIMLI, creatureRace: Race.Spider, creatureProwess: 8, creatureBody: null, preAssigned: true }),
      [spawnInPlay],
    );
    const attempt = reduce(combat, { type: 'apply-attacker-attack-option', player: PLAYER_1, cardInstanceId: spawnInPlay.instanceId });
    expect(attempt.error).toBeDefined();
    expect(attempt.state.combat!.detainment).toBe(false);
  });
});

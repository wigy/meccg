/**
 * @module ba-24.test
 *
 * Card test: Spawn of Ungoliant (ba-24)
 * Type: hazard-event (permanent), Unique, Spawn, 4 kill marshalling points.
 *
 * Card text:
 *   "Unique. Spawn. The Pûkel-deeps and The Gem-deeps each have an additional
 *    automatic-attack: Spawn — 3 strikes with 15/8 prowess/body. In addition,
 *    +1 to all body checks for Elves, Dwarves, Hobbits, Dúnedain, and Men
 *    resulting from Spider attacks."
 *
 * Two abilities:
 *   1. `permanent-event-auto-attack` (`onDefeat: 'remove-from-play'`) — adds a
 *      Spawn 3×15/8 automatic-attack to The Pûkel-deeps (ba-94, dm-34) and The
 *      Gem-deeps (ba-90, dm-30). When that attack is defeated the event goes to
 *      the defender's kill pile (CoE rule 964, same block as Balrog of Moria
 *      tw-12).
 *   2. `body-check-modifier` `scope: 'all-attacks'` — a global +1 to combat body
 *      checks against Elf/Dwarf/Hobbit/Dúnadan/Man characters, gated on the
 *      attacking creature's race being a Spider (`attack.creatureRace: 'spider'`).
 *
 * Engine support:
 * | # | Feature                                    | Status      | Notes                                        |
 * |---|--------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Spawn auto-attack at the four sites        | IMPLEMENTED | collectPermanentEventAttacks (manifestations)|
 * | 2 | onDefeat: remove-from-play → kill pile      | IMPLEMENTED | combat-finalize.ts finalizeCombat block      |
 * | 3 | Global body-check +1 vs listed races        | IMPLEMENTED | globalBodyCheckRollModifier (combat-actions) |
 * | 4 | Gated on Spider attacks / excluded races     | IMPLEMENTED | when: attack.creatureRace / target.race      |
 *
 * Playable: YES
 * Certified: 2026-07-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, GANDALF,
  CardStatus,
  buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  runAutoAttackCombatMulti,
  dispatch,
  findCharInstanceId, findInPile, expectInPile,
  resetMint,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, GameState } from '../../index.js';

const SPAWN_OF_UNGOLIANT = 'ba-24' as CardDefinitionId;
const PUKEL_DEEPS = 'ba-94' as CardDefinitionId;   // The Pûkel-deeps (Pûkel-creature 2×11)
const GEM_DEEPS = 'ba-90' as CardDefinitionId;      // The Gem-deeps (Undead 3×9)
const RUINED_SIGNAL_TOWER = 'tw-422' as CardDefinitionId; // Spiders 2×8, no special rules

const spawnInPlay: CardInPlay = {
  instanceId: 'spawn-1' as CardInstanceId,
  definitionId: SPAWN_OF_UNGOLIANT,
  status: CardStatus.Untapped,
};

const atSecondAttack = (state: GameState): GameState => ({
  ...state,
  phaseState: { ...state.phaseState, automaticAttacksResolved: 1 },
} as GameState);

describe('Spawn of Ungoliant (ba-24)', () => {
  beforeEach(() => resetMint());

  // ─── Ability 1: additional Spawn automatic-attack ──────────────────────────

  test('The Pûkel-deeps gains a Spawn 3×15/8 as its 2nd auto-attack when ba-24 is in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureBody).toBe(8);
  });

  test('The Gem-deeps also gains the Spawn 3×15/8 as its 2nd auto-attack', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GEM_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureBody).toBe(8);
  });

  test('without ba-24 in play, The Pûkel-deeps has no 2nd auto-attack', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN] }));
    const next = dispatch(atSecondAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  test('the printed 1st auto-attack (Pûkel-creature 2×11) is unchanged with ba-24 in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN] }), [spawnInPlay]),
    );
    const next = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(11);
  });

  // ─── onDefeat: remove-from-play → defender's kill pile ─────────────────────

  test('defeating the Spawn attack removes ba-24 from play and awards it to the defender\'s kill pile', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN, LEGOLAS, GIMLI] }),
        [spawnInPlay],
      ),
    );
    // Each of the three Spawn strikes (prowess 15) is defeated: Aragorn 6+12=18,
    // Legolas 5+12=17, Gimli 5+12=17 — all tap to fight and win.
    const result = runAutoAttackCombatMulti(atSecondAttack(base), [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();

    // ba-24 left the hazard player's cardsInPlay
    expect(result.state.players[1].cardsInPlay.find(c => c.instanceId === spawnInPlay.instanceId)).toBeUndefined();
    // ba-24 is in the defending (resource) player's kill pile — kill MPs awarded
    expect(findInPile(result.state, RESOURCE_PLAYER, 'killPile', spawnInPlay.instanceId)).toBeDefined();
    // Not in the hazard player's kill pile
    expect(findInPile(result.state, 1, 'killPile', spawnInPlay.instanceId)).toBeUndefined();
  });

  test('surviving the Spawn attack leaves ba-24 in play (no kill MPs)', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN, LEGOLAS, GIMLI] }),
        [spawnInPlay],
      ),
    );
    // Characters do NOT tap (untapped, reduced prowess) and roll low → all
    // strikes wound; the attack is not defeated so ba-24 stays in play.
    const result = runAutoAttackCombatMulti(atSecondAttack(base), [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 2 },
      { characterDefId: LEGOLAS, roll: 2, tapToFight: false, bodyRoll: 2 },
      { characterDefId: GIMLI, roll: 2, tapToFight: false, bodyRoll: 2 },
    ]);
    // ba-24 still in the hazard player's cardsInPlay (attack not defeated)
    expect(result.state.players[1].cardsInPlay.find(c => c.instanceId === spawnInPlay.instanceId)).toBeDefined();
    expect(findInPile(result.state, RESOURCE_PLAYER, 'killPile', spawnInPlay.instanceId)).toBeUndefined();
  });

  // ─── Ability 2: +1 body check for listed races from Spider attacks ─────────

  test('a Dúnadan wounded by a Spider attack is eliminated at roll = body when ba-24 is in play (+1)', () => {
    // Ruined Signal Tower: Spiders 2×8 (no equals-body rule). Aragorn (dunadan,
    // body 9) wounded, body check roll 9 → +1 = 10 > 9 → eliminated. Gimli wins
    // the other strike (5+12=17 > 8).
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: RUINED_SIGNAL_TOWER, characters: [ARAGORN, GIMLI] }),
        [spawnInPlay],
      ),
    );
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const result = runAutoAttackCombatMulti(base, [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 9 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();
    // The +1 pushed the body check over Aragorn's body → eliminated (out of play)
    expectInPile(result.state, RESOURCE_PLAYER, 'outOfPlayPile', aragornId);
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
  });

  test('without ba-24, the same Spider body check (roll 9 = body 9) leaves the Dúnadan alive', () => {
    // Control: identical setup but ba-24 not in play → no +1 → 9 = body 9 → survives.
    const base = setupAutoAttackStep(
      buildSitePhaseState({ site: RUINED_SIGNAL_TOWER, characters: [ARAGORN, GIMLI] }),
    );
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const result = runAutoAttackCombatMulti(base, [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 9 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    // Aragorn survives the body check (still in play, wounded), not removed
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  test('a Wizard\'s body check from a Spider attack is NOT modified (race excluded)', () => {
    // Gandalf (wizard, body 9) wounded by the Spider attack, body check roll 9.
    // Wizard is not in the listed races → no +1 → 9 = body 9 → survives.
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: RUINED_SIGNAL_TOWER, characters: [GANDALF, GIMLI] }),
        [spawnInPlay],
      ),
    );
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const result = runAutoAttackCombatMulti(base, [
      { characterDefId: GANDALF, roll: 2, tapToFight: false, bodyRoll: 9 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    expect(result.state.players[RESOURCE_PLAYER].characters[gandalfId]).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === gandalfId)).toBeUndefined();
  });

  test('a Dúnadan\'s body check from the (non-Spider) Spawn attack is NOT modified', () => {
    // ba-24's own Spawn attack is a Spawn, not a Spider — the +1 must not apply.
    // Aragorn (dunadan, body 9) wounded by the Spawn 3×15, body check roll 9 →
    // no +1 → 9 = body 9 → survives. Legolas/Gimli win their strikes.
    const base = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: PUKEL_DEEPS, characters: [ARAGORN, LEGOLAS, GIMLI] }),
        [spawnInPlay],
      ),
    );
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const result = runAutoAttackCombatMulti(atSecondAttack(base), [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 9 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
    ]);
    // Aragorn survives — the Spawn attack does not trigger the Spider-only +1
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });
});

/**
 * @module le-161.test
 *
 * Card test: Adûnaphel Unleashed (le-161)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Text:
 *   "Playable on any attack against Adûnaphel the Ringwraith (as your
 *    Ringwraith) if she is the only character in her company. The number of
 *    strikes of the attack is reduced to one and the attack's body is
 *    modified by -2. Alternatively, playable on any attack by a lone
 *    Adûnaphel the Ringwraith (as your Ringwraith). You choose defending
 *    characters. Any resulting body checks for defending characters are
 *    modified by +2. Cannot be duplicated on a given attack."
 *
 * Rules:
 *   1. Deck restriction — excluded from Balrog decks (rule 1.23).
 *   2. Mode A (defender play) — playable on any attack against a company
 *      containing only Adûnaphel: reduces the attack to one strike and
 *      gives -2 to the attack's body (`modify-attack` fromHand, player
 *      "defender", `setStrikesTo: 1`, `bodyModifier: -2`).
 *   3. Mode B (attacker play) — playable on an attack by a company
 *      containing only Adûnaphel: grants attacker-chooses-defenders for the
 *      attack and +2 to defending characters' resulting body checks
 *      (`modify-attack` fromHand, player "attacker",
 *      `grantAttackerChoosesDefenders: true`, `bodyCheckModifier: 2`).
 *   4. Cannot be duplicated on a given attack (`duplication-limit`, scope
 *      "attack").
 *
 * Engine support added for this card: `modify-attack` (fromHand) gains two
 * fields — `grantAttackerChoosesDefenders` (sets
 * `CombatState.attackerChoosesDefenders` and, since strike assignment has
 * not started yet, hands assignment straight to the attacker) and
 * `bodyCheckModifier` (adds to the existing attack-wide
 * `CombatState.bodyCheckModifier`). A card may now declare MULTIPLE from-hand
 * `modify-attack` effects — the engine (both `modifyAttackActions` and
 * `handleModifyAttack`, sharing `buildPlayedModifyAttackContext`) picks the
 * first whose `player` and `when` both match. The context gained
 * `defender.companySize`/`characterNames` and (CvCC attacks only)
 * `attacker.companySize`/`characterNames`.
 *
 * | # | Rule                                                                | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | Mode A offered to the defender when she is alone facing an attack    | IMPLEMENTED |
 * | 2 | Mode A NOT offered when she has company mates                        | IMPLEMENTED |
 * | 3 | Mode A NOT offered when the lone character is a different Ringwraith | IMPLEMENTED |
 * | 4 | Mode A reduces strikes to 1, -2 body, discards the card               | IMPLEMENTED |
 * | 5 | Mode B offered to the attacker when she attacks alone (CvCC)         | IMPLEMENTED |
 * | 6 | Mode B NOT offered when she has company mates                        | IMPLEMENTED |
 * | 7 | Mode B NOT offered to the defending player                            | IMPLEMENTED |
 * | 8 | Mode B grants attacker-chooses-defenders + sets +2 body-check modifier| IMPLEMENTED |
 * | 9 | Attacker (not defender) assigns her strike after Mode B               | IMPLEMENTED |
 * |10 | The +2 body-check modifier changes a defending character's outcome   | IMPLEMENTED |
 * |11 | Cannot be duplicated on a given attack                                | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   ADUNAPHEL_UNLEASHED (le-161) - minion short event (this card)
 *   ADUNAPHEL (le-50)            - minion Ringwraith avatar
 *   KHAMUL (le-55)               - a different Ringwraith avatar (negative-test fixture)
 *   ORC_CAPTAIN (le-31)          - minion orc (company-mate filler)
 *   ARAGORN, LEGOLAS             - hero characters (CvCC combat opponents)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  makeCancelWindowCombat, findHandCardId, expectInDiscardPile,
  companyIdAt, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  MORIA, MINAS_TIRITH, RIVENDELL,
  ARAGORN, LEGOLAS,
} from '../test-helpers.js';
import { Alignment, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, CombatState } from '../../index.js';

const ADUNAPHEL_UNLEASHED = 'le-161' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// ─── Mode A: attack against a lone Adûnaphel ───────────────────────────────

/**
 * A movement/hazard state whose defending company (PLAYER_1, the Ringwraith
 * player) is at Dol Guldur facing an automatic-attack. The card is in
 * PLAYER_1's hand.
 */
function defendingCombat(opts: {
  characters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  hand?: CardDefinitionId[];
  strikesTotal?: number;
  strikeProwess?: number;
  creatureBody?: number | null;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.characters }],
        hand: opts.hand ?? [ADUNAPHEL_UNLEASHED], siteDeck: [MORIA] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const combat = makeCancelWindowCombat(base, {
    attackSourceType: 'automatic-attack',
    creatureRace: Race.Orc,
    strikesTotal: opts.strikesTotal ?? 3,
    strikeProwess: opts.strikeProwess ?? 11,
  });
  return opts.creatureBody !== undefined
    ? { ...combat, combat: { ...combat.combat!, creatureBody: opts.creatureBody } }
    : combat;
}

// ─── Mode B: attack by a lone Adûnaphel (CvCC) ─────────────────────────────

/**
 * A CvCC combat, pre-assignment, where PLAYER_1 (Ringwraith, at the site
 * phase) attacks PLAYER_2's (Wizard) company. Built directly rather than via
 * `declare-company-attack`, matching the as-122 precedent for CvCC card tests.
 */
function attackingCvCCState(opts: {
  attackerCharacters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  defenderCharacters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  hand?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.attackerCharacters }],
        hand: opts.hand ?? [ADUNAPHEL_UNLEASHED], siteDeck: [MORIA] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: opts.defenderCharacters }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

function cvccAttackCombat(state: GameState, strikesTotal = 1): GameState {
  const combat: CombatState = {
    attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
    companyId: companyIdAt(state, HAZARD_PLAYER),
    defendingPlayerId: state.players[HAZARD_PLAYER].id,
    attackingPlayerId: state.players[RESOURCE_PLAYER].id,
    strikesTotal,
    strikeProwess: 0,
    creatureBody: null,
    creatureRace: undefined,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    isCvCC: true,
    detainment: false,
  };
  return { ...state, combat };
}

describe('Adûnaphel Unleashed (le-161)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: modify-attack (setStrikesTo 1, -2 body) ───────────────────────

  test('Mode A is offered to the defender when she is alone facing an attack', () => {
    const combat = defendingCombat({ characters: [ADUNAPHEL] });
    const actions = viableActions(combat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId)
      .toBe(combat.players[RESOURCE_PLAYER].hand[0].instanceId);
    // The attacker (hazard player) may never play this defender-side mode.
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode A is NOT offered when she has company mates', () => {
    const combat = defendingCombat({ characters: [ADUNAPHEL, ORC_CAPTAIN] });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('Mode A is NOT offered when the lone character is a different Ringwraith', () => {
    const combat = defendingCombat({ characters: [KHAMUL] });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('Mode A reduces the attack to one strike, -2 body, and discards the card', () => {
    const combat = defendingCombat({
      characters: [ADUNAPHEL],
      strikesTotal: 3,
      strikeProwess: 11,
      creatureBody: 8,
    });
    const cardInstance = findHandCardId(combat, RESOURCE_PLAYER, ADUNAPHEL_UNLEASHED);
    const action = viableActions(combat, PLAYER_1, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(11); // unaffected by Mode A
    expect(after.combat!.creatureBody).toBe(6);   // 8 - 2
    expect(after.combat!.strikesTotal).toBe(1);   // reduced from 3
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  // ─── Mode B: grant attacker-chooses-defenders + body-check modifier ───────

  test('Mode B is offered to the attacker when she attacks alone (CvCC)', () => {
    const state = attackingCvCCState({
      attackerCharacters: [ADUNAPHEL],
      defenderCharacters: [ARAGORN],
    });
    const combat = cvccAttackCombat(state);
    const actions = viableActions(combat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    // The defending (hero) player may never play this attacker-side mode.
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B is NOT offered when she has company mates', () => {
    const state = attackingCvCCState({
      attackerCharacters: [ADUNAPHEL, ORC_CAPTAIN],
      defenderCharacters: [ARAGORN],
    });
    const combat = cvccAttackCombat(state);
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B grants attacker-chooses-defenders, adds +2 body-check modifier, and discards the card', () => {
    const state = attackingCvCCState({
      attackerCharacters: [ADUNAPHEL],
      defenderCharacters: [ARAGORN],
    });
    const combat = cvccAttackCombat(state);
    const cardInstance = findHandCardId(combat, RESOURCE_PLAYER, ADUNAPHEL_UNLEASHED);
    const action = viableActions(combat, PLAYER_1, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackerChoosesDefenders).toBe(true);
    expect(after.combat!.assignmentPhase).toBe('attacker');
    expect(after.combat!.bodyCheckModifier).toBe(2);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('after Mode B, the attacker (not the defender) assigns her strike to any defending character', () => {
    const state = attackingCvCCState({
      attackerCharacters: [ADUNAPHEL],
      defenderCharacters: [ARAGORN, LEGOLAS],
    });
    const combat = cvccAttackCombat(state);
    const action = viableActions(combat, PLAYER_1, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    // Defender has no assignment action available (control passed to attacker).
    expect(viableActions(after, PLAYER_2, 'assign-strike')).toHaveLength(0);

    const adunaphelId = findCharInstanceId(after, RESOURCE_PLAYER, ADUNAPHEL);
    const aragornId = findCharInstanceId(after, HAZARD_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(after, HAZARD_PLAYER, LEGOLAS);
    const attackerAssigns = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as { characterId: CardInstanceId; attackingCharacterId?: CardInstanceId });
    expect(attackerAssigns).toHaveLength(2);
    for (const a of attackerAssigns) expect(a.attackingCharacterId).toBe(adunaphelId);
    expect(attackerAssigns.map(a => a.characterId).sort()).toEqual([aragornId, legolasId].sort());
  });

  test('the +2 body-check modifier changes a defending character\'s outcome (roll 8 vs body 9)', () => {
    const state = attackingCvCCState({
      attackerCharacters: [ADUNAPHEL],
      defenderCharacters: [ARAGORN],
    });
    const adunaphelId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    const aragornId = findCharInstanceId(state, HAZARD_PLAYER, ARAGORN);
    const bodyCheckCombat: CombatState = {
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
      companyId: companyIdAt(state, HAZARD_PLAYER),
      defendingPlayerId: state.players[HAZARD_PLAYER].id,
      attackingPlayerId: state.players[RESOURCE_PLAYER].id,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: undefined,
      strikeAssignments: [
        {
          characterId: aragornId,
          attackingCharacterId: adunaphelId,
          excessStrikes: 0,
          resolved: true,
          result: 'wounded',
          wasAlreadyWounded: false,
        },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: true,
      detainment: false,
      bodyCheckModifier: 2,
    };

    // Without the modifier, a roll of 8 would leave the body-9 Aragorn alive
    // (8 is not greater than 9). With the +2 modifier, the effective roll of
    // 10 exceeds his body and eliminates him.
    const ready = { ...state, combat: bodyCheckCombat, cheatRollTotal: 8 };
    const [bodyCheck] = viableActions(ready, PLAYER_1, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);
  });

  // ─── Cannot be duplicated on a given attack ────────────────────────────────

  test('cannot be duplicated on a given attack (Mode A)', () => {
    const combat = defendingCombat({
      characters: [ADUNAPHEL],
      hand: [ADUNAPHEL_UNLEASHED, ADUNAPHEL_UNLEASHED],
    });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(2);
    const first = viableActions(combat, PLAYER_1, 'modify-attack')[0].action;
    const after = dispatch(combat, first);

    // The second copy is still in hand, but the attack-scoped duplication
    // limit suppresses any further modify-attack offer for it.
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(viableActions(after, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });
});

/**
 * @module tw-97.test
 *
 * Card test: The Pale Sword (tw-97)
 * Type: hazard-event (permanent), unique, keyword "corruption".
 *
 * Text:
 *   "Unique. Playable on a company facing a Nazgûl attack. The Nazgûl's
 *    prowess is modified by +1. If played on a company facing an attack
 *    from The Witch-king of Angmar, his prowess is increased by +1 plus the
 *    number of Nazgûl permanent-events in play. Cannot be duplicated on a
 *    company facing such an attack. Discard if attack doesn't wound a
 *    character. Corruption. One character of attacker's choice wounded by
 *    this attack (on whom a corruption card has not already been played
 *    this turn) receives 6 corruption points (place this card under the
 *    character). If at a Haven/Darkhaven [{H}] during his untap phase, a
 *    character with this card may attempt to remove it instead of untapping
 *    or healing. Make a roll: if this result is greater than 5, discard
 *    this card. Cannot be duplicated on a given Nazgûl."
 *
 * Card shape (same primitives as Morgul-knife tw-64, plus a dynamic
 * `prowessModifierExpr` mode for the Witch-king clause):
 *   - effects[0]: `modify-attack` (fromHand, player "attacker"), gated
 *     `when: { "enemy.name": "Witch-king of Angmar" }`, carrying
 *     `prowessModifierExpr: "1 + nazgulPermanentEventsInPlay"` instead of a
 *     flat `prowessModifier` — "+1 plus the number of Nazgûl
 *     permanent-events in play". Also carries `attachCorruptionOnWound: true`.
 *   - effects[1]: `modify-attack` (fromHand, player "attacker") — the general
 *     "+1 prowess" case, gated `when: { "enemy.race": "ringwraith" }`. Modes
 *     are tried in order (Choking Shadows convention, §10e-quater of
 *     `docs/card-effects-dsl.md`): the Witch-king mode is offered first, so
 *     it wins whenever it matches; any other Nazgûl falls through to the
 *     general mode.
 *   - effects[2]: `stat-modifier` corruption-points +6.
 *   - effects[3]: `grant-action` `remove-corruption-instead-of-untap`,
 *     identical shape to Morgul-knife's, with `roll-then-apply` threshold 6
 *     ("greater than 5").
 *   - `keywords: ["corruption"]`, `removalNumber: 5`.
 *   - Both "Cannot be duplicated..." clauses are **not** modeled as an
 *     in-play `duplication-limit` effect: the card is `unique: true`, and per
 *     the established precedent for unique cards (The Balance of Things
 *     tw-93 — "Unique is deck-level, so no in-play duplication-limit" in
 *     `docs/card-effects-dsl.md`), deck construction already guarantees only
 *     one copy of a unique card can ever exist, so an in-play duplication
 *     check would be unreachable dead code.
 *
 * Engine support (new primitive, on top of Morgul-knife's established
 * `attachCorruptionOnWound` / `remove-corruption-instead-of-untap` pair):
 *   - `ModifyAttackEffect.prowessModifierExpr` (types/effects.ts): an
 *     alternative to `prowessModifier` — a MathJS value expression evaluated
 *     at play time. `handleModifyAttack` (combat-actions.ts) evaluates it via
 *     `evaluateExpr` with `nazgulPermanentEventsInPlay` in scope, rounding
 *     the result, when set.
 *   - `countNazgulPermanentEventsInPlay` (reducer-utils.ts): counts Nazgûl
 *     permanent-events across both players' `cardsInPlay` (reusing
 *     `isNazgulPermanentEvent`, which already established that such cards
 *     only ever live in `cardsInPlay`).
 *
 * Test-fixture note: the shared `makeCancelWindowCombat(..., { attackSourceType:
 * 'creature' })` helper places the attacking creature's card instance into the
 * hazard player's `cardsInPlay` as a testing shortcut — which would itself
 * satisfy `isNazgulPermanentEvent` for a dual-mode Nazgûl like the Witch-king,
 * double-counting the attacker against himself. In real play the attacking
 * card lives on the chain entry (`ChainEntry.card`), never in `cardsInPlay`,
 * so this is purely a fixture artifact. The Witch-king-mode tests below build
 * their own combat state, parking the attacking card in `hand` (also resolved
 * by `resolveInstanceId`, but outside `cardsInPlay`) instead of reusing that
 * helper, so the dynamic count reflects only genuinely in-play Nazgûl
 * permanent-events.
 *
 * Rule coverage:
 * | #  | Rule                                                                    | Status      |
 * |----|--------------------------------------------------------------------------|-------------|
 * | 1  | Offered to the attacker vs a non-Witch-king Nazgûl attack                | IMPLEMENTED |
 * | 2  | NOT offered vs a non-Ringwraith attack                                   | IMPLEMENTED |
 * | 3  | NOT offered to the defending (resource) player                           | IMPLEMENTED |
 * | 4  | General mode: +1 prowess, discards the card, charges hazard limit       | IMPLEMENTED |
 * | 5  | +6 corruption points while attached                                      | IMPLEMENTED |
 * | 6  | Witch-king mode chosen (not general) vs an attack named Witch-king       | IMPLEMENTED |
 * | 7  | Witch-king mode: +1 prowess with zero other Nazgûl permanent-events      | IMPLEMENTED |
 * | 8  | Witch-king mode: +3 prowess with two other Nazgûl permanent-events       | IMPLEMENTED |
 * | 9  | Attack wounds a character → card attaches to him, granting 6 CP         | IMPLEMENTED |
 * | 10 | Attack fully defeated (no wound) → card stays discarded                  | IMPLEMENTED |
 * | 11 | Detainment attack (tap, not wound) → card stays discarded                | IMPLEMENTED |
 * | 12 | A character already bearing a corruption card this turn is skipped —     | IMPLEMENTED |
 * |    | the card attaches to the next eligible wounded character instead         |             |
 * | 13 | Offered at a Haven/Darkhaven during the bearer's own untap phase,        | IMPLEMENTED |
 * |    | before the bulk untap action, with rollThreshold 6 ("greater than 5")    |             |
 * | 14 | NOT offered when the company is not at a Haven/Darkhaven                 | IMPLEMENTED |
 * | 15 | NOT offered once the bulk untap action has already run this phase       | IMPLEMENTED |
 * | 16 | Roll > 5 discards the card; the attempt itself costs the untap          | IMPLEMENTED |
 * | 17 | Roll ≤ 5 keeps the card attached; the attempt still costs the untap     | IMPLEMENTED |
 * | 18 | The forgone untap also forgoes healing for a wounded bearer              | IMPLEMENTED |
 * | 19 | A companion in the same company still untaps/heals normally             | IMPLEMENTED |
 * | 20 | The removal attempt may only be made once per untap phase                | IMPLEMENTED |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  BILBO, LEGOLAS,
  MORIA, LORIEN, RIVENDELL,
  buildTestState, resetMint, mint, makeMHState, setCharStatus, addCardInPlay, companyIdAt,
  viableActions, dispatch, executeAction,
  findCharInstanceId, attachHazardToChar,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Race, CardStatus } from '../../index.js';
import { makeCancelWindowCombat } from '../test-helpers-builders.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, CombatState, ModifyAttackAction, MovementHazardPhaseState,
  ActivateGrantedAction,
} from '../../index.js';

const THE_PALE_SWORD = 'tw-97' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;
const KHAMUL = 'tw-47' as CardDefinitionId;
const ADUNAPHEL = 'tw-2' as CardDefinitionId;

/** Base two-player MH state: PLAYER_1 defends with `characters`, PLAYER_2 (hazard) holds `hand`. */
function baseState(characters: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [LORIEN] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand, siteDeck: [MORIA] },
    ],
  });
}

/**
 * Builds a pre-assignment combat with the Witch-king of Angmar attacking as a
 * creature. Unlike `makeCancelWindowCombat({ attackSourceType: 'creature' })`,
 * this parks the attacking card in the hazard player's `hand` rather than
 * `cardsInPlay`, so it doesn't self-count as a Nazgûl permanent-event (see the
 * module doc comment).
 */
function witchKingAttackCombat(state: GameState, opts: { strikeProwess?: number } = {}): GameState {
  const creatureInstanceId = mint();
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const updatedHazardPlayer = {
    ...hazardPlayer,
    hand: [...hazardPlayer.hand, { instanceId: creatureInstanceId, definitionId: WITCH_KING }],
  };
  const players = [state.players[RESOURCE_PLAYER], updatedHazardPlayer] as unknown as GameState['players'];
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 17,
    creatureBody: null,
    creatureRace: Race.Ringwraith,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

/** Resolves a pending body-check, if any, trying whichever side is offered it. */
function resolveBodyCheckIfPending(s: GameState, roll: number): GameState {
  if (s.combat?.phase !== 'body-check') return s;
  const cheated = { ...s, cheatRollTotal: roll };
  const action = viableActions(cheated, PLAYER_1, 'body-check-roll')[0]?.action
    ?? viableActions(cheated, PLAYER_2, 'body-check-roll')[0]?.action;
  return dispatch(cheated, action);
}

describe('The Pale Sword (tw-97)', () => {
  beforeEach(() => resetMint());

  // ─── Attached corruption points ────────────────────────────────────────

  test('attached The Pale Sword adds 6 corruption points to the bearer', () => {
    const base = baseState([BILBO], []);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    expect(base.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(0);

    const withSword = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD));
    expect(withSword.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(6);
  });

  // ─── Rules 1-3: playability gate (general mode, from-hand modify-attack window) ──

  test('offered to the attacker vs a Ringwraith attack, pre-assignment', () => {
    const base = baseState([BILBO], [THE_PALE_SWORD]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ModifyAttackAction).player).toBe(PLAYER_2);
  });

  test('NOT offered vs a non-Ringwraith attack (Orc)', () => {
    const base = baseState([BILBO], [THE_PALE_SWORD]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('NOT offered to the defending (resource) player', () => {
    const base = baseState([BILBO], []);
    const withResourceHand: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], hand: [{ instanceId: 'x' as CardInstanceId, definitionId: THE_PALE_SWORD }] },
        base.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const combat = makeCancelWindowCombat(withResourceHand, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  // ─── Rule 4-5: playing the general mode ─────────────────────────────────

  test('general mode adds +1 prowess, discards the card, and charges the hazard limit', () => {
    const base = baseState([BILBO], [THE_PALE_SWORD]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.pendingCorruptionAttach).toBeDefined();
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany ?? 0).toBe(1);
  });

  // ─── Rules 6-8: Witch-king mode selection and dynamic prowess ──────────

  test('vs the Witch-king of Angmar, the Witch-king mode is chosen and adds +1 with no other Nazgûl permanent-events in play', () => {
    const base = baseState([BILBO], [THE_PALE_SWORD]);
    const combat = witchKingAttackCombat(base);
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat!.strikeProwess).toBe(18);
  });

  test('vs the Witch-king of Angmar with two other Nazgûl permanent-events in play, prowess is boosted by +3 (1 + 2)', () => {
    const withPermEvents = addCardInPlay(addCardInPlay(baseState([BILBO], [THE_PALE_SWORD]), HAZARD_PLAYER, KHAMUL), HAZARD_PLAYER, ADUNAPHEL);
    const combat = witchKingAttackCombat(withPermEvents);
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat!.strikeProwess).toBe(20);
  });

  // ─── Rules 9-12: post-attack dynamic corruption attachment (general mode) ──

  /** Drives a single-strike general-mode Nazgûl attack (The Pale Sword already in hand) to finalization. */
  function playAndResolveSingleStrike(opts: {
    strikeRoll: number;
    strikeProwess: number;
    bodyCheckRoll?: number;
    detainment?: boolean;
  }): GameState {
    const base = baseState([BILBO], [THE_PALE_SWORD]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: opts.strikeProwess,
    });
    let s: GameState = opts.detainment ? { ...combat, combat: { ...combat.combat!, detainment: true } } : combat;
    const action = viableActions(s, PLAYER_2, 'modify-attack')[0].action;
    s = dispatch(s, action);

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId, tapped: false });
    s = executeAction(s, PLAYER_1, 'resolve-strike', opts.strikeRoll);
    s = resolveBodyCheckIfPending(s, opts.bodyCheckRoll ?? 2);
    return s;
  }

  test('attack wounds the defender → The Pale Sword attaches, granting 6 corruption points', () => {
    // Bilbo prowess 1 + roll 2 = 3, vs strike prowess 20+1=21 → wounded.
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    const hazards = s.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards.map(h => h.definitionId)).toContain(THE_PALE_SWORD);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(false);

    const recomputed = recomputeDerived(s);
    expect(recomputed.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(6);

    expect((s.phaseState as MovementHazardPhaseState).corruptionCardsPlayedPerChar[bilboId]).toBe(true);
  });

  test('attack fully defeated (no wound) → card remains discarded, attached to nobody', () => {
    // Bilbo prowess 1 + roll 12 = 13 > strike prowess 3+1=4 → strike defeated;
    // automatic-attack has no body (null), auto-defeated with no body check.
    const s = playAndResolveSingleStrike({ strikeRoll: 12, strikeProwess: 3 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(true);
  });

  test('detainment attack (character tapped, not wounded) → card remains discarded', () => {
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20, detainment: true });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(true);
    expectCharStatus(s, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  test('a character already bearing a corruption card this turn is skipped — the card attaches to the next eligible wounded character', () => {
    const base = baseState([BILBO, LEGOLAS], [THE_PALE_SWORD]);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 2,
      strikeProwess: 20,
    });
    // Bilbo already had a corruption card played on him this turn.
    const combat: GameState = {
      ...combat0,
      phaseState: makeMHState({ corruptionCardsPlayedPerChar: { [bilboId]: true } }),
    };

    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    let s = dispatch(combat, action);

    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    // Bilbo resolves first (array order): prowess 1 + roll 2 = 3 ≤ 21 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);
    // Legolas resolves second: prowess 5 + roll 2 = 7 ≤ 21 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);

    expect(s.combat ?? null).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    const legolasHazards = s.players[RESOURCE_PLAYER].characters[legolasId].hazards;
    expect(legolasHazards.map(h => h.definitionId)).toContain(THE_PALE_SWORD);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(false);
  });

  // ─── Rules 13-20: untap-phase removal "instead of untapping or healing" ──

  /** Untap-phase state: PLAYER_1's lone company is at `site`, with `chars`. */
  function untapPhaseState(opts: { site?: CardDefinitionId; chars?: CardDefinitionId[]; alreadyUntapped?: boolean }): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: opts.site ?? RIVENDELL, characters: opts.chars ?? [BILBO] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    if (opts.alreadyUntapped) {
      return { ...state, phaseState: { ...state.phaseState, untapped: true } as GameState['phaseState'] };
    }
    return state;
  }

  function removalAction(s: GameState): ActivateGrantedAction | undefined {
    return viableActions(s, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'remove-corruption-instead-of-untap');
  }

  test('offered at a Haven, before the bulk untap action, with rollThreshold 6 ("greater than 5")', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withSword);
    expect(action).toBeDefined();
    expect(action!.rollThreshold).toBe(6);
  });

  test('NOT offered when the company is not at a Haven/Darkhaven', () => {
    const state = untapPhaseState({ site: MORIA, chars: [BILBO] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    expect(removalAction(withSword)).toBeUndefined();
  });

  test('NOT offered once the bulk untap action has already run this phase', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO], alreadyUntapped: true });
    const withSword = attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD);
    expect(removalAction(withSword)).toBeUndefined();
  });

  test('roll > 5 discards the card; the attempt itself costs the untap', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO, LEGOLAS] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withSword)!;
    const rolled = dispatch({ ...withSword, cheatRollTotal: 6 }, action);

    const bilboId = findCharInstanceId(rolled, RESOURCE_PLAYER, BILBO);
    expect(rolled.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expectInDiscardPile(rolled, HAZARD_PLAYER, THE_PALE_SWORD);
    // The card is no longer offered again this phase (oncePerTurn).
    expect(removalAction(rolled)).toBeUndefined();

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    // Bilbo forwent his untap this phase — stays tapped.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    // Legolas, uninvolved, untaps normally.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, LEGOLAS, CardStatus.Untapped);
  });

  test('roll <= 5 keeps the card attached; the attempt still costs the untap', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withSword)!;
    const rolled = dispatch({ ...withSword, cheatRollTotal: 5 }, action);

    const bilboId = findCharInstanceId(rolled, RESOURCE_PLAYER, BILBO);
    const hazards = rolled.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(THE_PALE_SWORD);
    expect(rolled.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_PALE_SWORD)).toBe(false);

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  test('the forgone untap also forgoes healing for a wounded bearer', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Inverted,
    );
    const action = removalAction(withSword)!;
    const rolled = dispatch({ ...withSword, cheatRollTotal: 5 }, action);

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    // Bilbo stays wounded — he forwent healing at the Haven this phase.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
  });

  test('control: without activating the removal, a wounded bearer heals normally at a Haven', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withSword = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, THE_PALE_SWORD),
      RESOURCE_PLAYER, BILBO, CardStatus.Inverted,
    );
    const afterUntap = dispatch(withSword, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });
});

/**
 * @module tw-64.test
 *
 * Card test: Morgul-knife (tw-64)
 * Type: hazard-event (permanent), neutral, non-unique, keyword "corruption".
 *
 * Text:
 *   "Playable on a company facing a Nazgûl attack. The Nazgûl's prowess is
 *    modified by +2. Discard if attack doesn't wound a character. Cannot be
 *    duplicated on a company facing such an attack. Corruption. One character
 *    of attacker's choice wounded by the attack (on whom a corruption card
 *    has not already been played this turn) receives 4 corruption points
 *    (place this card under the character). If at a Haven/Darkhaven [{H}]
 *    during his untap phase, a character with this card may attempt to
 *    remove it instead of untapping or healing. Make a roll: if this result
 *    is greater than 4, discard this card."
 *
 * Card shape:
 *   - effects[0]: `modify-attack` (fromHand, player "attacker") — +2 prowess
 *     to the attack, gated `when: { "enemy.race": "ringwraith" }`, carrying
 *     `attachCorruptionOnWound: true` (same primitive as Icy Touch td-33).
 *     "Of attacker's choice" among multiple wounded characters is modeled by
 *     the existing "first eligible character wounded, strike-array order"
 *     simplification — the documented precedent for `attachCorruptionOnWound`
 *     — since a Ringwraith CvCC attack virtually always wounds at most one
 *     character (no `strikes` stat on Ringwraith characters), so "attacker's
 *     choice" and "first wounded" coincide in every realistic case.
 *   - effects[1]: `duplication-limit` scope "attack", max 1.
 *   - effects[2]: `stat-modifier` corruption-points +4.
 *   - effects[3]: `grant-action` `remove-corruption-instead-of-untap`,
 *     `cost: {}`, `anyPhase: true`, `oncePerTurn: true`, gated
 *     `when: { phase: "untap", bearer.atHaven: true, untap.resourcePlayerUntapped: false }`.
 *     `apply` is a `sequence` of a `roll-then-apply` (threshold 5 =
 *     "greater than 4", discarding the card on success) followed by an
 *     unconditional `add-constraint skip-untap-and-heal` (scope "turn",
 *     target "bearer") — the constraint is added *after* the roll so a
 *     successful self-discard doesn't sweep it away (a card leaving play
 *     drops every constraint it sourced, `dropConstraintsSourcedBy`,
 *     reducer-move.ts).
 *   - `keywords: ["corruption"]`, `removalNumber: 4` (data-level, matching
 *     every other certified corruption card).
 *
 * Engine support (new primitives, on top of Icy Touch's `attachCorruptionOnWound`):
 *   - `skip-untap-and-heal` `ActiveConstraint` kind (types/pending.ts):
 *     unlike `bearer-cannot-untap` (which still allows healing at a haven),
 *     this blocks BOTH the tapped→untapped and inverted→tapped transitions
 *     for one character for one untap-phase sweep. Consumed directly by
 *     `performUntap` (reducer-untap.ts); no legal-action filtering needed
 *     (`applyOneConstraint`, legal-actions/pending.ts, is a pass-through).
 *   - `buildGrantActionContext` (legal-actions/organization.ts) gained a
 *     `untap.resourcePlayerUntapped` context field (only populated during
 *     the Untap phase) so a grant-action `when` clause can require that the
 *     bulk `untap` action for this phase has not yet fired — the printed
 *     "instead of untapping or healing" window closes once it has.
 *   - `rollThresholdFor` (granted-action-emit.ts) now unwraps one level of
 *     `sequence` to find a nested `roll-then-apply`'s threshold, so a gated
 *     roll (constraint-then-roll, as here) still reports its threshold on
 *     the emitted `ActivateGrantedAction`.
 *
 * Rule coverage:
 * | #  | Rule                                                                    | Status      |
 * |----|--------------------------------------------------------------------------|-------------|
 * | 1  | Offered to the attacker vs a non-detainment-gated Ringwraith attack      | IMPLEMENTED |
 * | 2  | NOT offered vs a non-Ringwraith attack                                   | IMPLEMENTED |
 * | 3  | NOT offered to the defending (resource) player                           | IMPLEMENTED |
 * | 4  | Playing it adds +2 prowess, discards the card, charges hazard limit      | IMPLEMENTED |
 * | 5  | Cannot be duplicated on a company facing such an attack                  | IMPLEMENTED |
 * | 6  | +4 corruption points while attached                                      | IMPLEMENTED |
 * | 7  | Attack wounds a character → card attaches to him, granting 4 CP          | IMPLEMENTED |
 * | 8  | Attack fully defeated (no wound) → card stays discarded                  | IMPLEMENTED |
 * | 9  | Detainment attack (tap, not wound) → card stays discarded                | IMPLEMENTED |
 * | 10 | A character already bearing a corruption card this turn is skipped —     | IMPLEMENTED |
 * |    | the card attaches to the next eligible wounded character instead         |             |
 * | 11 | Offered at a Haven/Darkhaven during the bearer's own untap phase,        | IMPLEMENTED |
 * |    | before the bulk untap action                                             |             |
 * | 12 | NOT offered when the company is not at a Haven/Darkhaven                 | IMPLEMENTED |
 * | 13 | NOT offered once the bulk untap action has already run this phase       | IMPLEMENTED |
 * | 14 | Roll > 4 discards the card; the attempt itself costs the untap           | IMPLEMENTED |
 * | 15 | Roll ≤ 4 keeps the card attached; the attempt still costs the untap     | IMPLEMENTED |
 * | 16 | The forgone untap also forgoes healing for a wounded bearer              | IMPLEMENTED |
 * | 17 | A companion in the same company still untaps/heals normally             | IMPLEMENTED |
 * | 18 | The removal attempt may only be made once per untap phase                | IMPLEMENTED |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  BILBO, LEGOLAS,
  MORIA, LORIEN, RIVENDELL,
  buildTestState, resetMint, makeMHState, setCharStatus,
  viableActions, dispatch, executeAction,
  findCharInstanceId, attachHazardToChar,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Race, CardStatus } from '../../index.js';
import { makeCancelWindowCombat } from '../test-helpers-builders.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, ModifyAttackAction, MovementHazardPhaseState,
  ActivateGrantedAction,
} from '../../index.js';

const MORGUL_KNIFE = 'tw-64' as CardDefinitionId;

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

/** Resolves a pending body-check, if any, trying whichever side is offered it. */
function resolveBodyCheckIfPending(s: GameState, roll: number): GameState {
  if (s.combat?.phase !== 'body-check') return s;
  const cheated = { ...s, cheatRollTotal: roll };
  const action = viableActions(cheated, PLAYER_1, 'body-check-roll')[0]?.action
    ?? viableActions(cheated, PLAYER_2, 'body-check-roll')[0]?.action;
  return dispatch(cheated, action);
}

describe('Morgul-knife (tw-64)', () => {
  beforeEach(() => resetMint());

  // ─── Attached corruption points ────────────────────────────────────────

  test('attached Morgul-knife adds 4 corruption points to the bearer', () => {
    const base = baseState([BILBO], []);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    expect(base.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(0);

    const withKnife = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE));
    expect(withKnife.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(4);
  });

  // ─── Rules 1-3: playability gate (from-hand modify-attack window) ──────

  test('offered to the attacker vs a Ringwraith attack, pre-assignment', () => {
    const base = baseState([BILBO], [MORGUL_KNIFE]);
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
    const base = baseState([BILBO], [MORGUL_KNIFE]);
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
        { ...base.players[RESOURCE_PLAYER], hand: [{ instanceId: 'x' as CardInstanceId, definitionId: MORGUL_KNIFE }] },
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

  // ─── Rule 4: playing the card ───────────────────────────────────────────

  test('playing it adds +2 prowess, discards the card, and charges the hazard limit', () => {
    const base = baseState([BILBO], [MORGUL_KNIFE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.pendingCorruptionAttach).toBeDefined();
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany ?? 0).toBe(1);
  });

  // ─── Rule 5: duplication limit ──────────────────────────────────────────

  test('a second copy of Morgul-knife is suppressed on the same attack', () => {
    const base = baseState([BILBO], [MORGUL_KNIFE, MORGUL_KNIFE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 6,
    });

    const before = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(before).toHaveLength(2);

    const after = dispatch(combat, before[0].action);
    expect(after.combat!.strikeProwess).toBe(8);

    expect(viableActions(after, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  // ─── Rules 7-10: post-attack dynamic corruption attachment ─────────────

  /** Drives a single-strike attack (Morgul-knife already in hand) to finalization. */
  function playAndResolveSingleStrike(opts: {
    strikeRoll: number;
    strikeProwess: number;
    bodyCheckRoll?: number;
    detainment?: boolean;
  }): GameState {
    const base = baseState([BILBO], [MORGUL_KNIFE]);
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

  test('attack wounds the defender → Morgul-knife attaches, granting 4 corruption points', () => {
    // Bilbo prowess 1 + roll 2 = 3, vs strike prowess 20+2=22 → wounded.
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    const hazards = s.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards.map(h => h.definitionId)).toContain(MORGUL_KNIFE);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(false);

    const recomputed = recomputeDerived(s);
    expect(recomputed.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(4);

    expect((s.phaseState as MovementHazardPhaseState).corruptionCardsPlayedPerChar[bilboId]).toBe(true);
  });

  test('attack fully defeated (no wound) → card remains discarded, attached to nobody', () => {
    // Bilbo prowess 1 + roll 12 = 13 > strike prowess 3+2=5 → strike defeated;
    // automatic-attack has no body (null), auto-defeated with no body check.
    const s = playAndResolveSingleStrike({ strikeRoll: 12, strikeProwess: 3 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(true);
  });

  test('detainment attack (character tapped, not wounded) → card remains discarded', () => {
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20, detainment: true });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(true);
    expectCharStatus(s, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  test('a character already bearing a corruption card this turn is skipped — the card attaches to the next eligible wounded character', () => {
    const base = baseState([BILBO, LEGOLAS], [MORGUL_KNIFE]);
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
    // Bilbo resolves first (array order): prowess 1 + roll 2 = 3 ≤ 22 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);
    // Legolas resolves second: prowess 5 + roll 2 = 7 ≤ 22 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);

    expect(s.combat ?? null).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    const legolasHazards = s.players[RESOURCE_PLAYER].characters[legolasId].hazards;
    expect(legolasHazards.map(h => h.definitionId)).toContain(MORGUL_KNIFE);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(false);
  });

  // ─── Rules 11-18: untap-phase removal "instead of untapping or healing" ──

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

  test('offered at a Haven, before the bulk untap action, with rollThreshold 5 ("greater than 4")', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withKnife);
    expect(action).toBeDefined();
    expect(action!.rollThreshold).toBe(5);
  });

  test('NOT offered when the company is not at a Haven/Darkhaven', () => {
    const state = untapPhaseState({ site: MORIA, chars: [BILBO] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    expect(removalAction(withKnife)).toBeUndefined();
  });

  test('NOT offered once the bulk untap action has already run this phase', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO], alreadyUntapped: true });
    const withKnife = attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE);
    expect(removalAction(withKnife)).toBeUndefined();
  });

  test('roll > 4 discards the card; the attempt itself costs the untap', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO, LEGOLAS] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withKnife)!;
    const rolled = dispatch({ ...withKnife, cheatRollTotal: 5 }, action);

    const bilboId = findCharInstanceId(rolled, RESOURCE_PLAYER, BILBO);
    expect(rolled.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expectInDiscardPile(rolled, HAZARD_PLAYER, MORGUL_KNIFE);
    // The card is no longer offered again this phase (oncePerTurn).
    expect(removalAction(rolled)).toBeUndefined();

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    // Bilbo forwent his untap this phase — stays tapped.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    // Legolas, uninvolved, untaps normally.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, LEGOLAS, CardStatus.Untapped);
  });

  test('roll <= 4 keeps the card attached; the attempt still costs the untap', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Tapped,
    );
    const action = removalAction(withKnife)!;
    const rolled = dispatch({ ...withKnife, cheatRollTotal: 4 }, action);

    const bilboId = findCharInstanceId(rolled, RESOURCE_PLAYER, BILBO);
    const hazards = rolled.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(MORGUL_KNIFE);
    expect(rolled.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MORGUL_KNIFE)).toBe(false);

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  test('the forgone untap also forgoes healing for a wounded bearer', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Inverted,
    );
    const action = removalAction(withKnife)!;
    const rolled = dispatch({ ...withKnife, cheatRollTotal: 4 }, action);

    const afterUntap = dispatch(rolled, { type: 'untap', player: PLAYER_1 });
    // Bilbo stays wounded — he forwent healing at the Haven this phase.
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
  });

  test('control: without activating the removal, a wounded bearer heals normally at a Haven', () => {
    const state = untapPhaseState({ site: RIVENDELL, chars: [BILBO] });
    const withKnife = setCharStatus(
      attachHazardToChar(state, RESOURCE_PLAYER, BILBO, MORGUL_KNIFE),
      RESOURCE_PLAYER, BILBO, CardStatus.Inverted,
    );
    const afterUntap = dispatch(withKnife, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(afterUntap, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });
});

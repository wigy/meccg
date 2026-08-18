/**
 * @module wh-112.test
 *
 * Card test: Master of Shapes (wh-112)
 * Type: minion-resource-event (permanent), alignment: stage. Non-unique.
 *       Radagast specific. Shapeshifter. Stage points 1.
 * Adopted attribute line (from `data/cards.json`, WH-112): prowess 9, body 10,
 *       general influence 25, direct influence 1, corruption -2.
 *
 * Card text (authoritative — CoE cards database):
 *   "Radagast specific. Shapeshifter. Place this card on Radagast if he is in
 *    play. Return this card to your hand: when you play another Shapeshifter
 *    card or, if you choose, during your organization phase. In addition to
 *    adopting the given attributes, Radagast's skills become Warrior/Ranger.
 *    Radagast's prowess is only modified by -1 when not tapping to face a
 *    strike. Radagast may bear, but may not use items."
 *
 * Engine support:
 * | # | Rule                                                          | Status      | Mechanism |
 * |---|---------------------------------------------------------------|-------------|-----------|
 * | 1 | Radagast specific — only a Radagast player may play it        | IMPLEMENTED | `radagast-specific` keyword → `wizardSpecificName` |
 * | 2 | Placed on Radagast                                            | IMPLEMENTED | `play-target` character, filter `target.name: Radagast` |
 * | 3 | Stage points (1) while in play                                | IMPLEMENTED | `stage-points` |
 * | 4 | Adopting the given attributes (prowess/body/DI/GI/corruption) | IMPLEMENTED | `stat-modifier` `op: "set"` (+ `corruption-points` -2), precedent wh-115 |
 * | 5 | Skills become Warrior/Ranger (replacing, not adding)          | IMPLEMENTED | `override-skills` via `getEffectiveSkills` |
 * | 6 | Prowess modified only -1 when not tapping to face a strike    | IMPLEMENTED | `stat-modifier` `untap-penalty` `op: "set"` `value: 1`, precedent as-132 |
 * | 7 | Radagast may bear, but may not use, items                     | IMPLEMENTED | `play-flag: bearer-cannot-use-items` (CP still applies) |
 * | 8 | Return to hand during your organization phase (optional)      | IMPLEMENTED | `return-to-hand` `organization`, extended to attached permanent-events |
 * | 9 | Return to hand when another Shapeshifter card is played       | IMPLEMENTED | `return-to-hand` `replaced-by-keyword` + `shapeshifter` keyword |
 *
 * Modeling notes:
 *  - "Adopting the given attributes" is an absolute **set**, not a delta,
 *    matching the sibling Shapeshifter form Shifter of Hues (wh-115): the
 *    printed direct influence (1) is *lower* than Radagast's own (5), which a
 *    delta reading could not produce.
 *  - Rule 6 is the CoE 3.iv.3 "stay untapped" prowess penalty (normally 3),
 *    reduced to 1 for Radagast while this form is on him. It is resolved by
 *    `computeStayUntappedPenalty` (`recompute-derived.ts`), the same
 *    `untap-penalty` synthetic-stat machinery certified for Thong of Fire
 *    (as-132)'s "no prowess penalty when not tapping".
 *  - Unlike Shifter of Hues (wh-115) and Winged Change-master (wh-116), this
 *    card's text carries no movement restriction and no hand-size bonus, so
 *    no `bearer-cannot-move` / `hand-size-modifier` effect is added.
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint, recomputeDerived,
  viableActions,
  findCharInstanceId, findHandCardId, getCharacter,
  attachItemToChar, playPermanentEventAndResolve,
  makeSingleCharCombatState,
  dispatch,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { getEffectiveSkills } from '../../engine/effects/index.js';
import { Alignment, Phase, effectiveGeneralInfluence } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, ResolveStrikeAction,
} from '../../index.js';
import { Race } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Master of Shapes — the card under test. */
const MASTER_OF_SHAPES = 'wh-112' as CardDefinitionId;
/** Radagast — the Fallen-wizard avatar this card is specific to. */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Saruman — a different Fallen-wizard avatar (negative control for "specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero company-mate; negative control for "place on Radagast". */
const BOROMIR = 'tw-134' as CardDefinitionId;

/** Isengard — a Fallen-wizard Wizardhaven. Used rather than Radagast's own
 *  Rhosgobel (wh-57), which grants a stage point of its own and would muddy
 *  the stage-point assertions. */
const ISENGARD_FW = 'wh-56' as CardDefinitionId;

/** Dagger of Westernesse — non-unique weapon, +1 prowess (DSL), 1 corruption point. */
const DAGGER = 'tw-206' as CardDefinitionId;

/** A second Shapeshifter form, for the "playing another Shapeshifter returns
 *  this one to hand" trigger. */
const SHIFTER_OF_HUES = 'wh-115' as CardDefinitionId;

// ── Builders ───────────────────────────────────────────────────────────────

/**
 * Organization-phase state: Fallen-wizard P1 whose avatar is `avatar`, at
 * Isengard, plus an idle hero opponent. `companies` overrides P1's companies.
 */
function fwOrgState(opts?: {
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  companies?: Parameters<typeof buildTestState>[0]['players'][0]['companies'];
}): GameState {
  const avatar = opts?.avatar ?? RADAGAST;
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: opts?.companies ?? [{ site: ISENGARD_FW, characters: [avatar, BOROMIR] }],
        hand: opts?.hand ?? [MASTER_OF_SHAPES],
        siteDeck: [ISENGARD_FW],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD_FW, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD_FW],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** P1's org state with Master of Shapes already on Radagast. */
function withMasterOfShapes(state: GameState): GameState {
  return recomputeDerived(attachItemToChar(state, RESOURCE_PLAYER, RADAGAST, MASTER_OF_SHAPES));
}

/** The roll the defender needs, for the tap-to-fight and stay-untapped options. */
function strikeNeeds(state: GameState): { tap: number; untap: number | undefined } {
  const actions = viableActions(state, PLAYER_1, 'resolve-strike')
    .map(ea => ea.action as ResolveStrikeAction);
  return {
    tap: actions.find(a => a.tapToFight)!.need,
    untap: actions.find(a => !a.tapToFight)?.need,
  };
}

describe('Master of Shapes (wh-112)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–3: Radagast specific, placed on Radagast, stage points ────────

  test('offered only on the Radagast character, never on a company-mate', () => {
    const state = fwOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    expect(targetIds).toContain(findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST));
    expect(targetIds).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR));
    expect(actions.length).toBe(1);
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = fwOrgState({ avatar: SARUMAN });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('placing it on Radagast attaches it and yields 1 stage point', () => {
    const base = fwOrgState();
    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);

    const after = playPermanentEventAndResolve(
      base, PLAYER_1,
      findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_SHAPES),
      findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST),
    );

    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === MASTER_OF_SHAPES)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
    assertEveryInstanceReachable(after);
  });

  // ── Rule 4: adopting the given attributes ────────────────────────────────

  test('baseline: Radagast alone has his printed attribute line', () => {
    const state = fwOrgState();
    const radagast = getCharacter(state, RESOURCE_PLAYER, RADAGAST);
    expect(radagast.effectiveStats.prowess).toBe(6);
    expect(radagast.effectiveStats.body).toBe(9);
    expect(radagast.effectiveStats.directInfluence).toBe(5);
    expect(radagast.effectiveStats.corruptionPoints).toBe(0);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(22);
  });

  test('the form replaces Radagast\'s attributes with its own printed line', () => {
    const state = withMasterOfShapes(fwOrgState());
    const radagast = getCharacter(state, RESOURCE_PLAYER, RADAGAST);

    expect(radagast.effectiveStats.prowess).toBe(9);            // printed 6 → set 9
    expect(radagast.effectiveStats.body).toBe(10);               // printed 9 → set 10
    expect(radagast.effectiveStats.directInfluence).toBe(1);     // printed 5 → set 1 (a *lower* value: proves "set")
    expect(radagast.effectiveStats.corruptionPoints).toBe(-2);   // the printed corruption -2
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(25); // printed 22 → set 25
  });

  // ── Rule 5: skills become Warrior/Ranger ─────────────────────────────────

  test('skills become Warrior/Ranger, replacing his printed Scout and Diplomat', () => {
    const base = fwOrgState();
    // Baseline: Radagast prints warrior/scout/ranger/diplomat, so he is a
    // diplomat too. With the form on him the engine must see only Warrior/Ranger.
    const state = withMasterOfShapes(base);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const radagast = state.players[RESOURCE_PLAYER].characters[radagastId];
    const radagastDef = state.cardPool[RADAGAST] as unknown as { skills: readonly string[] };

    expect([...radagastDef.skills].sort()).toEqual(['diplomat', 'ranger', 'scout', 'warrior']);
    expect([...getEffectiveSkills(state, radagast, radagastDef)].sort()).toEqual(['ranger', 'warrior']);
  });

  // ── Rule 6: prowess only modified by -1 when not tapping to face a strike ─

  test('without the form, Radagast pays the standard -3 to stay untapped', () => {
    const state = makeSingleCharCombatState({
      heroDefId: RADAGAST,
      alignment: Alignment.FallenWizard,
      site: ISENGARD_FW,
      siteDeck: [ISENGARD_FW],
      creatureRace: Race.Orc,
      creatureProwess: 14,
      creatureBody: 9,
      preAssigned: true,
    });
    // Tap: prowess 6 → need max(2, 14-6+1) = 9. Untap: 6-3 = 3 → need max(2, 14-3+1) = 12.
    expect(strikeNeeds(state)).toEqual({ tap: 9, untap: 12 });
  });

  test('with the form, prowess is set to 9 and the stay-untapped penalty is only -1', () => {
    const base = makeSingleCharCombatState({
      heroDefId: RADAGAST,
      alignment: Alignment.FallenWizard,
      site: ISENGARD_FW,
      siteDeck: [ISENGARD_FW],
      creatureRace: Race.Orc,
      creatureProwess: 14,
      creatureBody: 9,
      preAssigned: true,
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, MASTER_OF_SHAPES));
    // Tap: prowess 9 → need max(2, 14-9+1) = 6. Untap: 9-1 = 8 → need max(2, 14-8+1) = 7.
    expect(strikeNeeds(state)).toEqual({ tap: 6, untap: 7 });
  });

  // ── Rule 7: may bear, but may not use, items ─────────────────────────────

  test('a borne item gives Radagast no bonus, but its corruption points still apply', () => {
    const base = fwOrgState();

    // Control: without the form, the Dagger's +1 prowess and 1 CP both land.
    const armed = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, DAGGER));
    expect(getCharacter(armed, RESOURCE_PLAYER, RADAGAST).effectiveStats.prowess).toBe(7);
    expect(getCharacter(armed, RESOURCE_PLAYER, RADAGAST).effectiveStats.corruptionPoints).toBe(1);

    // With the form: prowess stays at the adopted 9 (the item is borne, not
    // used), while the item's corruption point still counts against him.
    const shifted = recomputeDerived(attachItemToChar(withMasterOfShapes(base), RESOURCE_PLAYER, RADAGAST, DAGGER));
    const radagast = getCharacter(shifted, RESOURCE_PLAYER, RADAGAST);
    expect(radagast.effectiveStats.prowess).toBe(9);
    expect(radagast.effectiveStats.corruptionPoints).toBe(-1); // form -2 + dagger +1
    // The item is still borne — "may bear" is not "may not carry".
    expect(radagast.items.some(i => i.definitionId === DAGGER)).toBe(true);
  });

  test('a company-mate is unaffected — the ban is Radagast\'s alone', () => {
    const base = withMasterOfShapes(fwOrgState());
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, BOROMIR, DAGGER));
    const boromirDef = state.cardPool[BOROMIR] as unknown as { prowess: number };
    expect(getCharacter(state, RESOURCE_PLAYER, BOROMIR).effectiveStats.prowess).toBe(boromirDef.prowess + 1);
  });

  // ── Rule 8: optional return to hand during your organization phase ───────

  test('may be returned to hand during your organization phase, losing its stage point', () => {
    const base = fwOrgState();
    let state = playPermanentEventAndResolve(
      base, PLAYER_1,
      findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_SHAPES),
      findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST),
    );
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    const cardInstId = getCharacter(state, RESOURCE_PLAYER, RADAGAST)
      .items.find(i => i.definitionId === MASTER_OF_SHAPES)!.instanceId;
    const ret = viableActions(state, PLAYER_1, 'return-attached-to-hand')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId })
      .find(a => a.cardInstanceId === cardInstId)!;
    expect(ret).toBeDefined();

    state = dispatch(state, { type: 'return-attached-to-hand', player: PLAYER_1, cardInstanceId: cardInstId });

    // Back in hand (never the discard pile), and Radagast is himself again.
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardInstId)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstId)).toBe(false);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.length).toBe(0);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).effectiveStats.directInfluence).toBe(5);
    assertEveryInstanceReachable(state);
  });

  // ── Rule 9: playing another Shapeshifter returns this one to hand ────────

  test('playing another Shapeshifter card returns Master of Shapes to hand', () => {
    const base = fwOrgState({ hand: [MASTER_OF_SHAPES, SHIFTER_OF_HUES] });
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const masterId = findHandCardId(base, RESOURCE_PLAYER, MASTER_OF_SHAPES);
    const shifterId = findHandCardId(base, RESOURCE_PLAYER, SHIFTER_OF_HUES);

    let state = playPermanentEventAndResolve(base, PLAYER_1, masterId, radagastId);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.map(i => i.instanceId)).toEqual([masterId]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    state = playPermanentEventAndResolve(state, PLAYER_1, shifterId, radagastId);

    // The newly played form stays; Master of Shapes went back to hand, not to
    // the discard pile, and Radagast wears exactly one shape.
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.map(i => i.instanceId)).toEqual([shifterId]);
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === masterId)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === masterId)).toBe(false);
    assertEveryInstanceReachable(state);
  });
});

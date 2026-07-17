/**
 * @module wh-115.test
 *
 * Card test: Shifter of Hues (wh-115)
 * Type: minion-resource-event (permanent), alignment: stage. Non-unique.
 *       Radagast specific. Shapeshifter. Stage points 1.
 * Adopted attribute line: prowess 6, body 10, general influence 27,
 *       direct influence 3, corruption -2.
 *
 * Card text (authoritative — CoE cards database):
 *   "Radagast specific. Shapeshifter. Place this card on Radagast if he is in
 *    play. Return this card to your hand: when you play another Shapeshifter
 *    card or, if you choose, during your organization phase. In addition to
 *    adopting the given attributes, Radagast's skills become Warrior/Diplomat.
 *    Radagast may not move. You may keep one more card than normal in your
 *    hand. Radagast can tap give +2 to the corruption checks of the characters
 *    in one company through your next organization phase (this company must be
 *    moving with at least one Wilderness [{w}] in their site path). Radagast
 *    may bear, but may not use, items."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Radagast specific — only a Radagast player may play it        | IMPLEMENTED | `radagast-specific` keyword → `wizardSpecificName` |
 * | 2 | Placed on Radagast                                            | IMPLEMENTED | `play-target` character, filter `target.name: Radagast` |
 * | 3 | Stage points (1) while in play                                | IMPLEMENTED | `stage-points` |
 * | 4 | Adopting the given attributes (prowess/body/DI/GI/corruption) | IMPLEMENTED | NEW `stat-modifier` `op: "set"` (+ `corruption-points` -2) |
 * | 5 | Skills become Warrior/Diplomat (replacing, not adding)        | IMPLEMENTED | NEW `override-skills` via `getEffectiveSkills` |
 * | 6 | Radagast may not move                                         | IMPLEMENTED | NEW `play-flag: bearer-cannot-move` |
 * | 7 | Keep one more card than normal in hand                        | IMPLEMENTED | `hand-size-modifier` 1 |
 * | 8 | Tap → +2 corruption to one company through next org phase     | IMPLEMENTED | `grant-action` + NEW `lasting` check-modifier + NEW `next-organization-phase` scope |
 * | 9 | …only a company moving with a Wilderness in its site path     | IMPLEMENTED | NEW `targets.movingThroughRegionType` |
 * |10 | Radagast may bear, but may not use, items                     | IMPLEMENTED | NEW `play-flag: bearer-cannot-use-items` (CP still applies) |
 * |11 | Return to hand during your organization phase (optional)      | IMPLEMENTED | `return-to-hand` `organization`, extended to attached permanent-events |
 * |12 | Return to hand when another Shapeshifter card is played       | IMPLEMENTED | NEW `return-to-hand` `replaced-by-keyword` + `shapeshifter` keyword |
 *
 * Modeling notes:
 *  - "Adopting the given attributes" is an absolute **set**, not a delta. The
 *    sibling Winged Change-master (wh-116) prints prowess 3 against Radagast's
 *    printed 6, and Shifter of Hues prints direct influence 3 against his
 *    printed 5 — a delta reading cannot produce a *lower* number from a
 *    positive attribute line, so `op: "set"` is the only consistent reading.
 *  - The printed `corruption -2` is corruption **points**, matching every other
 *    card in the pool whose attribute box carries `corruption` (Bow of Alatar
 *    wh-90's `corruption 1` is 1 CP). The Shapeshifter forms are simply the
 *    only cards that print a negative one.
 *  - Radagast may not move, so his *company* may not move while he is in it;
 *    the player's escape hatch is the ordinary organization-phase split.
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint, recomputeDerived,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId, getCharacter, companyIdAt,
  attachItemToChar, playPermanentEventAndResolve, enqueueCorruptionCheck,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { resolveHandSize, getEffectiveSkills } from '../../engine/effects/index.js';
import { Alignment, Phase, CardStatus, effectiveGeneralInfluence, reduce, HAND_SIZE } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInstanceId, GameState, PlanMovementAction,
} from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Shifter of Hues — the card under test. */
const SHIFTER = 'wh-115' as CardDefinitionId;
/** Radagast — the Fallen-wizard avatar this card is specific to. */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Saruman — a different Fallen-wizard avatar (negative control for "specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero company-mate; negative control for "place on Radagast". */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Legolas — a second hero character, for a company Radagast is not in. */
const LEGOLAS = 'tw-168' as CardDefinitionId;
/** Aragorn II — a hero character in a second moving company (negative control). */
const ARAGORN = 'tw-120' as CardDefinitionId;

/** Isengard — a Fallen-wizard Wizardhaven. Used rather than Radagast's own
 *  Rhosgobel (wh-57), which grants a stage point of its own and would muddy
 *  the stage-point assertions. */
const ISENGARD_FW = 'wh-56' as CardDefinitionId;
/** Moria — site path [wilderness, wilderness]. */
const MORIA = 'tw-413' as CardDefinitionId;
/** Himring — site path [free, coastal-sea]: NO wilderness. */
const HIMRING = 'tw-401' as CardDefinitionId;
/** Rivendell — a hero haven for the idle opponent. */
const RIVENDELL = 'tw-421' as CardDefinitionId;

/** Dagger of Westernesse — non-unique weapon, +1 prowess (DSL), 1 corruption point. */
const DAGGER = 'tw-206' as CardDefinitionId;

const ACTION_ID = 'shifter-of-hues-corruption-aid';

// ── Builders ───────────────────────────────────────────────────────────────

/**
 * Organization-phase state: Fallen-wizard P1 whose avatar is `avatar`, at
 * Isengard, plus an idle hero opponent. `companies` overrides P1's companies.
 */
function fwOrgState(opts?: {
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  companies?: Parameters<typeof buildTestState>[0]['players'][0]['companies'];
  siteDeck?: CardDefinitionId[];
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
        hand: opts?.hand ?? [SHIFTER],
        siteDeck: opts?.siteDeck ?? [MORIA, HIMRING, ISENGARD_FW],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** P1's org state with the Shifter already on Radagast. */
function withShifter(state: GameState): GameState {
  return recomputeDerived(attachItemToChar(state, RESOURCE_PLAYER, RADAGAST, SHIFTER));
}

/** Grant activations for the Shifter's corruption-aid ability. */
function shifterGrants(state: GameState): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === ACTION_ID);
}

/** The pre-summed corruption modifier a check by `charId` would carry. */
function corruptionModifierFor(state: GameState, charId: CardInstanceId): number {
  const s = enqueueCorruptionCheck(state, PLAYER_1, charId);
  const roll = viableActions(s, PLAYER_1, 'corruption-check')
    .map(ea => ea.action as CorruptionCheckAction)
    .find(a => a.characterId === charId)!;
  return roll.corruptionModifier;
}

describe('Shifter of Hues (wh-115)', () => {
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
      findHandCardId(base, RESOURCE_PLAYER, SHIFTER),
      findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST),
    );

    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === SHIFTER)).toBe(true);
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
    const state = withShifter(fwOrgState());
    const radagast = getCharacter(state, RESOURCE_PLAYER, RADAGAST);

    expect(radagast.effectiveStats.prowess).toBe(6);            // printed 6 → set 6
    expect(radagast.effectiveStats.body).toBe(10);              // printed 9 → set 10
    expect(radagast.effectiveStats.directInfluence).toBe(3);    // printed 5 → set 3 (a *lower* value: proves "set")
    expect(radagast.effectiveStats.corruptionPoints).toBe(-2);  // the printed corruption -2
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(27); // printed 22 → set 27
  });

  // ── Rule 5: skills become Warrior/Diplomat ───────────────────────────────

  test('skills become Warrior/Diplomat, replacing his printed Scout and Ranger', () => {
    const base = fwOrgState();
    // Baseline: Radagast prints warrior/scout/ranger/diplomat, so he is a scout
    // and can be offered a scout-gated activation. With the form on him the
    // engine must no longer see scout/ranger anywhere.
    const state = withShifter(base);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const radagast = state.players[RESOURCE_PLAYER].characters[radagastId];
    const radagastDef = state.cardPool[RADAGAST] as unknown as { skills: readonly string[] };

    expect([...radagastDef.skills].sort()).toEqual(['diplomat', 'ranger', 'scout', 'warrior']);
    expect([...getEffectiveSkills(state, radagast, radagastDef)].sort()).toEqual(['diplomat', 'warrior']);
  });

  // ── Rule 6: Radagast may not move ────────────────────────────────────────

  test('baseline: Radagast\'s company may declare movement without the form', () => {
    const state = fwOrgState();
    const radagastCompany = companyIdAt(state, RESOURCE_PLAYER, 0);
    const moves = viableActions(state, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction)
      .filter(a => a.companyId === radagastCompany);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('with the form on him, his company is offered no movement — but a company without him still is', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST, BOROMIR] },
        { site: ISENGARD_FW, characters: [LEGOLAS] },
      ],
    });
    const state = withShifter(base);
    const radagastCompany = companyIdAt(state, RESOURCE_PLAYER, 0);
    const otherCompany = companyIdAt(state, RESOURCE_PLAYER, 1);

    const moves = viableActions(state, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    expect(moves.some(a => a.companyId === radagastCompany)).toBe(false);
    expect(moves.some(a => a.companyId === otherCompany)).toBe(true);
  });

  test('the reducer rejects a plan-movement forced through for his company', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST, BOROMIR] },
        { site: ISENGARD_FW, characters: [LEGOLAS] },
      ],
    });
    const legal = viableActions(base, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction)
      .find(a => a.companyId === companyIdAt(base, RESOURCE_PLAYER, 0))!;

    const state = withShifter(base);
    const result = reduce(state, legal);
    expect(result.error).toMatch(/may not move/);
    expect(result.state.players[RESOURCE_PLAYER].companies[0].destinationSite).toBeNull();
  });

  // ── Rule 7: keep one more card than normal in hand ───────────────────────

  test('hand size is one more than normal while the form is in play', () => {
    const base = fwOrgState();
    expect(resolveHandSize(base, RESOURCE_PLAYER)).toBe(HAND_SIZE);
    expect(resolveHandSize(withShifter(base), RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  // ── Rule 10: may bear, but may not use, items ────────────────────────────

  test('a borne item gives Radagast no bonus, but its corruption points still apply', () => {
    const base = fwOrgState();

    // Control: without the form, the Dagger's +1 prowess and 1 CP both land.
    const armed = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, DAGGER));
    expect(getCharacter(armed, RESOURCE_PLAYER, RADAGAST).effectiveStats.prowess).toBe(7);
    expect(getCharacter(armed, RESOURCE_PLAYER, RADAGAST).effectiveStats.corruptionPoints).toBe(1);

    // With the form: prowess stays at the adopted 6 (the item is borne, not
    // used), while the item's corruption point still counts against him.
    const shifted = recomputeDerived(attachItemToChar(withShifter(base), RESOURCE_PLAYER, RADAGAST, DAGGER));
    const radagast = getCharacter(shifted, RESOURCE_PLAYER, RADAGAST);
    expect(radagast.effectiveStats.prowess).toBe(6);
    expect(radagast.effectiveStats.corruptionPoints).toBe(-1); // form -2 + dagger +1
    // The item is still borne — "may bear" is not "may not carry".
    expect(radagast.items.some(i => i.definitionId === DAGGER)).toBe(true);
  });

  test('a company-mate is unaffected — the ban is Radagast\'s alone', () => {
    const base = withShifter(fwOrgState());
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, BOROMIR, DAGGER));
    const boromirDef = state.cardPool[BOROMIR] as unknown as { prowess: number };
    expect(getCharacter(state, RESOURCE_PLAYER, BOROMIR).effectiveStats.prowess).toBe(boromirDef.prowess + 1);
  });

  // ── Rules 8–9: tap to aid one moving company's corruption checks ──────────

  test('offered only for a company moving with a Wilderness in its site path', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR], destinationSite: MORIA },   // wilderness ✓
        { site: ISENGARD_FW, characters: [LEGOLAS], destinationSite: HIMRING }, // no wilderness ✗
      ],
    });
    const state = withShifter(base);
    const grants = shifterGrants(state);

    expect(grants.map(g => g.targetCompanyId)).toEqual([companyIdAt(state, RESOURCE_PLAYER, 1)]);
  });

  test('not offered when no company is moving at all', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR] }, // stationary
      ],
    });
    expect(shifterGrants(withShifter(base)).length).toBe(0);
  });

  test('not offered when Radagast is already tapped', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [{ defId: RADAGAST, status: CardStatus.Tapped }] },
        { site: ISENGARD_FW, characters: [BOROMIR], destinationSite: MORIA },
      ],
    });
    expect(shifterGrants(withShifter(base)).length).toBe(0);
  });

  test('activating taps Radagast and adds a lasting +2 company corruption modifier', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR], destinationSite: MORIA },
      ],
    });
    const state = withShifter(base);
    const movingCompany = companyIdAt(state, RESOURCE_PLAYER, 1);

    const after = dispatch(state, shifterGrants(state)[0]);

    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'check-modifier'
      && c.kind.check === 'corruption'
      && c.kind.value === 2
      && c.kind.lasting === true
      && c.target.kind === 'company'
      && c.target.companyId === movingCompany)).toBe(true);
  });

  test('the +2 applies to every character in the targeted company and not to another company', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR, LEGOLAS], destinationSite: MORIA },
        { site: ISENGARD_FW, characters: [ARAGORN], destinationSite: MORIA },
      ],
    });
    let state = withShifter(base);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const outsiderId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const movingCompany = companyIdAt(state, RESOURCE_PLAYER, 1);

    // Baselines: a character may carry its own inherent corruption modifier,
    // so the aid is asserted as a delta against each character's own baseline.
    const boromirBase = corruptionModifierFor(state, boromirId);
    const legolasBase = corruptionModifierFor(state, legolasId);
    const outsiderBase = corruptionModifierFor(state, outsiderId);

    state = dispatch(state, shifterGrants(state).find(g => g.targetCompanyId === movingCompany)!);

    // Every character in the targeted company benefits — the card says
    // "the characters in one company", with no minion/race qualifier.
    expect(corruptionModifierFor(state, boromirId)).toBe(boromirBase + 2);
    expect(corruptionModifierFor(state, legolasId)).toBe(legolasBase + 2);
    // The other (untargeted) moving company gets nothing.
    expect(corruptionModifierFor(state, outsiderId)).toBe(outsiderBase);
  });

  test('the +2 is not consumed by the first corruption check', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR, LEGOLAS], destinationSite: MORIA },
      ],
    });
    let state = withShifter(base);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const legolasBase = corruptionModifierFor(state, legolasId);
    state = dispatch(state, shifterGrants(state)[0]);

    // Resolve a real corruption check for Boromir, then confirm the modifier
    // still stands for both him and his company-mate.
    let checking = enqueueCorruptionCheck(state, PLAYER_1, boromirId);
    const roll = viableActions(checking, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === boromirId)!;
    checking = dispatch(checking, roll);

    expect(checking.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption' && c.kind.lasting === true)).toBe(true);
    expect(corruptionModifierFor(checking, legolasId)).toBe(legolasBase + 2);
  });

  test('the +2 survives this organization phase\'s end and expires at the next one', () => {
    const base = fwOrgState({
      companies: [
        { site: ISENGARD_FW, characters: [RADAGAST] },
        { site: ISENGARD_FW, characters: [BOROMIR], destinationSite: MORIA },
      ],
    });
    let state = withShifter(base);
    state = dispatch(state, shifterGrants(state)[0]);
    const constraintCount = () => state.activeConstraints.filter(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption').length;
    expect(constraintCount()).toBe(1);

    // Leaving the organization phase it was created in must NOT expire it —
    // "through your next organization phase" has to cover this turn's
    // movement and site phases.
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(state.phaseState.phase).toBe(Phase.LongEvent);
    expect(constraintCount()).toBe(1);

    // Re-enter an organization phase on a later turn and leave it: now it goes.
    state = {
      ...state,
      turnNumber: state.turnNumber + 2,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: false,
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      },
    };
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(constraintCount()).toBe(0);
  });

  // ── Rule 11: optional return to hand during your organization phase ───────

  test('may be returned to hand during your organization phase, losing its stage point', () => {
    const base = fwOrgState();
    let state = playPermanentEventAndResolve(
      base, PLAYER_1,
      findHandCardId(base, RESOURCE_PLAYER, SHIFTER),
      findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST),
    );
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    const shifterInstId = getCharacter(state, RESOURCE_PLAYER, RADAGAST)
      .items.find(i => i.definitionId === SHIFTER)!.instanceId;
    const ret = viableActions(state, PLAYER_1, 'return-attached-to-hand')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId })
      .find(a => a.cardInstanceId === shifterInstId)!;
    expect(ret).toBeDefined();

    state = dispatch(state, { type: 'return-attached-to-hand', player: PLAYER_1, cardInstanceId: shifterInstId });

    // Back in hand (never the discard pile), and Radagast is himself again.
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === shifterInstId)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === shifterInstId)).toBe(false);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.length).toBe(0);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).effectiveStats.directInfluence).toBe(5);
    assertEveryInstanceReachable(state);
  });

  // ── Rule 12: playing another Shapeshifter returns this one to hand ────────

  test('playing another Shapeshifter card returns the earlier form to hand', () => {
    // Shifter of Hues is non-unique, so a second copy is a legal "another
    // Shapeshifter card" — the trigger keys off the keyword, not the name.
    const base = fwOrgState({ hand: [SHIFTER, SHIFTER] });
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const [firstId, secondId] = base.players[RESOURCE_PLAYER].hand
      .filter(c => c.definitionId === SHIFTER)
      .map(c => c.instanceId);

    let state = playPermanentEventAndResolve(base, PLAYER_1, firstId, radagastId);
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.map(i => i.instanceId)).toEqual([firstId]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    state = playPermanentEventAndResolve(state, PLAYER_1, secondId, radagastId);

    // The newly played form stays; the earlier one went back to hand, not to
    // the discard pile, and Radagast wears exactly one shape.
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).items.map(i => i.instanceId)).toEqual([secondId]);
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === firstId)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === firstId)).toBe(false);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);
    assertEveryInstanceReachable(state);
  });
});

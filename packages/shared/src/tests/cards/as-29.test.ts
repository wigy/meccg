/**
 * @module as-29.test
 *
 * Card test: FEAR! FIRE! FOES! (as-29)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a Free-hold [{F}] or Border-hold [{B}]. An additional
 *    automatic-attack is created at the site this turn: 5 strikes with 8 prowess
 *    (detainment, no attack type). Alternatively, playable on a detainment
 *    automatic-attack a minion company is facing. The attack becomes normal
 *    (not detainment) and has -1 prowess."
 *
 * CRF-22 erratum: the second mode reads "…playable on a detainment
 * automatic-attack. Against a minion company the attack becomes normal…".
 *
 * Effects:
 *   Mode A — create-site-auto-attack (siteTypes free-hold/border-hold): a M/H
 *     hazard short-event played on a company moving to a Free-hold/Border-hold;
 *     installs a turn-scoped `extra-automatic-attack` constraint keyed to the
 *     destination site instance so the company faces one additional real
 *     automatic-attack (5 strikes, 8 prowess, forced detainment, no race) in the
 *     site phase.
 *   Mode B — modify-attack (fromHand, player "attacker", removeDetainment,
 *     prowessModifier -1): played by the hazard player on a detainment
 *     automatic-attack a minion company is facing; the attack becomes normal and
 *     loses 1 prowess.
 *
 * Playable: YES.
 * CERTIFIED 2026-07-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, RIVENDELL, LORIEN, MINAS_TIRITH, BREE,
  makeMHState, buildSitePhaseState, setupAutoAttackStep,
  makeCancelWindowCombat,
  viableActions, playHazardAndResolve, dispatch,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, CardInstanceId, ModifyAttackAction } from '../../index.js';

const FEAR_FIRE_FOES = 'as-29' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId; // minion-character (Orc), prowess 6

/** M/H state: PLAYER_1 (resource) moving from Rivendell to `destination`; PLAYER_2 holds the given hand. */
function buildMovingState(destination: CardDefinitionId, destinationSiteName: string, hand: CardDefinitionId[] = [FEAR_FIRE_FOES]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: destination }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName }),
  };
}

/** The FEAR! FIRE! FOES! play-hazard actions in PLAYER_2's hand. */
function fffActions(state: GameState) {
  return viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
    const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
    return card?.definitionId === FEAR_FIRE_FOES;
  });
}

describe('FEAR! FIRE! FOES! (as-29)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: playability gate (moving to a Free-hold / Border-hold) ────────

  test('Mode A: offered against a company moving to a Free-hold', () => {
    const state = buildMovingState(MINAS_TIRITH, 'Minas Tirith'); // free-hold
    const actions = fffActions(state);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('Mode A: offered against a company moving to a Border-hold', () => {
    const state = buildMovingState(BREE, 'Bree'); // border-hold
    const actions = fffActions(state);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('Mode A: NOT offered against a company moving to a non-hold site (Moria, shadow-hold)', () => {
    const state = buildMovingState(MORIA, 'Moria'); // shadow-hold
    const la = viableActions(state, PLAYER_2, 'play-hazard');
    const viable = la.filter(a => {
      const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
      return card?.definitionId === FEAR_FIRE_FOES;
    });
    expect(viable).toHaveLength(0);
  });

  test('Mode A: NOT offered against a stationary company at a Free-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        // No destinationSite → not moving.
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FEAR_FIRE_FOES], siteDeck: [MORIA] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName: 'Minas Tirith' }) };
    const viable = fffActions(withMH);
    expect(viable).toHaveLength(0);
  });

  // ─── Mode A: installs the extra-automatic-attack constraint ────────────────

  test('Mode A: playing it installs a turn-scoped extra-automatic-attack constraint (5 strikes, 8 prowess, detainment)', () => {
    const state = buildMovingState(MINAS_TIRITH, 'Minas Tirith');
    const fff = state.players[1].hand.find(c => c.definitionId === FEAR_FIRE_FOES)!;
    const company = state.players[0].companies[0];
    const after = playHazardAndResolve(state, PLAYER_2, fff.instanceId, company.id);

    const extra = after.activeConstraints.find(c => c.kind.type === 'extra-automatic-attack');
    expect(extra).toBeDefined();
    if (extra?.kind.type !== 'extra-automatic-attack') throw new Error('unreachable');
    // Keyed to the destination site instance (which becomes currentSite on arrival).
    expect(extra.kind.siteInstanceId).toBe(company.destinationSite!.instanceId);
    expect(extra.kind.attack.strikes).toBe(5);
    expect(extra.kind.attack.prowess).toBe(8);
    expect(extra.kind.attack.forceDetainment).toBe(true);
    expect(extra.kind.attack.creatureType).toBe(''); // no attack type
    expect(extra.scope.kind).toBe('turn');
    // Card discarded to the hazard player's pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FEAR_FIRE_FOES)).toBe(true);
  });

  // ─── Mode A: the company actually faces the created attack in the site phase ─

  test('Mode A: the company faces the created attack as a real automatic-attack in the site phase', () => {
    const state = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] }); // free-hold, 0 printed attacks
    const company = state.players[0].companies[0];
    // Install the constraint exactly as the M/H resolution does.
    const withConstraint = addConstraint(state, {
      source: 'as29-src' as CardInstanceId,
      sourceDefinitionId: FEAR_FIRE_FOES,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: company.id },
      kind: {
        type: 'extra-automatic-attack',
        siteInstanceId: company.currentSite!.instanceId,
        attack: { creatureType: '', strikes: 5, prowess: 8, forceDetainment: true },
      },
    });

    const atAutoAttacks = setupAutoAttackStep(withConstraint);
    // Resource player passes → the created automatic-attack initiates combat.
    const combatState = dispatch(atAutoAttacks, { type: 'pass', player: PLAYER_1 });

    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.attackSource.type).toBe('automatic-attack');
    expect(combatState.combat!.strikesTotal).toBe(5);
    expect(combatState.combat!.strikeProwess).toBe(8);
    expect(combatState.combat!.detainment).toBe(true);
  });

  test('Mode A: with no constraint, the Free-hold has no automatic-attacks (control)', () => {
    const state = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] });
    const atAutoAttacks = setupAutoAttackStep(state);
    // No attacks → passing advances the site phase without creating combat.
    const advanced = dispatch(atAutoAttacks, { type: 'pass', player: PLAYER_1 });
    expect(advanced.combat).toBeNull();
  });

  // ─── Mode B: convert a detainment automatic-attack against a minion company ─

  /** Base state: PLAYER_1 = minion (Ringwraith) defender; PLAYER_2 = hazard attacker. */
  function minionBase(hazardHand: CardDefinitionId[], defenderHand: CardDefinitionId[] = []): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [GORBAG] }], hand: defenderHand, siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [RIVENDELL] },
      ],
    });
  }

  /** A detainment site automatic-attack against the defending company. */
  function detainmentAutoAttack(base: GameState, opts: { detainment: boolean }): GameState {
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: 'orc',
      strikesTotal: 2,
      strikeProwess: 8,
    });
    return { ...combat, combat: { ...combat.combat!, detainment: opts.detainment } };
  }

  test('Mode B: attacker may play it on a detainment automatic-attack a minion company faces', () => {
    const base = minionBase([FEAR_FIRE_FOES]);
    const combat = detainmentAutoAttack(base, { detainment: true });
    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ModifyAttackAction).player).toBe(PLAYER_2);
  });

  test('Mode B: playing it makes the attack normal (detainment → false) and -1 prowess; discards the card', () => {
    const base = minionBase([FEAR_FIRE_FOES]);
    const combat = detainmentAutoAttack(base, { detainment: true });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(false);       // becomes normal
    expect(after.combat!.strikeProwess).toBe(7);         // 8 - 1
    expect(after.combat!.strikesTotal).toBe(2);          // unchanged
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FEAR_FIRE_FOES)).toBe(true);
  });

  test('Mode B: NOT offered on a non-detainment automatic-attack', () => {
    const base = minionBase([FEAR_FIRE_FOES]);
    const combat = detainmentAutoAttack(base, { detainment: false });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B: NOT offered against a non-minion (hero) company', () => {
    // PLAYER_1 is a Wizard (hero) — defender.minionCompany is false.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FEAR_FIRE_FOES], siteDeck: [RIVENDELL] },
      ],
    });
    const combat = detainmentAutoAttack(base, { detainment: true });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B: NOT offered on a detainment creature attack (must be an automatic-attack)', () => {
    const base = minionBase([FEAR_FIRE_FOES]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: 'orc',
      strikesTotal: 2,
      strikeProwess: 8,
    });
    const combat = { ...combat0, combat: { ...combat0.combat!, detainment: true } };
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B: the defending (minion) player cannot play it — attacker-only', () => {
    // FEAR! FIRE! FOES! is in the minion defender's hand.
    const base = minionBase([], [FEAR_FIRE_FOES]);
    const combat = detainmentAutoAttack(base, { detainment: true });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });
});

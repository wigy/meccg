/**
 * @module td-16.test
 *
 * Card test: Dragon's Curse (td-16)
 * Type: hazard-event (permanent)
 *
 * "Corruption. Dark enchantment. Playable on a non-Wizard character
 *  facing a strike from a Dragon hazard creature attack. The strike's
 *  prowess is modified by -1. The character receives 2 corruption
 *  points. The target character makes a corruption check at the end of
 *  his untap phase. Cannot be duplicated on a given character. During
 *  his organization phase, a sage in the target character's company may
 *  tap to attempt to remove this card. Make a roll: if this result is
 *  greater than 6, discard this card."
 *
 * Engine Support:
 * | # | Rule                                       | Status      | Notes                                   |
 * |---|--------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only during a Dragon creature     | IMPLEMENTED | play-window combat/resolve-strike +     |
 * |   | attack, on a character facing the strike   |             | play-condition combat-creature-race +   |
 * |   | (non-Wizard)                               |             | play-target character filter.           |
 * | 2 | That strike's prowess is modified by -1    | IMPLEMENTED | on-event self-enters-play-combat with   |
 * |   |                                            |             | modify-current-strike-prowess -1.       |
 * | 3 | +2 corruption points while attached        | IMPLEMENTED | stat-modifier corruption-points +2.     |
 * | 4 | Corruption check at end of untap phase     | IMPLEMENTED | on-event untap-phase-end enqueues a     |
 * |   | (any site — no haven gate)                 |             | corruption-check pending resolution.    |
 * | 5 | Cannot be duplicated on a given character  | IMPLEMENTED | duplication-limit scope:character max:1 |
 * |   |                                            |             | gates legal-action emission.            |
 * | 6 | During organization, a sage in the target  | IMPLEMENTED | grant-action remove-self-on-roll with   |
 * |   | character's company may tap to attempt to  |             | cost { tap: "sage-in-company" } and     |
 * |   | remove; roll > 6 discards                  |             | threshold 7.                            |
 * | 7 | Keywords: corruption, dark-enchantment     | DATA        | Present in keywords[].                  |
 *
 * Playable: YES — every rule is implemented in the engine and exercised
 * by assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, attachItemToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, companyIdAt, findCharInstanceId, dispatch, viableFor, viableActions,
  grantedActionsFor, expectInDiscardPile, expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CombatState, CorruptionCheckAction, GameState, PlayHazardAction } from '../../index.js';
import { CardStatus } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const DRAGONS_CURSE = 'td-16' as CardDefinitionId;
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

/**
 * Build a resolve-strike combat state for a Dragon attack against the
 * given defender character, with Dragon's Curse in the hazard player's
 * hand. Minimal scaffolding — the attack source is a synthetic dragon
 * creature whose instance doesn't need to appear in play for
 * legal-action emission to succeed.
 */
function makeDragonResolveStrikeState(opts: {
  defender: CardDefinitionId;
  secondDefender?: CardDefinitionId;
  creatureRace?: string;
  strikeProwess?: number;
  curseInHand?: boolean;
  bearHelmet?: boolean;
}): { state: GameState } {
  const defenders: CardDefinitionId[] = opts.secondDefender
    ? [opts.defender, opts.secondDefender]
    : [opts.defender];
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: defenders }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.curseInHand === false ? [] : [DRAGONS_CURSE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const withHelmet = opts.bearHelmet
    ? attachItemToChar(base, RESOURCE_PLAYER, opts.defender, ADAMANT_HELMET)
    : base;
  const defenderId = findCharInstanceId(withHelmet, RESOURCE_PLAYER, opts.defender);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-dragon' as import('../../index.js').CardInstanceId },
    companyId: companyIdAt(withHelmet, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 8,
    creatureBody: null,
    creatureRace: opts.creatureRace ?? 'dragon',
    strikeAssignments: [{ characterId: defenderId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { state: { ...withHelmet, combat } };
}

describe("Dragon's Curse (td-16)", () => {
  beforeEach(() => resetMint());

  test('attached Dragon\'s Curse adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    const withCurse = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE));
    expect(withCurse.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(2);
  });

  test('untap → org transition enqueues a corruption check regardless of site (non-haven)', () => {
    // Unlike Lure of the Senses (which is haven-gated), Dragon's Curse
    // fires the untap-end corruption check at any site.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const afterUntap = dispatch(withCurse, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe("Dragon's Curse");

    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Legal actions for P1 should collapse to the corruption-check resolution
    const viable = viableFor(afterPass, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');

    const cc = viable[0].action as CorruptionCheckAction;
    // Aragorn base corruptionPoints 0 + 2 from curse = 2; Aragorn's corruptionModifier is 0
    expect(cc.corruptionPoints).toBe(2);
    expect(cc.corruptionModifier).toBe(0);
  });

  test('untap → org transition at a haven still fires the corruption check', () => {
    // Gate-less trigger: a haven should not suppress the check either.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const afterUntap = dispatch(withCurse, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ─── Rule 6: sage-tap removal during organization ──────────────────────────

  test('offers one remove-self-on-roll action per eligible sage in bearer\'s company', () => {
    // Aragorn (non-sage) bears the curse; Elrond (sage) shares the
    // company. The grant-action must be offered to Elrond, not to
    // Aragorn (who has no "sage" skill) and not as a bearer-tap.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    const aragornId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ARAGORN);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);

    expect(grantedActionsFor(withCurse, aragornId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);

    const elrondOffers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);
    expect(elrondOffers).toHaveLength(1);
    expect(elrondOffers[0].rollThreshold).toBe(7);
  });

  test('no sage in the bearer\'s company → no removal offered', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    expect(viableActions(withCurse, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('tapped sage is not offered the removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: ELROND, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    expect(viableActions(withCurse, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('successful sage roll (>6) taps the sage and discards the curse from the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);
    const offers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);
    expect(offers).toHaveLength(1);

    const cheated = { ...withCurse, cheatRollTotal: 7 };
    const next = dispatch(cheated, offers[0]);

    // Elrond (the sage) taps; Aragorn (the bearer) stays untapped.
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    // Curse leaves Aragorn's hazards and lands in the hazard player's discard pile.
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, DRAGONS_CURSE);
  });

  test('failed sage roll (<=6) keeps the curse attached but still taps the sage', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);
    const offers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);

    const cheated = { ...withCurse, cheatRollTotal: 6 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    const hazards = next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(DRAGONS_CURSE);
  });

  // ─── Rules 1 & 2: combat-time play + strike prowess -1 ─────────────────────

  test('hazard player can play Dragon\'s Curse on the defender during a Dragon attack resolve-strike', () => {
    const { state } = makeDragonResolveStrikeState({ defender: ARAGORN });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === aragornId)).toHaveLength(1);
  });

  test('NOT offered when the attacking creature is not a Dragon', () => {
    const { state } = makeDragonResolveStrikeState({ defender: ARAGORN, creatureRace: 'drake' });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT offered against a Wizard defender', () => {
    const { state } = makeDragonResolveStrikeState({ defender: GANDALF });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT offered if a copy is already on the defender (duplication-limit)', () => {
    const { state } = makeDragonResolveStrikeState({ defender: ARAGORN });
    const preloaded = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const plays = viableActions(preloaded, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('playing the curse attaches it to the defender and reduces the current strike\'s prowess by 1', () => {
    const { state } = makeDragonResolveStrikeState({ defender: ARAGORN });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);

    const next = dispatch(state, plays[0].action);

    // Curse attached to Aragorn's hazards.
    expect(next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards.map(h => h.definitionId))
      .toContain(DRAGONS_CURSE);

    // The current strike's defender prowess bonus picks up +1 — the engine
    // encodes "strike prowess -1" as "defender prowess +1" on the current
    // StrikeAssignment.
    const currentStrike = next.combat!.strikeAssignments[next.combat!.currentStrikeIndex];
    expect(currentStrike.strikeProwessBonus).toBe(1);

    // Effective need is eased by 1: strikeProwess 8 vs Aragorn prowess 6
    // (base) is normally need 3 tapped; +1 strike bonus → need 2.
    const resolveActions = viableActions(next, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true);
    expect(tapAction).toBeDefined();
    expect((tapAction!.action as { need: number }).need).toBe(2);
  });

  test('a bearer warded by Adamant Helmet (dark-enchantment ward) discards the curse on attach', () => {
    const { state } = makeDragonResolveStrikeState({ defender: ARAGORN, bearHelmet: true });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    // Legal-action emitter doesn't currently inspect wards for combat plays;
    // offering is still present, but the reducer cancels the attachment on
    // dispatch and routes the curse to the hazard player's discard pile.
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    const next = dispatch(state, plays[0].action);

    expect(next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, DRAGONS_CURSE);
    // Strike prowess is untouched — the curse never attached.
    expect(next.combat!.strikeAssignments[0].strikeProwessBonus ?? 0).toBe(0);
  });

  test('combat play-window pins the card out of the M/H phase hazard menu', () => {
    // During movement-hazard phase, Dragon's Curse should not be offered
    // even though it has a play-target: its play-window ties it to combat.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRAGONS_CURSE], siteDeck: [RIVENDELL] },
      ],
    });
    const plays = viableActions(base, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});

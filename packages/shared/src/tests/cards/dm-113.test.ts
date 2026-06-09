/**
 * @module dm-113.test
 *
 * Card test: Wisp of Pale Sheen (dm-113)
 * Type: hazard-creature
 * Strikes: 1, Prowess: 6, Body: — (none), Race: Undead
 * Keyed to: wilderness / shadow-land / dark-domain / coastal-sea regions, or
 *           ruins-and-lairs / shadow-hold sites (`{w}{s}{d}{c}{R}{S}`).
 * Effects: 2 — combat-attacker-chooses-defenders, combat-tap-low-mind
 *
 * "Undead. One strike. Attacker chooses defending characters. Any character
 * facing a strike whose mind is equal to or lower than the strike's prowess
 * must tap if untapped following the strike (unless the strike is canceled)."
 *
 * This tests:
 * 1. combat-attacker-chooses-defenders — the hazard player assigns the strike,
 *    the defender does not.
 * 2. combat-tap-low-mind — a low-mind defender (mind ≤ 6) who wins the strike
 *    while staying untapped is nevertheless tapped following the strike.
 * 3. combat-tap-low-mind does NOT affect a high-mind defender (mind > 6) who
 *    wins while untapped — they stay untapped.
 * 4. combat-tap-low-mind does not over-tap a wounded low-mind defender — a
 *    defender who loses the strike ends wounded (inverted), not merely tapped.
 *
 * Defender mind values used (TW base set):
 *   Legolas mind 6, Aragorn mind 9 — strike prowess is 6, so Legolas is "low
 *   mind" (6 ≤ 6) and Aragorn is "high mind" (9 > 6).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain, getCharacter,
  handCardId, companyIdAt, charIdAt, dispatch, expectInPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const WISP_OF_PALE_SHEEN = 'dm-113' as CardDefinitionId;

/**
 * Build an M/H game state with the given defending company at Moria (a
 * shadow-hold) and Wisp of Pale Sheen in the hazard player's hand, then play
 * and resolve the creature so combat is in the cancel-window.
 */
function setupWispAttack(defenders: CardDefinitionId[]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: defenders }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [WISP_OF_PALE_SHEEN],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  const mhState = makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...state, phaseState: mhState };

  const wispId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const afterPlay = dispatch(gameState, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: wispId,
    targetCompanyId: companyId,
    keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
  });
  return resolveChain(afterPlay);
}

describe('Wisp of Pale Sheen (dm-113)', () => {
  beforeEach(() => resetMint());

  test('attacker chooses defenders — hazard player assigns the single strike', () => {
    const afterChain = setupWispAttack([ARAGORN, LEGOLAS]);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(6);
    expect(afterChain.combat!.tapLowMindAfterStrike).toBe(true);

    // Defender passes the cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker (P2) gets assign-strike actions for each defender — one strike,
    // attacker chooses which character faces it.
    const attackerActions = computeLegalActions(afterPass, PLAYER_2);
    const assignStrikes = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignStrikes.length).toBeGreaterThan(0);

    // Defender (P1) should NOT have assign-strike actions
    const defenderActions = computeLegalActions(afterPass, PLAYER_1);
    const defAssigns = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defAssigns).toHaveLength(0);
  });

  test('tap-low-mind — low-mind defender who wins while untapped taps following the strike', () => {
    const afterChain = setupWispAttack([LEGOLAS]);

    // Legolas (mind 6 ≤ strike prowess 6) begins untapped
    expect(getCharacter(afterChain, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Untapped);

    // Defender passes cancel-window, attacker assigns the strike to Legolas
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const legolasId = charIdAt(afterPass, RESOURCE_PLAYER);
    // tapped: false → Legolas stays untapped to fight (−3 prowess penalty)
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: legolasId,
      tapped: false,
    });

    // High roll (12): Legolas prowess 5 − 3 + 12 = 14 > creature prowess 6 → wins.
    // Normally a winning untapped character stays untapped; tap-low-mind taps it.
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    // Resolve while staying untapped (tapToFight: false, −3 prowess penalty)
    const resolveAction = actions.find(
      a => a.viable && a.action.type === 'resolve-strike' && a.action.tapToFight === false,
    );
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Combat finalized — creature defeated (no body) → defender's kill pile
    expect(afterStrike.combat).toBeNull();
    expectInPile(afterStrike, RESOURCE_PLAYER, 'killPile', WISP_OF_PALE_SHEEN);

    // tap-low-mind: Legolas tapped following the strike despite winning untapped
    expect(getCharacter(afterStrike, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Tapped);
  });

  test('tap-low-mind — high-mind defender who wins while untapped stays untapped', () => {
    const afterChain = setupWispAttack([ARAGORN]);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    // tapped: false → Aragorn stays untapped to fight
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });

    // High roll (12): Aragorn prowess 6 − 3 + 12 = 15 > creature prowess 6 → wins.
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    // Resolve while staying untapped (tapToFight: false)
    const resolveAction = actions.find(
      a => a.viable && a.action.type === 'resolve-strike' && a.action.tapToFight === false,
    );
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    expect(afterStrike.combat).toBeNull();
    // Aragorn mind 9 > strike prowess 6 → tap-low-mind does not apply; stays untapped
    expect(getCharacter(afterStrike, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Untapped);
  });

  test('tap-low-mind — wounded low-mind defender ends inverted, not merely tapped', () => {
    const afterChain = setupWispAttack([LEGOLAS]);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const legolasId = charIdAt(afterPass, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: legolasId,
      tapped: false,
    });

    // Low roll (2): Legolas prowess 5 − 3 + 2 = 4 < creature prowess 6 → wounded.
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 2 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    // Resolve while staying untapped (tapToFight: false, −3 prowess penalty)
    const resolveAction = actions.find(
      a => a.viable && a.action.type === 'resolve-strike' && a.action.tapToFight === false,
    );
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Wounded → body check vs Legolas (body 8). Low roll (2) ≤ 8 → survives wounded.
    expect(afterStrike.combat?.phase).toBe('body-check');
    const bodyState = { ...afterStrike, cheatRollTotal: 2 };
    const bodyActions = computeLegalActions(bodyState, PLAYER_2);
    const bodyAction = bodyActions.find(a => a.viable && a.action.type === 'body-check-roll');
    expect(bodyAction).toBeDefined();
    const afterBody = dispatch(bodyState, bodyAction!.action);

    expect(afterBody.combat).toBeNull();
    // Legolas is inverted (wounded), not untapped — tap-low-mind adds nothing
    expect(getCharacter(afterBody, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Inverted);
  });
});

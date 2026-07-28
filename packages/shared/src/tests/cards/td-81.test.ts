/**
 * @module td-81.test
 *
 * Card test: Wild Fell Beast (td-81)
 * Type: hazard-creature (Drake), non-unique.
 * Strikes: 3, Prowess: 12, Body: 6, kill MP 2.
 * Keyed to `{s}{s}` — two Shadow-lands in the site path.
 *
 * Card text: "Drake. Three strikes. Attacker chooses defending characters.
 * Unless this attack is canceled, all untapped characters in defending company
 * are tapped following attack. Two Shadow-lands [{s}] in site path are
 * required."
 *
 * Rule coverage:
 *
 * | # | Rule                                        | Mechanism                                             |
 * |---|---------------------------------------------|-------------------------------------------------------|
 * | 1 | Three strikes at 12 prowess, body 6         | printed stats → CombatState                           |
 * | 2 | Attacker chooses defending characters       | combat-attacker-chooses-defenders (cancel-window)     |
 * | 3 | Unless canceled, all untapped characters in | on-event `attack-not-canceled` →                      |
 * |   | the defending company tap following attack  | `company-tap-characters` apply                        |
 * | 4 | Two Shadow-lands required in the site path  | keyedTo regionTypes ["shadow", "shadow"]              |
 *
 * Rule 3 taps the *whole* company, not just the characters that faced a
 * strike: a striker who won while staying untapped and a bystander who never
 * faced a strike both end tapped. Wounded characters are Inverted rather than
 * Untapped, so the sweep leaves them alone.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState, makeDoubleShadowMHState,
  makeWildernessMHState, attachItemToChar,
  playCreatureHazardAndResolve, getCharacter, expectInPile,
  handCardId, companyIdAt, findCharInstanceId, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';

const WILD_FELL_BEAST = 'td-81' as CardDefinitionId;
const DRAGON_HELM = 'dm-167' as CardDefinitionId;

/** Defending company at Moria facing the hazard player holding the Beast. */
function baseState(defenders: CardDefinitionId[], mh: MovementHazardPhaseState): GameState {
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
        companies: [{ site: LORIEN, characters: [BEREGOND] }],
        hand: [WILD_FELL_BEAST],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...state, phaseState: mh };
}

/** Play the Beast keyed to shadow-land and resolve the chain into combat. */
function attackWith(state: GameState): GameState {
  return playCreatureHazardAndResolve(
    state,
    PLAYER_2,
    handCardId(state, HAZARD_PLAYER),
    companyIdAt(state, RESOURCE_PLAYER),
    { method: 'region-type' as const, value: 'shadow' },
  );
}

/**
 * Drive the assigned strikes to the end of combat with every die showing
 * `roll`: pick the strike order, resolve each strike without tapping to fight
 * (−3 prowess), and answer any body check. Returns the finalized state.
 */
function runStrikesUntapped(state: GameState, roll: number): GameState {
  let s = state;
  let guard = 0;
  while (s.combat !== null && guard++ < 40) {
    const rolled: GameState = { ...s, cheatRollTotal: roll };
    const pick = [PLAYER_1, PLAYER_2]
      .flatMap(p => computeLegalActions(rolled, p))
      .find(a => a.viable && (
        (a.action.type === 'choose-strike-order' && a.action.tapped === false)
        || (a.action.type === 'resolve-strike' && a.action.tapToFight === false)
        || a.action.type === 'body-check-roll'
      ));
    expect(pick).toBeDefined();
    s = dispatch(rolled, pick!.action);
  }
  expect(s.combat).toBeNull();
  return s;
}

describe('Wild Fell Beast (td-81)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 4: two Shadow-lands in the site path are required ──────────────

  test('keyable when the site path holds two Shadow-lands', () => {
    const state = baseState([ARAGORN], makeDoubleShadowMHState());
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === 'shadow';
    })).toBe(true);
  });

  test('NOT keyable when the site path holds only one Shadow-land', () => {
    const state = baseState([ARAGORN], makeShadowMHState());

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT keyable off a wilderness path', () => {
    const state = baseState([ARAGORN], makeWildernessMHState());
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rules 1 & 2: three strikes at 12, attacker chooses defenders ─────────

  test('combat opens in the cancel-window with 3 strikes at 12 prowess, body 6', () => {
    const afterChain = attackWith(baseState([ARAGORN, LEGOLAS], makeDoubleShadowMHState()));

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders opens a cancel-window before assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.attackerChoosesDefenders).toBe(true);
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureBody).toBe(6);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  test('the hazard player assigns the strikes, the defender does not', () => {
    const afterChain = attackWith(baseState([ARAGORN, LEGOLAS, GIMLI], makeDoubleShadowMHState()));

    // Cancel-window: defender may only pass; attacker has nothing to do yet.
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableFor(afterChain, PLAYER_2)).toHaveLength(0);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  // ─── Rule 3: every untapped character taps following the attack ───────────

  test('strikers who win untapped AND the untouched bystander all tap after the attack', () => {
    const start = baseState([ARAGORN, LEGOLAS, GIMLI, FARAMIR], makeDoubleShadowMHState());
    const afterChain = attackWith(start);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker assigns the three strikes to Aragorn, Legolas and Gimli —
    // Faramir is the bystander who never faces a strike.
    let s = afterPass;
    for (const def of [ARAGORN, LEGOLAS, GIMLI]) {
      s = dispatch(s, {
        type: 'assign-strike',
        player: PLAYER_2,
        characterId: findCharInstanceId(s, RESOURCE_PLAYER, def),
        tapped: false,
      });
    }
    expect(s.combat!.strikeAssignments).toHaveLength(3);

    // Everyone is still untapped going into strike resolution.
    for (const def of [ARAGORN, LEGOLAS, GIMLI, FARAMIR]) {
      expect(getCharacter(s, RESOURCE_PLAYER, def).status).toBe(CardStatus.Untapped);
    }

    // Resolve every strike with a 12: each defender fights untapped (−3
    // prowess) and still beats the Beast's 12 prowess, so none of them is
    // wounded and none taps to fight.
    s = runStrikesUntapped(s, 12);

    // All three strikes defeated → the Beast goes to the defender's kill pile.
    expectInPile(s, RESOURCE_PLAYER, 'killPile', WILD_FELL_BEAST);

    // The card's rule: every untapped character in the company — the three
    // winning strikers and the untouched Faramir — is tapped following attack.
    for (const def of [ARAGORN, LEGOLAS, GIMLI, FARAMIR]) {
      expect(getCharacter(s, RESOURCE_PLAYER, def).status).toBe(CardStatus.Tapped);
    }
  });

  test('a wounded defender stays inverted — the sweep only taps untapped characters', () => {
    const afterChain = attackWith(baseState([LEGOLAS, FARAMIR], makeDoubleShadowMHState()));
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // All three strikes go to Legolas; Faramir never faces one.
    let s = afterPass;
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
    for (let i = 0; i < 3; i++) {
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: legolasId, tapped: false });
    }
    // One combatant facing three strikes: one assignment carrying two excess.
    expect(s.combat!.strikeAssignments).toHaveLength(1);
    expect(s.combat!.strikeAssignments[0].excessStrikes).toBe(2);

    // Low rolls: Legolas loses every strike and is wounded; body checks at 2
    // (≤ body 8) leave him alive but inverted.
    s = runStrikesUntapped(s, 2);

    // Wounded characters are Inverted, not Untapped — the tap sweep skips them.
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Inverted);
    // The untapped bystander is still tapped by the rule.
    expect(getCharacter(s, RESOURCE_PLAYER, FARAMIR).status).toBe(CardStatus.Tapped);
  });

  test('a canceled attack does NOT tap the company', () => {
    const withHelm = attachItemToChar(
      baseState([ARAGORN, LEGOLAS], makeDoubleShadowMHState()),
      RESOURCE_PLAYER, ARAGORN, DRAGON_HELM,
    );
    const afterChain = attackWith(withHelm);

    // Dragon-helm cancels one Dragon or Drake attack against the bearer's company.
    const [cancel] = viableActions(afterChain, PLAYER_1, 'cancel-attack');
    expect(cancel).toBeDefined();
    const after = dispatch(afterChain, cancel.action);

    expect(after.combat).toBeNull();
    // "Unless this attack is canceled" — nobody taps.
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Untapped);
    expect(getCharacter(after, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Untapped);
  });
});

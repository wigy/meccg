/**
 * @module rule-8.38-cvcc-rules
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.38: Company vs Company Combat
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Company vs. Company Combat (CvCC) is considered a single attack with one strike for each member of the attacking company. During the attack, the attacking player can only play resources that affect a strike during a strike sequence; the defending (hazard) player may take resource/character actions even though it is not that player's turn, but only if the action has an effect that would cancel the attack OR that would affect a strike during a strike sequence. Strikes are assigned by the defending player assigning strikes to their own untapped characters, then the attacking player assigning strikes from their own remaining untapped characters, then the defending player assigning strikes to any of their own remaining characters.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, CompanyId } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, viableActions,
} from '../../test-helpers.js';
import type { SitePhaseState } from '../../../index.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const BILBO = 'tw-140' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MORIA = 'tw-d21' as CardDefinitionId;
const MORIA_AS = 'as-169' as CardDefinitionId;  // Weathertop ruins-and-lairs (minion site)
const RIVENDELL = 'tw-d01' as CardDefinitionId;
const EAGLES_EYRIE_HERO = 'tw-391' as CardDefinitionId;
const EAGLES_EYRIE_MINION = 'as-144' as CardDefinitionId;

/** Build a site-phase state where both players are at the same site. */
function buildCvCCState(opts: {
  siteEntered?: boolean;
  opponentInteraction?: 'influence' | 'attack' | null;
  p1Characters?: CardDefinitionId[];
  p2Characters?: CardDefinitionId[];
  p2Alignment?: Alignment;
  sameSite?: boolean;
}) {
  const p1Site = MORIA;
  const p2Site = opts.sameSite === false ? RIVENDELL : MORIA;

  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: p1Site, characters: opts.p1Characters ?? [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: opts.p2Alignment ?? Alignment.Ringwraith,
        companies: [{ site: p2Site, characters: opts.p2Characters ?? [PERCHEN] }],
        hand: [],
        siteDeck: [MORIA_AS],
      },
    ],
    phase: Phase.Site,
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: opts.siteEntered ?? true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: opts.opponentInteraction ?? null,
    pendingOpponentInfluence: null,
  };

  return { ...state, phaseState: sitePhaseState };
}

describe('Rule 8.38 — Company vs Company Combat', () => {
  beforeEach(() => resetMint());

  test('CvCC: passing play-resources at same site transitions to declare-company-attack step', () => {
    const state = buildCvCCState({ siteEntered: true });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).toBe('declare-company-attack');
  });

  test('CvCC: declare-company-attack action offered when companies are at the same site', () => {
    const state = buildCvCCState({ siteEntered: true });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const actions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(actions.length).toBe(1);
  });

  test('CvCC: pass is offered in declare-company-attack step (player can skip)', () => {
    const state = buildCvCCState({ siteEntered: true });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const passActions = viableActions(afterPass, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThan(0);
  });

  test('CvCC: one strike per attacking character (strikesTotal = company size)', () => {
    // Aragorn + Bilbo = 2 attackers → 2 strikes
    const state = buildCvCCState({ siteEntered: true, p1Characters: [ARAGORN, BILBO] });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareActions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(declareActions.length).toBe(1);

    const targetCompanyId = (declareActions[0].action as { targetCompanyId: CompanyId }).targetCompanyId;
    const attackingCompanyId = state.players[0].companies[0].id;

    const afterDeclare = dispatch(afterPass, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId,
      targetCompanyId,
    });

    expect(afterDeclare.combat).not.toBeNull();
    expect(afterDeclare.combat?.strikesTotal).toBe(2); // one per attacking character
    expect(afterDeclare.combat?.isCvCC).toBe(true);
  });

  test('CvCC: three-phase strike assignment: defender assigns untapped first', () => {
    const state = buildCvCCState({ siteEntered: true, p1Characters: [ARAGORN], p2Characters: [PERCHEN] });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(afterPass, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    const afterDeclare = dispatch(afterPass, declareAction);

    // After declaration, combat is assign-strikes, defender phase
    expect(afterDeclare.combat?.phase).toBe('assign-strikes');
    expect(afterDeclare.combat?.assignmentPhase).toBe('defender');

    // Defender (PLAYER_2) can assign their untapped character
    const defAssign = viableActions(afterDeclare, PLAYER_2, 'assign-strike');
    expect(defAssign.length).toBeGreaterThan(0);

    // Attacker (PLAYER_1) cannot assign yet
    const atkAssign = viableActions(afterDeclare, PLAYER_1, 'assign-strike');
    expect(atkAssign.length).toBe(0);
  });

  test('CvCC: after defender passes, transitions to attacker assignment phase', () => {
    const state = buildCvCCState({ siteEntered: true, p1Characters: [ARAGORN], p2Characters: [PERCHEN] });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(afterPass, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    const afterDeclare = dispatch(afterPass, declareAction);
    const afterDefenderPass = dispatch(afterDeclare, { type: 'pass', player: PLAYER_2 });

    expect(afterDefenderPass.combat?.assignmentPhase).toBe('attacker');
  });

  test('CvCC: attacker pairs untapped character with defender; pass is offered when done', () => {
    const state = buildCvCCState({ siteEntered: true, p1Characters: [ARAGORN], p2Characters: [PERCHEN] });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(afterPass, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    const afterDeclare = dispatch(afterPass, declareAction);
    const afterDefenderPass = dispatch(afterDeclare, { type: 'pass', player: PLAYER_2 });

    // Attacker can now assign their untapped character
    const atkAssign = viableActions(afterDefenderPass, PLAYER_1, 'assign-strike');
    expect(atkAssign.length).toBeGreaterThan(0);
  });

  test('CvCC: no CvCC offered when company has not entered the site', () => {
    const state = buildCvCCState({ siteEntered: false });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Should advance directly to next company, not declare-company-attack
    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC: no CvCC offered after an influence attempt this turn', () => {
    const state = buildCvCCState({ siteEntered: true, opponentInteraction: 'influence' });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC: no CvCC offered after a prior CvCC attack this turn', () => {
    const state = buildCvCCState({ siteEntered: true, opponentInteraction: 'attack' });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC: no CvCC offered when companies are at different sites', () => {
    const state = buildCvCCState({ siteEntered: true, sameSite: false });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC: opponentInteractionThisTurn set to attack after declaring CvCC', () => {
    const state = buildCvCCState({ siteEntered: true });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(afterPass, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    const afterDeclare = dispatch(afterPass, declareAction);

    const ps = afterDeclare.phaseState as SitePhaseState;
    expect(ps.opponentInteractionThisTurn).toBe('attack');
  });

  test('CvCC: declare-company-attack succeeds when companies are at hero/minion versions of the same site', () => {
    // Regression: game mpwmana3-ufoini — ringwraith at Eagles\' Eyrie minion (as-144)
    // and wizard at Eagles\' Eyrie hero (tw-391). Legal actions correctly offered the
    // attack, but the reducer rejected it with "Target company is not at the same site"
    // because it compared definitionIds instead of site names.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EAGLES_EYRIE_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: EAGLES_EYRIE_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      phase: Phase.Site,
    });

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };

    const s = { ...state, phaseState: sitePhaseState };
    const afterPass = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-company-attack');

    const declareAction = viableActions(afterPass, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    const afterDeclare = dispatch(afterPass, declareAction);

    // Combat must start — the reducer must not reject the action
    expect(afterDeclare.combat).not.toBeNull();
    expect(afterDeclare.combat?.isCvCC).toBe(true);
  });

  test('CvCC: defending character eliminated by a strike awards its MP to the attacker as kill MP', () => {
    // Rule bullet above: "Company vs. Company Combat - Each character defeated
    // by a strike is wounded and must make a body check. If the character is
    // eliminated, it counts as kill MPs for the opposing player."
    // Regression: game mt21uvpn-8if830 — PLAYER_1 (attacker) eliminated a
    // defending character in CvCC but received no kill MP; eliminateCombatantFromStrike
    // unconditionally sent the eliminated character to the defender's own
    // outOfPlayPile instead of the attacker's killPile.
    const state = buildCvCCState({ siteEntered: true, p1Characters: [ARAGORN], p2Characters: [PERCHEN] });
    let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);

    // Defender passes without assigning — leaves Perchen for the attacker to pair with.
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    // Attacker assigns Aragorn to strike Perchen.
    const atkAssign = viableActions(s, PLAYER_1, 'assign-strike');
    s = dispatch(s, atkAssign[0].action);

    const perchenId = s.players[1].companies[0].characters[0];

    // Attacker taps to fight at full prowess; force the roll to the max so
    // Aragorn (prowess 6) beats Perchen (prowess 3) regardless of RNG.
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 12 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(s.combat?.phase).toBe('body-check');
    expect(s.combat?.bodyCheckTarget).toBe('character');

    // Force the body check roll high enough to eliminate Perchen (body 9).
    s = { ...s, cheatRollTotal: 12 };
    const bodyCheckActions = viableActions(s, PLAYER_1, 'body-check-roll');
    expect(bodyCheckActions.length).toBeGreaterThan(0);
    s = dispatch(s, bodyCheckActions[0].action);

    expect(s.combat).toBeNull();
    expect(s.players[0].killPile.some(c => c.instanceId === perchenId)).toBe(true);
    expect(s.players[1].outOfPlayPile.some(c => c.instanceId === perchenId)).toBe(false);
  });
});

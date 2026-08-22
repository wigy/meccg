/**
 * @module as-44.test
 *
 * Card test: All the Bells Ringing (as-44)
 * Type: hero-resource-event (short)
 *
 * Card text:
 *   "Playable during opponent's site phase before strikes are assigned on a
 *    hero company at a Free-hold [{F}] or Border-hold [{B}] if a minion
 *    company attacks. The attack is canceled and the minion company must
 *    face all automatic-attacks of the site—which attack normally, not as
 *    detainment. Afterwards, the minion company may attack the hero company
 *    again."
 *
 * Effects:
 *   1. cancel-attack — requiresCvCC; forceSiteAutoAttacksNormalReface; when =
 *      the attacking company is a minion (Ringwraith) company AND the
 *      defending company's site type is a Free-hold or Border-hold.
 *
 * | # | Rule                                                             | Status | Notes                                                                    |
 * |---|-------------------------------------------------------------------|--------|---------------------------------------------------------------------------|
 * | 1 | Playable on a hero company at a F/B if a minion company attacks   | OK     | cancel-attack when: attack.minionCompany + site.type in [free-hold, border-hold] |
 * | 2 | The attack is canceled                                           | OK     | resolveCancelAttackEntry (shared cancel-attack path)                     |
 * | 3 | Minion company must face all site auto-attacks, normal not detainment | OK | triggerBellsRingingReface / 'bells-ringing-attacks' site step, forceNormalOverride |
 * | 4 | Afterwards, the minion company may attack the hero company again  | OK     | step returns to declare-company-attack, opponentInteractionThisTurn reset |
 *
 * Test site: Dale (le-363), a minion-side Border-hold with a Men
 * automatic-attack ("each character faces 1 strike", 5 prowess) whose own
 * `combat-detainment` effect fires only when the visiting company is covert
 * (see le-363.test.ts for the baseline: a covert Ringwraith company there
 * faces the attack as detainment by default). The Mouth (le-24) and Asternak
 * (le-1), both Man, keep the minion company covert (non-Orc/Troll) — the
 * same fixture le-363.test.ts uses to establish that baseline — so this test
 * demonstrates the card actually flips a real detainment attack to normal,
 * not a case that was already normal.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { GameState, CombatState } from '../../index.js';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  resetMint, buildTestState, dispatch, viableActions, resolveChain,
  expectInDiscardPile, ARAGORN, RIVENDELL,
  Alignment, Phase,
} from '../test-helpers.js';
import type { CardDefinitionId, CompanyId, SitePhaseState, CancelAttackAction, DeclareCompanyAttackAction } from '../../index.js';

const ALL_THE_BELLS_RINGING = 'as-44' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId; // Man — keeps the minion company covert
const ASTERNAK = 'le-1' as CardDefinitionId;   // Man — keeps the minion company covert
const DALE = 'le-363' as CardDefinitionId;     // minion-side Border-hold, Men each-character auto-attack

const P1_COMPANY = `company-${PLAYER_1 as string}-0` as CompanyId;
const P2_COMPANY = `company-${PLAYER_2 as string}-0` as CompanyId;

const BASE_SITE_PHASE_STATE: SitePhaseState = {
  phase: Phase.Site,
  step: 'declare-company-attack',
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

/**
 * Build a site-phase state with a minion company (PLAYER_1, active/resource
 * player of the site phase) and a hero company (PLAYER_2) at the same site,
 * ready to declare (or having just declared) a CvCC attack. PLAYER_2 holds
 * the card.
 */
function buildAttackReadyState(site: CardDefinitionId): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH, ASTERNAK] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site, characters: [ARAGORN] }], hand: [ALL_THE_BELLS_RINGING], siteDeck: [] },
    ],
  });
  return { ...base, phaseState: BASE_SITE_PHASE_STATE };
}

/** Declares the minion company's CvCC attack against the hero company. */
function declareAttack(state: GameState): GameState {
  const action: DeclareCompanyAttackAction = {
    type: 'declare-company-attack',
    player: PLAYER_1,
    attackingCompanyId: P1_COMPANY,
    targetCompanyId: P2_COMPANY,
  };
  return dispatch(state, action);
}

describe('All the Bells Ringing (as-44)', () => {
  beforeEach(() => resetMint());

  // ── Availability ─────────────────────────────────────────────────────

  test('offered to the hero player when a minion company attacks at a Border-hold', () => {
    const state = declareAttack(buildAttackReadyState(DALE));
    expect(viableActions(state, PLAYER_2, 'cancel-attack')).toHaveLength(1);
  });

  test('NOT offered at a Haven (wrong site type)', () => {
    const state = declareAttack(buildAttackReadyState(RIVENDELL));
    expect(viableActions(state, PLAYER_2, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered against a non-CvCC (creature) attack', () => {
    const declared = declareAttack(buildAttackReadyState(DALE));
    const state: GameState = {
      ...declared,
      combat: {
        ...(declared.combat as CombatState),
        isCvCC: false,
        attackSource: { type: 'creature', instanceId: 'fake-creature' as never },
      },
    };
    expect(viableActions(state, PLAYER_2, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered when the attacking company is not a minion (Ringwraith) company', () => {
    const declared = declareAttack(buildAttackReadyState(DALE));
    const state: GameState = {
      ...declared,
      players: declared.players.map(p => (p.id === PLAYER_1 ? { ...p, alignment: Alignment.Wizard } : p)) as unknown as typeof declared.players,
    };
    expect(viableActions(state, PLAYER_2, 'cancel-attack')).toHaveLength(0);
  });

  // ── Resolution ───────────────────────────────────────────────────────

  test('cancels the CvCC attack and forces the minion company to re-face the site automatic-attack, normal not detainment', () => {
    const declared = declareAttack(buildAttackReadyState(DALE));
    const cancelAction = viableActions(declared, PLAYER_2, 'cancel-attack')[0].action as CancelAttackAction;

    const afterCancel = dispatch(declared, cancelAction);
    // Card played from hand — chain open, original CvCC combat still active
    // until the chain resolves.
    expect(afterCancel.chain).not.toBeNull();
    expect(afterCancel.combat).not.toBeNull();
    expect(afterCancel.combat!.isCvCC).toBe(true);
    expect(afterCancel.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterCancel, HAZARD_PLAYER, ALL_THE_BELLS_RINGING);

    const after = resolveChain(afterCancel);

    // The original CvCC attack is gone; a new automatic-attack combat re-faces
    // Dale's Men attack instead — forced normal despite the covert company.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.isCvCC).toBeFalsy();
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikesTotal).toBe(2); // each-character, 2 minion characters
    expect(after.combat!.detainment).toBe(false);

    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('bells-ringing-attacks');
    expect(siteState.bellsRingingReface).toEqual({ resolved: 1 });
  });

  test('once the re-faced automatic-attack is resolved, control returns to declare-company-attack and the minion may attack again', () => {
    const base = buildAttackReadyState(DALE);
    // Dale has a single printed automatic-attack; simulate it already re-faced.
    const ready: GameState = {
      ...base,
      combat: null,
      phaseState: {
        ...base.phaseState,
        step: 'bells-ringing-attacks',
        opponentInteractionThisTurn: 'attack',
        bellsRingingReface: { resolved: 1 },
      } as SitePhaseState,
    };

    const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('declare-company-attack');
    expect(siteState.bellsRingingReface).toBeUndefined();
    // The interaction marker is cleared — the minion company may declare the
    // CvCC attack again.
    expect(siteState.opponentInteractionThisTurn).toBeNull();
    const reAttackActions = viableActions(after, PLAYER_1, 'declare-company-attack');
    expect(reAttackActions.length).toBeGreaterThan(0);
  });
});

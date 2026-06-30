/**
 * @module as-68.test
 *
 * Card test: Bow of the Galadhrim (as-68)
 * Type: hero-resource-item (major)
 * Unique: true
 * MP: 2 (item) | Corruption: 1
 *
 * Card text:
 *   "Unique. The following effect applies only if the bearer is an Elf Warrior.
 *    In company versus company combat, make a roll before strikes are assigned
 *    for each non-unique minion ally in the company the bearer is facing. If the
 *    result for an ally is greater than the ally's mind plus five, discard the ally."
 *
 * Effects:
 *   1. on-event: cvc-combat-pre-strike — when bearer is Elf Warrior and CvCC combat
 *      begins, roll 2d6 for each non-unique minion ally in the opposing company;
 *      if roll > ally.mind + 5, discard that ally.
 *
 * | # | Effect Type | Status | Notes                                                  |
 * |---|-------------|--------|--------------------------------------------------------|
 * | 1 | on-event    | OK     | cvc-combat-pre-strike fires on declare-company-attack  |
 *
 * Test characters used:
 *   - Legolas (tw-168): Elf, Warrior — canonical Bow bearer
 *   - Aragorn (tw-120): Human, Warrior — non-Elf warrior for condition test
 *   - Perchen (as-4): minion character (ringwraith) — opponent
 * Test ally used:
 *   - Great Bats (as-74): non-unique minion ally, mind 1
 *
 * Discard threshold: roll > 1 (mind) + 5 (threshold) = 6 → discard on 7+
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { GameState } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  resetMint,
  buildTestState,
  dispatch,
  viableActions,
  attachItemToChar,
  attachAllyToChar,
  Phase, Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId, CompanyId, SitePhaseState } from '../test-helpers.js';

const BOW_OF_THE_GALADHRIM = 'as-68' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const GREAT_BATS = 'as-74' as CardDefinitionId;
// Both companies at the same site (hero Moria ruins-and-lairs, used by CvCC rules tests)
const SHARED_SITE = 'tw-d21' as CardDefinitionId;
const SITE_DECK_SITE = 'tw-d01' as CardDefinitionId;

/** Company IDs follow the pattern company-<playerId>-<index>. */
const P1_COMPANY = `company-${PLAYER_1 as string}-0` as CompanyId;
const P2_COMPANY = `company-${PLAYER_2 as string}-0` as CompanyId;

/**
 * Build a site-phase state with two companies at the same site:
 * player 1 (hero/wizard) and player 2 (ringwraith). siteEntered is true and
 * no prior interaction has occurred — CvCC attack is declarable.
 */
function buildCvCCState(p1Chars: CardDefinitionId[], p2Chars: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: SHARED_SITE, characters: p1Chars }],
        hand: [],
        siteDeck: [SITE_DECK_SITE],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: SHARED_SITE, characters: p2Chars }],
        hand: [],
        siteDeck: [SITE_DECK_SITE],
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

  return { ...base, phaseState: sitePhaseState };
}

describe('Bow of the Galadhrim (as-68)', () => {
  beforeEach(() => resetMint());

  // ─── CvCC pre-strike: ally-discard rolls enqueued ────────────────────────────

  test('CvCC: declaring attack with Elf Warrior bearer enqueues ally-discard roll for non-unique minion ally', () => {
    let state = buildCvCCState([LEGOLAS], [PERCHEN]);
    state = attachItemToChar(state, 0, LEGOLAS, BOW_OF_THE_GALADHRIM);
    state = attachAllyToChar(state, 1, PERCHEN, GREAT_BATS);

    // Pass play-resources → declare-company-attack step
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((state.phaseState as SitePhaseState).step).toBe('declare-company-attack');

    // Declare CvCC attack
    state = dispatch(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: P1_COMPANY,
      targetCompanyId: P2_COMPANY,
    });

    // A dice-check (cvcc ally-discard) resolution should be enqueued for Great Bats
    const batsInst = Object.values(state.players[1].characters)[0].allies[0].instanceId;
    const resolution = state.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(resolution).toBeDefined();
    if (resolution?.kind.type === 'dice-check') {
      // The check targets Great Bats; threshold = ally mind 1 + 5.
      expect(resolution.kind.targetInstanceId).toBe(batsInst);
      expect(resolution.kind.threshold).toBe(6);
      // The ally's owner (defending player) rolls; the attacker is the actor.
      expect(resolution.kind.roller).toBe(PLAYER_2);
      expect(resolution.actor).toBe(PLAYER_1);
    }
  });

  test('CvCC: roll > mind+5 discards the ally', () => {
    let state = buildCvCCState([LEGOLAS], [PERCHEN]);
    state = attachItemToChar(state, 0, LEGOLAS, BOW_OF_THE_GALADHRIM);
    state = attachAllyToChar(state, 1, PERCHEN, GREAT_BATS);

    // Track ally instance before combat
    const perchData = Object.values(state.players[1].characters)[0];
    const batsInst = perchData.allies[0].instanceId;

    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: P1_COMPANY,
      targetCompanyId: P2_COMPANY,
    });

    // Get the roll action and dispatch with roll = 7 (> 1+5=6 → discard)
    const rollActions = viableActions(state, PLAYER_1, 'resolve-dice-check');
    expect(rollActions.length).toBe(1);

    state = dispatch({ ...state, cheatRollTotal: 7 }, rollActions[0].action);

    // Great Bats should be in player 2's discard pile, not in Perchen's allies
    const perchAfter = Object.values(state.players[1].characters)[0];
    expect(perchAfter.allies.find(a => a.instanceId === batsInst)).toBeUndefined();
    expect(state.players[1].discardPile.some(c => c.instanceId === batsInst)).toBe(true);
    // No more pending ally-discard rolls
    expect(state.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
  });

  test('CvCC: roll <= mind+5 leaves the ally in play', () => {
    let state = buildCvCCState([LEGOLAS], [PERCHEN]);
    state = attachItemToChar(state, 0, LEGOLAS, BOW_OF_THE_GALADHRIM);
    state = attachAllyToChar(state, 1, PERCHEN, GREAT_BATS);

    const perchData = Object.values(state.players[1].characters)[0];
    const batsInst = perchData.allies[0].instanceId;

    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: P1_COMPANY,
      targetCompanyId: P2_COMPANY,
    });

    const rollActions = viableActions(state, PLAYER_1, 'resolve-dice-check');
    // Roll = 6: not > 6 (mind 1 + threshold 5), so ally survives
    state = dispatch({ ...state, cheatRollTotal: 6 }, rollActions[0].action);

    const perchAfter = Object.values(state.players[1].characters)[0];
    expect(perchAfter.allies.find(a => a.instanceId === batsInst)).toBeDefined();
    expect(state.players[1].discardPile.some(c => c.instanceId === batsInst)).toBe(false);
  });

  test('CvCC: non-elf bearer (Aragorn) does not trigger ally-discard rolls', () => {
    let state = buildCvCCState([ARAGORN], [PERCHEN]);
    state = attachItemToChar(state, 0, ARAGORN, BOW_OF_THE_GALADHRIM);
    state = attachAllyToChar(state, 1, PERCHEN, GREAT_BATS);

    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: P1_COMPANY,
      targetCompanyId: P2_COMPANY,
    });

    const resolution = state.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(resolution).toBeUndefined();
  });

  test('CvCC: no non-unique minion ally in opposing company — no rolls enqueued', () => {
    let state = buildCvCCState([LEGOLAS], [PERCHEN]);
    state = attachItemToChar(state, 0, LEGOLAS, BOW_OF_THE_GALADHRIM);
    // No ally added to Perchen

    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: P1_COMPANY,
      targetCompanyId: P2_COMPANY,
    });

    const resolution = state.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(resolution).toBeUndefined();
  });
});

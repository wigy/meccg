/**
 * @module td-11.test
 *
 * Card test: Daelomin at Home (td-11)
 * Type: hazard-event (permanent), keyword `dragon-manifestation`, manifestId tw-26
 *
 * Text:
 *   "Unique. Unless Daelomin Ahunt is in play, Dancing Spire has an additional
 *    automatic-attack: Dragon — 3 strikes at 14/8. In addition, you may discard
 *    this card from play during opponent's movement/hazard phase (not counting
 *    against the hazard limit) to increase the hazard limit against one company
 *    by two."
 *
 * Effects:
 * | # | Effect Type                | Status | Notes                                                    |
 * |---|----------------------------|--------|----------------------------------------------------------|
 * | 1 | dragon-at-home             | OK     | +Dragon (3 strikes, 14 prow) on Dancing Spire; suppressed by Daelomin Ahunt |
 * | 2 | discard-for-hazard-limit   | OK     | discard from play → +2 hazard limit vs one company       |
 *
 * The augment attack's printed "/8" body follows the codebase convention for
 * Dragon lair auto-attacks: every TW site auto-attack (including Dancing
 * Spire's own printed Dragon attack) is modeled with strikes+prowess only, so
 * the augment is likewise modeled as {Dragon, 3 strikes, 14 prowess}.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions,
  dispatch,
  addCardInPlay,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { currentHazardLimit } from '../../engine/hazard-limit.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState, SiteCard } from '../../index.js';

const DAELOMIN_AT_HOME = 'td-11' as CardDefinitionId;
const DAELOMIN_AHUNT = 'td-10' as CardDefinitionId;
const DANCING_SPIRE = 'tw-383' as CardDefinitionId; // Daelomin's lair (lairOf tw-26)
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // a different Dragon's lair

/**
 * Build an M/H-phase state with P1 (resource) as the active player processing
 * its company and P2 (hazard) holding the given cards in play.
 */
function buildMHState(inPlay: CardDefinitionId[], mhOverrides?: Partial<MovementHazardPhaseState>): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  let withCards = base;
  for (const def of inPlay) {
    withCards = addCardInPlay(withCards, HAZARD_PLAYER, def);
  }

  const mhState = makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, ...mhOverrides });
  return { ...withCards, phaseState: mhState };
}

function atHomeInstId(state: GameState): CardInstanceId {
  const card = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === DAELOMIN_AT_HOME);
  if (!card) throw new Error('td-11 not in P2 cardsInPlay');
  return card.instanceId;
}

function targetCompanyId(state: GameState) {
  return state.players[RESOURCE_PLAYER].companies[0].id;
}

describe('Daelomin at Home (td-11)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Dancing Spire has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildMHState([]);
    const spire = state.cardPool[DANCING_SPIRE] as SiteCard;
    const attacks = getActiveAutoAttacks(state, spire);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 11 });
  });

  test('At-Home in play appends the extra Dragon (3 strikes, 14 prowess) to Dancing Spire', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const spire = state.cardPool[DANCING_SPIRE] as SiteCard;
    const attacks = getActiveAutoAttacks(state, spire);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 2, prowess: 11 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 14 });
  });

  test('Daelomin Ahunt in play suppresses the At-Home augmentation', () => {
    const state = buildMHState([DAELOMIN_AT_HOME, DAELOMIN_AHUNT]);
    const spire = state.cardPool[DANCING_SPIRE] as SiteCard;
    expect(getActiveAutoAttacks(state, spire)).toHaveLength(1);
  });

  test('At-Home augments only Daelomin\'s lair, not a different Dragon\'s lair', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    // Lonely Mountain belongs to a different Dragon → unaffected by Daelomin at Home.
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  // ─── discard-for-hazard-limit ─────────────────────────────────────────────

  test('offers discard-card-for-hazard-limit to the hazard player during opponent M/H phase', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const actions = viableActions(state, PLAYER_2, 'discard-card-for-hazard-limit');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(atHomeInstId(state));
    expect((actions[0].action as { targetCompanyId: string }).targetCompanyId).toBe(targetCompanyId(state));
  });

  test('does not offer the discard action to the resource (active) player', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const actions = viableActions(state, PLAYER_1, 'discard-card-for-hazard-limit');
    expect(actions).toHaveLength(0);
  });

  test('discarding moves the card from cardsInPlay to the discard pile', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const instId = atHomeInstId(state);

    const next = dispatch(state, {
      type: 'discard-card-for-hazard-limit',
      player: PLAYER_2,
      cardInstanceId: instId,
      targetCompanyId: targetCompanyId(state),
    });

    const p2 = next.players[HAZARD_PLAYER];
    expect(p2.cardsInPlay.find(c => c.instanceId === instId)).toBeUndefined();
    expect(p2.discardPile.find(c => c.instanceId === instId)).toBeDefined();
  });

  test('discarding adds a hazard-limit-modifier +2 constraint on the target company', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const compId = targetCompanyId(state);

    const next = dispatch(state, {
      type: 'discard-card-for-hazard-limit',
      player: PLAYER_2,
      cardInstanceId: atHomeInstId(state),
      targetCompanyId: compId,
    });

    const constraint = next.activeConstraints.find(
      c => c.kind.type === 'hazard-limit-modifier' && c.target.kind === 'company' && c.target.companyId === compId,
    );
    expect(constraint).toBeDefined();
    expect((constraint!.kind as { type: string; value: number }).value).toBe(2);
  });

  test('discarding increases the running hazard limit by 2', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const compId = targetCompanyId(state);
    const mhBefore = state.phaseState as MovementHazardPhaseState;
    const limitBefore = currentHazardLimit(state, mhBefore, compId);

    const next = dispatch(state, {
      type: 'discard-card-for-hazard-limit',
      player: PLAYER_2,
      cardInstanceId: atHomeInstId(state),
      targetCompanyId: compId,
    });

    const mhAfter = next.phaseState as MovementHazardPhaseState;
    expect(currentHazardLimit(next, mhAfter, compId)).toBe(limitBefore + 2);
  });

  test('discarding does not count against the hazard limit (hazardsPlayedThisCompany unchanged)', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const mhBefore = state.phaseState as MovementHazardPhaseState;

    const next = dispatch(state, {
      type: 'discard-card-for-hazard-limit',
      player: PLAYER_2,
      cardInstanceId: atHomeInstId(state),
      targetCompanyId: targetCompanyId(state),
    });

    const mhAfter = next.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsPlayedThisCompany).toBe(mhBefore.hazardsPlayedThisCompany);
  });

  test('after discarding, the At-Home augmentation is gone (card left play)', () => {
    const state = buildMHState([DAELOMIN_AT_HOME]);
    const spire = state.cardPool[DANCING_SPIRE] as SiteCard;
    expect(getActiveAutoAttacks(state, spire)).toHaveLength(2);

    const next = dispatch(state, {
      type: 'discard-card-for-hazard-limit',
      player: PLAYER_2,
      cardInstanceId: atHomeInstId(state),
      targetCompanyId: targetCompanyId(state),
    });

    // Card is no longer in play → Dancing Spire reverts to its printed attack.
    expect(getActiveAutoAttacks(next, spire)).toHaveLength(1);
  });
});

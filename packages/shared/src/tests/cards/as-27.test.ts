/**
 * @module as-27.test
 *
 * Card test: Enchanted Stream (as-27)
 * Type: hazard-event, Permanent-event. Non-unique.
 *
 * Card text:
 *   "Playable on a moving company with at least one Wilderness [{w}] in its site
 *    path. A ranger in the company can tap to cancel this card before it
 *    resolves. The company cannot voluntarily split or move to a new site unless
 *    it taps all of its untapped characters to a maximum of two during its
 *    organization phase. Discard during any organization phase if the company is
 *    at a Haven/Darkhaven [{DH}]."
 *
 * Effects:
 *   1. play-target company
 *   2. play-condition site-path (sitePath.wildernessCount > 0)
 *   3. company-movement-tax (taxTapCharacters 2)
 *   4. grant-action cancel-chain-entry (ranger, tap character) — cancel before it resolves
 *   5. on-event organization-phase-start → self-discard when company.atHaven
 *
 * | # | Rule                                                        | Status | Notes                                                     |
 * |---|-------------------------------------------------------------|--------|-----------------------------------------------------------|
 * | 1 | Playable only with ≥1 Wilderness in the site path           | OK     | play-condition site-path enforced in permanent branch     |
 * | 2 | Bound to the moving (active) company                        | OK     | play-target company → targetCompanyId → CardInPlay.companyId|
 * | 3 | A ranger in the company may tap to cancel it before resolve | OK     | grant-action cancel-chain-entry, chain-declaring emitter   |
 * | 4 | Only a ranger (untapped) may cancel                         | OK     | actor.skills $includes ranger + untapped gate             |
 * | 5 | Company may not voluntarily move until it taps ≤2 chars     | OK     | company-movement-tax gates plan-movement                  |
 * | 6 | Company may not voluntarily split until the tax is paid     | OK     | company-movement-tax gates split-company                  |
 * | 7 | Tax = tap all untapped chars to a max of two                | OK     | isMovementTaxSatisfied (paid≥2 OR no untapped left)        |
 * | 8 | Discard during any org phase if the company is at a Haven   | OK     | on-event organization-phase-start self-discard, atHaven   |
 *
 * Playable: YES
 * Certified: 2026-07-16
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, addCardInPlay, companyIdAt, findCharInstanceId,
  makeMHState, reduce, dispatch, runActions, viableActions, mint, playHazardAndResolve,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, Phase, CardStatus,
  ARAGORN, RIVENDELL, MORIA,
} from '../test-helpers.js';
import { computeLegalActions, RegionType } from '../../index.js';
import { initiateChain } from '../../engine/chain-reducer.js';
import type {
  CardDefinitionId, GameState, GameAction,
  PlayHazardAction, ActivateGrantedAction, PlanMovementAction,
} from '../../index.js';

const ENCHANTED_STREAM = 'as-27' as CardDefinitionId;

// Minion characters (resource/active player is Ringwraith).
const SHAGRAT = 'le-39' as CardDefinitionId;       // warrior / RANGER, mind 6
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // warrior (non-ranger), mind 5
const ASTERNAK = 'le-1' as CardDefinitionId;       // warrior / diplomat (non-ranger), mind 5

// Minion sites.
const CARN_DUM = 'le-359' as CardDefinitionId;     // minion haven
const ZARAK_DUM = 'le-417' as CardDefinitionId;    // ruins-and-lairs (non-haven), nearestHaven Carn Dûm
const BANDIT_LAIR = 'le-351' as CardDefinitionId;  // ruins-and-lairs, nearestHaven Dol Guldur

/** Play-hazard actions offered to the hazard player for the Enchanted Stream in hand. */
function streamPlays(state: GameState): { viable: boolean; action: PlayHazardAction }[] {
  const handInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
  return computeLegalActions(state, PLAYER_2)
    .filter(ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === handInst)
    .map(ea => ({ viable: ea.viable, action: ea.action as PlayHazardAction }));
}

/** Ranger cancel-chain activations offered to the resource player for the Enchanted Stream chain entry. */
function cancelActions(state: GameState): ActivateGrantedAction[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'cancel-chain-entry' && a.sourceCardDefinitionId === ENCHANTED_STREAM);
}

/** Viable plan-movement actions for the resource player's (only) company. */
function planMoves(state: GameState): PlanMovementAction[] {
  return viableActions(state, PLAYER_1, 'plan-movement').map(ea => ea.action as PlanMovementAction);
}

describe('Enchanted Stream (as-27)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1 & 2: playable on a moving company with a Wilderness in its path ──

  /** Build a play-hazards M/H state; the resource company is moving, with the given resolved region path. */
  function buildPlayHazards(resolvedSitePath: RegionType[]): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: [ORC_CAPTAIN], destinationSite: BANDIT_LAIR }], hand: [], siteDeck: [BANDIT_LAIR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ENCHANTED_STREAM], siteDeck: [MORIA] },
      ],
    });
    return { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath }) };
  }

  test('is playable and binds to the moving company when its site path has a Wilderness', () => {
    const state = buildPlayHazards([RegionType.Wilderness]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const plays = streamPlays(state).filter(p => p.viable);
    expect(plays).toHaveLength(1);
    expect(plays[0].action.targetCompanyId).toBe(companyId);

    // `play-target: company` — the resolved card in play carries the binding
    // (unlike an untargeted permanent hazard, which enters play unbound).
    const resolved = playHazardAndResolve(state, PLAYER_2, plays[0].action.cardInstanceId, companyId);
    const inPlay = resolved.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === ENCHANTED_STREAM);
    expect(inPlay).toBeDefined();
    expect(inPlay!.companyId).toBe(companyId);
  });

  test('is NOT playable when the site path has no Wilderness', () => {
    const state = buildPlayHazards([RegionType.Shadow, RegionType.Dark]);
    expect(streamPlays(state).filter(p => p.viable)).toHaveLength(0);
  });

  // ─── Rules 3 & 4: a ranger in the company may tap to cancel before it resolves ──

  /** Put Enchanted Stream on the chain (declared by the hazard player) against the moving resource company. */
  function buildStreamOnChain(chars: CardDefinitionId[]): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: chars, destinationSite: BANDIT_LAIR }], hand: [], siteDeck: [BANDIT_LAIR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const streamCard = { instanceId: mint(), definitionId: ENCHANTED_STREAM };
    return initiateChain(
      { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness] }) },
      PLAYER_2,
      streamCard,
      { type: 'permanent-event', targetCompanyId: companyId },
    );
  }

  test('offers the ranger a tap-to-cancel while Enchanted Stream is on the chain', () => {
    const state = buildStreamOnChain([SHAGRAT, ORC_CAPTAIN]);
    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const actions = cancelActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0].characterId).toBe(shagratId);
  });

  test('does NOT offer a cancel when the company has no ranger', () => {
    const state = buildStreamOnChain([ORC_CAPTAIN, ASTERNAK]);
    expect(cancelActions(state)).toHaveLength(0);
  });

  test('does NOT offer a cancel to a tapped ranger', () => {
    const base = buildStreamOnChain([SHAGRAT]);
    const shagratId = findCharInstanceId(base, RESOURCE_PLAYER, SHAGRAT);
    const tapped: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [shagratId as string]: { ...base.players[0].characters[shagratId], status: CardStatus.Tapped },
          },
        },
        base.players[1],
      ] as typeof base.players,
    };
    expect(cancelActions(tapped)).toHaveLength(0);
  });

  test('activating the cancel taps the ranger, negates the chain entry, and discards the card to its owner', () => {
    const state = buildStreamOnChain([SHAGRAT]);
    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const streamInst = state.chain!.entries[0].card!.instanceId;

    const result = dispatch(state, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: shagratId,
      sourceCardId: streamInst,
      sourceCardDefinitionId: ENCHANTED_STREAM,
      actionId: 'cancel-chain-entry',
      rollThreshold: 0,
    });

    expect(result.chain!.entries[0].negated).toBe(true);
    expect(result.players[RESOURCE_PLAYER].characters[shagratId].status).toBe(CardStatus.Tapped);
    // The hazard is owned by the hazard player and returns to their discard.
    expect(result.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === streamInst)).toBe(true);
  });

  // ─── Rules 5-7: movement/split tax during the organization phase ──────────────

  /** Build an org-phase state with the resource company at ZARAK_DUM (non-haven), reachable sites in deck. */
  function buildOrg(chars: CardDefinitionId[]): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: chars }], hand: [], siteDeck: [CARN_DUM, BANDIT_LAIR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
  }

  test('a company bound by Enchanted Stream may not declare movement until it pays the tax', () => {
    const base = buildOrg([ORC_CAPTAIN, ASTERNAK]);
    // Baseline: movement is offered without the card bound.
    expect(planMoves(base).length).toBeGreaterThan(0);

    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const bound = addCardInPlay(base, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    // Blocked; instead the player is offered pay-movement-tax per untapped character.
    expect(planMoves(bound)).toHaveLength(0);
    expect(viableActions(bound, PLAYER_1, 'pay-movement-tax')).toHaveLength(2);
  });

  test('paying two characters unlocks movement (tap all untapped, max two)', () => {
    const base = buildOrg([ORC_CAPTAIN, ASTERNAK]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const bound = addCardInPlay(base, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    const orcId = findCharInstanceId(bound, RESOURCE_PLAYER, ORC_CAPTAIN);
    const asternakId = findCharInstanceId(bound, RESOURCE_PLAYER, ASTERNAK);

    // Pay the first character: tapped, still blocked (1/2).
    const afterOne = reduce(bound, { type: 'pay-movement-tax', player: PLAYER_1, companyId, characterId: orcId });
    expect(afterOne.error).toBeUndefined();
    expect(afterOne.state.players[RESOURCE_PLAYER].characters[orcId].status).toBe(CardStatus.Tapped);
    expect((afterOne.state.phaseState as { movementTaxPaid?: Record<string, number> }).movementTaxPaid?.[companyId as string]).toBe(1);
    expect(planMoves(afterOne.state)).toHaveLength(0);

    // Pay the second: 2/2 → movement unlocked.
    const afterTwo = reduce(afterOne.state, { type: 'pay-movement-tax', player: PLAYER_1, companyId, characterId: asternakId });
    expect(afterTwo.error).toBeUndefined();
    expect(planMoves(afterTwo.state).length).toBeGreaterThan(0);
  });

  test('a single-character company pays just one (no untapped left to tap satisfies the tax)', () => {
    const base = buildOrg([ORC_CAPTAIN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const bound = addCardInPlay(base, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    expect(planMoves(bound)).toHaveLength(0);
    expect(viableActions(bound, PLAYER_1, 'pay-movement-tax')).toHaveLength(1);

    const orcId = findCharInstanceId(bound, RESOURCE_PLAYER, ORC_CAPTAIN);
    const paid = reduce(bound, { type: 'pay-movement-tax', player: PLAYER_1, companyId, characterId: orcId });
    expect(paid.error).toBeUndefined();
    expect(planMoves(paid.state).length).toBeGreaterThan(0);
  });

  test('a company with no untapped characters owes no tax (may move freely)', () => {
    const base = buildOrg([ORC_CAPTAIN, ASTERNAK]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    let bound = addCardInPlay(base, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    // Tap both characters up front.
    bound = {
      ...bound,
      players: [
        {
          ...bound.players[0],
          characters: Object.fromEntries(
            Object.entries(bound.players[0].characters).map(([k, c]) => [k, { ...c, status: CardStatus.Tapped }]),
          ),
        },
        bound.players[1],
      ] as typeof bound.players,
    };
    expect(viableActions(bound, PLAYER_1, 'pay-movement-tax')).toHaveLength(0);
    expect(planMoves(bound).length).toBeGreaterThan(0);
  });

  test('a company bound by Enchanted Stream may not split until the tax is paid', () => {
    const base = buildOrg([ORC_CAPTAIN, ASTERNAK]);
    expect(viableActions(base, PLAYER_1, 'split-company').length).toBeGreaterThan(0);

    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const bound = addCardInPlay(base, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    expect(viableActions(bound, PLAYER_1, 'split-company')).toHaveLength(0);

    // After paying the two-character tax, splitting is offered again.
    const orcId = findCharInstanceId(bound, RESOURCE_PLAYER, ORC_CAPTAIN);
    const asternakId = findCharInstanceId(bound, RESOURCE_PLAYER, ASTERNAK);
    const afterOne = reduce(bound, { type: 'pay-movement-tax', player: PLAYER_1, companyId, characterId: orcId });
    const afterTwo = reduce(afterOne.state, { type: 'pay-movement-tax', player: PLAYER_1, companyId, characterId: asternakId });
    expect(viableActions(afterTwo.state, PLAYER_1, 'split-company').length).toBeGreaterThan(0);
  });

  // ─── Rule 8: discard during any organization phase if the company is at a Haven ──

  /** Build an untap-phase state with the resource company at `site` and Enchanted Stream bound (owned by the hazard player). */
  function buildUntapWithStream(site: CardDefinitionId): GameState {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, HAZARD_PLAYER, ENCHANTED_STREAM, companyId);
    return state;
  }

  test('is discarded to its owner at the organization phase when the company is at a Haven', () => {
    const state = buildUntapWithStream(CARN_DUM);
    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === ENCHANTED_STREAM)).toBe(false);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ENCHANTED_STREAM)).toBe(true);
  });

  test('stays in play at the organization phase when the company is NOT at a Haven', () => {
    const state = buildUntapWithStream(ZARAK_DUM);
    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === ENCHANTED_STREAM)).toBe(true);
  });
});

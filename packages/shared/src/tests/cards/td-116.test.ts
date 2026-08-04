/**
 * @module td-116.test
 *
 * Card test: Flatter a Foe (td-116)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text: "Flattery attempt. Playable on a character whose company is facing an
 *   attack of the type listed below. Character makes an influence check
 *   (modified by his unused direct influence and +2 if a diplomat). If
 *   successful, the attack is canceled and the hazard limit for the
 *   character's company is decreased by two. This influence check is
 *   successful if the result is greater than: 10 against a Dragon; 11
 *   against Men or Drakes; 12 against Trolls, Orcs, Elves and Giants."
 *
 * Effects:
 * | # | Effect Type               | Status | Notes                                        |
 * |---|---------------------------|--------|----------------------------------------------|
 * | 1 | flattery-cancel-attack    | OK     | race-gated, rolls 2d6+DI, diplomat+2 bonus   |
 *     |                           |        | cancel attack on success, reduce hazard limit |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain,
  handCardId, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, reduce, Race } from '../../index.js';
import type { CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const FLATTER_A_FOE = 'td-116' as CardDefinitionId;

const SITE_PLAY_RESOURCES_PHASE: SitePhaseState = {
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

describe('Flatter a Foe (td-116)', () => {
  beforeEach(() => resetMint());

  // ── Cancel-window availability ────────────────────────────────────────────

  test('cancel-attack offered when company faces a Dragon attack', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack offered for Men attack', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack offered for Drake attack', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Drake });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack offered for Orc attack', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack NOT offered for Spiders attack (not in thresholds)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Spider });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(0);
  });

  test('cancel-attack NOT offered for Undead attack (not in thresholds)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Undead });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(0);
  });

  test('one cancel-attack action offered per character in company', () => {
    // Two characters → two cancel-attack actions (one per character who could attempt)
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, GIMLI] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(2);
  });

  test('cancel-attack NOT offered when attack is uncancelable', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });
    const state = { ...withCombat, combat: { ...withCombat.combat!, uncancelable: true } };

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === flatCard,
    );
    expect(cancels).toHaveLength(0);
  });

  test('NOT playable outside combat (end-of-turn phase, no attack)', () => {
    // Regression: Flatter a Foe is a combat-only short-event ("Playable on a
    // character whose company is facing an attack …"). Its lone
    // flattery-cancel-attack effect must be recognised as combat-only so the
    // card is never offered as a generic resource short-event when no attack
    // is underway (game mrj9s8tr-ytkfvr, seq 91 — offered during end-of-turn).
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);

    // The card may still be voluntarily discarded, but it must not be
    // offered as a playable event (play-short-event / cancel-attack).
    const playForCard = actions.filter(
      ea => ea.viable
        && (ea.action.type === 'play-short-event' || ea.action.type === 'cancel-attack')
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === flatCard,
    );
    expect(playForCard).toHaveLength(0);

    // It is instead annotated not-playable for being combat-only.
    const notPlayable = actions.find(
      ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === flatCard,
    );
    expect(notPlayable).toBeDefined();
    expect((notPlayable as { reason?: string }).reason).toContain('combat');
  });

  test('NOT playable outside combat (site phase, play-resources step, no attack)', () => {
    // Regression: game msf2o9tq-ozptpq, seq 117 — Flatter a Foe was offered as
    // a generic play-short-event action during the site phase's play-resources
    // step, with no attack underway. The site/organization-phase short-event
    // emitter (playResourceShortEventActions in organization.ts) keeps its own
    // combatOnlyTypes set, separate from heroResourceShortEventActions's
    // (long-event.ts), and that copy was missing 'flattery-cancel-attack' —
    // so the card's lone effect wasn't recognised as combat-only there and it
    // fell through to being offered as playable at every phase.
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PLAY_RESOURCES_PHASE };

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);

    const playForCard = actions.filter(
      ea => ea.viable
        && (ea.action.type === 'play-short-event' || ea.action.type === 'cancel-attack')
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === flatCard,
    );
    expect(playForCard).toHaveLength(0);

    // Site-phase combat-only short-events are left unevaluated by
    // playResourceShortEventActions and picked up by site.ts's generic
    // catch-all, which annotates a phase-level (not combat-specific) reason.
    const notPlayable = actions.find(
      ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === flatCard,
    );
    expect(notPlayable).toBeDefined();
  });

  // ── Chain resolution → flattery-attempt pending ───────────────────────────

  test('declaring Flatter a Foe creates a flattery-attempt pending resolution after chain resolves', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterDeclare = dispatch(state, {
      type: 'cancel-attack',
      player: PLAYER_1,
      cardInstanceId: flatCard,
      targetCharacterId: aragornId,
    });
    const afterChain = resolveChain(afterDeclare);

    // Chain resolved, flattery-attempt pending resolution enqueued
    const pending = afterChain.pendingResolutions.find(r => r.kind.type === 'flattery-attempt');
    expect(pending).toBeDefined();
    expect(pending!.kind.type).toBe('flattery-attempt');

    // The flattery-attempt action is now the only legal action
    const actions = computeLegalActions(afterChain, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    );
    expect(actions).toHaveLength(1);
  });

  // ── Pending action computation ────────────────────────────────────────────

  test('need value accounts for unused DI (non-diplomat Aragorn vs Dragon)', () => {
    // Aragorn: DI=3, no diplomat. Dragon threshold=10.
    // need = 10 - 3 + 1 = 8
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    );
    expect(flatAction).toBeDefined();
    // Aragorn DI=3, no diplomat bonus; Dragon threshold=10 → need = 10 - 3 + 1 = 8
    expect((flatAction!.action as { need: number }).need).toBe(8);
  });

  test('need value includes diplomat bonus (+2) for Gimli vs Dragon', () => {
    // Gimli: DI=2, diplomat. Dragon threshold=10.
    // total modifier = 2 + 2 = 4. need = 10 - 4 + 1 = 7.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const gimliId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: gimliId,
    }));

    const flatAction = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    );
    expect(flatAction).toBeDefined();
    // Gimli DI=2, diplomat=+2; Dragon threshold=10 → need = 10 - (2+2) + 1 = 7
    expect((flatAction!.action as { need: number }).need).toBe(7);
  });

  // ── Roll resolution: success ──────────────────────────────────────────────

  test('successful roll: attack is canceled (combat cleared)', () => {
    // Aragorn (DI=3) vs Dragon (threshold 10). Roll 8 → total = 8+3 = 11 > 10 → success.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;
    expect(flatAction).toBeDefined();

    // Roll 8: total = 8 + 3 (DI) = 11 > 10 → success
    const result = reduce({ ...s, cheatRollTotal: 8 }, flatAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();
  });

  test('successful roll: hazard limit decreased by 2', () => {
    // Aragorn (DI=3) vs Dragon (threshold 10). Roll 8 → success.
    // Initial hazard limit = max(1,2) = 2. After success: 2 - 2 = 0.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    // The makeMHState / makeCancelWindowCombat sets hazardLimitAtReveal
    const initialLimit = (state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    const result = reduce({ ...s, cheatRollTotal: 8 }, flatAction.action);
    expect(result.error).toBeUndefined();

    const finalLimit = (result.state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;
    expect(finalLimit).toBe(Math.max(0, initialLimit - 2));
  });

  // ── Roll resolution: failure ──────────────────────────────────────────────

  test('failed roll: combat continues (attack is NOT canceled)', () => {
    // Aragorn (DI=3) vs Dragon (threshold 10). Roll 7 → total = 7+3 = 10, NOT > 10 → failure.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    // Roll 7: total = 7 + 3 = 10, not > 10 → failure
    const result = reduce({ ...s, cheatRollTotal: 7 }, flatAction.action);
    expect(result.error).toBeUndefined();
    // Combat still active — attack was not canceled
    expect(result.state.combat).not.toBeNull();
  });

  test('successful roll: chain fully resolves (not left stuck in "resolving")', () => {
    // Regression: the flattery-attempt pending resolution paused the chain
    // (needsInput) without ever marking the Flatter a Foe chain entry
    // resolved. Since nothing resumed auto-resolution afterward, `chain`
    // stayed in mode 'resolving' forever with no legal actions for either
    // player — the game appeared frozen (game ms77xgju-p0ke1j, seq 263:
    // "reste bloqué à l'étape resolving").
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    // Roll 8: total = 8 + 3 (DI) = 11 > 10 → success
    const result = reduce({ ...s, cheatRollTotal: 8 }, flatAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
    // The game must not be stuck: someone has a legal action again.
    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });

  test('failed roll: chain fully resolves (not left stuck in "resolving")', () => {
    // Same regression as above, but for the failure branch — the chain must
    // resume and complete regardless of whether the flattery succeeded.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    // Roll 7: total = 7 + 3 = 10, not > 10 → failure
    const result = reduce({ ...s, cheatRollTotal: 7 }, flatAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });

  test('failed roll: hazard limit NOT decreased', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });
    const initialLimit = (state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    // Roll 7 → failure
    const result = reduce({ ...s, cheatRollTotal: 7 }, flatAction.action);
    expect(result.error).toBeUndefined();
    const finalLimit = (result.state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;
    expect(finalLimit).toBe(initialLimit);
  });

  // ── Race-specific threshold variations ────────────────────────────────────

  test('Troll attack (threshold 12): success requires total > 12', () => {
    // Aragorn (DI=3) vs Troll (threshold 12). Roll 10 → total = 10+3 = 13 > 12 → success.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Troll });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    // Verify the need is correct for Troll: 12 - 3 + 1 = 10
    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;
    expect((flatAction.action as { need: number }).need).toBe(10);

    // Roll 10 → total 13 > 12 → success
    const result = reduce({ ...s, cheatRollTotal: 10 }, flatAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();
  });

  test('Troll attack (threshold 12): roll 9 with DI=3 equals 12 → failure (must be > 12)', () => {
    // Aragorn (DI=3) vs Troll (threshold 12). Roll 9 → total = 9+3 = 12, NOT > 12 → failure.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [FLATTER_A_FOE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Troll });

    const flatCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: flatCard, targetCharacterId: aragornId,
    }));

    const flatAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'flattery-attempt',
    )!;

    // Roll 9 → total 12 = threshold, NOT strictly greater → failure
    const result = reduce({ ...s, cheatRollTotal: 9 }, flatAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).not.toBeNull();
  });
});

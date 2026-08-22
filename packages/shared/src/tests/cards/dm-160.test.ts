/**
 * @module dm-160.test
 *
 * Card test: Token of Goodwill (dm-160)
 * Type: hero-resource-event (short), alignment wizard, non-unique.
 *
 * Card text: "Offering Attempt. Playable on a diplomat whose company is
 *   facing an attack of the type listed below. Target diplomat makes a
 *   corruption check. If he does not fail, discard an item from his company
 *   (as listed below) to make a roll adding the diplomat's unused direct
 *   influence. If the result is greater than the listed values, the attack
 *   is canceled, and you may take one resource from your play deck or
 *   discard pile into your hand (reshuffle play deck if searched). Against a
 *   Dragon: greater item/5, against a Drake: major item/6, against Men,
 *   Slayer, or any Agent: minor item/7."
 *
 * CRF 22 erratum: "…and make a roll…" should be read "…to make a roll…" —
 * the item discard is the cost that enables the roll.
 *
 * Effects:
 * | # | Effect Type            | Status | Notes                                         |
 * |---|-------------------------|--------|-----------------------------------------------|
 * | 1 | goodwill-cancel-attack | OK     | diplomat-gated, corruption check → item        |
 *   |                         |        | discard + roll (2d6+DI), cancel + resource fetch |
 *
 * Regression: game ms77xgju-p0ke1j, seq 260 — the card had `effects: []` and
 * was never offered as a legal action against a Men attack, forcing the
 * reporting player to use Flatter a Foe instead ("Ne fonctionne pas du tout").
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, LEGOLAS,
  STING,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain, executeAction,
  handCardId, charIdAt, getCharacter,
  eliminateCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, reduce, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';

const TOKEN_OF_GOODWILL = 'dm-160' as CardDefinitionId;

describe('Token of Goodwill (dm-160)', () => {
  beforeEach(() => resetMint());

  // ── Cancel-window availability ────────────────────────────────────────────

  test('cancel-attack offered for a Men attack when the diplomat carries a minor item', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const card = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(1);
  });

  test('NOT offered when the only character present is not a diplomat', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const card = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(0);
  });

  test('NOT offered when the diplomat\'s company carries no minor item', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const card = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(0);
  });

  test('NOT offered for a race not in thresholds (Elf)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Elf });

    const card = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(0);
  });

  test('offered against "any Agent" attack even though no creature race is set', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const state = {
      ...withCombat,
      combat: {
        ...withCombat.combat!,
        creatureRace: undefined,
        attackSource: { type: 'agent' as const, instanceId: 'agent-1' as CardInstanceId },
      },
    };

    const card = handCardId(state, RESOURCE_PLAYER);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(1);
  });

  test('NOT playable outside combat (no attack underway)', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const card = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const playForCard = actions.filter(
      ea => ea.viable
        && (ea.action.type === 'play-short-event' || ea.action.type === 'cancel-attack')
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === card,
    );
    expect(playForCard).toHaveLength(0);
  });

  // ── Chain resolution → corruption check → goodwill-attempt ───────────────

  function declare(state: ReturnType<typeof makeCancelWindowCombat>, gimliId: CardInstanceId) {
    const card = handCardId(state, RESOURCE_PLAYER);
    return dispatch(state, {
      type: 'cancel-attack',
      player: PLAYER_1,
      cardInstanceId: card,
      targetCharacterId: gimliId,
    });
  }

  test('declaring the card enqueues a corruption check on the diplomat, not an immediate roll', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));

    const cc = afterChain.pendingResolutions.find(r => r.kind.type === 'corruption-check' && r.kind.characterId === gimliId);
    expect(cc).toBeDefined();
    expect(afterChain.pendingResolutions.some(r => r.kind.type === 'goodwill-attempt')).toBe(false);
  });

  test('passing the corruption check enqueues goodwill-attempt with the Men threshold (minor/7)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);

    const pending = afterCC.pendingResolutions.find(r => r.kind.type === 'goodwill-attempt');
    expect(pending).toBeDefined();
    expect(pending!.kind).toMatchObject({ characterInstanceId: gimliId, itemSubtype: 'minor', threshold: 7 });
  });

  // ── goodwill-attempt legal action ─────────────────────────────────────────

  test('goodwill-attempt offers discarding Sting with need accounting for unused DI', () => {
    // Gimli DI=2, threshold=7 → need = 7 - 2 + 1 = 6.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);
    const stingId = getCharacter(state, RESOURCE_PLAYER, GIMLI).items[0].instanceId;

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);

    const goodwillActions = computeLegalActions(afterCC, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'goodwill-attempt',
    );
    expect(goodwillActions).toHaveLength(1);
    const action = goodwillActions[0].action as { need: number; itemInstanceId: CardInstanceId; characterInstanceId: CardInstanceId };
    expect(action.need).toBe(6);
    expect(action.characterInstanceId).toBe(gimliId);
    expect(action.itemInstanceId).toBe(stingId);
  });

  // ── Roll resolution: success ──────────────────────────────────────────────

  test('successful roll: item discarded, attack canceled, resource fetch offered', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);

    const goodwillAction = computeLegalActions(afterCC, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'goodwill-attempt',
    )!;

    // need = 6; roll 6 → total = 6 + 2 (DI) = 8 > 7 → success.
    const result = reduce({ ...afterCC, cheatRollTotal: 6 }, goodwillAction.action);
    expect(result.error).toBeUndefined();

    expect(result.state.combat).toBeNull();
    expect(result.state.players[0].characters[gimliId].items).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.definitionId === STING)).toBe(true);

    const fetchEffect = result.state.pendingEffects.find(e => e.type === 'card-effect' && e.effect.type === 'fetch-to-deck');
    expect(fetchEffect).toBeDefined();
  });

  // ── Roll resolution: failure ──────────────────────────────────────────────

  test('failed roll: item still discarded (cost paid), combat continues, no resource fetch', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);

    const goodwillAction = computeLegalActions(afterCC, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'goodwill-attempt',
    )!;

    // need = 6; roll 5 → total = 5 + 2 (DI) = 7, NOT > 7 → failure.
    const result = reduce({ ...afterCC, cheatRollTotal: 5 }, goodwillAction.action);
    expect(result.error).toBeUndefined();

    expect(result.state.combat).not.toBeNull();
    expect(result.state.players[0].characters[gimliId].items).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.definitionId === STING)).toBe(true);

    const fetchEffect = result.state.pendingEffects.find(e => e.type === 'card-effect' && e.effect.type === 'fetch-to-deck');
    expect(fetchEffect).toBeUndefined();
  });

  // ── Chain resolution after the roll ───────────────────────────────────────

  test('failed roll: chain fully resolves (not left stuck in "resolving")', () => {
    // Regression: the goodwill-attempt resolver returned without marking the
    // originating Token of Goodwill chain entry resolved. After a failed
    // roll the chain stayed in 'resolving' mode forever with no legal
    // actions for either player — the same freeze the flattery-attempt
    // resolver was fixed for.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);

    const goodwillAction = computeLegalActions(afterCC, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'goodwill-attempt',
    )!;

    // need = 6; roll 5 → total = 5 + 2 (DI) = 7, NOT > 7 → failure.
    const result = reduce({ ...afterCC, cheatRollTotal: 5 }, goodwillAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
    expect(result.state.combat).not.toBeNull();
    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });

  // ── Diplomat leaves play while the roll is pending ────────────────────────

  test('diplomat eliminated while the attempt is pending: attempt fizzles, game not deadlocked', () => {
    // Regression: the goodwill-attempt emitter returned NO actions when the
    // diplomat (or every qualifying item) had left play before the roll,
    // leaving the pending queue stuck with no legal actions for either
    // player — the same deadlock class as the faction-influence-roll fix
    // (#1725).
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [STING] }, ARAGORN] }], hand: [TOKEN_OF_GOODWILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });
    const gimliId = charIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(declare(state, gimliId));
    const afterCC = executeAction(afterChain, PLAYER_1, 'corruption-check', 12);
    expect(afterCC.pendingResolutions.find(r => r.kind.type === 'goodwill-attempt')).toBeDefined();

    // Gimli (with Sting) leaves play while the attempt is pending.
    const gone = eliminateCharacter(afterCC, RESOURCE_PLAYER, gimliId, afterCC.players[RESOURCE_PLAYER].characters[gimliId]);

    // A cost-less fizzle action is offered (no item to discard).
    const fizzle = computeLegalActions(gone, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'goodwill-attempt',
    );
    expect(fizzle).toBeDefined();
    expect((fizzle!.action as { itemInstanceId?: CardInstanceId }).itemInstanceId).toBeUndefined();

    // Resolving fizzles the attempt: queue advances, attack continues.
    const result = reduce(gone, fizzle!.action);
    expect(result.error).toBeUndefined();
    expect(result.state.pendingResolutions).toHaveLength(0);
    expect(result.state.combat).not.toBeNull();
    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });
});

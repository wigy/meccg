/**
 * @module tw-104.test
 *
 * Card test: Tookish Blood (tw-104)
 * Type: hazard-event (short), also playable as a resource
 *
 * "Playable on a Hobbit character. The Hobbit's player makes a roll; return the
 *  Hobbit to the player's hand if the result plus his unused general influence
 *  is less than 11. If the Hobbit is removed from play, one of his items may be
 *  transferred to another character in his company; any other cards under his
 *  control are discarded.
 *  Alternatively, this card can be played as a resource card. For the rest of
 *  the turn, the target Hobbit cannot be discarded or returned to its owner's
 *  hand for any reason."
 *
 * Engine support:
 * - Hazard mode reuses the certified `call-of-home-check` primitive (as tw-18 /
 *   le-105), keyed by a `play-target` character `filter { target.race: hobbit }`
 *   with `threshold: 11` — roll + unused GI < 11 returns the Hobbit to hand
 *   (items/allies/hazards discarded, followers fall to GI). The optional item
 *   transfer is resolved exactly as the Call of Home siblings.
 * - Resource mode: a `playable-as-resource` play-flag + a `protect-from-removal`
 *   effect. Played on one of the controller's own Hobbits, it installs a
 *   turn-scoped `character-removal-protected` constraint (see
 *   `engine/removal-protection.ts`). While present, the central
 *   `returnCharacterToHand` and `discardCharacter` helpers fizzle any attempt to
 *   return the Hobbit to hand or discard it — including this card's own hazard
 *   mode — for the rest of the turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, P1_COMPANY,
  findCharInstanceId, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  handCardId,
  expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, ResolveDiceCheckAction, PlayHazardAction,
  ResolutionId, PendingResolution,
} from '../../index.js';

const TOOKISH_BLOOD = 'tw-104' as CardDefinitionId;

describe('Tookish Blood (tw-104)', () => {
  beforeEach(() => resetMint());

  // ── Hazard mode: keying ──────────────────────────────────────────────

  test('hazard mode is playable only on a Hobbit character', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOOKISH_BLOOD], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const bilboId = findCharInstanceId(mhState, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(mhState, RESOURCE_PLAYER, ARAGORN);

    const hazardTb = handCardId(mhState, HAZARD_PLAYER);
    const playHazards = computeLegalActions(mhState, PLAYER_2)
      .filter((a): a is typeof a & { action: PlayHazardAction } =>
        a.action.type === 'play-hazard' && a.action.cardInstanceId === hazardTb);

    const onBilbo = playHazards.find(a => a.action.targetCharacterId === bilboId);
    const onAragorn = playHazards.find(a => a.action.targetCharacterId === aragornId);

    expect(onBilbo?.viable).toBe(true);
    // The non-Hobbit is either not offered at all or offered as not-viable.
    expect(onAragorn?.viable ?? false).toBe(false);
  });

  // ── Hazard mode: the roll ────────────────────────────────────────────

  test('hazard mode returns the Hobbit to hand when roll + unused GI < 11', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // BILBO(5) + ARAGORN(6) + LEGOLAS(6) = 17 GI used → unused GI = 3.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOOKISH_BLOOD], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const tbId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tbId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: bilboId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(dc?.kind.type).toBe('dice-check');
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(bilboId);
      expect(dc.kind.threshold).toBe(11);
    }

    // unused GI = 3; force roll 3 → 3 + 3 = 6 < 11 → Bilbo returns to hand.
    s = { ...s, cheatRollTotal: 3 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, bilboId);
    expect(s.players[0].hand.map(c => c.definitionId)).toContain(BILBO);
  });

  test('hazard mode leaves the Hobbit in play when roll + unused GI >= 11', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // BILBO alone → unused GI = 20 - 5 = 15, so any roll passes.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOOKISH_BLOOD], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const tbId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: tbId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: bilboId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, bilboId);
    expect(s.players[0].hand.length).toBe(0);
  });

  // ── Resource mode: keying + protection install ───────────────────────

  test('resource mode is offered only on the controller\'s own Hobbit and installs a turn-scoped protection', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN] }], hand: [TOOKISH_BLOOD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const tbId = handCardId(state, RESOURCE_PLAYER);

    const shortEvents = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-short-event'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === tbId);
    const targets = shortEvents
      .filter(a => a.viable)
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    expect(targets).toContain(bilboId);
    expect(targets).not.toContain(aragornId);

    // Playing the resource mode installs the protection and discards the card.
    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: tbId,
      targetCharacterId: bilboId,
    });
    const prot = s.activeConstraints.find(
      c => c.kind.type === 'character-removal-protected'
        && c.target.kind === 'character' && c.target.characterId === bilboId,
    );
    expect(prot).toBeDefined();
    expect(prot?.scope.kind).toBe('turn');
    expect(s.players[0].hand.map(c => c.definitionId)).not.toContain(TOOKISH_BLOOD);
    expect(s.players[0].discardPile.map(c => c.definitionId)).toContain(TOOKISH_BLOOD);
  });

  // ── Resource mode: protection blocks removal ─────────────────────────

  test('resource-mode protection blocks the hazard return-to-hand for the rest of the turn', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // BILBO(5) + ARAGORN(6) + LEGOLAS(6) = 17 → unused GI = 3 (roll fails).
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN, LEGOLAS] }], hand: [TOOKISH_BLOOD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOOKISH_BLOOD], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const resourceTb = handCardId(state, RESOURCE_PLAYER);

    // P1 plays the resource mode on its own Bilbo → protection installed.
    let s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: resourceTb,
      targetCharacterId: bilboId,
    });
    expect(s.activeConstraints.some(c => c.kind.type === 'character-removal-protected')).toBe(true);

    // Same turn: the opponent plays Tookish Blood as a hazard on Bilbo.
    s = { ...s, phaseState: makeMHState() };
    const hazardTb = handCardId(s, HAZARD_PLAYER);
    s = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardTb,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: bilboId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force a failing roll — but the protection must keep Bilbo in play.
    s = { ...s, cheatRollTotal: 3 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, bilboId);
    expect(s.players[0].hand.map(c => c.definitionId)).not.toContain(BILBO);
  });

  test('resource-mode protection blocks a discard of the Hobbit', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN] }], hand: [TOOKISH_BLOOD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const resourceTb = handCardId(base, RESOURCE_PLAYER);

    // A queued dice-check whose failure would discard Bilbo (the shape the
    // engine itself builds for body-check discards).
    const discardCheck: PendingResolution = {
      id: 'tb-discard-check' as ResolutionId,
      source: bilboId,
      actor: PLAYER_1,
      scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
      kind: {
        type: 'dice-check',
        label: 'Discard check: Bilbo',
        modifiers: [],
        threshold: 11,
        comparison: 'gte',
        onFail: { type: 'discard-character' },
        continuation: { kind: 'dequeue-only' },
        requireTargetPresent: true,
        targetCharacterId: bilboId,
      },
    };

    // Control: with no protection, a failing roll discards Bilbo.
    {
      let s: GameState = { ...base, phaseState: makeMHState(), pendingResolutions: [discardCheck], cheatRollTotal: 2 };
      const rollActions = computeLegalActions(s, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'resolve-dice-check');
      expect(rollActions).toHaveLength(1);
      s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);
      expectCharNotInPlay(s, RESOURCE_PLAYER, bilboId);
      expect(s.players[0].discardPile.map(c => c.definitionId)).toContain(BILBO);
    }

    // Protected: the same failing roll leaves Bilbo in play.
    {
      const protectedState = dispatch(base, {
        type: 'play-short-event',
        player: PLAYER_1,
        cardInstanceId: resourceTb,
        targetCharacterId: bilboId,
      });
      let s: GameState = { ...protectedState, phaseState: makeMHState(), pendingResolutions: [discardCheck], cheatRollTotal: 2 };
      const rollActions = computeLegalActions(s, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'resolve-dice-check');
      expect(rollActions).toHaveLength(1);
      s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);
      expectCharInPlay(s, RESOURCE_PLAYER, bilboId);
      expect(s.players[0].discardPile.map(c => c.definitionId)).not.toContain(BILBO);
    }
  });
});

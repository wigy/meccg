/**
 * @module td-115.test
 *
 * Card test: Fast Asleep (td-115)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text: "+3 to one burglary attempt. Alternatively, -2 to the prowess of one
 *   automatic-attack."
 *
 * Effects:
 * | # | Effect Type   | Status | Notes                                               |
 * |---|---------------|--------|-----------------------------------------------------|
 * | 1 | play-target   | OK     | character — the burgling character                  |
 * | 2 | play-option   | OK     | `burglary-boost`: one-shot `check-modifier`         |
 * |   |               |        | (`burglary`, +3), gated on                          |
 * |   |               |        | `pending.burglaryAttemptTargetsMe` (reactive-only)  |
 * | 3 | modify-attack | OK     | fromHand, defender, -2 prowess, `attack.automatic`  |
 *
 * Mode 1 reuses Wit's (td-168) reactive roll-boost window: while a
 * `burglary-attempt` pending resolution (Burglary td-103) awaits its roll,
 * the card is offered as a `play-short-event` on the burgling character;
 * the roll sums and consumes the `burglary` check-modifier. Mode 2 is the
 * defender-played from-hand `modify-attack` (§10e), offered only against an
 * automatic-attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, RIVENDELL,
  buildSitePhaseTwoPlayer, buildTestState, resetMint,
  setupAutoAttackStep, makeSitePhase, makeCancelWindowCombat,
  declareBurglaryAttempt, burglaryRollAction, shortEventPlaysOf,
  dispatch, viableActions, phaseStateAs, findHandCardId,
  Phase,
} from '../test-helpers.js';
import { Alignment, Race } from '../../types/common.js';
import type { CardDefinitionId, SitePhaseState } from '../../index.js';

const FAST_ASLEEP = 'td-115' as CardDefinitionId;
const BURGLARY = 'td-103' as CardDefinitionId;

describe('Fast Asleep (td-115)', () => {
  beforeEach(() => resetMint());

  // ── Mode 1: +3 to one burglary attempt ─────────────────────────────────

  test('offered as a reactive play on the burgling character while the burglary roll is pending', () => {
    const { state: after, characterId: legolasId } = declareBurglaryAttempt({ site: MORIA, character: LEGOLAS, hand: [BURGLARY, FAST_ASLEEP] });

    const plays = shortEventPlaysOf(after, RESOURCE_PLAYER, FAST_ASLEEP);
    expect(plays).toHaveLength(1);
    expect(plays[0].action).toMatchObject({ targetCharacterId: legolasId, optionId: 'burglary-boost' });
  });

  test('not offered as a burglary boost when no burglary attempt is pending', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [LEGOLAS], heroHand: [FAST_ASLEEP] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });

    const boosts = viableActions(state, PLAYER_1, 'play-short-event').filter(
      ea => (ea.action as { optionId?: string }).optionId === 'burglary-boost',
    );
    expect(boosts).toHaveLength(0);
  });

  test('playing it lowers the roll needed by 3, leaves the roll queued, and discards the card', () => {
    const { state: after, characterId: legolasId } = declareBurglaryAttempt({ site: MORIA, character: LEGOLAS, hand: [BURGLARY, FAST_ASLEEP] });
    expect(burglaryRollAction(after, PLAYER_1).need).toBe(11);  // threshold 10, no bonus

    const card = findHandCardId(after, RESOURCE_PLAYER, FAST_ASLEEP);
    const boosted = dispatch(after, shortEventPlaysOf(after, RESOURCE_PLAYER, FAST_ASLEEP)[0].action);

    expect(boosted.pendingResolutions.filter(r => r.kind.type === 'burglary-attempt')).toHaveLength(1);
    expect(boosted.players[0].discardPile.some(c => c.instanceId === card)).toBe(true);
    const mods = boosted.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'burglary'
        && c.target.kind === 'character' && c.target.characterId === legolasId,
    );
    expect(mods).toHaveLength(1);
    expect(burglaryRollAction(boosted, PLAYER_1).need).toBe(8);  // 10 - 3 + 1
    // Only one boost per copy — no second Fast Asleep in hand.
    expect(shortEventPlaysOf(boosted, RESOURCE_PLAYER, FAST_ASLEEP)).toHaveLength(0);
  });

  test('the +3 turns a failing roll into a success and is consumed by the roll', () => {
    const { state: after, characterId: legolasId } = declareBurglaryAttempt({ site: MORIA, character: LEGOLAS, hand: [BURGLARY, FAST_ASLEEP] });
    const boosted = dispatch(after, shortEventPlaysOf(after, RESOURCE_PLAYER, FAST_ASLEEP)[0].action);
    // Roll 8: 8 + 3 = 11 > 10 → success (would fail without Fast Asleep).
    const afterRoll = dispatch({ ...boosted, cheatRollTotal: 8 }, burglaryRollAction(boosted, PLAYER_1));
    const site = phaseStateAs<SitePhaseState>(afterRoll);
    expect(site.autoAttacksSkipped).toBe(true);
    expect(site.burglaryItemUnlock).toBe(legolasId);
    expect(site.soloAutoAttackCharacterId).toBeUndefined();
    expect(afterRoll.activeConstraints.some(c => c.kind.type === 'check-modifier' && c.kind.check === 'burglary')).toBe(false);
  });

  test('without Fast Asleep the same roll of 8 fails', () => {
    const { state: after, characterId: legolasId } = declareBurglaryAttempt({ site: MORIA, character: LEGOLAS, hand: [BURGLARY] });
    const afterRoll = dispatch({ ...after, cheatRollTotal: 8 }, burglaryRollAction(after, PLAYER_1));
    expect(phaseStateAs<SitePhaseState>(afterRoll).soloAutoAttackCharacterId).toBe(legolasId);
  });

  // ── Mode 2: -2 to the prowess of one automatic-attack ───────────────────

  test('against a site automatic-attack: offered to the defender and gives -2 prowess', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [FAST_ASLEEP] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    // Declining to burgle initiates Moria's automatic-attack (Orcs, 4 strikes / 7 prowess).
    const inCombat = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat?.attackSource.type).toBe('automatic-attack');
    const before = inCombat.combat!.strikeProwess;

    const card = findHandCardId(inCombat, RESOURCE_PLAYER, FAST_ASLEEP);
    const mods = viableActions(inCombat, PLAYER_1, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === card,
    );
    expect(mods).toHaveLength(1);

    const after = dispatch(inCombat, mods[0].action);
    expect(after.combat!.strikeProwess).toBe(before - 2);
    expect(after.players[0].hand.some(c => c.instanceId === card)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === card)).toBe(true);
  });

  test('not offered against a hazard creature attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [FAST_ASLEEP], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const creature = makeCancelWindowCombat(base, { attackSourceType: 'creature', creatureRace: Race.Orc });
    expect(viableActions(creature, PLAYER_1, 'modify-attack')).toHaveLength(0);

    const auto = makeCancelWindowCombat(base, { attackSourceType: 'automatic-attack', creatureRace: Race.Orc, strikeProwess: 7 });
    const mods = viableActions(auto, PLAYER_1, 'modify-attack');
    expect(mods).toHaveLength(1);
    expect(dispatch(auto, mods[0].action).combat!.strikeProwess).toBe(5);
  });
});

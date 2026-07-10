/**
 * @module ba-11.test
 *
 * Card test: Carrion Feeders (ba-11)
 * Type: hazard-creature (Animals), non-unique
 *
 * Text:
 *   "Animals. Each wounded character faces one strike. All body checks
 *    resulting from successful strikes are modified by an additional +1. Each
 *    untapped character in the company may tap to cancel a strike against a
 *    wounded character."
 *
 * Canonical cost (`data/cards.json` BA-11 attributes.playable): {w}{s}{R}{S}
 * — keyable to a Wilderness OR Shadow-land region in the path, OR to a
 * Ruins & Lairs OR Shadow-hold destination site (region types are OR'd with
 * count semantics; a single keyedTo entry lists the alternatives). Base stats:
 * strikes 1/each-wounded, prowess 9, body — (no creature body check), kill MP 1.
 *
 * Effects:
 * | # | Rule (card text)                                     | Encoding                                            |
 * |---|------------------------------------------------------|-----------------------------------------------------|
 * | 1 | "Each wounded character faces one strike."           | combat-one-strike-per-character { onlyWounded }     |
 * | 2 | "All body checks ... modified by an additional +1."  | combat-body-check-modifier { value: 1 }             |
 * | 3 | "Each untapped character ... may tap to cancel a     | combat-tap-to-cancel-strike (cancel-by-tap sub-     |
 * |   |  strike against a wounded character."                | phase, strikeCharacterId picks the wounded target)  |
 *
 * Playable: YES. Strikes are pre-assigned one per wounded (inverted) character
 * (unwounded characters never face a strike). Every character body check from
 * the attack gains +1 (on top of the already-wounded +1). Untapped company
 * characters may tap during the cancel-by-tap window to remove one pre-assigned
 * strike, choosing which wounded ally to protect. With no wounded characters
 * the creature has no target and is discarded without combat.
 *
 * Fixtures: hero mover (P1, defending) vs a hazard player (P2) holding Carrion
 * Feeders; keyed via a Wilderness in the site path to a Ruins & Lairs.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, findCharInstanceId, setCharStatus,
  viableActions, dispatch, executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER, CardStatus,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState, CardInstanceId } from '../../index.js';

const CARRION_FEEDERS = 'ba-11' as CardDefinitionId;
const BOROMIR = 'tw-134' as CardDefinitionId; // hero warrior, prowess 6, body 7

/**
 * Build a Movement/Hazard state where P1 (hero, defending) has a moving company
 * at `MORIA` with the given characters, and P2 (hazard player) holds Carrion
 * Feeders. `wounded` / `untapped` set the starting statuses. The company path
 * has one Wilderness and the destination is a Ruins & Lairs, so the creature
 * keys via `{w}` / `{R}`.
 */
function setup(characters: CardDefinitionId[], statuses: Record<string, CardStatus> = {}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [CARRION_FEEDERS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  let state: GameState = {
    ...base,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Some Lair',
    }),
  };
  for (const [defId, status] of Object.entries(statuses)) {
    state = setCharStatus(state, RESOURCE_PLAYER, defId as CardDefinitionId, status);
  }
  return state;
}

function play(state: GameState): GameState {
  const creatureId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(
    state, PLAYER_2, creatureId, companyId,
    { method: 'region-type' as const, value: RegionType.Wilderness },
  );
}

describe('Carrion Feeders (ba-11)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: one strike per wounded character; unwounded never struck ───────

  test('strikes = number of wounded characters, pre-assigned only to wounded', () => {
    // ARAGORN untapped, LEGOLAS + GIMLI wounded → 2 strikes, one per wounded.
    const state = setup([ARAGORN, LEGOLAS, GIMLI], {
      [LEGOLAS]: CardStatus.Inverted,
      [GIMLI]: CardStatus.Inverted,
    });
    const after = play(state);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.creatureBody).toBe(null);

    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const struck = after.combat!.strikeAssignments.map(a => a.characterId as string);
    expect(struck).toContain(legolasId as string);
    expect(struck).toContain(gimliId as string);
    // The untapped, unwounded character is never assigned a strike.
    expect(struck).not.toContain(aragornId as string);
  });

  test('body-check modifier and tap-to-cancel flags are set on the combat', () => {
    const state = setup([ARAGORN, LEGOLAS], { [LEGOLAS]: CardStatus.Inverted });
    const after = play(state);

    expect(after.combat!.bodyCheckModifier).toBe(1);
    expect(after.combat!.cancelStrikeAgainstWounded).toBe(true);
    // With an untapped character present, the cancel-by-tap window opens.
    expect(after.combat!.phase).toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('cancel-by-tap');
  });

  // ── Rule: no wounded characters → no target, discarded without combat ──────

  test('no wounded characters: creature has no effect and is discarded', () => {
    const state = setup([ARAGORN, LEGOLAS]); // both untapped (unwounded)
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const after = play(state);

    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureId)).toBe(true);
  });

  // ── No untapped defender: no cancel window, straight to resolution ─────────

  test('all-wounded company (no untapped): opens directly at choose-strike-order', () => {
    const state = setup([LEGOLAS, GIMLI], {
      [LEGOLAS]: CardStatus.Inverted,
      [GIMLI]: CardStatus.Inverted,
    });
    const after = play(state);

    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.phase).toBe('choose-strike-order');
    // No untapped character exists to open a cancel-by-tap window.
    expect(after.combat!.cancelStrikeAgainstWounded).toBeFalsy();
  });

  // ── Rule 3: untapped character taps to cancel a wounded character's strike ─

  test('untapped character taps to cancel one wounded character\'s strike', () => {
    const state = setup([ARAGORN, LEGOLAS, GIMLI], {
      [LEGOLAS]: CardStatus.Inverted,
      [GIMLI]: CardStatus.Inverted,
    });
    const after = play(state);

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);

    // The cancel-by-tap window offers (untapped char × each wounded target).
    const cancelActions = viableActions(after, PLAYER_1, 'cancel-by-tap');
    expect(cancelActions.length).toBe(2); // ARAGORN → LEGOLAS, ARAGORN → GIMLI
    for (const a of cancelActions) {
      expect((a.action as { characterId: CardInstanceId }).characterId).toBe(aragornId);
    }

    // Tap ARAGORN to cancel the strike against LEGOLAS.
    const resolved = dispatch(after, {
      type: 'cancel-by-tap', player: PLAYER_1,
      characterId: aragornId, strikeCharacterId: legolasId,
    });

    // ARAGORN is now tapped; only GIMLI's strike remains (single → resolve-strike).
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(resolved.combat!.strikesTotal).toBe(1);
    const remaining = resolved.combat!.strikeAssignments.map(a => a.characterId as string);
    expect(remaining).toEqual([gimliId as string]);
    expect(resolved.combat!.phase).toBe('resolve-strike');
  });

  test('defender may pass the cancel-by-tap window, keeping all strikes', () => {
    const state = setup([ARAGORN, LEGOLAS, GIMLI], {
      [LEGOLAS]: CardStatus.Inverted,
      [GIMLI]: CardStatus.Inverted,
    });
    const after = play(state);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);

    const passed = dispatch(after, { type: 'pass', player: PLAYER_1 });

    // No strike canceled; ARAGORN stays untapped; both strikes proceed to resolution.
    expect(passed.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Untapped);
    expect(passed.combat!.strikesTotal).toBe(2);
    expect(passed.combat!.phase).toBe('choose-strike-order');
  });

  test('cancelling the only wounded strike ends combat and discards the creature', () => {
    // One wounded target, two untapped potential cancellers.
    const state = setup([ARAGORN, GIMLI, LEGOLAS], { [LEGOLAS]: CardStatus.Inverted });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const after = play(state);
    expect(after.combat!.strikesTotal).toBe(1);

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);

    const ended = dispatch(after, {
      type: 'cancel-by-tap', player: PLAYER_1,
      characterId: aragornId, strikeCharacterId: legolasId,
    });

    expect(ended.combat).toBeNull();
    expect(ended.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureId)).toBe(true);
  });

  // ── Rule 2: +1 to the body check from a successful strike ──────────────────

  test('the +1 body-check modifier pushes a wounded character to elimination', () => {
    // Lone wounded BOROMIR (body 7): no untapped character, so combat opens
    // directly at resolve-strike with the single pre-assigned strike.
    const state = setup([BOROMIR], { [BOROMIR]: CardStatus.Inverted });
    const after = play(state);
    expect(after.combat!.phase).toBe('resolve-strike');
    expect(after.combat!.bodyCheckModifier).toBe(1);

    const boromirId = findCharInstanceId(after, RESOURCE_PLAYER, BOROMIR);

    // Resolve the strike with a low roll → BOROMIR (wounded prowess 4) is
    // wounded again (6 < 9) → body check.
    const struck = executeAction(after, PLAYER_1, 'resolve-strike', 2);
    expect(struck.combat!.phase).toBe('body-check');

    // Body-check roll 6: 6 + 1 (already wounded) = 7 is NOT > body 7 (would
    // survive), but the extra +1 from Carrion Feeders makes 8 > 7 → eliminated.
    const done = executeAction(struck, PLAYER_2, 'body-check-roll', 6);
    expect(done.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === boromirId)).toBe(true);
  });
});

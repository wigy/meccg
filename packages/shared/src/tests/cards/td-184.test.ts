/**
 * @module td-184.test
 *
 * Card test: Ringil (td-184)
 * Type: hero-resource-item (greater, hoard, weapon)
 *
 * "Unique. Hoard item. Weapon. +1 body. Warrior only: +1 prowess (to a
 *  maximum of 8). A stored Reforging may be placed with this item to
 *  'restore' it. Once restored, Ringil gives 4 marshalling points, 3
 *  corruption points and +5 prowess (to a maximum of 11)."
 *
 * Being a hoard item, playability is gated by `item-play-site` to sites with
 * the `hoard` keyword (Dragon's lairs). The +1 body bonus is unconditional;
 * the prowess bonus is Warrior-only (both the base and restored tiers — the
 * canonical `cards.json` attributes print both as `(+1) (+5)`, parenthesised
 * exactly like the base tier's own class gate).
 *
 * "Restore" (shared with Horn of Defiance td-183 and Belegennon td-185, not
 * certified here): discarding a stored Reforging (tw-314) — already sitting
 * in the controller's marshalling-point pile from its own sage-tap ability —
 * flips a permanent `ItemInPlay.restored` flag on Ringil in place (no card
 * changes zone). Once restored, Ringil's printed marshalling/corruption
 * points are overridden (2→4 MP, 2→3 CP) and its prowess bonus switches from
 * the base tier to the restored tier.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  GIMLI, GLORFINDEL_II, FRODO,
  LORIEN, MORIA, RIVENDELL, MINAS_TIRITH,
  resetMint, mint,
  buildSitePhaseState, buildTestState, makePlayDeck,
  findCharInstanceId, findItemInstanceId, findInPile, addToPile,
  viableActions, dispatch, getCharacter, Phase,
} from '../test-helpers.js';
import type { CardDefinitionId, GameAction } from '../../index.js';

const RINGIL = 'td-184' as CardDefinitionId;
const REFORGING = 'tw-314' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // ruins-and-lairs, hoard

describe('Ringil (td-184)', () => {
  beforeEach(() => resetMint());

  // ── item-play-site: hoard sites only ──

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      hand: [RINGIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('playable at a hoard site (The Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN,
      hand: [RINGIL],
    });
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.some(a => a.action.type === 'play-hero-resource' && a.action.attachToCharacterId === gimliId)).toBe(true);
  });

  // ── Base bonuses: +1 body unconditional, +1 prowess (max 8) Warrior only ──

  function bearerState(defId: CardDefinitionId) {
    return buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId, items: [RINGIL] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [MORIA] },
      ],
    });
  }

  test('+1 body applied to any bearer, warrior or not (Frodo 9 → 10)', () => {
    const s = dispatch(bearerState(FRODO), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(10);
  });

  test('+1 prowess applied to a warrior bearer (Gimli 5 → 6)', () => {
    const s = dispatch(bearerState(GIMLI), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(6);
  });

  test('prowess bonus NOT applied to a non-warrior bearer (Frodo stays at 1)', () => {
    const s = dispatch(bearerState(FRODO), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(1);
  });

  test('prowess bonus capped at 8 for a high-prowess warrior (Glorfindel II 8 → 8, not 9)', () => {
    const s = dispatch(bearerState(GLORFINDEL_II), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(8);
  });

  test('base printed marshalling/corruption points before restoring (2 MP item, 2 CP)', () => {
    const state = bearerState(GIMLI);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Restore: discard a stored Reforging to flip Ringil to its restored tier ──

  function restoreState(defId: CardDefinitionId, opts: { withReforging?: boolean } = {}) {
    const withReforging = opts.withReforging ?? true;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId, items: [RINGIL] }] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    if (!withReforging) return base;
    return addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: REFORGING, storedAtSite: RIVENDELL },
    );
  }

  function restoreAction(state: ReturnType<typeof restoreState>) {
    return viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string })
      .find(a => a.actionId === 'restore-ringil');
  }

  test('NOT offered without a stored Reforging', () => {
    const state = restoreState(GIMLI, { withReforging: false });
    expect(restoreAction(state)).toBeUndefined();
  });

  test('offered with a stored Reforging, targeting it', () => {
    const state = restoreState(GIMLI);
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;
    const act = restoreAction(state) as GameAction & { targetCardId?: unknown };
    expect(act).toBeDefined();
    expect(act!.targetCardId).toBe(reforgingId);
  });

  test('activating it discards the stored Reforging and marks Ringil restored', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === REFORGING)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === REFORGING)).toBe(true);

    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const ringilItem = after.players[RESOURCE_PLAYER].characters[gimliId].items.find(i => i.definitionId === RINGIL);
    expect(ringilItem?.restored).toBe(true);
  });

  test('restoring updates marshalling points (2 → 4) and corruption points (2 → 3)', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(3);
  });

  test('restoring switches the prowess bonus to +5/max 11 for a warrior bearer (Gimli 5 → 10)', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(10);
  });

  test('restored prowess bonus is capped at 11 (Glorfindel II 8 → 11, not 13)', () => {
    const state = restoreState(GLORFINDEL_II);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(getCharacter(after, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(11);
  });

  test('restored prowess bonus still does NOT apply to a non-warrior bearer (Frodo stays at 1)', () => {
    const state = restoreState(FRODO);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(1);
  });

  test('body bonus stays a flat +1 after restoring (Frodo 9 → 10, unchanged)', () => {
    const state = restoreState(FRODO);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(10);
  });

  test('NOT offered again once already restored', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(restoreAction(after)).toBeUndefined();
  });

  test('restoring again with a second stored Reforging is still refused (already restored)', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    let after = dispatch(state, act);
    after = addToPile(
      after, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: REFORGING, storedAtSite: RIVENDELL },
    );
    expect(restoreAction(after)).toBeUndefined();
  });
});

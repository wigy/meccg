/**
 * @module td-185.test
 *
 * Card test: Belegennon (td-185)
 * Type: hero-resource-item (greater, hoard, armor)
 *
 * "Unique. Hoard item. Armor. +1 body (to a maximum of 9). A stored
 *  Reforging may be placed with this item to 'restore' it. Once restored,
 *  Belegennon gives 4 marshalling points and 3 corruption points. Warrior
 *  only (restored): If bearer chooses not to tap against a strike, he
 *  receives no prowess penalty."
 *
 * Being a hoard item, playability is gated by `item-play-site` to sites with
 * the `hoard` keyword (Dragon's lairs). The +1 body bonus (capped at 9) is
 * unconditional, applying to any bearer regardless of skills.
 *
 * "Restore" (shared with Horn of Defiance td-183 and Ringil td-184):
 * discarding a stored Reforging (tw-314) — already sitting in the
 * controller's marshalling-point pile from its own sage-tap ability — flips
 * a permanent `ItemInPlay.restored` flag on Belegennon in place (no card
 * changes zone). Once restored, Belegennon's printed marshalling/corruption
 * points are overridden (2→4 MP, 2→3 CP), and a Warrior bearer no longer
 * pays the CoE 3.iv.3 "stay untapped" prowess penalty when choosing not to
 * tap against a strike — the same `stat-modifier` `untap-penalty` `op: "set"`
 * `value: 0` mechanic certified for Thong of Fire (as-132), here additionally
 * gated on `item.restored: true` (Ringil td-184 precedent for pairing a
 * pre-/post-restore `when` clause) alongside the Warrior gate.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  GIMLI, GLORFINDEL_II, FRODO,
  LORIEN, MORIA, RIVENDELL, MINAS_TIRITH,
  CardStatus, makeShadowMHState,
  resetMint, mint,
  buildSitePhaseState, buildTestState, makePlayDeck,
  findCharInstanceId, findInPile, addToPile, companyIdAt,
  viableActions, dispatch, getCharacter, Phase,
} from '../test-helpers.js';
import { Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameAction, GameState, ResolveStrikeAction,
} from '../../index.js';

const BELEGENNON = 'td-185' as CardDefinitionId;
const REFORGING = 'tw-314' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // ruins-and-lairs, hoard

// A real Orc hazard creature card, so a defeated creature has somewhere to go.
const ORC_WARBAND = 'tw-076' as CardDefinitionId;
const ORC_CREATURE_ID = 'orc-creature-1' as CardInstanceId;
const STRIKE_PROWESS = 8;

describe('Belegennon (td-185)', () => {
  beforeEach(() => resetMint());

  // ── item-play-site: hoard sites only ──

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      hand: [BELEGENNON],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('playable at a hoard site (The Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN,
      hand: [BELEGENNON],
    });
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.some(a => a.action.type === 'play-hero-resource' && a.action.attachToCharacterId === gimliId)).toBe(true);
  });

  // ── Base bonus: +1 body (max 9), unconditional ──

  function bearerState(defId: CardDefinitionId) {
    return buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId, items: [BELEGENNON] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [MORIA] },
      ],
    });
  }

  test('+1 body applied to any bearer, warrior or not (Gimli 8 → 9)', () => {
    const s = dispatch(bearerState(GIMLI), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(9);
  });

  test('body bonus capped at 9 for a non-warrior bearer already at 9 (Frodo 9 → 9, not 10)', () => {
    const s = dispatch(bearerState(FRODO), { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(9);
  });

  test('base printed marshalling/corruption points before restoring (2 MP item, 2 CP)', () => {
    const state = bearerState(GIMLI);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Restore: discard a stored Reforging to flip Belegennon to its restored tier ──

  function restoreState(defId: CardDefinitionId, opts: { withReforging?: boolean } = {}) {
    const withReforging = opts.withReforging ?? true;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId, items: [BELEGENNON] }] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
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
      .find(a => a.actionId === 'restore-item');
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
    expect(act.targetCardId).toBe(reforgingId);
  });

  test('activating it discards the stored Reforging and marks Belegennon restored', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === REFORGING)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === REFORGING)).toBe(true);

    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const belegennonItem = after.players[RESOURCE_PLAYER].characters[gimliId].items.find(i => i.definitionId === BELEGENNON);
    expect(belegennonItem?.restored).toBe(true);
  });

  test('restoring updates marshalling points (2 → 4) and corruption points (2 → 3)', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(3);
  });

  test('body bonus stays a flat +1 (max 9) after restoring (Gimli 8 → 9, unchanged)', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(9);
  });

  test('NOT offered again once already restored', () => {
    const state = restoreState(GIMLI);
    const act = restoreAction(state) as GameAction;
    const after = dispatch(state, act);

    expect(restoreAction(after)).toBeUndefined();
  });

  // ── "Warrior only (restored): no prowess penalty when not tapping" ──

  /** Move an already-built state into an M/H combat where a single Orc
   *  strike of prowess `STRIKE_PROWESS` is pre-assigned to `bearerDefId`,
   *  poised at `resolve-strike`. Reuses the players already in `state`
   *  (e.g. a post-restore state), instead of rebuilding them. */
  function toStrikeCombat(state: GameState, bearerDefId: CardDefinitionId): GameState {
    const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, bearerDefId);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const withCreature = {
      ...state.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...state.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: ORC_CREATURE_ID, definitionId: ORC_WARBAND, status: CardStatus.Untapped },
      ],
    };
    const players: typeof state.players = [state.players[RESOURCE_PLAYER], withCreature];

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: STRIKE_PROWESS,
      creatureBody: 9,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: bearerId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    return { ...state, players, phaseState: makeShadowMHState(), combat };
  }

  /** The roll the defender needs, for the tap-to-fight and stay-untapped options. */
  function strikeNeeds(state: GameState): { tap: number; untap: number | undefined } {
    const actions = viableActions(state, PLAYER_1, 'resolve-strike')
      .map(ea => ea.action as ResolveStrikeAction);
    return {
      tap: actions.find(a => a.tapToFight)!.need,
      untap: actions.find(a => !a.tapToFight)?.need,
    };
  }

  test('a warrior bearer still pays the full -3 stay-untapped penalty BEFORE restoring', () => {
    const state = toStrikeCombat(restoreState(GIMLI, { withReforging: false }), GIMLI);
    // Gimli's printed prowess 5 gets his own +2 vs Orcs, so combat prowess is
    // 7. Tap: need max(2, 8-7+1) = 2. Untap: 7-3 = 4 → need max(2, 8-4+1) = 5.
    expect(strikeNeeds(state)).toEqual({ tap: 2, untap: 5 });
  });

  test('once restored, a warrior bearer needs the same roll whether he taps or stays untapped', () => {
    const restored = dispatch(restoreState(GIMLI), restoreAction(restoreState(GIMLI)) as GameAction);
    const state = toStrikeCombat(restored, GIMLI);
    // Prowess 7 (incl. Gimli's +2 vs Orcs) in both modes; the stay-untapped
    // penalty is cancelled.
    expect(strikeNeeds(state)).toEqual({ tap: 2, untap: 2 });
  });

  test('even once restored, a non-warrior bearer still pays the full -3 (Warrior gate)', () => {
    const restored = dispatch(restoreState(FRODO), restoreAction(restoreState(FRODO)) as GameAction);
    const state = toStrikeCombat(restored, FRODO);
    // Frodo prowess 1: tap need max(2, 8-1+1) = 8. Untap: 1-3 = -2 → need max(2, 8-(-2)+1) = 11.
    expect(strikeNeeds(state)).toEqual({ tap: 8, untap: 11 });
  });
});

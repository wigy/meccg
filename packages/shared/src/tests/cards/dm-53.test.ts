/**
 * @module dm-53.test
 *
 * Card test: Earth-tremors (dm-53)
 * Type: hazard-event (Long-event / Environment), non-unique
 *
 * Card text:
 *   "Any company moving to or from an Under-deeps site faces an attack (cannot
 *    be canceled): Rock Fall — 1 strike with 7 prowess against each character
 *    (weapons do not modify prowess against these strikes). In addition,
 *    cancels the effects of Into Dark Tunnels, Old Road, Great Road, and
 *    Bridge. Cannot be duplicated."
 *
 * Effects (data):
 *   - ahunt-attack: `underDeepsMove: true`, 1 strike / 7 prowess, race
 *     "special" (Rock Fall has no printed creature race), combatRules
 *     ["cannot-be-canceled", "weapons-ineffective"].
 *   - cancel-card-effects: cardNames ["Into Dark Tunnels", "Old Road",
 *     "Great-road", "Bridge"] (the source card's stored `name` is "Great-road",
 *     hyphenated, though the printed card text reads "Great Road" — matching
 *     is by exact `CardDefinition.name`).
 *   - duplication-limit: scope game, max 1.
 *
 * Engine work done for this certification:
 *   - `ahunt-attack` gained an optional `underDeepsMove` flag
 *     (`types/effects.ts`) and `collectMatchingAhuntAttacks`
 *     (`engine/mh-steps.ts`) now matches it independently of the region-path
 *     name/type lists — Under-deeps movement has no region path. Gated on the
 *     company actually moving (`destinationSite` set) and its origin or
 *     destination carrying the `under-deeps` keyword, via a new shared
 *     `companyMovesUnderDeeps` helper (`engine/reducer-utils.ts`) also now used
 *     by rule 5.31's `findForcingEnvironment` (The Way is Shut dm-98).
 *   - `buildAhuntCombat` now threads the `cannot-be-canceled` /
 *     `weapons-ineffective` `combatRules` tokens onto the ahunt `CombatState`
 *     (`uncancelable` / `weaponsIneffective`), matching how site auto-attacks
 *     already read them.
 *   - "Weapons do not modify prowess against these strikes" was previously
 *     only exposed as a `when` context flag for one reactive item ability
 *     (Dwarven Light-stone dm-168); it did not yet suppress the defender's own
 *     weapon prowess bonus. `computeCombatProwess`
 *     (`engine/recompute-derived.ts`) now takes an optional
 *     `weaponsIneffective` parameter that drops every prowess `stat-modifier`
 *     sourced from a `weapon`-keyworded card before resolving, and
 *     `passiveModifyAttackProwessBonus` (`engine/combat-strike.ts`) likewise
 *     skips passive `modify-attack` bonuses from weapon items. Both are wired
 *     from `resolveStrikeCore` via `combat.weaponsIneffective`.
 *   - `cancel-card-effects` previously only suppressed effects consumed
 *     through the `ActiveConstraint`-filtering switch (`applyOneConstraint`).
 *     Two of Earth-tremors' four named cards use mechanisms outside that
 *     switch: `grant-extra-mh-phase` (Into Dark Tunnels dm-145) sets
 *     `Company.extraMHPhasePending` directly in `chain-reducer.ts`, and
 *     `hazard-draw-multiplier` (Great-road tw-249) is read directly by
 *     `transitionToDrawCards` in `mh-steps.ts`. A new shared
 *     `isCardNameEffectCanceled` helper (`engine/reducer-utils.ts`) — reused by
 *     `constraintSuppressedByCancelEffect` for the constraint-based path — is
 *     now also consulted at both of those call sites, so a `cancel-card-effects`
 *     card actually neutralizes the effect regardless of which mechanism the
 *     named card uses.
 *
 * Every rule below is exercised end-to-end against the engine (game state →
 * reducer / legal actions → assertions on the result), never by re-asserting
 * the card's own JSON fields against themselves.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain,
  makeMHState, addCardInPlay, findCharInstanceId, viableActions, viableActionsForHandCard, pool, mint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GLAMDRING, MORIA, MINAS_TIRITH, LORIEN,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { addConstraint } from '../../engine/pending.js';
import { Phase, RegionType, Race } from '../../index.js';
import type {
  CardDefinitionId, CharacterCard, CombatState, GameState, MovementHazardPhaseState,
} from '../../index.js';

const EARTH_TREMORS = 'dm-53' as CardDefinitionId;
const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId; // Under-deeps shadow-hold
const MOUNT_GUNDABAD = 'tw-416' as CardDefinitionId; // hero surface site, not Under-deeps
const INTO_DARK_TUNNELS = 'dm-145' as CardDefinitionId; // grant-extra-mh-phase (movement "under-deeps")
const GREAT_ROAD = 'tw-249' as CardDefinitionId; // hazard-draw-multiplier ×2

describe('Earth-tremors (dm-53)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Rock Fall — any company moving to or from an Under-deeps site ─

  function orderEffectsState(opts: { origin: CardDefinitionId; destination: CardDefinitionId }) {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: opts.origin, characters: [ARAGORN], destinationSite: opts.destination }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const withEnv = addCardInPlay(base, HAZARD_PLAYER, EARTH_TREMORS);
    return {
      ...withEnv,
      phaseState: makeMHState({
        step: 'order-effects' as const,
        activeCompanyIndex: 0,
        // Under-deeps movement has no region path.
        resolvedSitePathNames: [],
        resolvedSitePath: [],
      }),
    };
  }

  test('a company moving TO an Under-deeps site faces Rock Fall (1 strike, 7 prowess)', () => {
    const state = orderEffectsState({ origin: MORIA, destination: THE_UNDER_LEAS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(1);
    expect(combat.strikeProwess).toBe(7);
    // No printed body — a defeated strike triggers no body check vs creature.
    expect(combat.creatureBody).toBeNull();
  });

  test('a company moving FROM an Under-deeps site faces Rock Fall too', () => {
    const state = orderEffectsState({ origin: THE_UNDER_LEAS, destination: MORIA });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.strikesTotal).toBe(1);
    expect(combat.strikeProwess).toBe(7);
  });

  test('a company neither moving to nor from an Under-deeps site faces no attack', () => {
    const state = orderEffectsState({ origin: MORIA, destination: MINAS_TIRITH });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── Rule 1a: cannot be canceled ────────────────────────────────────────────

  test('the Rock Fall attack cannot be canceled', () => {
    const state = orderEffectsState({ origin: MORIA, destination: THE_UNDER_LEAS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    expect(next.combat!.uncancelable).toBe(true);
    expect(viableActions(next, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Rule 1b: weapons do not modify prowess against these strikes ──────────

  test('a weapon prowess bonus is excluded from the defender\'s prowess for this strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragorn = state.players[RESOURCE_PLAYER].characters[aragornId];
    const aragornDef = pool[ARAGORN as string] as CharacterCard;

    // Ordinary strike: Glamdring's +3 prowess applies (capped at 8, base 6).
    expect(computeCombatProwess(state, aragorn, aragornDef, Race.Special, 'tap')).toBe(8);

    // Rock Fall (weaponsIneffective = true): the weapon bonus is excluded —
    // only Aragorn's base prowess (6) counts.
    expect(computeCombatProwess(state, aragorn, aragornDef, Race.Special, 'tap', true)).toBe(aragornDef.prowess);
    expect(aragornDef.prowess).toBe(6);
  });

  // ─── Rule 2: cancels the effects of Into Dark Tunnels ──────────────────────

  function movingToUnderDeeps() {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MOUNT_GUNDABAD, characters: [ARAGORN], destinationSite: THE_UNDER_LEAS }],
          hand: [INTO_DARK_TUNNELS],
          siteDeck: [],
          playDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    return { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  }

  function playIntoDarkTunnels(state: GameState) {
    const instId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;
    return resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: instId }));
  }

  test('without Earth-tremors, Into Dark Tunnels grants an extra Under-deeps M/H phase', () => {
    const after = playIntoDarkTunnels(movingToUnderDeeps());
    expect(after.players[RESOURCE_PLAYER].companies[0].extraMHPhasePending).toBe('under-deeps');
  });

  test('with Earth-tremors in play, Into Dark Tunnels grants no extra phase — its effect is canceled', () => {
    const withEnv = addCardInPlay(movingToUnderDeeps(), HAZARD_PLAYER, EARTH_TREMORS);
    const after = playIntoDarkTunnels(withEnv);

    expect(after.players[RESOURCE_PLAYER].companies[0].extraMHPhasePending).toBeFalsy();
    // The spent card is still discarded normally — only its granted effect fizzles.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === INTO_DARK_TUNNELS)).toBe(true);
  });

  // ─── Rule 2: cancels the effects of Great-road ─────────────────────────────

  function withGreatRoadConstraint(earthTremorsInPlay: boolean) {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    if (earthTremorsInPlay) state = addCardInPlay(state, HAZARD_PLAYER, EARTH_TREMORS);
    const targetCompanyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: GREAT_ROAD,
      scope: { kind: 'company-mh-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'hazard-draw-multiplier', multiplier: 2 },
    });
    return {
      ...constrained,
      phaseState: makeMHState({
        step: 'order-effects' as const,
        activeCompanyIndex: 0,
        resolvedSitePathNames: ['Anórien'],
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };
  }

  test('without Earth-tremors, Great-road doubles the hazard draw max (Minas Tirith: 2 → 4)', () => {
    const state = withGreatRoadConstraint(false);
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect((next.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(4);
  });

  test('with Earth-tremors in play, Great-road\'s hazard-draw-multiplier is suppressed (stays 2)', () => {
    const state = withGreatRoadConstraint(true);
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect((next.phaseState as MovementHazardPhaseState).hazardDrawMax).toBe(2);
  });

  // ─── Rule 3: cannot be duplicated ───────────────────────────────────────────

  test('a second Earth-tremors cannot be played while one is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [EARTH_TREMORS], siteDeck: [] },
      ],
    });
    const base = { ...built, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };

    // Without a copy in play, Earth-tremors is playable.
    expect(viableActionsForHandCard(base, PLAYER_2, 'play-hazard', HAZARD_PLAYER, EARTH_TREMORS).length).toBeGreaterThan(0);

    // A copy already in play blocks the second via the game-scope duplication limit.
    const withCopy = addCardInPlay(base, HAZARD_PLAYER, EARTH_TREMORS);
    expect(viableActionsForHandCard(withCopy, PLAYER_2, 'play-hazard', HAZARD_PLAYER, EARTH_TREMORS)).toHaveLength(0);
  });
});

/**
 * @module dm-106.test
 *
 * Card test: Chill Douser (dm-106)
 * Type: hazard-creature (undead)
 *
 * Text:
 *   "Undead. Three strikes. Unless Chill Douser's attack is canceled, all
 *   other Undead attacks against the company for the rest of the turn
 *   receive +1 strike and +1 prowess."
 *
 * Base stats: strikes 3, prowess 8, body null, kill MP 1.
 * Keyed to ruins-and-lairs and shadow-hold site types ({R}{S}).
 *
 * Effects:
 * | # | Rule                                       | Status      | Notes                                         |
 * |---|---------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Keyed to ruins-and-lairs / shadow-hold      | IMPLEMENTED | siteTypes in keyedTo                          |
 * | 2 | Unless attack canceled, +1 strike/prowess   | IMPLEMENTED | on-event: attack-not-canceled → constraint    |
 * |   | to all other Undead attacks for the turn    |             | creature-attack-boost applied via resolver    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  BARROW_WIGHT, ORC_GUARD,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const CHILL_DOUSER = 'dm-106' as CardDefinitionId;

// ─── Shared state builder ────────────────────────────────────────────────────

function baseState(hazardHand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: hazardHand,
        siteDeck: [MORIA],
      },
    ],
  });
}

function withShadowHoldDest(state: ReturnType<typeof baseState>) {
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    }),
  };
}

function withRuinsAndLairsDest(state: ReturnType<typeof baseState>) {
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Bandit Lair',
    }),
  };
}

/**
 * Drive Chill Douser combat to completion with 3 characters (Aragorn, Legolas,
 * Gimli) each facing 1 strike. All rolls are cheated high (12) so every
 * character wins their strike. Returns the game state after combat ends.
 *
 * The engine requires a `choose-strike-order` step before each `resolve-strike`
 * when multiple strikes are assigned.
 */
function playAndResolveChill(state: ReturnType<typeof withShadowHoldDest>): ReturnType<typeof dispatch> {
  const chillId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);

  const afterPlay = dispatch(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: chillId,
    targetCompanyId: companyId,
    keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
  });
  const afterChain = resolveChain(afterPlay);

  // Combat begins in cancel-window — defender passes
  const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

  // Assign 1 strike to each of the 3 characters
  const aragornId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
  const legolasId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
  const gimliId   = charIdAt(afterPass, RESOURCE_PLAYER, 0, 2);

  const after1 = dispatch(afterPass, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
  const after2 = dispatch(after1,   { type: 'assign-strike', player: PLAYER_1, characterId: legolasId, tapped: false });
  const after3 = dispatch(after2,   { type: 'assign-strike', player: PLAYER_1, characterId: gimliId,   tapped: false });

  // Resolve all 3 strikes. The engine requires choose-strike-order before
  // each resolve-strike when multiple strikes are pending; when only one
  // remains the game may skip the choose step.
  function resolveNextStrike(s: ReturnType<typeof dispatch>): ReturnType<typeof dispatch> {
    let cur = s;
    // Optionally choose strike order when required
    const chooseActs = computeLegalActions(cur, PLAYER_1);
    const chooseAction = chooseActs.find(a => a.viable && a.action.type === 'choose-strike-order');
    if (chooseAction) cur = dispatch(cur, chooseAction.action);

    // Resolve the current strike with a high roll
    const withRoll = { ...cur, cheatRollTotal: 12 };
    const resolveActs = computeLegalActions(withRoll, PLAYER_1);
    const resolveAction = resolveActs.find(a => a.viable && a.action.type === 'resolve-strike');
    if (!resolveAction) return withRoll;
    return dispatch(withRoll, resolveAction.action);
  }

  return resolveNextStrike(resolveNextStrike(resolveNextStrike(after3)));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Chill Douser (dm-106)', () => {
  beforeEach(() => resetMint());

  // ── Keying ────────────────────────────────────────────────────────────────

  test('playable at ruins-and-lairs destination', () => {
    const state = withRuinsAndLairsDest(baseState([CHILL_DOUSER]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => a.action.type === 'play-hazard')).toBe(true);
  });

  test('playable at shadow-hold destination', () => {
    const state = withShadowHoldDest(baseState([CHILL_DOUSER]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => a.action.type === 'play-hazard')).toBe(true);
  });

  test('not playable at free-hold destination', () => {
    const state = {
      ...baseState([CHILL_DOUSER]),
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Pelargir',
      }),
    };
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ── Attack-not-canceled → creature-attack-boost constraint ────────────────

  test('resolving attack (not canceled) adds creature-attack-boost constraint', () => {
    const state = withShadowHoldDest(baseState([CHILL_DOUSER]));
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterCombat = playAndResolveChill(state);

    // Combat should be done
    expect(afterCombat.combat).toBeNull();

    // creature-attack-boost constraint must be present targeting this company
    const boost = afterCombat.activeConstraints.find(c => c.kind.type === 'creature-attack-boost');
    expect(boost).toBeDefined();
    expect(boost!.scope).toEqual({ kind: 'turn' });
    expect(boost!.target).toEqual({ kind: 'company', companyId });
    if (boost!.kind.type === 'creature-attack-boost') {
      expect(boost!.kind.race).toBe('undead');
      expect(boost!.kind.strikes).toBe(1);
      expect(boost!.kind.prowess).toBe(1);
    }
  });

  // ── Boost applies to subsequent undead attacks ─────────────────────────────

  test('subsequent undead attack gets +1 strike and +1 prowess', () => {
    // Set up state with a pre-existing creature-attack-boost constraint from
    // a prior Chill Douser attack. The constraint targets PLAYER_1's company.
    const raw = withShadowHoldDest(baseState([BARROW_WIGHT]));
    const companyId = companyIdAt(raw, RESOURCE_PLAYER);

    const stateWithConstraint = addConstraint(raw, {
      source: 'cd-instance-1' as CardInstanceId,
      sourceDefinitionId: CHILL_DOUSER,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'creature-attack-boost', race: 'undead', strikes: 1, prowess: 1 },
    });

    // Play Barrow-wight (undead, base prowess 12, 1 strike) against the company
    const barrowId = handCardId(stateWithConstraint, HAZARD_PLAYER);
    const afterPlay = dispatch(stateWithConstraint, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: barrowId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Combat state should show boosted stats: prowess 13 (12+1), strikes 2 (1+1)
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.strikesTotal).toBe(2);
  });

  // ── Boost does NOT apply to non-undead attacks ────────────────────────────

  test('non-undead attacks are not boosted', () => {
    // Same setup with constraint, but play an orc creature instead
    const raw = withShadowHoldDest(baseState([ORC_GUARD]));
    const companyId = companyIdAt(raw, RESOURCE_PLAYER);

    const stateWithConstraint = addConstraint(raw, {
      source: 'cd-instance-1' as CardInstanceId,
      sourceDefinitionId: CHILL_DOUSER,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'creature-attack-boost', race: 'undead', strikes: 1, prowess: 1 },
    });

    // Play Orc-guard (orc, base prowess 8, 5 strikes) — race !== undead
    const orcId = handCardId(stateWithConstraint, HAZARD_PLAYER);
    const afterPlay = dispatch(stateWithConstraint, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Combat stats must be unmodified: prowess 8, strikes 5 (no boost)
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.strikesTotal).toBe(5);
  });
});

/**
 * @module as-41.test
 *
 * Card test: Turning Hope to Despair (as-41)
 * Type: hazard-event (short), neutral, non-unique.
 *
 * Text:
 *   "Playable on a company facing a non-detainment attack from: Undead,
 *    Nazgûl, or Maia; does not count against the hazard limit. If the attack
 *    is not defeated, each character in the company makes a roll and adds
 *    his mind. If the result is less than 11, the character splits off from
 *    the company and forms his own company with the same site path as his
 *    original company. The character faces a separate movement/hazard phase
 *    this turn with a hazard limit of one."
 *
 * Card shape:
 *   - effects[0]: modify-attack (fromHand, player "attacker") carrying
 *     `postAttackMindRollSplit: { threshold: 11 }`, gated `when` on
 *     `attack.detainment: false` and `enemy.race $in [undead, ringwraith, maia]`.
 *     Applies no stat modifiers of its own — it only schedules the post-attack
 *     roll.
 *   - effects[1]: play-flag "no-hazard-limit".
 *
 * Engine support:
 *   - The offering reuses the existing from-hand `modify-attack` window
 *     (`legal-actions/combat.ts`) — same machinery as Unabated in Malice
 *     (ba-26) — gated by the effect's `when` and `no-hazard-limit`.
 *   - `handleModifyAttack` (combat-actions.ts) discards the card and, because
 *     `postAttackMindRollSplit` is set, stores `mindRollSplitPending` on
 *     `CombatState` (no stat changes are applied).
 *   - `finalizeCombat` (combat-finalize.ts): if the attack was NOT fully
 *     defeated, enqueues one `dice-check` (2d6 + mind vs. threshold 11,
 *     `gte`) per character still in the defending company, `onFail:
 *     "split-into-own-company"`.
 *   - `applyDiceCheckBranch` (pending-reducers.ts) resolves a failed roll via
 *     `splitCharacterOffCompany` (company-split.ts) — the generalized,
 *     auto-rejoining sibling of Left Behind (td-41)'s `applyLeftBehindSplit`:
 *     peels the character into his own new company sharing the same site
 *     path, flagged `forcedSoloHazardLimit` (NOT `leftBehind` — unlike Left
 *     Behind there is no explicit "may rejoin"; the split company merges
 *     back through the normal rule 2.IV.6 same-site auto-merge once its own
 *     separate M/H phase ends). A lone character instead flags his own
 *     company `forcedSoloExtraPhasePending`.
 *   - `enterSetHazardLimitAndAutoAdvance` (mh-steps.ts) forces a
 *     `forcedSoloHazardLimit` company's hazard-limit snapshot to 1, clearing
 *     the flag once consumed. `advanceAfterCompanyMH` re-runs a
 *     `forcedSoloExtraPhasePending` lone company once.
 *
 * Rule coverage:
 * | #  | Rule                                                                | Status      |
 * |----|----------------------------------------------------------------------|-------------|
 * | 1  | Offered to the attacker vs a non-detainment Undead/Nazgûl/Maia attack| IMPLEMENTED |
 * | 2  | NOT offered vs a detainment attack                                   | IMPLEMENTED |
 * | 3  | NOT offered vs a non-matching race (e.g. Orc)                        | IMPLEMENTED |
 * | 4  | NOT offered to the defending (resource) player                       | IMPLEMENTED |
 * | 5  | Does not count against the hazard limit                              | IMPLEMENTED |
 * | 6  | Playing schedules the post-attack roll; card discarded, no HL charge | IMPLEMENTED |
 * | 7  | Attack IS defeated → no mind rolls are enqueued                      | IMPLEMENTED |
 * | 8  | Attack NOT defeated → every character in the company gets a roll     | IMPLEMENTED |
 * | 9  | Roll total < 11 → character splits into his own company (site path)  | IMPLEMENTED |
 * | 10 | Roll total ≥ 11 → character stays in the company                     | IMPLEMENTED |
 * | 11 | A lone character is flagged for a separate extra M/H phase instead   | IMPLEMENTED |
 * | 12 | The split company's own M/H phase forces a hazard limit of one       | IMPLEMENTED |
 * | 13 | The split company auto-merges with its origin (no explicit rejoin)   | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  BILBO, LEGOLAS, ARAGORN,
  MORIA, LORIEN,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, reduce,
  findCharInstanceId, companyIdAt,
} from '../test-helpers.js';
import { Phase, Race } from '../../index.js';
import { makeCancelWindowCombat } from '../test-helpers-builders.js';
import { autoMergeNonHavenCompanies } from '../../engine/reducer-utils.js';
import type {
  GameState, CardDefinitionId, CardInstanceId,
  MovementHazardPhaseState, ModifyAttackAction,
} from '../../index.js';

const TURNING_HOPE = 'as-41' as CardDefinitionId;

/** Base two-player MH state: PLAYER_1 defends with the given characters, PLAYER_2 (hazard) holds `hand`. */
function baseState(characters: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [LORIEN] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand, siteDeck: [MORIA] },
    ],
  });
}

describe('Turning Hope to Despair (as-41)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate ───────────────────────────────────────────────────

  test.each([Race.Undead, Race.Ringwraith, Race.Maia])(
    'offered to the attacker vs a non-detainment %s attack',
    (race) => {
      const base = baseState([BILBO, LEGOLAS], [TURNING_HOPE]);
      const combat = makeCancelWindowCombat(base, {
        attackSourceType: 'automatic-attack',
        creatureRace: race,
        strikesTotal: 1,
        strikeProwess: 20,
      });
      const actions = viableActions(combat, PLAYER_2, 'modify-attack');
      expect(actions).toHaveLength(1);
      expect((actions[0].action as ModifyAttackAction).player).toBe(PLAYER_2);
    },
  );

  test('NOT offered vs a detainment attack', () => {
    const base = baseState([BILBO, LEGOLAS], [TURNING_HOPE]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    const combat: GameState = { ...combat0, combat: { ...combat0.combat!, detainment: true } };
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('NOT offered vs a non-matching race (Orc)', () => {
    const base = baseState([BILBO, LEGOLAS], [TURNING_HOPE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('NOT offered to the defending (resource) player', () => {
    // Turning Hope to Despair in the RESOURCE (defending) player's hand.
    const base = baseState([BILBO, LEGOLAS], []);
    const withResourceHand: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], hand: [{ instanceId: 'x' as CardInstanceId, definitionId: TURNING_HOPE }] },
        base.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const combat = makeCancelWindowCombat(withResourceHand, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('does not count against the hazard limit (offered even at cap)', () => {
    const base = baseState([BILBO, LEGOLAS], [TURNING_HOPE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    const atCap: GameState = {
      ...combat,
      phaseState: {
        ...(combat.phaseState as MovementHazardPhaseState),
        hazardsPlayedThisCompany: 5,
        hazardLimitAtReveal: 2,
      },
    };
    expect(viableActions(atCap, PLAYER_2, 'modify-attack')).toHaveLength(1);
  });

  // ─── Playing the card ───────────────────────────────────────────────────

  test('playing it schedules the post-attack mind-roll split and discards the card without charging the hazard limit', () => {
    const base = baseState([BILBO, LEGOLAS], [TURNING_HOPE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.mindRollSplitPending).toEqual({ threshold: 11 });
    // No stat changes — the card only schedules the roll.
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(20);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === TURNING_HOPE)).toBe(true);
    // no-hazard-limit: the play does not charge the hazard limit.
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany ?? 0).toBe(0);
  });

  /**
   * Drive a full combat: play Turning Hope to Despair (if in hand), assign
   * the single strike to Bilbo, and resolve it with `strikeRoll` against
   * `strikeProwess`. A wounded (not parried) strike triggers a further body
   * check against Bilbo's own body (9) — resolved with a low `bodyCheckRoll`
   * so he survives (stays wounded, not eliminated) unless overridden.
   * Returns the post-finalize state.
   */
  function playAndResolveStrike(
    hand: CardDefinitionId[],
    strikeRoll: number,
    strikeProwess: number,
    bodyCheckRoll = 2,
  ): GameState {
    const base = baseState([BILBO, LEGOLAS], hand);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess,
    });
    let s = combat;
    if (hand.includes(TURNING_HOPE)) {
      const action = viableActions(s, PLAYER_2, 'modify-attack')[0].action;
      s = dispatch(s, action);
    }
    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId, tapped: false });
    s = { ...s, cheatRollTotal: strikeRoll };
    const resolveAction = viableActions(s, PLAYER_1, 'resolve-strike')[0].action;
    s = dispatch(s, resolveAction);
    // A wound triggers a body check against Bilbo's own body (9).
    if (s.combat?.phase === 'body-check') {
      s = { ...s, cheatRollTotal: bodyCheckRoll };
      const bodyAction = viableActions(s, PLAYER_1, 'body-check-roll')[0]?.action
        ?? viableActions(s, PLAYER_2, 'body-check-roll')[0]?.action;
      s = dispatch(s, bodyAction);
    }
    return s;
  }

  test('attack IS defeated → no mind rolls are enqueued', () => {
    // Bilbo prowess 1 + roll 12 = 13 > creature prowess 3 → strike parried.
    // The automatic-attack has no body (null), so it is auto-defeated with
    // no further body check (CoE 3.iv.7).
    const s = playAndResolveStrike([TURNING_HOPE], 12, 3);
    expect(s.combat ?? null).toBeNull();
    expect(s.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(1);
  });

  test('attack NOT defeated → every character in the company gets a mind-roll dice-check', () => {
    // Bilbo prowess 1 + roll 2 = 3 ≤ creature prowess 20 → strike wounds Bilbo.
    const s = playAndResolveStrike([TURNING_HOPE], 2, 20);
    expect(s.combat ?? null).toBeNull();

    const rolls = s.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    // One roll per company member — Bilbo (wounded) AND Legolas (untouched).
    expect(rolls).toHaveLength(2);
    for (const r of rolls) {
      if (r.kind.type !== 'dice-check') continue;
      expect(r.kind.threshold).toBe(11);
      expect(r.kind.comparison).toBe('gte');
      expect(r.kind.onFail).toEqual({ type: 'split-into-own-company' });
      expect(r.actor).toBe(PLAYER_1);
    }
    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
    const bilboRoll = rolls.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === bilboId);
    const legolasRoll = rolls.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === legolasId);
    expect(bilboRoll).toBeDefined();
    expect(legolasRoll).toBeDefined();
    // Bilbo mind 5, Legolas mind 6.
    expect(bilboRoll!.kind.type === 'dice-check' && bilboRoll!.kind.modifiers).toEqual([{ kind: 'constant', value: 5 }]);
    expect(legolasRoll!.kind.type === 'dice-check' && legolasRoll!.kind.modifiers).toEqual([{ kind: 'constant', value: 6 }]);
  });

  // ─── Resolving the roll ─────────────────────────────────────────────────

  test('a character who rolls below 11 splits off into his own company sharing the site path', () => {
    const s = playAndResolveStrike([TURNING_HOPE], 2, 20);
    const originCompanyId = companyIdAt(s, RESOURCE_PLAYER);
    const originCompany = s.players[RESOURCE_PLAYER].companies[0];
    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);

    // Bilbo mind 5: roll 2 → total 7 < 11 → fails, splits off.
    const resolved = reduce(
      { ...s, cheatRollTotal: 2 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    const companies = after.players[RESOURCE_PLAYER].companies;
    expect(companies).toHaveLength(2);
    const origin = companies.find(c => c.id === originCompanyId)!;
    const split = companies.find(c => c.id !== originCompanyId)!;
    expect(origin.characters).not.toContain(bilboId);
    expect(split.characters).toEqual([bilboId]);

    // Flagged for a forced solo hazard limit, NOT `leftBehind` (no explicit rejoin).
    expect(split.forcedSoloHazardLimit).toBe(true);
    expect(split.leftBehind).toBeUndefined();
    expect(split.currentSite?.instanceId).toBe(originCompany.currentSite?.instanceId);
    expect(split.destinationSite?.instanceId ?? null).toBe(originCompany.destinationSite?.instanceId ?? null);
    // No instance lost.
    expect(after.players[RESOURCE_PLAYER].characters[bilboId]).toBeDefined();
  });

  test('a character who rolls at least 11 stays in the company', () => {
    const s = playAndResolveStrike([TURNING_HOPE], 2, 20);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    // Legolas mind 6: roll 12 → total 18 ≥ 11 → passes, stays.
    const resolved = reduce(
      { ...s, cheatRollTotal: 12 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    expect(after.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(legolasId);
  });

  test('a lone character who fails is flagged for a separate extra M/H phase instead of a new company', () => {
    const base = baseState([BILBO], [TURNING_HOPE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 20,
    });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    let s = dispatch(combat, action);
    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId, tapped: false });
    s = { ...s, cheatRollTotal: 2 };
    const resolveAction = viableActions(s, PLAYER_1, 'resolve-strike')[0].action;
    s = dispatch(s, resolveAction);
    if (s.combat?.phase === 'body-check') {
      // Low roll: Bilbo survives the wound (stays in play, not eliminated).
      s = { ...s, cheatRollTotal: 2 };
      const bodyAction = viableActions(s, PLAYER_1, 'body-check-roll')[0]?.action
        ?? viableActions(s, PLAYER_2, 'body-check-roll')[0]?.action;
      s = dispatch(s, bodyAction);
    }
    expect(s.combat ?? null).toBeNull();

    const resolved = reduce(
      { ...s, cheatRollTotal: 2 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    const companies = after.players[RESOURCE_PLAYER].companies;
    expect(companies).toHaveLength(1);
    expect(companies[0].characters).toEqual([bilboId]);
    expect(companies[0].forcedSoloHazardLimit).toBe(true);
    expect(companies[0].forcedSoloExtraPhasePending).toBe(true);
    expect(companies[0].leftBehind).toBeUndefined();
  });

  // ─── Separate M/H phase, hazard limit one ──────────────────────────────

  test("the split company's own M/H phase forces a hazard limit of one", () => {
    const base = baseState([BILBO, LEGOLAS], []);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Control: a normal 2-character company snapshots a hazard limit of 2.
    const normal: GameState = { ...base, phaseState: makeMHState({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }) };
    let sn = dispatch(normal, { type: 'select-company', player: PLAYER_1, companyId });
    sn = dispatch(sn, { type: 'pass', player: PLAYER_1 });
    expect((sn.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(2);

    // Flagged company: forced to a limit of 1.
    const flagged: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: base.players[0].companies.map(c => ({ ...c, forcedSoloHazardLimit: true })) },
        base.players[1],
      ] as GameState['players'],
      phaseState: makeMHState({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }),
    };
    let sf = dispatch(flagged, { type: 'select-company', player: PLAYER_1, companyId });
    sf = dispatch(sf, { type: 'pass', player: PLAYER_1 });
    expect((sf.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(1);
    // The one-time flag is consumed (cleared) once used.
    expect(sf.players[RESOURCE_PLAYER].companies[0].forcedSoloHazardLimit).toBeFalsy();
  });

  // ─── Auto-merge (no explicit "may rejoin", unlike Left Behind) ─────────

  test('the split company auto-merges with its origin once co-located — no explicit rejoin offer', () => {
    const base = baseState([ARAGORN, LEGOLAS], []);
    const originCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const originCompany = base.players[RESOURCE_PLAYER].companies[0];
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);

    // Simulate the post-split layout directly: two companies at the same
    // non-Haven site, the split one carrying only `forcedSoloHazardLimit`
    // (its own M/H phase already completed and cleared the flag).
    const splitCompany = {
      id: 'split-co' as unknown as GameState['players'][number]['companies'][number]['id'],
      characters: [legolasId],
      currentSite: originCompany.currentSite,
      siteCardOwned: false,
      destinationSite: originCompany.destinationSite,
      movementPath: originCompany.movementPath,
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
      hazards: [],
    };
    const withSplit: GameState = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [
            { ...originCompany, characters: originCompany.characters.filter(c => c !== legolasId) },
            splitCompany,
          ],
        },
        base.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    const merged = autoMergeNonHavenCompanies(withSplit, RESOURCE_PLAYER);
    expect(merged.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    const mergedCompany = merged.players[RESOURCE_PLAYER].companies[0];
    expect(mergedCompany.id).toBe(originCompanyId);
    expect(mergedCompany.characters).toContain(legolasId);
  });
});

/**
 * @module tw-194.test
 *
 * Card test: Ash Mountains (tw-194)
 * Type: hero-resource-event (short). 0 MP. Non-unique.
 *
 * Text:
 *   "Playable at the end of the organization phase on a company containing a
 *    ranger. If the company uses region cards for its site path, tap the
 *    ranger to move as if the following pairs of regions were adjacent:
 *    Dagorlad and Gorgoroth, Horse Plains and Gorgoroth. The company faces an
 *    attack at the beginning of its movement/hazard phase: Orcs — 4 strikes
 *    with 8 prowess. Alternatively, if the site moved to is in one of the
 *    regions listed above, the hazard limit is reduced by 2 (to a minimum of
 *    2). Cannot be duplicated on a given company."
 *
 * Effects:
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.skills: { $includes: "ranger" } }
 *   3. on-event self-enters-play → add-constraint `region-shortcut`, scope:turn,
 *      target:target-company, pairs:[[Dagorlad,Gorgoroth],[Horse Plains,Gorgoroth]],
 *      requiredSkill:ranger, attack:{race:orc,strikes:4,prowess:8}, hazardLimitReduction:{value:-2,floor:2}
 *   4. duplication-limit scope:company, max:1
 *
 * `region-shortcut` is a new, reusable constraint kind (see
 * `docs/certification-engine-support.md`) shared by an entire family of
 * uncertified "movement enhancer" cards (tw-191 Anduin River, tw-287
 * Mountains of Shadow, as-78/as-92/as-93). While bound to a company:
 *  - `legal-actions/movement-hazard.ts` (`companyRegionShortcutPairs`,
 *    `withVirtualAdjacency`) widens region-movement `declare-path`
 *    enumeration with the constraint's named pairs as extra graph edges, but
 *    only while the company still has an untapped character carrying
 *    `requiredSkill`.
 *  - If the resolved path actually crosses one of those pairs,
 *    `handleRevealNewSite` (mh-steps.ts, `checkRegionShortcutUsage`) taps
 *    that character, removes the constraint, and injects the printed attack
 *    as a `region-shortcut-attack` combat via a new `region-shortcut-attack`
 *    M/H step, resuming at `set-hazard-limit` once it resolves.
 *  - Otherwise the constraint survives to `snapshotHazardLimit`
 *    (mh-steps.ts), which applies the printed "alternatively" hazard-limit
 *    reduction if the company's resolved destination region is one of the
 *    constraint's named regions. The two payoffs cannot both fire for the
 *    same move: firing the attack removes the constraint first.
 *
 * CRF 22 ("Ash Mountains"): "The «otherwise» on this card should be read as
 * «alternatively»" — the printed text (and this card's `text` field) already
 * uses the corrected wording. CRF 22 also independently confirms Ash
 * Mountains as a genuine movement enhancer for reaching Gorgoroth by region
 * movement, alongside Eagle-mounts.
 *
 * Engine Support:
 * | # | Rule (card text)                                              | Status      | Mechanism                                                     |
 * |---|----------------------------------------------------------------|-------------|-----------------------------------------------------------------|
 * | 1 | Playable at the end of the organization phase                  | IMPLEMENTED | play-window phase:organization step:end-of-org                  |
 * | 2 | on a company containing a ranger                                | IMPLEMENTED | play-target company filter { company.skills: $includes ranger } |
 * | 3 | tap the ranger to move as if the pairs were adjacent            | IMPLEMENTED | region-shortcut constraint + withVirtualAdjacency + tap cost     |
 * | 4 | company faces an attack at the beginning of its M/H phase       | IMPLEMENTED | region-shortcut-attack combat, injected before set-hazard-limit  |
 * | 5 | alternatively, hazard limit -2 (min 2) if site moved to matches | IMPLEMENTED | snapshotHazardLimit region-shortcut named-region block           |
 * | 6 | Cannot be duplicated on a given company                        | IMPLEMENTED | duplication-limit scope:company                                  |
 *
 * Playable: YES
 * Certified: 2026-08-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch, reduce, Phase,
  makeMHState, viableActions,
  companyIdAt, findHandCardId, findCharInstanceId, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import {
  Alignment, RegionType, Race, Skill, CardStatus, ARAGORN, LEGOLAS, GIMLI, FRODO, MOUNT_DOOM, LORIEN,
  computeLegalActions,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayShortEventAction, DeclarePathAction,
} from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';
import { snapshotHazardLimit } from '../../engine/mh-steps.js';

const ASH_MOUNTAINS = 'tw-194' as CardDefinitionId;

// Hero site used to exercise region movement toward Gorgoroth.
const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;   // region: Horse Plains
// MOUNT_DOOM (tw-414) is region: Gorgoroth.

// Region card definition IDs (tw-regions.json).
const NURN = 'tw-478' as CardDefinitionId;
const GORGOROTH = 'tw-460' as CardDefinitionId;
const HORSE_PLAINS = 'tw-467' as CardDefinitionId;

/** Organization-phase state: a hero company at Easterling Camp with the given characters. */
function orgState(characters: readonly CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: EASTERLING_CAMP, characters: [...characters] }],
        hand: [ASH_MOUNTAINS],
        siteDeck: [],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
}

/** Play Ash Mountains on the given company during the organization phase. */
function playOn(state: GameState, companyId: ReturnType<typeof companyIdAt>): GameState {
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, ASH_MOUNTAINS),
    targetCompanyId: companyId,
  });
}

describe('Ash Mountains (tw-194)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1 & 2: end-of-org, company containing a ranger ──────────────────

  test('playable at the end of the organization phase on a company containing a ranger', () => {
    const base = orgState([ARAGORN]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ASH_MOUNTAINS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable on a company with no ranger', () => {
    const base = orgState([LEGOLAS]); // Scout, not a ranger
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ASH_MOUNTAINS);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('the organization-phase play window is enforced — not playable during the M/H phase', () => {
    const base = orgState([ARAGORN]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ASH_MOUNTAINS);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const plays = viableActions(inMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 3: playing installs the region-shortcut constraint ──────────────

  test('playing it installs the region-shortcut constraint on the company', () => {
    const base = orgState([ARAGORN]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ASH_MOUNTAINS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playOn(base, companyId);

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({
      type: 'region-shortcut',
      pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
      requiredSkill: Skill.Ranger,
      attack: { race: Race.Orc, strikes: 4, prowess: 8 },
      hazardLimitReduction: { value: -2, floor: 2 },
    });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    expect(next.players[0].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(next.players[0].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  test('cannot be duplicated on the same company — a company already bearing the constraint is excluded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [
            { site: EASTERLING_CAMP, characters: [ARAGORN] },
            { site: LORIEN, characters: [{ defId: ARAGORN, status: CardStatus.Untapped }] },
          ],
          hand: [ASH_MOUNTAINS],
          siteDeck: [],
          playDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const [companyA, companyB] = state.players[0].companies;
    const cardId = findHandCardId(state, RESOURCE_PLAYER, ASH_MOUNTAINS);

    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: companyA.id },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        attack: { race: Race.Orc, strikes: 4, prowess: 8 },
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });

    const plays = viableActions(constrained, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyB.id);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = orgState([ARAGORN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const played = playOn(base, companyId);
    expect(played.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(played, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });

  // ─── Rule 3: virtual adjacency widens declare-path region enumeration ─────

  /** M/H state: P1 company at `origin` (characters given) moving to `destination`. */
  function mhRevealState(
    origin: CardDefinitionId,
    destination: CardDefinitionId,
    characters: readonly (CardDefinitionId | { defId: CardDefinitionId; status: CardStatus })[],
  ): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: origin, characters: [...characters], destinationSite: destination }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return { ...state, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
  }

  function regionDeclarePaths(state: GameState): DeclarePathAction[] {
    return computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'declare-path')
      .map(a => a.action as DeclarePathAction)
      .filter(a => a.movementType === 'region');
  }

  test('without the constraint, only the real (3-region) path via Nurn is offered from Horse Plains to Gorgoroth', () => {
    const state = mhRevealState(EASTERLING_CAMP, MOUNT_DOOM, [ARAGORN]);
    const paths = regionDeclarePaths(state);
    expect(paths.every(p => p.regionPath!.length >= 3)).toBe(true);
    expect(paths.some(p => p.regionPath!.length === 2)).toBe(false);
  });

  test('with the constraint bound and an untapped ranger, a direct 2-region shortcut path is also offered', () => {
    const state = mhRevealState(EASTERLING_CAMP, MOUNT_DOOM, [ARAGORN]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        attack: { race: Race.Orc, strikes: 4, prowess: 8 },
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });

    const paths = regionDeclarePaths(constrained);
    const shortcut = paths.find(p => p.regionPath!.length === 2);
    expect(shortcut).toBeDefined();
    expect(shortcut!.regionPath).toEqual([HORSE_PLAINS, GORGOROTH]);
  });

  test('the shortcut path is NOT offered once the ranger is already tapped', () => {
    const state = mhRevealState(EASTERLING_CAMP, MOUNT_DOOM, [{ defId: ARAGORN, status: CardStatus.Tapped }]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        attack: { race: Race.Orc, strikes: 4, prowess: 8 },
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });

    const paths = regionDeclarePaths(constrained);
    expect(paths.some(p => p.regionPath!.length === 2)).toBe(false);
  });

  // ─── Rule 3 & 4: using the shortcut taps the ranger and injects the attack ─

  test('declaring the shortcut path taps the ranger, consumes the constraint, and injects the forced Orc attack', () => {
    const state = mhRevealState(EASTERLING_CAMP, MOUNT_DOOM, [ARAGORN]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const rangerInstanceId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        attack: { race: Race.Orc, strikes: 4, prowess: 8 },
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });

    const next = dispatch(constrained, {
      type: 'declare-path', player: PLAYER_1, movementType: 'region' as never, regionPath: [HORSE_PLAINS, GORGOROTH],
    });

    // Ranger tapped.
    expect(next.players[0].characters[rangerInstanceId].status).toBe(CardStatus.Tapped);
    // Constraint consumed.
    expect(next.activeConstraints).toHaveLength(0);
    // Forced attack injected.
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(8);
    expect(next.combat!.creatureRace).toBe(Race.Orc);
    expect(next.combat!.attackSource.type).toBe('region-shortcut-attack');
    expect((next.phaseState as MovementHazardPhaseState).step).toBe('region-shortcut-attack');

    // Once combat resolves (state.combat cleared), a pass continues straight
    // through to the hazard-limit snapshot — no further region-shortcut
    // reduction applies since the constraint was already consumed.
    const resolved: GameState = { ...next, combat: null };
    const after = reduce(resolved, { type: 'pass', player: PLAYER_1 });
    expect(after.error).toBeUndefined();
    expect((after.state.phaseState as MovementHazardPhaseState).step).not.toBe('region-shortcut-attack');
  });

  test('declaring a non-shortcut path leaves the constraint intact and injects no attack', () => {
    const state = mhRevealState(EASTERLING_CAMP, MOUNT_DOOM, [ARAGORN, LEGOLAS, GIMLI, FRODO]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        attack: { race: Race.Orc, strikes: 4, prowess: 8 },
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });
    // The other 3-region path (via Dagorlad) also crosses a virtual pair —
    // pick the real Nurn route specifically, which crosses none.
    const paths = regionDeclarePaths(constrained);
    const nurnPath = paths.find(p => p.regionPath!.includes(NURN))!;
    expect(nurnPath).toBeDefined();

    const next = dispatch(constrained, nurnPath);
    expect(next.combat).toBeNull();
    expect(next.activeConstraints).toHaveLength(1);
  });

  // ─── Rule 5: "alternatively" hazard-limit reduction ────────────────────────

  test('hazard limit is reduced by 2 when the destination region matches and the shortcut was not used', () => {
    // Company of 4 → base limit 4. Destination region "Gorgoroth" matches
    // Ash Mountains' named pairs, so the printed -2 (floor 2) applies: 4 → 2.
    const characters = [ARAGORN, LEGOLAS, GIMLI, FRODO];
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        // Destination is Lórien (no site-rule of its own) — `resolvedSitePathNames`
        // is passed explicitly below, decoupled from the actual destination site,
        // so this isolates the region-shortcut hazard-limit block from Mount
        // Doom's unrelated "+2 hazard limit" site-rule.
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters, destinationSite: LORIEN }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });
    const limit = snapshotHazardLimit(
      constrained, constrained.players[0].companies[0],
      ['Horse Plains', 'Nurn', 'Gorgoroth'], [RegionType.Shadow, RegionType.Dark, RegionType.Dark],
    ).limit;
    expect(limit).toBe(2);
  });

  test('no hazard-limit reduction when the destination region does not match', () => {
    const characters = [ARAGORN, LEGOLAS, GIMLI, FRODO];
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters, destinationSite: LORIEN }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ASH_MOUNTAINS,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'region-shortcut',
        pairs: [['Dagorlad', 'Gorgoroth'], ['Horse Plains', 'Gorgoroth']],
        requiredSkill: Skill.Ranger,
        hazardLimitReduction: { value: -2, floor: 2 },
      },
    });
    const limit = snapshotHazardLimit(constrained, constrained.players[0].companies[0], ['Lórien'], [RegionType.Free]).limit;
    expect(limit).toBe(4); // base limit unaffected by the non-matching region-shortcut constraint
  });
});

/**
 * @module wh-55.test — Deep Mines (Fallen-wizard site)
 *
 * Deep Mines is a Fallen-wizard Ruins & Lairs site that behaves like a personal
 * Under-deeps destination hanging off one of the player's protected
 * Wizardhavens.
 *
 * Card text:
 *   "A company may move to this site only from one of your protected
 *   Wizardhavens [{H}] and only if you have more than 6 stage points. The
 *   protected Wizardhaven is the surface site for Deep Mines (i.e., the sites
 *   are adjacent and the movement roll required to move between them is 0). You
 *   receive the three stage points if any of your companies are at the site.
 *   May be duplicated in location deck. Cannot be duplicated on a given
 *   Wizardhaven."
 *
 * Modeling (see `packages/shared/docs/card-effects-dsl.md`):
 *   - `{ site-rule, deep-mines-movement }` marks the site as reachable only via
 *     the roll-0 descent pass from a protected Wizardhaven (`isHavenForPlayer` +
 *     an active `site-protected` constraint owned by the mover) while the mover
 *     has more than six stage points. The gate is checked at both the
 *     plan-movement offer and the M/H declare-path (reveal) offer, so a
 *     stage-point drop between phases leaves the company put (rule 5.04 / CRF).
 *     The adjacency runs both ways, so a company at Deep Mines may ascend back
 *     to a protected Wizardhaven at roll 0 (no stage-point gate on the ascent).
 *   - `{ stage-points, value: 3, whileCompanyAtSite: true }` grants the three
 *     stage points while any of the player's companies occupies the site
 *     (summed once per distinct occupied site instance, Fallen-wizard only).
 *   - "May be duplicated in location deck" is a deck-construction allowance
 *     (non-unique sites already allow up to three copies) — no runtime code.
 *   - "Cannot be duplicated on a given Wizardhaven" is enforced by rule 2.II.7.1
 *     (two companies sharing an origin may not both declare movement to the same
 *     site definition), which blocks a second Deep Mines descent from the same
 *     Wizardhaven.
 *
 * | # | Rule                                                     | Status |
 * |---|----------------------------------------------------------|--------|
 * | 1 | descend only from a protected Wizardhaven                | OK     |
 * | 2 | …and only with more than six stage points                | OK     |
 * | 3 | roll-0 (Under-deeps) adjacency, both ways                | OK     |
 * | 4 | never reachable via ordinary movement                    | OK     |
 * | 5 | +3 stage points while a company occupies it              | OK     |
 * | 6 | cannot be duplicated on a given Wizardhaven (2.II.7.1)   | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, computeLegalActions, reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, ConstraintId, GameState, PlayerId } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import {
  buildTestState, resetMint, makeMHState, Phase,
  PLAYER_1, PLAYER_2, RIVENDELL,
} from '../test-helpers.js';

const DEEP_MINES = 'wh-55' as CardDefinitionId;
const ISENGARD_WH = 'wh-56' as CardDefinitionId;     // Fallen-wizard Wizardhaven
const SARUMAN_FW = 'wh-9' as CardDefinitionId;        // Fallen-wizard avatar (company character)

/** A `site-protected` constraint owned by `owner`, bound to `siteDefId`. */
function siteProtectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `protected-${siteDefId as string}` as ConstraintId,
    source: 'protected-src' as CardInstanceId,
    sourceDefinitionId: 'wh-68' as CardDefinitionId,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
}

/** Organization-phase state with `nCompanies` P1 companies at `origin`. */
function orgState(opts: {
  origin: CardDefinitionId;
  alignment?: Alignment;
  stagePoints?: number;
  siteDeck?: CardDefinitionId[];
  protectedSites?: CardDefinitionId[];
  companies?: number;
}): GameState {
  const nCompanies = opts.companies ?? 1;
  const p1Companies = Array.from({ length: nCompanies }, () => ({ site: opts.origin, characters: [SARUMAN_FW] }));
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: opts.alignment ?? Alignment.FallenWizard, companies: p1Companies, hand: [], siteDeck: opts.siteDeck ?? [DEEP_MINES], stagePoints: opts.stagePoints ?? 7 },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const constraints = (opts.protectedSites ?? []).map(s => siteProtectedConstraint(PLAYER_1, s));
  return constraints.length > 0 ? { ...state, activeConstraints: constraints } : state;
}

/** Definition IDs of the sites a player's plan-movement actions target. */
function planDests(state: GameState, player: PlayerId = PLAYER_1): (string | undefined)[] {
  return computeLegalActions(state, player)
    .filter(ea => ea.viable && ea.action.type === 'plan-movement')
    .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string | undefined);
}

describe('Deep Mines (wh-55)', () => {
  beforeEach(() => resetMint());

  // --- Descent gate ---------------------------------------------------------

  test('descent offered from a protected Wizardhaven with more than 6 stage points', () => {
    const s = orgState({ origin: ISENGARD_WH, stagePoints: 7, protectedSites: [ISENGARD_WH] });
    expect(planDests(s)).toContain(DEEP_MINES as string);
  });

  test('descent not offered with exactly 6 stage points', () => {
    const s = orgState({ origin: ISENGARD_WH, stagePoints: 6, protectedSites: [ISENGARD_WH] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  test('descent not offered from an unprotected Wizardhaven', () => {
    const s = orgState({ origin: ISENGARD_WH, stagePoints: 7, protectedSites: [] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  test('descent not offered from a protected site that is not a Wizardhaven for the player', () => {
    // Rivendell is a Haven, but not a Fallen-wizard Wizardhaven.
    const s = orgState({ origin: RIVENDELL, stagePoints: 7, protectedSites: [RIVENDELL] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  test('a non-Fallen-wizard is never offered the Deep Mines descent', () => {
    const s = orgState({ origin: ISENGARD_WH, alignment: Alignment.Wizard, stagePoints: 7, protectedSites: [ISENGARD_WH] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  // --- Ascent (roll-0 adjacency runs both ways) -----------------------------

  test('a company at Deep Mines may ascend to a protected Wizardhaven (no stage-point gate)', () => {
    const s = orgState({ origin: DEEP_MINES, stagePoints: 0, siteDeck: [ISENGARD_WH], protectedSites: [ISENGARD_WH] });
    expect(planDests(s)).toContain(ISENGARD_WH as string);
  });

  test('a company at Deep Mines may not ascend to an unprotected Wizardhaven', () => {
    const s = orgState({ origin: DEEP_MINES, stagePoints: 0, siteDeck: [ISENGARD_WH], protectedSites: [] });
    expect(planDests(s)).not.toContain(ISENGARD_WH as string);
  });

  // --- Cannot be duplicated on a given Wizardhaven (rule 2.II.7.1) -----------

  test('two companies at the same Wizardhaven cannot both descend to Deep Mines', () => {
    const s0 = orgState({ origin: ISENGARD_WH, stagePoints: 7, protectedSites: [ISENGARD_WH], companies: 2 });
    const c0 = s0.players[0].companies[0].id;
    const c1 = s0.players[0].companies[1].id;

    // Both companies are initially offered the descent.
    const initial = computeLegalActions(s0, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'plan-movement'
        && resolveInstanceId(s0, (ea.action as { destinationSite: CardInstanceId }).destinationSite) === DEEP_MINES,
    );
    expect(initial.map(ea => (ea.action as { companyId: string }).companyId).sort()).toEqual([c0, c1].sort());

    // Commit the first company's descent, then the second is no longer offered.
    const first = initial.find(ea => (ea.action as { companyId: string }).companyId === c0)!;
    const res = reduce(s0, first.action);
    expect(res.error).toBeUndefined();

    const c1Dests = computeLegalActions(res.state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'plan-movement' && (ea.action as { companyId: string }).companyId === c1)
      .map(ea => resolveInstanceId(res.state, (ea.action as { destinationSite: CardInstanceId }).destinationSite));
    expect(c1Dests).not.toContain(DEEP_MINES as string);
  });

  // --- Reveal-time (declare-path) gate --------------------------------------

  function revealState(stagePoints: number): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [SARUMAN_FW], destinationSite: DEEP_MINES }], hand: [], siteDeck: [DEEP_MINES], stagePoints },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    return {
      ...base,
      activeConstraints: [siteProtectedConstraint(PLAYER_1, ISENGARD_WH)],
      phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }),
    };
  }

  test('reveal offers a roll-0 Under-deeps descent path when the requirement still holds', () => {
    const declares = computeLegalActions(revealState(7), PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'declare-path');
    expect(declares.length).toBeGreaterThan(0);
    expect(declares.every(ea => (ea.action as { movementType: string }).movementType === 'under-deeps')).toBe(true);
  });

  test('reveal offers no descent path once stage points drop to 6 — the company stays put', () => {
    const legal = computeLegalActions(revealState(6), PLAYER_1).filter(ea => ea.viable);
    expect(legal.filter(ea => ea.action.type === 'declare-path')).toHaveLength(0);
    // Regression (deadlock): the Deep Mines branch returned an empty action
    // list, skipping the rule-5.04 fallback — the reveal-new-site step had no
    // legal action at all. A pass must be offered to negate the movement.
    expect(legal.some(ea => ea.action.type === 'pass')).toBe(true);
  });

  // --- Stage points from occupancy ------------------------------------------

  function occupancyState(opts: {
    alignment?: Alignment;
    sites: CardDefinitionId[]; // one company per site
  }): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: opts.alignment ?? Alignment.FallenWizard, companies: opts.sites.map(site => ({ site, characters: [SARUMAN_FW] })), hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  }

  test('a Fallen-wizard receives 3 stage points while a company occupies Deep Mines', () => {
    const s = occupancyState({ sites: [DEEP_MINES] });
    expect(s.players[0].stagePoints).toBe(3);
  });

  test('no Deep Mines stage points when no company occupies it', () => {
    const s = occupancyState({ sites: [ISENGARD_WH] });
    expect(s.players[0].stagePoints).toBe(0);
  });

  test('a non-Fallen-wizard occupying Deep Mines accrues no stage points', () => {
    const s = occupancyState({ alignment: Alignment.Wizard, sites: [DEEP_MINES] });
    expect(s.players[0].stagePoints).toBe(0);
  });

  test('two separately-occupied Deep Mines each grant their own 3 stage points', () => {
    const s = occupancyState({ sites: [DEEP_MINES, DEEP_MINES] });
    expect(s.players[0].stagePoints).toBe(6);
  });
});

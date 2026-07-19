/**
 * @module wh-57.test — Rhosgobel (Fallen-wizard site)
 *
 * Rhosgobel is Radagast's Fallen-wizard Wizardhaven (haven). It is unusual among
 * the three FW Wizardhavens (Isengard wh-56, The White Towers wh-58) in that its
 * printed text spells out three extra rules on top of the shared attack-cancel.
 *
 * Card text:
 *   "Special: Only Radagast's companies may use this card. This site is a
 *   protected Wizardhaven [{H}]. If one of your companies is at this site, all
 *   attacks against it are canceled. You receive the stage point if any of your
 *   companies are at this site."
 *
 * Modeling (see `packages/shared/docs/card-effects-dsl.md`):
 *   - "Only Radagast's companies may use this card" → the `radagast-specific`
 *     keyword (CoE 1.3.4 / MEWH §12). Deck construction (rule 1.07) only lets a
 *     deck include the site when Radagast is the declared avatar; the site can
 *     therefore never reach a non-Radagast player's location deck / companies.
 *   - "This site is a protected Wizardhaven [{H}]" → `{ site-rule,
 *     protected-wizardhaven }`. The site counts as one of its Radagast
 *     controller's protected Wizardhavens for every consumer of that concept —
 *     here exercised via the Deep Mines (wh-55) descent, which is legal only
 *     from a protected Wizardhaven — with no `site-protected` constraint needing
 *     to be established on it (unlike Isengard/The White Towers).
 *   - "all attacks against it are canceled" → `{ site-rule, cancel-attacks }`,
 *     which marks hazard-creature plays non-viable against a company here.
 *   - "You receive the stage point if any of your companies are at this site" →
 *     `{ stage-points, value: 1, whileCompanyAtSite: true }`, summed once per
 *     distinct occupied site instance (Fallen-wizard only).
 *
 * | # | Rule                                                    | Status |
 * |---|---------------------------------------------------------|--------|
 * | 1 | only Radagast may include/use the site (radagast-specific) | OK  |
 * | 2 | inherently a protected Wizardhaven (Deep Mines source)  | OK     |
 * | 3 | all attacks against a company here are canceled         | OK     |
 * | 4 | +1 stage point while a company occupies it              | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { computeLegalActions, Phase, Alignment, validateDeck } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayerId, DeckList } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import {
  PLAYER_1, PLAYER_2, RIVENDELL, MORIA, ORC_PATROL, LEGOLAS,
  resetMint, buildTestState, buildSitePhaseState, makeMHState,
  viableFor, viableActions,
  pool, HERO_RESOURCES_30, HAZARD_CREATURES_12,
} from '../test-helpers.js';

const RHOSGOBEL = 'wh-57' as CardDefinitionId;
const ISENGARD_WH = 'wh-56' as CardDefinitionId;   // FW Wizardhaven, not inherently protected
const DEEP_MINES = 'wh-55' as CardDefinitionId;
const RADAGAST_FW = 'wh-8' as CardDefinitionId;     // Radagast avatar (Fallen-wizard)
const SARUMAN_FW = 'wh-9' as CardDefinitionId;       // a different Fallen-wizard avatar

/** Definition IDs of the sites a player's plan-movement actions target. */
function planDests(state: GameState, player: PlayerId = PLAYER_1): (string | undefined)[] {
  return computeLegalActions(state, player)
    .filter(ea => ea.viable && ea.action.type === 'plan-movement')
    .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string | undefined);
}

/** Organization-phase state with a single Fallen-wizard company at `origin`. */
function orgState(opts: {
  origin: CardDefinitionId;
  avatar?: CardDefinitionId;
  stagePoints?: number;
  siteDeck?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: opts.origin, characters: [opts.avatar ?? RADAGAST_FW] }], hand: [], siteDeck: opts.siteDeck ?? [DEEP_MINES], stagePoints: opts.stagePoints ?? 7 },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Rhosgobel (wh-57)', () => {
  beforeEach(() => resetMint());

  // ─── "Only Radagast's companies may use this card" (radagast-specific) ──────

  test('a Fallen-wizard deck may not include Rhosgobel unless Radagast is declared', () => {
    const deck: DeckList = {
      id: 'rhosgobel-no-radagast',
      name: 'Rhosgobel without Radagast',
      alignment: 'fallen-wizard',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Rhosgobel', card: RHOSGOBEL, qty: 1 }],
      deck: {
        characters: [{ name: 'Saruman', card: SARUMAN_FW, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...HERO_RESOURCES_30],
      },
    };
    const errors = validateDeck(deck, pool).filter(e => e.card === RHOSGOBEL);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Radagast');
  });

  test('Rhosgobel is allowed once Radagast is the declared avatar', () => {
    const deck: DeckList = {
      id: 'rhosgobel-with-radagast',
      name: 'Rhosgobel with Radagast',
      alignment: 'fallen-wizard',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Rhosgobel', card: RHOSGOBEL, qty: 1 }],
      deck: {
        characters: [{ name: 'Radagast', card: RADAGAST_FW, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...HERO_RESOURCES_30],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === RHOSGOBEL)).toBe(false);
  });

  // ─── "This site is a protected Wizardhaven" (inherent protection) ───────────

  test('Deep Mines descent is offered from Rhosgobel — it is inherently protected', () => {
    // No `site-protected` constraint is injected: Rhosgobel is protected purely
    // by its own protected-wizardhaven site-rule.
    const s = orgState({ origin: RHOSGOBEL, stagePoints: 7, siteDeck: [DEEP_MINES] });
    expect(planDests(s)).toContain(DEEP_MINES as string);
  });

  test('Deep Mines descent is NOT offered from Isengard — a Wizardhaven without inherent protection', () => {
    const s = orgState({ origin: ISENGARD_WH, stagePoints: 7, siteDeck: [DEEP_MINES] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  test('Rhosgobel is not a protected Wizardhaven for a non-Radagast Fallen-wizard', () => {
    // A Saruman company standing on Rhosgobel does not control its protection
    // (the site is radagast-specific), so no Deep Mines descent is offered.
    const s = orgState({ origin: RHOSGOBEL, avatar: SARUMAN_FW, stagePoints: 7, siteDeck: [DEEP_MINES] });
    expect(planDests(s)).not.toContain(DEEP_MINES as string);
  });

  // ─── "all attacks against it are canceled" (cancel-attacks) ─────────────────

  test('a hazard creature is non-viable against a Radagast company at Rhosgobel', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: RHOSGOBEL, characters: [RADAGAST_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at Rhosgobel/);
  });

  // ─── "You receive the stage point ... at this site" (occupancy) ─────────────

  function occupancyState(opts: { alignment?: Alignment; site: CardDefinitionId }): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: opts.alignment ?? Alignment.FallenWizard, companies: [{ site: opts.site, characters: [RADAGAST_FW] }], hand: [], siteDeck: [RHOSGOBEL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  }

  test('a Fallen-wizard receives 1 stage point while a company occupies Rhosgobel', () => {
    expect(occupancyState({ site: RHOSGOBEL }).players[0].stagePoints).toBe(1);
  });

  test('no Rhosgobel stage point when the company is elsewhere', () => {
    expect(occupancyState({ site: ISENGARD_WH }).players[0].stagePoints).toBe(0);
  });

  test('a non-Fallen-wizard occupying Rhosgobel accrues no stage points', () => {
    expect(occupancyState({ alignment: Alignment.Wizard, site: RHOSGOBEL }).players[0].stagePoints).toBe(0);
  });

  // ─── Site-phase flow (haven: no resources playable) ─────────────────────────

  test('no resources are playable at Rhosgobel (haven)', () => {
    const state = buildSitePhaseState({ site: RHOSGOBEL });
    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });
});

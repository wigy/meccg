/**
 * @module rule-9.14-fw-stage-event-rules
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.14: Fallen-Wizard Stage/Event Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] Stage resource permanent-events can only be played during the organization phase.
 * [FALLEN-WIZARD] A hero resource permanent-event cannot be played on a company containing an Orc and/or a Troll.
 * [FALLEN-WIZARD] A hero resource that requires a character with a specific skill cannot use an Orc or Troll character to fulfill that active condition, and Orc and Troll characters cannot be tapped to fulfill an active condition of a hero resource or its effects.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  buildFwStagePermanentMHState,
  viableActions,
  findCharInstanceId, findHandCardId,
  ARAGORN, LEGOLAS, GIMLI,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';
import { Phase, Alignment } from '../../../index.js';

// ── Local card-ID constants (single-use — declared with their only consumer) ──

/** Wizard's Myrmidon — a Stage resource permanent-event (alignment: stage). */
const WIZARDS_MYRMIDON = 'wh-84' as CardDefinitionId;
/** Saruman — a Fallen-wizard avatar (race fallen-wizard). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Sly Southerner — a non-Fallen-wizard character (race orc) and valid target. */
const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;
/** Isengard — a Fallen-wizard haven. */
const ISENGARD_SITE = 'wh-56' as CardDefinitionId;
/** Dunnish Clan-hold — a destination site for the moving company. */
const DUNNISH_CLAN_HOLD = 'tw-390' as CardDefinitionId;
/** Fellowship — a hero (wizard-aligned) company-targeting permanent-event: "+1 prowess/corruption-check to all in a 4+ member company at a Haven." */
const FELLOWSHIP = 'tw-240' as CardDefinitionId;

describe('Rule 9.14 — Fallen-Wizard Stage/Event Rules', () => {
  beforeEach(() => resetMint());

  // ── Rule 5.F1: Stage resource permanent-events only during the org phase ───

  test('[FALLEN-WIZARD] a Stage resource permanent-event is NOT playable during the movement/hazard phase', () => {
    const state = buildFwStagePermanentMHState({
      stagePermanentDefId: WIZARDS_MYRMIDON,
      avatarDefId: SARUMAN,
      targetCharDefId: SLY_SOUTHERNER,
      site: ISENGARD_SITE,
      destinationSite: DUNNISH_CLAN_HOLD,
    });

    const myrmidonId = findHandCardId(state, RESOURCE_PLAYER, WIZARDS_MYRMIDON);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === myrmidonId);

    // Rule 5.F1: the stage permanent-event may not be played here even though a
    // valid non-Fallen-wizard target sits in the company.
    expect(actions).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] the same Stage resource permanent-event IS playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_SITE, characters: [SARUMAN, SLY_SOUTHERNER] }],
          hand: [WIZARDS_MYRMIDON],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD_SITE, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    // Positive control: organization-phase play is allowed on the orc target.
    expect(actions).toContain(orcId);
  });

  // ── MEWH §9: hero resource permanent-event cannot be played on an Orc/Troll company ──

  test('[FALLEN-WIZARD] a hero resource permanent-event cannot target a company containing an Orc', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_SITE, characters: [SARUMAN, SLY_SOUTHERNER, ARAGORN, LEGOLAS] }],
          hand: [FELLOWSHIP],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD_SITE, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const fellowshipId = findHandCardId(state, RESOURCE_PLAYER, FELLOWSHIP);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === fellowshipId);
    expect(actions).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] the same hero permanent-event IS playable on an otherwise-identical Orc-free company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_SITE, characters: [SARUMAN, GIMLI, ARAGORN, LEGOLAS] }],
          hand: [FELLOWSHIP],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD_SITE, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const fellowshipId = findHandCardId(state, RESOURCE_PLAYER, FELLOWSHIP);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === fellowshipId);
    expect(actions.length).toBeGreaterThan(0);
  });

  // "A hero resource that requires a character with a specific skill cannot
  // use an Orc or Troll character to fulfill that active condition, and
  // Orc/Troll characters cannot be tapped to fulfill an active condition of a
  // hero resource or its effects": no such skill-gated/tap-cost active
  // condition check exists in the engine — hero resources with a
  // `cost: { tap: <skill> }`-style active condition don't special-case Orc/Troll
  // bearers, and no currently-certified hero resource's active condition is
  // exercised by an Orc/Troll character in the pool to prove a violation.
  test.todo('[FALLEN-WIZARD] hero resource skill condition cannot use Orc/Troll; Orc/Troll cannot be tapped for a hero resource active condition');
});

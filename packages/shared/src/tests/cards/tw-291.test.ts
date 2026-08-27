/**
 * @module tw-291.test
 *
 * Card test: Nenya (tw-291)
 * Type: hero-resource-event (short)
 * Effects: play-target, on-event×3 (character-stat-modifier), on-event×2
 * (enqueue-corruption-check, mutually exclusive on target.siteType), on-event
 * (add-constraint check-modifier target:"player" autoPass, gated by
 * constraintWhen on the checking character's site type)
 *
 * "Playable on Galadriel. +2 prowess, +2 body, +2 direct influence for the
 * rest of the turn. Galadriel makes a corruption check modified by -3, by -1
 * if in a Haven [{H}]. Any one corruption check made by a character not in a
 * Shadow-hold [{S}] or Dark-hold [{D}] is automatically successful."
 *
 * | # | Rule fragment                                              | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Playable on Galadriel                                      | IMPLEMENTED |
 * | 2 | +2 prowess for the rest of the turn                        | IMPLEMENTED |
 * | 3 | +2 body for the rest of the turn                           | IMPLEMENTED |
 * | 4 | +2 direct-influence for the rest of the turn               | IMPLEMENTED |
 * | 5 | Galadriel corruption check modified -3                     | IMPLEMENTED |
 * | 6 | Galadriel corruption check modified -1 if in a Haven        | IMPLEMENTED |
 * | 7 | Any one corruption check by a character not in a            | IMPLEMENTED |
 * |   | Shadow-hold/Dark-hold is automatically successful           |             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GALADRIEL, ARAGORN, LEGOLAS,
  RIVENDELL, MINAS_TIRITH, MORIA, LORIEN,
  buildTestState, resetMint,
  viableActions, findCharInstanceId, findHandCardId,
  dispatch,
  RESOURCE_PLAYER,
  getCharacter,
  attachItemToChar, recomputeDerived, enqueueCorruptionCheck,
  expectInDiscardPile,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  CorruptionCheckAction,
} from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { SitePhaseState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const NENYA = 'tw-291' as CardDefinitionId;
const DWARVEN_RING = 'tw-213' as CardDefinitionId; // simple item, no effects, corruptionPoints 3

const SITE_PHASE_STATE: SitePhaseState = {
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
};

/** Build a minimal site-phase state with Galadriel (+ optional others) in a company at `site`, Nenya in hand. */
function buildNenya(opts: {
  site?: CardDefinitionId;
  companyCharacters?: CardDefinitionId[];
} = {}) {
  const site = opts.site ?? RIVENDELL;
  const characters = opts.companyCharacters ?? [GALADRIEL];
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters }],
        hand: [NENYA],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: SITE_PHASE_STATE };
}

describe('Nenya (tw-291)', () => {
  beforeEach(() => resetMint());

  // ─── Test 1: Nenya is playable on Galadriel ──────────────────────────────

  test('Nenya is playable in Galadriel\'s company (site phase)', () => {
    const state = buildNenya();
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    expect(plays).toHaveLength(1);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    expect(plays[0].action.targetCharacterId).toBe(galadrielId);
  });

  // ─── Test 2: Nenya NOT playable when Galadriel is absent ─────────────────

  test('Nenya NOT playable when Galadriel is not in any company', () => {
    const state = buildNenya({ companyCharacters: [ARAGORN] });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId
          === findHandCardId(state, RESOURCE_PLAYER, NENYA));
    expect(notPlayable).toHaveLength(1);
  });

  // ─── Test 3: Stat boosts applied to Galadriel ────────────────────────────

  test('playing Nenya adds +2 prowess, +2 body, +2 direct-influence on Galadriel (character-stat-modifier constraints)', () => {
    const state = buildNenya();
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const nenyaId = findHandCardId(state, RESOURCE_PLAYER, NENYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: nenyaId,
      targetCharacterId: galadrielId,
    });

    const charConstraints = s.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier'
        && (c.kind as { characterId: CardInstanceId }).characterId === galadrielId,
    );
    expect(charConstraints).toHaveLength(3);

    // Galadriel base: prowess 3, body 10, directInfluence 4
    const galadriel = getCharacter(s, RESOURCE_PLAYER, GALADRIEL);
    expect(galadriel.effectiveStats.prowess).toBe(3 + 2);
    expect(galadriel.effectiveStats.body).toBe(10 + 2);
    expect(galadriel.effectiveStats.directInfluence).toBe(4 + 2);
  });

  // ─── Test 4/5: Corruption check modifier depends on Galadriel's site ─────

  test('playing Nenya at a Haven enqueues Galadriel\'s corruption check with modifier -1', () => {
    const state = buildNenya({ site: RIVENDELL });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const nenyaId = findHandCardId(state, RESOURCE_PLAYER, NENYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: nenyaId,
      targetCharacterId: galadrielId,
    });

    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === galadrielId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { modifier: number }).modifier).toBe(-1);
  });

  test('playing Nenya at a non-Haven site enqueues Galadriel\'s corruption check with modifier -3', () => {
    const state = buildNenya({ site: MINAS_TIRITH });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const nenyaId = findHandCardId(state, RESOURCE_PLAYER, NENYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: nenyaId,
      targetCharacterId: galadrielId,
    });

    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === galadrielId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { modifier: number }).modifier).toBe(-3);
  });

  // ─── Test 6: player-scoped autoPass constraint is added with the right shape ──

  test('playing Nenya adds a player-scoped, site-gated autoPass check-modifier constraint', () => {
    const state = buildNenya({ site: MINAS_TIRITH });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const nenyaId = findHandCardId(state, RESOURCE_PLAYER, NENYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: nenyaId,
      targetCharacterId: galadrielId,
    });

    const playerConstraints = s.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption' && c.target.kind === 'player',
    );
    expect(playerConstraints).toHaveLength(1);
    const constraint = playerConstraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.autoPass).toBe(true);
      expect(constraint.kind.when).toBeDefined();
    }
    expect(constraint.target.kind).toBe('player');
    if (constraint.target.kind === 'player') {
      expect(constraint.target.playerId).toBe(PLAYER_1);
    }
  });

  // ─── Test 7: card disposal ────────────────────────────────────────────────

  test('card is removed from hand and placed in discard pile after play', () => {
    const state = buildNenya();
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const nenyaId = findHandCardId(state, RESOURCE_PLAYER, NENYA);

    const after = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: nenyaId,
      targetCharacterId: galadrielId,
    });

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, NENYA);
  });

  // ─── Tests 8-10: autoPass mechanism ("any one corruption check by a ──────
  // character not in a Shadow-hold/Dark-hold is automatically successful") ──
  // Exercised directly against the player-scoped constraint (mirroring
  // Ancient Black Axe as-122's autoPass mechanism test) so the "any
  // character" behaviour is proven independently of which character Nenya
  // itself was played on.

  const NENYA_AUTO_PASS_WHEN = {
    $not: { 'target.siteType': { $in: ['shadow-hold', 'dark-hold'] } },
  };

  test('player-scoped autoPass forces a normally-failing corruption check to succeed, for ANY character of the player', () => {
    // Aragorn (not Galadriel) — proves the auto-pass is not bound to a
    // specific character. He's at Minas Tirith (free-hold: neither a Haven
    // nor a Shadow-hold/Dark-hold), so the constraint's `when` matches.
    const base = recomputeDerived(attachItemToChar(buildNenya({ site: MINAS_TIRITH, companyCharacters: [GALADRIEL, ARAGORN] }), RESOURCE_PLAYER, ARAGORN, DWARVEN_RING));
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const cp = getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;
    expect(cp).toBeGreaterThan(0);

    const withAutoPass = addConstraint(
      enqueueCorruptionCheck(base, PLAYER_1, aragornId),
      {
        source: aragornId,
        sourceDefinitionId: NENYA,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: PLAYER_1 },
        kind: { type: 'check-modifier', check: 'corruption', value: 0, autoPass: true, when: NENYA_AUTO_PASS_WHEN },
      },
    );

    const lowRoll = { ...withAutoPass, cheatRollTotal: 2 };
    const rollAction = computeLegalActions(lowRoll, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check')!.action as CorruptionCheckAction;
    const outcome = dispatch(lowRoll, rollAction);

    // Aragorn survives, untouched, still in his company.
    expect(outcome.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(false);
    expect(outcome.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
    const company = outcome.players[RESOURCE_PLAYER].companies.find(co => co.characters.includes(aragornId));
    expect(company).toBeDefined();

    // One-shot: the constraint is consumed by this one check.
    expect(outcome.activeConstraints.some(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption')).toBe(false);
  });

  test('player-scoped autoPass does NOT apply to a character at a Shadow-hold/Dark-hold — check resolves normally and the constraint is not consumed', () => {
    // Aragorn at Moria, a Shadow-hold: constraintWhen excludes him.
    const base = recomputeDerived(attachItemToChar(buildNenya({ site: MORIA, companyCharacters: [GALADRIEL, ARAGORN] }), RESOURCE_PLAYER, ARAGORN, DWARVEN_RING));
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const cp = getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;
    expect(cp).toBeGreaterThan(0);

    const withAutoPass = addConstraint(
      enqueueCorruptionCheck(base, PLAYER_1, aragornId),
      {
        source: aragornId,
        sourceDefinitionId: NENYA,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: PLAYER_1 },
        kind: { type: 'check-modifier', check: 'corruption', value: 0, autoPass: true, when: NENYA_AUTO_PASS_WHEN },
      },
    );

    const lowRoll = { ...withAutoPass, cheatRollTotal: 2 };
    const rollAction = computeLegalActions(lowRoll, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check')!.action as CorruptionCheckAction;
    const outcome = dispatch(lowRoll, rollAction);

    // The check resolves normally (fails badly) — Aragorn is discarded.
    expectInDiscardPile(outcome, RESOURCE_PLAYER, ARAGORN);

    // Untouched by the site-gated constraint — still active for a future check.
    const remaining = outcome.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption' && c.target.kind === 'player',
    );
    expect(remaining).toHaveLength(1);
  });
});

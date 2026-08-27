/**
 * @module td-163.test
 *
 * Card test: Warm Now Be Heart and Limb (td-163)
 * Type: hero-resource-event (short)
 *
 * Printed text:
 *   "Sage only. Ritual. Playable on a company during organization phase.
 *    Each sage in company that taps may heal one character (from wounded
 *    to tapped). Each sage so tapping makes a corruption check."
 *
 * Effects:
 *   1. play-window: organization, step end-of-org
 *   2. play-target: company, filter { company.skills includes sage AND
 *      company.hasWoundedCharacter } — CoE 9.1 bars playing a card that
 *      could not possibly have an effect (no sage present, or nobody
 *      wounded to heal).
 *   3. on-event self-enters-play → add-constraint `granted-action`
 *      (scope: turn, target: the played-on company), granting a
 *      repeatable `heal-company-character` ability: cost { tap: "character" },
 *      when { actor.skills includes sage }, targets { scope:
 *      "company-wounded-characters" } (new scope — only genuinely wounded
 *      (Inverted) company-mates, unlike the existing `company-characters`
 *      scope which admits any non-Untapped candidate). Apply: sequence
 *      [set-character-status target-character tapped, enqueue-corruption-check]
 *      — the corruption check (no `target`) defaults to the *activating*
 *      character, i.e. the tapping sage, per "each sage SO TAPPING makes a
 *      corruption check" (not the healed target).
 *
 * Engine support added for this certification:
 *   - `GrantActionTargets.scope` gained `"company-wounded-characters"`
 *     (`legal-actions/organization.ts`'s `enumerateGrantActionTargets`).
 *   - `GrantedActionConstraintPayload` (and the matching `ActiveConstraint`
 *     `granted-action` kind) gained an optional `targets` field, threaded
 *     through both `add-constraint` builders (`reducer-events.ts`,
 *     `constraint-kind.ts`).
 *   - `emitGrantedActionConstraintActions` (`granted-action-constraints.ts`)
 *     now enumerates per-target candidates when `targets` is present,
 *     emitting one activation per (eligible actor, candidate) pair instead
 *     of a single untargeted activation — recomputed live every legal-action
 *     call, so a character healed by one sage naturally drops out of a
 *     later sage's candidate list within the same organization phase.
 *   - `organizationActions` now also calls the constraint-based emitter per
 *     company (previously only wired for movement-hazard call sites: Great
 *     Ship's chain-cancel, River's cancel-constraint).
 *   - `endOfOrgEligibility`'s company filter context gained
 *     `hasWoundedCharacter`, mirroring `buildTargetCompanyConditionContext`.
 *
 * Playable: YES
 * Certified: 2026-08-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, ELROND, GALADRIEL, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  findHandCardId, findCharInstanceId, companyIdAt,
  viableActions, grantedActionsFor, expectCharStatus, makeMHState,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayShortEventAction, ActivateGrantedAction } from '../../index.js';
import { CardStatus } from '../../index.js';
import type { CharacterEntry } from '../test-helpers-core.js';

const WARM_NOW = 'td-163' as CardDefinitionId;

/** Organization-phase state: player 1's company sits at Rivendell with the given members. */
function orgState(characters: CharacterEntry[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters }], hand: [WARM_NOW], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** Play Warm Now Be Heart and Limb on player 1's (only) company. */
function playWarmNow(base: GameState): GameState {
  return dispatch(base, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(base, RESOURCE_PLAYER, WARM_NOW),
    targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
  } as PlayShortEventAction);
}

describe('Warm Now Be Heart and Limb (td-163)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate (rule 9.1 + "Sage only") ─────────────────────────────

  test('NOT playable when the company has no sage, even with a wounded member', () => {
    const base = orgState([{ defId: ARAGORN, status: CardStatus.Inverted }]);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === findHandCardId(base, RESOURCE_PLAYER, WARM_NOW));
    expect(plays).toHaveLength(0);
  });

  test('NOT playable when a sage is present but nobody is wounded', () => {
    const base = orgState([ELROND, ARAGORN]);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === findHandCardId(base, RESOURCE_PLAYER, WARM_NOW));
    expect(plays).toHaveLength(0);
  });

  test('playable when the company has a sage and a wounded member', () => {
    const base = orgState([ELROND, { defId: ARAGORN, status: CardStatus.Inverted }]);
    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === findHandCardId(base, RESOURCE_PLAYER, WARM_NOW));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayShortEventAction).targetCompanyId).toBe(companyIdAt(base, RESOURCE_PLAYER));
  });

  // ─── Zero sages tap: fizzle ─────────────────────────────────────────────────

  test('after playing, no heal-company-character activation is offered once no sage remains untapped', () => {
    // Elrond is already tapped, so he cannot pay the tap cost — the ability
    // must not be offered to him, and nothing should heal or check.
    const base = orgState([{ defId: ELROND, status: CardStatus.Tapped }, { defId: ARAGORN, status: CardStatus.Inverted }]);
    const played = playWarmNow(base);

    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);
    expect(grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1)).toHaveLength(0);

    expectCharStatus(played, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expect(played.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── One sage taps, heals one wounded companion, makes his own check ───────

  test('one sage taps to heal the wounded companion to tapped, and makes his own corruption check', () => {
    const base = orgState([ELROND, { defId: ARAGORN, status: CardStatus.Inverted }]);
    const played = playWarmNow(base);

    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);
    const aragornId = findCharInstanceId(played, RESOURCE_PLAYER, ARAGORN);

    const offers = grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1);
    expect(offers).toHaveLength(1);
    expect(offers[0].targetCardId).toBe(aragornId);

    const healed = dispatch(played, offers[0]);

    // Elrond (the healer) taps; Aragorn (the target) heals wounded -> tapped
    // (not fully well/untapped — this is a partial heal).
    expectCharStatus(healed, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    expectCharStatus(healed, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // The corruption check is made by Elrond — the tapping sage — not by Aragorn.
    const checks = healed.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    if (checks[0].kind.type !== 'corruption-check') throw new Error('unreachable');
    expect(checks[0].kind.characterId).toBe(elrondId);
    expect(checks[0].kind.characterId).not.toBe(aragornId);
  });

  // ─── Two sages, two different wounded companions ───────────────────────────

  test('two sages each heal a different wounded companion, each making their own check', () => {
    const base = orgState([
      ELROND, GALADRIEL,
      { defId: ARAGORN, status: CardStatus.Inverted },
      { defId: LEGOLAS, status: CardStatus.Inverted },
    ]);
    const played = playWarmNow(base);

    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);
    const galadrielId = findCharInstanceId(played, RESOURCE_PLAYER, GALADRIEL);
    const aragornId = findCharInstanceId(played, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(played, RESOURCE_PLAYER, LEGOLAS);

    // Both sages are independently offered both wounded targets up front.
    const elrondOffers = grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1);
    expect(elrondOffers.map(a => a.targetCardId).sort()).toEqual([aragornId, legolasId].sort());

    // Elrond heals Aragorn.
    const elrondActivation = elrondOffers.find(a => a.targetCardId === aragornId)!;
    const afterElrondTaps = dispatch(played, elrondActivation);
    expectCharStatus(afterElrondTaps, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    expectCharStatus(afterElrondTaps, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Elrond's own corruption check is now the only legal action (the pending
    // resolution collapses the menu) — resolve it before anyone else can act.
    const elrondCheck = viableActions(afterElrondTaps, PLAYER_1, 'corruption-check');
    expect(elrondCheck).toHaveLength(1);
    const afterElrond = dispatch(afterElrondTaps, elrondCheck[0].action);

    // Legolas is no longer offered as a target to anyone (already healed by
    // no one — still wounded); but Aragorn must have dropped out for Galadriel.
    const galadrielOffersAfter = grantedActionsFor(afterElrond, galadrielId, 'heal-company-character', PLAYER_1);
    expect(galadrielOffersAfter.map(a => a.targetCardId)).toEqual([legolasId]);

    // Galadriel heals Legolas.
    const galadrielActivation = galadrielOffersAfter[0];
    const afterGaladrielTaps = dispatch(afterElrond, galadrielActivation);
    const galadrielCheck = viableActions(afterGaladrielTaps, PLAYER_1, 'corruption-check');
    expect(galadrielCheck).toHaveLength(1);
    const afterBoth = dispatch(afterGaladrielTaps, galadrielCheck[0].action);
    expectCharStatus(afterBoth, RESOURCE_PLAYER, GALADRIEL, CardStatus.Tapped);
    expectCharStatus(afterBoth, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    // Each sage made their own corruption check — Elrond's for healing
    // Aragorn, Galadriel's for healing Legolas — and both have now resolved.
    expect((elrondCheck[0].action as { characterId: unknown }).characterId).toBe(elrondId);
    expect((galadrielCheck[0].action as { characterId: unknown }).characterId).toBe(galadrielId);
    expect(afterBoth.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);

    // No further heal-company-character activation remains for anyone — both
    // sages are now tapped and both wounded companions are healed.
    expect(viableActions(afterBoth, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character')).toHaveLength(0);
  });

  // ─── A wounded sage among several sages cannot itself be tapped (must be untapped to pay the cost) ───

  test('a wounded sage cannot activate the ability (not untapped, so cannot pay the tap cost)', () => {
    const base = orgState([
      { defId: ELROND, status: CardStatus.Inverted },
      { defId: ARAGORN, status: CardStatus.Inverted },
    ]);
    const played = playWarmNow(base);
    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);
    expect(grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1)).toHaveLength(0);
  });

  // ─── Non-sage cannot activate ──────────────────────────────────────────────

  test('an untapped non-sage character in the company is never offered the ability, even though he could pay the tap cost', () => {
    const base = orgState([ELROND, ARAGORN, { defId: LEGOLAS, status: CardStatus.Inverted }]);
    const played = playWarmNow(base);
    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);
    const aragornId = findCharInstanceId(played, RESOURCE_PLAYER, ARAGORN);

    // Elrond (sage, untapped) IS offered the ability...
    expect(grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1)).toHaveLength(1);
    // ...but Aragorn (untapped, but not a sage) never is, per `when: { actor.skills
    // includes sage }` — being untapped is necessary but not sufficient.
    expect(grantedActionsFor(played, aragornId, 'heal-company-character', PLAYER_1)).toHaveLength(0);
  });

  // ─── Playable only during organization phase, on a company ─────────────────

  test('the heal ability is withdrawn once the game leaves the organization phase', () => {
    const base = orgState([ELROND, { defId: ARAGORN, status: CardStatus.Inverted }]);
    const played = playWarmNow(base);
    const elrondId = findCharInstanceId(played, RESOURCE_PLAYER, ELROND);

    // During organization, right after playing, the heal ability IS offered.
    expect(grantedActionsFor(played, elrondId, 'heal-company-character', PLAYER_1)).toHaveLength(1);

    // The turn-scoped constraint survives into the movement/hazard phase (it
    // is cleared only at turn end), but the grant-action's own `phase:
    // "organization"` gate means it is never actually offered there — Elrond
    // is still untapped and Aragorn still wounded, yet nothing is offered.
    const inMovementHazard: GameState = { ...played, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(grantedActionsFor(inMovementHazard, elrondId, 'heal-company-character', PLAYER_1)).toHaveLength(0);
  });
});

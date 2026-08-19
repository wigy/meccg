/**
 * @module as-98.test
 *
 * Card test: Riven Gate (as-98)
 * Type: minion-resource-event (short, sorcery)
 *
 * Card text: "Magic. Sorcery. Playable on a sorcery-using character when
 * facing the automatic-attack at a Border-hold [{B}]. All automatic-attacks
 * at the site are canceled, and any influence attempt against a faction at
 * the site this turn is modified by +2. Unless he is a Ringwraith, he makes
 * a corruption check modified by -4."
 *
 * Effects:
 *   1. cancel-attack — requiredSkill "sorcery"; cost = corruption check -4;
 *      costExemptRace "ringwraith" (Ringwraith pays nothing);
 *      cancelsRemainingSiteAttacks (abandons the rest of the site's
 *      automatic-attack sequence via `SitePhaseState.autoAttacksSkipped`);
 *      influenceAtSiteModifier 2 (adds a turn-scoped `influence-at-site-modifier`
 *      constraint); when = attack source is an automatic-attack at a
 *      Border-hold.
 *
 * Fixtures: Hador (le-14, dunadan, sorcery skill — makes the -4 check) and
 * Dwar the Ringwraith (le-52, ringwraith, sorcery skill — exempt from the
 * check), defending at Dale (le-363, minion-side Border-hold with a Men
 * automatic-attack). Dol Guldur (le-367, minion-side haven) stands in for a
 * non-Border-hold site in the site-type gate test.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint,
  PLAYER_1,
  viableActions,
  attachSiteAutomaticAttackCombat,
  dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction, CardDefinitionId, CardInstanceId } from '../../index.js';

const RIVEN_GATE = 'as-98' as CardDefinitionId;
const HADOR = 'le-14' as CardDefinitionId;       // dunadan, sorcery skill (non-Ringwraith)
const DWAR = 'le-52' as CardDefinitionId;         // ringwraith, sorcery skill
const DALE = 'le-363' as CardDefinitionId;        // minion-side Border-hold, Men automatic-attack
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion-side haven (wrong site type)

describe('Riven Gate (as-98)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offers cancel-attack for a sorcery-using character facing the automatic-attack at a Border-hold', () => {
    const base = buildMinionSitePhaseState({
      characters: [HADOR],
      site: DALE,
      hand: [RIVEN_GATE],
    });
    const state = attachSiteAutomaticAttackCombat(base);

    const actions = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].scoutInstanceId).toBeDefined();
  });

  test('NOT available when no sorcery-using character is in the company', () => {
    // Dwar has sorcery too, so use a plain non-sorcery placeholder company
    // member instead — Bill Ferny has no sorcery skill.
    const BILL_FERNY = 'dm-3' as CardDefinitionId;
    const base = buildMinionSitePhaseState({
      characters: [BILL_FERNY],
      site: DALE,
      hand: [RIVEN_GATE],
    });
    const state = attachSiteAutomaticAttackCombat(base);

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT available against a non-automatic-attack (creature attack)', () => {
    const base = buildMinionSitePhaseState({
      characters: [HADOR],
      site: DALE,
      hand: [RIVEN_GATE],
    });
    const withCombat = attachSiteAutomaticAttackCombat(base);
    const state = {
      ...withCombat,
      combat: {
        ...withCombat.combat!,
        attackSource: { type: 'creature' as const, instanceId: 'fake-creature' as CardInstanceId },
      },
    };

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT available at a non-Border-hold site (Haven)', () => {
    const base = buildMinionSitePhaseState({
      characters: [HADOR],
      site: DOL_GULDUR,
      hand: [RIVEN_GATE],
    });
    const state = attachSiteAutomaticAttackCombat(base);

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ── Resolution ──────────────────────────────────────────────────────

  test('cancels the attack, abandons remaining site attacks, adds the influence bonus, and enqueues the -4 corruption check', () => {
    const base = buildMinionSitePhaseState({
      characters: [HADOR],
      site: DALE,
      hand: [RIVEN_GATE],
    });
    const state = attachSiteAutomaticAttackCombat(base);
    const siteDefinitionId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.definitionId;

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)[0];
    expect(cancelAction).toBeDefined();

    const declared = dispatch(state, cancelAction);
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, RIVEN_GATE);
    // Non-Ringwraith sorcery-user makes the -4 corruption check.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-4);
    // Combat still active until the chain resolves.
    expect(declared.combat).not.toBeNull();

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    // All automatic-attacks at the site are canceled — the rest of the
    // sequence is abandoned.
    expect(after.phaseState.phase).toBe('site');
    expect((after.phaseState as { autoAttacksSkipped?: boolean }).autoAttacksSkipped).toBe(true);
    // Any influence attempt against a faction at the site this turn is
    // modified by +2.
    const infConstraint = after.activeConstraints.find(c => c.kind.type === 'influence-at-site-modifier');
    expect(infConstraint).toBeDefined();
    expect((infConstraint!.kind as { siteDefinitionId: unknown }).siteDefinitionId).toBe(siteDefinitionId);
    expect((infConstraint!.kind as { value: number }).value).toBe(2);
    expect(infConstraint!.scope.kind).toBe('turn');
  });

  // ── Ringwraith cost exemption ───────────────────────────────────────

  test('Ringwraith sorcery-user is exempt: no corruption check, other effects still apply', () => {
    const base = buildMinionSitePhaseState({
      characters: [DWAR],
      site: DALE,
      hand: [RIVEN_GATE],
    });
    const state = attachSiteAutomaticAttackCombat(base);

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)[0];
    expect(cancelAction).toBeDefined();

    const declared = dispatch(state, cancelAction);
    expectInDiscardPile(declared, RESOURCE_PLAYER, RIVEN_GATE);
    // Ringwraith pays no cost — no corruption check enqueued.
    expect(declared.pendingResolutions).toHaveLength(0);

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expect((after.phaseState as { autoAttacksSkipped?: boolean }).autoAttacksSkipped).toBe(true);
    expect(after.activeConstraints.some(c => c.kind.type === 'influence-at-site-modifier')).toBe(true);
  });
});

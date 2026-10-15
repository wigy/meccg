/**
 * @module rule-3.27-move-to-follower-blocked
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.27: Move Character to Follower — blocked moves carry a reason
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may move a non-avatar character without followers to the control of a non-follower character in the same company while organizing during the organization phase. This action can only be taken if the controlled character's mind is less than or equal to the controlling character's available direct influence, before any modifications are applied to the controlled character's mind as a result of being a follower.
 *
 * The engine reports every (character, same-company non-follower controller)
 * pair it refuses as a non-viable `move-to-influence` entry with a reason, so
 * the client can explain why a reassignment is not offered instead of
 * silently hiding it. Allowed moves always come first and a pair is never
 * reported as both allowed and blocked.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ADRAZAR, LEGOLAS, THEODEN, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER,
  attachHazardToChar, moveToInfluenceEntries,
} from '../../test-helpers.js';
import { recomputeDerived } from '../../../engine/recompute-derived.js';
import type { MoveToInfluenceAction } from '../../../types/actions-organization.js';
import type { CardDefinitionId } from '../../../index.js';

/** Glóin — dwarf warrior, DI 2, +1 DI against dwarves. */
const GLOIN = 'tw-160' as CardDefinitionId;
/** Dragon-helm — +3 DI to a warrior bearer. */
const DRAGON_HELM = 'dm-167' as CardDefinitionId;
/** Rebel-talk — attached hazard: the character cannot be controlled by direct influence. */
const REBEL_TALK = 'le-132' as CardDefinitionId;

describe('Rule 3.27 — blocked move-to-follower reasons', () => {
  beforeEach(() => resetMint());

  test('insufficient direct influence yields a blocked move naming available DI and cost', () => {
    // Aragorn (mind 9) under Adrazar (DI 1) is not allowed.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ADRAZAR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const adrId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);

    const entries = moveToInfluenceEntries(state, PLAYER_1, aragornId, adrId);
    expect(entries).toHaveLength(1);
    expect(entries[0].viable).toBe(false);
    expect(entries[0].reason).toBe('Adrazar has 1 direct influence available, Aragorn II needs 9');
  });

  test('a character controlling followers yields only blocked to-DI moves', () => {
    // Aragorn controls Adrazar; Théoden is under GI. Aragorn cannot become
    // Théoden's follower while he has a follower of his own.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: ADRAZAR, followerOf: 0 }, THEODEN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);

    const entries = moveToInfluenceEntries(state, PLAYER_1, aragornId, theodenId);
    expect(entries).toHaveLength(1);
    expect(entries[0].viable).toBe(false);
    expect(entries[0].reason).toMatch(/controls followers and cannot become a follower/);
  });

  test('a no-direct-influence hazard yields a blocked move naming the hazard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ADRAZAR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const state = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ADRAZAR, REBEL_TALK));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const adrId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);

    const entries = moveToInfluenceEntries(state, PLAYER_1, adrId, aragornId);
    expect(entries).toHaveLength(1);
    expect(entries[0].viable).toBe(false);
    expect(entries[0].reason).toMatch(/^Rebel-talk prevents Adrazar from being controlled by direct influence$/);
  });

  test('viable moves come first and no pair is both allowed and blocked', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ADRAZAR, THEODEN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const entries = moveToInfluenceEntries(state, PLAYER_1);
    const firstBlocked = entries.findIndex(ea => !ea.viable);
    expect(firstBlocked).toBeGreaterThan(-1);
    expect(entries.slice(firstBlocked).every(ea => !ea.viable)).toBe(true);

    const keys = entries.map(ea => {
      const a = ea.action as MoveToInfluenceAction;
      return `${a.characterInstanceId as string}->${a.controlledBy as string}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('Glóin with Dragon-helm (DI 2 + 3, +1 against dwarves) may take a mind-6 dwarf', () => {
    // Reported layout: Glóin's unrestricted DI is 5 with Dragon-helm, plus a
    // separate +1 only against dwarves — enough for Gimli (mind 6) when no
    // Wizard's Myrmidon and no followers are involved.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GLOIN, items: [DRAGON_HELM] }, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const gloinId = findCharInstanceId(state, RESOURCE_PLAYER, GLOIN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const allowed = viableActions(state, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as MoveToInfluenceAction)
      .some(a => a.characterInstanceId === gimliId && a.controlledBy === gloinId);
    expect(allowed).toBe(true);
  });

  test('without Dragon-helm, Glóin cannot take Gimli and the reason gives the shortfall', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GLOIN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
    const gloinId = findCharInstanceId(state, RESOURCE_PLAYER, GLOIN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const entries = moveToInfluenceEntries(state, PLAYER_1, gimliId, gloinId);
    expect(entries).toHaveLength(1);
    expect(entries[0].viable).toBe(false);
    expect(entries[0].reason).toBe('Glóin has 3 direct influence available, Gimli needs 6');
  });
});

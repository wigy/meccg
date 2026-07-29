/**
 * @module rule-3.47-influence-overflow
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.47: Influence Overflow at End of Org Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the total mind of a player's non-follower characters exceeds that player's general influence, the characters remain under that player's control until the end of that player's organization phase, at which point the player must immediately discard enough non-avatar characters so that their maximum general influence is not exceeded (which does not count as organizing). Those characters must first include any non-avatar characters that were brought into play this turn, and characters played this turn are returned to the player's hand instead of being discarded for this purpose. Then any non-avatar character must be discarded if it is not being controlled by general influence or direct influence (i.e. because it was removed from control of direct influence between organization phases). Finally that player may choose which other non-avatar characters to discard until their maximum general influence is no longer exceeded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, ELROND, GLORFINDEL_II, LEGOLAS, BEREGOND,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import { Phase } from '../../../types/state-phases.js';
import type { GameState } from '../../../types/state.js';
import type { CardInstanceId } from '../../../types/common.js';
import type { InfluenceOverflowDiscardAction } from '../../../types/actions-organization.js';

describe('Rule 3.47 — Influence Overflow at End of Org Phase', () => {
  beforeEach(() => resetMint());

  test('a player passing the organization phase over general influence must remove characters until within it', () => {
    // Aragorn (9) + Elrond (10) + Glorfindel II (8) = 27 mind, all under
    // general influence, against a 20-point pool. Nothing stops the player
    // from organizing while over; the settlement happens the moment they pass.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND, GLORFINDEL_II] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(27);
    // Passing is not blocked — the player organizes normally and only settles
    // the overflow on the way out of the phase.
    const passed = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(passed.phaseState.phase).toBe(Phase.LongEvent);

    const overflow = passed.pendingResolutions.find(r => r.kind.type === 'influence-overflow-discard');
    expect(overflow).toBeDefined();
    expect(overflow!.actor).toBe(PLAYER_1);

    // Free choice: all three characters are offered, none of them being an
    // avatar, brought into play this turn, or stripped of direct influence.
    const offered = viableActions(passed, PLAYER_1, 'influence-overflow-discard') as { action: InfluenceOverflowDiscardAction }[];
    const offeredIds = offered.map(a => a.action.characterInstanceId);
    const aragornId = findCharInstanceId(passed, RESOURCE_PLAYER, ARAGORN);
    const elrondId = findCharInstanceId(passed, RESOURCE_PLAYER, ELROND);
    const glorfindelId = findCharInstanceId(passed, RESOURCE_PLAYER, GLORFINDEL_II);
    expect(new Set(offeredIds)).toEqual(new Set([aragornId, elrondId, glorfindelId]));

    // Removing Elrond (10) leaves 17 ≤ 20 — one removal settles it, and the
    // resolution clears rather than demanding a second.
    const after = dispatch(passed, { type: 'influence-overflow-discard', player: PLAYER_1, characterInstanceId: elrondId });
    expect(after.players[RESOURCE_PLAYER].characters[elrondId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === elrondId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(17);
    expect(after.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(false);
  });

  test('the removal repeats until the player is back within their general influence', () => {
    // Aragorn (9) + Elrond (10) + Glorfindel II (8) + Beregond (2) = 29 over a
    // 20-point pool. Removing Beregond alone leaves 27, still over, so the
    // resolution must stay queued for a second removal.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND, GLORFINDEL_II, BEREGOND] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(29);

    const passed = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const beregondId = findCharInstanceId(passed, RESOURCE_PLAYER, BEREGOND);
    const elrondId = findCharInstanceId(passed, RESOURCE_PLAYER, ELROND);

    // 29 − 2 = 27, still over: the resolution survives and offers the rest.
    const once = dispatch(passed, { type: 'influence-overflow-discard', player: PLAYER_1, characterInstanceId: beregondId });
    expect(once.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(27);
    expect(once.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(true);
    expect(viableActions(once, PLAYER_1, 'influence-overflow-discard')).toHaveLength(3);

    // 27 − 10 = 17 ≤ 20 → done.
    const twice = dispatch(once, { type: 'influence-overflow-discard', player: PLAYER_1, characterInstanceId: elrondId });
    expect(twice.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(17);
    expect(twice.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(false);
  });

  test('a player within their general influence is asked for nothing on passing', () => {
    // Aragorn (9) + Beregond (2) = 11 against a 20-point pool.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, BEREGOND] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const passed = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(passed.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(false);
    expect(viableActions(passed, PLAYER_1, 'influence-overflow-discard')).toHaveLength(0);
  });

  test('followers are never offered: removing one would not free any general influence', () => {
    // Aragorn (9) + Elrond (10) + Glorfindel II (8) = 27 over a 20-point pool,
    // but Beregond (2) follows Aragorn under direct influence and so costs the
    // pool nothing. Discarding him could not reduce the overflow, so the rule's
    // "discard enough characters" set excludes him.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN }, { defId: ELROND }, { defId: GLORFINDEL_II },
              { defId: BEREGOND, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    expect(state.players[RESOURCE_PLAYER].characters[beregondId].controlledBy).not.toBe('general');
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(27);

    const passed = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const offered = viableActions(passed, PLAYER_1, 'influence-overflow-discard') as { action: InfluenceOverflowDiscardAction }[];
    expect(offered.map(a => a.action.characterInstanceId)).not.toContain(beregondId);
    expect(offered).toHaveLength(3);
  });

  test('characters brought into play this organization phase go first, and back to hand', () => {
    // The phase state records every character brought into play during the
    // phase; here Glorfindel II was. When the phase ends over general
    // influence, he is the only character offered — the rule removes such
    // characters *first* — and he returns to hand rather than the discard
    // pile, since he was only just paid for.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND, GLORFINDEL_II] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const glorfindelId = findCharInstanceId(base, RESOURCE_PLAYER, GLORFINDEL_II);
    const state: GameState = {
      ...base,
      phaseState: {
        ...base.phaseState,
        characterPlayedThisTurn: true,
        charactersBroughtIntoPlayThisTurn: 1,
        charactersBroughtIntoPlayIds: [glorfindelId],
      } as typeof base.phaseState,
    };

    const passed = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const offered = viableActions(passed, PLAYER_1, 'influence-overflow-discard') as { action: InfluenceOverflowDiscardAction }[];
    expect(offered.map(a => a.action.characterInstanceId)).toEqual([glorfindelId]);

    const after = dispatch(passed, { type: 'influence-overflow-discard', player: PLAYER_1, characterInstanceId: glorfindelId });
    expect(after.players[RESOURCE_PLAYER].characters[glorfindelId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === glorfindelId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === glorfindelId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);
  });

  test('playing a character records it as brought into play this organization phase', () => {
    // The tier-1 list above is not fabricated state: `play-character` appends
    // the instance it brings into play, so a character played this phase is
    // recognised as such when the phase ends.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [LEGOLAS],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BEREGOND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const legolasHandId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => (a.action as { characterInstanceId: CardInstanceId }).characterInstanceId === legolasHandId);
    expect(plays.length).toBeGreaterThan(0);

    const after = dispatch(state, plays[0].action);
    const orgState = after.phaseState;
    expect(orgState.phase).toBe(Phase.Organization);
    expect((orgState as { charactersBroughtIntoPlayIds?: readonly CardInstanceId[] }).charactersBroughtIntoPlayIds)
      .toEqual([legolasHandId]);
  });
});

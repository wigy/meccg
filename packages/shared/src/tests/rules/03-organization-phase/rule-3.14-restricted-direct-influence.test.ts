/**
 * @module rule-3.14-restricted-direct-influence
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.14: Restricted Direct Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Direct influence that is "restricted" to certain cards or races is only applied once (not per character being influenced). When a character's available direct influence would be modified down, the modification must come from unrestricted direct influence prior to restricted direct influence. If there are multiple instances of restricted direct influence in effect, the resource player may choose which restricted direct influence to subtract from.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../../index.js';
import {
  buildTestState, resetMint, viableActions, findCharInstanceId,
  attachHazardToChar, recomputeDerived, getCharacter,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  FARAMIR, BEREGOND, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';

// Restricted direct influence is modelled as a `stat-modifier` on
// `direct-influence` gated on `reason: "influence-check"` plus a target
// filter; `availableDI` folds it in once per prospective target. The
// fixtures below pair Faramir (printed DI 1, no restricted DI of his own)
// with Elf-stone (tw-224, "+2 direct influence against Elves") so the
// restricted pool is exactly +2 vs elves, and use Shut Yer Mouth (le-137,
// "-2 direct influence, minimum 0") as the downward modification. Elf
// targets: Haldir (mind 3) and Orophin (mind 2); non-elf control: Beregond
// (mind 2). Single-file card ids stay local per the card-ids.ts policy.
const ELF_STONE = 'tw-224' as CardDefinitionId;
const SHUT_YER_MOUTH = 'le-137' as CardDefinitionId;
const HALDIR = 'tw-164' as CardDefinitionId;
const OROPHIN = 'tw-174' as CardDefinitionId;

describe('Rule 3.14 — Restricted Direct Influence', () => {
  beforeEach(() => resetMint());

  test('restricted DI counts only toward matching characters', () => {
    // Faramir: 1 unrestricted DI + 2 restricted to elves. Haldir (elf, mind
    // 3) needs all three points — only reachable because the restricted pool
    // applies to him. Beregond (Dúnadan, mind 2) sees only the unrestricted
    // 1 point and stays out of reach.
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
              { defId: FARAMIR, items: [ELF_STONE] },
              { defId: HALDIR }, { defId: OROPHIN }, { defId: BEREGOND },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const haldirId = findCharInstanceId(state, RESOURCE_PLAYER, HALDIR);
    const orophinId = findCharInstanceId(state, RESOURCE_PLAYER, OROPHIN);
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);

    const underFaramir = viableActions(state, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId: CardInstanceId; controlledBy: CardInstanceId | 'general' })
      .filter(a => a.controlledBy === faramirId)
      .map(a => a.characterInstanceId);
    expect(underFaramir).toContain(haldirId);   // 1 + 2 (restricted) = 3 ≥ mind 3
    expect(underFaramir).toContain(orophinId);  // 3 ≥ mind 2
    expect(underFaramir).not.toContain(beregondId); // non-elf: 1 < mind 2
  });

  test('restricted DI is applied once, not once per character being influenced', () => {
    // Haldir (mind 3) already follows Faramir, consuming the single +2
    // restricted allotment along with the unrestricted point (1 + 2 − 3 = 0).
    // Orophin (elf, mind 2) must NOT be controllable: the elf-restricted pool
    // does not refresh per elf being influenced. (If the +2 were granted per
    // matching character, Faramir would show 1 + 2 + 2 − 3 = 2 ≥ 2 and the
    // move would be offered.)
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
              { defId: FARAMIR, items: [ELF_STONE] },
              { defId: HALDIR, followerOf: 0 },
              { defId: OROPHIN },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const haldirId = findCharInstanceId(state, RESOURCE_PLAYER, HALDIR);
    const orophinId = findCharInstanceId(state, RESOURCE_PLAYER, OROPHIN);

    const moves = viableActions(state, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId: CardInstanceId; controlledBy: CardInstanceId | 'general' });
    // Guard against a vacuous pass: the emitter did run on this state — the
    // follower Haldir is offered a move back to general influence.
    expect(moves.some(a => a.characterInstanceId === haldirId && a.controlledBy === 'general')).toBe(true);
    expect(moves.filter(a => a.controlledBy === faramirId).map(a => a.characterInstanceId))
      .not.toContain(orophinId);
  });

  test('a downward modification comes from unrestricted DI before restricted DI', () => {
    // Shut Yer Mouth (-2 DI, minimum 0) lands on Faramir: the reduction
    // consumes his single unrestricted point (1 → 0) and stops there — the
    // elf-restricted +2 from Elf-stone survives untouched. Orophin (elf,
    // mind 2) is therefore still controllable on restricted influence alone,
    // while Beregond (non-elf, mind 2) sees an empty unrestricted pool.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: FARAMIR, items: [ELF_STONE] },
              { defId: OROPHIN }, { defId: BEREGOND },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FARAMIR, SHUT_YER_MOUTH));
    expect(getCharacter(state, RESOURCE_PLAYER, FARAMIR).effectiveStats.directInfluence).toBe(0);

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const orophinId = findCharInstanceId(state, RESOURCE_PLAYER, OROPHIN);
    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);

    const underFaramir = viableActions(state, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId: CardInstanceId; controlledBy: CardInstanceId | 'general' })
      .filter(a => a.controlledBy === faramirId)
      .map(a => a.characterInstanceId);
    expect(underFaramir).toContain(orophinId);      // 0 unrestricted + 2 restricted ≥ mind 2
    expect(underFaramir).not.toContain(beregondId); // non-elf: 0 < mind 2
  });

  // "If there are multiple instances of restricted direct influence in
  // effect, the resource player may choose which restricted direct influence
  // to subtract from" has no observable scenario: a persistent allocation of
  // a reduction across distinct restricted pools (leaving the *other* pool
  // intact for later checks) would need pool-level bookkeeping the engine
  // does not model, and no certified card creates two differently-restricted
  // DI pools on one character alongside a reduction that only partially
  // consumes them.
  test.todo('with multiple restricted DI pools, the resource player chooses which pool a reduction consumes');
});

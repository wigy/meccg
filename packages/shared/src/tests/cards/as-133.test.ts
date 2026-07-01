/**
 * @module as-133.test
 *
 * Card test: Thrall-ring (as-133)
 * Type: minion-resource-item (minor)
 * Alignment: ringwraith
 *
 * "Mind Ring. -1 to mind to a minimum of 1, +1 to direct influence. Cannot
 *  be duplicated on a given character."
 *
 * Rules & engine support:
 * | # | Rule                                       | Status      | Mechanism                                    |
 * |---|---------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | -1 to mind, floored at 1                    | IMPLEMENTED | stat-modifier stat:mind, value:-1, min:1       |
 * | 2 | +1 to direct influence                      | IMPLEMENTED | stat-modifier stat:direct-influence, value:1   |
 * | 3 | Cannot be duplicated on a given character   | IMPLEMENTED | duplication-limit scope:character, max:1       |
 *
 * Fixture alignment: minion (ringwraith)
 *   - CALENDAL (le-4):   elf scout/sage, mind 6, DI 1 — normal mind reduction bearer
 *   - LUITPRAND (le-23): man scout, mind 1, DI 0      — minimum-floor bearer
 *   - PERCHEN (as-4):    orc                          — opponent character
 *   - DANCING_SPIRE (as-143): minion ruins-and-lairs   — resource player's site
 *   - DOL_GULDUR (le-367):    minion haven             — opponent site
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, findHandCardId,
  getCharacter,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, PlayHeroResourceAction, SitePhaseState } from '../../index.js';

const THRALL_RING = 'as-133' as CardDefinitionId;
const CALENDAL = 'le-4' as CardDefinitionId;    // elf, mind 6, DI 1
const LUITPRAND = 'le-23' as CardDefinitionId;  // man, mind 1, DI 0
const PERCHEN = 'as-4' as CardDefinitionId;
const DANCING_SPIRE = 'as-143' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

const SITE_PHASE: SitePhaseState = {
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

describe('Thrall-ring (as-133)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: -1 to mind, floored at 1 ────────────────────────────────────

  test('reduces bearer mind by 1', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: CALENDAL, items: [THRALL_RING] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    // Calendal's printed mind is 6 → 6 - 1 = 5.
    expect(getCharacter(state, RESOURCE_PLAYER, CALENDAL).effectiveStats.mind).toBe(5);
  });

  test('does not reduce a mind-1 bearer below the floor of 1', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: LUITPRAND, items: [THRALL_RING] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    // Luitprand's printed mind is already 1: -1 would go to 0, but the
    // effect floors at 1.
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.mind).toBe(1);
  });

  test('without the ring, no effective-mind override is set', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [CALENDAL] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, CALENDAL).effectiveStats.mind).toBeUndefined();
  });

  // ── Rule 2: +1 to direct influence ──────────────────────────────────────

  test('increases bearer direct influence by 1', () => {
    const withRing = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: CALENDAL, items: [THRALL_RING] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const withoutRing = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [CALENDAL] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    // Calendal's printed DI is 1 → 1 + 1 = 2, versus base 1 without the ring.
    expect(getCharacter(withRing, RESOURCE_PLAYER, CALENDAL).effectiveStats.directInfluence).toBe(2);
    expect(getCharacter(withoutRing, RESOURCE_PLAYER, CALENDAL).effectiveStats.directInfluence).toBe(1);
  });

  // ── Rule 3: Cannot be duplicated on a given character ───────────────────

  test('a second Thrall-ring cannot be played on a character that already bears one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DANCING_SPIRE, characters: [{ defId: CALENDAL, items: [THRALL_RING] }, LUITPRAND] }],
          hand: [THRALL_RING],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PHASE };

    const calendalId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const luitprandId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);
    const handCopy = findHandCardId(state, RESOURCE_PLAYER, THRALL_RING);

    const playable = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action).cardInstanceId === handCopy)
      .map(ea => ea.action as PlayHeroResourceAction);

    // NOT playable on Calendal (already bears one).
    expect(playable.some(a => a.attachToCharacterId === calendalId)).toBe(false);
    // Still playable on Luitprand (a different character in the company).
    expect(playable.some(a => a.attachToCharacterId === luitprandId)).toBe(true);
  });

  test('a single copy is playable on a character with no Thrall-ring yet', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [CALENDAL] }], hand: [THRALL_RING], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PHASE };

    const calendalId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const handCopy = findHandCardId(state, RESOURCE_PLAYER, THRALL_RING);

    const playable = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action).cardInstanceId === handCopy)
      .map(ea => ea.action as PlayHeroResourceAction);

    expect(playable.some(a => a.attachToCharacterId === calendalId)).toBe(true);
  });
});

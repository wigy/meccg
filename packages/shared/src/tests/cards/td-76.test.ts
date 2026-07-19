/**
 * @module td-76.test
 *
 * Card test: Times Are Evil (td-76)
 * Type: hazard-event, subtype Long-event, alignment neutral, non-unique.
 *
 * Text:
 *   "All offering attempts and influence attempts are modified by -3."
 *
 * A hazard long-event that, while in play, penalises **every** offering and
 * influence attempt made by **either** player by 3. Modeled by a single
 * `check-modifier` effect targeting the `influence` and `offering` check kinds
 * with `target: "all-in-play"` — the game-wide scope collected from a bare
 * in-play event in either player's `cardsInPlay` (contrast Great Army of the
 * North ba-38, whose `player-in-play` bonus benefits only its owner).
 *
 * "Offering attempts" (a METD check kind, shared with Foolish Words td-25) have
 * no distinct resolution flow in the engine; the concrete, testable mechanic is
 * the influence-attempt penalty, which the engine resolves through the faction
 * influence pipeline. Both check kinds are declared on the card so the modifier
 * fires for either once the engine models offering attempts, matching the
 * td-25 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                       | Status      |
 * |---|----------------------------------------------------------------------------|-------------|
 * | 1 | -3 to an influence attempt while the card is in the opponent's play area   | IMPLEMENTED |
 * | 2 | -3 also to the card owner's OWN influence attempts ("All", game-wide)      | IMPLEMENTED |
 * | 3 | No penalty when the card is not in play (baseline)                          | IMPLEMENTED |
 * | 4 | The -3 is applied at roll resolution: a roll that would pass at need 9 fails| IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   TIMES_ARE_EVIL (td-76)        - this card (hazard long-event)
 *   LAGDUF (le-18)                - orc character, DI 0, no effects (influencer)
 *   GOBLINS_GOBLIN_GATE (le-265)  - orc faction, influence # 9, at Goblin-gate
 *   GOBLIN_GATE (le-378)          - shadow-hold (home of GOBLINS_GOBLIN_GATE)
 *   CARN_DUM (le-359)             - minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions,
  makeSitePhase, firstFactionInfluenceAttempt,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay,
  FactionInfluenceRollAction,
} from '../../index.js';

const TIMES_ARE_EVIL = 'td-76' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

/** Builds a bare card-in-play entry (faction or bare long/permanent event). */
function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped };
}

/**
 * Build a site-phase state with Lagduf (orc, DI 0) at Goblin-gate holding
 * Goblins of Goblin-gate (inf# 9), and optionally Times Are Evil in one
 * player's `cardsInPlay`.
 */
function buildInfluenceState(opts: { taeOwner?: 0 | 1 }) {
  const taeEntry = inPlay(TIMES_ARE_EVIL, 'tae-1');
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
        hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        ...(opts.taeOwner === 0 ? { cardsInPlay: [taeEntry] } : {}),
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM],
        ...(opts.taeOwner === 1 ? { cardsInPlay: [taeEntry] } : {}),
      },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('Times Are Evil (td-76)', () => {
  beforeEach(() => resetMint());

  // ─── Display path (legal-actions/site.ts) ───────────────────────────────────

  test('baseline: influence attempt need is 9 with no Times Are Evil in play', () => {
    // Lagduf (DI 0) influencing Goblins of Goblin-gate (inf# 9): need = 9.
    const state = buildInfluenceState({});
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('adds -3 (need 9 → 12) when Times Are Evil sits in the OPPONENT play area', () => {
    // Game-wide: the opponent's copy still penalises the active player, unlike a
    // player-in-play bonus (ba-38) which only helps its own owner.
    const state = buildInfluenceState({ taeOwner: 1 });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(12);
  });

  test('adds -3 (need 9 → 12) even to the card owner’s OWN influence attempts', () => {
    // "All … influence attempts" — the modifier is not owner-scoped-to-benefit;
    // it hurts the influencing player even when they own the card.
    const state = buildInfluenceState({ taeOwner: 0 });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(12);
  });

  // ─── Resolution path (pending.ts display + reducer-site.ts roll) ─────────────

  test('the -3 is applied at roll resolution: a roll passing at need 9 fails at need 12', () => {
    // With Times Are Evil in play, resolve the full influence attempt with a raw
    // 2d6 total of 9. total = 9 + (-3) = 6 < influence # 9 → the attempt FAILS,
    // so the faction is not placed into play.
    const state = buildInfluenceState({ taeOwner: 1 });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    // Declare the attempt (opens the chain), then both players pass priority
    // until the chain resolves to the paused faction-influence-roll.
    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    // Pending faction-influence-roll: the displayed need reflects the -3.
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(12);

    // Force a raw roll total of 9 (would pass at need 9) and resolve.
    cur = { ...cur, cheatRollTotal: 9 };
    cur = dispatch(cur, rollActions[0].action);

    // -3 applied → total 6 < 9 → attempt failed → faction NOT in play.
    const inPlayDefIds = cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId);
    expect(inPlayDefIds).not.toContain(GOBLINS_GOBLIN_GATE);
  });

  test('control: the same raw roll of 9 succeeds when Times Are Evil is NOT in play', () => {
    // Baseline need 9, raw total 9 → 9 >= 9 → attempt succeeds → faction in play.
    const state = buildInfluenceState({});
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(9);

    cur = { ...cur, cheatRollTotal: 9 };
    cur = dispatch(cur, rollActions[0].action);

    const inPlayDefIds = cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId);
    expect(inPlayDefIds).toContain(GOBLINS_GOBLIN_GATE);
  });
});

/**
 * @module dm-8.test
 *
 * Card test: Elwen (dm-8) — CERTIFIED.
 * Type: minion-character (ringwraith alignment), race elf, Agent.
 * Stats: prowess 4, body 8, mind 5, direct influence 2, MP 2 (character).
 * Skills: warrior, diplomat. Homesite: Dol Amroth, Minas Tirith. Unique.
 *
 * Card text:
 *   "Unique. Agent. +2 direct influence against Elves and Elf Factions.
 *    Agent only: may move to a Haven [{H}]."
 *
 * Rules covered (real assertions, no JSON-vs-itself checks):
 *  1. stat-modifier direct-influence +2 during an influence-check when the
 *     target character's race is elf — lets Elwen (base DI 2) take an Elf of
 *     mind 4 as a follower that her base DI alone (2 < 4) could not afford.
 *  2. The +2 is race-gated: it does NOT apply to a non-Elf target (a mind-4
 *     Orc), so Elwen cannot control it.
 *  3. stat-modifier direct-influence +2 during a faction-influence-check when
 *     the faction's race is elf — reduces the influence need against an Elf
 *     faction (Wood-elves) by 2 relative to an otherwise-identical Elf
 *     influencer (Hendolen, DI 2, no bonus) at the same site.
 *  4. play-flag `agent-may-move-to-haven` ("Agent only: may move to a Haven"):
 *     Elwen acting as an agent IS offered a Haven [{H}] as an agent-move
 *     destination (overriding the rule-9.07 prohibition), whereas a plain agent
 *     (Bill Ferny dm-3) is not.
 *  5. The same grant suppresses the rule-9.07 reveal-time discard: an Elwen
 *     agent revealed with a Haven in its (otherwise legal) movement path is NOT
 *     discarded, whereas a plain agent (Bill Ferny) with a Haven in its path is.
 *
 * "Unique" is enforced by deck construction; documented here, not asserted.
 *
 * Fixtures use ringwraith characters/sites since Elwen is a ringwraith minion.
 * The Elf-faction path uses the hero Elf faction Wood-elves (tw-367): faction
 * playability is written on the faction card by site name (Thranduil's Halls),
 * which has a ringwraith version (le-408), so a ringwraith company can attempt
 * it — the pool has no minion-side Elf faction.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  viableActions, dispatch, findCharInstanceId, viablePlayCharacterActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, MORIA, MINAS_TIRITH,
  CardStatus, ZERO_EFFECTIVE_STATS,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, SiteInPlay,
  InfluenceAttemptAction, GameState, CharacterCard,
} from '../../index.js';
import { Phase, Alignment, computeLegalActions } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const ELWEN = 'dm-8' as CardDefinitionId;

// Influence-check (character) targets
const NIMLOTH = 'dm-20' as CardDefinitionId;  // elf, mind 4 (controllable at DI 4)
const UFTHAK = 'le-48' as CardDefinitionId;    // orc, mind 4 (NOT elf → no +2)

// Faction-influence-check fixtures
const HENDOLEN = 'le-15' as CardDefinitionId;         // elf, DI 2, no bonus (control)
const WOOD_ELVES = 'tw-367' as CardDefinitionId;      // elf faction, influence# 9
const THRANDUILS_HALLS = 'le-408' as CardDefinitionId; // ringwraith free-hold (Wood-elves plays here)

// Haven-movement fixtures
const BILL_FERNY = 'dm-3' as CardDefinitionId;   // plain agent, no Haven grant
const CAMETH_BRIN = 'le-358' as CardDefinitionId; // ringwraith border-hold (Rhudaur)
const CARN_DUM = 'le-359' as CardDefinitionId;    // ringwraith Haven (Angmar, adj. Rhudaur)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // ringwraith Haven (Imlad Morgul)
const MINAS_TIRITH_RW = 'le-391' as CardDefinitionId; // ringwraith Minas Tirith (Elwen home)
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // ringwraith Haven (scenery site)

/** Instance ids reused across the agent-move / reveal scenarios. */
const AGENT_ID = 'p2-elwen-agent' as CompanyId;
const AGENT_CHAR_ID = 'p2-elwen-char' as CardInstanceId;

describe('Elwen (dm-8)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +2 DI during influence-check (Elf characters) ────────────────
  // The only ringwraith Elves with mind <= 4 are themselves agents (home-site-
  // only), so — as for Fori dm-11 — the influence-check modifier is verified
  // directly via availableDI rather than by playing a follower.

  test('+2 DI bonus applies when checking influence against an Elf (availableDI = 4)', () => {
    // Elwen base DI = 2; +2 vs Elves → effective DI 4 against an Elf target.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const elfTargetDef = pool[NIMLOTH as string] as CharacterCard; // race elf
    expect(availableDI(state, elwenId, state.players[0], elfTargetDef)).toBe(4);
  });

  test('+2 DI bonus does NOT apply to a non-Elf character (availableDI stays 2)', () => {
    // Race-gated: against an Orc target Elwen's DI stays at her base 2.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const orcTargetDef = pool[UFTHAK as string] as CharacterCard; // race orc
    expect(availableDI(state, elwenId, state.players[0], orcTargetDef)).toBe(2);
  });

  test('Elwen cannot take a non-Elf mind-4 character (Orc) as a follower (DI 2 < 4)', () => {
    // Ufthak: orc, mind 4, playable at the Haven Minas Morgul. No Elf bonus
    // applies, so Elwen's DI 2 < 4 → she cannot control it (drives the reducer
    // path, complementing the direct availableDI checks above).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }],
          hand: [UFTHAK],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const underElwen = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === elwenId);

    expect(underElwen).toHaveLength(0);
  });

  // ─── Effect 2: +2 DI during faction-influence-check (Elf factions) ──────────

  test('+2 DI vs Elf factions lowers the influence need by 2 vs a plain Elf influencer', () => {
    // Elwen and Hendolen are both Elves with DI 2 in the same company at
    // Thranduil's Halls, both attempting to influence the Wood-elves (Elf
    // faction). Any faction-intrinsic modifier (Wood-elves gives +1 to an Elf
    // influencer) applies equally to both, so the only difference is Elwen's
    // "+2 direct influence against Elf Factions" → her need is exactly 2 lower.
    const state = buildMinionSitePhaseState({
      characters: [ELWEN, HENDOLEN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const hendolenId = findCharInstanceId(state, RESOURCE_PLAYER, HENDOLEN);

    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const elwenAttempt = attempts.find(a => a.influencingCharacterId === elwenId);
    const hendolenAttempt = attempts.find(a => a.influencingCharacterId === hendolenId);
    expect(elwenAttempt).toBeDefined();
    expect(hendolenAttempt).toBeDefined();
    expect(elwenAttempt!.need).toBe(hendolenAttempt!.need - 2);
    expect(elwenAttempt!.need).toBeLessThan(hendolenAttempt!.need);
  });

  // ─── Effect 3: "Agent only: may move to a Haven [{H}]" ──────────────────────

  test('Elwen agent IS offered a Haven as an agent-move destination', () => {
    // Elwen agent standing at Cameth Brin (Rhudaur). Carn Dûm (a ringwraith
    // Haven in Angmar, an adjacent region) is a legal agent-move destination
    // ONLY because Elwen's card grants Haven movement.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });

    const carnDumInstanceId = state.players[HAZARD_PLAYER].siteDeck.find(s => s.definitionId === CARN_DUM)!.instanceId;

    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: {
        instanceId: AGENT_CHAR_ID, definitionId: ELWEN, status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      },
      revealed: true,
      siteStack: [{ instanceId: 'p2-elwen-cameth' as CardInstanceId, definitionId: CAMETH_BRIN, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], agents: [agent] }] as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moves = viableActions(withAgent, PLAYER_2, 'agent-move');
    const toCarnDum = moves.filter(a =>
      (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId === carnDumInstanceId,
    );
    expect(toCarnDum).toHaveLength(1);
  });

  test('a plain agent (Bill Ferny) is NOT offered the same Haven destination', () => {
    // Identical setup with Bill Ferny (no Haven grant) → rule 9.07 blocks it.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });

    const carnDumInstanceId = state.players[HAZARD_PLAYER].siteDeck.find(s => s.definitionId === CARN_DUM)!.instanceId;

    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: {
        instanceId: AGENT_CHAR_ID, definitionId: BILL_FERNY, status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      },
      revealed: true,
      siteStack: [{ instanceId: 'p2-ferny-cameth' as CardInstanceId, definitionId: CAMETH_BRIN, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], agents: [agent] }] as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moves = viableActions(withAgent, PLAYER_2, 'agent-move');
    const toCarnDum = moves.filter(a =>
      (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId === carnDumInstanceId,
    );
    expect(toCarnDum).toHaveLength(0);
  });

  // ─── Effect 3 (reveal path): Haven in movement path does not discard Elwen ──

  test('Elwen revealed with a Haven in her (legal) path is NOT discarded', () => {
    // Elwen moved (face-down) through Minas Morgul (a Haven) and reveals at her
    // home site Minas Tirith. The Minas Morgul → Minas Tirith hop is legal
    // region movement, so the only rule that could discard her is the 9.07
    // "moved through a Haven" rule — which her card grant suppresses.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [MINAS_TIRITH_RW] },
      ],
    });

    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: {
        instanceId: AGENT_CHAR_ID, definitionId: ELWEN, status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      },
      revealed: false,
      siteStack: [{ instanceId: 'p2-elwen-mm' as CardInstanceId, definitionId: MINAS_MORGUL, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], agents: [agent] }] as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const [revealAction] = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    expect(revealAction).toBeDefined();
    const after = dispatch(withAgent, revealAction.action);

    expect(after.players[HAZARD_PLAYER].agents.some(a => a.id === AGENT_ID)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(false);
  });

  test('a plain agent (Bill Ferny) revealed with a Haven in its path IS discarded', () => {
    // Same shape with Bill Ferny (no grant): moved through Carn Dûm (a Haven)
    // and reveals at his home Cameth Brin (a legal, adjacent hop) → rule 9.07
    // discards him.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HENDOLEN] }], hand: [], siteDeck: [CAMETH_BRIN] },
      ],
    });

    const havenEntry: SiteInPlay = { instanceId: 'p2-ferny-carndum' as CardInstanceId, definitionId: CARN_DUM, status: CardStatus.Untapped };
    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: {
        instanceId: AGENT_CHAR_ID, definitionId: BILL_FERNY, status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      },
      revealed: false,
      siteStack: [havenEntry],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], agents: [agent] }] as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const [revealAction] = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    expect(revealAction).toBeDefined();
    const after = dispatch(withAgent, revealAction.action);

    expect(after.players[HAZARD_PLAYER].agents.some(a => a.id === AGENT_ID)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
  });
});

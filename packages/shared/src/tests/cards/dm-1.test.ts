/**
 * @module dm-1.test
 *
 * Card test: Anarin (dm-1)
 * Type: minion-character (agent, Ringwraith alignment)
 *
 * Text: "Unique. Agent. Agent only: may move to a Haven [{H}] and may tap at
 *  a company's new site to attack that company during opponent's
 *  movement/hazard phase."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race elf, keywords ["agent"], prowess 4, body 8, mind 7, directInfluence 3,
 *   marshallingPoints 2, skills scout/diplomat, homesite "Moria". Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                            | Status | Notes                                                |
 * |---|--------------------------------------------------------------|--------|-------------------------------------------------------|
 * | 1 | "Agent."                                                    | OK     | agent keyword; deployed/driven as agent                |
 * | 2 | "Agent only: may move to a Haven [{H}]"                     | OK     | play-flag agent-may-move-to-haven (agent-move exemption, precedent: Elwen dm-8) |
 * | 3 | "may tap at a company's new site to attack that company     | OK     | agent-tap-attack, prowessBonus 0 (precedent: The Grimburgoth dm-15) |
 * |   | during opponent's movement/hazard phase"                    |        |                                                         |
 *
 * Playable: YES
 *
 * Both mechanics are pre-existing reusable DSL primitives (see
 * docs/certification-engine-support.md) exercised generically by dm-8 and
 * dm-15's own card tests; the tests below confirm Anarin's card correctly
 * wires the two effects rather than re-deriving the underlying mechanics.
 *
 * Rules exercised:
 * 1. "Agent only: may move to a Haven [{H}]": Anarin-as-agent at Amon Hen
 *    (nearest haven Minas Morgul) may move to Minas Morgul (a haven) as well
 *    as to a non-haven (Edoras) — the haven-move ban (rule 9.07) is lifted by
 *    the play-flag.
 * 2. "may tap ... to attack that company during opponent's movement/hazard
 *    phase": Anarin, face-up at his home site (Moria) when a hero company
 *    moves there, may tap to attack with prowess 4 (base) + 2 (at-home
 *    face-up bonus) + 0 (card's own prowessBonus — no printed bonus, unlike
 *    Grimburgoth's +2) = 6, body 8 + 1 = 9.
 * 3. Face-down, not at home: prowess 4 (base) + 2 (face-down bonus) + 0
 *    (effect) = 6, confirming the effect's prowessBonus really is 0 and not
 *    accidentally copied from Grimburgoth's +2.
 *
 * Fixtures:
 *   ANARIN (dm-1)          — minion elf agent under test
 *   BILL_FERNY (dm-3)      — plain minion agent, no haven exemption (unused directly, kept for parity with dm-8 pattern if needed)
 *   MINAS_MORGUL (le-390)  — minion haven (Amon Hen's nearest haven; move target)
 *   AMON_HEN (le-349)      — minion ruins-and-lairs, Rohan (agent start site)
 *   EDORAS (le-372)        — minion free-hold, Rohan (non-haven move target)
 *   DOL_GULDUR (le-367)    — minion haven (site-deck filler)
 *   ARAGORN, LEGOLAS       — hero characters for the moving/hazard-side companies
 *   MORIA_SITE (le-392)    — Anarin's home site (minion shadow-hold "Moria")
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, LORIEN,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../index.js';
import { Phase, CardStatus, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const AMON_HEN = 'le-349' as CardDefinitionId;     // minion ruins-and-lairs, Rohan
const EDORAS = 'le-372' as CardDefinitionId;       // minion free-hold, Rohan
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MORIA_SITE = 'le-392' as CardDefinitionId;   // minion shadow-hold, Anarin's homesite

describe('Anarin (dm-1)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Agent only: may move to a Haven [{H}]" ──────────────────────────

  test('Anarin-as-agent at Amon Hen may move to a Haven (Minas Morgul) as well as a non-haven (Edoras)', () => {
    // Amon Hen (ruins-and-lairs, Rohan) has nearest haven Minas Morgul, and
    // Edoras (free-hold) is in Rohan → both reachable. Normally agents cannot
    // move to a haven (rule 9.07); Anarin's exemption keeps Minas Morgul legal.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const amonHenStackSite: SiteInPlay = {
      instanceId: 'anarin-start-amonhen' as CardInstanceId,
      definitionId: AMON_HEN,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'anarin-agent-char' as CardInstanceId,
      definitionId: ANARIN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agent: AgentInPlay = {
      id: 'agent-anarin-0' as CompanyId,
      character: agentChar,
      revealed: true,
      siteStack: [amonHenStackSite],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const minasMorgulId = 'dest-minas-morgul' as CardInstanceId;
    const edorasId = 'dest-edoras' as CardInstanceId;
    const withAgent = {
      ...base,
      players: [
        base.players[0],
        {
          ...base.players[1],
          agents: [agent],
          siteDeck: [
            { instanceId: minasMorgulId, definitionId: MINAS_MORGUL },
            { instanceId: edorasId, definitionId: EDORAS },
          ],
        },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    const destIds = moveActions.map(a => (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId);

    // The haven destination is legal thanks to Anarin's exemption...
    expect(destIds).toContain(minasMorgulId);
    // ...and the ordinary non-haven destination is still legal (proves the
    // exemption is additive, not a blanket "everything reachable").
    expect(destIds).toContain(edorasId);
  });

  // ── Rule: "may tap at a company's new site to attack that company during
  //          opponent's movement/hazard phase" ───────────────────────────────

  test('face-up Anarin at his home site (Moria) offers agent-tap-attack with no printed prowess bonus', () => {
    // Anarin is face-up at Moria (his home). Hero company is moving to Moria.
    // Prowess: 4 (base) + 2 (at-home, face-up) + 0 (Anarin's own prowessBonus) = 6.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: MORIA_SITE }],
          hand: [],
          siteDeck: [MORIA_SITE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const homeSiteInPlay: SiteInPlay = {
      instanceId: 'anarin-moria-site' as CardInstanceId,
      definitionId: MORIA_SITE,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'anarin-agent-char-2' as CardInstanceId,
      definitionId: ANARIN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agent: AgentInPlay = {
      id: 'agent-anarin-1' as CompanyId,
      character: agentChar,
      revealed: true,
      siteStack: [homeSiteInPlay],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Moria' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions.length).toBe(1);

    const after = dispatch(withAgent, attackActions[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource).toMatchObject({ type: 'agent', instanceId: 'anarin-agent-char-2' });
    // Prowess: 4 (base) + 2 (at-home face-up) + 0 (no printed bonus) = 6.
    expect(after.combat!.strikeProwess).toBe(6);
    // Rule 3.iv.6.1: at home the agent also gets +1 body — 8 (base) + 1 = 9.
    expect(after.combat!.creatureBody).toBe(9);

    const agentAfter = after.players[1].agents.find(a => a.character.instanceId === 'anarin-agent-char-2');
    expect(agentAfter).toBeDefined();
    expect(agentAfter!.character.status).toBe(CardStatus.Tapped);
    // Not an agent action — remainingActions unchanged.
    expect(agentAfter!.remainingActions).toBe(1);
  });

  test('face-down Anarin away from home reveals with the face-down (not-at-home) bonus and no printed prowess bonus', () => {
    // Anarin is face-down at a non-home site. Company moves there.
    // Prowess: 4 (base) + 2 (face-down, not at home) + 0 (effect) = 6, distinct
    // from Grimburgoth's +2 bonus at the same tier (which would total 8).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const dolGuldurStackSite: SiteInPlay = {
      instanceId: 'anarin-dolguldur-site' as CardInstanceId,
      definitionId: DOL_GULDUR,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'anarin-agent-char-3' as CardInstanceId,
      definitionId: ANARIN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const faceDownAgent: AgentInPlay = {
      id: 'agent-anarin-2' as CompanyId,
      character: agentChar,
      revealed: false,
      siteStack: [dolGuldurStackSite],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [faceDownAgent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions.length).toBe(1);

    const after = dispatch(withAgent, attackActions[0].action);

    expect(after.combat).not.toBeNull();
    // Prowess: 4 + 2 (face-down, not at home) + 0 (Anarin's bonus) = 6.
    expect(after.combat!.strikeProwess).toBe(6);
    // Not at home — no +1 body bonus: base 8.
    expect(after.combat!.creatureBody).toBe(8);

    const agentAfter = after.players[1].agents.find(a => a.character.instanceId === 'anarin-agent-char-3');
    expect(agentAfter).toBeDefined();
    expect(agentAfter!.revealed).toBe(true);
    expect(agentAfter!.character.status).toBe(CardStatus.Tapped);
  });
});

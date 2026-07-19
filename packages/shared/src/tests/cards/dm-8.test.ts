/**
 * @module dm-8.test
 *
 * Card test: Elwen (dm-8)
 * Type: minion-character (agent, Ringwraith alignment)
 *
 * Text: "Unique. Agent. +2 direct influence against Elves and Elf Factions.
 *  Agent only: may move to a Haven [{H}]."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race elf, keywords ["agent"], prowess 4, body 8, mind 5, directInfluence 2,
 *   marshallingPoints 2, skills warrior/diplomat, homesite "Dol Amroth, Minas
 *   Tirith". Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                       | Status      | Notes                                                    |
 * |---|--------------------------------------------------------|-------------|----------------------------------------------------------|
 * | 1 | "Agent."                                               | OK          | agent keyword; deployed/driven as agent                  |
 * | 2 | "+2 direct influence against Elves"                    | OK          | stat-modifier, influence-check, target.race=elf          |
 * | 3 | "+2 direct influence against Elves and Elf Factions"   | OK          | stat-modifier, opponent-influence-check, target.race=elf |
 * | 4 | "Agent only: may move to a Haven [{H}]."               | OK          | play-flag agent-may-move-to-haven (agent-move exemption) |
 *
 * Playable: YES
 *
 * Notes on scope:
 *   Elwen is a MINION elf. Her "+2 against Elves and Elf Factions" is exercised
 *   on the two influence paths a minion actually uses against elves:
 *     - influence-check: controlling a (minion) elf character as a follower.
 *     - opponent-influence-check: seizing an opponent's elf character or elf
 *       faction (the faction bonus). The opponent-influence target context
 *       carries the target's race for both characters and factions, so a single
 *       `target.race: "elf"` clause covers "Elves and Elf Factions" on the steal
 *       path. There is no minion elf faction, so the site-phase
 *       faction-influence roll is never reachable for an elf faction and is left
 *       out deliberately.
 *
 * Rules exercised:
 * 1. +2 DI vs Elves (follower control): Elwen (base DI 2) can take an elf
 *    (Nimloth, mind 4) as a follower — avail DI 2+2=4 >= 4 — but cannot take a
 *    non-elf of the same mind (Orc Chieftain, orc, mind 4) — avail DI stays 2.
 * 2. The bonus is conditional: it does not inflate Elwen's effective DI stat.
 * 3. +2 DI vs Elves on an opponent-influence attempt against an elf character.
 * 4. +2 DI vs Elf Factions on an opponent-influence attempt against an elf
 *    faction; no bonus against a non-elf faction.
 * 5. "Agent only: may move to a Haven": Elwen-as-agent at Amon Hen (nearest
 *    haven Minas Morgul) may move to Minas Morgul (a haven) as well as to a
 *    non-haven (Edoras). A plain agent without the exemption (Bill Ferny)
 *    cannot move to the haven but can still move to Edoras.
 *
 * Fixtures:
 *   ELWEN (dm-8)          — minion elf agent, DI 2, +2 vs elves/elf factions
 *   NIMLOTH (dm-20)       — minion elf, mind 4 (elf follower / opponent elf char)
 *   ORC_CHIEFTAIN (le-32) — minion orc, mind 4 (non-elf mirror, follower)
 *   CIRYAHER (le-6)       — minion dúnadan, mind 5 (non-elf opponent char)
 *   WOOD_ELVES (tw-367)   — elf faction (opponent elf faction target)
 *   SNAGA_HAI (le-286)    — orc faction (non-elf faction mirror)
 *   BILL_FERNY (dm-3)     — plain minion agent, no haven exemption (control)
 *   MINAS_MORGUL (le-390) — minion haven (Amon Hen's nearest haven; move target)
 *   AMON_HEN (le-349)     — minion ruins-and-lairs, Rohan (agent start site)
 *   EDORAS (le-372)       — minion free-hold, Rohan (non-haven move target)
 *   MORIA (le-392)        — minion shadow-hold (opponent-influence co-location)
 *   DOL_GULDUR (le-367)   — minion haven (site-deck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, findCharInstanceId, viableActions,
  addCardInPlay, dispatchResult,
  firstOpponentInfluenceAttempt, getCharacter, pool,
  makeMHState, makeSitePhase, CardStatus,
} from '../test-helpers.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { Phase, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, GameState,
  CharacterCard, CharacterInPlay, SiteInPlay, AgentInPlay,
} from '../../index.js';

const ELWEN = 'dm-8' as CardDefinitionId;
const NIMLOTH = 'dm-20' as CardDefinitionId;       // minion elf, mind 4
const ORC_CHIEFTAIN = 'le-32' as CardDefinitionId; // minion orc, mind 4
const CIRYAHER = 'le-6' as CardDefinitionId;        // minion dúnadan, mind 5
const WOOD_ELVES = 'tw-367' as CardDefinitionId;   // elf faction
const SNAGA_HAI = 'le-286' as CardDefinitionId;    // orc faction
const BILL_FERNY = 'dm-3' as CardDefinitionId;     // plain minion agent (no haven exemption)

const THRANDUILS_HALLS = 'le-408' as CardDefinitionId; // minion free-hold (Wood-elves' playable site)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const AMON_HEN = 'le-349' as CardDefinitionId;     // minion ruins-and-lairs, Rohan
const EDORAS = 'le-372' as CardDefinitionId;       // minion free-hold, Rohan
const MORIA = 'le-392' as CardDefinitionId;        // minion shadow-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Elwen (dm-8)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "+2 direct influence against Elves" — follower-control DI ─────────

  test('+2 DI vs Elves raises Elwen\'s available DI when controlling an elf (Nimloth)', () => {
    // The follower-control influence check (reason: influence-check) resolves
    // Elwen's conditional DI against the target's race. Against an elf target
    // (Nimloth) the bonus fires: base DI 2 + 2 = 4 (>= Nimloth's mind 4 → she
    // could take him as a follower). With no specific target it does not fire.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const nimlothDef = pool[NIMLOTH as string] as CharacterCard;
    expect(availableDI(state, elwenId, state.players[RESOURCE_PLAYER], nimlothDef)).toBe(4);
    expect(availableDI(state, elwenId, state.players[RESOURCE_PLAYER])).toBe(2);
  });

  test('+2 DI bonus does NOT apply when controlling a non-elf (Orc Chieftain)', () => {
    // Orc Chieftain is an orc (NOT an elf). Elwen's bonus is race-gated, so
    // her available DI against him stays at the base 2 (< his mind 4).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    const orcDef = pool[ORC_CHIEFTAIN as string] as CharacterCard;
    expect(availableDI(state, elwenId, state.players[RESOURCE_PLAYER], orcDef)).toBe(2);
  });

  test('the +2 bonus is conditional — it does not inflate Elwen\'s effective DI stat', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, ELWEN).effectiveStats.directInfluence).toBe(2);
  });

  // ── Rule: "+2 direct influence against Elves and Elf Factions" — steal ──────

  test('+2 DI vs Elves applies to an opponent-influence attempt against an elf character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [NIMLOTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const nimlothId = findCharInstanceId(state, HAZARD_PLAYER, NIMLOTH);

    const attempt = firstOpponentInfluenceAttempt(state, nimlothId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Elwen base DI 2 + 2 (vs an elf) = 4.
    expect(pending.kind.attempt.influencerDI).toBe(4);
  });

  test('no +2 DI on an opponent-influence attempt against a non-elf character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);

    const attempt = firstOpponentInfluenceAttempt(state, ciryaherId);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Non-elf target → no bonus: base DI 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  test('+2 DI vs Elf Factions applies to an opponent-influence attempt against an elf faction', () => {
    // Re-influencing an in-play faction requires the active company to be at a
    // site where the faction is playable — Wood-elves is playable at
    // Thranduil's Halls, so Elwen's company sits there.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THRANDUILS_HALLS, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: THRANDUILS_HALLS, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, WOOD_ELVES);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WOOD_ELVES)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Elf faction target → +2: base DI 2 + 2 = 4.
    expect(pending.kind.attempt.influencerDI).toBe(4);
  });

  test('no +2 DI on an opponent-influence attempt against a non-elf faction', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [ELWEN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, SNAGA_HAI);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SNAGA_HAI)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Non-elf faction → no bonus: base DI 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  // ── Rule: "Agent only: may move to a Haven [{H}]." ─────────────────────────

  test('Elwen-as-agent at Amon Hen may move to a Haven (Minas Morgul) as well as a non-haven (Edoras)', () => {
    // Amon Hen (ruins-and-lairs, Rohan) has nearest haven Minas Morgul, and
    // Edoras (free-hold) is in Rohan → both reachable. Normally agents cannot
    // move to a haven (rule 9.07); Elwen's exemption keeps Minas Morgul legal.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const amonHenStackSite: SiteInPlay = {
      instanceId: 'elwen-start-amonhen' as CardInstanceId,
      definitionId: AMON_HEN,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'elwen-agent-char' as CardInstanceId,
      definitionId: ELWEN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agent: AgentInPlay = {
      id: 'agent-elwen-0' as CompanyId,
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
    const withAgent: GameState = {
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

    // The haven destination is legal thanks to Elwen's exemption...
    expect(destIds).toContain(minasMorgulId);
    // ...and the ordinary non-haven destination is still legal (proves the
    // exemption is additive, not a blanket "everything reachable").
    expect(destIds).toContain(edorasId);
  });

  test('a plain agent (Bill Ferny) at Amon Hen may NOT move to the Haven — only the non-haven Edoras', () => {
    // Control for the previous test: an agent WITHOUT the exemption obeys the
    // default rule-9.07 haven ban. Same start site, same site deck.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const amonHenStackSite: SiteInPlay = {
      instanceId: 'ferny-start-amonhen' as CardInstanceId,
      definitionId: AMON_HEN,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'ferny-agent-char' as CardInstanceId,
      definitionId: BILL_FERNY,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agent: AgentInPlay = {
      id: 'agent-ferny-0' as CompanyId,
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
    const withAgent: GameState = {
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

    expect(destIds).not.toContain(minasMorgulId);
    expect(destIds).toContain(edorasId);
  });
});

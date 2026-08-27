/**
 * @module dm-61.test
 *
 * Card test: Good Sense Revolts (dm-61)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped agent. Tap the agent who may then make an
 * influence attempt against an ally, faction, or character. +4 to influence
 * attempt. +8 if ally, faction, or character is playable at agent's home
 * site. Alternatively, modify an influence attempt by an agent by +4. This
 * card cannot serve both functions. Cannot be played if your opponent is a
 * minion player."
 *
 * Card shape:
 *   - effects[0]: agent-tap-multi-influence
 *     (targetKinds: character/ally/faction, attemptBonus 4, attemptBonusAtHomeSite 8)
 *   - effects[1]: agent-influence-boost (attemptBonus 4)
 *
 * Engine support:
 *   - Legal actions (legal-actions/movement-hazard.ts): mode A offers one
 *     `play-hazard` per (untapped agent, opponent character/ally in the
 *     active company at the agent's current site, or opponent faction
 *     playable at the agent's site) — no `agentFilter`, unlike dm-96. Mode B
 *     offers one `play-hazard` per own agent regardless of tap status. Both
 *     are gated off against a minion opponent (isMinionOrBalrog).
 *   - Reducer mode A (mh-agents.ts handleAgentTapMultiInfluence): taps AND
 *     reveals the agent, discards the event, counts the hazard, and enqueues
 *     the standard `opponent-influence-defend` resolution carrying the
 *     rule-10.14 bonuses (+2 DI at agent's home; target shares/is playable at
 *     agent's home → value/mind 0, +2 roll) plus this card's own tiered bonus
 *     (+4, or +8 when that same home-site condition holds) as the attempt's
 *     `boostModifier`.
 *   - Reducer mode B (mh-agents.ts handleAgentInfluenceBoost): banks a
 *     one-shot `check-modifier` constraint (check "influence", `when: {
 *     reason: "opponent-influence-check" }`) on the chosen agent via
 *     `addConstraint`, without tapping or revealing it. Consumed by
 *     `foldAgentInfluenceBoost`, wired into both the native
 *     `agent-tap-influence` ability path (handleAgentInfluenceAttempt) and
 *     this card's own mode A (handleAgentTapMultiInfluence).
 *
 * Fixtures: hazard player (PLAYER_2, Ringwraith) holds Good Sense Revolts and
 * a face-down untapped Gergeli (dm-12 — agent, DI 2, home sites Shrel-Kain /
 * Lake-town / Easterling Camp) or Lobelia (dm-28 — agent with a native
 * `agent-tap-influence` ability, DI 1, home Bag End/Bree). The hero opponent
 * (PLAYER_1, Wizard) fields Bard Bowman (tw-124, mind 2, home Lake-town —
 * shares a home site with Gergeli) and Elladan (tw-143, mind 4, home
 * Rivendell — does not) in a company at Lórien (tw-408), and has a faction in
 * play: Men of Dorwinion (tw-278, playable at Shrel-Kain) or Men of Anórien
 * (tw-277, influence 8, playable at Minas Tirith).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, makeMHState, makeAgent, addCardInPlay, attachAllyToChar,
  dispatch, viableActions, mint, findCharInstanceId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, PlayHazardAction, AgentInPlay,
  SiteInPlay, MovementHazardPhaseState, PendingResolution, OpponentInfluenceAttempt,
} from '../../index.js';

const GOOD_SENSE_REVOLTS = 'dm-61' as CardDefinitionId;
const GERGELI = 'dm-12' as CardDefinitionId;             // agent, DI 2, homes Shrel-Kain/Lake-town/Easterling Camp
const LOBELIA = 'dm-28' as CardDefinitionId;              // agent w/ native agent-tap-influence, DI 1, home Bag End/Bree
const BARD_BOWMAN = 'tw-124' as CardDefinitionId;         // hero character, mind 2, home Lake-town (shares w/ Gergeli)
const ELLADAN = 'tw-143' as CardDefinitionId;             // hero character, mind 4, home Rivendell (no overlap)
const NOBLE_HOUND = 'dm-179' as CardDefinitionId;         // hero ally, mind 1
const MEN_OF_DORWINION = 'tw-278' as CardDefinitionId;    // hero faction @ Shrel-Kain
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;      // hero faction @ Minas Tirith, influence 8
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // hero faction @ Bree
const MINAS_TIRITH_MINION = 'le-391' as CardDefinitionId;
const LORIEN = 'tw-408' as CardDefinitionId;              // hero haven "Lórien" — active company's site
const AS_LORIEN = 'as-155' as CardDefinitionId;           // minion-aligned site also named "Lórien"
const MINION_BREE = 'le-356' as CardDefinitionId;         // minion-aligned "Bree" — Lobelia's 2nd home site

/** The queued influence attempt, or undefined when none was enqueued. */
function queuedAttempt(state: GameState): OpponentInfluenceAttempt | undefined {
  const pending = state.pendingResolutions.find(
    (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
  );
  if (!pending || pending.kind.type !== 'opponent-influence-defend') return undefined;
  return pending.kind.attempt;
}

describe('Good Sense Revolts (dm-61)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, Ringwraith) holds Good Sense Revolts and an
   * agent; the hero opponent (PLAYER_1) fields a two-character company (Bard
   * Bowman + Elladan) at Lórien and, optionally, one faction in play.
   */
  function baseState(opts?: {
    agent?: CardDefinitionId;
    agentTapped?: boolean;
    agentSite?: CardDefinitionId;
    faction?: CardDefinitionId;
    opponentMinion?: boolean;
    hand?: CardDefinitionId[];
  }): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: opts?.opponentMinion ? Alignment.Ringwraith : Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [BARD_BOWMAN, ELLADAN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: AS_LORIEN, characters: [] }],
          hand: opts?.hand ?? [GOOD_SENSE_REVOLTS],
          siteDeck: [],
        },
      ],
    });

    const built = makeAgent(opts?.agent ?? GERGELI);
    const agent: AgentInPlay = {
      ...built,
      character: {
        ...built.character,
        status: opts?.agentTapped ? CardStatus.Tapped : CardStatus.Untapped,
      },
      siteStack: opts?.agentSite
        ? [{ instanceId: mint(), definitionId: opts.agentSite, status: CardStatus.Untapped } as SiteInPlay]
        : [],
      revealed: opts?.agentSite !== undefined,
    };

    const withAgent: GameState = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };

    return opts?.faction ? addCardInPlay(withAgent, RESOURCE_PLAYER, opts.faction) : withAgent;
  }

  function agentId(state: GameState): string {
    return state.players[HAZARD_PLAYER].agents[0].character.instanceId as string;
  }

  // ─── Playability: both modes offered on one card ──────────────────────────

  test('mode A offers character and ally targets; mode B offers the agent itself', () => {
    // Gergeli's site stack is at "Lórien" (matching the active company's
    // site), so character/ally targets are reachable; faction targeting has
    // its own site requirement and is covered by dedicated tests below.
    let state = baseState({ agentSite: AS_LORIEN });
    state = attachAllyToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, NOBLE_HOUND);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);

    const characterTargets = plays.filter(a => a.targetCharacterId);
    const allyTargets = plays.filter(a => a.targetAllyId);
    const boostOnly = plays.filter(a => !a.targetCharacterId && !a.targetAllyId && !a.targetFactionInstanceId);

    expect(characterTargets).toHaveLength(2); // Bard Bowman + Elladan
    expect(allyTargets).toHaveLength(1);      // Noble Hound
    expect(boostOnly).toHaveLength(1);        // mode B: the agent itself (Gergeli)
    expect(boostOnly[0].agentInstanceId).toBe(agentId(state));
  });

  test('mode A also offers a faction target when the agent stands where it is playable', () => {
    const state = baseState({ faction: MEN_OF_DORWINION }); // Gergeli defaults to his home Shrel-Kain
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    expect(plays.filter(a => a.targetFactionInstanceId)).toHaveLength(1);
    expect(plays.filter(a => !a.targetCharacterId && !a.targetAllyId && !a.targetFactionInstanceId)).toHaveLength(1);
  });

  test('mode A requires an untapped agent; mode B does not', () => {
    const state = baseState({ agentTapped: true, agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    expect(plays.every(a => !a.targetCharacterId && !a.targetAllyId && !a.targetFactionInstanceId)).toBe(true);
    expect(plays).toHaveLength(1); // only mode B, banking the boost on the tapped agent
  });

  test('NOT playable (either mode) against a minion opponent', () => {
    const state = baseState({ opponentMinion: true, agentSite: AS_LORIEN });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Mode A: "Tap the agent who may then make an influence attempt" ───────

  test('playing mode A on a character target taps and reveals the agent and discards the event', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetCharacterId)!;
    const after = dispatch(state, action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.revealed).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === GOOD_SENSE_REVOLTS)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany)
      .toBe((state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany + 1);
    // Not an agent action.
    expect(agent.remainingActions).toBe(state.players[HAZARD_PLAYER].agents[0].remainingActions);
  });

  // ─── "+4 ... +8 if ... playable at agent's home site" — character target ──

  test('character target NOT sharing a home site: +4 bonus, full mind, no rule-10.14 zeroing', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const elladanId = findCharInstanceId(state, RESOURCE_PLAYER, ELLADAN);
    const action = plays.find(a => a.targetCharacterId === elladanId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(4);
    expect(attempt.targetMind).toBe(4); // Elladan's full mind, not zeroed
    expect(attempt.influencerDI).toBe(2); // Gergeli away from his own home: no +2
    expect(attempt.targetKind).toBe('character');
  });

  test('character target sharing a home site with the agent: +8 bonus, mind zeroed, +2 roll', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const action = plays.find(a => a.targetCharacterId === bardId)!;
    const played = dispatch({ ...state, cheatRollTotal: 7 }, action);
    const attempt = queuedAttempt(played)!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(8); // Lake-town is one of Gergeli's home sites
    expect(attempt.targetMind).toBe(0);    // rule 10.14: shared home → mind 0
    expect(attempt.attackerRoll).toBe(9);  // 7 + 2 (rule-10.14 roll bonus)
  });

  // ─── Ally target ────────────────────────────────────────────────────────

  test('ally target: +4 bonus, full mind (allies carry no printed home site)', () => {
    let state = baseState({ agentSite: AS_LORIEN });
    state = attachAllyToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, NOBLE_HOUND);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetAllyId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(4);
    expect(attempt.targetMind).toBe(1); // Noble Hound's mind, not zeroed
    expect(attempt.targetKind).toBe('ally');
  });

  // ─── Faction target ─────────────────────────────────────────────────────

  test('faction target away from the agent home: +4 bonus, full influence value', () => {
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(4);
    expect(attempt.targetMind).toBe(8);   // full influence value
    expect(attempt.influencerDI).toBe(2); // no home-site DI bonus
    expect(attempt.targetKind).toBe('faction');
  });

  test('faction target playable at the agent home: +8 bonus, value zeroed, +2 roll, +2 DI', () => {
    const state = baseState({ faction: MEN_OF_DORWINION }); // Gergeli defaults to his home Shrel-Kain
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(8);
    expect(attempt.targetMind).toBe(0);
    expect(attempt.influencerDI).toBe(4); // Gergeli DI 2 + 2 (at home)
  });

  test('full resolution: the +8 boost carries a marginal attempt to success', () => {
    const state = baseState({ faction: MEN_OF_DORWINION });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    // autoSuccess is dm-96-only; this card always rolls. Value is zeroed
    // (home), and with opponentGI 14 and the cross-alignment -5, the +8 boost
    // is what carries it: 12 + 4 - 14 - 2 - 0 - 5 - 0 + 8 = 3 > 0.
    const played = dispatch({ ...state, cheatRollTotal: 10 }, action);
    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_DORWINION)).toBe(true);
  });

  // ─── Mode B: "Alternatively, modify an influence attempt by an agent" ─────

  test('mode B banks a boost without tapping or revealing the agent', () => {
    const state = baseState({ agentTapped: true });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const after = dispatch(state, plays[0].action);

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped); // unchanged (was already tapped)
    expect(agent.revealed).toBe(false);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === GOOD_SENSE_REVOLTS)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany)
      .toBe((state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany + 1);

    const boost = after.activeConstraints.find(c => c.kind.type === 'check-modifier');
    expect(boost).toBeDefined();
    if (boost && boost.kind.type === 'check-modifier') {
      expect(boost.kind.value).toBe(4);
      expect(boost.kind.check).toBe('influence');
      expect(boost.target).toEqual({ kind: 'character', characterId: agent.character.instanceId });
    }
  });

  test('a banked mode-B boost is consumed by the same agent\'s native agent-tap-influence attempt', () => {
    const state = baseState({ agent: LOBELIA, agentSite: MINION_BREE, faction: RANGERS_OF_THE_NORTH });
    // Play Good Sense Revolts as mode B on Lobelia (not mode A — Rangers of
    // the North is also reachable there, so both modes are on offer).
    const boostPlay = viableActions(state, PLAYER_2, 'play-hazard')
      .map(p => p.action as PlayHazardAction)
      .find(a => !a.targetCharacterId && !a.targetAllyId && !a.targetFactionInstanceId)!;
    expect(boostPlay).toBeDefined();
    const boosted = dispatch(state, boostPlay);
    expect(boosted.activeConstraints.some(c => c.kind.type === 'check-modifier')).toBe(true);

    // Lobelia's own native ability now makes a faction influence attempt.
    const nativePlays = viableActions(boosted, PLAYER_2, 'agent-influence-attempt');
    const factionPlay = nativePlays.find(p => (p.action as { targetKind?: string }).targetKind === 'faction')!;
    expect(factionPlay).toBeDefined();
    const resolved = dispatch(boosted, factionPlay.action);
    const attempt = queuedAttempt(resolved)!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(4);
    // The one-shot boost is consumed.
    expect(resolved.activeConstraints.some(c => c.kind.type === 'check-modifier')).toBe(false);
  });

  test('a banked mode-B boost stacks with a second copy\'s mode-A tiered bonus on the same agent', () => {
    const state = baseState({ faction: MEN_OF_DORWINION, hand: [GOOD_SENSE_REVOLTS, GOOD_SENSE_REVOLTS] });
    const boostPlay = viableActions(state, PLAYER_2, 'play-hazard')
      .map(p => p.action as PlayHazardAction)
      .find(a => !a.targetCharacterId && !a.targetAllyId && !a.targetFactionInstanceId)!;
    const boosted = dispatch(state, boostPlay);
    expect(boosted.players[HAZARD_PLAYER].hand).toHaveLength(1);
    expect(boosted.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Untapped);

    const secondCopyPlay = viableActions(boosted, PLAYER_2, 'play-hazard')
      .map(p => p.action as PlayHazardAction)
      .find(a => a.targetFactionInstanceId)!;
    const resolved = dispatch(boosted, secondCopyPlay);
    const attempt = queuedAttempt(resolved)!;
    expect(attempt).toBeDefined();
    // At Gergeli's home site: this card's own +8 tier, plus the banked +4.
    expect(attempt.boostModifier).toBe(12);
    expect(resolved.activeConstraints.some(c => c.kind.type === 'check-modifier')).toBe(false);
  });
});

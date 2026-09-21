/**
 * @module dm-101.test
 *
 * Card test: Will not Come Down (dm-101)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped agent. Tap the agent who may then make an
 * influence attempt against an ally, faction, or character. Unused general
 * influence modification does not apply. If successful, the target is not
 * discarded, but rather it is returned to its owner's hand. Cannot be played
 * if your opponent is a minion player."
 *
 * Card shape:
 *   - effects[0]: agent-tap-multi-influence
 *     (targetKinds: character/ally/faction, attemptBonus 0,
 *     ignoreGeneralInfluenceModification: true, returnToHandInsteadOfDiscard: true)
 *
 * Engine support:
 *   - Legal actions (legal-actions/movement-hazard.ts): the shared
 *     `agent-tap-multi-influence` branch (Good Sense Revolts dm-61's mode A)
 *     offers one `play-hazard` per (untapped agent, opponent
 *     character/ally in the active company at the agent's current site, or
 *     opponent faction playable at the agent's site) — gated off against a
 *     minion opponent (isMinionOrBalrog). This card carries no
 *     `agent-influence-boost` sibling effect, so no untargeted "boost only"
 *     action is ever offered.
 *   - Reducer (mh-agents.ts handleAgentTapMultiInfluence): taps AND reveals
 *     the agent, discards the event, counts the hazard, and enqueues the
 *     standard `opponent-influence-defend` resolution carrying the rule-10.14
 *     bonuses (+2 DI at agent's home; target shares/is playable at agent's
 *     home → value/mind 0, +2 roll). This card's own `attemptBonus` is 0 (no
 *     printed numeric bonus), `ignoreGeneralInfluenceModification: true`
 *     strips the defending player's `generalInfluenceBonus` from the
 *     `opponentGI` computed via `effectiveGeneralInfluence`, and
 *     `returnToHandInsteadOfDiscard: true` rides the attempt through to
 *     resolution.
 *   - Resolution (reducer-site.ts resolveOpponentInfluenceDefend →
 *     discardInfluencedCard): on success, `attempt.returnToHandInsteadOfDiscard`
 *     redirects only the target itself to the owning player's hand instead of
 *     their discard pile, for all three target kinds (character, ally,
 *     faction). Items/allies still attached to an influenced character are
 *     still discarded normally (CoE 8.3's "along with any non-follower cards
 *     that it controlled" is untouched by this card).
 *
 * Fixtures: hazard player (PLAYER_2, Ringwraith) holds Will not Come Down and
 * a face-down untapped Gergeli (dm-12 — agent, DI 2, home sites Shrel-Kain /
 * Lake-town / Easterling Camp). The hero opponent (PLAYER_1, Wizard) fields
 * Bard Bowman (tw-124, mind 2, home Lake-town — shares a home site with
 * Gergeli) and Elladan (tw-143, mind 4, home Rivendell — does not) in a
 * company at Lórien (tw-408), and may hold a faction in play: Men of
 * Dorwinion (tw-278, playable at Shrel-Kain) or Men of Anórien (tw-277,
 * influence 8, playable at Minas Tirith).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, makeMHState, makeAgent, addCardInPlay, attachAllyToChar, attachItemToChar,
  dispatch, viableActions, mint, findCharInstanceId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase, GENERAL_INFLUENCE } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  GameState, CardDefinitionId, PlayHazardAction, AgentInPlay,
  SiteInPlay, MovementHazardPhaseState, PendingResolution, OpponentInfluenceAttempt,
} from '../../index.js';

const WILL_NOT_COME_DOWN = 'dm-101' as CardDefinitionId;
const GERGELI = 'dm-12' as CardDefinitionId;             // agent, DI 2, homes Shrel-Kain/Lake-town/Easterling Camp
const BARD_BOWMAN = 'tw-124' as CardDefinitionId;        // hero character, mind 2, home Lake-town (shares w/ Gergeli)
const ELLADAN = 'tw-143' as CardDefinitionId;            // hero character, mind 4, home Rivendell (no overlap)
const NOBLE_HOUND = 'dm-179' as CardDefinitionId;        // hero ally, mind 1
const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId; // hero item, attached to Elladan
const MEN_OF_DORWINION = 'tw-278' as CardDefinitionId;   // hero faction @ Shrel-Kain
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;     // hero faction @ Minas Tirith, influence 8
const ELROND = 'tw-145' as CardDefinitionId;             // hero character, mind 10 — GI-usage filler for success fixtures
const SAW_FURTHER_AND_DEEPER = 'dm-156' as CardDefinitionId; // hero permanent event: +5 general influence
const LORIEN = 'tw-408' as CardDefinitionId;             // hero haven "Lórien" — active company's site
const AS_LORIEN = 'as-155' as CardDefinitionId;          // minion-aligned site also named "Lórien"
const MINAS_TIRITH_MINION = 'le-391' as CardDefinitionId; // minion-aligned "Minas Tirith"

/** The queued influence attempt, or undefined when none was enqueued. */
function queuedAttempt(state: GameState): OpponentInfluenceAttempt | undefined {
  const pending = state.pendingResolutions.find(
    (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
  );
  if (!pending || pending.kind.type !== 'opponent-influence-defend') return undefined;
  return pending.kind.attempt;
}

describe('Will not Come Down (dm-101)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, Ringwraith) holds Will not Come Down and an
   * agent; the hero opponent (PLAYER_1) fields a two-character company (Bard
   * Bowman + Elladan) at Lórien and, optionally, one faction in play.
   */
  function baseState(opts?: {
    agentTapped?: boolean;
    agentSite?: CardDefinitionId;
    faction?: CardDefinitionId;
    opponentMinion?: boolean;
    resourceBonusEvent?: boolean;
    /**
     * Elrond (mind 10) padded into the company to soak up general influence,
     * leaving little unused GI — the -5 cross-alignment penalty (Ringwraith
     * agent vs. Wizard target) otherwise makes success unreachable even with
     * a maxed roll and a zeroed target mind. Used only by the "successful
     * influence returns to hand" fixtures.
     */
    lowUnusedGiFiller?: boolean;
  }): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: opts?.opponentMinion ? Alignment.Ringwraith : Alignment.Wizard,
          companies: [{
            site: LORIEN,
            characters: opts?.lowUnusedGiFiller ? [BARD_BOWMAN, ELLADAN, ELROND] : [BARD_BOWMAN, ELLADAN],
          }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: AS_LORIEN, characters: [] }],
          hand: [WILL_NOT_COME_DOWN],
          siteDeck: [],
        },
      ],
    });

    const built = makeAgent(GERGELI);
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

    let withAgent: GameState = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };

    if (opts?.faction) withAgent = addCardInPlay(withAgent, RESOURCE_PLAYER, opts.faction);
    if (opts?.resourceBonusEvent) withAgent = recomputeDerived(addCardInPlay(withAgent, RESOURCE_PLAYER, SAW_FURTHER_AND_DEEPER));
    return withAgent;
  }

  function agentId(state: GameState): string {
    return state.players[HAZARD_PLAYER].agents[0].character.instanceId as string;
  }

  // ─── Playability ────────────────────────────────────────────────────────

  test('offers character, ally, and faction targets for the untapped agent', () => {
    let state = baseState({ agentSite: AS_LORIEN, faction: MEN_OF_ANORIEN });
    state = attachAllyToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, NOBLE_HOUND);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);

    const characterTargets = plays.filter(a => a.targetCharacterId);
    const allyTargets = plays.filter(a => a.targetAllyId);
    // MEN_OF_ANORIEN is playable at Minas Tirith, not Lórien — Gergeli is not
    // there, so no faction target is offered in this fixture.
    expect(characterTargets).toHaveLength(2); // Bard Bowman + Elladan
    expect(allyTargets).toHaveLength(1);      // Noble Hound
    expect(plays.every(a => a.agentInstanceId === agentId(state))).toBe(true);
  });

  test('offers a faction target when the agent stands where it is playable', () => {
    const state = baseState({ faction: MEN_OF_DORWINION }); // Gergeli defaults to his home Shrel-Kain
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    expect(plays.filter(a => a.targetFactionInstanceId)).toHaveLength(1);
  });

  test('requires an untapped agent — no actions offered while tapped', () => {
    const state = baseState({ agentTapped: true, agentSite: AS_LORIEN });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable against a minion opponent', () => {
    const state = baseState({ opponentMinion: true, agentSite: AS_LORIEN });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── "Tap the agent who may then make an influence attempt" ──────────────

  test('playing it on a character target taps and reveals the agent and discards the event', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetCharacterId)!;
    const after = dispatch(state, action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.revealed).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WILL_NOT_COME_DOWN)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany)
      .toBe((state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany + 1);
    // Not an agent action.
    expect(agent.remainingActions).toBe(state.players[HAZARD_PLAYER].agents[0].remainingActions);
  });

  // ─── No printed bonus, but rule 10.14 home-site bonuses still apply ──────

  test('character target NOT sharing a home site: no boost, full mind, no rule-10.14 zeroing', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const elladanId = findCharInstanceId(state, RESOURCE_PLAYER, ELLADAN);
    const action = plays.find(a => a.targetCharacterId === elladanId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier ?? 0).toBe(0); // no printed bonus on this card
    expect(attempt.targetMind).toBe(4);         // Elladan's full mind, not zeroed
    expect(attempt.influencerDI).toBe(2);       // Gergeli away from his own home: no +2
    expect(attempt.targetKind).toBe('character');
  });

  test('character target sharing a home site with the agent: mind zeroed, +2 roll, +2 DI', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const action = plays.find(a => a.targetCharacterId === bardId)!;
    const played = dispatch({ ...state, cheatRollTotal: 7 }, action);
    const attempt = queuedAttempt(played)!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier ?? 0).toBe(0);
    expect(attempt.targetMind).toBe(0);   // rule 10.14: shared home → mind 0
    expect(attempt.attackerRoll).toBe(9); // 7 + 2 (rule-10.14 roll bonus)
  });

  test('ally target: no boost, full mind (allies carry no printed home site)', () => {
    let state = baseState({ agentSite: AS_LORIEN });
    state = attachAllyToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, NOBLE_HOUND);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetAllyId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier ?? 0).toBe(0);
    expect(attempt.targetMind).toBe(1); // Noble Hound's mind, not zeroed
    expect(attempt.targetKind).toBe('ally');
  });

  test('faction target away from the agent home: no boost, full influence value', () => {
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier ?? 0).toBe(0);
    expect(attempt.targetMind).toBe(8);   // full influence value
    expect(attempt.influencerDI).toBe(2); // no home-site DI bonus
    expect(attempt.targetKind).toBe('faction');
  });

  test('faction target playable at the agent home: value zeroed, +2 roll, +2 DI', () => {
    const state = baseState({ faction: MEN_OF_DORWINION }); // Gergeli defaults to his home Shrel-Kain
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const attempt = queuedAttempt(dispatch(state, action))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier ?? 0).toBe(0);
    expect(attempt.targetMind).toBe(0);
    expect(attempt.influencerDI).toBe(4); // Gergeli DI 2 + 2 (at home)
  });

  // ─── "Unused general influence modification does not apply" ─────────────

  test('the defending player\'s general-influence bonus is ignored when computing opponentGI', () => {
    const withoutBonus = baseState({ agentSite: AS_LORIEN });
    const plays1 = viableActions(withoutBonus, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const elladanId1 = findCharInstanceId(withoutBonus, RESOURCE_PLAYER, ELLADAN);
    const attempt1 = queuedAttempt(dispatch(withoutBonus, plays1.find(a => a.targetCharacterId === elladanId1)!))!;

    const withBonus = baseState({ agentSite: AS_LORIEN, resourceBonusEvent: true });
    // Confirm the fixture actually carries the +5 bonus before proving it's ignored.
    expect(withBonus.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(5);
    const plays2 = viableActions(withBonus, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const elladanId2 = findCharInstanceId(withBonus, RESOURCE_PLAYER, ELLADAN);
    const attempt2 = queuedAttempt(dispatch(withBonus, plays2.find(a => a.targetCharacterId === elladanId2)!))!;

    expect(attempt1.opponentGI).toBe(GENERAL_INFLUENCE - withoutBonus.players[RESOURCE_PLAYER].generalInfluenceUsed);
    // Same base 20, unaffected by the +5 in-play bonus — "modification does not apply".
    expect(attempt2.opponentGI).toBe(attempt1.opponentGI);
    expect(attempt2.opponentGI).toBe(GENERAL_INFLUENCE - withBonus.players[RESOURCE_PLAYER].generalInfluenceUsed);
  });

  // ─── "If successful, the target is not discarded, but ... returned to hand" ─

  test('successful character influence returns the character to hand; its item is still discarded', () => {
    let state = baseState({ agentSite: AS_LORIEN, lowUnusedGiFiller: true });
    state = attachItemToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, DAGGER_OF_WESTERNESSE);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const action = plays.find(a => a.targetCharacterId === bardId)!;

    // Bard Bowman shares a home site with Gergeli (mind zeroed, +2 roll); with
    // Elrond padding the company's GI usage down to 4 unused, a maxed roll
    // clears the -5 cross-alignment penalty: 14 (12+2 bonus) + 2 - 4 - 2 - 0 - 5 = 5 > 0.
    const played = dispatch({ ...state, cheatRollTotal: 12 }, action);
    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].characters[bardId]).toBeUndefined();
    // Not discarded ...
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BARD_BOWMAN)).toBe(false);
    // ... but returned to the owner's hand.
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === BARD_BOWMAN)).toBe(true);
    // The item Bard Bowman carried is still discarded per CoE 8.3 (unmodified by this card).
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
  });

  test('successful ally influence returns the ally to hand instead of discarding it', () => {
    let state = baseState({ agentSite: AS_LORIEN, lowUnusedGiFiller: true });
    state = attachAllyToChar(state, RESOURCE_PLAYER, BARD_BOWMAN, NOBLE_HOUND);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetAllyId)!;

    // Noble Hound's mind (1) is not zeroed (allies carry no home site), so
    // this relies purely on the low unused-GI fixture: 12 + 2 - 4 - 2 - 0 - 5 = 3 > 1.
    const played = dispatch({ ...state, cheatRollTotal: 12 }, action);
    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    const resolved = dispatch(defending, defend[0].action);

    const bardId = findCharInstanceId(resolved, RESOURCE_PLAYER, BARD_BOWMAN);
    expect(resolved.players[RESOURCE_PLAYER].characters[bardId].allies).toHaveLength(0);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === NOBLE_HOUND)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === NOBLE_HOUND)).toBe(true);
  });

  test('successful faction influence returns the faction to hand instead of discarding it', () => {
    const state = baseState({ faction: MEN_OF_DORWINION, lowUnusedGiFiller: true }); // value zeroed at Gergeli's home site
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const action = plays.find(a => a.targetFactionInstanceId)!;
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const played = dispatch({ ...state, cheatRollTotal: 12 }, action);
    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_DORWINION)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_DORWINION)).toBe(true);
  });

  test('a failed influence attempt leaves the target untouched', () => {
    const state = baseState({ agentSite: AS_LORIEN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(p => p.action as PlayHazardAction);
    const elladanId = findCharInstanceId(state, RESOURCE_PLAYER, ELLADAN);
    const action = plays.find(a => a.targetCharacterId === elladanId)!;

    const played = dispatch({ ...state, cheatRollTotal: 2 }, action);
    const defending = { ...played, cheatRollTotal: 12 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].characters[elladanId]).toBeDefined();
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === ELLADAN)).toBe(false);
  });
});

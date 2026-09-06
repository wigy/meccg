/**
 * @module test-helpers-builders
 *
 * Scenario builders and high-level test drivers: site-phase / org-phase / MH /
 * influence / combat scenario constructors (build-state / make-state, makeSitePhase,
 * make*Combat, run*Combat, etc.), play-and-resolve drivers, setup/draft drivers,
 * constraint constructors, the on-board accessors (getAlliesOn/getItemsOn/etc.)
 * and related opts types (SingleCharCombatOpts, DetainmentStrikeOpts). Split out
 * of test-helpers.ts, which is now a thin re-export barrel. These builders import
 * the foundation (buildTestState/mint/placement) and the constant/query/
 * assertion/dispatch base layers directly (never from the barrel), so no cycle
 * forms.
 */

import { expect } from 'vitest';
import { createGame } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import { Phase, Alignment, RegionType, SiteType, computeLegalActions } from '../index.js';
import { MovementType, Race } from '../types/common.js';
import type { PlayerId, GameState, GameAction, CardDefinitionId, CardInstanceId, SitePhaseState, MovementHazardPhaseState, InfluenceAttemptAction, OpponentInfluenceAttemptAction, CreatureKeyingMatch, CombatState, ActiveConstraint, CheckKind } from '../index.js';
import { addConstraint } from '../engine/pending.js';
import { resolveInstanceId } from '../types/state.js';
import type { CollectedEffect } from '../engine/effects/index.js';
import { ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR, GANDALF, GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL, CAVE_DRAKE, ORC_WARBAND, ORC_LIEUTENANT, ORC_PATROL, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, SUN, EYE_OF_SAURON, AN_UNEXPECTED_OUTPOST, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, HENNETH_ANNUN, EDHELLOND, ISENGARD } from '../index.js';
import { PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, pool } from './test-helpers-constants.js';
import { companyIdAt, draftInstId, findCharInstanceId, findHandCardId, getOnGuardCard, handCardId, viableActions, viableFor } from './test-helpers-queries.js';
import { getCharacter } from './test-helpers-assertions.js';
import { dispatch, executeAction, resolveChain, runActions } from './test-helpers-dispatch.js';
import { buildTestState, mint, addCardInPlay, addStoredCard, pushCardInPlay, attachAllyToChar, setAllyStatus, setCharStatus } from './test-helpers-core.js';
import type { CharacterEntry } from './test-helpers-core.js';

const THE_ONE_RING = 'tw-347' as CardDefinitionId;

/** Bill Ferny (dm-3) — a minion agent character used by the dm-43/dm-50 tests. */
const BILL_FERNY = 'dm-3' as CardDefinitionId;

/**
 * Dispatch an action that opens a chain, then drive both players'
 * pass-chain-priority calls via resolveChain until the chain clears. Shared by
 * the typed `play*AndResolve` helpers below.
 */
function playAndResolve(state: GameState, action: GameAction): GameState {
  return resolveChain(dispatch(state, action));
}

export function makePlayDeck(): CardDefinitionId[] {
  // Unique items: 1 copy each
  const uniqueResources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, HAUBERK_OF_BRIGHT_MAIL];
  // Non-unique items: up to 3 copies each
  const nonUniqueResources = [
    DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE,
  ];
  // Non-unique long events: up to 3 copies each
  const longEvents = [SUN, SUN];
  // Non-unique hazard creatures: 3 copies each
  const hazards = [
    CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
    ORC_LIEUTENANT, ORC_LIEUTENANT, ORC_LIEUTENANT,
    ORC_PATROL, ORC_PATROL, ORC_PATROL,
    ORC_WARBAND, ORC_WARBAND, ORC_WARBAND,
    BARROW_WIGHT,
    BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG,
    EYE_OF_SAURON, EYE_OF_SAURON,
  ];
  return [...uniqueResources, ...nonUniqueResources, ...longEvents, ...hazards];
}

export function makeQuickStartConfig(seed = 42): QuickStartGameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        startingCharacters: [ARAGORN, BILBO],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        startingCharacters: [LEGOLAS, GIMLI],
        playDeck: makePlayDeck(),
        siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
        sideboard: [],
      },
    ],
    seed,
  };
}

export function makeDraftConfig(seed = 42): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BILBO, FRODO, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
        sideboard: [],
      },
    ],
    seed,
  };
}

/**
 * Run through the character draft: both players pick one character each,
 * then both stop. Returns the state after draft completion (in item-draft or later).
 */
export function runSimpleDraft(config?: GameConfig): GameState {
  const gameConfig = config ?? makeDraftConfig();
  let state = createGame(gameConfig, pool);

  // Both pick one character
  state = runActions(state, [
    { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ARAGORN) },
    { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
    { type: 'draft-stop', player: PLAYER_1 },
    { type: 'draft-stop', player: PLAYER_2 },
  ]);

  return state;
}

/**
 * Builds the pass-through actions for the starting-site-selection step,
 * picking each not-yet-done player's first site-deck card and passing.
 * Players the engine already auto-completed (a forced single-choice site
 * deck, or a Hidden Haven pre-placement) are skipped — dispatching a
 * selection for a `done` player would error.
 */
function siteSelectionCatchUpActions(state: GameState): GameAction[] {
  if (state.phaseState.phase !== Phase.Setup || state.phaseState.setupStep.step !== 'starting-site-selection') {
    return [];
  }
  const siteSelectionState = state.phaseState.setupStep.siteSelectionState;
  const actions: GameAction[] = [];
  const players: [PlayerId, PlayerId] = [PLAYER_1, PLAYER_2];
  for (let i = 0; i < 2; i++) {
    if (siteSelectionState[i].done) continue;
    const siteInstanceId = state.players[i].siteDeck[0].instanceId;
    actions.push({ type: 'select-starting-site', player: players[i], siteInstanceId });
    actions.push({ type: 'pass', player: players[i] });
  }
  return actions;
}

/**
 * Advances from wherever the character draft left off (item assignment, deck
 * draft, site selection, placement, shuffle) up to — but not including — the
 * initial-draw step. Shared by every setup runner below so each only differs
 * in how it handles the initial draw itself. Exported so a test that drives
 * its own custom draft (e.g. a non-default `draftPool`, where `runSimpleDraft`'s
 * hardcoded picks don't apply) can still reuse the rest of the setup pipeline
 * and dispatch `draw-cards` itself — e.g. to exercise the actual
 * legal-action-computed count rather than a hardcoded one, or to inspect the
 * pre-draw hand.
 */
export function advanceSetupToInitialDraw(state: GameState): GameState {
  // Item draft: assign all items to first character
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'item-draft') {
    const p1Char = state.players[0].companies[0].characters[0];
    const p2Char = state.players[1].companies[0].characters[0];
    const p1Items = state.phaseState.setupStep.itemDraftState[0].unassignedItems;
    const p2Items = state.phaseState.setupStep.itemDraftState[1].unassignedItems;

    for (const _item of p1Items) {
      const result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
    for (const _item of p2Items) {
      const result = reduce(state, { type: 'assign-starting-item', player: PLAYER_2, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p2Char });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
  }

  // Deck draft: pass
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-deck-draft') {
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
  }

  // Site selection: pick first available site (skipping any player already
  // auto-completed by the engine, e.g. a forced single-choice site deck).
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'starting-site-selection') {
    state = runActions(state, siteSelectionCatchUpActions(state));
  }

  // Character placement: pass (if needed)
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-placement') {
    const step = state.phaseState.setupStep;
    if (!step.placementDone[0]) {
      const result = reduce(state, { type: 'pass', player: PLAYER_1 });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
    if (!step.placementDone[1]) {
      const result = reduce(state, { type: 'pass', player: PLAYER_2 });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
  }

  // Deck shuffle
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'deck-shuffle') {
    state = runActions(state, [
      { type: 'shuffle-play-deck', player: PLAYER_1 },
      { type: 'shuffle-play-deck', player: PLAYER_2 },
    ]);
  }

  return state;
}

/**
 * Run through the entire setup from draft to Untap, including item assignment,
 * deck draft, site selection, placement, shuffle, draw, and initiative roll.
 * Returns the state at the start of turn 1 (Untap phase).
 */
export function runFullSetup(config?: GameConfig): GameState {
  let state = advanceSetupToInitialDraw(runSimpleDraft(config));

  // Initial draw
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'initial-draw') {
    state = runActions(state, [
      { type: 'draw-cards', player: PLAYER_1, count: 8 },
      { type: 'draw-cards', player: PLAYER_2, count: 8 },
    ]);
  }

  // Initiative roll (may need rerolls on ties)
  while (state.phaseState.phase === Phase.Setup) {
    state = runActions(state, [
      { type: 'roll-initiative', player: PLAYER_1 },
      { type: 'roll-initiative', player: PLAYER_2 },
    ]);
  }

  return state;
}

/**
 * Run all setup steps up through initial-draw, stopping before the initiative
 * roll. Returns the state at the `initiative-roll` setup step so tests can
 * control the dice via {@link GameState.cheatRollTotal}.
 */
export function runSetupToInitiativeRoll(config?: GameConfig): GameState {
  let state = advanceSetupToInitialDraw(runSimpleDraft(config));

  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'initial-draw') {
    state = runActions(state, [
      { type: 'draw-cards', player: PLAYER_1, count: 8 },
      { type: 'draw-cards', player: PLAYER_2, count: 8 },
    ]);
  }

  return state;
}

// ─── Shared state builder ────────────────────────────────────────────────────

import type { CompanyId, CardInPlay, AgentInPlay, PlayerState, OnGuardCard } from '../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS } from '../index.js';
import { recomputeDerived } from '../engine/recompute-derived.js';
export { recomputeDerived };

/**
 * Builds a freshly-minted {@link AgentInPlay} for the given agent character
 * definition in its default (untapped, one-action, face-down) state. Pass
 * `revealed: true` to build a face-up agent (e.g. for the Withdrawn to Mordor
 * dm-165 test, which targets face-up agents).
 */
export function makeAgent(
  definitionId: CardDefinitionId,
  opts?: { revealed?: boolean },
): AgentInPlay {
  return {
    id: `agent-${definitionId as string}-0` as CompanyId,
    character: {
      instanceId: mint(),
      definitionId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy: 'general' as const,
      effectiveStats: ZERO_EFFECTIVE_STATS,
    },
    revealed: opts?.revealed ?? false,
    siteStack: [],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

/**
 * Builds a freshly-minted Bill Ferny {@link AgentInPlay} in its default
 * (untapped, unrevealed, one-action) state. Shared by the agent-combat tests.
 */
export function makeBillFernyAgent(): AgentInPlay {
  return { ...makeAgent(BILL_FERNY), id: 'agent-bill-ferny-0' as CompanyId };
}

/**
 * A movement/hazard state in which the hazard player (PLAYER_2) holds `hazard`
 * in hand with a face-down, untapped Bill Ferny agent at his home site (Bree),
 * facing a resource player of `opponentAlignment` whose company stands at
 * Lórien with `opponentCharacters`.
 *
 * Written for rule 1.35, which turns on nothing but the opponent's alignment:
 * building the same hazard against a Wizard and against a Ringwraith is what
 * separates "this card was never playable here" from "the Ringwraith opponent
 * is what stopped it".
 */
export function buildAgentHazardVsOpponent(
  hazard: CardDefinitionId,
  opponentAlignment: Alignment,
  opponentCharacters: CardDefinitionId[] = [],
): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        alignment: opponentAlignment,
        companies: [{ site: LORIEN, characters: opponentCharacters }],
        hand: [],
        siteDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: [hazard],
        siteDeck: [],
      },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState(),
    players: [
      state.players[0],
      { ...state.players[1], agents: [makeBillFernyAgent()] },
    ] as typeof state.players,
  };
}

/** Returns a copy of `state` with every company's current site tapped. */
export function withSiteTapped(state: GameState): GameState {
  const players = state.players.map(p => ({
    ...p,
    companies: p.companies.map(c => ({
      ...c,
      currentSite: c.currentSite
        ? { ...c.currentSite, status: CardStatus.Tapped }
        : c.currentSite,
    })),
  })) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Builds an Organization-phase state where P1 has two companies that share the
 * same `currentSite` instance (the second company's site is not separately
 * owned). Used by the company size-limit and race-mixing rule tests, which
 * both reason about two companies meeting at one site.
 */
export function buildTwoCompaniesAt(
  site: CardDefinitionId,
  company1Chars: CardDefinitionId[],
  company2Chars: CardDefinitionId[],
): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site, characters: company1Chars },
          { site, characters: company2Chars },
        ],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  // Share the same site instance between both companies
  const sharedSite = built.players[0].companies[0].currentSite!;
  return {
    ...built,
    players: [
      {
        ...built.players[0],
        companies: built.players[0].companies.map((c, i) =>
          i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
        ),
      },
      built.players[1],
    ] as unknown as typeof built.players,
  };
}

// ─── End-of-turn phase setup ───────────────────────────────────────────────

/**
 * Build a minimal End-of-Turn phase state with P1 active, Aragorn+Bilbo at
 * Rivendell, and Legolas at Lorien. Hands and decks are configurable.
 */
export function eotState(opts?: {
  p1Hand?: CardDefinitionId[];
  p2Hand?: CardDefinitionId[];
  p1Deck?: CardDefinitionId[];
  p2Deck?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.EndOfTurn,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MORIA],
        playDeck: opts?.p1Deck ?? [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts?.p2Hand ?? [],
        siteDeck: [MINAS_TIRITH],
        playDeck: opts?.p2Deck ?? [],
      },
    ],
  });
}

// ─── Shared test helpers ─────────────────────────────────────────────────────

/**
 * Return the first viable `influence-attempt` action that targets the given
 * faction instance from the player's hand (first-play influence, not
 * re-influence). Useful in faction-card tests that assert on the computed
 * `need` value for a specific character/faction pairing.
 */
export function firstFactionInfluenceAttempt(
  state: GameState,
  factionInstanceId: CardInstanceId,
  playerId: PlayerId = PLAYER_1,
): InfluenceAttemptAction | undefined {
  return viableActions(state, playerId, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionInstanceId);
}

/**
 * Build a state in the middle of an influence-attempt chain window, suitable
 * for testing short events that boost influence checks (Muster, New Friendship,
 * A Friend or Three). The faction card has moved from hand to the chain, the
 * opponent has already passed chain priority, and it is now the resource
 * player's turn to respond — boost events are offered at this point.
 *
 * Pass the same opts as {@link buildSitePhaseState}, plus `factionDefId`
 * to identify which faction in the hand to use for the attempt.
 */
export function buildInfluenceAttemptChainState(opts: {
  characters: CharacterEntry[];
  site: CardDefinitionId;
  hand: CardDefinitionId[];
  factionDefId: CardDefinitionId;
}): GameState {
  const base = buildSitePhaseState({
    characters: [...opts.characters],
    site: opts.site,
    hand: opts.hand,
  });
  const factionInstanceId = findHandCardId(base, RESOURCE_PLAYER, opts.factionDefId);
  const attempt = firstFactionInfluenceAttempt(base, factionInstanceId);
  if (!attempt) throw new Error(`No viable influence-attempt for faction ${opts.factionDefId as string}`);
  // After dispatching the influence-attempt, the opponent (PLAYER_2) gets
  // chain priority first. Pass it so the resource player (PLAYER_1) gets
  // their response window to play boost events.
  const afterAttempt = dispatch(base, attempt);
  const passPriority = computeLegalActions(afterAttempt, PLAYER_2).find(
    ea => ea.viable && ea.action.type === 'pass-chain-priority',
  );
  if (!passPriority) throw new Error('Expected opponent to be able to pass chain priority');
  return dispatch(afterAttempt, passPriority.action);
}

/**
 * Return the first viable `opponent-influence-attempt` action that targets
 * the given opponent-controlled instance (character, ally, or faction). The
 * `revealOnly` option filters to the reveal-identical variant.
 */
export function firstOpponentInfluenceAttempt(
  state: GameState,
  targetInstanceId: CardInstanceId,
  playerId: PlayerId = PLAYER_1,
  opts?: { revealOnly?: boolean },
): OpponentInfluenceAttemptAction | undefined {
  return viableActions(state, playerId, 'opponent-influence-attempt')
    .map(a => a.action as OpponentInfluenceAttemptAction)
    .find(a => a.targetInstanceId === targetInstanceId && (opts?.revealOnly ? !!a.revealedCardInstanceId : !a.revealedCardInstanceId));
}

/** The action-type names of every viable action for a player. */
export function viableActionTypes(state: GameState, playerId: PlayerId): string[] {
  return viableFor(state, playerId).map(ea => ea.action.type);
}

/** Build a state in site phase at play-resources step with a company at a site. */
export function buildSitePhaseState(opts: {
  characters?: CharacterEntry[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  discardPile?: CardDefinitionId[];
  /** Player 1's alignment. Defaults to {@link Alignment.Wizard}. */
  alignment?: Alignment;
  /** Player 2's (hazard/opponent) hand. Defaults to empty. */
  opponentHand?: CardDefinitionId[];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: opts.alignment, companies: [{ site: opts.site, characters: opts.characters ?? [ARAGORN] }], hand: opts.hand ?? [], siteDeck: [MORIA], discardPile: opts.discardPile ?? [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.opponentHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
    phase: Phase.Site,
  });

  const company = state.players[0].companies[0];
  if (opts.siteStatus) {
    (company.currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  const sitePhaseState: SitePhaseState = {
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
  return { ...state, phaseState: sitePhaseState };
}

/**
 * Build an M/H-phase state with PLAYER_1 (resource) moving a company from
 * Rivendell to `destination`, and PLAYER_2 (hazard) holding `hazardHand`. Used
 * by hold-targeting hazard short-event card tests (FEAR! FIRE! FOES! as-29,
 * Arouse Defenders le-101) that must be offered against a moving company whose
 * destination site type matches the card's gate. `phaseState.destinationSiteType`
 * is derived from `destination`'s own printed `siteType` (via `pool`), so
 * `site-path` play-condition cards (Choking Shadows tw-21, Whole Villages
 * Roused wh-31) that gate on `destinationSiteType` are exercised correctly too.
 *
 * `opts` covers the cases where the moving side is not a plain Wizard company:
 * `resourceAlignment` sets PLAYER_1's alignment and `origin` its starting site
 * (e.g. a Fallen-wizard company moving out of Isengard, for hazards that target
 * a Wizardhaven — Nature's Revenge wh-27).
 */
export function buildHazardMovingState(
  destination: CardDefinitionId,
  destinationSiteName: string,
  hazardHand: CardDefinitionId[],
  characters: CharacterEntry[] = [ARAGORN],
  opts?: { resourceAlignment?: Alignment; origin?: CardDefinitionId },
): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        ...(opts?.resourceAlignment ? { alignment: opts.resourceAlignment } : {}),
        companies: [{ site: opts?.origin ?? RIVENDELL, characters, destinationSite: destination }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  const destinationSiteType = (pool[destination as string] as { siteType?: SiteType } | undefined)?.siteType;
  return {
    ...state,
    phaseState: makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
      destinationSiteName,
      ...(destinationSiteType ? { destinationSiteType } : {}),
    }),
  };
}

/**
 * Build a Fallen-wizard site-phase state at the play-resources step with one
 * company at `site`. Mirrors {@link buildSitePhaseState} but for Fallen-wizard
 * card tests, where alignment-sensitive logic (Wizardhaven gates, Stage
 * resources) must run against a Fallen-wizard company. P1 is the active
 * resource player; P2 is a placeholder Wizard company at a Haven.
 */
export function buildFallenWizardSitePhaseState(opts: {
  characters: CharacterEntry[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  /**
   * Pre-set the Fallen-wizard's stage-point total. Some site-phase Stage
   * resources gate on it (Mischief in a Mean Way wh-77: "if you have 10 or
   * more stage points"). Applied after the initial recompute, so it is not
   * overwritten unless a subsequent reduce recomputes derived state.
   */
  stagePoints?: number;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: opts.site, characters: opts.characters }], hand: opts.hand ?? [], siteDeck: [ISENGARD] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
    phase: Phase.Site,
  });

  if (opts.siteStatus) {
    (state.players[0].companies[0].currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  // Set the FW's stage-point total after the initial recompute (which would
  // otherwise reset it to the sum of in-play Stage cards, i.e. 0).
  if (opts.stagePoints !== undefined) {
    (state.players[0] as { stagePoints: number }).stagePoints = opts.stagePoints;
  }

  const sitePhaseState: SitePhaseState = {
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
  return { ...state, phaseState: sitePhaseState };
}

/**
 * Build a Fallen-wizard *organization*-phase state with one company at `site`.
 * Mirrors {@link buildFallenWizardSitePhaseState} but in the organization phase,
 * where Stage resource permanent-events are played (rule 5.F1) — e.g. the
 * site-targeting Stage resources The Fortress of Isen (wh-68), Guarded Haven
 * (wh-74), Double-dealing (wh-66). P1 is the active resource player; P2 is a
 * placeholder Wizard company at a Haven.
 */
export function buildFallenWizardOrgPhaseState(opts: {
  characters: CharacterEntry[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  siteStatus?: CardStatus;
  /** Cards seeded into the opponent's (P2) `cardsInPlay` — e.g. a permanent
   *  event another player controls that the tested card can discard
   *  (Keys to the White Towers wh-89). */
  opponentCardsInPlay?: CardInPlay[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: opts.site, characters: opts.characters }], hand: opts.hand ?? [], playDeck: opts.playDeck, discardPile: opts.discardPile, siteDeck: [ISENGARD] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL], cardsInPlay: opts.opponentCardsInPlay ?? [] },
    ],
    phase: Phase.Organization,
  });

  if (opts.siteStatus) {
    (state.players[0].companies[0].currentSite as { status: CardStatus }).status = opts.siteStatus;
  }
  return state;
}

/**
 * Build a minion (Ringwraith) site-phase state at the play-resources step
 * with one company at `site`. Mirrors {@link buildSitePhaseState} but for
 * minion card tests, where alignment-sensitive logic (detainment, item MP,
 * dark-haven gates) must run against a Ringwraith company. P1 is the active
 * resource player; P2 is a placeholder minion company at a haven, unless
 * `opponent` overrides it (e.g. a hero company whose in-play characters gate
 * a site rule, like Radagast removing Rhosgobel's automatic-attacks).
 */
export function buildMinionSitePhaseState(opts: {
  characters: CharacterEntry[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  opponent?: { alignment: Alignment; site: CardDefinitionId; characters: CharacterEntry[] };
}): GameState {
  const MINAS_MORGUL = 'le-390' as CardDefinitionId;
  const DOL_GULDUR = 'le-367' as CardDefinitionId;
  const opponent = opts.opponent ?? { alignment: Alignment.Ringwraith, site: DOL_GULDUR, characters: [] };
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: opts.site, characters: opts.characters }], hand: opts.hand ?? [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: opponent.alignment, companies: [{ site: opponent.site, characters: opponent.characters }], hand: [], siteDeck: [opts.opponent ? opponent.site : MINAS_MORGUL] },
    ],
    phase: Phase.Site,
  });

  if (opts.siteStatus) {
    (state.players[0].companies[0].currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  const sitePhaseState: SitePhaseState = {
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
  return { ...state, phaseState: sitePhaseState };
}

/**
 * Build a state in the site phase at an arbitrary step with configurable
 * hands for BOTH players. `buildSitePhaseState` only wires up the resource
 * player's hand; this variant is used when tests need creatures in the
 * hazard player's hand (e.g. Framsburg's dynamic auto-attack, where the
 * hazard player plays a creature at site entry).
 */
export function buildDualHandSitePhaseState(opts: {
  site: CardDefinitionId;
  resourceCharacters?: CharacterEntry[];
  resourceHand?: CardDefinitionId[];
  hazardHand?: CardDefinitionId[];
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site, characters: opts.resourceCharacters ?? [ARAGORN] }],
        hand: opts.resourceHand ?? [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.hazardHand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
    phase: Phase.Site,
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: opts.step ?? 'enter-or-skip',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: opts.siteEntered ?? false,
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
  return { ...state, phaseState: sitePhaseState };
}

/** Build a MovementHazardPhaseState in the play-hazards step. */
export function makeMHState(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return {
    phase: Phase.MovementHazard,
    step: 'play-hazards',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    movementType: null,
    declaredRegionPath: [],
    maxRegionDistance: 4,
    hazardsPlayedThisCompany: 0,
    hazardLimitAtReveal: 4,
    preRevealHazardLimitConstraintIds: [],
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: null,
    destinationSiteName: null,
    resourceDrawMax: 0,
    hazardDrawMax: 0,
    resourceDrawCount: 0,
    hazardDrawCount: 0,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
    onGuardPlacedThisCompany: false,
    siteRevealed: false,
    returnedToOrigin: false,
    hazardsEncountered: [],
    ahuntAttacksResolved: 0,
    corruptionCardsPlayedPerChar: {},
    nazgulSideboardDestination: null,
    nazgulSideboardFetched: 0,
    ...overrides,
  };
}

/**
 * Build a Ringwraith-player Movement/Hazard state stopped at the
 * reveal-new-site step: one P1 company at `origin` with `destinationSite`
 * declared, ready for the resource player to declare its movement path.
 * Used by tests for site-printed `site-revealed-as-new-site` effects
 * (Himring as-150 family), which fire the moment the path is declared.
 */
export function buildMinionMHRevealState(opts: {
  origin: CardDefinitionId;
  destination: CardDefinitionId;
  characters: CharacterEntry[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.origin, characters: opts.characters, destinationSite: opts.destination }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
}

/**
 * Dispatch P1's starter-movement declare-path action for the active company
 * at the reveal-new-site step (see {@link buildMinionMHRevealState}). Throws
 * if no starter declare-path action is viable.
 */
export function declareStarterPath(state: GameState): GameState {
  const declare = viableFor(state, PLAYER_1)
    .map(a => a.action)
    .find(a => a.type === 'declare-path' && a.movementType === 'starter');
  if (!declare) throw new Error('no viable starter declare-path action for PLAYER_1');
  return dispatch(state, declare);
}

/**
 * Drive the Movement/Hazard phase hazard-limit snapshot for a single P1
 * company and return the resulting `hazardLimitAtReveal`.
 *
 * Builds a `set-hazard-limit` M/H state for a P1 company at Rivendell with the
 * given characters (moving to Moria unless `moving: false`), optionally adds
 * each `envInPlay` card to the hazard player's `cardsInPlay`, dispatches the
 * pass that triggers the snapshot, and reads back the locked-in limit. Used to
 * test environment cards that modify the hazard limit (Eyes of the Shadow
 * dm-56).
 */
export function snapshotHazardLimitFor(
  characters: CharacterEntry[],
  opts?: { moving?: boolean; envInPlay?: CardDefinitionId[] },
): number {
  const moving = opts?.moving ?? true;
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters, ...(moving ? { destinationSite: MORIA } : {}) }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  for (const def of opts?.envInPlay ?? []) {
    state = addCardInPlay(state, HAZARD_PLAYER, def);
  }
  const ready = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0 }) };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
}

/**
 * Build a {@link CombatState} in the body-check phase for a single
 * wounded character, set up against a generic automatic-attack source.
 *
 * Defaults: strikesTotal 1, strikeProwess 10, creatureRace 'orc',
 * detainment false, bodyCheckTarget 'character', attackingPlayerId
 * PLAYER_2, defendingPlayerId PLAYER_1. Override as needed.
 */
export function makeBodyCheckCombat(opts: {
  companyId: CompanyId;
  characterId: CardInstanceId;
  wasAlreadyWounded?: boolean;
  attackingPlayerId?: PlayerId;
  defendingPlayerId?: PlayerId;
  strikesTotal?: number;
  strikeProwess?: number;
  creatureBody?: number | null;
  creatureRace?: CombatState['creatureRace'];
  bodyCheckTarget?: CombatState['bodyCheckTarget'];
  detainment?: boolean;
  attackSource?: CombatState['attackSource'];
  /** Recorded strike result (default `'wounded'`; use `'success'` for a parry
   * so a `bodyCheckTarget: 'creature'` check reads as a defeated strike). */
  result?: 'success' | 'wounded' | 'eliminated' | 'survived';
  /** Marks the combat as company-vs-company (Balrog CvCC body-check tests). */
  isCvCC?: boolean;
  /** CvCC attacking character whose successful strike caused this body check. */
  attackingCharacterId?: CardInstanceId;
}): CombatState {
  return {
    attackSource: opts.attackSource ?? {
      type: 'automatic-attack',
      siteInstanceId: 'fake-site' as CardInstanceId,
      attackIndex: 0,
    },
    companyId: opts.companyId,
    defendingPlayerId: opts.defendingPlayerId ?? PLAYER_1,
    attackingPlayerId: opts.attackingPlayerId ?? PLAYER_2,
    strikesTotal: opts.strikesTotal ?? 1,
    strikeProwess: opts.strikeProwess ?? 10,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: opts.creatureRace ?? Race.Orc,
    ...(opts.isCvCC ? { isCvCC: true } : {}),
    strikeAssignments: [
      {
        characterId: opts.characterId,
        excessStrikes: 0,
        resolved: true,
        result: opts.result ?? 'wounded',
        wasAlreadyWounded: opts.wasAlreadyWounded ?? false,
        ...(opts.attackingCharacterId ? { attackingCharacterId: opts.attackingCharacterId } : {}),
      },
    ],
    currentStrikeIndex: 0,
    phase: 'body-check',
    assignmentPhase: 'done',
    bodyCheckTarget: opts.bodyCheckTarget ?? 'character',
    detainment: opts.detainment ?? false,
  };
}

/**
 * Build a {@link CombatState} in the pre-assignment cancel window against
 * the defending player's first company, for testing cancel-attack effects.
 *
 * Defaults: `attackSource.type === 'creature'` with a freshly minted
 * instance added to the hazard player's `cardsInPlay`. Pass
 * `attackSourceType: 'on-guard-creature'` or `'automatic-attack'` to
 * exercise cancel-attack `when` filters on the attack's origin.
 *
 * Returns a new `GameState` with the combat attached and (when the source
 * is a creature) the hazard player's `cardsInPlay` extended with the
 * minted creature instance.
 */
export function makeCancelWindowCombat(
  state: GameState,
  opts: {
    creatureDefId?: CardDefinitionId;
    creatureRace?: Race;
    attackKeying?: readonly RegionType[];
    attackSiteKeyingTypes?: readonly SiteType[];
    attackKeyingRegionNames?: readonly string[];
    attackSourceType?: 'creature' | 'on-guard-creature' | 'automatic-attack';
    strikesTotal?: number;
    strikeProwess?: number;
  } = {},
): GameState {
  const sourceType = opts.attackSourceType ?? 'creature';
  const creatureDefId = opts.creatureDefId ?? ('tw-074' as CardDefinitionId);
  const creatureRace = opts.creatureRace ?? Race.Orc;

  let players = state.players;
  let attackSource: CombatState['attackSource'];

  if (sourceType === 'creature') {
    const creatureInstanceId = `creature-${creatureDefId as string}-${Date.now()}-${Math.random()}` as CardInstanceId;
    const hazardPlayer = state.players[HAZARD_PLAYER];
    const updatedHazardPlayer = {
      ...hazardPlayer,
      cardsInPlay: [
        ...hazardPlayer.cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: creatureDefId, status: CardStatus.Untapped },
      ],
    };
    players = [state.players[RESOURCE_PLAYER], updatedHazardPlayer] as unknown as typeof state.players;
    attackSource = { type: 'creature', instanceId: creatureInstanceId };
  } else if (sourceType === 'on-guard-creature') {
    const creatureInstanceId = `on-guard-${creatureDefId as string}-${Date.now()}-${Math.random()}` as CardInstanceId;
    attackSource = { type: 'on-guard-creature', cardInstanceId: creatureInstanceId };
  } else {
    attackSource = {
      type: 'automatic-attack',
      siteInstanceId: 'fake-site' as CardInstanceId,
      attackIndex: 0,
    };
  }

  const combat: CombatState = {
    attackSource,
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: opts.strikesTotal ?? 2,
    strikeProwess: opts.strikeProwess ?? 6,
    creatureBody: null,
    creatureRace,
    attackKeying: opts.attackKeying && opts.attackKeying.length > 0 ? opts.attackKeying : undefined,
    attackSiteKeyingTypes: opts.attackSiteKeyingTypes && opts.attackSiteKeyingTypes.length > 0 ? opts.attackSiteKeyingTypes : undefined,
    attackKeyingRegionNames: opts.attackKeyingRegionNames && opts.attackKeyingRegionNames.length > 0 ? opts.attackKeyingRegionNames : undefined,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...state, players, phaseState: makeMHState(), combat };
}

/**
 * Attach a pre-assignment automatic-attack {@link CombatState} for the
 * resource player's first company against its current site, and switch the
 * (already Site-phase) `phaseState.step` to `'automatic-attacks'`.
 *
 * Unlike {@link makeCancelWindowCombat} — which always forces Movement/Hazard
 * `phaseState` — this keeps the caller's Site-phase state, so cancel-attack
 * effects that also react to the site phase itself (e.g. Riven Gate as-98's
 * `cancelsRemainingSiteAttacks`, which sets `SitePhaseState.autoAttacksSkipped`)
 * can be exercised end-to-end.
 */
export function attachSiteAutomaticAttackCombat(
  state: GameState,
  opts: { creatureRace?: Race; strikesTotal?: number; strikeProwess?: number } = {},
): GameState {
  const company = state.players[RESOURCE_PLAYER].companies[0];
  const siteInstanceId = company.currentSite?.instanceId ?? ('fake-site' as CardInstanceId);
  const combat: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId, attackIndex: 0 },
    companyId: company.id,
    defendingPlayerId: state.players[RESOURCE_PLAYER].id,
    attackingPlayerId: state.players[HAZARD_PLAYER].id,
    strikesTotal: opts.strikesTotal ?? 1,
    strikeProwess: opts.strikeProwess ?? 5,
    creatureBody: null,
    creatureRace: opts.creatureRace ?? Race.Man,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  const phaseState = state.phaseState.phase === Phase.Site
    ? { ...state.phaseState, step: 'automatic-attacks' as const }
    : state.phaseState;
  return { ...state, phaseState, combat };
}

/**
 * MH state describing arrival at a Shadow-Hold "Moria" via an Imlad Morgul
 * shadow region. Mirrors the setup used by many combat rule tests.
 */
export function makeShadowMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Imlad Morgul'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/**
 * MH state describing arrival at a Shadow-Hold "Moria" via a path of two
 * shadow-land regions. For creatures keyed `{s}{s}` — i.e. those whose text
 * requires "two Shadow-lands [{s}] in site path" (Wild Fell Beast td-81).
 */
export function makeDoubleShadowMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
    resolvedSitePathNames: ['Imlad Morgul', 'Gorgoroth'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/**
 * MH state describing arrival at a Border-hold via a Border region.
 * For creatures keyed to border-land {b} (e.g. Brigands).
 */
export function makeBorderMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Border],
    resolvedSitePathNames: ['Andrast'],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Pelargir',
    ...overrides,
  });
}

/**
 * MH state describing arrival at Ruins-and-Lairs "Moria" via a Rhudaur
 * wilderness region.
 */
export function makeWildernessMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/**
 * MH state describing arrival at Ruins-and-Lairs "Moria" via a path of two
 * wilderness regions. For creatures keyed `{w}{w}` (Hobgoblins, Tom (Tûma),
 * Elf-lord Revealed in Wrath, and Cave-drake's region-type option).
 */
export function makeDoubleWildernessMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/** Build a SitePhaseState at the play-resources step. */
export function makeSitePhase(overrides?: Partial<SitePhaseState>): SitePhaseState {
  return {
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
    ...overrides,
  };
}

/**
 * Return a copy of `state` with the given player's company's current site set
 * to the requested status (e.g. Tapped). Used by faction-card tests that need
 * to exercise "playable at a tapped site" rules (Snaga-hai le-286) without
 * driving a full resource-play that would tap the site.
 */
export function setCompanySiteStatus(
  state: GameState,
  playerIdx: number,
  companyIdx: number,
  status: CardStatus,
): GameState {
  const target = state.players[playerIdx];
  const updated = {
    ...target,
    companies: target.companies.map((c, ci) =>
      ci !== companyIdx || !c.currentSite ? c : { ...c, currentSite: { ...c.currentSite, status } },
    ),
  };
  const players: GameState['players'] = playerIdx === 0
    ? [updated, state.players[1]]
    : [state.players[0], updated];
  return { ...state, players };
}

/**
 * Build a minimal two-player Organization-phase state with stock
 * companies — Aragorn+Bilbo at Rivendell vs Legolas at Lorien — and
 * empty hands/decks. Tests that don't care about the company shape but
 * need *some* valid state to layer assertions on top of should use this.
 */
export function buildSimpleTwoPlayerState(activePlayer: PlayerId = PLAYER_1): GameState {
  return buildTestState({
    activePlayer,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/**
 * Build a M/H phase state at the play-hazards step for a single moving
 * company (player 0) whose destination is HENNETH_ANNUN, traversing the given
 * resolved site path. The hazard player (1) has `envDefId` in play — typically
 * a `force-return-to-origin` environment (Snowstorm tw-91, Long Winter le-117,
 * Foul Fumes tw-36). Both players passing then drives the company through
 * step 8, where rule 5.31 enforcement evaluates the environment.
 *
 * Returns the assembled state plus the company's origin site instance ID and
 * company ID for post-dispatch assertions.
 *
 * Pass `opts.movingPlayerAlignment` to give the moving (player 0) side a
 * non-default alignment — e.g. `Alignment.Ringwraith` to exercise a card's
 * "no effect on a minion player" gating (Foul Fumes tw-36).
 */
export function buildForceReturnMHState(
  characters: CardDefinitionId[],
  sitePath: RegionType[],
  envDefId: CardDefinitionId,
  opts?: { movingPlayerAlignment?: Alignment },
): { state: GameState; originInstanceId: CardInstanceId; companyId: CompanyId } {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MINAS_TIRITH, characters }],
        hand: [],
        siteDeck: [HENNETH_ANNUN],
        ...(opts?.movingPlayerAlignment ? { alignment: opts.movingPlayerAlignment } : {}),
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });

  const company = built.players[0].companies[0];
  const dest = built.players[0].siteDeck.find(c => c.definitionId === HENNETH_ANNUN)!;

  const withMovement: GameState = {
    ...built,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: sitePath,
      resourcePlayerPassed: false,
      hazardPlayerPassed: false,
    }),
    players: [
      {
        ...built.players[0],
        companies: [{
          ...company,
          siteCardOwned: true,
          destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
        }],
        // Match the real plan-movement reducer: the destination card leaves the
        // site deck while the company holds it as `destinationSite`. Leaving it
        // in the deck made "the site returned to the deck" assertions pass
        // vacuously.
        siteDeck: built.players[0].siteDeck.filter(c => c.instanceId !== dest.instanceId),
      },
      built.players[1],
    ] as unknown as typeof built.players,
  };

  const state = addCardInPlay(withMovement, HAZARD_PLAYER, envDefId);
  return { state, originInstanceId: company.currentSite!.instanceId, companyId: company.id };
}

/**
 * Build a M/H phase state (play-hazards step) for an active-player company at
 * `originSite` with the given characters and an ally attached to the first
 * character, declared as moving to a freshly-minted `destinationSite`. The
 * opponent sits idle at `opponentSite`. Used to exercise ally abilities gated
 * on the company's destination region (e.g. Last Child of Ungoliant le-153).
 */
export function buildMovingAllyMHState(opts: {
  characters: CardDefinitionId[];
  originSite: CardDefinitionId;
  destinationSite: CardDefinitionId;
  allyDefId: CardDefinitionId;
  opponentSite: CardDefinitionId;
  opponentCharacters: CardDefinitionId[];
}): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.originSite, characters: opts.characters }], hand: [], siteDeck: [opts.originSite] },
      { id: PLAYER_2, companies: [{ site: opts.opponentSite, characters: opts.opponentCharacters }], hand: [], siteDeck: [opts.opponentSite] },
    ],
  });
  const withAlly = attachAllyToChar(built, 0, opts.characters[0], opts.allyDefId);
  const dest = { instanceId: mint(), definitionId: opts.destinationSite, status: CardStatus.Untapped };
  return {
    ...withAlly,
    phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Shadow] }),
    players: [
      { ...withAlly.players[0], companies: [{ ...withAlly.players[0].companies[0], siteCardOwned: true, destinationSite: dest }] },
      withAlly.players[1],
    ] as unknown as typeof withAlly.players,
  };
}

/**
 * Build a movement/hazard phase state (play-hazards step) where the active
 * (resource) player is a Fallen-wizard who already has Stage cards **in play**,
 * and the hazard player holds `hazardHand`.
 *
 * `stageCardsInPlay` become `cardsInPlay` entries on the Fallen-wizard; every
 * entry in `stageCardsOnLeader` is attached to the first company character's
 * `items` instead — the shape the engine gives a Stage permanent-event played
 * "on a character" (Wizard's Myrmidon wh-84, The Forge-master wh-117); every
 * entry in `storedStageCards` lands in the marshalling-point pile, the shape a
 * Stage resource has once stored (CoE 2.II.4.1, rule 3.33). The resulting
 * stage-point total is derived by `recomputeDerived`, never set by hand, so
 * tests assert against the real derivation.
 *
 * Used by hazards that read the opponent's Stage state (Echoes of the Song
 * wh-17).
 */
export function buildFwStageCardsMHState(opts: {
  stageCardsInPlay: CardDefinitionId[];
  stageCardsOnLeader?: CardDefinitionId[];
  storedStageCards?: CardDefinitionId[];
  hazardHand: CardDefinitionId[];
  characters?: CharacterEntry[];
}): GameState {
  const characters = opts.characters ?? [ARAGORN, LEGOLAS];
  const leader = characters[0];
  const leaderDefId = typeof leader === 'string' ? leader : leader.defId;
  const leaderItems = typeof leader === 'string' ? [] : (leader.items ?? []);
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{
          site: MORIA,
          characters: [
            { defId: leaderDefId, items: [...leaderItems, ...(opts.stageCardsOnLeader ?? [])] },
            ...characters.slice(1),
          ],
        }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: opts.hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
  let state: GameState = { ...built, phaseState: makeMHState() };
  for (const defId of opts.stageCardsInPlay) state = addCardInPlay(state, RESOURCE_PLAYER, defId);
  for (const defId of opts.storedStageCards ?? []) {
    state = addStoredCard(state, RESOURCE_PLAYER, defId, RIVENDELL).state;
  }
  return recomputeDerived(state);
}

/**
 * Build a movement/hazard phase state (play-hazards step) where the active
 * player is a Fallen-wizard resource player who holds a stage resource
 * permanent-event in hand and has a non-Fallen-wizard character available as a
 * target. The active company has declared movement so the resource player is
 * free to take resource actions during the phase.
 *
 * Used to verify rule 5.F1 — stage resource permanent-events can only be played
 * during the organization phase, so such a card must NOT be offered here.
 */
export function buildFwStagePermanentMHState(opts: {
  stagePermanentDefId: CardDefinitionId;
  avatarDefId: CardDefinitionId;
  targetCharDefId: CardDefinitionId;
  site: CardDefinitionId;
  destinationSite: CardDefinitionId;
}): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: opts.site, characters: [opts.avatarDefId, opts.targetCharDefId] }],
        hand: [opts.stagePermanentDefId],
        siteDeck: [opts.destinationSite],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: opts.site, characters: [] }],
        hand: [],
        siteDeck: [opts.destinationSite],
        playDeck: makePlayDeck(),
      },
    ],
  });

  const company = built.players[0].companies[0];
  const dest = { instanceId: mint(), definitionId: opts.destinationSite, status: CardStatus.Untapped };
  return {
    ...built,
    phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness] }),
    players: [
      { ...built.players[0], companies: [{ ...company, siteCardOwned: true, destinationSite: dest }] },
      built.players[1],
    ] as unknown as typeof built.players,
  };
}

/** Find the instance ID of an ally with `allyDefId` attached to the named character, or undefined. */
export function findAllyInstanceId(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  allyDefId: CardDefinitionId,
): CardInstanceId | undefined {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  return state.players[playerIdx].characters[charId]?.allies
    .find(a => a.definitionId === allyDefId)?.instanceId;
}

/**
 * Returns a copy of `state` with `agent` appended to the given player's
 * in-play agents list. Used by tests that need a face-up (or face-down) agent
 * in play, e.g. the Withdrawn to Mordor (dm-165) card test.
 */
export function withAgentInPlay(
  state: GameState,
  playerIdx: number,
  agent: AgentInPlay,
): GameState {
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, agents: [...p.agents, agent] } : p,
  ) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Eliminate a Fallen-wizard's declared avatar: move it from the play deck to
 * the removed-from-play pile. Used to exercise CoE 2.2.F1's "avatar leaves
 * play" trigger, which is gated on actual elimination — not merely on the
 * avatar being absent from the company (e.g. declared but not yet played).
 */
export function withAvatarEliminated(
  state: GameState,
  playerIdx: number,
  avatarDefId: CardDefinitionId,
): GameState {
  const player = state.players[playerIdx];
  const eliminated = player.playDeck.find(c => c.definitionId === avatarDefId)!;
  const players = state.players.map((p, i) =>
    i === playerIdx
      ? { ...p, playDeck: p.playDeck.filter(c => c !== eliminated), outOfPlayPile: [...p.outOfPlayPile, eliminated] }
      : p,
  ) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Place an on-guard card on a player's company and return the updated
 * GameState + card. Cards are placed face-down by default; pass
 * `revealed: true` to place a pre-revealed card (e.g. for testing the
 * post-reveal chain in rule 6.16).
 */
export function placeOnGuard(
  state: GameState,
  playerIdx: number,
  companyIdx: number,
  hazardDefId: CardDefinitionId,
  opts?: { revealed?: boolean },
): { state: GameState; ogCard: OnGuardCard } {
  const ogCard: OnGuardCard = {
    instanceId: mint(),
    definitionId: hazardDefId,
    revealed: opts?.revealed ?? false,
  };
  const company = state.players[playerIdx].companies[companyIdx];
  const updatedCompany = { ...company, onGuardCards: [...company.onGuardCards, ogCard] };
  const updatedCompanies = [...state.players[playerIdx].companies];
  updatedCompanies[companyIdx] = updatedCompany;
  const updatedPlayer = { ...state.players[playerIdx], companies: updatedCompanies };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { state: { ...state, players: [p0, p1] as unknown as typeof state.players }, ogCard };
}

/**
 * Build a state where both players have companies at the same site (Moria)
 * in the play-resources step, with siteEntered = true.
 * P1 is active (resource player), P2 is the hazard player.
 */
export function buildOpponentInfluenceState(opts?: {
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  turnNumber?: number;
  sitePhaseOverrides?: Partial<SitePhaseState>;
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: opts?.p1Chars ?? [ARAGORN] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MORIA, characters: opts?.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: opts?.turnNumber ?? 3,
    phaseState: makeSitePhase(opts?.sitePhaseOverrides),
  };
}

/** Build a state with both players' companies and configurable sites. */
export function buildTargetState(opts: {
  p1Site: CardDefinitionId;
  p2Site: CardDefinitionId;
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.p1Site, characters: opts.p1Chars ?? [ARAGORN] }],
        hand: opts.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: opts.p2Site, characters: opts.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: 3,
    phaseState: makeSitePhase(),
  };
}

/**
 * Build a Fallen-wizard influence scenario: player 0 is a Fallen-wizard with
 * `avatar` at `p1Site`; player 1 is the opponent at `p2Site`. In-play
 * `factions` and extra in-play cards (`p1CardsInPlay`, e.g. Prophet of Doom)
 * are seeded onto player 0, and an explicit `stagePoints` override is applied
 * last (after `recomputeDerived`, which otherwise derives it from in-play stage
 * cards) so the Pallando-specific stage-point play gate can be exercised
 * directly. In the default Site phase both companies have entered their sites
 * on turn 3, so opponent-influence attempts are legal (CoE 10.10 guards met).
 */
export function buildFallenWizardInfluenceState(opts: {
  avatar: CardDefinitionId;
  p1Site: CardDefinitionId;
  p2Site: CardDefinitionId;
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p1Hand?: CardDefinitionId[];
  stagePoints?: number;
  factions?: CardDefinitionId[];
  p1CardsInPlay?: CardDefinitionId[];
  turnNumber?: number;
  phase?: Phase;
  p2Alignment?: Alignment;
}): GameState {
  const phase = opts.phase ?? Phase.Site;
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: opts.p1Site, characters: [opts.avatar] }],
        hand: opts.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: opts.p2Alignment,
        companies: [{ site: opts.p2Site, characters: opts.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
  });
  for (const faction of opts.factions ?? []) state = addCardInPlay(state, RESOURCE_PLAYER, faction);
  for (const card of opts.p1CardsInPlay ?? []) state = addCardInPlay(state, RESOURCE_PLAYER, card);
  state = recomputeDerived(state);
  if (phase === Phase.Site) {
    state = { ...state, turnNumber: opts.turnNumber ?? 3, phaseState: makeSitePhase() };
  } else if (opts.turnNumber !== undefined) {
    state = { ...state, turnNumber: opts.turnNumber };
  }
  if (opts.stagePoints !== undefined) {
    const players = state.players.map(
      (p, i) => i === RESOURCE_PLAYER ? { ...p, stagePoints: opts.stagePoints! } : p,
    ) as unknown as typeof state.players;
    state = { ...state, players };
  }
  return state;
}

/**
 * Build a state at play-resources with both players at Moria.
 * P2 has many characters so their unused GI is low (easier to influence).
 */
export function buildResolutionState(opts?: {
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
  attackerCheatRoll?: number;
  p1Alignment?: Alignment;
  p2Alignment?: Alignment;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: opts?.p1Chars ?? [ARAGORN] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
        alignment: opts?.p1Alignment,
      },
      {
        id: PLAYER_2,
        // Give P2 many characters to use up GI (20 - sum(minds) = low unused GI)
        // Legolas(6) + Gimli(6) + Bilbo(5) = 17 mind, unused GI = 3
        companies: [{ site: MORIA, characters: opts?.p2Chars ?? [LEGOLAS, GIMLI, BILBO] }],
        hand: [],
        siteDeck: [LORIEN],
        alignment: opts?.p2Alignment,
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: opts?.attackerCheatRoll ?? null,
    phaseState: makeSitePhase(),
  };
}

/** Execute the attacker's influence attempt against a specific target. */
export function attemptInfluence(state: GameState, targetDefId?: string) {
  const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
  expect(actions.length).toBeGreaterThan(0);
  const attempt = targetDefId
    ? actions.find(a => {
      const tChar = state.players[1].characters[a.action.targetInstanceId];
      return tChar && tChar.definitionId === targetDefId && !a.action.revealedCardInstanceId;
    })
    : actions.find(a => !a.action.revealedCardInstanceId);
  expect(attempt).toBeDefined();
  const result = reduce(state, attempt!.action);
  expect(result.error).toBeUndefined();
  return { state: result.state, action: attempt!.action, effects: result.effects };
}

/** Execute the defender's roll using the legal action (which includes the explanation). */
export function defendInfluence(state: GameState) {
  const actions = viableActions(state, PLAYER_2, 'opponent-influence-defend');
  expect(actions.length).toBe(1);
  const result = reduce(state, actions[0].action);
  expect(result.error).toBeUndefined();
  return result;
}

// ─── Play-and-resolve helpers ────────────────────────────────────────────────

/** Play a hazard card and resolve the chain (both players pass). */
export function playHazardAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
): GameState {
  return playAndResolve(state, { type: 'play-hazard', player, cardInstanceId, targetCompanyId });
}

/**
 * Play a creature hazard with keying info and resolve the chain.
 * Returns the state after chain resolution (combat should be active).
 */
export function playCreatureHazardAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
  keyedBy: CreatureKeyingMatch,
): GameState {
  const result = reduce(state, {
    type: 'play-hazard',
    player,
    cardInstanceId,
    targetCompanyId,
    keyedBy,
  });
  expect(result.error).toBeUndefined();
  return resolveChain(result.state);
}

/**
 * Run through creature combat: assign a single strike to the specified
 * character, resolve it with the given dice roll, and optionally handle
 * the body check. Returns the state after combat finalizes.
 *
 * @param state - State with active combat (after playing a creature hazard)
 * @param characterDefId - Definition ID of the character to assign the strike to
 * @param strikeRoll - Cheat roll total for strike resolution
 * @param bodyRoll - Cheat roll total for the body check (null to skip)
 * @param tapToFight - Whether to pick the tap-to-fight variant (default false)
 * @param attacker - Player whose character is being struck (default PLAYER_1)
 * @param defender - Opponent player for body checks (default PLAYER_2)
 */
export function runCreatureCombat(
  state: GameState,
  characterDefId: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
  tapToFight = false,
  attacker: PlayerId = PLAYER_1,
  defender: PlayerId = PLAYER_2,
): GameState {
  const charId = findCharInstanceId(state, attacker === PLAYER_1 ? 0 : 1, characterDefId);

  // Assign strike
  const result = reduce(state, { type: 'assign-strike', player: attacker, characterId: charId });
  expect(result.error).toBeUndefined();

  // Resolve strike
  const afterStrike = executeAction(result.state, attacker, 'resolve-strike', strikeRoll, tapToFight);

  // Body check if needed. Creature/agent body checks are rolled by the
  // defender's opponent (CoE 3.I.1: the creature belongs to the attacker,
  // here `attacker`); character body checks are rolled by `defender`.
  if (afterStrike.combat?.phase === 'body-check' && bodyRoll !== null) {
    const bodyRoller = afterStrike.combat.bodyCheckTarget === 'creature' ? attacker : defender;
    return executeAction(afterStrike, bodyRoller, 'body-check-roll', bodyRoll);
  }

  return afterStrike;
}

/** Play a short event and resolve the chain (both players pass). */
export function playShortEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetInstanceId: CardInstanceId,
): GameState {
  return playAndResolve(state, { type: 'play-short-event', player, cardInstanceId, targetInstanceId });
}

/** Play a permanent event and resolve the chain (both players pass). */
export function playPermanentEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCharacterId?: CardInstanceId,
  opts?: {
    targetSiteDefinitionId?: CardDefinitionId;
    discardCardInstanceId?: CardInstanceId;
    targetCompanyId?: CompanyId;
    targetItemInstanceId?: CardInstanceId;
    companionCardInstanceId?: CardInstanceId;
    storeItemInstanceId?: CardInstanceId;
    storeCharacterId?: CardInstanceId;
    opposedCharacterId?: CardInstanceId;
  },
): GameState {
  return playAndResolve(state, {
    type: 'play-permanent-event', player, cardInstanceId, targetCharacterId,
    ...opts,
  });
}

/**
 * Play a dual-mode hazard creature (`creature-alt-event`, mode
 * `permanent-event` — the Nine: Witch-king tw-113, Khamûl tw-47, Adûnaphel
 * tw-2, Ûvatha tw-107, Ren tw-83) from the hazard player's hand in its
 * permanent-event mode against the target company, and resolve the chain. The
 * card ends up untapped in the hazard player's `cardsInPlay`.
 */
export function playAltPermanentEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
): GameState {
  return playAndResolve(state, {
    type: 'play-hazard', player, cardInstanceId, targetCompanyId, altEventMode: 'permanent-event',
  });
}

/**
 * Tap an in-play dual-mode creature-permanent-event during the opponent's
 * movement/hazard phase ("becomes a short-event") and resolve the resulting
 * chain. Picks the offered `tap-alt-permanent-event` action for the given card,
 * optionally the one naming `targetCharacterId` (Adûnaphel tw-2's on-tap
 * character tap). Asserts the tap is actually offered.
 */
export function tapAltPermanentEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCharacterId?: CardInstanceId,
): GameState {
  const tap = viableActions(state, player, 'tap-alt-permanent-event').find(a => {
    const action = a.action as { cardInstanceId?: CardInstanceId; targetCharacterId?: CardInstanceId };
    if (action.cardInstanceId !== cardInstanceId) return false;
    return targetCharacterId === undefined || action.targetCharacterId === targetCharacterId;
  });
  expect(tap).toBeDefined();
  return playAndResolve(state, tap!.action);
}

/** Play a long event and resolve the chain (both players pass). */
export function playLongEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
): GameState {
  return playAndResolve(state, { type: 'play-long-event', player, cardInstanceId });
}

// ─── Auto-attack state builders ──────────────────────────────────────────────

/**
 * Adds cards to the resource player's (P1) cardsInPlay.
 *
 * @param state - A state built by `buildSitePhaseState` or similar.
 * @param cards - Card instances to add to P1's cardsInPlay.
 */
export function addP1CardsInPlay<T extends GameState>(
  state: T,
  cards: CardInPlay[],
): T {
  const players = state.players.map((p, i) =>
    i === 0 ? { ...p, cardsInPlay: [...p.cardsInPlay, ...cards] } : p,
  ) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Adds cards to the hazard player's (P2) cardsInPlay.
 *
 * @param state - A state built by `buildSitePhaseState` or similar.
 * @param cards - Card instances to add to P2's cardsInPlay.
 */
export function addP2CardsInPlay<T extends GameState>(
  state: T,
  cards: CardInPlay[],
): T {
  const players = state.players.map((p, i) =>
    i === 1 ? { ...p, cardsInPlay: [...p.cardsInPlay, ...cards] } : p,
  ) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Build a Ringwraith site-phase state stopped at the `automatic-attacks` step,
 * with `characters` forming a single company at `site`. Used to drive a minion
 * site's "each character faces 1 strike" automatic attack (e.g. Beorn's House,
 * Edoras, Raider-hold, Thranduil's Halls, Variag Camp, The Worthy Hills). The
 * opponent sits at Minas Morgul so the state is a valid two-player game.
 *
 * Pass an all-Men/Elves company for a covert company (detainment fires) or
 * include an Orc (e.g. le-31) to make the company overt.
 *
 * @param site - Minion site definition ID hosting the each-character attack.
 * @param characters - Character definition IDs forming the entering company.
 */
export function setupRingwraithAutoAttack(
  site: CardDefinitionId,
  characters: CardDefinitionId[],
): GameState {
  const MINAS_MORGUL = 'le-390' as CardDefinitionId;
  const DOL_GULDUR = 'le-367' as CardDefinitionId;
  const LAGDUF = 'le-18' as CardDefinitionId;
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'automatic-attacks',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: false,
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
  return { ...base, phaseState: sitePhaseState };
}

/**
 * Run through auto-attack combat at a site. Triggers the attack via a pass
 * action, assigns a single strike to the specified character, resolves it
 * with the given dice roll, and optionally handles the body check.
 *
 * @param baseState - State at the automatic-attacks step (use setupAutoAttackStep)
 * @param characterDefId - Definition ID of the character to assign the strike to
 * @param strikeRoll - Cheat roll total for strike resolution
 * @param bodyRoll - Cheat roll total for the body check (null to skip)
 * @param tapToFight - Whether to pick the tap-to-fight variant (default true)
 * @param attacker - Player triggering the attack (default PLAYER_1)
 * @param defender - Opponent player for body checks (default PLAYER_2)
 */
export function runAutoAttackCombat(
  baseState: GameState,
  characterDefId: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
  tapToFight = true,
  attacker: PlayerId = PLAYER_1,
  defender: PlayerId = PLAYER_2,
): ReducerResult {
  // Trigger auto-attack
  let result = reduce(baseState, { type: 'pass', player: attacker });
  expect(result.error).toBeUndefined();
  expect(result.state.combat).toBeDefined();

  const charId = findCharInstanceId(result.state, attacker === PLAYER_1 ? 0 : 1, characterDefId);

  // Assign strike
  result = reduce(result.state, { type: 'assign-strike', player: attacker, characterId: charId });
  expect(result.error).toBeUndefined();

  // Get resolve-strike action from legal actions
  const resolveActions = viableActions({ ...result.state, cheatRollTotal: strikeRoll }, attacker, 'resolve-strike');
  expect(resolveActions.length).toBeGreaterThan(0);
  const selectedAction = tapToFight
    ? (resolveActions.find(a => 'tapToFight' in a.action && a.action.tapToFight)?.action ?? resolveActions[0].action)
    : (resolveActions.find(a => 'tapToFight' in a.action && !a.action.tapToFight)?.action ?? resolveActions[0].action);

  result = reduce({ ...result.state, cheatRollTotal: strikeRoll }, selectedAction);
  expect(result.error).toBeUndefined();

  // If body check is needed. Creature/agent body checks are rolled by the
  // defender's opponent (CoE 3.I.1: the creature belongs to the attacker,
  // here `attacker`); character body checks are rolled by `defender`.
  if (result.state.combat?.phase === 'body-check' && bodyRoll !== null) {
    const bodyRoller = result.state.combat.bodyCheckTarget === 'creature' ? attacker : defender;
    const bodyActions = viableActions(result.state, bodyRoller, 'body-check-roll');
    expect(bodyActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: bodyRoll }, bodyActions[0].action);
    expect(result.error).toBeUndefined();
  }

  return result;
}

/**
 * Run a multi-character automatic-attack from the setupAutoAttackStep state.
 * Triggers the attack via a pass from the resource player, assigns characters
 * in strikeDefs order, then resolves each strike.
 *
 * @param baseState - State at the automatic-attacks step (use setupAutoAttackStep).
 * @param strikeDefs - Ordered list of characters and their outcome parameters.
 *   - `characterDefId`: character definition ID to assign to a strike
 *   - `roll`: cheat roll total (2–12) for strike resolution
 *   - `tapToFight`: if true (default), character taps to fight at full prowess; if false, stays untapped at prowess-3
 *   - `bodyRoll`: cheat roll for body check if wounded; defaults to 12 (survives)
 * @param resourcePlayer - The resource player who assigns characters (default PLAYER_1).
 * @param hazardPlayer - The hazard player who rolls body checks (default PLAYER_2).
 * @returns ReducerResult after all strikes resolved and combat finalized.
 */
export function runAutoAttackCombatMulti(
  baseState: GameState,
  strikeDefs: Array<{ characterDefId: CardDefinitionId; roll: number; tapToFight?: boolean; bodyRoll?: number }>,
  resourcePlayer: PlayerId = PLAYER_1,
  hazardPlayer: PlayerId = PLAYER_2,
): ReducerResult {
  // Trigger auto-attack
  const result = reduce(baseState, { type: 'pass', player: resourcePlayer });
  expect(result.error).toBeUndefined();
  expect(result.state.combat).toBeDefined();

  return continueAutoAttackCombat(result.state, strikeDefs, resourcePlayer, hazardPlayer);
}

/**
 * Continue resolving an already-active automatic-attack combat: assigns
 * characters in `strikeDefs` order (falling back to the attacker assigning
 * any remaining unassigned combatants), then resolves each strike/body-check
 * in sequence. Shares its post-trigger logic with {@link runAutoAttackCombatMulti},
 * which calls this after triggering the attack via a resource-player pass —
 * use this directly when combat is already active (e.g. after a mid-combat
 * state mutation).
 *
 * @param state - State with `combat` already active from an automatic-attack.
 * @param strikeDefs - See {@link runAutoAttackCombatMulti}.
 * @param resourcePlayer - The resource player who assigns characters (default PLAYER_1).
 * @param hazardPlayer - The hazard player who rolls body checks (default PLAYER_2).
 * @returns ReducerResult after all strikes resolved and combat finalized.
 */
export function continueAutoAttackCombat(
  state: GameState,
  strikeDefs: Array<{ characterDefId: CardDefinitionId; roll: number; tapToFight?: boolean; bodyRoll?: number }>,
  resourcePlayer: PlayerId = PLAYER_1,
  hazardPlayer: PlayerId = PLAYER_2,
): ReducerResult {
  const resIdx = state.players.findIndex(p => p.id === resourcePlayer);
  let s = state;

  // Assign characters in order
  for (const { characterDefId } of strikeDefs) {
    if (s.combat?.assignmentPhase !== 'defender') break;
    const charId = findCharInstanceId(s, resIdx, characterDefId);
    const assignable = viableActions(s, resourcePlayer, 'assign-strike');
    const act = assignable.find(ea => (ea.action as { characterId: unknown }).characterId === charId);
    if (act) {
      const r = reduce(s, act.action);
      expect(r.error).toBeUndefined();
      s = r.state;
    }
  }

  // Defender passes if still in defender assignment
  if (s.combat?.assignmentPhase === 'defender') {
    const r = reduce(s, { type: 'pass', player: resourcePlayer });
    if (!r.error) s = r.state;
  }

  // Attacker assigns any remaining unassigned combatants
  while (s.combat?.phase === 'assign-strikes' && s.combat.assignmentPhase === 'attacker') {
    const assignable = viableActions(s, hazardPlayer, 'assign-strike');
    if (assignable.length === 0) break;
    const r = reduce(s, assignable[0].action);
    if (r.error) break;
    s = r.state;
  }

  // Resolve strikes
  while (s.combat && s.combat.phase !== 'assign-strikes') {
    if (s.combat.phase === 'choose-strike-order') {
      const actions = viableActions(s, resourcePlayer, 'choose-strike-order');
      if (actions.length === 0) break;
      const r = reduce(s, actions[0].action);
      if (r.error) break;
      s = r.state;
    } else if (s.combat.phase === 'resolve-strike') {
      const charId = s.combat.strikeAssignments[s.combat.currentStrikeIndex]?.characterId;
      const defId = charId ? resolveInstanceId(s, charId) : undefined;
      const sd = defId ? strikeDefs.find(d => d.characterDefId === defId) : undefined;
      const roll = sd?.roll ?? 6;
      const tap = sd?.tapToFight ?? true;
      const actions = viableActions({ ...s, cheatRollTotal: roll }, resourcePlayer, 'resolve-strike');
      if (actions.length === 0) break;
      const chosen = tap
        ? (actions.find(a => 'tapToFight' in a.action && a.action.tapToFight)?.action ?? actions[0].action)
        : (actions.find(a => 'tapToFight' in a.action && !a.action.tapToFight)?.action ?? actions[0].action);
      const r = reduce({ ...s, cheatRollTotal: roll }, chosen);
      if (r.error) break;
      s = r.state;
    } else if (s.combat.phase === 'body-check') {
      const charIdx = s.combat.currentStrikeIndex;
      const charId = s.combat.strikeAssignments[charIdx]?.characterId;
      const defId = charId ? resolveInstanceId(s, charId) : undefined;
      const sd = defId ? strikeDefs.find(d => d.characterDefId === defId) : undefined;
      const bodyRoll = sd?.bodyRoll ?? 12;
      // Creature/agent body checks are rolled by the defender (CoE 3.I.1: the
      // creature belongs to the attacker); character body checks are rolled
      // by the attacker.
      const bodyRoller = s.combat.bodyCheckTarget === 'creature' ? resourcePlayer : hazardPlayer;
      const actions = viableActions(s, bodyRoller, 'body-check-roll');
      if (actions.length === 0) break;
      const r = reduce({ ...s, cheatRollTotal: bodyRoll }, actions[0].action);
      if (r.error) break;
      s = r.state;
    } else if (s.combat.phase === 'item-salvage') {
      const r = reduce(s, { type: 'pass', player: resourcePlayer });
      if (r.error) break;
      s = r.state;
    } else {
      break;
    }
  }

  return { state: s };
}

/**
 * Run through a card-triggered auto-attack (card-triggered-attack source) that is
 * already active on `state.combat`. Assigns each strike in `strikeDefs` order:
 * the defender fills their assignments first, then the attacker handles any
 * remaining unassigned combatants plus optional excess. Resolves each
 * character's strike in sequence and handles body checks.
 *
 * Use this after playing a resource permanent event whose `trigger-attack-on-play`
 * effect (e.g. Rescue Prisoners) places combat on the state during chain resolution.
 *
 * @param state - Game state with active `card-triggered-attack` combat.
 * @param strikeDefs - Ordered list of `{ characterDefId, roll, bodyRoll? }`. Repeat
 *   a `characterDefId` to assign excess strikes. The defending player controls
 *   character assignment; the engine assigns remaining unassigned combatants to
 *   the attacker automatically via pass.
 * @returns State after all strikes resolved and combat finalized.
 */
export function runCardTriggeredAttackCombat(
  state: GameState,
  strikeDefs: Array<{ characterDefId: CardDefinitionId; roll: number; bodyRoll?: number | null }>,
): GameState {
  const combat = state.combat!;
  const defPlayer = combat.defendingPlayerId;
  const atkPlayer = combat.attackingPlayerId;
  const defIdx = state.players.findIndex(p => p.id === defPlayer);

  let s = state;

  // Assign strikes: defender assigns first (untapped, unassigned characters only),
  // then passes so the attacker can assign any remaining unassigned combatants.
  const defAssigns = new Set<string>();
  for (const { characterDefId } of strikeDefs) {
    const charId = findCharInstanceId(s, defIdx, characterDefId);
    const assignable = viableActions(s, defPlayer, 'assign-strike');
    const thisAction = assignable.find(
      ea => (ea.action as { characterId: unknown }).characterId === charId,
    );
    if (thisAction) {
      const result = reduce(s, thisAction.action);
      expect(result.error).toBeUndefined();
      s = result.state;
      defAssigns.add(charId as string);
    }
  }

  // Defender passes if still in the defender-assignment sub-phase
  if (s.combat?.assignmentPhase === 'defender') {
    const passResult = reduce(s, { type: 'pass', player: defPlayer });
    if (!passResult.error) s = passResult.state;
  }

  // Attacker assigns any remaining unassigned combatants
  while (s.combat?.phase === 'assign-strikes' && s.combat.assignmentPhase === 'attacker') {
    const assignable = viableActions(s, atkPlayer, 'assign-strike');
    if (assignable.length === 0) break;
    const result = reduce(s, assignable[0].action);
    if (result.error) break;
    s = result.state;
  }

  // Resolve each assignment entry in sequence
  while (s.combat && s.combat.phase !== 'assign-strikes') {
    if (s.combat.phase === 'choose-strike-order') {
      s = executeAction(s, defPlayer, 'choose-strike-order');
    } else if (s.combat.phase === 'resolve-strike') {
      // Find the roll for the character currently being resolved
      const charId = s.combat.strikeAssignments[s.combat.currentStrikeIndex]?.characterId;
      const defId = charId ? resolveInstanceId(s, charId) : undefined;
      const strikeDef = defId
        ? strikeDefs.find(sd => sd.characterDefId === defId)
        : undefined;
      const roll = strikeDef?.roll ?? 6;
      s = executeAction(s, defPlayer, 'resolve-strike', roll, true);
    } else if (s.combat.phase === 'body-check') {
      const charIdx = s.combat.currentStrikeIndex;
      const charId = s.combat.strikeAssignments[charIdx]?.characterId;
      const defId = charId ? resolveInstanceId(s, charId) : undefined;
      const strikeDef = defId
        ? strikeDefs.find(sd => sd.characterDefId === defId)
        : undefined;
      const bodyRoll = strikeDef?.bodyRoll ?? null;
      // Creature/agent body checks are rolled by the defender (CoE 3.I.1: the
      // creature belongs to the attacker); character body checks are rolled
      // by the attacker.
      const bodyRoller = s.combat.bodyCheckTarget === 'creature' ? defPlayer : atkPlayer;
      if (bodyRoll !== null) {
        s = executeAction(s, bodyRoller, 'body-check-roll', bodyRoll);
      } else {
        // Skip body check with a safe roll (high number = character survives)
        s = executeAction(s, bodyRoller, 'body-check-roll', 12);
      }
    } else if (s.combat.phase === 'item-salvage') {
      s = executeAction(s, defPlayer, 'pass');
    } else {
      break;
    }
  }

  return s;
}

/** Instance ID of a company's on-guard card (defaults to the first one). */
export function onGuardCardIdAt(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
  ogIdx = 0,
): CardInstanceId {
  return getOnGuardCard(state, playerIdx, companyIdx, ogIdx).instanceId;
}

/**
 * Viable actions of a given type that target a hand card with the given
 * definition ID. Collapses the frequent pattern of collecting
 * `viableActions(...)` and then narrowing by looking up each action's
 * `cardInstanceId` in the player's hand to match `defId`.
 */
export function viableActionsForHandCard(
  state: GameState,
  playerId: PlayerId,
  actionType: string,
  playerIdx: number,
  defId: CardDefinitionId,
) {
  const matchingIds = new Set(
    state.players[playerIdx].hand
      .filter(c => c.definitionId === defId)
      .map(c => c.instanceId as string),
  );
  return viableActions(state, playerId, actionType).filter(ea => {
    const action = ea.action as { cardInstanceId?: CardInstanceId };
    return action.cardInstanceId !== undefined && matchingIds.has(action.cardInstanceId as string);
  });
}

/** Hazards attached to a character (located by definition ID). */
export function getHazardsOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).hazards;
}

/** Items attached to a character (located by definition ID). */
export function getItemsOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).items;
}

/** Allies attached to a character (located by definition ID). */
export function getAlliesOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).allies;
}

/** Follower instance IDs attached to a character (located by definition ID). */
export function getFollowersOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInstanceId[] {
  return getCharacter(state, playerIdx, charDefId).followers;
}

/**
 * Build a single {@link CollectedEffect} wrapping a check-modifier. Used by
 * effect-resolver tests to assemble inputs without leaking resolver internals.
 */
export function makeCheckModifierEffect(
  check: CheckKind | readonly CheckKind[],
  value: number,
): CollectedEffect {
  return {
    effect: { type: 'check-modifier', check, value },
    sourceDef: undefined as never,
    sourceInstance: 'src-1' as never,
  };
}

/**
 * Build the pair of constraints River (tw-84) adds when it resolves: a
 * `site-phase-do-nothing` restriction plus a parallel `granted-action`
 * that lets an untapped ranger tap to cancel. Both share the same source
 * so `remove-constraint` sweeps them together.
 */
export function makeRiverConstraints(
  source: CardInstanceId,
  companyId: CompanyId,
  riverDefId: CardDefinitionId,
): readonly [Omit<ActiveConstraint, 'id'>, Omit<ActiveConstraint, 'id'>] {
  const restriction: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: riverDefId,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: { type: 'site-phase-do-nothing' },
  };
  const grant: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: riverDefId,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: {
      type: 'granted-action',
      action: 'cancel-river',
      cost: { tap: 'character' },
      when: {
        $and: [
          { 'actor.skills': { $includes: 'ranger' } },
          { 'actor.status': 'untapped' },
        ],
      },
      apply: { type: 'remove-constraint', select: 'constraint-source' },
    },
  };
  return [restriction, grant];
}

/** Apply both River constraints to the state via {@link addConstraint}. */
export function addRiverConstraints(
  state: GameState,
  source: CardInstanceId,
  companyId: CompanyId,
  riverDefId: CardDefinitionId,
): GameState {
  const [restriction, grant] = makeRiverConstraints(source, companyId, riverDefId);
  return addConstraint(addConstraint(state, restriction), grant);
}

/**
 * Mint a River card, register both of its constraints on the active
 * company, and stash the card record somewhere `resolveInstanceId` can
 * find it so the constraint filter can read its `actor.skills`. Wraps
 * the three-step setup (mint + addConstraint×2 + pushCardInPlay) used
 * across every River test. Defaults to pushing the River into the
 * resource player's cardsInPlay because the River tests patch it there
 * as an artificial lookup target, not because the card is truly in that
 * player's ownership.
 */
export function installRiverOnActiveCompany(
  state: GameState,
  riverDefId: CardDefinitionId,
  lookupPlayerIdx: 0 | 1 = 0,
): { state: GameState; riverInstance: CardInstanceId } {
  const riverInstance = mint();
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const constrained = addRiverConstraints(state, riverInstance, companyId, riverDefId);
  const card: CardInPlay = {
    instanceId: riverInstance,
    definitionId: riverDefId,
    status: CardStatus.Untapped,
  };
  return { state: pushCardInPlay(constrained, lookupPlayerIdx, card), riverInstance };
}

/**
 * Build a Great Ship (tw-248) granted-action constraint payload. Mirrors
 * what the card's `self-enters-play` apply produces: a turn-scoped
 * `granted-action` that offers `cancel-chain-entry` to any untapped
 * character in the target company when the site path is coastal.
 */
export function makeGreatShipConstraint(
  sourceId: CardInstanceId,
  companyId: CompanyId,
  greatShipDefId: CardDefinitionId,
): Omit<ActiveConstraint, 'id'> {
  return {
    source: sourceId,
    sourceDefinitionId: greatShipDefId,
    scope: { kind: 'turn' },
    target: { kind: 'company', companyId },
    kind: {
      type: 'granted-action',
      action: 'cancel-chain-entry',
      phase: Phase.MovementHazard,
      cost: { tap: 'character' },
      when: {
        $and: [
          { 'chain.hazardCount': { $gt: 0 } },
          { path: { $includes: 'coastal' } },
          { path: { $noConsecutiveOtherThan: 'coastal' } },
        ],
      },
      apply: { type: 'cancel-chain-entry', select: 'most-recent-unresolved-hazard' },
    },
  };
}

/**
 * Add an `auto-attack-race-duplicate` constraint for the given source card and race.
 * Mirrors the constraint added by the `self-enters-play → add-constraint` DSL path
 * when a permanent event like The Moon Is Dead enters play.
 *
 * Use this in test fixtures that pre-place a permanent event in `cardsInPlay`
 * without going through the play chain, so the duplication logic still fires.
 */
export function addRaceDuplicateConstraint<T extends GameState>(
  state: T,
  source: CardInstanceId,
  sourceDefinitionId: CardDefinitionId,
  race: Race,
  playerId: PlayerId,
): T {
  return addConstraint(state, {
    source,
    sourceDefinitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId },
    kind: { type: 'auto-attack-race-duplicate', race },
  }) as T;
}

// ─── Single-character combat scaffolding ────────────────────────────────────

/**
 * Options for {@link makeSingleCharCombatState}. Describes a combat where a
 * lone hero character (player 0, company 0, character 0) faces a synthetic
 * creature attack with the given prowess/body/race — used by card tests
 * that exercise modifiers keyed to a specific enemy race.
 */
export interface SingleCharCombatOpts {
  heroDefId: CardDefinitionId;
  creatureRace: Race;
  creatureProwess: number;
  creatureBody: number | null;
  /** If true, the test skips strike assignment (phase starts at `resolve-strike`). */
  preAssigned?: boolean;
  /**
   * Alignment of the defending player. Defaults to the hero side; pass
   * `Alignment.Ringwraith` (with a minion `site`) so a minion card's test
   * exercises the minion code paths rather than hero ones.
   */
  alignment?: Alignment;
  /** Site the defending company occupies. Defaults to Moria (hero copy). */
  site?: CardDefinitionId;
  /** Site deck for the defending player. Defaults to Minas Tirith (hero copy). */
  siteDeck?: readonly CardDefinitionId[];
}

/**
 * Build a state with a single character in combat against a fabricated
 * creature with the given race/prowess/body. Phase is M/H in Shadow; when
 * `preAssigned` is true the state is ready to resolve a strike, otherwise it
 * awaits assignment. Used by e.g. Éowyn's anti-nazgûl tests.
 *
 * The defending side defaults to hero fixtures; minion card tests pass
 * `alignment`/`site`/`siteDeck` to keep the fixture on their own alignment.
 */
export function makeSingleCharCombatState(opts: SingleCharCombatOpts): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        ...(opts.alignment ? { alignment: opts.alignment } : {}),
        companies: [{ site: opts.site ?? MORIA, characters: [opts.heroDefId] }],
        hand: [],
        siteDeck: [...(opts.siteDeck ?? [MINAS_TIRITH])],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const heroId = findCharInstanceId(state, RESOURCE_PLAYER, opts.heroDefId);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: `fake-${opts.creatureRace}` as never },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.creatureProwess,
    creatureBody: opts.creatureBody,
    creatureRace: opts.creatureRace,
    strikeAssignments: opts.preAssigned
      ? [{ characterId: heroId, excessStrikes: 0, resolved: false }]
      : [],
    currentStrikeIndex: 0,
    phase: opts.preAssigned ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: opts.preAssigned ? 'done' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...state, phaseState: makeShadowMHState(), combat };
}

/**
 * Options for {@link makeCompanyCombatState}. Generalizes
 * {@link makeSingleCharCombatState} to a multi-character company facing a
 * multi-strike attack — needed by tests exercising strike-assignment choices
 * (e.g. a `face-all-strikes-option` item) where a single defender or a single
 * strike would make the choice meaningless.
 */
export interface CompanyCombatOpts {
  /** The defending company's characters (bare definition IDs or full setups). */
  characters: readonly CharacterEntry[];
  creatureRace: Race;
  creatureProwess: number;
  creatureBody: number | null;
  /** Total strikes in the attack. Defaults to 1. */
  strikesTotal?: number;
  /** Site the defending company occupies. Defaults to Moria (hero copy). */
  site?: CardDefinitionId;
  /** Site deck for the defending player. Defaults to Minas Tirith (hero copy). */
  siteDeck?: readonly CardDefinitionId[];
}

/**
 * Build a state with a multi-character company in combat against a
 * fabricated creature attack, awaiting strike assignment (defender phase,
 * nothing assigned yet).
 */
export function makeCompanyCombatState(opts: CompanyCombatOpts): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site ?? MORIA, characters: [...opts.characters] }],
        hand: [],
        siteDeck: [...(opts.siteDeck ?? [MINAS_TIRITH])],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const companyId = companyIdAt(state, RESOURCE_PLAYER);

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: `fake-${opts.creatureRace}` as never },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: opts.strikesTotal ?? 1,
    strikeProwess: opts.creatureProwess,
    creatureBody: opts.creatureBody,
    creatureRace: opts.creatureRace,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...state, phaseState: makeShadowMHState(), combat };
}

// ─── Detainment-strike scaffolding ──────────────────────────────────────────

/**
 * Options for {@link makeDetainmentStrikeState}.
 */
export interface DetainmentStrikeOpts {
  /** Whether the attack is detainment. */
  detainment: boolean;
  /** Creature's strike prowess. */
  strikeProwess: number;
  /** Creature body — null disables creature body check. */
  creatureBody?: number | null;
  /** Pre-strike status of the defending character (default Untapped). */
  charStatus?: CardStatus;
  /**
   * If set, a Barrow-wight creature card is minted into the hazard
   * player's cardsInPlay and used as the `attackSource`. Needed for
   * rule-8.34 MP/discard routing tests, which assert where the creature
   * card lands after `finalizeCombat`.
   */
  creatureInPlay?: CardDefinitionId;
  /**
   * If set, an ally with this definition is attached to Aragorn and the
   * strike is assigned to the ally instead of the character. Used by the
   * rule-8.32 ally-detainment tests.
   */
  allyDefId?: CardDefinitionId;
  /** Pre-strike status of the ally (default Untapped). */
  allyStatus?: CardStatus;
}

/**
 * Build a single-character M/H-phase state poised to resolve one strike
 * against Aragorn from a fabricated creature. Parameterised by the
 * detainment flag and creature stats so the rule-8.32 suite can exercise
 * every branch of the wound / body-check / tap path.
 *
 * Returns the state plus Aragorn's instance id for direct status
 * assertions after the strike resolves.
 */
export function makeDetainmentStrikeState(opts: DetainmentStrikeOpts): {
  state: GameState;
  characterId: CardInstanceId;
  creatureInstanceId: CardInstanceId;
  allyId: CardInstanceId | null;
} {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const characterId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const withStatus = opts.charStatus ? setCharStatus(base, RESOURCE_PLAYER, ARAGORN, opts.charStatus) : base;

  let withAlly = withStatus;
  let allyId: CardInstanceId | null = null;
  if (opts.allyDefId) {
    withAlly = attachAllyToChar(withStatus, RESOURCE_PLAYER, ARAGORN, opts.allyDefId);
    if (opts.allyStatus) {
      withAlly = setAllyStatus(withAlly, RESOURCE_PLAYER, ARAGORN, opts.allyDefId, opts.allyStatus);
    }
    allyId = withAlly.players[RESOURCE_PLAYER].characters[characterId].allies[0].instanceId;
  }

  let creatureInstanceId: CardInstanceId = 'fake-creature' as CardInstanceId;
  let stateWithCreature: GameState = withAlly;
  if (opts.creatureInPlay) {
    creatureInstanceId = mint();
    const hazardIdx = stateWithCreature.players.findIndex(p => p.id === PLAYER_2);
    const players: [PlayerState, PlayerState] = [
      stateWithCreature.players[0],
      stateWithCreature.players[1],
    ];
    players[hazardIdx] = {
      ...players[hazardIdx],
      cardsInPlay: [
        ...players[hazardIdx].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: opts.creatureInPlay, status: CardStatus.Untapped },
      ],
    };
    stateWithCreature = { ...stateWithCreature, players };
  }

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId: allyId ?? characterId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: opts.detainment,
  };

  return {
    state: { ...stateWithCreature, phaseState: makeShadowMHState(), combat },
    characterId,
    creatureInstanceId,
    allyId,
  };
}

// ─── Opponent-influence scaffolding ─────────────────────────────────────────

/**
 * Build a site-phase state where PLAYER_1 is attempting opponent influence
 * against PLAYER_2's characters. PLAYER_2 has a wizard (Gandalf) and one
 * card in hand, ready to be used as a cancel-influence response. Used by
 * Wizard's Laughter (tw-362) and other spell-cancel tests.
 */
export function buildWizardCancelInfluenceState(handCard: CardDefinitionId): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: MORIA, characters: [GANDALF, LEGOLAS] }], hand: [handCard], siteDeck: [LORIEN] },
    ],
    phase: Phase.Site,
    recompute: true,
  });
  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: 12,
    phaseState: makeSitePhase(),
  };
}

// ─── Long-event / ahunt scaffolding ─────────────────────────────────────────

/**
 * Build an order-effects M/H state for a company moving through the given
 * region path, with an ahunt long-event card (plus any extras) in the
 * hazard player's cardsInPlay. Used by ahunt card tests to drive the
 * order-effects trigger without running through movement manually.
 */
export function buildAhuntOrderEffectsState(opts: {
  ahuntDefId: CardDefinitionId;
  pathNames: readonly string[];
  pathTypes: readonly RegionType[];
  extraCardsInPlay?: readonly CardDefinitionId[];
  /**
   * Which player holds the ahunt source card (and `extraCardsInPlay`). Defaults
   * to the hazard player (P2). Set to the moving player (P1) to model a Dragons
   * "Roused" faction's own region attack — its `cancel-manifestation-attacks`
   * suppresses it for the controller's own moving company (Smaug Roused le-285).
   */
  ahuntOwnerIndex?: 0 | 1;
  /**
   * Extra in-play cards for the moving player (P1), regardless of ahunt owner.
   * Used to place a "Roused" faction in the mover's play area while an
   * opponent's same-chain Ahunt sits in P2, to test the cross cancellation.
   */
  movingPlayerCardsInPlay?: readonly CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN, GANDALF] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

  const ownerCards: CardInPlay[] = [
    { instanceId: mint(), definitionId: opts.ahuntDefId, status: CardStatus.Untapped },
    ...(opts.extraCardsInPlay ?? []).map(defId => ({
      instanceId: mint(),
      definitionId: defId,
      status: CardStatus.Untapped,
    })),
  ];
  const movingCards: CardInPlay[] = (opts.movingPlayerCardsInPlay ?? []).map(defId => ({
    instanceId: mint(),
    definitionId: defId,
    status: CardStatus.Untapped,
  }));

  const ownerIndex = opts.ahuntOwnerIndex ?? 1;
  let withCards = ownerIndex === 0 ? addP1CardsInPlay(base, ownerCards) : addP2CardsInPlay(base, ownerCards);
  if (movingCards.length > 0) withCards = addP1CardsInPlay(withCards, movingCards);

  return {
    ...withCards,
    phaseState: makeMHState({
      step: 'order-effects' as const,
      resolvedSitePathNames: opts.pathNames as string[],
      resolvedSitePath: opts.pathTypes as RegionType[],
    }),
  };
}

/**
 * Drive an already-active ahunt combat sequence to completion, forcing every
 * strike roll (and body-check roll) to `roll` via `cheatRollTotal`. Returns the
 * terminal state (combat null) plus the distinct combats observed in order
 * (one entry per attack in a multi-attack ahunt like Mordor in Arms dm-72).
 *
 * A high roll (12) defeats every strike; a mid roll lets a high-prowess attack's
 * strikes succeed, so a grouped ahunt is not fully defeated. `resourcePlayer`
 * is the moving/defending player; `hazardPlayer` rolls body checks.
 */
export function runAhuntSequence(
  start: GameState,
  roll: number,
  resourcePlayer: PlayerId = PLAYER_1,
  hazardPlayer: PlayerId = PLAYER_2,
): { end: GameState; combats: Array<{ strikes: number; prowess: number; race?: Race; body: number | null }> } {
  let cur = start;
  const combats: Array<{ strikes: number; prowess: number; race?: Race; body: number | null }> = [];
  let lastKey = '';
  for (let i = 0; i < 400 && cur.combat !== null; i++) {
    const c = cur.combat;
    const key = `${c.strikesTotal}/${c.strikeProwess}/${c.creatureRace ?? ''}`;
    if (key !== lastKey) {
      combats.push({ strikes: c.strikesTotal, prowess: c.strikeProwess, race: c.creatureRace, body: c.creatureBody });
      lastKey = key;
    }
    cur = { ...cur, cheatRollTotal: roll };
    let acts = viableActions(cur, resourcePlayer, 'assign-strike');
    if (acts.length) { cur = dispatch(cur, acts[0].action); continue; }
    // Excess strikes (more strikes than characters) are assigned by the attacker.
    acts = viableActions(cur, hazardPlayer, 'assign-strike');
    if (acts.length) { cur = dispatch(cur, acts[0].action); continue; }
    acts = viableActions(cur, resourcePlayer, 'choose-strike-order');
    if (acts.length) { cur = dispatch(cur, acts[0].action); continue; }
    acts = viableActions(cur, resourcePlayer, 'resolve-strike');
    if (acts.length) { cur = dispatch(cur, acts[0].action); continue; }
    // Creature/agent body checks are rolled by the defender (CoE 3.I.1: the
    // creature belongs to the attacker); character body checks are rolled by
    // the attacker (hazardPlayer).
    const bodyRoller = c.bodyCheckTarget === 'creature' ? resourcePlayer : hazardPlayer;
    acts = viableActions(cur, bodyRoller, 'body-check-roll');
    if (acts.length) { cur = dispatch(cur, acts[0].action); continue; }
    let stepped = false;
    for (const pid of [resourcePlayer, hazardPlayer]) {
      const p = viableActions(cur, pid, 'pass');
      if (p.length) { cur = dispatch(cur, p[0].action); stepped = true; break; }
    }
    if (!stepped) break;
  }
  return { end: cur, combats };
}

// ─── On-guard scaffolding ───────────────────────────────────────────────────

/**
 * Build a site-phase state with PLAYER_1 at the given site and PLAYER_2 at
 * Lorien. Shared scaffolding for rule 6.02 (reveal-on-guard-attacks) and
 * similar on-guard tests where only the site and characters vary.
 */
export function buildSitePhaseTwoPlayer(opts: {
  site: CardDefinitionId;
  heroChars?: readonly CardDefinitionId[];
  heroHand?: readonly CardDefinitionId[];
  heroSiteDeck?: readonly CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site, characters: [...(opts.heroChars ?? [ARAGORN])] }],
        hand: [...(opts.heroHand ?? [])],
        siteDeck: [...(opts.heroSiteDeck ?? [])],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/**
 * Build a site-phase scenario where PLAYER_1's company has an on-guard
 * card attached. Returns the pre-configured state at the `play-resources`
 * step plus the OG card record so tests can target it by instance ID.
 */
export function buildOnGuardSiteScenario(opts: {
  site: CardDefinitionId;
  heroChars?: readonly CardDefinitionId[];
  heroHand?: readonly CardDefinitionId[];
  onGuard: CardDefinitionId;
}): { testState: GameState; ogCard: OnGuardCard } {
  const base = buildSitePhaseTwoPlayer({
    site: opts.site,
    heroChars: opts.heroChars,
    heroHand: opts.heroHand,
  });
  const { state, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, opts.onGuard);
  return { testState: { ...state, phaseState: makeSitePhase() }, ogCard };
}

// ─── Card-specific scenario builders ────────────────────────────────────────

/**
 * Build a play-hazards M/H state for An Unexpected Outpost (dm-45): the
 * hazard player's hand always contains AN_UNEXPECTED_OUTPOST, with optional
 * sideboard, discard, extra in-play cards, and additional hand cards.
 * PLAYER_1's company sits at Rivendell heading to Moria.
 */
export function buildAnUnexpectedOutpostMH(opts?: {
  sideboard?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  p2CardsInPlay?: CardInPlay[];
  hand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [AN_UNEXPECTED_OUTPOST, ...(opts?.hand ?? [])],
        siteDeck: [MINAS_TIRITH],
        sideboard: opts?.sideboard ?? [],
        discardPile: opts?.discardPile ?? [],
        cardsInPlay: opts?.p2CardsInPlay ?? [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/**
 * Set up an M/H combat vs. Cave-drake at Moria via wilderness. PLAYER_1 has
 * the given pair of heroes in their company and can hold an optional hand.
 * Returns the state immediately after the creature is revealed on the chain,
 * ready for strike assignment. Used by tw-209 (Dodge) etc.
 */
export function setupCombatWithCaveDrake(opts: {
  heroChars: readonly CharacterEntry[];
  heroHand?: readonly CardDefinitionId[];
  creatureDefId: CardDefinitionId;
  hazardCharacter?: CardDefinitionId;
  /** Cards to seed into the hazard player's cardsInPlay (e.g. a permanent
   * hazard event whose effect modifies the creature attack). */
  hazardCardsInPlay?: readonly CardInPlay[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [...opts.heroChars] }],
        hand: [...(opts.heroHand ?? [])],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [opts.hazardCharacter ?? GIMLI] }],
        hand: [opts.creatureDefId],
        siteDeck: [RIVENDELL],
        ...(opts.hazardCardsInPlay ? { cardsInPlay: [...opts.hazardCardsInPlay] } : {}),
      },
    ],
  });

  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hollin', 'Enedhwaith'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...state, phaseState: mhState };

  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const wildernessKeying = { method: 'region-type' as const, value: 'wilderness' };
  const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, wildernessKeying);
  expect(s0.combat).not.toBeNull();
  return s0;
}

/**
 * Resolve a Cave-drake's two strikes against the named defender: the
 * defender passes the cancel window, then the attacker assigns both
 * strikes. Returns the state ready for strike resolution.
 */
export function assignBothStrikesTo(
  state: GameState,
  targetDefId: CardDefinitionId,
): GameState {
  const targetId = findCharInstanceId(state, RESOURCE_PLAYER, targetDefId);
  let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId, excess: true });
  expect(s.combat!.phase).toBe('resolve-strike');
  return s;
}

/**
 * Build a Ringwraith (minion) defending company at Moria facing a single
 * creature attack in the assign-strikes window, for testing
 * `convert-creature-to-ally` (Ready to His Will le-220). The named creature is
 * added to the hazard player's cards-in-play as the attack source. Returns the
 * state and the attacking creature's instance id.
 */
export function buildRingwraithCreatureCombat(opts: {
  creatureDefId: CardDefinitionId;
  creatureRace: Race;
  characters: readonly CardDefinitionId[];
  hand: readonly CardDefinitionId[];
  strikeProwess?: number;
}): { state: GameState; creatureInstanceId: CardInstanceId } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [...opts.characters] }],
        hand: [...opts.hand],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const state = makeCancelWindowCombat(base, {
    creatureDefId: opts.creatureDefId,
    creatureRace: opts.creatureRace,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 9,
  });
  const creatureInstanceId = (state.combat!.attackSource as { instanceId: CardInstanceId }).instanceId;
  return { state, creatureInstanceId };
}

/**
 * Build an M/H order-effects state where PLAYER_1's company (with the given
 * hero characters) is moving from Rivendell to a fresh copy of the given
 * destination site. Dispatching `pass` triggers the transition into
 * draw-cards, surfacing draw-count modifiers. Used by wizard draw-modifier
 * tests (Alatar, etc.).
 *
 * Pass `movementType` to set the declared movement type on the phase state
 * (defaults to null) — needed by draw-modifiers that gate on the movement
 * type, e.g. A Short Rest (td-95), which applies only to region/starter moves.
 */
export function buildMHOrderEffectsDrawState(opts: {
  heroChars: readonly CardDefinitionId[];
  destinationSite: CardDefinitionId;
  heroSiteDeck?: readonly CardDefinitionId[];
  pathTypes?: readonly RegionType[];
  pathNames?: readonly string[];
  movementType?: MovementType;
}): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [...opts.heroChars] }],
        hand: [],
        siteDeck: [...(opts.heroSiteDeck ?? [MORIA])],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        playDeck: makePlayDeck(),
      },
    ],
  });

  const destInstId = mint();
  const company = {
    ...state.players[0].companies[0],
    destinationSite: { instanceId: destInstId, definitionId: opts.destinationSite, status: CardStatus.Untapped },
  };
  const players: readonly [PlayerState, PlayerState] = [
    { ...state.players[0], companies: [company] },
    state.players[1],
  ];

  const mhState = makeMHState({
    step: 'order-effects' as MovementHazardPhaseState['step'],
    resolvedSitePath: opts.pathTypes ? [...opts.pathTypes] : [],
    resolvedSitePathNames: opts.pathNames ? [...opts.pathNames] : [],
    ...(opts.movementType !== undefined ? { movementType: opts.movementType } : {}),
  });
  return { ...state, players, phaseState: mhState } as GameState;
}

/**
 * Build a mid-strike M/H-phase combat state for rule 8.12: a synthetic
 * dragon creature attack against Aragorn is at `resolve-strike`, the hazard
 * player holds Dragon's Curse (td-16, the pool's only mid-strike hazard
 * play), and the M/H phase state carries an explicit hazard limit with
 * `hazardsAlreadyPlayed` hazards already counted against the company.
 */
export function makeMidStrikeHazardPlayState(opts: {
  hazardsAlreadyPlayed: number;
  hazardLimit?: number;
}): GameState {
  const DRAGONS_CURSE = 'td-16' as CardDefinitionId;
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRAGONS_CURSE], siteDeck: [RIVENDELL] },
    ],
  });
  const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-dragon' as CardInstanceId },
    companyId: companyIdAt(base, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 8,
    creatureBody: null,
    creatureRace: Race.Dragon,
    strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return {
    ...base,
    combat,
    phaseState: makeMHState({
      hazardLimitAtReveal: opts.hazardLimit ?? 2,
      hazardsPlayedThisCompany: opts.hazardsAlreadyPlayed,
    }),
  };
}

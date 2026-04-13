/**
 * @module format-state
 *
 * Game state rendering. Converts both the full omniscient GameState (for
 * server logs) and per-player PlayerView (for the console client) into
 * multi-line text output showing turn, phase, companies, piles, combat,
 * and marshalling points.
 */

import type { CardDefinition } from './types/cards.js';
import type { GameState, Company, CharacterInPlay, CombatState, ChainState, PhaseState, MarshallingPointTotals, PendingEffect } from './types/state.js';
import { Phase, SetupStep } from './types/state.js';
import { resolveInstanceId } from './types/state.js';
import type { PlayerView, OpponentCompanyView } from './types/player-view.js';
import { computeTournamentBreakdown } from './state-utils.js';
import type { CardInstanceId, CardDefinitionId } from './types/common.js';
import { GENERAL_INFLUENCE } from './constants.js';
import { stripCardMarkers } from './format-helpers.js';
import type { CardLookup, InstanceLookup } from './format-helpers.js';
import {
  formatInstanceName,
  formatGroupedInstances,
  formatCharacterLine,
  formatItemLine,
  formatAllyLine,
  formatCorruptionCardLine,
  formatSiteName,
  statusSymbol,
} from './format-cards.js';

// ---- Instance lookup builder ----

/**
 * Build an instance-to-definition lookup from a PlayerView's piles.
 * Replaces the old `visibleInstances` field — every known card in every pile
 * contributes its mapping. Hidden cards (UNKNOWN_CARD/UNKNOWN_SITE) are
 * included but harmless since no card pool entry will match them.
 */
export function buildInstanceLookup(view: PlayerView): InstanceLookup {
  // Build instance-to-definition map from all ViewCard piles in the view.
  const map: Record<string, CardDefinitionId> = {};
  const addCards = (cards: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[]) => {
    for (const c of cards) map[c.instanceId as string] = c.definitionId;
  };

  // Self piles
  const s = view.self;
  addCards(s.hand); addCards(s.playDeck); addCards(s.siteDeck);
  addCards(s.discardPile); addCards(s.siteDiscardPile); addCards(s.sideboard);
  addCards(s.killPile); addCards(s.outOfPlayPile); addCards(s.cardsInPlay);

  // Self characters, items, allies, company sites
  for (const ch of Object.values(s.characters)) {
    map[ch.instanceId as string] = ch.definitionId;
    for (const item of ch.items) map[item.instanceId as string] = item.definitionId;
    for (const ally of ch.allies) map[ally.instanceId as string] = ally.definitionId;
    for (const hazard of ch.hazards) map[hazard.instanceId as string] = hazard.definitionId;
  }
  for (const company of s.companies) {
    if (company.currentSite) map[company.currentSite.instanceId as string] = company.currentSite.definitionId;
    if (company.destinationSite) map[company.destinationSite.instanceId as string] = company.destinationSite.definitionId;
    addCards(company.onGuardCards);
  }

  // Opponent piles
  const o = view.opponent;
  addCards(o.hand); addCards(o.playDeck); addCards(o.siteDeck);
  addCards(o.discardPile); addCards(o.siteDiscardPile);
  addCards(o.killPile); addCards(o.outOfPlayPile); addCards(o.cardsInPlay);

  // Opponent characters, items, allies, company sites
  for (const ch of Object.values(o.characters)) {
    map[ch.instanceId as string] = ch.definitionId;
    for (const item of ch.items) map[item.instanceId as string] = item.definitionId;
    for (const ally of ch.allies) map[ally.instanceId as string] = ally.definitionId;
    for (const hazard of ch.hazards) map[hazard.instanceId as string] = hazard.definitionId;
  }
  for (const company of o.companies) {
    if (company.currentSite) map[company.currentSite.instanceId as string] = company.currentSite.definitionId;
    if (company.revealedDestinationSite) map[company.revealedDestinationSite.instanceId as string] = company.revealedDestinationSite.definitionId;
    addCards(company.onGuardCards);
  }

  // Chain of effects: cards declared on the chain are physically held by
  // the chain entries (not in any pile) until the chain fully resolves and
  // is cleared. Walk the active chain — and any nested parent chains — so
  // those cards are still findable while a resolution is pending.
  let chainCursor: ChainState | null = view.chain;
  while (chainCursor) {
    for (const entry of chainCursor.entries) {
      if (entry.card) {
        map[entry.card.instanceId as string] = entry.card.definitionId;
      }
    }
    chainCursor = chainCursor.parentChain;
  }

  // Setup phase cards (draft pools, drafted characters, items, deck draft)
  if (view.phaseState.phase === Phase.Setup) {
    const step = view.phaseState.setupStep;
    if (step.step === SetupStep.CharacterDraft) {
      for (const ds of step.draftState) {
        addCards(ds.pool);
        addCards(ds.drafted);
        if (ds.currentPick) addCards([ds.currentPick]);
      }
      addCards(step.setAside);
    } else if (step.step === SetupStep.ItemDraft) {
      for (const ids of step.itemDraftState) addCards(ids.unassignedItems);
      for (const pool of step.remainingPool) addCards(pool);
    } else if (step.step === SetupStep.CharacterDeckDraft) {
      for (const dds of step.deckDraftState) addCards(dds.remainingPool);
    } else if (step.step === SetupStep.StartingSiteSelection) {
      for (const ss of step.siteSelectionState) addCards(ss.selectedSites);
    }
  }

  return (id) => map[id as string];
}

// ---- Company formatting ----

/** Format a player's own company (full visibility) as indented text lines. */
function formatCompany(
  company: Company,
  index: number,
  characters: Readonly<Record<string, CharacterInPlay>>,
  defOf: CardLookup,
  instOf: InstanceLookup,
  indent: string,
  isActive = false,
): string[] {
  const lines: string[] = [];

  const activeMarker = isActive ? '▶ ' : '';
  const siteStatus = company.currentSite ? statusSymbol(company.currentSite.status) + ' ' : '';
  const siteName = company.currentSite ? formatSiteName(company.currentSite.instanceId, defOf, instOf) : ('(no site)');
  const noSiteTag = company.siteCardOwned === false ? ' (no site)' : '';
  if (company.destinationSite) {
    const destName = formatSiteName(company.destinationSite.instanceId, defOf, instOf);
    lines.push(`${indent}${activeMarker}Company ${index + 1} → ${destName} (from ${siteStatus}${siteName})${noSiteTag}:`);
  } else {
    lines.push(`${indent}${activeMarker}Company ${index + 1} @ ${siteStatus}${siteName}${noSiteTag}:`);
  }

  // On-guard cards
  if (company.onGuardCards.length > 0) {
    const ogNames = company.onGuardCards.map(c => formatInstanceName(c.instanceId, defOf, instOf));
    lines.push(`${indent}  Onguard: ${ogNames.join(', ')}`);
  }

  // Collect follower IDs so we skip them in the main loop (they appear under their controller)
  const followerIds = new Set<string>();
  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;
    for (const fId of char.followers) followerIds.add(fId as string);
  }

  for (const charId of company.characters) {
    if (followerIds.has(charId as string)) continue;
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);
    for (const item of char.items) {
      lines.push(`${indent}    ${formatItemLine(item, defOf, instOf)}`);
    }
    for (const ally of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(ally, defOf, instOf)}`);
    }
    for (const hazard of char.hazards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(hazard.instanceId, defOf, instOf)}`);
    }
    for (const followerId of char.followers) {
      const follower = characters[followerId as string];
      if (!follower) continue;
      lines.push(`${indent}    ${formatCharacterLine(follower, defOf, instOf)} [follower]`);
      for (const item of follower.items) {
        lines.push(`${indent}      ${formatItemLine(item, defOf, instOf)}`);
      }
    }
  }

  return lines;
}

/** Format an opponent's company (redacted destination) as indented text lines. */
function formatOpponentCompany(
  company: OpponentCompanyView,
  index: number,
  characters: Readonly<Record<string, CharacterInPlay>>,
  defOf: CardLookup,
  instOf: InstanceLookup,
  indent: string,
  isActive = false,
): string[] {
  const lines: string[] = [];

  const activeMarker = isActive ? '▶ ' : '';
  const siteStatus = company.currentSite ? statusSymbol(company.currentSite.status) + ' ' : '';
  const siteName = company.currentSite ? formatSiteName(company.currentSite.instanceId, defOf, instOf) : ('(no site)');
  const noSiteTag = company.siteCardOwned === false ? ' (no site)' : '';
  if (company.hasPlannedMovement) {
    lines.push(`${indent}${activeMarker}Company ${index + 1} → ${('(planned)')} (from ${siteStatus}${siteName})${noSiteTag}:`);
  } else {
    lines.push(`${indent}${activeMarker}Company ${index + 1} @ ${siteStatus}${siteName}${noSiteTag}:`);
  }

  // On-guard cards
  if (company.onGuardCards.length > 0) {
    const ogNames = company.onGuardCards.map(c => formatInstanceName(c.instanceId, defOf, instOf));
    lines.push(`${indent}  Onguard: ${ogNames.join(', ')}`);
  }

  // Collect follower IDs so we skip them in the main loop
  const followerIds = new Set<string>();
  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;
    for (const fId of char.followers) followerIds.add(fId as string);
  }

  for (const charId of company.characters) {
    if (followerIds.has(charId as string)) continue;
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);
    for (const item of char.items) {
      lines.push(`${indent}    ${formatItemLine(item, defOf, instOf)}`);
    }
    for (const ally of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(ally, defOf, instOf)}`);
    }
    for (const hazard of char.hazards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(hazard.instanceId, defOf, instOf)}`);
    }
    for (const followerId of char.followers) {
      const follower = characters[followerId as string];
      if (!follower) continue;
      lines.push(`${indent}    ${formatCharacterLine(follower, defOf, instOf)} [follower]`);
      for (const item of follower.items) {
        lines.push(`${indent}      ${formatItemLine(item, defOf, instOf)}`);
      }
    }
  }

  return lines;
}

// ---- Combat formatting ----

/** Format the current combat state as indented text lines. */
function formatCombat(combat: CombatState, defOf: CardLookup, instOf: InstanceLookup, indent: string): string[] {
  const lines: string[] = [];
  let attackerName: string;
  if (combat.attackSource.type === 'creature') {
    attackerName = formatInstanceName(combat.attackSource.instanceId, defOf, instOf);
  } else {
    attackerName = 'Automatic attack';
  }
  const bodyStr = combat.creatureBody !== null ? `/${combat.creatureBody} body` : '';
  lines.push(`${indent}COMBAT: ${attackerName} — ${combat.strikesTotal} strikes at ${combat.strikeProwess} prowess${bodyStr}`);
  lines.push(`${indent}  Phase: ${combat.phase}${combat.phase === 'assign-strikes' ? ` (${combat.assignmentPhase})` : ''}`);
  lines.push(`${indent}  Defending company: ${combat.companyId as string} (${combat.defendingPlayerId as string})  Attacker: ${combat.attackingPlayerId as string}`);
  if (combat.bodyCheckTarget) {
    lines.push(`${indent}  Body check target: ${combat.bodyCheckTarget}`);
  }
  if (combat.detainment) {
    lines.push(`${indent}  DETAINMENT`);
  }
  const assigned = combat.strikeAssignments.length;
  const unassigned = combat.strikesTotal - assigned;
  if (unassigned > 0) {
    lines.push(`${indent}  Strikes: ${assigned} assigned, ${unassigned} remaining`);
  }
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    const marker = i === combat.currentStrikeIndex ? '>' : ' ';
    const charName = formatInstanceName(sa.characterId, defOf, instOf);
    const excess = sa.excessStrikes > 0 ? ` (${sa.excessStrikes} excess, -${sa.excessStrikes} prowess)` : '';
    const result = sa.resolved ? ` → ${sa.result}` : '';
    lines.push(`${indent}  ${marker} strike ${i + 1} → ${charName}${excess}${result}`);
  }
  return lines;
}

// ---- Shared rendering core ----

/**
 * Input for the shared renderer. Both GameState and PlayerView
 * are adapted into this shape by the convenience wrappers.
 */
interface RenderPlayerInput {
  readonly name: string;
  readonly alignment: string;
  readonly wizard: string | null;
  readonly isActive: boolean;
  /** Card instance IDs in hand. Unknown cards use {@link UNKNOWN_INSTANCE}. */
  readonly handCards: readonly CardInstanceId[];
  /** Card instance IDs in the play deck. Unknown cards use {@link UNKNOWN_INSTANCE}. */
  readonly deckCards: readonly CardInstanceId[];
  /** Card instance IDs in the site deck. Unknown cards use {@link UNKNOWN_INSTANCE}. */
  readonly siteDeckCards: readonly CardInstanceId[];
  /** Card instance IDs in the discard pile (always public). */
  readonly discardCards: readonly CardInstanceId[];
  /** Card instance IDs in the kill pile (always public). */
  readonly killCards: readonly CardInstanceId[];
  /** Card instance IDs in the out-of-play pile (eliminated cards + stored items; always public). */
  readonly outOfPlayCards: readonly CardInstanceId[];
  /** Card instance IDs in the sideboard. Hidden piles are empty arrays. */
  readonly sideboardCards: readonly CardInstanceId[];
  /** Number of cards remaining in the draft pool during setup. */
  readonly poolSize?: number;
  readonly marshallingPoints: MarshallingPointTotals;
  /** How much of the player's 20-point GI pool is currently used. */
  readonly generalInfluenceUsed?: number;
  readonly companies: readonly Company[];
  readonly opponentCompanies?: readonly OpponentCompanyView[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
  /** General cards this player has in play (permanent resources, factions, etc.). */
  readonly cardsInPlay?: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[];
  /** Most recent dice roll for this player. */
  readonly lastDiceRoll?: { readonly die1: number; readonly die2: number } | null;
}

interface RenderInput {
  readonly turnNumber: number;
  readonly phaseState: PhaseState;
  readonly combat: CombatState | null;
  readonly chain: ChainState | null;
  readonly pendingEffects: readonly PendingEffect[];
  readonly players: readonly [RenderPlayerInput, RenderPlayerInput];
  readonly defOf: CardLookup;
  readonly instOf: InstanceLookup;
}

/**
 * The single rendering function. Formats everything it can resolve in color,
 * and everything it cannot resolve in dim grey.
 */
function renderState(input: RenderInput): string {
  const { defOf, instOf } = input;
  const lines: string[] = [];

  const SETUP_STEP_LABELS: Record<string, string> = {
    'character-draft': 'Character Draft',
    'item-draft': 'Select Minor Items',
    'character-deck-draft': 'Select Deck Characters',
    'starting-site-selection': 'Select Starting Sites',
    'character-placement': 'Place Characters',
    'deck-shuffle': 'Shuffle Deck',
    'initial-draw': 'Draw Initial Hand',
    'initiative-roll': 'Roll for Initiative',
  };
  const MH_STEP_LABELS: Record<string, string> = {
    'select-company': 'Select Company',
    'reveal-new-site': 'Reveal New Site',
    'declare-path': 'Declare Path',
    'order-effects': 'Order Effects',
    'play-hazards': 'Play Hazards',
  };
  const SITE_STEP_LABELS: Record<string, string> = {
    'select-company': 'Select Company',
    'enter-or-skip': 'Enter or Skip',
    'reveal-on-guard-attacks': 'Reveal On-Guard',
    'automatic-attacks': 'Automatic Attacks',
    'declare-agent-attack': 'Agent Attack',
    'resolve-attacks': 'Resolve Attacks',
    'play-resources': 'Play Resources',
    'play-minor-item': 'Play Minor Item',
  };
  const phaseLabel = input.phaseState.phase === 'setup'
    ? `Setup / ${SETUP_STEP_LABELS[input.phaseState.setupStep.step] ?? input.phaseState.setupStep.step}`
    : input.phaseState.phase === 'movement-hazard'
      ? `Movement/Hazard / ${MH_STEP_LABELS[input.phaseState.step] ?? input.phaseState.step}`
      : input.phaseState.phase === 'site'
        ? `Site / ${SITE_STEP_LABELS[input.phaseState.step] ?? input.phaseState.step}`
        : input.phaseState.phase;
  lines.push(`Turn ${input.turnNumber} — Phase: ${phaseLabel}`);

  // Determine the active company ID for M/H and Site phases
  let activeCompanyId: string | null = null;
  if ((input.phaseState.phase === 'movement-hazard' || input.phaseState.phase === 'site')
    && input.phaseState.step !== 'select-company') {
    const activePlayer = input.players.find(p => p.isActive);
    if (activePlayer) {
      // Companies may be in own view (companies) or opponent view (opponentCompanies)
      const allCompanies = activePlayer.companies.length > 0
        ? activePlayer.companies
        : activePlayer.opponentCompanies ?? [];
      if (allCompanies.length > input.phaseState.activeCompanyIndex) {
        activeCompanyId = allCompanies[input.phaseState.activeCompanyIndex].id as string;
      }
    }
  }

  // Chain of effects (shown first when active, with markers for web client styling)
  if (input.chain) {
    lines.push('«CHAIN-START»');
    lines.push(`Chain (${input.chain.mode}) — priority: ${input.chain.priority as string}`);
    for (let i = input.chain.entries.length - 1; i >= 0; i--) {
      const entry = input.chain.entries[i];
      const status = entry.negated ? ' [negated]' : entry.resolved ? ' [resolved]' : '';
      const cardName = entry.card
        ? formatInstanceName(entry.card.instanceId, defOf, instOf)
        : entry.payload.type;
      const target = entry.payload.type === 'short-event' && entry.payload.targetInstanceId
        ? ` → ${formatInstanceName(entry.payload.targetInstanceId, defOf, instOf)}`
        : entry.payload.type === 'influence-attempt'
          ? ` → ${formatInstanceName(entry.payload.influencingCharacterId, defOf, instOf)} influence`
          : '';
      lines.push(`  #${i} ${cardName}${target}${status}`);
    }
    lines.push('«CHAIN-END»');
  }

  // Combat (shown after chain when active, with markers for web client styling)
  if (input.combat) {
    lines.push('«COMBAT-START»');
    lines.push(...formatCombat(input.combat, defOf, instOf, '  '));
    lines.push('«COMBAT-END»');
  }

  // Pending effects (card effect sub-flows in progress)
  if (input.pendingEffects.length > 0) {
    lines.push('Pending effects:');
    for (const pe of input.pendingEffects) {
      if (pe.type === 'card-effect') {
        const cardName = formatInstanceName(pe.cardInstanceId, defOf, instOf);
        lines.push(`  · ${cardName}: ${pe.effect.type}`);
      }
    }
  }

  for (let pi = 0; pi < input.players.length; pi++) {
    if (pi > 0) lines.push('');
    const player = input.players[pi];
    const opponent = input.players[1 - pi];
    const wizardLabel = player.wizard ? ` (${player.wizard})` : '';
    const selfRaw = player.marshallingPoints;
    const oppRaw = opponent.marshallingPoints;
    const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);
    const oppAdj = computeTournamentBreakdown(oppRaw, selfRaw);
    const totalMP = selfAdj.character + selfAdj.item + selfAdj.faction + selfAdj.ally + selfAdj.kill + selfAdj.misc;
    if (player.isActive) lines.push('«ACTIVE-START»');
    const giLabel = player.generalInfluenceUsed !== undefined
      ? ` | Free GI: ${GENERAL_INFLUENCE - player.generalInfluenceUsed}`
      : '';
    // Embed MP breakdown as a «MP:JSON» marker for web client tooltip injection.
    // The marker is invisible in the text client (stripped by stripCardMarkers).
    const mpData = JSON.stringify({
      selfName: player.name, oppName: opponent.name,
      selfRaw, oppRaw, selfAdj, oppAdj,
    });
    const diceMarker = player.lastDiceRoll
      ? ` «DICE:${player.lastDiceRoll.die1},${player.lastDiceRoll.die2},${pi === 0 ? 'black' : 'red'}»`
      : '';
    const mpComponents = `C=${selfAdj.character} I=${selfAdj.item} F=${selfAdj.faction} A=${selfAdj.ally} K=${selfAdj.kill} M=${selfAdj.misc}`;
    lines.push(`${player.name} [${player.alignment}]${wizardLabel}: «MP:${mpData}»${totalMP} MP (${mpComponents})${giLabel}${diceMarker}`);
    const renderPile = (label: string, cards: readonly CardInstanceId[], showEmpty = false) => {
      if (cards.length === 0 && !showEmpty) return;
      if (cards.length === 0) {
        lines.push(`  ${label}: (empty)`);
        return;
      }
      lines.push(`  ${label} (${cards.length}): ${formatGroupedInstances(cards, defOf, instOf)}`);
    };
    renderPile('Hand', player.handCards, true);
    renderPile('Deck', player.deckCards, true);
    renderPile('Sites', player.siteDeckCards, true);
    renderPile('Discard', player.discardCards, true);
    renderPile('Kill pile', player.killCards);
    renderPile('Out of Play', player.outOfPlayCards);
    renderPile('Sideboard', player.sideboardCards);
    if (player.poolSize !== undefined) {
      lines.push(`  Pool: ${player.poolSize}`);
    }

    // Full companies (own view or omniscient server view)
    for (let i = 0; i < player.companies.length; i++) {
      const isActiveCompany = activeCompanyId !== null && (player.companies[i].id as string) === activeCompanyId;
      lines.push(...formatCompany(player.companies[i], i, player.characters, defOf, instOf, '  ', isActiveCompany));
    }

    // Opponent companies (redacted destination)
    if (player.opponentCompanies) {
      for (let i = 0; i < player.opponentCompanies.length; i++) {
        const isActiveOppCompany = activeCompanyId !== null && (player.opponentCompanies[i].id as string) === activeCompanyId;
        lines.push(...formatOpponentCompany(player.opponentCompanies[i], i, player.characters, defOf, instOf, '  ', isActiveOppCompany));
      }
    }

    // Cards in play (permanent resources, factions, etc.)
    if (player.cardsInPlay && player.cardsInPlay.length > 0) {
      lines.push('  Cards in play:');
      for (const card of player.cardsInPlay) {
        lines.push(`    · ${formatInstanceName(card.instanceId, defOf, instOf)}`);
      }
    }
    if (player.isActive) lines.push('«ACTIVE-END»');
  }

  return lines.join('\n');
}

// ---- Public API: convenience wrappers ----

/**
 * Formats the full omniscient GameState. Used by server logs and unit tests.
 */
export function formatGameState(state: GameState): string {
  const defOf: CardLookup = (id) => state.cardPool[id as string];
  const instOf: InstanceLookup = (id) => resolveInstanceId(state, id);

  return stripCardMarkers(renderState({
    turnNumber: state.turnNumber,
    phaseState: state.phaseState,
    combat: state.combat,
    chain: state.chain,
    pendingEffects: state.pendingEffects,
    players: state.players.map(p => ({
      name: p.name,
      alignment: p.alignment,
      wizard: p.wizard,
      isActive: state.activePlayer !== null && p.id === state.activePlayer,
      handCards: p.hand.map(c => c.instanceId),
      deckCards: p.playDeck.map(c => c.instanceId),
      siteDeckCards: p.siteDeck.map(c => c.instanceId),
      discardCards: p.discardPile.map(c => c.instanceId),
      killCards: p.killPile.map(c => c.instanceId),
      outOfPlayCards: p.outOfPlayPile.map(c => c.instanceId),
      sideboardCards: p.sideboard.map(c => c.instanceId),
      marshallingPoints: p.marshallingPoints,
      generalInfluenceUsed: p.generalInfluenceUsed,
      lastDiceRoll: p.lastDiceRoll,
      companies: p.companies,
      characters: p.characters,
      cardsInPlay: p.cardsInPlay,
    })) as unknown as [RenderPlayerInput, RenderPlayerInput],
    defOf,
    instOf,
  }));
}

/**
 * Formats a per-player PlayerView. Used by the console client.
 * Known cards are colored; unknown/hidden cards are dim grey.
 */
export function formatPlayerView(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const defOf: CardLookup = (id) => cardPool[id as string];
  const instOf: InstanceLookup = buildInstanceLookup(view);

  // Compute pool sizes during setup phases (for both players)
  let selfPoolSize: number | undefined;
  let opponentPoolSize: number | undefined;
  if (view.phaseState.phase === 'setup') {
    const step = view.phaseState.setupStep;
    if (step.step === 'character-draft') {
      const selfIdx = step.draftState[0].pool.length > 0
        && (step.draftState[0].pool[0].instanceId as string) !== 'unknown-instance' ? 0 : 1;
      selfPoolSize = step.draftState[selfIdx].pool.length;
      opponentPoolSize = step.draftState[1 - selfIdx].pool.length;
    } else if (step.step === 'item-draft') {
      const selfIdx = step.itemDraftState[0].unassignedItems.length > 0
        && instOf(step.itemDraftState[0].unassignedItems[0].instanceId) ? 0 : 1;
      selfPoolSize = step.itemDraftState[selfIdx].unassignedItems.length;
      opponentPoolSize = step.itemDraftState[1 - selfIdx].unassignedItems.length;
    } else if (step.step === 'character-deck-draft') {
      const selfIdx = step.deckDraftState[0].remainingPool.length > 0
        && (step.deckDraftState[0].remainingPool[0].instanceId as string) !== 'unknown-instance' ? 0 : 1;
      selfPoolSize = step.deckDraftState[selfIdx].remainingPool.length;
      opponentPoolSize = step.deckDraftState[1 - selfIdx].remainingPool.length;
    }
  }

  return renderState({
    turnNumber: view.turnNumber,
    phaseState: view.phaseState,
    combat: view.combat,
    chain: view.chain,
    pendingEffects: view.pendingEffects,
    players: [
      {
        name: view.self.name,
        alignment: view.self.alignment,
        wizard: view.self.wizard,
        isActive: view.activePlayer !== null && view.self.id === view.activePlayer,
        handCards: view.self.hand.map(c => c.instanceId),
        deckCards: view.self.playDeck.map(c => c.instanceId),
        siteDeckCards: view.self.siteDeck.map(c => c.instanceId),
        discardCards: view.self.discardPile.map(c => c.instanceId),
        killCards: view.self.killPile.map(c => c.instanceId),
        outOfPlayCards: view.self.outOfPlayPile.map(c => c.instanceId),
        sideboardCards: view.self.sideboard.map(c => c.instanceId),
        poolSize: selfPoolSize,
        marshallingPoints: view.self.marshallingPoints,
        generalInfluenceUsed: view.self.generalInfluenceUsed,
        companies: view.self.companies,
        characters: view.self.characters,
        cardsInPlay: view.self.cardsInPlay,
        lastDiceRoll: view.self.lastDiceRoll,
      },
      {
        name: view.opponent.name,
        alignment: view.opponent.alignment,
        wizard: view.opponent.wizard,
        isActive: view.activePlayer !== null && view.opponent.id === view.activePlayer,
        handCards: view.opponent.hand.map(c => c.instanceId),
        deckCards: view.opponent.playDeck.map(c => c.instanceId),
        siteDeckCards: view.opponent.siteDeck.map(c => c.instanceId),
        discardCards: view.opponent.discardPile.map(c => c.instanceId),
        killCards: view.opponent.killPile.map(c => c.instanceId),
        outOfPlayCards: view.opponent.outOfPlayPile.map(c => c.instanceId),
        sideboardCards: [],
        poolSize: opponentPoolSize,
        marshallingPoints: view.opponent.marshallingPoints,
        generalInfluenceUsed: view.opponent.generalInfluenceUsed,
        lastDiceRoll: view.opponent.lastDiceRoll,
        companies: [],
        opponentCompanies: view.opponent.companies,
        characters: view.opponent.characters,
        cardsInPlay: view.opponent.cardsInPlay,
      },
    ],
    defOf,
    instOf,
  });
}

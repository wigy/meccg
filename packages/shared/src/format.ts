/**
 * @module format
 *
 * Single text-based renderer for game state. Outputs plain text,
 * YAML-like indented text showing players, companies, characters, items,
 * combat, and events.
 *
 * There is ONE rendering function: {@link renderState}. It accepts a
 * {@link RenderInput} — a simple bag of data that both {@link GameState}
 * and {@link PlayerView} can provide.
 *
 * Convenience wrappers {@link formatGameState} and {@link formatPlayerView}
 * adapt the engine's data structures into {@link RenderInput}.
 */

import type { CardDefinition } from './types/cards.js';
import { isCharacterCard, isItemCard } from './types/cards.js';
import type { GameState, Company, CharacterInPlay, ItemInPlay, AllyInPlay, CombatState, ChainState, PhaseState, MarshallingPointTotals } from './types/state.js';
import { Phase, SetupStep } from './types/state.js';
import { resolveInstanceId } from './types/state.js';
import type { PlayerView, OpponentCompanyView } from './types/player-view.js';
import { computeTournamentBreakdown } from './state-utils.js';
import type { GameAction } from './types/actions.js';
import { CardStatus } from './types/common.js';
import type { CardInstanceId, CardDefinitionId, CompanyId } from './types/common.js';
// UNKNOWN_INSTANCE referenced in JSDoc only — no runtime import needed.
import { GENERAL_INFLUENCE } from './constants.js';

// ---- Formatting helpers ----

/** Format a number with an explicit sign: positive values get a leading '+'. */
export function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

// ---- Card type colors (single source of truth) ----

/**
 * CSS color styles for each card type. This is the canonical color mapping
 * used by all rendering paths (web client, text client, deck editor, etc.).
 */
export const CARD_TYPE_CSS: Readonly<Record<string, string>> = {
  'hero-character': 'color:#6090e0;font-weight:bold',
  'hero-resource-item': 'color:#d0a040',
  'hero-resource-faction': 'color:#50b0b0',
  'hero-resource-ally': 'color:#60c060',
  'hero-resource-event': 'color:#60c060',
  'hazard-creature': 'color:#e06060',
  'hazard-event': 'color:#e06060',
  'hazard-corruption': 'color:#e06060',
  'hero-site': 'color:#d0d0d0',
  'minion-character': 'color:#c070c0;font-weight:bold',
  'minion-resource-item': 'color:#a080a0',
  'minion-resource-faction': 'color:#a080a0',
  'minion-resource-ally': 'color:#a080a0',
  'minion-resource-event': 'color:#a080a0',
  'minion-site': 'color:#d0d0d0',
  'balrog-site': 'color:#e08030',
  'fallen-wizard-site': 'color:#d0d0d0',
  'region': 'color:#6090e0;opacity:0.6',
};

/** Wizard avatar characters use a darker blue than regular hero characters. */
const WIZARD_CSS = 'color:#3060b0;font-weight:bold';

/** Ringwraith avatar characters use a distinct brown-reddish color. */
const RINGWRAITH_CSS = 'color:#b05030;font-weight:bold';

/**
 * Get the CSS style string for a card definition, considering both card type
 * and race. Wizard and Ringwraith avatars get distinct colors from their
 * alignment's regular characters.
 */
export function getCardCss(def: { cardType: string; race?: string }): string | undefined {
  if (def.cardType === 'hero-character' && def.race === 'wizard') {
    return WIZARD_CSS;
  }
  if (def.cardType === 'minion-character' && def.race === 'ringwraith') {
    return RINGWRAITH_CSS;
  }
  return CARD_TYPE_CSS[def.cardType];
}

/** Strip STX card-ID markers (\x02id\x02name\x02), «MP:…», and «DICE:…» markers from formatted output. */
export function stripCardMarkers(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x02[^\x02]*\x02([^\x02]*)\x02/g, '$1').replace(/«MP:[^»]*»/g, '').replace(/«DICE:[^»]*»/g, '').replace(/«ACTIVE-(?:START|END)»\n?/g, '');
}

// ---- Resolve helpers ----

type CardLookup = (defId: CardDefinitionId) => CardDefinition | undefined;
type InstanceLookup = (instId: CardInstanceId) => CardDefinitionId | undefined;

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
  addCards(s.killPile); addCards(s.eliminatedPile); addCards(s.cardsInPlay);

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
  addCards(o.killPile); addCards(o.eliminatedPile); addCards(o.cardsInPlay);

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

  // Events in play
  for (const ev of view.eventsInPlay) {
    map[ev.instanceId as string] = ev.definitionId;
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

function resolve(instId: CardInstanceId, instOf: InstanceLookup, defOf: CardLookup): CardDefinition | undefined {
  const defId = instOf(instId);
  return defId ? defOf(defId) : undefined;
}

// ---- Card name formatting ----

/**
 * Formats a card name as plain text.
 * If the card definition is not found, returns "[unknown]".
 * Embeds the card definition ID as \x02id\x02name\x02 marker
 * so the web client can parse it into data attributes.
 */
export function formatCardName(
  def: CardDefinition | undefined,
): string {
  if (!def) return 'a card';
  return `\x02${def.id}\x02${def.name}\x02`;
}

/**
 * Resolves an instance ID through the lookup chain and formats
 * the card name in color, followed by the instance ID in braces
 * so the user can reference it in actions. E.g. "Aragorn II {i-3}".
 * Unknown instances render as dim grey.
 */
function formatInstanceName(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  const name = formatCardName(def);
  return name;
}

/**
 * Formats a list of card definition IDs as a comma-separated string,
 * grouping duplicates with a count prefix (e.g. "3 x a card").
 * Returns '(empty)' for empty lists.
 */
export function formatCardList(
  ids: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  if (ids.length === 0) return '(empty)';

  // Count occurrences of each rendered name
  const counts = new Map<string, { name: string; count: number }>();
  for (const id of ids) {
    const name = formatCardName(cardPool[id as string]);
    const existing = counts.get(name);
    if (existing) {
      existing.count++;
    } else {
      counts.set(name, { name, count: 1 });
    }
  }

  return [...counts.values()]
    .map(({ name, count }) => count > 1 ? `${count} x ${name}` : name)
    .join(', ');
}

/**
 * Formats a card definition ID (not instance) by looking it up
 * directly in the card pool, followed by the definition ID in braces.
 * Used for draft pools where the user needs the ID for draft-pick commands.
 */
export function formatDefName(
  defId: CardDefinitionId,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const def = cardPool[defId as string];
  const name = formatCardName(def);
  return name;
}

// ---- Card detail formatting ----

/**
 * Returns a small Unicode symbol indicating a card's current status.
 * ✅ = untapped (ready), ❌ = tapped (exhausted), ❤️‍🩹 = inverted (wounded/special).
 * Placed before card names in text displays for at-a-glance state.
 */
function statusSymbol(status: CardStatus): string {
  switch (status) {
    case CardStatus.Untapped: return '✅';
    case CardStatus.Tapped: return '❌';
    case CardStatus.Inverted: return '❤️‍🩹';
  }
}

function formatCharacterLine(char: CharacterInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(char.instanceId, instOf, defOf);
  if (!isCharacterCard(def)) {
    return ('a character');
  }
  const c = def;
  const s = char.effectiveStats;
  const skills = c.skills.join('/');
  const label = formatInstanceName(char.instanceId, defOf, instOf);
  const mindLabel = c.mind !== null ? `${c.mind} Mind, ` : '';
  const cpLabel = s.corruptionPoints > 0 ? `, ${s.corruptionPoints} CP` : '';
  return `${statusSymbol(char.status)} ${label} [${s.prowess}/${s.body}] ${skills} (${mindLabel}${s.directInfluence} DI, ${c.marshallingPoints} MP${cpLabel})`;
}

function formatItemLine(item: ItemInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(item.instanceId, instOf, defOf);
  if (!isItemCard(def)) {
    return ('an item');
  }
  const label = formatInstanceName(item.instanceId, defOf, instOf);
  const pMod = formatSignedNumber(def.prowessModifier);
  const bMod = formatSignedNumber(def.bodyModifier);
  return `${statusSymbol(item.status)} ${label} [${pMod}/${bMod}] ${def.subtype} (${def.marshallingPoints} MP, ${def.corruptionPoints} CP)`;
}

function formatAllyLine(ally: AllyInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(ally.instanceId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-ally') {
    return ('an ally');
  }
  const label = formatInstanceName(ally.instanceId, defOf, instOf);
  return `${statusSymbol(ally.status)} ${label} [${def.prowess}/${def.body}] (${def.marshallingPoints} MP)`;
}

function formatCorruptionCardLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def) return 'a hazard';
  const label = formatInstanceName(instId, defOf, instOf);
  if (def.cardType === 'hazard-corruption') {
    return `${label} (${def.corruptionPoints} CP)`;
  }
  return label;
}

function formatSiteName(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  return formatInstanceName(instId, defOf, instOf);
}

// ---- Company formatting ----

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
  /** Card instance IDs in the eliminated pile (always public). */
  readonly eliminatedCards: readonly CardInstanceId[];
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
    if (player.handCards.length > 0) {
      // Group duplicate cards: "3 x Cave-drake" instead of "Cave-drake, Cave-drake, Cave-drake"
      const counts = new Map<string, { name: string; count: number }>();
      for (const id of player.handCards) {
        const name = formatInstanceName(id, defOf, instOf);
        const existing = counts.get(name);
        if (existing) {
          existing.count++;
        } else {
          counts.set(name, { name, count: 1 });
        }
      }
      const grouped = [...counts.values()]
        .map(({ name, count }) => count > 1 ? `${count} x ${name}` : name)
        .join(', ');
      lines.push(`  Hand (${player.handCards.length}): ${grouped}`);
    } else {
      lines.push(`  Hand: (empty)`);
    }
    // Deck piles — each on its own line, with card list.
    // All piles use the same renderer so that the debug UI can always show
    // a "+" toggle to expand contents (hidden piles render as "a card").
    const renderPile = (label: string, cards: readonly CardInstanceId[]) => {
      if (cards.length === 0 && label !== 'Deck' && label !== 'Sites' && label !== 'Discard') return;
      lines.push(`  ${label}: ${cards.length}`);
      for (const id of cards) {
        lines.push(`    · ${formatInstanceName(id, defOf, instOf)}`);
      }
    };
    renderPile('Deck', player.deckCards);
    renderPile('Sites', player.siteDeckCards);
    renderPile('Discard', player.discardCards);
    renderPile('Kill pile', player.killCards);
    renderPile('Eliminated', player.eliminatedCards);
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
      eliminatedCards: p.eliminatedPile.map(c => c.instanceId),
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
        eliminatedCards: view.self.eliminatedPile.map(c => c.instanceId),
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
        eliminatedCards: view.opponent.eliminatedPile.map(c => c.instanceId),
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

// ---- Action description ----

/**
 * Build a mapping from CompanyId → human-readable company name (e.g. "Aragorn's company")
 * using the lead character's name. Pass the result to {@link describeAction}.
 */
/**
 * Determine the title character for a company.
 *
 * The title character is chosen by:
 * 1. An avatar (mind === null) is always the title character.
 * 2. Otherwise, highest mind, then MP, then prowess, then alphabetical name.
 */
export function getTitleCharacter(
  characters: readonly { toString(): string }[],
  charMap: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CharacterInPlay | undefined {
  // Avatar is always the title character if present
  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (def && isCharacterCard(def) && def.mind === null) {
      return char;
    }
  }

  let titleChar: CharacterInPlay | undefined;
  let bestMind = -Infinity;
  let bestMP = -Infinity;
  let bestProwess = -Infinity;
  let bestName = '';

  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !isCharacterCard(def)) continue;

    const mind = def.mind ?? 0;
    const mp = def.marshallingPoints;
    const prowess = char.effectiveStats.prowess;
    const name = def.name;

    if (
      mind > bestMind ||
      (mind === bestMind && mp > bestMP) ||
      (mind === bestMind && mp === bestMP && prowess > bestProwess) ||
      (mind === bestMind && mp === bestMP && prowess === bestProwess && name < bestName)
    ) {
      titleChar = char;
      bestMind = mind;
      bestMP = mp;
      bestProwess = prowess;
      bestName = name;
    }
  }
  return titleChar;
}

export function buildCompanyNames(
  companies: readonly Company[],
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const company of companies) {
    if (company.characters.length === 0) {
      names[company.id as string] = `empty company`;
      continue;
    }
    const titleChar = getTitleCharacter(company.characters, characters, cardPool);
    if (titleChar) {
      const def = cardPool[titleChar.definitionId as string];
      names[company.id as string] = def ? `${def.name}'s company` : `company`;
    } else {
      names[company.id as string] = `company`;
    }
  }
  return names;
}

/**
 * Returns a human-readable description of a game action, resolving card
 * definition IDs to colored names where possible.
 *
 * @param instanceLookup - Optional map from instance ID to definition ID,
 *   used to resolve instance IDs to colored card names. Without it, instance
 *   IDs are shown as raw `{id}`. Matches the shape of
 *   {@link PlayerView.visibleInstances}.
 */
export function describeAction(
  action: GameAction,
  cardPool: Readonly<Record<string, CardDefinition>>,
  instanceLookup?: Readonly<Record<string, CardDefinitionId>> | InstanceLookup,
  companyNames?: Readonly<Record<string, string>>,
): string {
  const defName = (id: CardDefinitionId) => {
    const def = cardPool[id as string];
    return def ? formatCardName(def) : `${id}`;
  };
  const instName = (id: CardInstanceId) => {
    if (instanceLookup) {
      const defId = typeof instanceLookup === 'function'
        ? instanceLookup(id)
        : instanceLookup[id as string];
      if (defId) return defName(defId);
    }
    return `{${id}}`;
  };
  const compName = (id: CompanyId) => companyNames?.[id as string] ?? `${id}`;

  switch (action.type) {
    case 'draft-pick':
      return `Draft ${instName(action.characterInstanceId)}`;
    case 'draft-stop':
      return 'Stop drafting and keep current selections';
    case 'assign-starting-item':
      return `Assign item ${defName(action.itemDefId)} to ${instName(action.characterInstanceId)}`;
    case 'add-character-to-deck':
      return `Add ${instName(action.characterInstanceId)} to play deck`;
    case 'shuffle-play-deck':
      return 'Shuffle play deck';
    case 'select-starting-site':
      return `Select ${instName(action.siteInstanceId)} as starting site`;
    case 'place-character': {
      const companyNum = action.companyId.endsWith('-0') ? 'first' : 'second';
      return `Move ${instName(action.characterInstanceId)} to ${companyNum} company`;
    }
    case 'roll-initiative':
      return 'Roll 2d6 for initiative';
    case 'untap':
      return 'Untap all cards';
    case 'play-character':
      return `Play character ${instName(action.characterInstanceId)} at site ${instName(action.atSite)}`;
    case 'split-company':
      return `Split ${instName(action.characterId)} from ${compName(action.sourceCompanyId)}`;
    case 'move-to-company':
      return `Move ${instName(action.characterInstanceId)} to ${compName(action.targetCompanyId)}`;
    case 'merge-companies':
      return `Merge ${compName(action.sourceCompanyId)} into ${compName(action.targetCompanyId)}`;
    case 'transfer-item':
      return `Transfer item ${instName(action.itemInstanceId)} from ${instName(action.fromCharacterId)} to ${instName(action.toCharacterId)}`;
    case 'move-to-influence':
      return action.controlledBy === 'general'
        ? `Move ${instName(action.characterInstanceId)} to general influence`
        : `Move ${instName(action.characterInstanceId)} under direct influence of ${instName(action.controlledBy)}`;
    case 'plan-movement':
      return `Move ${compName(action.companyId)} to ${instName(action.destinationSite)}`;
    case 'cancel-movement':
      return `Cancel movement for ${compName(action.companyId)}`;
    case 'play-permanent-event':
      return `Play permanent event ${instName(action.cardInstanceId)}`;
    case 'play-short-event':
      return `Play ${instName(action.cardInstanceId)} to cancel ${instName(action.targetInstanceId)}`;
    case 'play-hazard': {
      const base = `Play hazard ${instName(action.cardInstanceId)} against ${compName(action.targetCompanyId)}`;
      if (action.keyedBy) return `${base} (keyed by ${action.keyedBy.method}: ${action.keyedBy.value})`;
      return base;
    }
    case 'assign-strike': {
      const tapTag = action.tapped ? ' [tapped]' : '';
      return action.excess
        ? `Assign excess strike to ${instName(action.characterId)}${tapTag} (-1 prowess)`
        : `Assign strike to ${instName(action.characterId)}${tapTag}`;
    }
    case 'resolve-strike':
      return action.tapToFight ? 'Resolve strike (tap to fight)' : 'Resolve strike (stay untapped, -3 prowess)';
    case 'support-strike':
      return `Tap ${instName(action.supportingCharacterId)} to support ${instName(action.targetCharacterId)} (+1 prowess)`;
    case 'choose-strike-order': {
      const charLabel = action.characterId ? ` on ${instName(action.characterId)}` : '';
      const tapLabel = action.tapped ? ' [tapped]' : '';
      return `Resolve strike ${action.strikeIndex + 1}${charLabel}${tapLabel}`;
    }
    case 'body-check-roll':
      return 'Roll body check';
    case 'play-hero-resource':
      return action.attachToCharacterId
        ? `Play ${instName(action.cardInstanceId)} on ${instName(action.attachToCharacterId)}`
        : `Play resource ${instName(action.cardInstanceId)} at ${compName(action.companyId)}`;
    case 'influence-attempt':
      return `Influence faction ${instName(action.factionInstanceId)} with ${instName(action.influencingCharacterId)}`;
    case 'opponent-influence-attempt':
      return `Influence opponent's ${instName(action.targetInstanceId)} with ${instName(action.influencingCharacterId)}`;
    case 'opponent-influence-defend':
      return `Roll defense against influence attempt`;
    case 'play-minor-item':
      return `Play minor item ${instName(action.cardInstanceId)} on ${instName(action.attachToCharacterId)}`;
    case 'corruption-check': {
      const mod = action.corruptionModifier;
      const modStr = mod !== 0 ? `, modifier ${mod >= 0 ? '+' : ''}${mod}` : '';
      return `Corruption check for ${instName(action.characterId)} (CP ${action.corruptionPoints}${modStr})`;
    }
    case 'draw-cards':
      return `Draw ${action.count} card${action.count !== 1 ? 's' : ''}`;
    case 'discard-card':
      return `Discard ${instName(action.cardInstanceId)}`;
    case 'pass':
      return 'Pass (end your actions this phase)';
    case 'call-free-council':
      return 'Call the Free Council (trigger endgame)';
    case 'play-long-event':
      return `Play long-event ${instName(action.cardInstanceId)}`;
    case 'exchange-sideboard':
      return `Exchange ${instName(action.discardCardInstanceId)} (discard) ↔ ${instName(action.sideboardCardInstanceId)} (sideboard)`;
    case 'start-sideboard-to-deck':
      return 'Tap avatar: fetch 1 card from sideboard to play deck';
    case 'start-sideboard-to-discard':
      return 'Tap avatar: fetch up to 5 cards from sideboard to discard';
    case 'fetch-from-sideboard':
      return `Fetch ${instName(action.sideboardCardInstanceId)} from sideboard`;
    case 'start-hazard-sideboard-to-deck':
      return 'Fetch 1 hazard from sideboard to play deck';
    case 'start-hazard-sideboard-to-discard':
      return 'Fetch up to 5 hazards from sideboard to discard';
    case 'fetch-hazard-from-sideboard':
      return `Fetch ${instName(action.sideboardCardInstanceId)} from sideboard`;
    case 'not-playable':
      return `${instName(action.cardInstanceId)} cannot be played`;
    case 'select-company':
      return `Select ${compName(action.companyId)}`;
    case 'declare-path': {
      if (action.regionPath && action.regionPath.length > 2) {
        const middle = action.regionPath.slice(1, -1).map(id => {
          const def = cardPool[id as string];
          return def?.name ?? `${id}`;
        });
        return `Declare region movement via ${middle.join(' and ')}`;
      }
      return `Declare ${action.movementType} movement`;
    }
    case 'order-effects':
      return `Order ${action.effectOrder.length} ongoing effect(s)`;
    case 'enter-site':
      return `Enter site with ${compName(action.companyId)}`;
    case 'place-on-guard':
      return `Place on-guard card ${instName(action.cardInstanceId)}`;
    case 'reveal-on-guard':
      return `Reveal on-guard card ${instName(action.cardInstanceId)}`;
    case 'declare-agent-attack':
      return `Declare agent attack ${instName(action.agentInstanceId)}`;
    case 'pass-chain-priority':
      return `Pass chain priority`;
    case 'order-passives':
      return `Order ${action.order.length} passive condition(s)`;
    case 'deck-exhaust':
      return `Exhaust deck (reshuffle discard)`;
    case 'finished':
      return `Finished`;
    default: {
      const _exhaustive: never = action;
      return `Unknown action`;
    }
  }
}

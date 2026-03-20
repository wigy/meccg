/**
 * @module format
 *
 * Single text-based renderer for game state. Outputs ANSI-coloured,
 * YAML-like indented text showing players, companies, characters, items,
 * combat, and events.
 *
 * There is ONE rendering function: {@link renderState}. It accepts a
 * {@link RenderInput} — a simple bag of data that both {@link GameState}
 * and {@link PlayerView} can provide. Known cards are rendered in
 * type-specific colours; unknown/hidden cards are rendered in dim grey.
 *
 * Convenience wrappers {@link formatGameState} and {@link formatPlayerView}
 * adapt the engine's data structures into {@link RenderInput}.
 */

import type { CardDefinition } from './types/cards.js';
import { isCharacterCard } from './types/cards.js';
import type { GameState, Company, CharacterInPlay, ItemInPlay, AllyInPlay, EventInPlay, CombatState, PhaseState, MarshallingPointTotals } from './types/state.js';
import type { PlayerView, OpponentCompanyView } from './types/player-view.js';
import type { GameAction } from './types/actions.js';
import { CardStatus } from './types/common.js';
import type { CardInstanceId, CardDefinitionId } from './types/common.js';

// ---- ANSI colors ----

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const COLORS: Record<string, string> = {
  'hero-character': `${BOLD}\x1b[34m`,
  'hero-resource-item': '\x1b[33m',
  'hero-resource-faction': '\x1b[36m',
  'hero-resource-ally': '\x1b[32m',
  'hero-resource-event': '\x1b[32m',
  'hazard-creature': '\x1b[31m',
  'hazard-event': '\x1b[35m',
  'hazard-corruption': `${DIM}\x1b[35m`,
  'hero-site': '\x1b[37m',
  'minion-character': `${BOLD}\x1b[35m`,
  'minion-site': '\x1b[37m',
  'balrog-site': '\x1b[37m',
  'fallen-wizard-site': '\x1b[37m',
  'region': `${DIM}\x1b[34m`,
};

/** Color for debug information (IDs, raw JSON). */
const DEBUG_COLOR = `${DIM}\x1b[90m`;

/** Wraps text in the debug color (dim grey). For IDs and raw action JSON. */
export function colorDebug(text: string): string {
  return `${DEBUG_COLOR}${text}${RESET}`;
}

/** Strip STX card-ID markers (\x02id\x02) from formatted output. */
export function stripCardMarkers(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x02[^\x02]*\x02/g, '');
}

/**
 * Controls whether instance/definition IDs are shown in formatted output.
 * Set to true to show `{i-3}` and `{tw-120}` after card names.
 * Default is false (clean output for normal play).
 */
export let showDebugIds = false;

/** Enable or disable debug ID display in formatted output. */
export function setShowDebugIds(value: boolean): void {
  showDebugIds = value;
}

/** Color for unknown/hidden cards. */
const UNKNOWN_COLOR = `${DIM}\x1b[0;90m`;

function colorize(text: string, cardType: string): string {
  const color = COLORS[cardType] ?? '';
  return color ? `${color}${text}${RESET}` : text;
}

function colorizeUnknown(text: string): string {
  return `${UNKNOWN_COLOR}${text}${RESET}`;
}

// ---- Resolve helpers ----

type CardLookup = (defId: CardDefinitionId) => CardDefinition | undefined;
type InstanceLookup = (instId: CardInstanceId) => CardDefinitionId | undefined;

function resolve(instId: CardInstanceId, instOf: InstanceLookup, defOf: CardLookup): CardDefinition | undefined {
  const defId = instOf(instId);
  return defId ? defOf(defId) : undefined;
}

// ---- Card name formatting ----

/**
 * Formats a card name in the correct type-specific color.
 * If the card definition is not found, returns dim grey "[unknown]".
 * This is THE function for rendering any card name with color.
 */
export function formatCardName(
  def: CardDefinition | undefined,
): string {
  if (!def) return colorizeUnknown('a card');
  // Placeholder cards (unknown-card, unknown-site) render in unknown color
  if ((def.id as string).startsWith('unknown-')) return colorizeUnknown(`\x02${def.id}\x02${def.name}`);
  // Embed card definition ID as \x02id\x02 marker before the name.
  // Terminals ignore STX characters; the web client parses them into data attributes.
  return colorize(`\x02${def.id}\x02${def.name}`, def.cardType);
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
  return showDebugIds ? `${name} ${colorDebug(`{${instId}}`)}` : name;
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
  return showDebugIds ? `${name} ${colorDebug(`{${defId}}`)}` : name;
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
    return showDebugIds ? colorizeUnknown(`a character {${char.instanceId}}`) : colorizeUnknown('a character');
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
  if (!def || def.cardType !== 'hero-resource-item') {
    return showDebugIds ? colorizeUnknown(`an item {${item.instanceId}}`) : colorizeUnknown('an item');
  }
  const label = formatInstanceName(item.instanceId, defOf, instOf);
  const pMod = def.prowessModifier >= 0 ? `+${def.prowessModifier}` : `${def.prowessModifier}`;
  const bMod = def.bodyModifier >= 0 ? `+${def.bodyModifier}` : `${def.bodyModifier}`;
  return `${statusSymbol(item.status)} ${label} [${pMod}/${bMod}] ${def.subtype} (${def.marshallingPoints} MP, ${def.corruptionPoints} CP)`;
}

function formatAllyLine(ally: AllyInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(ally.instanceId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-ally') {
    return showDebugIds ? colorizeUnknown(`an ally {${ally.instanceId}}`) : colorizeUnknown('an ally');
  }
  const label = formatInstanceName(ally.instanceId, defOf, instOf);
  return `${statusSymbol(ally.status)} ${label} [${def.prowess}/${def.body}] (${def.marshallingPoints} MP)`;
}

function formatCorruptionCardLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hazard-corruption') {
    return showDebugIds ? colorizeUnknown(`a corruption {${instId}}`) : colorizeUnknown('a corruption');
  }
  const label = formatInstanceName(instId, defOf, instOf);
  return `${label} (${def.corruptionPoints} CP)`;
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
): string[] {
  const lines: string[] = [];

  const siteName = company.currentSite ? formatSiteName(company.currentSite, defOf, instOf) : colorizeUnknown('(no site)');
  if (company.destinationSite) {
    const destName = formatSiteName(company.destinationSite, defOf, instOf);
    lines.push(`${indent}Company ${index + 1} → ${destName} (from ${siteName}):`);
  } else {
    lines.push(`${indent}Company ${index + 1} @ ${siteName}:`);
  }

  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);
    for (const item of char.items) {
      lines.push(`${indent}    ${formatItemLine(item, defOf, instOf)}`);
    }
    for (const ally of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(ally, defOf, instOf)}`);
    }
    for (const ccId of char.corruptionCards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(ccId, defOf, instOf)}`);
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
): string[] {
  const lines: string[] = [];

  const siteName = company.currentSite ? formatSiteName(company.currentSite, defOf, instOf) : colorizeUnknown('(no site)');
  if (company.hasPlannedMovement) {
    lines.push(`${indent}Company ${index + 1} → ${colorizeUnknown('(planned)')} (from ${siteName}):`);
  } else {
    lines.push(`${indent}Company ${index + 1} @ ${siteName}:`);
  }

  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);
    for (const item of char.items) {
      lines.push(`${indent}    ${formatItemLine(item, defOf, instOf)}`);
    }
    for (const ally of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(ally, defOf, instOf)}`);
    }
    for (const ccId of char.corruptionCards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(ccId, defOf, instOf)}`);
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
  lines.push(`${indent}COMBAT: ${attackerName} — ${combat.strikesTotal} strikes at ${combat.strikeProwess} prowess (${combat.phase})`);
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    const marker = i === combat.currentStrikeIndex ? '>' : ' ';
    const result = sa.resolved ? ` → ${sa.result}` : '';
    lines.push(`${indent}  ${marker} strike ${i + 1} → ${sa.characterId}${result}`);
  }
  return lines;
}

// ---- Event formatting ----

function formatEvent(event: EventInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const name = formatInstanceName(event.instanceId, defOf, instOf);
  const attached = event.attachedTo ? ` → ${formatInstanceName(event.attachedTo, defOf, instOf)}` : '';
  return `${name} (owner: ${event.owner})${attached}`;
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
  /** Card instance IDs in hand (own view), or undefined for opponent. */
  readonly handCards?: readonly CardInstanceId[];
  readonly handCount: number;
  readonly deckCount: number;
  readonly siteDeckCount: number;
  readonly discardCount: number;
  readonly marshallingPoints: MarshallingPointTotals;
  readonly companies: readonly Company[];
  readonly opponentCompanies?: readonly OpponentCompanyView[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
}

interface RenderInput {
  readonly turnNumber: number;
  readonly phaseState: PhaseState;
  readonly players: readonly [RenderPlayerInput, RenderPlayerInput];
  readonly eventsInPlay: readonly EventInPlay[];
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
    'initiative-roll': 'Roll for Initiative',
  };
  const phaseLabel = input.phaseState.phase === 'setup'
    ? `Setup / ${SETUP_STEP_LABELS[input.phaseState.setupStep.step] ?? input.phaseState.setupStep.step}`
    : input.phaseState.phase;
  lines.push(`Turn ${input.turnNumber} — Phase: ${phaseLabel}`);

  for (const player of input.players) {
    const wizardLabel = player.wizard ? ` (${player.wizard})` : '';
    const mp = player.marshallingPoints;
    const totalMP = mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
    const activeMarker = player.isActive ? ` \x1b[31m◀\x1b[0m` : '';
    lines.push(`${player.name} [${player.alignment}]${wizardLabel}: ${totalMP} MP${activeMarker}`);
    if (player.handCards && player.handCards.length > 0) {
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
      lines.push(`  Hand: ${grouped}`);
    } else if (player.handCount > 0) {
      lines.push(`  Hand: ${player.handCount} x ${colorizeUnknown('a card')}`);
    } else {
      lines.push(`  Hand: (empty)`);
    }
    lines.push(`  Deck: ${player.deckCount} | Sites: ${player.siteDeckCount} | Discard: ${player.discardCount}`);

    // Full companies (own view or omniscient server view)
    for (let i = 0; i < player.companies.length; i++) {
      lines.push(...formatCompany(player.companies[i], i, player.characters, defOf, instOf, '  '));
    }

    // Opponent companies (redacted destination)
    if (player.opponentCompanies) {
      for (let i = 0; i < player.opponentCompanies.length; i++) {
        lines.push(...formatOpponentCompany(player.opponentCompanies[i], i, player.characters, defOf, instOf, '  '));
      }
    }
  }

  // Combat
  const ps = input.phaseState;
  if ('combat' in ps && ps.combat) {
    lines.push(...formatCombat(ps.combat, defOf, instOf, '  '));
  }

  // Events
  if (input.eventsInPlay.length > 0) {
    lines.push('Events in play:');
    for (const event of input.eventsInPlay) {
      lines.push(`  ${formatEvent(event, defOf, instOf)}`);
    }
  } else {
    lines.push('Events in play: (none)');
  }

  return lines.join('\n');
}

// ---- Public API: convenience wrappers ----

/**
 * Formats the full omniscient GameState. Used by server logs and unit tests.
 */
export function formatGameState(state: GameState): string {
  const defOf: CardLookup = (id) => state.cardPool[id as string];
  const instOf: InstanceLookup = (id) => {
    const inst = state.instanceMap[id as string];
    return inst?.definitionId;
  };

  return stripCardMarkers(renderState({
    turnNumber: state.turnNumber,
    phaseState: state.phaseState,
    players: state.players.map(p => ({
      name: p.name,
      alignment: p.alignment,
      wizard: p.wizard,
      isActive: state.activePlayer !== null && p.id === state.activePlayer,
      handCards: p.hand,
      handCount: p.hand.length,
      deckCount: p.playDeck.length,
      siteDeckCount: p.siteDeck.length,
      discardCount: p.discardPile.length,
      marshallingPoints: p.marshallingPoints,
      companies: p.companies,
      characters: p.characters,
    })) as unknown as [RenderPlayerInput, RenderPlayerInput],
    eventsInPlay: state.eventsInPlay,
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
  const instOf: InstanceLookup = (id) => {
    const defId = view.visibleInstances[id as string];
    return defId ?? undefined;
  };

  return renderState({
    turnNumber: view.turnNumber,
    phaseState: view.phaseState,
    players: [
      {
        name: view.self.name,
        alignment: view.self.alignment,
        wizard: view.self.wizard,
        isActive: view.activePlayer !== null && view.self.id === view.activePlayer,
        handCards: view.self.hand.map(c => c.instanceId),
        handCount: view.self.hand.length,
        deckCount: view.self.playDeckSize,
        siteDeckCount: view.self.siteDeck.length,
        discardCount: view.self.discardPile.length,
        marshallingPoints: view.self.marshallingPoints,
        companies: view.self.companies,
        characters: view.self.characters,
      },
      {
        name: view.opponent.name,
        alignment: view.opponent.alignment,
        wizard: view.opponent.wizard,
        isActive: view.activePlayer !== null && view.opponent.id === view.activePlayer,
        handCount: view.opponent.handSize,
        deckCount: view.opponent.playDeckSize,
        siteDeckCount: 0,
        discardCount: view.opponent.discardPile.length,
        marshallingPoints: view.opponent.marshallingPoints,
        companies: [],
        opponentCompanies: view.opponent.companies,
        characters: view.opponent.characters,
      },
    ],
    eventsInPlay: view.eventsInPlay,
    defOf,
    instOf,
  });
}

// ---- Action description ----

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
  instanceLookup?: Readonly<Record<string, CardDefinitionId>>,
): string {
  const defName = (id: CardDefinitionId) => {
    const def = cardPool[id as string];
    return def ? formatCardName(def) : `${id}`;
  };
  const instName = (id: CardInstanceId) => {
    if (instanceLookup) {
      const defId = instanceLookup[id as string];
      if (defId) return defName(defId);
    }
    return `{${id}}`;
  };

  switch (action.type) {
    case 'draft-pick':
      return `Draft ${defName(action.characterDefId)}`;
    case 'draft-stop':
      return 'Stop drafting and keep current selections';
    case 'assign-starting-item':
      return `Assign item ${defName(action.itemDefId)} to ${instName(action.characterInstanceId)}`;
    case 'add-character-to-deck':
      return `Add ${defName(action.characterDefId)} to play deck`;
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
    case 'play-character':
      return `Play character ${instName(action.characterInstanceId)} at site ${instName(action.atSite)}`;
    case 'split-company':
      return `Split characters from company ${action.sourceCompanyId}`;
    case 'merge-companies':
      return `Merge company ${action.sourceCompanyId} into ${action.targetCompanyId}`;
    case 'transfer-item':
      return `Transfer item ${instName(action.itemInstanceId)} from ${instName(action.fromCharacterId)} to ${instName(action.toCharacterId)}`;
    case 'plan-movement':
      return `Move company ${action.companyId} to site ${instName(action.destinationSite)}`;
    case 'cancel-movement':
      return `Cancel movement for company ${action.companyId}`;
    case 'play-hazard':
      return `Play hazard ${instName(action.cardInstanceId)} against company ${action.targetCompanyId}`;
    case 'assign-strike':
      return `Assign strike to ${instName(action.characterId)}`;
    case 'resolve-strike':
      return action.tapToFight ? 'Resolve strike (tap to fight)' : 'Resolve strike (stay untapped, -3 prowess)';
    case 'support-strike':
      return `Tap ${instName(action.supportingCharacterId)} to support ${instName(action.targetCharacterId)} (+1 prowess)`;
    case 'play-hero-resource':
      return `Play resource ${instName(action.cardInstanceId)} at company ${action.companyId}`;
    case 'influence-attempt':
      return `Influence faction ${instName(action.factionInstanceId)} with ${instName(action.influencingCharacterId)}`;
    case 'play-minor-item':
      return `Play minor item ${instName(action.cardInstanceId)} on ${instName(action.attachToCharacterId)}`;
    case 'corruption-check':
      return `Corruption check for ${instName(action.characterId)}`;
    case 'draw-cards':
      return `Draw ${action.count} card${action.count !== 1 ? 's' : ''}`;
    case 'discard-card':
      return `Discard ${instName(action.cardInstanceId)}`;
    case 'pass':
      return 'Pass (end your actions this phase)';
    case 'call-free-council':
      return 'Call the Free Council (trigger endgame)';
    case 'fetch-from-sideboard':
      return `Fetch ${instName(action.cardInstanceId)} from sideboard`;
    default: {
      const _exhaustive: never = action;
      return `Unknown action`;
    }
  }
}

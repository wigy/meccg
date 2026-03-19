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

import type { CardDefinition, HeroCharacterCard, HeroItemCard, HeroAllyCard } from './types/cards.js';
import type { GameState, PlayerState, Company, CharacterInPlay, EventInPlay, CombatState, PhaseState } from './types/state.js';
import type { PlayerView, OpponentCompanyView } from './types/player-view.js';
import { CharacterStatus } from './types/common.js';
import type { CardInstanceId, CardDefinitionId, PlayerId } from './types/common.js';

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
  'region': `${DIM}\x1b[34m`,
};

/** Color for unknown/hidden cards. */
const UNKNOWN_COLOR = `${DIM}\x1b[90m`;

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
  if (!def) return colorizeUnknown('[unknown]');
  return colorize(def.name, def.cardType);
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
  return `${name} ${DIM}{${instId}}${RESET}`;
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
  return `${name} ${DIM}{${defId}}${RESET}`;
}

// ---- Card detail formatting ----

function statusMarker(status: CharacterStatus): string {
  switch (status) {
    case CharacterStatus.Tapped: return ' (tapped)';
    case CharacterStatus.Wounded: return ' (wounded)';
    default: return '';
  }
}

function formatCharacterLine(char: CharacterInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(char.instanceId, instOf, defOf);
  if (!def || def.cardType !== 'hero-character') {
    return colorizeUnknown(`[unknown character] ${DIM}{${char.instanceId}}${RESET}`);
  }
  const c = def as HeroCharacterCard;
  const skills = c.skills.join('/');
  const label = formatInstanceName(char.instanceId, defOf, instOf);
  return `${label} [${c.prowess}/${c.body}] ${skills} (${c.marshallingPoints} MP)${statusMarker(char.status)}`;
}

function formatItemLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-item') {
    return colorizeUnknown(`[unknown item] ${DIM}{${instId}}${RESET}`);
  }
  const item = def as HeroItemCard;
  const label = formatInstanceName(instId, defOf, instOf);
  const pMod = item.prowessModifier >= 0 ? `+${item.prowessModifier}` : `${item.prowessModifier}`;
  const bMod = item.bodyModifier >= 0 ? `+${item.bodyModifier}` : `${item.bodyModifier}`;
  return `${label} [${pMod}/${bMod}] ${item.subtype} (${item.marshallingPoints} MP, ${item.corruptionPoints} CP)`;
}

function formatAllyLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-ally') {
    return colorizeUnknown(`[unknown ally] ${DIM}{${instId}}${RESET}`);
  }
  const ally = def as HeroAllyCard;
  const label = formatInstanceName(instId, defOf, instOf);
  return `${label} [${ally.prowess}/${ally.body}] (${ally.marshallingPoints} MP)`;
}

function formatCorruptionCardLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hazard-corruption') {
    return colorizeUnknown(`[unknown corruption] ${DIM}{${instId}}${RESET}`);
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

  const siteName = formatSiteName(company.currentSite, defOf, instOf);
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
    for (const itemId of char.items) {
      lines.push(`${indent}    ${formatItemLine(itemId, defOf, instOf)}`);
    }
    for (const allyId of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(allyId, defOf, instOf)}`);
    }
    for (const ccId of char.corruptionCards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(ccId, defOf, instOf)}`);
    }
    for (const followerId of char.followers) {
      const follower = characters[followerId as string];
      if (!follower) continue;
      lines.push(`${indent}    ${formatCharacterLine(follower, defOf, instOf)} [follower]`);
      for (const itemId of follower.items) {
        lines.push(`${indent}      ${formatItemLine(itemId, defOf, instOf)}`);
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

  const siteName = formatSiteName(company.currentSite, defOf, instOf);
  if (company.hasPlannedMovement) {
    lines.push(`${indent}Company ${index + 1} → ${colorizeUnknown('(planned)')} (from ${siteName}):`);
  } else {
    lines.push(`${indent}Company ${index + 1} @ ${siteName}:`);
  }

  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);
    for (const itemId of char.items) {
      lines.push(`${indent}    ${formatItemLine(itemId, defOf, instOf)}`);
    }
    for (const allyId of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(allyId, defOf, instOf)}`);
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
  readonly wizard: string | null;
  readonly isActive: boolean;
  readonly handCount: number;
  readonly deckCount: number;
  readonly discardCount: number;
  readonly companies: readonly Company[];
  readonly opponentCompanies?: readonly OpponentCompanyView[];
  readonly characters: Readonly<Record<string, CharacterInPlay>>;
}

interface RenderInput {
  readonly turnNumber: number;
  readonly phaseState: PhaseState;
  readonly activePlayerName: string;
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

  lines.push(`Turn ${input.turnNumber} — Phase: ${input.phaseState.phase} — Active: ${input.activePlayerName}`);

  for (const player of input.players) {
    const wizardLabel = player.wizard ? ` (${player.wizard})` : '';
    const activeMarker = player.isActive ? ' ←' : '';
    lines.push(`${player.name}${wizardLabel}:${activeMarker}`);
    lines.push(`  hand: ${player.handCount} cards`);
    lines.push(`  deck: ${player.deckCount} | discard: ${player.discardCount}`);

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

  const activePlayer = state.players.find(p => p.id === state.activePlayer);

  return renderState({
    turnNumber: state.turnNumber,
    phaseState: state.phaseState,
    activePlayerName: activePlayer?.name ?? '???',
    players: state.players.map(p => ({
      name: p.name,
      wizard: p.wizard,
      isActive: p.id === state.activePlayer,
      handCount: p.hand.length,
      deckCount: p.playDeck.length,
      discardCount: p.discardPile.length,
      companies: p.companies,
      characters: p.characters,
    })) as [RenderPlayerInput, RenderPlayerInput],
    eventsInPlay: state.eventsInPlay,
    defOf,
    instOf,
  });
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
    activePlayerName: view.self.id === view.activePlayer ? view.self.name : view.opponent.name,
    players: [
      {
        name: view.self.name,
        wizard: view.self.wizard,
        isActive: view.self.id === view.activePlayer,
        handCount: view.self.hand.length,
        deckCount: view.self.playDeckSize,
        discardCount: view.self.discardPile.length,
        companies: view.self.companies,
        characters: view.self.characters,
      },
      {
        name: view.opponent.name,
        wizard: view.opponent.wizard,
        isActive: view.opponent.id === view.activePlayer,
        handCount: view.opponent.handSize,
        deckCount: view.opponent.playDeckSize,
        discardCount: view.opponent.discardPile.length,
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

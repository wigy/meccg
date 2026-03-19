/**
 * @module format
 *
 * Text-based renderer for game state, designed for the console client and
 * server-side debug logging. Outputs human-readable, ANSI-coloured summaries
 * of the full {@link GameState} (server view) or redacted {@link PlayerView}
 * (per-player view).
 *
 * Colour coding follows a consistent scheme — hero characters are blue,
 * items yellow, allies/resources green, hazard creatures red, etc. — so a
 * player can quickly scan the terminal for relevant information.
 *
 * The two main entry points are {@link formatGameState} (omniscient, for
 * server logs) and {@link formatPlayerView} (information-limited, for the
 * console client).
 */

import type { CardDefinition, HeroCharacterCard, HeroItemCard, HeroAllyCard, CreatureCard, HeroSiteCard } from './types/cards.js';
import type { GameState, PlayerState, Company, CharacterInPlay, EventInPlay, CombatState } from './types/state.js';
import type { PlayerView } from './types/player-view.js';
import { CharacterStatus } from './types/common.js';
import type { CardInstanceId, CardDefinitionId } from './types/common.js';

// ---- ANSI colors ----

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** Map from card type to its ANSI escape prefix. */
const COLORS: Record<string, string> = {
  'hero-character': `${BOLD}\x1b[34m`,       // blue bold
  'hero-resource-item': '\x1b[33m',           // yellow
  'hero-resource-faction': '\x1b[36m',        // cyan
  'hero-resource-ally': '\x1b[32m',           // green
  'hero-resource-event': '\x1b[32m',          // green
  'hazard-creature': '\x1b[31m',              // red
  'hazard-event': '\x1b[35m',                 // magenta
  'hazard-corruption': `${DIM}\x1b[35m`,      // magenta dim
  'hero-site': '\x1b[37m',                      // white
  'region': `${DIM}\x1b[34m`,                 // blue dim
};

/** Wraps `text` in the ANSI colour escape for `cardType`, with a reset suffix. */
function colorize(text: string, cardType: string): string {
  const color = COLORS[cardType] ?? '';
  return color ? `${color}${text}${RESET}` : text;
}

// ---- Lookup helpers ----

/** Resolves a card definition ID to its full definition. */
type CardLookup = (id: CardDefinitionId) => CardDefinition | undefined;

/** Resolves a card instance ID to its underlying definition ID. */
type InstanceLookup = (id: CardInstanceId) => CardDefinitionId | undefined;

/**
 * Builds a pair of lookup closures from the game state's card pool and
 * instance map, so that formatting functions can resolve IDs without
 * threading the full state object everywhere.
 */
function makeLookups(state: GameState): { defOf: CardLookup; instOf: InstanceLookup } {
  return {
    defOf: (id) => state.cardPool[id as string],
    instOf: (id) => {
      const inst = state.instanceMap[id as string];
      return inst?.definitionId;
    },
  };
}

/**
 * Two-step resolution: instance ID → definition ID → full card definition.
 * Returns `undefined` if either lookup fails (e.g. stale ID).
 */
function resolve(instId: CardInstanceId, instOf: InstanceLookup, defOf: CardLookup): CardDefinition | undefined {
  const defId = instOf(instId);
  return defId ? defOf(defId) : undefined;
}

// ---- Card formatting ----

/** Returns a parenthesised status suffix like " (tapped)" or "" for untapped characters. */
function statusMarker(status: CharacterStatus): string {
  switch (status) {
    case CharacterStatus.Tapped: return ' (tapped)';
    case CharacterStatus.Wounded: return ' (wounded)';
    default: return '';
  }
}

/**
 * Formats a single character line: coloured name, prowess/body stats,
 * skill keywords, marshalling points, and current status.
 */
function formatCharacterLine(char: CharacterInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(char.instanceId, instOf, defOf);
  if (!def || def.cardType !== 'hero-character') {
    return colorize(`??? [${char.instanceId}]`, 'hero-character');
  }
  const c = def as HeroCharacterCard;
  const skills = c.skills.join('/');
  const name = colorize(c.name, 'hero-character');
  return `${name} [${c.prowess}/${c.body}] ${skills} (${c.marshallingPoints} MP)${statusMarker(char.status)}`;
}

/**
 * Formats an item line: name, prowess/body modifiers (with +/- sign),
 * item subtype, marshalling points, and corruption points.
 */
function formatItemLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-item') {
    return colorize(`??? [${instId}]`, 'hero-resource-item');
  }
  const item = def as HeroItemCard;
  const name = colorize(item.name, 'hero-resource-item');
  const pMod = item.prowessModifier >= 0 ? `+${item.prowessModifier}` : `${item.prowessModifier}`;
  const bMod = item.bodyModifier >= 0 ? `+${item.bodyModifier}` : `${item.bodyModifier}`;
  return `${name} [${pMod}/${bMod}] ${item.subtype} (${item.marshallingPoints} MP, ${item.corruptionPoints} CP)`;
}

/** Formats an ally line: name, prowess/body, and marshalling points. */
function formatAllyLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-ally') {
    return colorize(`??? [${instId}]`, 'hero-resource-ally');
  }
  const ally = def as HeroAllyCard;
  const name = colorize(ally.name, 'hero-resource-ally');
  return `${name} [${ally.prowess}/${ally.body}] (${ally.marshallingPoints} MP)`;
}

/** Formats a corruption card (hazard) attached to a character: name and CP value. */
function formatCorruptionCardLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hazard-corruption') {
    return colorize(`??? [${instId}]`, 'hazard-corruption');
  }
  const name = colorize(def.name, 'hazard-corruption');
  return `${name} (${def.corruptionPoints} CP)`;
}

/** Resolves a site instance ID to its coloured display name. */
function formatSiteName(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def || def.cardType !== 'hero-site') {
    return `??? [${instId}]`;
  }
  return colorize(def.name, 'hero-site');
}

// ---- Company formatting ----

/**
 * Renders a full company block: site location (or planned destination),
 * each character with their items, allies, corruption cards, and followers.
 * Returns an array of indented lines for composition into the overall output.
 */
function formatCompany(
  company: Company,
  index: number,
  characters: Readonly<Record<string, CharacterInPlay>>,
  defOf: CardLookup,
  instOf: InstanceLookup,
  indent: string,
): string[] {
  const lines: string[] = [];

  // Company header with site info
  const siteName = formatSiteName(company.currentSite, defOf, instOf);
  let header: string;
  if (company.destinationSite) {
    const destName = formatSiteName(company.destinationSite, defOf, instOf);
    header = `${indent}Company ${index + 1} → ${destName} (from ${siteName}):`;
  } else {
    header = `${indent}Company ${index + 1} @ ${siteName}:`;
  }
  lines.push(header);

  // Characters
  for (const charId of company.characters) {
    const char = characters[charId as string];
    if (!char) continue;

    lines.push(`${indent}  ${formatCharacterLine(char, defOf, instOf)}`);

    // Items
    for (const itemId of char.items) {
      lines.push(`${indent}    ${formatItemLine(itemId, defOf, instOf)}`);
    }

    // Allies
    for (const allyId of char.allies) {
      lines.push(`${indent}    ${formatAllyLine(allyId, defOf, instOf)}`);
    }

    // Corruption cards
    for (const ccId of char.corruptionCards) {
      lines.push(`${indent}    ${formatCorruptionCardLine(ccId, defOf, instOf)}`);
    }

    // Followers (recursive-ish, one level)
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

// ---- Combat formatting ----

/**
 * Renders the current combat encounter: attacker identity, total strikes,
 * prowess, combat phase, and per-strike assignment/result lines.
 * The active strike is marked with '>'.
 */
function formatCombat(combat: CombatState, defOf: CardLookup, instOf: InstanceLookup, indent: string): string[] {
  const lines: string[] = [];
  let attackerName: string;
  if (combat.attackSource.type === 'creature') {
    const def = resolve(combat.attackSource.instanceId, instOf, defOf);
    attackerName = def ? colorize(def.name, 'hazard-creature') : '???';
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

/**
 * Formats a long/short event currently in play: coloured name, owner,
 * and optional attachment target.
 */
function formatEvent(event: EventInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(event.instanceId, instOf, defOf);
  if (!def) return `??? [${event.instanceId}]`;
  const cardType = def.cardType;
  const name = colorize(def.name, cardType);
  const attached = event.attachedTo ? ` → ${event.attachedTo}` : '';
  return `${name} (owner: ${event.owner})${attached}`;
}

// ---- Player formatting ----

/**
 * Renders a complete player summary: name, wizard identity, hand/deck/discard
 * counts, all companies, and any active combat for the active player.
 * The active player is annotated with a '←' marker.
 */
function formatPlayer(
  player: PlayerState,
  playerIndex: number,
  state: GameState,
  defOf: CardLookup,
  instOf: InstanceLookup,
): string[] {
  const lines: string[] = [];
  const isActive = player.id === state.activePlayer;
  const activeMarker = isActive ? ' ←' : '';
  const wizardLabel = player.wizard ? ` (${player.wizard})` : '';
  lines.push(`${player.name}${wizardLabel}:${activeMarker}`);
  lines.push(`  hand: ${player.hand.length} cards`);
  lines.push(`  deck: ${player.playDeck.length} | discard: ${player.discardPile.length}`);

  for (let i = 0; i < player.companies.length; i++) {
    lines.push(...formatCompany(player.companies[i], i, player.characters, defOf, instOf, '  '));
  }

  // Phase-specific combat
  const ps = state.phaseState;
  if (isActive && ('combat' in ps) && ps.combat) {
    lines.push(...formatCombat(ps.combat, defOf, instOf, '  '));
  }

  return lines;
}

// ---- Main exports ----

/**
 * Formats the complete, omniscient {@link GameState} as a multi-line
 * ANSI-coloured string. Intended for server-side debug logging — it
 * reveals all hidden information (hands, deck contents, etc.).
 *
 * Output includes: turn/phase header, both players with their companies,
 * and all events currently in play.
 *
 * @param state - The full authoritative game state.
 * @returns A newline-joined, terminal-ready string.
 */
export function formatGameState(state: GameState): string {
  const { defOf, instOf } = makeLookups(state);
  const lines: string[] = [];

  const activePlayer = state.players.find(p => p.id === state.activePlayer);
  lines.push(`Turn ${state.turnNumber} — Phase: ${state.phaseState.phase} — Active: ${activePlayer?.name ?? '???'}`);

  for (let i = 0; i < state.players.length; i++) {
    lines.push(...formatPlayer(state.players[i], i, state, defOf, instOf));
  }

  // Events in play
  if (state.eventsInPlay.length > 0) {
    lines.push('Events in play:');
    for (const event of state.eventsInPlay) {
      lines.push(`  ${formatEvent(event, defOf, instOf)}`);
    }
  } else {
    lines.push('Events in play: (none)');
  }

  return lines.join('\n');
}

/**
 * Formats a redacted {@link PlayerView} as a multi-line string.
 * Used by the console client to display what a single player is allowed
 * to see — their own hand contents, deck sizes, and the opponent's
 * public information (hand count, not hand contents; planned movement
 * flag, not destination).
 *
 * @param view - The per-player projected view of the game.
 * @returns A newline-joined, terminal-ready string.
 */
export function formatPlayerView(view: PlayerView): string {
  const lines: string[] = [];

  lines.push(`Turn ${view.turnNumber} — Phase: ${view.phaseState.phase}`);

  // Self
  const self = view.self;
  const selfWizard = self.wizard ? ` (${self.wizard})` : '';
  lines.push(`${self.name}${selfWizard}:`);
  lines.push(`  hand: ${self.hand.length} cards`);
  lines.push(`  deck: ${self.playDeckSize} | discard: ${self.discardPile.length}`);

  for (let i = 0; i < self.companies.length; i++) {
    const company = self.companies[i];
    // For self view, we don't have full lookup — use inline info from characters record
    const siteName = `site:${company.currentSite}`;
    if (company.destinationSite) {
      lines.push(`  Company ${i + 1} → site:${company.destinationSite} (from ${siteName}):`);
    } else {
      lines.push(`  Company ${i + 1} @ ${siteName}:`);
    }
    for (const charId of company.characters) {
      const char = self.characters[charId as string];
      if (char) {
        lines.push(`    ${charId}${statusMarker(char.status)}`);
      }
    }
  }

  // Opponent
  const opp = view.opponent;
  const oppWizard = opp.wizard ? ` (${opp.wizard})` : '';
  lines.push(`${opp.name}${oppWizard}:`);
  lines.push(`  hand: ${opp.handSize} cards`);
  lines.push(`  deck: ${opp.playDeckSize} | discard: ${opp.discardPile.length}`);

  for (let i = 0; i < opp.companies.length; i++) {
    const company = opp.companies[i];
    const siteName = `site:${company.currentSite}`;
    if (company.hasPlannedMovement) {
      lines.push(`  Company ${i + 1} → (planned) (from ${siteName}):`);
    } else {
      lines.push(`  Company ${i + 1} @ ${siteName}:`);
    }
    for (const charId of company.characters) {
      lines.push(`    ${charId}`);
    }
  }

  return lines.join('\n');
}

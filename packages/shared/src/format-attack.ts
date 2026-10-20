/**
 * @module format-attack
 *
 * Human-readable text for the attack log ({@link CombatState.attackLog}) and
 * for strike-roll / body-check breakdowns ({@link RollBreakdown}). Shared by
 * the engine (which broadcasts a text notification for every chain-less
 * attack change), the browser client (attack panel, dice caption, game log)
 * and the text client, so every surface words these events identically.
 *
 * Card names are emitted with the STX card markers (`\x02id\x02name\x02`)
 * understood by the browser's card-hover rendering; text renderers strip
 * them with `stripCardMarkers`.
 */

import type { CardDefinition } from './types/cards.js';
import type { CardDefinitionId, PlayerId } from './types/common.js';
import type { AttackModifierEntry, CombatState } from './types/state-combat.js';
import type { DiceRollEffect, RollTerm } from './types/protocol.js';
import { formatCardName } from './format-cards.js';
import { formatSignedNumber } from './format-helpers.js';

/** Card pool lookup used to resolve definition IDs to names. */
type CardPool = Readonly<Record<string, CardDefinition>>;

/** A card pool, or a lookup function over one (as used by `format-state`). */
export type CardSource = CardPool | ((defId: CardDefinitionId) => CardDefinition | undefined);

/** Resolve a definition through either form of {@link CardSource}. */
function lookupDef(cards: CardSource, defId: CardDefinitionId): CardDefinition | undefined {
  return typeof cards === 'function' ? cards(defId) : cards[defId as string];
}

/** Card-marked name of a definition, or a fallback when unknown. */
function cardLabel(defId: CardDefinitionId | undefined, cards: CardSource, fallback: string): string {
  if (!defId) return fallback;
  const def = lookupDef(cards, defId);
  return def ? formatCardName(def) : (defId as string);
}

/**
 * Describe one attack-log entry, e.g.
 * `"Bob played Dark Quarrels: strikes 2 → 1 (halved)"` or
 * `"Attack: 2 strikes, 11 prowess, 8 body"` for the base entry.
 *
 * @param playerName - Resolves the entry's `playedBy` to a display name.
 */
export function describeAttackLogEntry(
  entry: AttackModifierEntry,
  cardPool: CardSource,
  playerName: (id: PlayerId) => string | undefined = () => undefined,
): string {
  if (entry.kind === 'base') {
    const parts = [
      `${entry.strikes ?? '?'} strike${entry.strikes === 1 ? '' : 's'}`,
      `${entry.prowess ?? '?'} prowess`,
      ...(entry.body !== null && entry.body !== undefined ? [`${entry.body} body`] : []),
    ];
    return `Attack: ${parts.join(', ')}`;
  }
  const card = cardLabel(entry.sourceDefinitionId, cardPool, 'a card');
  const who = entry.playedBy ? playerName(entry.playedBy) : undefined;
  const actor = who ? `${who} played ${card}` : card;
  const note = entry.note ? ` (${entry.note})` : '';
  if (entry.kind === 'cancel') return `${actor}: attack canceled${note}`;
  if (entry.kind === 'other') return `${actor}${note}`;
  return `${actor}: ${entry.kind} ${entry.before ?? '?'} → ${entry.after ?? '?'}${note}`;
}

/**
 * Current headline statistics of an attack as a short string,
 * e.g. `"2 strikes · 11 prowess · 8 body"`.
 */
export function describeAttackTotals(combat: CombatState): string {
  return [
    `${combat.strikesTotal} strike${combat.strikesTotal === 1 ? '' : 's'}`,
    `${combat.strikeProwess} prowess`,
    ...(combat.creatureBody !== null ? [`${combat.creatureBody} body`] : []),
  ].join(' · ');
}

/** Format one roll term, e.g. `"base 7"` for the first term or `"+1 Horn"` after it. */
function formatTerm(term: RollTerm, first: boolean, cardPool?: CardPool): string {
  const label = term.sourceDefinitionId && cardPool?.[term.sourceDefinitionId as string]
    ? formatCardName(cardPool[term.sourceDefinitionId as string])
    : term.label;
  return first ? `${label} ${term.value}` : `${formatSignedNumber(term.value)} ${label}`;
}

/** Format a term list as `"base 7, +1 Horn, -1 tapped"`. */
export function formatRollTerms(terms: readonly RollTerm[], cardPool?: CardPool): string {
  return terms.map((t, i) => formatTerm(t, i === 0, cardPool)).join(', ');
}

/** Sum of a term list. */
function sum(terms: readonly RollTerm[]): number {
  return terms.reduce((acc, t) => acc + t.value, 0);
}

/** Outcome wording for a breakdown caption. */
function outcomeText(outcome: NonNullable<DiceRollEffect['breakdown']>['outcome'], isBodyCheck: boolean): string | undefined {
  switch (outcome) {
    case 'success': return 'strike defeated';
    case 'tie': return 'tie, strike ineffectual';
    case 'wounded': return isBodyCheck ? 'survives' : 'strike succeeds';
    case 'eliminated': return isBodyCheck ? 'body check failed' : 'eliminated';
    case 'failed': return 'body check passed';
    default: return undefined;
  }
}

/**
 * One-line caption explaining a strike roll or body check from its
 * breakdown, or `null` when the effect carries none. Examples:
 *
 * - `"Beorn: 7 + prowess 8 (base 7, +1 Horn) = 15 vs 10 (prowess 11, -1 vs hobbit) — strike defeated"`
 * - `"Body check: creature: 9 (+1 bearer) = 10 vs body 8 — body check failed"`
 */
export function describeRollBreakdown(effect: DiceRollEffect, cardPool?: CardPool): string | null {
  const bd = effect.breakdown;
  if (!bd) return null;
  const dice = effect.die1 + effect.die2;
  const isBodyCheck = effect.label.startsWith('Body check');
  const charSum = sum(bd.character);
  const oppSum = sum(bd.opponent);
  const total = effect.total ?? dice + charSum;
  const outcome = outcomeText(bd.outcome, isBodyCheck);
  const tail = outcome ? ` — ${outcome}` : '';
  const oppDetail = bd.opponent.length > 1 ? ` (${formatRollTerms(bd.opponent, cardPool)})` : '';
  if (isBodyCheck) {
    const mods = bd.character.length > 0
      ? ` (${bd.character.map(t => formatTerm(t, false, cardPool)).join(', ')})`
      : '';
    return `${effect.label}: ${dice}${mods} = ${total} vs body ${oppSum}${oppDetail}${tail}`;
  }
  const need = bd.need !== undefined ? `, need ${bd.need}+` : '';
  return `${effect.label}: ${dice} + prowess ${charSum} (${formatRollTerms(bd.character, cardPool)}) = ${total} vs ${oppSum}${oppDetail}${need}${tail}`;
}

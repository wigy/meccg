/**
 * @module attack-log
 *
 * Maintains {@link CombatState.attackLog} — the public, purely informational
 * record of an attack's starting statistics and every change cards made to
 * it (cancellation, strikes/prowess/body modification). The engine never
 * reads the log for rules decisions; it exists so clients can show both
 * players which card did what to the attack.
 *
 * Change points call {@link recordAttackChanges} with the combat before and
 * after their modification; the diff produces one entry per changed
 * statistic. The `'base'` snapshot is seeded lazily from the pre-change
 * combat on the first append, and by {@link seedAttackLog} (run from the
 * top-level reducer) for attacks that are never modified.
 */

import type {
  AttackModifierEntry,
  CardDefinitionId,
  CardInstanceId,
  CombatState,
  GameState,
  PlayerId,
} from '../index.js';

/** Who/what caused an attack change. */
export interface AttackChangeSource {
  /** Instance of the card that caused the change. */
  readonly sourceInstanceId?: CardInstanceId;
  /** Definition of the card that caused the change. */
  readonly sourceDefinitionId?: CardDefinitionId;
  /** The player who played or activated the card. */
  readonly playedBy?: PlayerId;
  /** Optional qualifier, e.g. `"halved"`. */
  readonly note?: string;
}

/** Build the `'base'` snapshot entry from a combat's current statistics. */
export function baseAttackEntry(combat: CombatState): AttackModifierEntry {
  return {
    kind: 'base',
    strikes: combat.strikesTotal,
    prowess: combat.strikeProwess,
    body: combat.creatureBody,
  };
}

/**
 * Return `combat` with a `'base'` entry as the first log record, if it has
 * no log yet. Idempotent.
 */
export function seedAttackLog(combat: CombatState): CombatState {
  if (combat.attackLog && combat.attackLog.length > 0) return combat;
  return { ...combat, attackLog: [baseAttackEntry(combat)] };
}

/**
 * Append entries to the log of `after`, seeding the `'base'` snapshot from
 * `before` (the combat as it was prior to the change) when the log is empty.
 */
export function appendAttackLog(
  before: CombatState,
  after: CombatState,
  entries: readonly AttackModifierEntry[],
): CombatState {
  if (entries.length === 0) return after;
  const existing = after.attackLog && after.attackLog.length > 0
    ? after.attackLog
    : [baseAttackEntry(before)];
  return { ...after, attackLog: [...existing, ...entries] };
}

/**
 * Diff `before` against `after` and append one entry per changed attack
 * statistic (strikes, prowess, body), attributed to `source`. Returns
 * `after` unchanged when no statistic changed.
 */
export function recordAttackChanges(
  before: CombatState,
  after: CombatState,
  source: AttackChangeSource,
): CombatState {
  const entries: AttackModifierEntry[] = [];
  const push = (kind: 'strikes' | 'prowess' | 'body', b: number, a: number): void => {
    entries.push({ kind, ...source, before: b, after: a });
  };
  if (before.strikesTotal !== after.strikesTotal) push('strikes', before.strikesTotal, after.strikesTotal);
  if (before.strikeProwess !== after.strikeProwess) push('prowess', before.strikeProwess, after.strikeProwess);
  if (before.creatureBody !== null && after.creatureBody !== null && before.creatureBody !== after.creatureBody) {
    push('body', before.creatureBody, after.creatureBody);
  }
  return appendAttackLog(before, after, entries);
}

/**
 * Convenience wrapper over {@link recordAttackChanges} for reducers that
 * hold a whole {@link GameState}: records the changes between
 * `before.combat` and `after.combat` (no-op if either has no combat).
 */
export function recordAttackChangesInState(
  before: GameState,
  after: GameState,
  source: AttackChangeSource,
): GameState {
  if (!before.combat || !after.combat) return after;
  const combat = recordAttackChanges(before.combat, after.combat, source);
  return combat === after.combat ? after : { ...after, combat };
}

/** Append a `'cancel'` entry (one attack of a multi-attack, or a redirected cancel). */
export function recordAttackCancel(
  before: CombatState,
  after: CombatState,
  source: AttackChangeSource,
): CombatState {
  return appendAttackLog(before, after, [{ kind: 'cancel', ...source }]);
}

/**
 * Entries present in `next.attackLog` but not in `prev.attackLog`, when both
 * describe the same attack (the new log extends the old one). Used by the
 * top-level reducer to announce chain-less attack changes.
 */
export function newAttackLogEntries(
  prev: CombatState | null,
  next: CombatState | null,
): readonly AttackModifierEntry[] {
  const nextLog = next?.attackLog ?? [];
  const prevLog = prev?.attackLog ?? [];
  const sameAttack = prev !== null && next !== null && prevLog.length > 0 && nextLog[0] === prevLog[0];
  const fresh = sameAttack ? nextLog.slice(prevLog.length) : nextLog;
  return fresh.filter(e => e.kind !== 'base');
}

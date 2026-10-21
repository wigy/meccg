/**
 * @module attack-panel-lines
 *
 * Pure text for the combat arena's "Attack" panel (see
 * {@link module:attack-panel}): one line per `combat.attackLog` entry plus
 * the attack's current totals. Kept free of DOM imports so it can be unit
 * tested in the node test environment.
 */

import type { CardDefinition, CombatState, PlayerId } from '@meccg/shared';
import { describeAttackLogEntry, describeAttackTotals } from '@meccg/shared';

/** Text content of the attack panel. Card names carry STX card markers. */
export interface AttackPanelLines {
  /** One line per log entry, starting with the base snapshot. */
  readonly entries: readonly string[];
  /** Current headline statistics, e.g. "1 strike · 10 prowess · 8 body". */
  readonly totals: string;
}

/**
 * Build the attack panel's lines from the combat state. Combats without a
 * log (old saves) show just the current totals.
 */
export function attackPanelLines(
  combat: CombatState,
  cardPool: Readonly<Record<string, CardDefinition>>,
  nameOf: (id: PlayerId) => string | undefined,
): AttackPanelLines {
  const entries = (combat.attackLog ?? []).map(e => describeAttackLogEntry(e, cardPool, nameOf));
  return { entries, totals: describeAttackTotals(combat) };
}

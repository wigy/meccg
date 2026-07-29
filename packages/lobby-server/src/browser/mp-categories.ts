/**
 * @module mp-categories
 *
 * The marshalling-point category table and the MP breakdown tooltip.
 *
 * Four different renderers display MP by category — the player-name badge,
 * the inline `{{mp:…}}` marker in log text, the game-over summary and the
 * scoreboard detail page — and each had its own copy of the six-entry
 * category list. Worse, two of them had a verbatim copy of the same
 * tooltip-table builder. Both now live here.
 *
 * The category *order* comes from `MP_SOURCES` in `@meccg/shared`, which is
 * the order the tournament rules list the sources in; only the display
 * labels are a client concern.
 */

import type { MarshallingPointTotals } from '@meccg/shared';
import { MP_SOURCES, computeTournamentScore } from '@meccg/shared';

/** One MP source paired with the label to show for it. */
export interface MpCategory {
  readonly key: keyof MarshallingPointTotals;
  readonly label: string;
}

/**
 * Display labels per source. `short` fits the narrow tooltip column;
 * `long` is used where there is room for the full word.
 */
const MP_LABELS: Readonly<Record<keyof MarshallingPointTotals, { short: string; long: string }>> = {
  character: { short: 'Chars', long: 'Characters' },
  item: { short: 'Items', long: 'Items' },
  faction: { short: 'Factions', long: 'Factions' },
  ally: { short: 'Allies', long: 'Allies' },
  kill: { short: 'Kill', long: 'Kill' },
  misc: { short: 'Misc', long: 'Misc' },
};

/** The six MP categories in rules order, labelled for the given width. */
export function mpCategories(variant: 'short' | 'long'): readonly MpCategory[] {
  return MP_SOURCES.map(key => ({ key, label: MP_LABELS[key][variant] }));
}

/** One tooltip row: label, then this player's value and the opponent's. */
function mpRow(label: string, self: string, opponent: string): string {
  return `<tr><td class="mp-label">${label}</td><td class="mp-value">${self}</td><td class="mp-value">${opponent}</td></tr>`;
}

/** `12 (8)` when tournament adjustment changed the raw value, else `8`. */
function mpCell(raw: MarshallingPointTotals, adjusted: MarshallingPointTotals, key: keyof MarshallingPointTotals): string {
  return adjusted[key] !== raw[key] ? `${adjusted[key]} (${raw[key]})` : `${raw[key]}`;
}

/**
 * Builds the side-by-side MP breakdown tooltip: one row per category showing
 * each player's adjusted value (with the raw value in parentheses where the
 * tournament rules changed it), and the tournament totals in the footer.
 */
export function buildMPTooltip(
  selfName: string,
  selfRaw: MarshallingPointTotals,
  selfAdj: MarshallingPointTotals,
  oppName: string,
  oppRaw: MarshallingPointTotals,
  oppAdj: MarshallingPointTotals,
): string {
  const rows = mpCategories('short')
    .map(({ key, label }) => mpRow(label, mpCell(selfRaw, selfAdj, key), mpCell(oppRaw, oppAdj, key)))
    .join('');
  const selfTotal = computeTournamentScore(selfRaw, oppRaw);
  const oppTotal = computeTournamentScore(oppRaw, selfRaw);
  return `<table class="mp-tooltip-table">
    <thead><tr><th></th><th>${selfName}</th><th>${oppName}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${selfTotal}</td><td class="mp-value mp-total">${oppTotal}</td></tr></tfoot>
  </table>`;
}

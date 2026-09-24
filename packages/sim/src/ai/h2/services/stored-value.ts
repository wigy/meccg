/**
 * @module ai/h2/services/stored-value
 *
 * What a card is worth once stored, over what it prints.
 *
 * Twenty-odd resources score mostly — or only — by being stored: Earth of
 * Galadriel's Orchard prints no points and is worth 2 stored at Bag End; the
 * Palantíri print 3 and are worth 5 stored at a haven; Rescue Prisoners, Red
 * Book of Westmarch and the information cards print nothing and score at a
 * haven. `health` already prices the `store-item` action itself, but every
 * price of *acquiring* the card read the printed number alone, so a card whose
 * printed number is zero was never worth a tap to play or a site to enter. In
 * recorded game mubd54lk-rrl8p4 the human entered Lórien to play Earth of
 * Galadriel's Orchard; the modular AI scored that entry at exactly nothing and
 * passed.
 *
 * The difference is returned as *potential*, in TSD at the current standing:
 * the points are unlocked by the play but banked only by a later store, so
 * consumers pass it through `netTsdDelta`'s potential channel, where
 * `potentialDiscount` applies.
 */

import type { CardDefinition } from '@meccg/shared';
import type { MpSource } from '../core/tsd.js';
import type { Standing } from './standing.js';

/** The extra a card is worth stored, and the points behind it. */
export interface StoredValue {
  /** Undiscounted TSD of the stored points over the printed ones; 0 when none. */
  readonly potentialTsd: number;
  /** Marshalling points the card is worth once stored. */
  readonly storedMp: number;
}

/**
 * What storing `def` would add over its printed points, at this standing.
 *
 * Zero for a card with no `storable-at` override worth more than it prints —
 * including the gold rings, which store at their printed value.
 */
export function storedValue(def: CardDefinition | undefined, standing: Standing): StoredValue {
  const fields = def as unknown as {
    marshallingPoints?: number;
    marshallingCategory?: string;
    effects?: readonly { type?: string; marshallingPoints?: number }[];
  } | undefined;
  const printed = fields?.marshallingPoints ?? 0;
  const stored = fields?.effects?.find(e => e.type === 'storable-at')?.marshallingPoints;
  if (stored === undefined || stored <= printed) return { potentialTsd: 0, storedMp: printed };
  const source = (fields?.marshallingCategory ?? 'misc') as MpSource;
  const potentialTsd = standing.tsdAfter({ [source]: stored }) - standing.tsdAfter({ [source]: printed });
  return { potentialTsd: Math.max(0, potentialTsd), storedMp: stored };
}

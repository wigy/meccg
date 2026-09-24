/**
 * @module ai/h2/modules/hazards/corruption-hazard
 *
 * What a corruption hazard on one of their characters is worth: the Lures,
 * Despair of the Heart, Alone and Unadvised.
 *
 * Every one of them declares the same two halves. A standing
 * `stat-modifier corruption-points +N` on its bearer, and one or more
 * `on-event … force-check corruption` triggers. It was a family `hazards` could
 * not read, so it declined the play and `pass` won: in the recorded games strong
 * players played these cards in 38 hazard windows where the modular AI passed.
 *
 * The price is the chance the bearer fails a corruption check *because of this
 * card*, times what they lose when he does:
 *
 * - **Checks it forces this movement/hazard phase.** An `end-of-company-mh`
 *   trigger fires once per region of the path the company is moving along now
 *   (`perRegion`, Alone and Unadvised), or once per region of the types it
 *   names (`regionTypeFilter`, Lure of Nature). The engine's own resolved path
 *   is on the phase state, so these are counted, not guessed.
 * - **Checks it may force later** — at a haven's untap (Lure of the Senses),
 *   on gaining an item (Lure of Expedience), on a wound (Despair of the Heart),
 *   on the next move — are uncertain and the bearer may shed the card first, so
 *   one such check is credited, discounted as potential.
 * - **The Free Council.** Every character makes a corruption check there, so
 *   the +N widens a failing band the bearer will certainly face, if he lasts;
 *   also potential.
 *
 * A failed check takes the character out of play with everything he carries.
 *
 * **The tap to shed it.** Each of these cards lets its bearer tap in his
 * organization phase to roll it off (`grant-action remove-self-on-roll`, cost
 * `tap bearer`). Keeping it is the risk above; shedding it spends a tap the
 * company would otherwise use to play a resource or influence a faction. Either
 * way they pay, and the tap is the smaller of the two, so it is charged.
 */

import type { CardDefinition, CardInstanceId, OpponentCompanyView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import type { MpDelta, MpSource } from '../../core/tsd.js';
import { pAtMost } from '../../core/dice.js';

/** The effect fields read here. */
interface Effect {
  readonly type?: string;
  readonly stat?: string;
  readonly value?: unknown;
  readonly check?: string | readonly string[];
  readonly event?: string;
  readonly perRegion?: boolean;
  readonly regionTypeFilter?: readonly string[];
  readonly apply?: { readonly type?: string; readonly check?: string };
  readonly action?: string;
  readonly cost?: { readonly tap?: string };
}

/** The price, and what it rests on, for the rationale. */
export interface CorruptionHazardGain {
  readonly tsd: number;
  readonly reason: string;
}

/** Marshalling points leaving play with an opposing character, by source. */
function lossDelta(context: ModuleContext, characterId: CardInstanceId): MpDelta {
  const character = context.view.opponent.characters[characterId];
  const delta: Record<string, number> = {};
  if (!character) return delta;
  const add = (definitionId: string): void => {
    const printed = context.cardPool[definitionId] as unknown as
      { marshallingPoints?: number; marshallingCategory?: string } | undefined;
    const points = printed?.marshallingPoints ?? 0;
    if (points <= 0) return;
    const source = (printed?.marshallingCategory ?? 'misc') as MpSource;
    delta[source] = (delta[source] ?? 0) - points;
  };
  add(character.definitionId as string);
  for (const item of character.items) add(item.definitionId as string);
  for (const ally of character.allies) add(ally.definitionId as string);
  return delta;
}

/**
 * Price a corruption hazard aimed at `characterId` in the company resolving
 * its movement/hazard phase, or null when the card is not of this family.
 */
export function corruptionHazardGain(
  def: CardDefinition | undefined,
  characterId: CardInstanceId | undefined,
  company: OpponentCompanyView,
  context: ModuleContext,
): CorruptionHazardGain | null {
  if (!characterId) return null;
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  const added = effects
    .filter(e => e.type === 'stat-modifier' && e.stat === 'corruption-points' && typeof e.value === 'number')
    .reduce((sum, e) => sum + (e.value as number), 0);
  const triggers = effects.filter(e => e.type === 'on-event'
    && e.apply?.type === 'force-check' && e.apply.check === 'corruption');
  if (added <= 0 && triggers.length === 0) return null;

  const { view, standing, tunables } = context;
  const character = view.opponent.characters[characterId];
  if (!character) return null;

  // The card's own modifier to its bearer's checks (Alone and Unadvised:
  // +1 per character in his company).
  const modifier = effects
    .filter(e => e.type === 'check-modifier' && (e.check === 'corruption'
      || (Array.isArray(e.check) && e.check.includes('corruption'))))
    .reduce((sum, e) => sum + (typeof e.value === 'number' ? e.value
      : e.value === 'company.characterCount' ? company.characters.length : 0), 0);

  const before = character.effectiveStats.corruptionPoints;
  const after = before + added;
  // A check fails on a roll at or below corruption, less any modifier.
  const pFail = pAtMost(after - modifier);

  // Checks forced at the end of this company's movement/hazard phase.
  const path = ((view.phaseState as unknown as { resolvedSitePath?: readonly string[] }).resolvedSitePath) ?? [];
  let now = 0;
  let later = 0;
  for (const trigger of triggers) {
    if (trigger.event === 'end-of-company-mh') {
      now += trigger.perRegion
        ? path.length
        : trigger.regionTypeFilter
          ? path.filter(region => trigger.regionTypeFilter!.includes(region)).length
          : 1;
    }
    later = 1;
  }
  const discount = tunables.potentialDiscount;
  const councilWidening = Math.max(0, pAtMost(after - modifier) - pAtMost(before));
  const survives = (1 - pFail) ** now * (1 - discount * later * pFail) * (1 - discount * councilWidening);
  const pLost = 1 - survives;

  const onFailure = (standing.tsdAfter({}, lossDelta(context, characterId)) - standing.tsd)
    + tunables.eliminationTempoCost;
  const shedTap = effects.some(e => e.type === 'grant-action' && e.action === 'remove-self-on-roll'
    && e.cost?.tap === 'bearer') ? tunables.tapTempoCost : 0;
  const tsd = pLost * onFailure + shedTap;
  const name = (context.cardPool[character.definitionId as string] as unknown as { name?: string } | undefined)?.name
    ?? (characterId as string);
  return {
    tsd,
    reason: `${name}: corruption ${before} → ${after}${modifier ? ` (checks ${modifier > 0 ? '+' : ''}${modifier})` : ''}, `
      + `${now} check(s) forced this movement/hazard phase at ${(pFail * 100).toFixed(0)}% to fail, `
      + `${later} later and the Free Council discounted — ${(pLost * 100).toFixed(0)}% he is lost, `
      + `against ${onFailure.toFixed(1)} tsd`
      + (shedTap > 0 ? `, and a tap in his organization phase to shed it` : ''),
  };
}

/**
 * @module arrival-modes
 *
 * Mutually-exclusive "company arrives at site" modes of hazard short-events.
 *
 * Environment short-events such as Choking Shadows (tw-21), Awaken the
 * Earth's Fire (tw-11), Gloom (tw-41) and New Moon (tw-68) declare several
 * `on-event company-arrives-at-site` effects, each one an "Alternatively"
 * mode ("Modify the prowess of one automatic-attack … by +2. Alternatively,
 * if Doors of Night is in play, treat one Wilderness as a Shadow-land or one
 * Ruins & Lairs as a Shadow-hold"). Which mode applies is the hazard player's
 * choice, made when the card is played: the legal-action generator offers one
 * `play-hazard` per currently-applicable mode (carrying `arrivalModeIndex`)
 * and the chain resolver applies only the chosen one.
 */

import type { CardDefinition, GameState } from '../index.js';
import type { OnEventEffect } from '../types/effects.js';
import { Phase } from '../types/state-phases.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { buildInPlayNames } from './recompute-derived.js';
import { getCardEffects } from './reducer-utils.js';

/**
 * The card's `on-event company-arrives-at-site` effects that install
 * constraints, in declaration order. `arrivalModeIndex` indexes this list.
 */
export function arrivalModeEffects(def: CardDefinition): readonly OnEventEffect[] {
  return getCardEffects(def).filter(
    (e): e is OnEventEffect =>
      e.type === 'on-event'
      && e.event === 'company-arrives-at-site'
      && (e.apply.type === 'add-constraint' || e.apply.type === 'sequence'),
  );
}

/**
 * Build the evaluation context for a `company-arrives-at-site` `when`
 * clause. Exposes the active company's destination site type, destination
 * region type, site-path region types, and whether Doors of Night is in
 * play — enough for a card like Choking Shadows to gate its modes.
 */
export function buildArrivalContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase !== Phase.MovementHazard) return ctx;
  const mh = state.phaseState;
  const company: Record<string, unknown> = {};
  if (mh.destinationSiteType) company.destinationSiteType = mh.destinationSiteType;
  if (mh.destinationSiteName) company.destinationSiteName = mh.destinationSiteName;
  // The destination region type is the last entry in the resolved path
  // (the region the destination site sits in).
  if (mh.resolvedSitePath.length > 0) {
    company.destinationRegionType = mh.resolvedSitePath[mh.resolvedSitePath.length - 1];
  }
  // Every region type in the company's site path, so a card that converts
  // "one Wilderness" (Choking Shadows) can apply to any Wilderness on the
  // path — not only the destination region.
  company.pathRegionTypes = [...mh.resolvedSitePath];
  ctx.company = company;
  const inPlayNames = buildInPlayNames(state);
  ctx.inPlay = inPlayNames;
  ctx.environment = { doorsOfNightInPlay: inPlayNames.includes('Doors of Night') };
  return ctx;
}

/**
 * Indices (into {@link arrivalModeEffects}) of the modes whose `when`
 * condition currently holds for the active moving company.
 */
export function applicableArrivalModeIndices(state: GameState, def: CardDefinition): number[] {
  const modes = arrivalModeEffects(def);
  if (modes.length === 0) return [];
  const ctx = buildArrivalContext(state);
  const indices: number[] = [];
  modes.forEach((m, i) => {
    if (!m.when || matchesCondition(m.when, ctx)) indices.push(i);
  });
  return indices;
}

/** Printed names of the region types, as used in card text. */
const REGION_TYPE_LABELS: Readonly<Record<string, string>> = {
  free: 'Free-domain',
  border: 'Border-land',
  wilderness: 'Wilderness',
  shadow: 'Shadow-land',
  dark: 'Dark-domain',
  coastal: 'Coastal Sea',
};

/**
 * Short human-readable label for one arrival mode, used to let the hazard
 * player tell otherwise-identical `play-hazard` variants apart.
 */
export function describeArrivalMode(def: CardDefinition, index: number): string {
  const mode = arrivalModeEffects(def)[index];
  if (!mode) return `mode ${index + 1}`;
  const apply = (mode.apply.type === 'sequence' ? mode.apply.apps?.[0] : mode.apply) as
    Record<string, unknown> | undefined;
  if (!apply) return `mode ${index + 1}`;
  const titled = (s: unknown): string => String(s).split('-').map(w => w === 'and' ? '&' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  switch (apply.constraint) {
    case 'auto-attack-prowess-boost':
      return `+${String(apply.value)} prowess to automatic-attack`;
    case 'site-type-override':
      return `Treat site as ${titled(apply.overrideType)}`;
    case 'region-type-override':
      return `Treat region as ${REGION_TYPE_LABELS[String(apply.overrideType)] ?? titled(apply.overrideType)}`;
    default:
      return titled(apply.constraint ?? `mode ${index + 1}`);
  }
}

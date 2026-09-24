/**
 * @module ai/h2/modules/hazards/event-families
 *
 * Hazard events priced by the family their effects declare, for the families
 * strong players reach for and `hazards` could not read — River and Call of
 * Home. Each returns null for a card outside its family, so the caller can try
 * the next one.
 */

import { CardStatus } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, OpponentCompanyView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { pAtMost } from '../../core/dice.js';
import { computeBeliefs } from '../../services/beliefs.js';
import { denialContext } from '../../services/denial.js';

/** The effect fields read here. */
interface Effect {
  readonly type?: string;
  readonly event?: string;
  readonly threshold?: number;
  readonly apply?: {
    readonly type?: string;
    readonly constraint?: string;
    readonly apps?: readonly { readonly type?: string; readonly constraint?: string }[];
  };
}

/** A price and why. */
export interface FamilyGain {
  readonly tsd: number;
  readonly reason: string;
}

/** Whether an apply (or any step of a sequence) adds the named constraint. */
function addsConstraint(apply: Effect['apply'], constraint: string): boolean {
  if (!apply) return false;
  if (apply.type === 'add-constraint' && apply.constraint === constraint) return true;
  return (apply.apps ?? []).some(step => step.type === 'add-constraint' && step.constraint === constraint);
}

/** The printed skills of an opposing character. */
function skillsOf(context: ModuleContext, characterId: CardInstanceId): readonly string[] {
  const character = context.view.opponent.characters[characterId];
  return character
    ? (context.cardPool[character.definitionId as string] as unknown as { skills?: readonly string[] } | undefined)
      ?.skills ?? []
    : [];
}

/**
 * River (tw-84): a company arriving at the site "must do nothing during its
 * site phase", unless an untapped ranger taps to cancel it.
 *
 * Its site phase is where the company plays what it travelled for, so what
 * River takes is one resource play at that site — the same `deniedPlayMp` the
 * whole module prices a denied play at, through `denial`, weighted by how
 * likely they hold one. With an untapped ranger in the company it costs them
 * only that ranger's tap — at the start of the very site phase, so priced as a
 * tap `denial` would price. At a haven there is nothing to deny.
 */
export function siteDenialGain(
  def: CardDefinition | undefined,
  targetSiteDefinitionId: string | undefined,
  company: OpponentCompanyView,
  context: ModuleContext,
): FamilyGain | null {
  if (!targetSiteDefinitionId) return null;
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  const denies = effects.some(e => e.type === 'on-event' && e.event === 'company-arrives-at-site'
    && addsConstraint(e.apply, 'site-phase-do-nothing'));
  if (!denies) return null;
  const { view, cardPool, standing, tunables } = context;
  const site = cardPool[targetSiteDefinitionId] as unknown as { name?: string; siteType?: string } | undefined;
  if (site?.siteType === 'haven') {
    return { tsd: 0, reason: `${site.name ?? 'the site'} is a haven — its site phase has nothing to deny` };
  }
  const beliefs = computeBeliefs(view, cardPool);
  const denial = denialContext(view, company, beliefs, standing, tunables);
  const ranger = company.characters.some(id => view.opponent.characters[id]?.status === CardStatus.Untapped
    && skillsOf(context, id).includes('ranger'));
  if (ranger) {
    // The ranger taps at the start of the site phase, so his tap is one of the
    // site phase's own — the same tap `denial` prices a strike's tap at.
    const tap = Math.max(tunables.tapTempoCost, denial.fullPlay * denial.tapUtilisation);
    return {
      tsd: tap,
      reason: 'an untapped ranger in the company can tap to cancel it — it costs them that tap, '
        + 'at the start of the site phase where it would have played',
    };
  }
  const holdsPlay = Math.min(1, denial.believedPlays);
  const tsd = denial.fullPlay * holdsPlay;
  return {
    tsd,
    reason: `their site phase at ${site?.name ?? 'the site'} does nothing — one resource play denied, `
      + `at ${(holdsPlay * 100).toFixed(0)}% that they hold one (no untapped ranger to cancel it)`,
  };
}

/**
 * Call of Home (tw-18): the character returns to his player's hand unless a
 * roll plus that player's unused general influence reaches the threshold.
 *
 * Back in hand he can be played again, so this is not an elimination: what is
 * lost is the tempo of bringing him back, priced at the elimination cost
 * discounted as potential, times the chance the roll fails.
 */
export function callOfHomeGain(
  def: CardDefinition | undefined,
  characterId: CardInstanceId | undefined,
  context: ModuleContext,
): FamilyGain | null {
  if (!characterId) return null;
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  const check = effects.find(e => e.type === 'call-of-home-check');
  if (!check) return null;
  const { view, tunables } = context;
  const opponent = view.opponent as unknown as { generalInfluence?: number; generalInfluenceUsed?: number };
  const unused = Math.max(0, (opponent.generalInfluence ?? 20) - (opponent.generalInfluenceUsed ?? 0));
  const threshold = check.threshold ?? 10;
  // Returns home when roll + unused < threshold, i.e. roll <= threshold - unused - 1.
  const pHome = pAtMost(threshold - unused - 1);
  const tsd = pHome * tunables.eliminationTempoCost * tunables.potentialDiscount;
  return {
    tsd,
    reason: `${(pHome * 100).toFixed(0)}% he goes back to their hand (${unused} general influence unused) — `
      + 'the tempo of playing him again, discounted as potential',
  };
}

/**
 * @module ai/h2/services/draw-value
 *
 * How many resource cards a company will draw, and what a draw is worth.
 *
 * Drawing is how a deck becomes marshalling points in this game, and until now
 * H2 read it in exactly one place and in its weakest form: `travel` multiplied
 * the *printed* `resourceDraws` of a site by `resourceDrawValue`. Everything
 * that changes that number was invisible. Nothing in H2 referenced
 * `draw-modifier`, `draw-cards` or `new-hand` at all, which meant:
 *
 * - **A Short Rest** (td-95) — "each moving company may draw an extra card for
 *   each region less than four in its site path", worth up to three extra cards
 *   *per moving company* — was priced at the flat card floor and never played.
 *   `play-long-event` was owned by no evaluator in the codebase, H1 included, so
 *   the long-event phase was a phase both agents passed unconditionally.
 * - **Radagast** (tw-178, wh-8) and **Alatar** (tw-117) carry draw-modifiers of
 *   their own, so a company built around either one draws more than its site
 *   says — and `travel` costed its routes as though it did not.
 * - The hazard side of the same effect — **Smaug at Home** (td-71), **In the
 *   Heart of his Realm** (dm-67) — shrinks our draws, and a route was priced as
 *   though it did not.
 *
 * The arithmetic is not re-derived here. `resolveDrawModifier` is the engine's
 * own summation, `min` floor included, and it takes a plain context record — so
 * this service's whole job is to build the same context the engine builds in
 * `mh-steps.ts` (site-path region counts, the movement type, whether the moving
 * player is a minion) out of a `PlayerView`, filter the collected effects by
 * their `when` with the engine's own `matchesContext`, and hand them over. A
 * second implementation of "4 - sitePath.regionCount" is exactly the kind of
 * divergence this codebase has been bitten by before.
 *
 * ## What it is honest about
 *
 * The engine knows the *resolved* site path and the movement type, because both
 * are fixed when the company declares its path in the movement/hazard phase.
 * A decision in the organization or long-event phase is earlier than that, so
 * this service reads the destination site's **printed** path — the same
 * approximation `travel` and `exposure` already make — and infers the movement
 * type from the company rather than being told it. Both are stated as
 * assumptions by the modules that spend the number.
 */

import { matchesContext, regionTypeCounts, resolveDrawModifier } from '@meccg/shared';
import type {
  CardDefinition, CollectedEffect, Company, CompanyId, PlayerView,
} from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import type { Tunables } from '../core/tunables.js';
import { computeExposure } from './exposure.js';
import type { SiteExposure } from './exposure.js';

/** A card effect, as far as this service reads one. */
interface DrawEffect {
  readonly type?: string;
  readonly draw?: 'hazard' | 'resource';
  readonly appliesTo?: 'own-companies' | 'any-company';
  readonly when?: unknown;
  readonly value?: unknown;
  readonly min?: number;
  readonly count?: number;
}

/** How many cards a company draws, and what drawing is worth. */
export interface DrawValue {
  /**
   * What one resource card drawn is worth, in TSD.
   *
   * Re-exported from the tunables so a consumer needs one import rather than
   * two, and so there is one place to look when the number is questioned.
   */
  readonly perCard: number;
  /**
   * Resource cards a company draws on arriving at `site`, counting every
   * draw-modifier already in play — its own characters', our own in-play
   * cards', and the opponent's `any-company` ones.
   *
   * `extra` adds the effects of a card *not yet in play*, which is how a card
   * in hand is priced: the difference between calling this with and without it
   * is what playing it would buy.
   */
  drawsAt(companyId: CompanyId, site: SiteExposure, extra?: readonly unknown[]): number;
  /**
   * Extra resource cards a card's effects would add across every company that
   * would benefit, given the movement already planned this turn.
   *
   * Zero when nothing is moving — a draw-modifier pays only on a company that
   * draws, and a turn with no movement is a turn it is worth nothing. That is
   * a fact about the position rather than a discount.
   */
  extraFrom(effects: readonly unknown[]): number;
  /** The companies this turn's plan has moving, for a rationale that says why. */
  movingCompanies(): readonly { readonly company: Company; readonly site: SiteExposure }[];
}

/** Whether a player's alignment is one the DSL calls a minion. */
function isMinionSide(alignment: string): boolean {
  return alignment === 'minion' || alignment === 'balrog';
}

/**
 * The movement type a company's declared plan amounts to.
 *
 * The engine is *told* this on `declare-path`; a decision taken before the
 * movement/hazard phase has to infer it, and the inference the view supports is
 * the coarse one: a granted special movement is `special`, and anything else is
 * `region`.
 *
 * Under-deeps movement is deliberately *not* separated out, because it cannot
 * be read off a site card — an under-deeps site is an ordinary
 * `ruins-and-lairs` or `dark-hold` whose printed `sitePath` is empty, which is
 * also true of a haven. Getting it wrong costs nothing: the only resource
 * draw-modifier in the pool that reads `movementType` is A Short Rest, and it
 * also requires `sitePath.regionCount` between 1 and 3 — which an under-deeps
 * destination fails on its empty path regardless of what this returns.
 * `starter` is undistinguished for the same reason: every modifier naming it
 * also names `region`.
 */
function movementTypeOf(company: Company): string {
  return company.specialMovement !== undefined ? 'special' : 'region';
}

/** The resolver context the engine builds for a draw-modifier, from a view. */
function drawContextFor(
  view: PlayerView,
  company: Company,
  site: SiteExposure,
): Record<string, unknown> {
  return {
    reason: 'draw-modifier',
    sitePath: {
      ...regionTypeCounts(site.sitePath),
      regionCount: site.pathLength,
    },
    movementType: movementTypeOf(company),
    player: { minion: isMinionSide(view.self.alignment as unknown as string) },
  };
}

/** Every effect a card definition declares, as this service reads them. */
function effectsOf(def: CardDefinition | undefined): readonly DrawEffect[] {
  return (def as unknown as { effects?: readonly DrawEffect[] } | undefined)?.effects ?? [];
}

/**
 * Build the service from a player view.
 *
 * The collection mirrors `mh-steps.ts` deliberately, including which side each
 * kind of modifier is read from: our own characters and in-play cards reach our
 * own companies, and only an `appliesTo: 'any-company'` modifier is collected
 * from the opponent — which is what stops a lingering long-event of theirs from
 * being credited against us, and what lets Smaug at Home shrink our draws.
 */
function buildDrawValue(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  tunables: Tunables,
): DrawValue {
  const exposure = computeExposure(view, cardPool);

  /** Draw-modifiers a company's own characters and their items contribute. */
  const fromCharacters = (company: Company): DrawEffect[] => company.characters.flatMap(id => {
    const character = view.self.characters[id];
    if (!character) return [];
    return [
      ...effectsOf(cardPool[character.definitionId]),
      ...character.items.flatMap(item => effectsOf(cardPool[item.definitionId])),
    ];
  });

  /** Draw-modifiers our own table contributes, plus the opponent's cross-table ones. */
  const fromTable = (): DrawEffect[] => [
    ...view.self.cardsInPlay.flatMap(card => effectsOf(cardPool[card.definitionId])),
    ...view.opponent.cardsInPlay
      .flatMap(card => effectsOf(cardPool[card.definitionId]))
      .filter(effect => effect.type === 'draw-modifier' && effect.appliesTo === 'any-company'),
  ];

  const drawsAt = (
    companyId: CompanyId,
    site: SiteExposure,
    extra: readonly unknown[] = [],
  ): number => {
    const company = view.self.companies.find(c => c.id === companyId);
    if (!company) return site.resourceDraws;
    const context = drawContextFor(view, company, site);
    const candidates = [...fromCharacters(company), ...fromTable(), ...(extra as DrawEffect[])];
    // The engine's collectors apply each effect's `when` before summing, and
    // `resolveDrawModifier` assumes that has happened. A condition this cannot
    // evaluate is *dropped* rather than assumed true: crediting a bonus whose
    // gate we could not read would make a route look better than it is, and an
    // understated draw is the safe direction for a number that drives movement.
    const collected: CollectedEffect[] = candidates
      .filter(effect => effect.type === 'draw-modifier' && effect.draw === 'resource')
      .filter(effect => effect.when === undefined
        || matchesContext(effect.when as never, context))
      .map(effect => ({ effect } as unknown as CollectedEffect));
    const modifier = resolveDrawModifier(collected, 'resource', context);
    if (modifier.adjustment === 0) return site.resourceDraws;
    // `applyDrawModifier` in `mh-steps.ts`, which is private to it: floor at
    // `min`, and never let a *reduction* raise the count.
    const adjusted = Math.max(modifier.min, site.resourceDraws + modifier.adjustment);
    return modifier.adjustment < 0 ? Math.min(site.resourceDraws, adjusted) : adjusted;
  };

  const movingCompanies = (): { company: Company; site: SiteExposure }[] => view.self.companies
    .flatMap(company => {
      const site = exposure.destination(company.id);
      // A company that has already moved this turn has already drawn: its
      // draws are spent, and a modifier played now cannot reach them.
      return site && !company.moved ? [{ company, site }] : [];
    });

  return {
    perCard: tunables.resourceDrawValue,

    drawsAt,

    extraFrom(effects: readonly unknown[]): number {
      const declared = (effects as readonly DrawEffect[])
        .filter(effect => effect.type === 'draw-modifier' && effect.draw === 'resource');
      if (declared.length === 0) return 0;
      let extra = 0;
      for (const { company, site } of movingCompanies()) {
        extra += drawsAt(company.id, site, declared) - drawsAt(company.id, site);
      }
      return extra;
    },

    movingCompanies,
  };
}

/** Build the service once per position. See `core/memo`. */
export const computeDrawValue = memoizeOnFirst(buildDrawValue);

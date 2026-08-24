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
 *
 * ## The two draws, and why company order is not a free choice
 *
 * A movement/hazard phase draws in *two* places, and only one of them belongs
 * to a company:
 *
 * - **Site draws** (`mh-steps.ts` `transitionToDrawCards`) — the moving
 *   company's own, `resourceDraws` off the site card plus every modifier, taken
 *   one at a time and never capped by hand size. A company that is **not
 *   moving** takes this branch not at all: `transitionToDrawCards` skips
 *   straight to `play-hazards`, so a stationary company draws **nothing**.
 * - **The step-8b top-up** (`mh-hazard-play.ts` `endCompanyMH`) — after *every*
 *   company, moving or not, both players draw back up to hand size and then
 *   discard down to it.
 *
 * Two consequences the modules that spend these numbers have to know. First,
 * the hand is exactly at hand size after every company, so movement/hazard
 * draws are never card advantage: they are **selection depth**, cards seen and
 * then discarded from. Second, and less obvious, the *order* companies are
 * resolved in changes how many cards are seen at all. Entering the phase with a
 * hand deficit `d` and companies drawing `N_1 … N_k`, the first company's own
 * draws eat into the free top-up and the rest arrive against a full hand:
 *
 * ```
 * cards seen = ΣNᵢ + max(0, d − N_first)
 * ```
 *
 * `ΣNᵢ` does not depend on the order, so only the *first* pick matters, and the
 * company to resolve first is the one that draws **least** — a stationary
 * company, drawing nothing of its own, banks the whole deficit. Verified
 * against the engine on game `msxd2ban-qoqtc7`#92: hand 5, one company moving
 * to Weathertop for 4 (1 printed, +3 modified) and one standing still. Moving
 * first draws 4 and discards 1; standing still first draws 7 and discards 4.
 * Both end on 8 cards, but the second sees three more of them.
 */

import { HAND_SIZE, matchesContext, regionTypeCounts, resolveDrawModifier } from '@meccg/shared';
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
   * Resource cards a company will draw of its **own** in this movement/hazard
   * phase, counted the way the engine counts them rather than off the printed
   * destination: zero when it is not moving, and read from the *site of origin*
   * when a company that is neither fallen-wizard nor balrog moves to a haven.
   *
   * This is `drawsAt` applied to the right site, and it is what a decision
   * *inside* the movement/hazard phase wants; `drawsAt` remains the primitive
   * for pricing a destination that has not been chosen yet.
   */
  siteDraws(companyId: CompanyId): number;
  /**
   * How far below hand size the hand is right now — the free top-up that
   * step 8b will hand to whichever company is resolved first, to whatever
   * extent that company's own site draws have not already covered it.
   */
  handDeficit(): number;
  /**
   * Cards the rest of this movement/hazard phase will let us see if
   * `companyId` is resolved next: every still-unresolved company's site draws,
   * plus whatever of the hand deficit this one's own draws leave unclaimed.
   *
   * The sum over companies is the same whichever order they are taken in, so
   * this differs between candidates only in the `max(0, deficit − draws)` term
   * — but it is reported whole, because the number a reader wants to check
   * against the engine is how many cards the phase actually yields.
   */
  phaseDrawsIfFirst(companyId: CompanyId): number;
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

  /**
   * Whether the company may draw resources at all — CoE 2.IV.v, mirrored from
   * `transitionToDrawCards`: it needs an avatar (`mind === null`) or a
   * character with mind ≥ 3. Failing it zeroes the *printed* count only. The
   * engine applies draw-modifiers on top of that zero regardless, and
   * `applyDrawModifier` clamps only reductions — so A Short Rest still pays a
   * company of hobbits, and Smaug at Home cannot hand one a draw it never had.
   */
  const hasEligibleDrawer = (company: Company): boolean => company.characters.some(id => {
    const character = view.self.characters[id];
    if (!character) return false;
    const def = cardPool[character.definitionId] as { mind?: number | null } | undefined;
    if (!def) return false;
    return def.mind === null || (typeof def.mind === 'number' && def.mind >= 3);
  });

  const drawsAt = (
    companyId: CompanyId,
    site: SiteExposure,
    extra: readonly unknown[] = [],
  ): number => {
    const company = view.self.companies.find(c => c.id === companyId);
    if (!company) return site.resourceDraws;
    const base = hasEligibleDrawer(company) ? site.resourceDraws : 0;
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
    if (modifier.adjustment === 0) return base;
    // `applyDrawModifier` in `mh-steps.ts`, which is private to it: floor at
    // `min`, and never let a *reduction* raise the count.
    const adjusted = Math.max(modifier.min, base + modifier.adjustment);
    return modifier.adjustment < 0 ? Math.min(base, adjusted) : adjusted;
  };

  /**
   * The site whose printed draws a company's *actual* movement this turn reads
   * from, or null when it is not moving and so draws nothing.
   *
   * The haven rule is the engine's (`mh-steps.ts`): a hero or minion company
   * arriving at a haven draws from the site it left, not from the haven. A
   * fallen-wizard or balrog company is exempt and draws from the haven itself.
   */
  const drawSiteOf = (company: Company): SiteExposure | null => {
    const destination = exposure.destination(company.id);
    if (!destination) return null;
    const alignment = view.self.alignment as unknown as string;
    const movingToHaven = alignment !== 'fallen-wizard' && alignment !== 'balrog'
      && destination.siteType === 'haven';
    if (!movingToHaven) return destination;
    return exposure.currentSite(company.id) ?? destination;
  };

  const siteDraws = (companyId: CompanyId): number => {
    const company = view.self.companies.find(c => c.id === companyId);
    if (!company) return 0;
    const site = drawSiteOf(company);
    return site ? drawsAt(companyId, site) : 0;
  };

  /**
   * The player's hand size: the base plus every `hand-size-modifier` in play.
   *
   * `resolveHandSize` is the engine's, and it takes a `GameState` a module
   * does not have. The sum it performs is a plain one — no conditions this
   * cannot read, no ordering — so it is repeated here over the view's own
   * characters, their items, our permanent events and our player-scoped
   * constraints, in the same order and with the same fallback to zero.
   */
  const handSize = (): number => {
    let total = HAND_SIZE;
    const add = (effects: readonly DrawEffect[]): void => {
      for (const effect of effects) {
        if (effect.type !== 'hand-size-modifier') continue;
        total += typeof effect.value === 'number' ? effect.value : 0;
      }
    };
    for (const company of view.self.companies) {
      for (const id of company.characters) {
        const character = view.self.characters[id];
        if (!character) continue;
        add(effectsOf(cardPool[character.definitionId]));
        for (const item of character.items) add(effectsOf(cardPool[item.definitionId]));
      }
    }
    for (const card of view.self.cardsInPlay) add(effectsOf(cardPool[card.definitionId]));
    for (const constraint of view.activeConstraints) {
      const kind = constraint.kind as unknown as { type?: string; value?: number };
      const target = constraint.target as unknown as { kind?: string; playerId?: string };
      if (kind.type !== 'hand-size-modifier' || target.kind !== 'player') continue;
      if (target.playerId !== (view.self.id as unknown as string)) continue;
      total += typeof kind.value === 'number' ? kind.value : 0;
    }
    return total;
  };

  const handDeficit = (): number => Math.max(0, handSize() - view.self.hand.length);

  /** The companies this phase has not resolved yet, ours only. */
  const unresolvedCompanies = (): readonly Company[] => {
    const handled = new Set(
      ((view.phaseState as unknown as { handledCompanyIds?: readonly CompanyId[] })
        .handledCompanyIds ?? []).map(id => id as string),
    );
    return view.self.companies.filter(c => !handled.has(c.id as string));
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

    siteDraws,

    handDeficit,

    phaseDrawsIfFirst(companyId: CompanyId): number {
      const rest = unresolvedCompanies()
        .reduce((sum, company) => sum + siteDraws(company.id), 0);
      return rest + Math.max(0, handDeficit() - siteDraws(companyId));
    },

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

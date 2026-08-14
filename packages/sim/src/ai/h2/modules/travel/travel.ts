/**
 * @module ai/h2/modules/travel/travel
 *
 * The `travel` module — where a company should go.
 *
 * Plan §3.3 describes this as a recommendation engine over the site deck whose
 * destination value is *assembled from the acquisition modules*: `travel` asks
 * what `items` / `factions` / `allies` would pay to be standing somewhere, and
 * subtracts the cost of getting there. None of those modules exist yet, so
 * this version computes the part it can compute honestly and declares the rest
 * missing rather than inventing it.
 *
 * What it can compute honestly is the half that matters most and that H1 gets
 * wrong. H1 scores a destination by `max(10, mp * 20)` per playable hand card
 * — a linear weight in marshalling points. H2 values the same card through
 * `standing`, which knows what a point in that *source* is actually worth
 * right now: 2 if the opponent has none and ours double, 1 ordinarily, and
 * **0** if the source already sits at the half-total cap. A faction worth
 * nothing is worth nothing, and that is invisible to a linear weight — it is
 * the single clearest case in the whole design (§2.1).
 *
 * What is missing is stated on every evaluation: the acquisition modules'
 * strategic view is absent, so only cards already in hand count toward a
 * destination's worth. Hazards en route *are* priced now, though only as the
 * likelihood that the opponent holds a creature at all — `beliefs` estimates
 * kinds, not cards.
 *
 * Four action types, one model. `plan-movement` asks what a destination is
 * worth; `cancel-movement` is that same number with the sign flipped, because
 * cancelling gives up exactly what travelling would have gained;
 * `declare-path` prices the route to a destination already fixed, so it is the
 * travel cost alone; and `select-company` orders companies within a phase.
 * Sharing one `destinationValue` between the first two is deliberate — two
 * models of the same choice would eventually disagree about it, and nothing in
 * the output would say which was wrong.
 */

import { CardStatus } from '@meccg/shared';
import type { CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { Plan, PlanStep } from '../../core/plan.js';
import { ROUTE_STEP, reachProbability } from '../../core/plan.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';
import { computeExposure } from '../../services/exposure.js';
import { computeBeliefs } from '../../services/beliefs.js';
import { automaticAttacksOf, computeDefence } from '../../services/defence.js';
import { rosterOf } from '../../services/strike/prowess.js';
import { computeReach } from '../../services/reach.js';
import type { SiteExposure } from '../../services/exposure.js';
import { resourcePlayableAt } from '../../../evaluators/common.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'plan-movement', 'cancel-movement', 'declare-path', 'select-company', 'enter-site', 'pass',
] as const;

/** What a hand card would be worth if the company stood at a destination. */
interface PlayableCard {
  readonly name: string;
  readonly source: MpSource;
  readonly marshallingPoints: number;
  /** TSD the card would add, valued through the standing rather than linearly. */
  readonly tsd: number;
}

/** Everything the module needs about one candidate destination. */
interface Destination {
  readonly action: GameAction;
  readonly site: SiteExposure;
  readonly playable: readonly PlayableCard[];
  /** Untapped characters available to tap for those plays. */
  readonly tapsAvailable: number;
}

/** Cards in hand that could be played at a site, valued through the standing. */
function playableAt(
  context: ModuleContext,
  siteDefinitionId: string,
): PlayableCard[] {
  const { view, cardPool, standing } = context;
  const siteDef = cardPool[siteDefinitionId];
  if (!siteDef) return [];
  const cards: PlayableCard[] = [];
  for (const card of view.self.hand) {
    const def = cardPool[card.definitionId];
    if (!def) continue;
    // Playability is the engine's rule, not a heuristic: reuse the predicate
    // rather than restate which site types accept which item classes.
    if (!resourcePlayableAt(def, siteDef as never)) continue;
    const record = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const source = (record.marshallingCategory ?? 'misc') as MpSource;
    const points = record.marshallingPoints ?? 0;
    cards.push({
      name: record.name ?? (card.definitionId as string),
      source,
      marshallingPoints: points,
      // The whole point: a point in this source, priced by the tournament
      // scorer at the current standing, not by a constant.
      tsd: points > 0 ? standing.tsdAfter({ [source]: points }) - standing.tsd : 0,
    });
  }
  return cards;
}

/**
 * The site a `plan-movement` action would send the company to.
 *
 * The instance is looked up directly for its definition ID rather than
 * resolving a definition object and scanning the card pool for its identity —
 * that scan was O(pool) per candidate and, worse, silently returned null
 * whenever the definition did not come from the same pool object, which made
 * the whole module decline every movement it was offered.
 */
function destinationOf(view: PlayerView, action: GameAction): { definitionId: string } | null {
  const siteInstanceId = (action as unknown as { destinationSite?: CardInstanceId }).destinationSite;
  if (!siteInstanceId) return null;
  const fromDeck = view.self.siteDeck.find(c => c.instanceId === siteInstanceId);
  if (fromDeck) return { definitionId: fromDeck.definitionId };
  for (const company of view.self.companies) {
    for (const site of [company.currentSite, company.destinationSite]) {
      if (site && site.instanceId === siteInstanceId) return { definitionId: site.definitionId };
    }
  }
  return null;
}

/**
 * Score the choice of which company to resolve next.
 *
 * The criterion differs by phase, and the difference is domain knowledge
 * rather than anything the module could derive:
 *
 * - **Movement/hazard**: how many resource cards the company will draw. A
 *   company that is *not* moving can still be the right pick — it may be the
 *   one that played heavily during organization — so the criterion is the
 *   draw itself, not whether the company travels.
 * - **Site phase**: the biggest marshalling-point expectation, so that the
 *   cards and taps that help a company through its site are spent where the
 *   points actually are rather than on a weaker chance of them.
 */
function evaluateSelectCompany(context: ModuleContext, action: GameAction): Evaluation | null {
  const companyId = (action as unknown as { companyId?: string }).companyId;
  if (!companyId) return null;
  const company = context.view.self.companies.find(c => (c.id as string) === companyId);
  if (!company) return null;
  const { standing, tunables, cardPool } = context;
  const exposure = computeExposure(context.view, cardPool);
  const budget = computeBudget(context.view, cardPool);

  const site = exposure.destination(company.id) ?? exposure.currentSite(company.id);
  const inMovement = context.view.phaseState.phase === 'movement-hazard';

  let dtsd: number;
  let label: string;
  const detail: Rationale[] = [leaf('company', companyId), leaf('site', site?.name ?? 'unknown')];

  if (inMovement) {
    const draws = site?.resourceDraws ?? 0;
    dtsd = draws * tunables.resourceDrawValue;
    label = `resolve this company — ${draws} card(s) drawn`;
    detail.push(leaf('resource cards drawn', draws, {
      note: site && exposure.destination(company.id) ? 'on arrival' : 'not moving — drawn where it stands',
    }));
    detail.push(leaf('worth per card', tunables.resourceDrawValue, { unit: 'tsd', tunable: 'resourceDrawValue' }));
  } else {
    const playable = site ? playableAt(context, siteDefinitionOf(context, company.id) ?? '') : [];
    const taps = budget.untappedIn(company.id).length;
    const now = playable.slice(0, Math.max(0, taps));
    dtsd = now.reduce((sum, c) => sum + c.tsd, 0);
    label = now.length > 0
      ? `resolve this company — ${now.map(c => c.name).join(', ')} playable`
      : 'resolve this company — nothing playable here';
    detail.push(leaf('taps available', taps));
    for (const card of now) {
      detail.push(leaf(card.name, card.tsd, { unit: 'tsd', note: `${card.marshallingPoints} ${card.source} MP` }));
    }
  }

  const outcomes: Outcome[] = [{ p: 1, label, dtsd }];
  const scored = standing.score(outcomes);
  return {
    action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(label, scored.utility, [node('sequencing', dtsd, detail), scored.rationale], { unit: 'winprob' }),
    assumptions: [
      inMovement
        ? 'companies are ordered by the cards they draw; what the opponent will spend on each is '
          + 'not modelled, which needs the belief half of `exposure`'
        : 'companies are ordered by the points they can bank now; a company kept for later is not '
          + 'credited for what it might do then',
      ...ASSUMPTIONS,
    ],
  };
}

/** The definition ID of the site a company stands on or is heading to. */
function siteDefinitionOf(context: ModuleContext, companyId: string): string | undefined {
  const company = context.view.self.companies.find(c => (c.id as string) === companyId);
  return (company?.destinationSite ?? company?.currentSite)?.definitionId;
}


/** Assumptions every travel evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'hazards en route are priced only as a likelihood that the opponent holds *a* creature, not by '
  + 'which creature or whether it is playable on this path — the belief model estimates kinds, '
  + 'not cards',
  'only cards already in hand count toward a destination\'s worth; the acquisition modules\' '
  + 'strategic view (which sources are worth chasing at all) does not exist yet',
  'a resource play is assumed to need one tap, and no card is assumed to be playable twice',
];

/** What travelling to a destination is worth, and the reasoning behind it. */
interface DestinationValue {
  readonly dtsd: number;
  readonly label: string;
  readonly detail: readonly Rationale[];
  readonly playableNow: readonly PlayableCard[];
  readonly playableCount: number;
}

/**
 * The arithmetic of one destination, separated from the evaluation of it.
 *
 * `cancel-movement` needs exactly this number with the sign flipped —
 * cancelling gives up whatever travelling was worth — and computing it twice
 * would let the two answers drift apart, which is the disagreement the whole
 * service pattern exists to prevent.
 */
function destinationValue(context: ModuleContext, destination: Destination): DestinationValue {
  const { tunables } = context;
  const { site, playable } = destination;

  // Cards that can actually be played are bounded by taps available: a company
  // standing on a pile of playable cards with everyone tapped scores none of
  // them. `budget` supplies the constraint rather than the module guessing it.
  const playableNow = playable.slice(0, Math.max(0, destination.tapsAvailable));
  const realized = playableNow.reduce((sum, c) => sum + c.tsd, 0);
  const beyondTaps = playable.length - playableNow.length;
  // Cards that fit the site but not this turn's taps are unlocked, not banked.
  const potential = playable.slice(playableNow.length).reduce((sum, c) => sum + c.tsd, 0);
  // Distance is charged by what is likely to be waiting on it rather than by
  // its length alone: each region crossed is an opportunity for the opponent
  // to answer, and `beliefs` estimates how likely they are to have something
  // to answer with. With nothing shown this falls back to the prior and the
  // charge is close to the old flat one.
  const beliefs = computeBeliefs(context.view, context.cardPool);
  const threat = beliefs.holdsAtLeastOne('creature');
  const tempo = site.pathLength * tunables.regionCrossingCost * (1 + threat);

  // The cards the site draws on arrival. Priced at the same
  // `resourceDrawValue` this module already spends on `select-company`, so the
  // two cannot disagree about what a card is worth — and counted as potential
  // rather than realized, because a drawn card is not a point until it is
  // played.
  //
  // Leaving it out was the whole of the "sits still" problem. A destination
  // with nothing playable on it scored *exactly* zero, and `pass` is zero by
  // definition, so every movement tied with staying put and the tie fell
  // wherever it fell: measured against `heuristic`, a move planned on 31% of
  // turns against 42%, and 16.8 site changes a game against 26.6. Movement is
  // how a deck is drawn in this game, and a destination model that ignores the
  // draw cannot see the main reason to go anywhere.
  const draws = site.resourceDraws * tunables.resourceDrawValue;

  // A site this company has already worked is a site whose *new* options are
  // the ones the hand has drawn since — and `route-compare` says human players
  // treat that as close to disqualifying. Over 64 recorded movement decisions
  // the human returned to a site once and H2 twelve times, and the human never
  // moved to the same region twice running where H2 did on 23.4% of moves.
  //
  // Charged rather than forbidden, because a return is sometimes right: a
  // haven is revisited on purpose, and a site can hold a card the hand did not
  // have the first time. What it should not be is *free*, which is what it was
  // — the destination score is computed from the current hand and the printed
  // site, neither of which changes when the company has been there before.
  //
  // The company's history is not in the game state and cannot be: the site card
  // returns to the site deck rather than to a discard pile, so a worked site is
  // offered again exactly like one never seen. The agent remembers instead —
  // see `ModuleContext.visited`.
  const companyId = (destination.action as unknown as { companyId?: string }).companyId ?? '';
  const arriving = destinationOf(context.view, destination.action)?.definitionId;
  // A haven is the one site a company is *meant* to come back to, and charging
  // the return was a mistake this module made against itself: healing happens
  // at havens, and nowhere else a company can reach on its own.
  const beenHere = arriving !== undefined
    && site.siteType !== 'haven'
    && (context.visited?.[companyId] ?? []).includes(arriving);
  const revisit = beenHere ? tunables.revisitedSiteCost : 0;

  // What going home is *for*. A wounded character cannot carry an item, attempt
  // influence or play a resource, so the company arrives able to do less every
  // turn it stays out. Measured over six games, H2 takes fewer wounds than
  // Heuristics 1 (4.3 against 5.7 a game) and recovers from almost none of them
  // — 0.3 recoveries a game against 3.5 — because it is at a haven on 24.1% of
  // its decisions against H1's 46.4%. The damage was never the problem; not
  // going home was.
  //
  // Priced at `woundTempoCost`, which is the same number the modules already
  // charge for *inflicting* a wound: "out of action until healed, fights at −2
  // meanwhile, and usually costs the company a trip to a haven". Healing undoes
  // exactly that, so it is worth exactly that, and no new constant is invented
  // to say so.
  //
  // Counted as **realized**, not potential, and that is the whole of what was
  // wrong with the first version. `potentialDiscount` exists because "a card in
  // hand is a card that might never be playable" — it charges for the chance
  // that a modelled gain never happens. A haven has no such contingency: the
  // company arrives and the wounds are gone. Halving a certainty made the one
  // reason to go home worth less than a speculative play at a scoring site, and
  // it showed: offered a haven on 100% of the moves it made with a wounded
  // character aboard, H2 went there 10.5% of the time against Heuristics 1's
  // 54.3%.
  const woundedHere = site.siteType === 'haven'
    ? (context.view.self.companies.find(c => (c.id as string) === companyId)?.characters ?? [])
      .map(id => context.view.self.characters[id])
      .filter(ch => ch !== undefined
        && ch.status !== CardStatus.Untapped && ch.status !== CardStatus.Tapped).length
    : 0;
  const healing = woundedHere * tunables.woundTempoCost;

  const dtsd = netTsdDelta(
    { realized: realized + healing, potential: potential + draws, tempo: tempo + revisit },
    tunables,
  );
  const label = playableNow.length > 0
    ? `arrive at ${site.name} and play ${playableNow.map(c => c.name).join(', ')}`
    : `arrive at ${site.name} with nothing to play`;

  const detail: Rationale[] = [
    leaf('site', `${site.name} (${site.siteType})`),
    leaf('regions crossed', site.pathLength, {
      note: site.pathLength > 0 ? site.sitePath.join(' → ') : 'already here',
    }),
    leaf('travel cost', tempo, {
      unit: 'tsd',
      tunable: 'regionCrossingCost',
      note: `${site.pathLength} region(s), scaled by a ${(threat * 100).toFixed(0)}% chance the `
        + `opponent holds a creature (${(beliefs.confidence * 100).toFixed(0)}% confidence, `
        + `${beliefs.observed} cards seen)`,
    }),
    leaf('taps available', destination.tapsAvailable),
    ...(healing > 0
      ? [leaf('wounded characters this haven heals', healing, {
        unit: 'tsd',
        tunable: 'woundTempoCost',
        note: `${woundedHere} wounded — each is a character that cannot carry, influence or play `
          + 'until the company goes home',
      })]
      : []),
    ...(revisit > 0
      ? [leaf('been here before', revisit, {
        unit: 'tsd',
        tunable: 'revisitedSiteCost',
        note: 'this company has already worked this site; only what the hand has drawn since is new',
      })]
      : []),
    leaf('resource draws', draws, {
      unit: 'tsd',
      tunable: 'resourceDrawValue',
      note: `${site.resourceDraws} card(s) printed on the site, discounted as potential`,
    }),
  ];
  for (const card of playableNow) {
    detail.push(leaf(card.name, card.tsd, {
      unit: 'tsd',
      note: `${card.marshallingPoints} ${card.source} MP, priced at the current standing`,
    }));
  }
  if (beyondTaps > 0) {
    detail.push(leaf(`${beyondTaps} more playable but no tap left`, potential, {
      unit: 'tsd',
      tunable: 'potentialDiscount',
      note: 'unlocked, not banked',
    }));
  }
  detail.push(leaf('acquisition modules', 0, {
    unit: 'tsd',
    note: 'items / factions / allies do not exist yet — a destination worth chasing for '
      + 'a card still in the deck scores nothing here',
  }));

  return { dtsd, label, detail, playableNow, playableCount: playable.length };
}

/** Build the evaluation for one destination. */
function evaluateDestination(context: ModuleContext, destination: Destination): Evaluation {
  const { standing } = context;
  const value = destinationValue(context, destination);
  const outcomes: Outcome[] = [{ p: 1, label: value.label, dtsd: value.dtsd }];
  const scored = standing.score(outcomes);

  return {
    action: destination.action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`travel to ${destination.site.name}`, scored.utility, [
      node('destination', value.playableCount, [...value.detail]),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: ASSUMPTIONS,
  };
}


/**
 * Score entering the site the company is standing on.
 *
 * The one decision in the game where both halves are published. Entering
 * commits the company to the site's **automatic attacks** and to whatever was
 * placed on guard, before a single resource can be played (CoE 341–343) — and
 * the site card prints those attacks, with their strikes, prowess and body. So
 * this is not a guess about danger: it is `defence` run against the real thing.
 *
 * The other half is what entering unlocks, which `travel` already computes for
 * destinations: the cards in hand playable here, bounded by the characters left
 * to tap. Passing forgoes both, which is the zero this is measured against.
 *
 * On-guard cards are the estimated part. They are face down, so what is priced
 * is the chance each one is a creature at all — `beliefs`, again estimating
 * kinds rather than cards.
 */
function evaluateEnterSite(context: ModuleContext, action: GameAction): Evaluation | null {
  const companyId = (action as unknown as { companyId?: string }).companyId;
  if (!companyId) return null;
  const company = context.view.self.companies.find(c => (c.id as string) === companyId);
  if (!company) return null;
  const siteDefinitionId = company.currentSite?.definitionId;
  if (!siteDefinitionId) return null;

  const { standing, cardPool, tunables, view } = context;
  const exposure = computeExposure(view, cardPool);
  const budget = computeBudget(view, cardPool);
  const site = exposure.siteExposure(siteDefinitionId);
  if (!site) return null;

  // What entering costs: the site's own attacks, priced against this roster.
  const defence = computeDefence(view, cardPool, standing, tunables);
  const roster = rosterOf(company, view.self.characters, cardPool);
  const automatic = automaticAttacksOf(cardPool, siteDefinitionId);
  const attackHarm = defence.harmFrom(roster, automatic);

  // What entering unlocks: the cards that become playable, capped by taps.
  // Automatic attacks resolve before any resource can be played (CoE
  // 341-343), and facing one taps the defender (the model's own assumption
  // throughout `defence` — `needAgainst` never applies the stay-untapped
  // penalty). A character spent parrying is not still free to tap for a
  // resource play the same phase, so the strikes are deducted from the
  // taps on offer before pricing what they unlock.
  const strikesToFace = automatic.reduce((sum, a) => sum + a.strikes, 0);
  const taps = Math.max(0, budget.untappedIn(company.id).length - strikesToFace);
  const playable = playableAt(context, siteDefinitionId);
  const playableNow = playable.slice(0, taps);
  const realized = playableNow.reduce((sum, c) => sum + c.tsd, 0);

  // And the on-guard cards, which are face down: only the chance each is a
  // creature can be priced, not which creature it is.
  const beliefs = computeBeliefs(view, cardPool);
  const onGuard = company.onGuardCards?.length ?? 0;
  const creatureShare = beliefs.share('creature');
  const guardHarm = onGuard > 0
    ? creatureShare * defence.expectedHarm(roster, onGuard)
    : 0;

  const dtsd = netTsdDelta({ realized, tempo: attackHarm + guardHarm }, tunables);
  const outcomes: Outcome[] = [{
    p: 1,
    label: playableNow.length > 0
      ? `enter ${site.name} and play ${playableNow.map(c => c.name).join(', ')}`
      : `enter ${site.name} with nothing to play`,
    dtsd,
  }];
  const scored = standing.score(outcomes);

  const detail: Rationale[] = [
    leaf('site', `${site.name} (${site.siteType})`),
    leaf('automatic attacks', automatic.length, {
      note: automatic.length > 0
        ? automatic.map(a => `${a.strikes} strike(s) at prowess ${a.strikeProwess}`).join('; ')
        : 'none printed on the site',
    }),
    leaf('what they would cost', attackHarm, { unit: 'tsd', note: 'priced against this company' }),
    leaf('on-guard cards', onGuard, {
      note: onGuard > 0
        ? `each a ${(creatureShare * 100).toFixed(0)}% chance of being a creature`
        : 'nothing was placed',
    }),
    leaf('taps available', taps),
  ];
  for (const card of playableNow) {
    detail.push(leaf(card.name, card.tsd, {
      unit: 'tsd',
      note: `${card.marshallingPoints} ${card.source} MP, priced at the current standing`,
    }));
  }

  return {
    action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`enter ${site.name}`, scored.utility, [
      node('what entering buys and costs', dtsd, detail),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'the automatic attacks are priced as printed; a card that suppresses them — a defeated '
      + 'Dragon at its lair, a site effect — is not modelled',
      'an on-guard card is priced only as a chance of being a creature at all, at the average '
      + 'creature: which creature, and whether it is playable here, is not known',
      ...ASSUMPTIONS,
    ],
  };
}

/**
 * Score cancelling a planned movement.
 *
 * Cancelling is the exact inverse of travelling: the company stays where it
 * stands, so what it gives up is what the destination was worth. That number is
 * `destinationValue`, negated — not a separate model of staying put, because
 * two models of the same choice would eventually disagree about it.
 *
 * A regressive cancel (undoing a plan made earlier this phase) is scored the
 * same way. The engine distinguishes them because the phase state has to; the
 * position they leave the company in is identical.
 */
function evaluateCancelMovement(context: ModuleContext, action: GameAction): Evaluation | null {
  const companyId = (action as unknown as { companyId?: string }).companyId;
  if (!companyId) return null;
  const company = context.view.self.companies.find(c => (c.id as string) === companyId);
  const planned = company?.destinationSite;
  if (!company || !planned) return null;

  const exposure = computeExposure(context.view, context.cardPool);
  const budget = computeBudget(context.view, context.cardPool);
  const site = exposure.siteExposure(planned.definitionId);
  if (!site) return null;

  const value = destinationValue(context, {
    action,
    site,
    playable: playableAt(context, planned.definitionId),
    tapsAvailable: budget.untappedIn(company.id).length,
  });

  const dtsd = -value.dtsd;
  const outcomes: Outcome[] = [{
    p: 1,
    label: `stay at the current site instead of ${site.name}`,
    dtsd,
  }];
  const scored = context.standing.score(outcomes);
  return {
    action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`cancel the move to ${site.name}`, scored.utility, [
      node('what travelling was worth', value.dtsd, [...value.detail], {
        unit: 'tsd',
        note: 'cancelling gives up exactly this — the same number, with the sign flipped',
      }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'cancelling is priced as forgoing the destination; a company kept home because it is safer '
      + 'there is not credited for the hazards it avoids beyond the travel cost already counted',
      ...ASSUMPTIONS,
    ],
  };
}

/**
 * Score one declared path to an already-chosen destination.
 *
 * By this point the destination is fixed — it was planned during organization —
 * so nothing about where the company is going is still in play. What is left is
 * how much of the map it crosses to get there, and every region crossed is
 * another chance for the opponent to answer. So the whole evaluation is the
 * travel cost, and the shortest safe path wins.
 */
function evaluateDeclarePath(context: ModuleContext, action: GameAction): Evaluation | null {
  const declared = action as unknown as {
    movementType?: string;
    regionPath?: readonly string[];
  };
  const { tunables, standing } = context;
  const regions = declared.regionPath ?? [];
  const beliefs = computeBeliefs(context.view, context.cardPool);
  const threat = beliefs.holdsAtLeastOne('creature');
  const dtsd = -(regions.length * tunables.regionCrossingCost * (1 + threat));

  const outcomes: Outcome[] = [{
    p: 1,
    label: regions.length > 0
      ? `move by ${declared.movementType ?? 'movement'} across ${regions.length} region(s)`
      : `move by ${declared.movementType ?? 'movement'} with no region crossed`,
    dtsd,
  }];
  const scored = standing.score(outcomes);
  return {
    action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node('declare the path', scored.utility, [
      node('exposure of the route', dtsd, [
        leaf('movement type', declared.movementType ?? 'unknown'),
        leaf('regions crossed', regions.length, {
          note: regions.length > 0 ? regions.join(' → ') : 'none',
        }),
        leaf('cost per region', tunables.regionCrossingCost * (1 + threat), {
          unit: 'tsd',
          tunable: 'regionCrossingCost',
          note: `scaled by a ${(threat * 100).toFixed(0)}% chance the opponent holds a creature`,
        }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'the destination is already fixed by this point, so only the route is priced — what differs '
      + 'between movement types beyond the regions they cross is not modelled',
      'each region is charged the same, because `exposure` reports which regions are crossed and '
      + 'deliberately does not rank them: H1\'s hand-tuned region-danger table is the thing this '
      + 'design removed',
      ...ASSUMPTIONS,
    ],
  };
}

/**
 * The travel module. Claims a decision only when every candidate is a movement
 * plan or the option to make none — which is the organization-phase movement
 * window and nothing else.
 */
export const travelModule: H2Module = {
  name: 'travel',
  ownedActionTypes: OWNED_ACTION_TYPES,

  claims(context: ModuleContext): boolean {
    // A context gate, not a coverage check. Requiring the module to own every
    // candidate was the all-or-nothing rule restated inside the module, and it
    // silenced `travel` on every real organization phase — where movement is
    // always offered alongside transfers and influence changes.
    //
    // What it does gate on: a `pass` here means "decline to move", which is
    // only an opinion worth having when there is somewhere to go.
    return context.legalActions.some(a => a.type === 'plan-movement'
      || a.type === 'cancel-movement'
      || a.type === 'declare-path'
      || a.type === 'enter-site'
      || a.type === 'select-company');
  },

  /**
   * The plan layer's first consumer: whether anything is actually going there.
   *
   * `travel` owns every `route` step because reaching a site is a movement
   * question, and a proposer that answered it would be a second model of
   * movement — the thing this module's own header refuses on `plan-movement`
   * and `cancel-movement`. The proposer names the requirement; this decides
   * what a candidate does to it.
   *
   * Two answers. Planning the required company's movement to the plan's site
   * makes reaching it certain; entering that site completes the journey.
   * Everything else — including moving that company somewhere else — leaves
   * the step alone, because a detour delays a plan rather than killing it.
   *
   * The gap between the unrouted prior and the certainty a movement buys is
   * exactly the value of the trip — which is the number
   * `evaluateEnterSite` has never had. It prices entering as what becomes
   * playable now minus the site's attacks now, so with nothing in hand it is
   * strictly negative against `pass`, and it was measured ranking dead last on
   * every decline. The model was never wrong; it was being asked after the
   * decision that would have justified the journey was already lost.
   */
  planStepDelta(
    action: GameAction,
    plan: Plan,
    step: PlanStep,
    _stepIndex: number,
    context: ModuleContext,
  ): number | null {
    if (step.tag !== ROUTE_STEP) return null;
    const required = plan.requirements.find(r => r.kind === 'company-at-site');
    if (!required || required.kind !== 'company-at-site') return null;
    const named = (action as unknown as { companyId?: string }).companyId;
    if (named !== (required.companyId as unknown as string)) return null;

    // Entering is the moment the play becomes possible, and it was invisible
    // to the first version of this: a company standing on the plan's site
    // counted as "routed" at probability 1, so entering moved nothing, earned
    // nothing, and was priced by `evaluateEnterSite` alone — what becomes
    // playable *now* minus the site's attacks *now*, which is negative
    // whenever the hand is not already holding the card. It ranked dead last
    // on every decline, measured at a mean fractional rank of 1.00 both before
    // the plan layer and after it, which is what gave the defect away: a
    // number that does not move when you add a mechanism is a number the
    // mechanism never reached.
    if (action.type === 'enter-site') {
      const company = context.view.self.companies.find(
        c => (c.id as unknown as string) === named,
      );
      return company?.currentSite?.definitionId === required.siteDefinitionId ? 1 : null;
    }

    if (action.type !== 'plan-movement') return null;
    const destination = destinationOf(context.view, action);
    if (!destination) return null;
    if (destination.definitionId === required.siteDefinitionId) return 1;

    // Not the plan's site, but possibly nearer to it. Progress is the whole
    // point: the engine only offers destinations reachable this turn, so a
    // commitment to anywhere further can *only* be served by a staging move,
    // and a step that recognised nothing but the final hop credited none of
    // them. Recomputed with the same service and the same rate the proposer
    // used, so the two cannot disagree about the map.
    const reach = computeReach(context.cardPool);
    const distance = reach.between(destination.definitionId, required.siteDefinitionId);
    if (distance === null) return null;
    return reachProbability(distance, context.tunables.planUnroutedReachProbability);

  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'select-company') return evaluateSelectCompany(context, action);
    if (action.type === 'enter-site') return evaluateEnterSite(context, action);
    if (action.type === 'cancel-movement') return evaluateCancelMovement(context, action);
    if (action.type === 'declare-path') return evaluateDeclarePath(context, action);
    const budget = computeBudget(context.view, context.cardPool);
    const exposure = computeExposure(context.view, context.cardPool);

    if (action.type === 'pass') {
      // Staying put banks nothing and costs nothing — the baseline every
      // destination is measured against.
      const outcomes: Outcome[] = [{ p: 1, label: 'stay where the company stands', dtsd: 0 }];
      const scored = context.standing.score(outcomes);
      return {
        action,
        module: 'travel',
        outcomes,
        expectedTsd: scored.expectedTsd,
        sigmaTsd: scored.sigmaTsd,
        utility: scored.utility,
        method: scored.method,
        rationale: node('stay put', scored.utility, [
          leaf('moved', 0, { note: 'no travel tempo spent, nothing unlocked' }),
          scored.rationale,
        ], { unit: 'winprob' }),
        assumptions: ASSUMPTIONS,
      };
    }

    const destination = destinationOf(context.view, action);
    if (!destination) return null;
    const site = exposure.siteExposure(destination.definitionId);
    if (!site) return null;

    const companyId = (action as unknown as { companyId?: string }).companyId;
    const taps = companyId
      ? budget.untappedIn(companyId as never).length
      : budget.tapsAvailable;

    return evaluateDestination(context, {
      action,
      site,
      playable: playableAt(context, destination.definitionId),
      tapsAvailable: taps,
    });
  },
};

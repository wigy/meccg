/**
 * @module ai/h2/services/event-value
 *
 * What an event does, read off the effect DSL.
 *
 * Lifted out of the `events` module because a second consumer needs the same
 * number and a second copy would be a second opinion. `card-price` prices a
 * hazard creature by its contribution to `hazard-plan`; every other card
 * without marshalling points — hazard events, resource events, corruption
 * cards — it priced at the flat floor, because there was nowhere to ask what
 * an event was worth.
 *
 * The corpus says that gap is expensive. Over 196 recorded discard decisions
 * where a human and the agent both discarded, the human threw a resource or
 * hazard *event* 44 times against the agent's 17 — and once every unpriceable
 * card was floored to the same value, which card the agent threw among them
 * became arbitrary, measured as discard agreement falling from 15.8% to 6.6%
 * and refusing to move at any floor between 1.0 and 0.1. A floor cannot
 * discriminate; only a valuation can.
 *
 * Two questions, one model. `forAction` answers what an event achieves when
 * played at a *named* target, which is what `events` scores. `held` answers
 * what it would achieve at the best target available, which is what a card in
 * hand is worth to keep. Sharing the effect reading between them is the point:
 * a card the agent would pay to play and refuses to keep is an incoherence
 * nothing in the output would explain.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, ModuleContext, Outcome, Rationale } from '../core/types.js';
import type { MpSource } from '../core/tsd.js';
import { netTsdDelta } from '../core/tsd.js';
import { leaf, node } from '../core/rationale.js';
import { scoredEvaluation } from '../core/evaluation.js';
import { namedCharacter, namedDiscardTarget } from '../core/action-fields.js';
import { computeBeliefs } from './beliefs.js';
import { computeDefence, hazardSlots } from './defence.js';
import { computeDrawValue } from './draw-value.js';
import { rosterOf } from './strike/prowess.js';
import type { StrikeTarget } from './strike/prowess.js';

/** A declared effect, as far as this module reads one. */
export interface Effect {
  readonly type?: string;
  readonly from?: string | readonly string[];
  readonly to?: string;
  readonly count?: number;
  readonly filter?: Filter;
  readonly constraint?: string;
  readonly cost?: { readonly tap?: string };
  readonly apply?: Effect;
}

/** A DSL filter, as far as this module reads one. */
export type Filter = Readonly<Record<string, unknown>>;

/** What an event would achieve, and the reading that produced it. */
export interface EventGain {
  readonly tsd: number;
  readonly reason: string;
}

/**
 * Effect types that declare *how* a card may be played, not what it does.
 *
 * Deliberately short and deliberately conservative. A card whose whole effect
 * list is drawn from this set changes nothing when it resolves — that is a
 * statement about the DSL, not a judgement about the card — and anything not
 * listed here is treated as a real effect, so an unfamiliar type makes the
 * module decline rather than claim the card is worthless.
 */
const DECLARATION_ONLY = new Set([
  'play-flag',
  'play-window',
  'play-condition',
  'play-restriction',
  'duplication-limit',
  'deck-restriction',
  'name-alias',
]);

/**
 * The constraint that shuts a company to creatures for the turn.
 *
 * Stealth is the most-offered short event in the game by a wide margin — 150 of
 * 276 appearances in three self-play games — and this is what it does: "No
 * creature hazards may be played on his company this turn." That is not a
 * card-specific effect this module has to guess at. It is the whole of the
 * opponent's hazard plan against one company, and `defence` already computes
 * exactly that.
 */
const NO_CREATURES = 'no-creature-hazards-on-company';

/** Whether an effect's `from` names a zone, however it is written. */
function fromIncludes(effect: Effect, zone: string): boolean {
  const from = effect.from;
  if (typeof from === 'string') return from === zone;
  return Array.isArray(from) && from.includes(zone);
}

/**
 * Whether a card could be what a filter is asking for.
 *
 * Deliberately three-valued in effect: an operator or key this does not know
 * returns `true`, so an unread filter makes the module assume there *is* a
 * target and decline. The alternative — assuming no target — would let it
 * announce that a card does nothing on the strength of a filter it could not
 * read, which is exactly the mistake this replaced.
 */
function couldMatch(filter: Filter | undefined, def: CardDefinition | undefined): boolean {
  if (!filter) return true;
  const card = def as unknown as {
    cardType?: string; eventType?: string; keywords?: readonly string[];
  } | undefined;
  if (!card) return true;

  /** Whether a value the filter names is satisfied by a field on the card. */
  const satisfies = (expected: unknown, actual: string | undefined): boolean => {
    if (typeof expected === 'string') return expected === actual;
    const operators = expected as { $in?: readonly string[] } | null;
    if (operators && Array.isArray(operators.$in)) return operators.$in.includes(actual ?? '');
    return true;
  };

  for (const [key, value] of Object.entries(filter)) {
    switch (key) {
      case '$and':
        if (!(value as Filter[]).every(clause => couldMatch(clause, def))) return false;
        break;
      case '$not':
        if (couldMatch(value as Filter, def)) return false;
        break;
      case 'cardType':
        if (!satisfies(value, card.cardType)) return false;
        break;
      case 'eventType':
        if (!satisfies(value, card.eventType)) return false;
        break;
      case 'keywords': {
        const includes = (value as { $includes?: string } | null)?.$includes;
        if (typeof includes !== 'string') break;
        if (!(card.keywords ?? []).includes(includes)) return false;
        break;
      }
      // An operator this does not know: assume it could match, so the caller
      // declines rather than declaring the card useless.
      default:
        break;
    }
  }
  return true;
}

/** Whether anything on the board could be what a removal is aimed at. */
function hasRemovalTarget(removal: Effect, context: ModuleContext): boolean {
  const { view, cardPool } = context;
  const zones = [view.self.cardsInPlay, view.opponent.cardsInPlay];
  for (const zone of zones) {
    for (const card of zone) {
      if (couldMatch(removal.filter, cardPool[card.definitionId])) return true;
    }
  }
  // Hazards attached to characters are in play too, on either side.
  for (const characters of [view.self.characters, view.opponent.characters]) {
    for (const character of Object.values(characters)) {
      for (const hazard of character.hazards) {
        if (couldMatch(removal.filter, cardPool[hazard.definitionId])) return true;
      }
    }
  }
  return false;
}

/**
 * Locates an in-play instance across both the free-standing `cardsInPlay`
 * zone and hazards attached to characters, on either side, mirroring
 * {@link hasRemovalTarget}. Null when the instance is not in either.
 *
 * `attached` matters beyond bookkeeping: a free-standing card in either
 * zone is priced correctly regardless of whose zone lists it, because
 * `defence` already measures its effect on *our* companies directly — a
 * hazard event the opponent played still boosts attacks on us no matter
 * whose bucket the engine happens to file it under. A hazard attached to a
 * character is different: `defence` has no model for what it does to that
 * character (corruption, say), so the only provable fact about it is *whose*
 * character carries it — the corruption of a character we do not control
 * cannot be a benefit to us, whatever it is.
 */
function findInPlay(
  view: ModuleContext['view'],
  instanceId: CardInstanceId,
): { readonly ours: boolean; readonly attached: boolean; readonly definitionId: string } | null {
  const self = view.self.cardsInPlay.find(c => c.instanceId === instanceId);
  if (self) return { ours: true, attached: false, definitionId: self.definitionId as string };
  const opponent = view.opponent.cardsInPlay.find(c => c.instanceId === instanceId);
  if (opponent) return { ours: false, attached: false, definitionId: opponent.definitionId as string };
  for (const character of Object.values(view.self.characters)) {
    const hazard = character.hazards.find(h => h.instanceId === instanceId);
    if (hazard) return { ours: true, attached: true, definitionId: hazard.definitionId as string };
  }
  for (const character of Object.values(view.opponent.characters)) {
    const hazard = character.hazards.find(h => h.instanceId === instanceId);
    if (hazard) return { ours: false, attached: true, definitionId: hazard.definitionId as string };
  }
  return null;
}

/** Every effect the card declares, including the ones nested under `apply`. */
function flatten(effects: readonly Effect[]): Effect[] {
  return effects.flatMap(effect => (effect.apply ? [effect, ...flatten([effect.apply])] : [effect]));
}

/**
 * The company a `play-target: character` action is aimed at, from our own seat.
 *
 * Stealth taps a scout to protect *his* company, so the action names the
 * character and the value is about the company he is in.
 *
 * It names him in `targetScoutInstanceId`, though — not the `targetCharacterId`
 * other character-targeting short events use. Reading one field where the
 * engine keeps the answer in another has now caused six bugs here, so the
 * spellings live in `core/action-fields` rather than in each module's guess.
 */
function targetCompanyRoster(
  action: GameAction,
  context: ModuleContext,
): { roster: readonly StrikeTarget[]; size: number } | null {
  const targetId = namedCharacter(action);
  if (!targetId) return null;
  const company = context.view.self.companies.find(c => c.characters.includes(targetId));
  if (!company) return null;
  return {
    roster: rosterOf(company, context.view.self.characters, context.cardPool),
    size: company.characters.length,
  };
}

/** What an event is worth if it resolves, or null when the family is unknown. */
export function gainOf(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const { tunables } = context;

  // Shutting a company to creatures for the turn is worth the whole hazard plan
  // the opponent would otherwise aim at it — which is what `defence` computes,
  // against the creatures this opponent has actually shown.
  if (flatten(effects).some(e => e.type === 'add-constraint' && e.constraint === NO_CREATURES)) {
    const target = targetCompanyRoster(action, context);
    if (!target) return null;
    const defence = computeDefence(context.view, context.cardPool, context.standing, tunables);
    const harm = defence.expectedHarm(target.roster, hazardSlots(target.size));
    // Shutting a company to creatures is worth what the opponent *would* have
    // aimed at it, which is nothing if they hold no creature to aim.
    //
    // The unscaled figure assumed they will always spend a full hazard limit on
    // this company, and `travel` already prices the identical risk the other
    // way — `pathLength * regionCrossingCost * (1 + holdsAtLeastOne)`. Two
    // models of one thing, and this was the optimistic one: measured against
    // the recorded corpus, `play-short-event` is what the agent does instead of
    // passing 88 times in eight games, all in the movement/hazard phase where
    // its agreement with a human's `pass` is 15.9%.
    const beliefs = computeBeliefs(context.view, context.cardPool);
    const threat = beliefs.holdsAtLeastOne('creature');
    return {
      tsd: harm * threat,
      reason: `no creature may be played on that company this turn — ${(harm * threat).toFixed(1)} `
        + `of harm they cannot aim at its ${target.size} character(s), at a `
        + `${(threat * 100).toFixed(0)}% chance they hold a creature at all `
        + `(${(beliefs.confidence * 100).toFixed(0)}% confidence, ${beliefs.observed} cards seen)`,
    };
  }

  // Cards drawn straight off the deck — Dark Tryst (as-80) draws three. The
  // whole point of the card, and previously unreadable: `gainOf` knew three
  // effect families and this was not one of them, so the card fell to the flat
  // floor alongside a card whose text the DSL has not been taught at all.
  const drawing = flatten(effects).find(e => e.type === 'draw-cards');
  if (drawing) {
    const cards = drawing.count ?? 1;
    // A draw stops at deck exhaustion, and the deck is the one zone whose size
    // the view reports honestly even though its contents are hidden.
    const available = Math.min(cards, context.view.self.playDeck.length);
    return {
      tsd: available * tunables.resourceDrawValue,
      reason: available === cards
        ? `${cards} card(s) drawn, at what a draw is worth`
        : `${available} card(s) drawn — the deck holds only that many`,
    };
  }

  // A draw-modifier pays on the companies that are *moving*, once per company,
  // and only for as long as it is in play. `draw-value` computes the difference
  // the card makes against the movement already planned this turn, which is the
  // exact number for a long event played after the plan is declared.
  if (flatten(effects).some(e => e.type === 'draw-modifier')) {
    const draws = computeDrawValue(context.view, context.cardPool, tunables);
    const moving = draws.movingCompanies();
    const extra = draws.extraFrom(flatten(effects));
    if (moving.length === 0) {
      return {
        tsd: 0,
        reason: 'it adds cards only to a company that draws, and nothing is moving this turn',
      };
    }
    return {
      tsd: extra * tunables.resourceDrawValue,
      reason: `${extra} extra card(s) across ${moving.length} moving company(ies) `
        + `(${moving.map(m => `${m.site.name}: ${m.site.pathLength} region(s)`).join('; ')})`,
    };
  }

  const recovery = effects.find(e => e.type === 'move' && (e.to === 'hand' || e.to === 'deck'));
  if (recovery) {
    const cards = recovery.count ?? 1;
    return {
      tsd: cards * tunables.resourceDrawValue,
      reason: `${cards} card(s) back to ${recovery.to}, at what a draw is worth — a floor, since `
        + 'the card is chosen rather than drawn',
    };
  }

  const removal = effects.find(e => e.type === 'move'
    && e.to === 'discard'
    && (fromIncludes(e, 'in-play') || String(e.from ?? '').startsWith('attached')));
  if (removal) {
    // With nothing to reach, the play resolves for nothing, and that is a fact.
    if (!hasRemovalTarget(removal, context)) {
      return { tsd: 0, reason: 'there is nothing in play it could discard' };
    }
    // With something to reach, the card is worth what *that* card was doing.
    // One thing it might be doing is declared: a hazard event that makes every
    // attack stronger. Anything else this module still cannot price.
    return reliefFromRemoval(removal, context, action);
  }

  return null;
}

/**
 * What discarding the reachable card this action actually names is worth, or
 * null.
 *
 * The only thing a card in play does that this module can price is what
 * `defence` already prices from the other direction: a hazard event declaring a
 * modifier on every attack. Minions Stir gives the Orcs coming at our companies
 * +1 strike and +1 prowess each, so taking it off the board is worth the harm it
 * stops — summed over our companies, each facing its own size in hazards, which
 * is the same convention `characters` compares company shapes with.
 *
 * Marvels Told, Voices of Malice, Ancient Secrets and The Cock Crows each
 * enumerate one `play-short-event` action per eligible target, on either
 * side of the table — the engine's legal-action generator does not restrict
 * these to a player's own hazards, and correctly so, but the engine, not a
 * later sub-flow, has already picked which card this specific action reaches
 * (`namedDiscardTarget`). Every one of those actions must be priced by *that*
 * card, not by whichever reachable card would be best. A module that priced
 * "the best reachable card" for all of them alike used to hand every one of
 * those actions the same score, including the ones that reach a hazard
 * *attached to a character on the opponent's side* — discarding one of those
 * relieves the opponent's character, not our companies, and `defence` has no
 * model of that character-specific effect to price it by, so it is a proven
 * zero rather than a guess.
 *
 * A free-standing card in either zone (Minions Stir, say) is priced by
 * `defence` directly regardless of whose zone lists it — a hazard event the
 * opponent played still boosts attacks on us no matter whose bucket the
 * engine files it under, so there is no ownership override for that case.
 * A target on our own side (or a free-standing one either side) whose relief
 * this cannot price still declines — that is the same "cannot price it"
 * honesty as before, just now scoped to the right card. A sweep-mode effect
 * (Wizard's River-horses) names no single target, so it falls back to
 * pricing the best reachable match across both sides — the sweep takes all
 * of them, wherever they are.
 */
function reliefFromRemoval(
  removal: Effect,
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const { view, cardPool, standing, tunables } = context;
  const defence = computeDefence(view, cardPool, standing, tunables);
  const companies = view.self.companies.map(company => ({
    roster: rosterOf(company, view.self.characters, cardPool),
    size: company.characters.length,
  }));
  const now = companies.reduce((sum, c) => sum + defence.expectedHarm(c.roster, hazardSlots(c.size)), 0);
  const reliefFrom = (instanceId: string): number => now - companies.reduce(
    (sum, c) => sum + defence.harmWithout(instanceId, c.roster, hazardSlots(c.size)), 0,
  );

  const target = namedDiscardTarget(action);
  if (target) {
    const located = findInPlay(view, target);
    if (located?.attached && !located.ours) {
      return { tsd: 0, reason: 'attached to a character we do not control — discarding it relieves the '
        + 'opponent, not us' };
    }
    const relief = reliefFrom(target as string);
    if (relief <= 0) return null;
    const def = located ? cardPool[located.definitionId] : undefined;
    const name = (def as unknown as { name?: string } | undefined)?.name ?? (target as string);
    return {
      tsd: relief,
      reason: `discarding ${name} takes ${relief.toFixed(1)} of harm off our companies — `
        + 'the attacks it was strengthening go back to their printed numbers',
    };
  }

  // Sweep mode: no single named target, so price the best reachable match —
  // the effect takes all of them regardless.
  let best: { relief: number; name: string } | null = null;
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      const def = cardPool[card.definitionId];
      if (!couldMatch(removal.filter, def)) continue;
      const relief = reliefFrom(card.instanceId as string);
      if (relief > 0 && (!best || relief > best.relief)) {
        best = {
          relief,
          name: (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string),
        };
      }
    }
  }
  if (!best) return null;
  return {
    tsd: best.relief,
    reason: `discarding ${best.name} takes ${best.relief.toFixed(1)} of harm off our companies — `
      + 'the attacks it was strengthening go back to their printed numbers',
  };
}

/** Whether anything the card declares will change the game when it resolves. */
export function declaresAnEffect(effects: readonly Effect[]): boolean {
  return flatten(effects).some(effect => !DECLARATION_ONLY.has(effect.type ?? ''));
}


/**
 * What an event in hand would achieve if it were played at its best target.
 *
 * The holding question, as against `gainOf`'s playing question. It is the same
 * reading of the same effects — a card the agent would pay to play and refuses
 * to keep is an incoherence nothing in the output would explain — with the one
 * part that needs a decision replaced: a played event names its target, and a
 * held one is worth whatever the best target available would make it worth.
 *
 * "Best" is the largest of our own companies for a protective effect, because
 * that is the one with most to lose and the one `defence` prices highest. That
 * is an optimistic reading, and it is the right sign of optimistic: the value
 * of *keeping* a card is the value of its best use, not its average one.
 *
 * Returns null for a family this cannot read, exactly as `gainOf` does. A
 * caller must treat that as "no opinion" and fall back to its floor — charging
 * zero for an unreadable card would make every event in the game the first
 * thing discarded, which is the failure this service exists to fix, inverted.
 */
export function heldGain(
  definitionId: string,
  context: ModuleContext,
): EventGain | null {
  const def = context.cardPool[definitionId];
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  if (!declaresAnEffect(effects)) {
    return { tsd: 0, reason: 'declares no effect this engine will execute' };
  }
  // The largest of our own companies stands in for the target a played event
  // would name. `gainOf` reads it off the action; there is no action here.
  const biggest = [...context.view.self.companies]
    .sort((a, b) => b.characters.length - a.characters.length)[0];
  const stand = biggest === undefined
    ? undefined
    : ({ companyId: biggest.id, characterInstanceId: biggest.characters[0] } as unknown as GameAction);
  return stand === undefined ? null : gainOf(effects, context, stand);
}


/** What every event evaluation assumes, whatever module signs it. */
const EVENT_ASSUMPTIONS: readonly string[] = [
  'an event is priced by the *family* of effect it declares, not by its text: a card that '
  + 'also restricts, cancels or enables something is under-valued here',
  'the play is assumed to cost only the card; a tap or discard the event also demands is not '
  + 'charged',
  'a card whose declared effects only say how it may be played is scored as doing nothing — '
  + 'true of this engine, and wrong about the printed card whenever the DSL is behind the text',
  'whether a removal has a target is decided by the filter keys this module reads (card type, '
  + 'event type, keywords); a filter it cannot read is assumed to have one, so the card is '
  + 'declined rather than called useless',
  'a long or permanent event is credited only for what it achieves *this* turn; one whose effect '
  + 'would pay again on a later turn is under-valued, and one played before the movement plan is '
  + 'declared is priced against a plan that may still change',
  'a card that swaps the whole hand for a fresh one (Favor of the Valar, `new-hand`) is '
  + 'declined rather than priced: it draws no *net* cards, and what the swap is worth is the '
  + 'difference between this hand and an average one — which is `card-price`\'s question, and '
  + 'asking it from here would be a cycle',
];

/** What crediting a permanent event's printed points assumes. */
const PERMANENT_ASSUMPTIONS: readonly string[] = [
  'a permanent event\'s printed points are scored as though the card simply stays in play; a '
  + 'card that can be discarded, cancelled or removed later is over-valued by exactly that risk',
];

/**
 * Score playing one event from hand, by what its declared effects achieve.
 *
 * The whole of what `events` does with a card, made callable, because a second
 * module needs the same answer about the same kind of card. `stage` owns
 * `play-permanent-event` for the stage resources it can recognise, and a
 * permanent event is otherwise an event like any other: same zone, same DSL,
 * same shadow price for the card it spends. Declining those left them
 * **unrankable** rather than merely unpriced — the registry drops a candidate
 * its owner returns null for, so H2 could not play a non-stage permanent event
 * at all. Over six recorded human games it was offered 38 times, taken by the
 * human 13 of them and by H2 none.
 *
 * Returns null for a family this cannot read, which is the honest outcome and
 * the one the caller must pass on: charging for the card and crediting nothing
 * would make H2 refuse every event in the game.
 */
export function declaredEventEvaluation(
  action: GameAction,
  context: ModuleContext,
  module: string,
  options: { readonly creditPoints?: boolean } = {},
): Evaluation | null {
  const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
  if (!instanceId) return null;
  const card = context.view.self.hand.find(c => c.instanceId === instanceId);
  if (!card) return null;

  const def = context.cardPool[card.definitionId];
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  // A card whose whole effect list declares how it may be played, and nothing
  // that happens when it resolves, does nothing when it resolves. That is a
  // reading of the DSL rather than a judgement about the card, and it is the
  // one case where charging for the card is an opinion rather than a guess.
  const gain = declaresAnEffect(effects)
    ? gainOf(effects, context, action)
    : {
      tsd: 0,
      reason: 'the card declares no effect this engine will execute — only how it may be played',
    };
  const { standing, tunables } = context;

  // A permanent event stays in play, so its printed marshalling points are
  // scored the moment it lands — like an item or a faction, and unlike a short
  // event, which is in the discard pile before anything is counted. That is a
  // reading of where the card goes, so it is offered only to the callers whose
  // card goes there.
  const printed = def as unknown as { marshallingPoints?: number; marshallingCategory?: string } | undefined;
  const mp = options.creditPoints === true ? printed?.marshallingPoints ?? 0 : 0;
  const source = (printed?.marshallingCategory ?? 'misc') as MpSource;
  const points = mp > 0 ? standing.tsdAfter({ [source]: mp }) - standing.tsd : 0;

  // A family this cannot read is declined, not charged. Charging for the card
  // and crediting nothing would make H2 refuse every event in the game, which
  // is worse than having no opinion about them — unless the card carries
  // points, which is something read off the card rather than out of its text,
  // and enough to rank it.
  if (!gain && mp === 0) return null;
  // The card is charged at the *spending* price, not at what it is worth to
  // hold. Those became the same number when `card-price` learned to value
  // events, and for a single-use event they must not be: the reservation
  // value of keeping this card is the value of playing it, so charging it
  // against its own gain cancels — the whole reason moving `hazards` onto
  // the held price achieved nothing measurable. A shadow price is an
  // opportunity cost only when it prices the *next-best* use.
  const spent = tunables.provisionalCardPrice;
  const name = (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string);

  const does = gain?.tsd ?? 0;
  const reason = gain?.reason ?? `${mp} ${source} MP, and an effect family this cannot read`;
  const dtsd = netTsdDelta({ realized: does + points, tempo: spent }, tunables);
  const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${reason}`, dtsd }];

  const detail: Rationale[] = [
    leaf('event', name),
    leaf('what it does', does, { unit: 'tsd', note: reason }),
  ];
  if (mp > 0) {
    detail.push(leaf('points it puts on the table', points, {
      unit: 'tsd',
      note: `${mp} ${source} MP, at the standing this play would create — a permanent event `
        + 'stays in play, so they are scored now',
    }));
  }
  detail.push(leaf('the card it spends', spent, {
    unit: 'tsd',
    tunable: 'provisionalCardPrice',
    note: 'the spending price — what it is worth to hold is a different question',
  }));

  return scoredEvaluation({
    action,
    module,
    outcomes,
    standing,
    headline: `play ${name}`,
    detail: [node('the event', does + points - spent, detail, { unit: 'tsd' })],
    assumptions: mp > 0 ? [...EVENT_ASSUMPTIONS, ...PERMANENT_ASSUMPTIONS] : EVENT_ASSUMPTIONS,
  });
}

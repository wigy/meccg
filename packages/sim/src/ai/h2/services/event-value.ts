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

import { Phase, ownerOf } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, ModuleContext, Outcome, Rationale } from '../core/types.js';
import type { MpSource } from '../core/tsd.js';
import { netTsdDelta } from '../core/tsd.js';
import { leaf, node } from '../core/rationale.js';
import { pAtLeast } from '../core/dice.js';
import { scoredEvaluation } from '../core/evaluation.js';
import { namedCharacter, namedDiscardTarget } from '../core/action-fields.js';
import { computeBeliefs } from './beliefs.js';
import { computeCharacterValue } from './character-value.js';
import { computeDefence, hazardSlots } from './defence.js';
import { computeDrawValue } from './draw-value.js';
import { inPlayNamed, withoutInPlay } from './attack-modifiers.js';
import { unseenDeckCards } from './deck-reach.js';
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
  readonly id?: string;
  readonly check?: string;
  readonly value?: number;
  readonly valueExpr?: string;
  readonly event?: string;
  readonly when?: unknown;
  readonly target?: string;
  readonly modifier?: number;
  readonly select?: string;
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
export function couldMatch(filter: Filter | undefined, def: CardDefinition | undefined): boolean {
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

/**
 * What a `check-modifier` on a pending corruption check is worth — A Friend or
 * Three (tw-189)'s corruption option: "+1 for each character in his company".
 *
 * Undefined (`undefined`, not null) when the chosen play option is not this
 * family, so the caller reads the card's other families as before. The check
 * itself is on the table beside the play — a `corruption-check` naming the
 * same character, or the Free Council's `pendingCheck` — and its published
 * `need` is the whole input: the bonus is worth the mass it moves out of the
 * failing band. Unpriced, the event was declined, and the modular AI rolled
 * the check where the winning human (game mv741tp6-ai5cnz) played the card
 * three times, once at the Free Council.
 */
function corruptionBoostGain(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null | undefined {
  const fields = action as unknown as { optionId?: string; targetCharacterId?: CardInstanceId };
  const option = effects.find(e => e.type === 'play-option' && e.id === fields.optionId);
  const apply = option?.apply;
  if (!apply || apply.type !== 'add-constraint' || apply.constraint !== 'check-modifier'
    || apply.check !== 'corruption') return undefined;
  const characterId = fields.targetCharacterId;
  if (!characterId) return null;

  const { view } = context;
  const company = view.self.companies.find(c => c.characters.includes(characterId));
  const boost = apply.valueExpr === 'company.characterCount' ? company?.characters.length
    : apply.valueExpr === undefined ? apply.value : undefined;
  if (boost === undefined) return null;

  const offered = context.legalActions.find(a => a.type === 'corruption-check'
    && (a as unknown as { characterId?: CardInstanceId }).characterId === characterId) as unknown as
    { need?: number } | undefined;
  const pending = view.phaseState.phase === Phase.FreeCouncil ? view.phaseState.pendingCheck : undefined;
  const need = offered?.need
    ?? (pending?.characterId === characterId ? pending.need - pending.supportCount : undefined);
  if (typeof need !== 'number') return null;

  const value = computeCharacterValue(view, context.cardPool, context.standing, context.tunables);
  return value.checkBoost(characterId, need, boost);
}

/**
 * The most valuable card a recovery could bring back from our own sideboard or
 * discard pile, by its marshalling points at this standing.
 *
 * Deliberately not `card-price`'s `quote`: `card-price` reads held events
 * through this module, so quoting from here could recurse through one
 * recovery event fetching another. Points are the part of a card's worth that
 * is certain to be on offer; a card with none is left to the draw floor.
 */
function bestRecoverable(recovery: Effect, context: ModuleContext): { name: string; tsd: number } | null {
  const { view, cardPool, standing } = context;
  const pools = [
    ...(fromIncludes(recovery, 'sideboard') ? view.self.sideboard : []),
    ...(fromIncludes(recovery, 'discard') ? view.self.discardPile : []),
  ];
  let best: { name: string; tsd: number } | null = null;
  for (const card of pools) {
    const def = cardPool[card.definitionId];
    if (!def || !couldMatch(recovery.filter, def)) continue;
    const printed = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const mp = printed.marshallingPoints ?? 0;
    if (mp <= 0) continue;
    const tsd = standing.tsdAfter({ [(printed.marshallingCategory ?? 'misc') as MpSource]: mp }) - standing.tsd;
    if (best === null || tsd > best.tsd) best = { name: printed.name ?? (card.definitionId as string), tsd };
  }
  return best;
}

/** The influence bonus a `check-modifier` option grants, or undefined when it cannot be read. */
function influenceBonusOf(
  apply: Effect,
  characterId: CardInstanceId,
  context: ModuleContext,
): number | undefined {
  const { view, cardPool } = context;
  if (apply.valueExpr === undefined) return apply.value;
  if (apply.valueExpr === 'company.characterCount') {
    return view.self.companies.find(c => c.characters.includes(characterId))?.characters.length;
  }
  // Muster (tw-288): the warrior's prowess, to a maximum of +5.
  const capped = /^min\(target\.baseProwess, (\d+)\)$/.exec(apply.valueExpr);
  if (capped) {
    const character = view.self.characters[characterId];
    const prowess = (cardPool[character?.definitionId as string] as unknown as { prowess?: number } | undefined)?.prowess;
    return typeof prowess === 'number' ? Math.min(prowess, Number(capped[1])) : undefined;
  }
  return undefined;
}

/**
 * What a `check-modifier` on the influence attempt waiting on the chain is
 * worth — Muster, A Friend or Three, New Friendship, Gifts as Given of Old.
 *
 * Undefined when the chosen option is not this family. The attempt is on the
 * chain, and the engine previews its roll there (non-viable, so no agent can
 * take it, but its `need` is the published target). The bonus is worth the
 * probability it moves across that target, times what the attempt stakes: the
 * faction's points at this standing, and the card a failed attempt discards.
 * A boost already declared on the chain for the same character is not in the
 * preview yet, so it is subtracted first — otherwise a second Muster would be
 * priced against a check the first has already improved.
 *
 * Credited only when the target is the character making the attempt: the
 * engine offers these on any eligible character, and on anyone else the bonus
 * lands on a check nobody makes. Unpriced, the events were declined and the
 * decision fell back to a pass: over the recent rated corpus, strong players
 * played one before the roll 18 times where the modular AI passed.
 */
function influenceBoostGain(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null | undefined {
  const fields = action as unknown as { optionId?: string; targetCharacterId?: CardInstanceId };
  const option = effects.find(e => e.type === 'play-option' && e.id === fields.optionId);
  const apply = option?.apply;
  if (!apply || apply.type !== 'add-constraint' || apply.constraint !== 'check-modifier'
    || apply.check !== 'influence') return undefined;

  const { view, cardPool, standing, tunables } = context;
  const roll = view.legalActions.map(e => e.action).find(a => a.type === 'faction-influence-roll') as unknown as {
    need?: number; influencingCharacterId?: CardInstanceId; factionInstanceId?: CardInstanceId;
  } | undefined;
  if (!roll || typeof roll.need !== 'number' || !roll.influencingCharacterId) return null;
  const characterId = fields.targetCharacterId;
  if (characterId !== roll.influencingCharacterId) {
    return { tsd: 0, reason: 'the bonus would land on a character who is not making the influence check' };
  }
  const bonus = influenceBonusOf(apply, characterId, context);
  if (bonus === undefined) return null;

  // Boosts already declared for this character, still waiting on the chain.
  let declared = 0;
  for (const entry of view.chain?.entries ?? []) {
    const payload = entry.payload as unknown as { type?: string; targetCharacterId?: CardInstanceId; optionId?: string };
    if (entry.resolved || entry.negated || payload.type !== 'short-event' || payload.targetCharacterId !== characterId) continue;
    const pending = ((cardPool[entry.card?.definitionId as string] as unknown as { effects?: readonly Effect[] } | undefined)
      ?.effects ?? []).find(e => e.type === 'play-option' && e.id === payload.optionId)?.apply;
    if (pending?.constraint !== 'check-modifier' || pending.check !== 'influence') continue;
    declared += influenceBonusOf(pending, characterId, context) ?? 0;
  }

  const need = roll.need - declared;
  const pWithout = need <= 2 ? 1 : pAtLeast(need);
  const pWith = need - bonus <= 2 ? 1 : pAtLeast(need - bonus);
  const factionCard = view.chain?.entries.find(e => e.card?.instanceId === roll.factionInstanceId)?.card;
  const mp = (cardPool[factionCard?.definitionId as string] as unknown as { marshallingPoints?: number } | undefined)
    ?.marshallingPoints ?? 0;
  const stake = (mp > 0 ? standing.tsdAfter({ faction: mp }) - standing.tsd : 0) + tunables.provisionalCardPrice;
  const tsd = (pWith - pWithout) * stake;
  return {
    tsd,
    reason: `+${bonus} to the influence check (need ${need} → ${Math.max(2, need - bonus)}): `
      + `${((pWith - pWithout) * 100).toFixed(1)}% more chance of ${mp} faction MP and of keeping the card`,
  };
}

/** What an event is worth if it resolves, or null when the family is unknown. */
export function gainOf(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const { tunables } = context;

  const boost = corruptionBoostGain(effects, context, action);
  if (boost !== undefined) return boost;
  const influence = influenceBoostGain(effects, context, action);
  if (influence !== undefined) return influence;

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
    // …but only if the cards are still there to use. The movement/hazard
    // phase resets the hand to hand size after every company (step 8b draws
    // up and discards down), and so does the end of turn (CoE 2.VI.ii); no
    // resource is played before that reset from the long-event phase, inside
    // movement/hazard, or in the end-of-turn steps before it. A draw there
    // ends on the same eight cards either way: it gains nothing but a look at
    // a few more, and spends the event to get it. Humans know this — offered
    // Dark Tryst in the recorded games, they played it in 1.3% of long-event,
    // 5.1% of movement/hazard and 1.3% of end-of-turn discard windows, against
    // 14–19% in organization, the site phase and after the end-of-turn reset,
    // where the cards are kept.
    const phaseState = context.view.phaseState as { phase: string; step?: string };
    const resetPending = phaseState.phase === Phase.LongEvent
      || phaseState.phase === Phase.MovementHazard
      || (phaseState.phase === Phase.EndOfTurn && phaseState.step !== 'signal-end');
    if (resetPending) {
      return {
        tsd: 0,
        reason: `${cards} card(s) drawn, but the hand is reset to hand size before any of them `
          + 'can be played — a look at more cards, not more cards',
      };
    }
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
    const chosen = bestRecoverable(recovery, context);
    // The card is chosen rather than drawn, so the best one on offer is what
    // comes back: its points at this standing, discounted as potential because
    // it still has to be played. A recovery to the *deck* shuffles it in
    // rather than handing it over, so it has to be drawn before it can be
    // played at all, and the discount applies once for each step. A draw is
    // the floor.
    // Smoke Rings fetching a 3-MP item from the sideboard came out at exactly
    // the card it spends, tied with a pass, and the agent never played it
    // where strong players played it 29 times in the recent rated corpus.
    // One discount for both destinations overshot the other way: a 5-MP stage
    // card shuffled into the deck outbid playing an ally for a point now, in
    // the recorded position `site/allies-from-discard` where the winning human
    // played the allies.
    const steps = recovery.to === 'deck' ? 2 : 1;
    const potential = tunables.potentialDiscount ** steps * (chosen?.tsd ?? 0);
    const each = Math.max(tunables.resourceDrawValue, potential);
    return {
      tsd: cards * each,
      reason: chosen && each > tunables.resourceDrawValue
        ? `${cards} card(s) back to ${recovery.to} — the best on offer is ${chosen.name}, `
          + `${chosen.tsd.toFixed(1)} at this standing, discounted as potential`
          + (steps === 2 ? ' twice, since it still has to be drawn' : '')
        : `${cards} card(s) back to ${recovery.to}, at what a draw is worth — a floor, since `
          + 'the card is chosen rather than drawn',
    };
  }

  // A permanent event's sweep happens as it enters play — Gates of Morning
  // discarding every hazard environment — so it is read under its trigger too.
  // Other triggers (end of turn, a later event) are not the play's effect.
  const onEntry = effects.flatMap(e => (e.type === 'on-event' && e.event === 'self-enters-play' && e.apply
    ? [e.apply] : []));
  const removal = [...effects, ...onEntry].find(e => e.type === 'move'
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
  const reliefFrom = (instanceId: string | readonly string[]): number => now - companies.reduce(
    (sum, c) => sum + defence.harmWithout(instanceId, c.roster, hazardSlots(c.size)), 0,
  );

  const target = namedDiscardTarget(action);
  if (target) {
    const located = findInPlay(view, target);
    if (located?.attached && !located.ours) {
      return { tsd: 0, reason: 'attached to a character we do not control — discarding it relieves the '
        + 'opponent, not us' };
    }
    // A free-standing hazard we played ourselves. Its modifier reaches attacks
    // on our companies too, but we put it there to make *our* creatures worse
    // for the opponent, and what it does to them is not priced here — so the
    // relief alone would read as pure gain. The Cock Crows was offered against
    // the player's own Full of Froth and Rage at every priority window of a
    // recorded game (102 decisions) and the AI wanted it at every one; the
    // winning human never played it so.
    if (located && !located.attached && ownerOf(target) === view.self.id
      && (cardPool[located.definitionId] as unknown as { cardType?: string } | undefined)?.cardType === 'hazard-event') {
      return { tsd: 0, reason: 'our own hazard — discarding it gives up what it does to the opponent\'s '
        + 'companies' };
    }
    // A corruption hazard on one of our own characters (Lure of Expedience,
    // Alone and Unadvised): discarding it is worth the corruption it carried
    // and the check it would still force on him.
    if (located?.attached && located.ours) {
      const own = reliefFromOwnCorruption(context, target, located.definitionId);
      if (own) return own;
    }
    const relief = reliefFrom(target as string);
    if (relief <= 0) return null;
    const def = located ? cardPool[located.definitionId] : undefined;
    const name = def?.name ?? (target as string);
    return {
      tsd: relief,
      reason: `discarding ${name} takes ${relief.toFixed(1)} of harm off our companies — `
        + 'the attacks it was strengthening go back to their printed numbers',
    };
  }

  // Sweep mode: no single named target. A `filter-all` sweep takes every
  // free-standing match at once, so it is priced as one removal of all of them
  // — Minions Stir loses its Doors of Night upgrade only when both go together,
  // and the best single card misses that. Any other sweep picks one, so the
  // best reachable match.
  const matches: { instanceId: string; name: string; ours: boolean; hazard: boolean }[] = [];
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      const def = cardPool[card.definitionId];
      if (!couldMatch(removal.filter, def)) continue;
      matches.push({
        instanceId: card.instanceId as string,
        name: def?.name ?? (card.definitionId as string),
        ours: ownerOf(card.instanceId) === view.self.id,
        hazard: (def as unknown as { cardType?: string } | undefined)?.cardType === 'hazard-event',
      });
    }
  }
  if (removal.select === 'filter-all' && matches.length > 0) {
    // Our own hazard swept with theirs gives up what it does to the opponent's
    // companies, which is not priced here — the same zero the named case gives.
    const own = matches.find(m => m.ours && m.hazard);
    if (own) {
      return { tsd: 0, reason: `would also discard our own ${own.name} — what it does to the opponent's `
        + 'companies is given up' };
    }
    const relief = reliefFrom(matches.map(m => m.instanceId));
    if (relief <= 0) return null;
    return {
      tsd: relief,
      reason: `discarding ${matches.map(m => m.name).join(', ')} takes ${relief.toFixed(1)} of harm off `
        + 'our companies — the attacks they were strengthening go back to their printed numbers',
    };
  }
  let best: { relief: number; name: string } | null = null;
  for (const match of matches) {
    const relief = reliefFrom(match.instanceId);
    if (relief > 0 && (!best || relief > best.relief)) best = { relief, name: match.name };
  }
  if (!best) return null;
  return {
    tsd: best.relief,
    reason: `discarding ${best.name} takes ${best.relief.toFixed(1)} of harm off our companies — `
      + 'the attacks it was strengthening go back to their printed numbers',
  };
}

/**
 * What discarding a corruption hazard attached to one of our own characters
 * is worth — Marvels Told, Voices of Malice or The Cock Crows played on our
 * own Lure of Expedience or Alone and Unadvised.
 *
 * The card's corruption is read the way `grants` reads it when the bearer
 * rolls to shed the same card (`stat-modifier corruption-points`), and the
 * relief comes from `character-value`, so the two routes to one discard agree.
 * A card that also forces checks of its own (`on-event … force-check
 * corruption`) is credited one check at the bearer's current corruption per
 * such trigger: the least it would still demand. Declined, these plays fell
 * back, and the winning humans of eleven recorded decisions (batch 19) spent
 * the event on their own corruption card where the modular AI passed.
 *
 * Null when the card carries no corruption, so its relief is left to
 * `defence` as before.
 */
function reliefFromOwnCorruption(
  context: ModuleContext,
  target: CardInstanceId,
  definitionId: string,
): { tsd: number; reason: string } | null {
  const { view, cardPool, standing, tunables } = context;
  const bearer = Object.entries(view.self.characters)
    .find(([, character]) => character.hazards.some(h => h.instanceId === target))?.[0] as CardInstanceId | undefined;
  if (!bearer) return null;
  const def = cardPool[definitionId] as unknown as {
    name?: string;
    effects?: readonly { type?: string; stat?: string; value?: number; apply?: { type?: string; check?: string } }[];
  } | undefined;
  const effects = def?.effects ?? [];
  const corruption = effects
    .filter(e => e.type === 'stat-modifier' && e.stat === 'corruption-points')
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
  if (corruption <= 0) return null;
  const value = computeCharacterValue(view, cardPool, standing, tunables);
  const relief = value.corruptionRelief(bearer, corruption);
  const triggers = effects.filter(e => e.type === 'on-event'
    && e.apply?.type === 'force-check' && e.apply.check === 'corruption').length;
  const check = triggers > 0 ? value.checkRisk(bearer) : { tsd: 0, reason: '' };
  const name = def?.name ?? definitionId;
  return {
    tsd: relief.tsd + triggers * check.tsd,
    reason: `discarding ${name} from our own character — ${relief.reason}`
      + (triggers > 0 ? `; and ${triggers} check(s) it would still force — ${check.reason}` : ''),
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
  const gain = stand === undefined ? null : gainOf(effects, context, stand);
  // A held Gates of Morning is worth the cards that read it as much as a
  // played one is; priced by its sweep alone it was the first card thrown away
  // at the hand reset. Its own copies are not readers, so no instance is excluded.
  const enabled = enablerGain(def, '', context);
  if (!enabled) return gain;
  return gain && gain.tsd !== 0 ? { tsd: gain.tsd + enabled.tsd, reason: `${gain.reason}; ${enabled.reason}` } : enabled;
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

/** Whether a card leaves play when its bearer's company moves. */
function discardsWhenCompanyMoves(effects: readonly Effect[]): boolean {
  return effects.some(effect => {
    const e = effect as unknown as {
      type?: string; event?: string; apply?: { type?: string; select?: string; to?: string };
    };
    return e.type === 'on-event' && e.event === 'bearer-company-moves'
      && e.apply?.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard';
  });
}

/**
 * What the corruption check an event forces on the character it is played on
 * costs (Vilya tw-358: "Elrond makes a corruption check modified by -3").
 *
 * The engine enqueues an `on-event self-enters-play → enqueue-corruption-check`
 * on the event's target character (`reducer-events`, `chain-reducer`), so the
 * check is ours to fail whatever the event achieves. Left unpriced, the
 * modular AI played Vilya at every window of a recorded game for its three
 * cards back to the deck — 25 decisions where the winning human (rated 1645)
 * held it — and never counted that a failed check costs Elrond.
 *
 * A check with a `when` (Nenya picks -1 or -3 by Galadriel's site) or aimed at
 * another company member (`apply.target`) is not read here and charges
 * nothing, so such an event stays as over-valued as it was.
 */
function forcedCheckCost(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const checks = effects.filter(e => e.type === 'on-event' && e.event === 'self-enters-play'
    && e.apply?.type === 'enqueue-corruption-check' && e.apply.target === undefined && e.when === undefined);
  if (checks.length === 0) return null;
  const characterId = (action as unknown as { targetCharacterId?: CardInstanceId }).targetCharacterId;
  if (!characterId) return null;
  const value = computeCharacterValue(context.view, context.cardPool, context.standing, context.tunables);
  const prices = checks.map(e => value.checkRisk(characterId, e.apply?.modifier ?? 0));
  return {
    tsd: prices.reduce((sum, p) => sum + p.tsd, 0),
    reason: prices.map(p => p.reason).join('; '),
  };
}

/** What crediting a permanent event's printed points assumes. */
const PERMANENT_ASSUMPTIONS: readonly string[] = [
  'a permanent event\'s printed points are scored as though the card simply stays in play; a '
  + 'card that can be discarded, cancelled or removed later is over-valued by exactly that risk',
];

/**
 * What a permanent resource event is worth to our own cards that read it.
 *
 * Strong players play Gates of Morning with no hazard environment to discard
 * — fifteen times in the rated corpus — because their decks are full of cards
 * that do more while it is out: Dark Quarrels halves every attack's strikes,
 * The Cock Crows discards a hazard permanent-event, Vanish in Sunlight! gives
 * -4 instead of -2, and Clear Skies or Cloudless Day cannot be played at all
 * without it. Priced only by what it discards, it was worth nothing there,
 * lost to a pass, and was the first card thrown away at the hand reset.
 *
 * Those modes are mostly alternatives this module cannot price one by one, so
 * each card that names it in an `inPlay` condition is credited one draw
 * (`resourceDrawValue`): the mode upgrades a card we will hold, and the
 * stronger mode is usually the one played. A card in hand counts in full; one
 * still in the deck (`ownDeck`) by the chance it is drawn over
 * `planHorizonTurns`, two draws a turn — that chance is the discount, so it is
 * not discounted again. Half a draw each, as first tried, still left the play
 * below a pass at most of the recorded positions where winners made it. Only resource cards count — our own
 * hazards that read it ("only if Gates of Morning is not in play") are the
 * other seat's business — and nothing is credited once it is already out.
 */
function enablerGain(
  def: CardDefinition | undefined,
  instanceId: string,
  context: ModuleContext,
): EventGain | null {
  const { view, cardPool, tunables, ownDeck } = context;
  const printed = def as unknown as { name?: string; eventType?: string; cardType?: string } | undefined;
  if (printed?.eventType !== 'permanent' || !printed.name || printed.cardType?.includes('hazard')) return null;
  const name = printed.name;
  if (inPlayNamed(view, cardPool, name)) return null;
  const reads = (id: string): boolean => {
    const card = cardPool[id] as unknown as { name?: string; cardType?: string; effects?: unknown } | undefined;
    if (!card || card.name === name || String(card.cardType ?? '').includes('hazard')) return false;
    return JSON.stringify(card.effects ?? []).includes(`"inPlay":"${name}"`);
  };
  const unseen = ownDeck ? unseenDeckCards(view, ownDeck) : [];
  const draws = 2 * tunables.planHorizonTurns;
  const each = tunables.resourceDrawValue;
  const credited = new Map<string, number>();
  for (const card of view.self.hand) {
    if ((card.instanceId as string) === instanceId || !reads(card.definitionId as string)) continue;
    credited.set(card.definitionId as string, (credited.get(card.definitionId as string) ?? 0) + 1);
  }
  const inDeck = new Map<string, number>();
  for (const id of unseen) if (reads(id)) inDeck.set(id, (inDeck.get(id) ?? 0) + 1);
  for (const [id, copies] of inDeck) {
    credited.set(id, (credited.get(id) ?? 0) + Math.min(copies, copies * draws / unseen.length));
  }
  if (credited.size === 0) return null;
  const options = [...credited.values()].reduce((sum, n) => sum + n, 0);
  const names = [...credited.keys()].map(id => cardPool[id]?.name ?? id);
  return {
    tsd: options * each,
    reason: `${names.join(', ')} do more with ${name} in play — about ${options.toFixed(1)} card(s) in hand or `
      + `drawn while it lasts, ${each.toFixed(2)} each`,
  };
}

/**
 * What taking one environment card out of play is worth to us, or null when
 * it is not an environment in play or declared on the chain.
 *
 * Strong players spend Twilight on Doors of Night — the opponent's, and their
 * own too: played against the opponent's movement, then cancelled in their own
 * turn, because an environment is global and their own Doors of Night makes
 * the opponent's attacks on them stronger too (game mvjum705-ua2jlu, seq 165). Both were priced
 * at the card spent and nothing else. The parts:
 *
 * - **A hazard environment's grip on our companies**, whoever played it —
 *   ours only in our own turn: Doors of Night turning Minions Stir's +1 into
 *   +2, the harm `defence` stops, the same relief the removal family prices.
 * - **The options its owner's cards had from it**: for the opponent, each of
 *   their resource cards in play that names it in an `inPlay` condition, at a
 *   draw each (their hand is not ours to read, so this is a floor); for us,
 *   `enablerGain` as if it were back in hand. What our own hazard environment
 *   did to their companies is not priced here.
 * - **The card spent on it**, at `provisionalCardPrice`: theirs is a gain to
 *   us, ours a loss — except our own hazard environment in our own turn, which
 *   was played for their movement and has done its work.
 * - **What it enables that we cannot see** (`environmentCancelBonus`), for an
 *   environment working against us: theirs, or our own hazard one in our turn.
 *
 * One still on the chain (Twilight answering the Doors of Night just
 * declared) is priced as if it had resolved: cancelling it is keeping it out.
 */
export function environmentLoss(instanceId: CardInstanceId, context: ModuleContext): EventGain | null {
  const { view, cardPool, standing, tunables } = context;
  const located = findInPlay(view, instanceId);
  const pending = located ? null : (view.chain?.entries ?? []).find(entry =>
    !entry.resolved && !entry.negated && entry.card?.instanceId === instanceId)?.card ?? null;
  if (located?.attached || (!located && !pending)) return null;
  const definitionId = located?.definitionId ?? pending!.definitionId;
  const def = cardPool[definitionId] as unknown as {
    name?: string; cardType?: string; keywords?: readonly string[];
  } | undefined;
  if (!def?.keywords?.includes('environment')) return null;
  const name = def.name ?? definitionId;
  const ours = ownerOf(instanceId) === view.self.id;
  // The board with it in play, so a pending card is priced as if it resolved.
  const board = located ? view : ({
    ...view,
    self: ours ? { ...view.self, cardsInPlay: [...view.self.cardsInPlay, pending!] } : view.self,
    opponent: ours ? view.opponent : { ...view.opponent, cardsInPlay: [...view.opponent.cardsInPlay, pending!] },
  } as typeof view);

  let relief = 0;
  // Our own hazard environment is working for our attacks in the opponent's
  // turn; it is only in ours, with our companies about to move, that its grip
  // on them is the thing to be rid of — the order strong players use it in:
  // Doors of Night played against their movement, Twilight on it in our own.
  const ourTurn = view.activePlayer === view.self.id;
  if (def.cardType === 'hazard-event' && (!ours || ourTurn)) {
    const harm = (on: typeof view): number => {
      const defence = computeDefence(on, cardPool, standing, tunables);
      return on.self.companies.reduce((sum, company) => sum + defence.expectedHarm(
        rosterOf(company, on.self.characters, cardPool), hazardSlots(company.characters.length)), 0);
    };
    relief = harm(board) - harm(withoutInPlay(board, instanceId as string));
  }
  const card = tunables.provisionalCardPrice;
  const parts = relief !== 0 ? [`${relief.toFixed(1)} of harm off our companies`] : [];
  // Our own hazard environment in our own turn has done its work — it was
  // played against their movement — and now only helps the opponent's
  // hazards against ours: no card is lost by cancelling it, and what it
  // enables for them is the unseen part.
  if (ours && def.cardType === 'hazard-event' && ourTurn) {
    parts.push(`what it enables in their hand, ${tunables.environmentCancelBonus.toFixed(1)}`);
    return {
      tsd: relief + tunables.environmentCancelBonus,
      reason: `takes our own ${name} out of play before our movement — ${parts.join('; ')}`,
    };
  }
  if (ours) {
    const options = def.cardType?.includes('hazard') ? null : enablerGain(
      cardPool[definitionId], instanceId as string, { ...context, view: withoutInPlay(board, instanceId as string) },
    );
    parts.push(`our own card lost, ${card.toFixed(1)}`);
    if (options) parts.push(options.reason);
    return {
      tsd: relief - card - (options?.tsd ?? 0),
      reason: `takes our own ${name} out of play — ${parts.join('; ')}`,
    };
  }
  const readers = board.opponent.cardsInPlay.filter(c => JSON.stringify(
    (cardPool[c.definitionId] as unknown as { effects?: unknown } | undefined)?.effects ?? [],
  ).includes(`"inPlay":"${name}"`)).length;
  if (readers > 0) parts.push(`${readers} of their card(s) in play lose what it gave them`);
  parts.push(`the card they spent on it, ${card.toFixed(1)}`);
  parts.push(`what it enables in their hand, ${tunables.environmentCancelBonus.toFixed(1)}`);
  return {
    tsd: relief + readers * tunables.resourceDrawValue + card + tunables.environmentCancelBonus,
    reason: `takes their ${name} out of play — ${parts.join('; ')}`,
  };
}

/**
 * Whether a card is an environment cancel the DSL does not spell out: a hazard
 * short-event playable as a resource with no other effect — Twilight, whose
 * cancel the engine offers per environment in `targetInstanceId`.
 */
function isEnvironmentCancel(def: CardDefinition | undefined, action: GameAction): boolean {
  const card = def as unknown as { cardType?: string; eventType?: string; effects?: readonly Effect[] } | undefined;
  if (card?.cardType !== 'hazard-event' || card.eventType !== 'short') return false;
  const effects = card.effects ?? [];
  if (!effects.some(e => e.type === 'play-flag' && (e as { flag?: string }).flag === 'playable-as-resource')) return false;
  if (!effects.every(e => e.type === 'play-flag')) return false;
  return (action as unknown as { targetInstanceId?: string }).targetInstanceId !== undefined;
}

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
  const cancel = isEnvironmentCancel(def, action)
    ? environmentLoss((action as unknown as { targetInstanceId: CardInstanceId }).targetInstanceId, context)
    : null;
  let gain = cancel ?? (declaresAnEffect(effects)
    ? gainOf(effects, context, action)
    : {
      tsd: 0,
      reason: 'the card declares no effect this engine will execute — only how it may be played',
    });
  const enabled = enablerGain(def, instanceId as string, context);
  if (enabled) {
    gain = gain && gain.tsd !== 0
      ? { tsd: gain.tsd + enabled.tsd, reason: `${gain.reason}; ${enabled.reason}` }
      : enabled;
  }
  const { standing, tunables } = context;

  // A permanent event stays in play, so its printed marshalling points are
  // scored the moment it lands — like an item or a faction, and unlike a short
  // event, which is in the discard pile before anything is counted. That is a
  // reading of where the card goes, so it is offered only to the callers whose
  // card goes there.
  const printed = def as unknown as { marshallingPoints?: number; marshallingCategory?: string } | undefined;
  const mp = options.creditPoints === true ? printed?.marshallingPoints ?? 0 : 0;
  const source = (printed?.marshallingCategory ?? 'misc') as MpSource;
  const worth = mp > 0 ? standing.tsdAfter({ [source]: mp }) - standing.tsd : 0;
  // …unless the card leaves play when its company moves (Align Palantír,
  // Choice of Lúthien: `on-event bearer-company-moves → discard`). Played
  // before this turn's movement, the move that follows throws the points away;
  // played after it, they last only until the company next moves, so they are
  // potential rather than banked. The recorded human played Align Palantír in
  // a site phase, after moving; the modular AI would have played it in 99
  // organization-phase decisions of game mu2aozy8-47zyul and lost it to the
  // very next move.
  const lostOnMove = mp > 0 && discardsWhenCompanyMoves(effects);
  const beforeMovement = lostOnMove && context.view.activePlayer === context.view.self.id
    && (context.view.phaseState.phase === Phase.Organization || context.view.phaseState.phase === Phase.LongEvent);
  const points = lostOnMove ? 0 : worth;
  const potential = lostOnMove && !beforeMovement ? worth : 0;

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
  // The Free Council is the last thing the game does, so a card spent there
  // forgoes nothing — the same reading `corruption` makes of a support tap.
  // A hazard played in the opponent's turn is the hazard side's card, and a
  // hazard spent there is the rotation `hazards` credits (`hazardCardPrice`),
  // not a resource given up — once the cancel has been read; an unread one is
  // still charged the card, or the rotation alone would make it worth playing.
  const asHazard = cancel !== null && context.view.activePlayer !== context.view.self.id
    && String((def as unknown as { cardType?: string } | undefined)?.cardType ?? '').startsWith('hazard');
  const spent = context.view.phaseState.phase === Phase.FreeCouncil ? 0
    : asHazard ? tunables.hazardCardPrice : tunables.provisionalCardPrice;
  const name = def?.name ?? (card.definitionId as string);
  const check = forcedCheckCost(effects, context, action);
  const risk = check?.tsd ?? 0;

  const does = gain?.tsd ?? 0;
  const reason = gain?.reason ?? `${mp} ${source} MP, and an effect family this cannot read`;
  const dtsd = netTsdDelta({ realized: does + points - risk, potential, tempo: spent }, tunables);
  const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${reason}`, dtsd }];

  const detail: Rationale[] = [
    leaf('event', name),
    leaf('what it does', does, { unit: 'tsd', note: reason }),
  ];
  if (mp > 0 && !lostOnMove) {
    detail.push(leaf('points it puts on the table', points, {
      unit: 'tsd',
      note: `${mp} ${source} MP, at the standing this play would create — a permanent event `
        + 'stays in play, so they are scored now',
    }));
  } else if (lostOnMove) {
    detail.push(leaf('points it puts on the table', potential, {
      unit: 'tsd',
      tunable: beforeMovement ? undefined : 'potentialDiscount',
      note: beforeMovement
        ? `${mp} ${source} MP, but the card is discarded when its company moves and this turn's `
          + 'movement is still to come — nothing is kept'
        : `${mp} ${source} MP, kept only until the company next moves — potential, not banked`,
    }));
  }
  if (check) {
    detail.push(leaf('the corruption check it forces', risk, { unit: 'tsd', note: check.reason }));
  }
  detail.push(leaf('the card it spends', spent, {
    unit: 'tsd',
    tunable: 'provisionalCardPrice',
    note: spent === 0
      ? 'the Free Council ends the game — a card spent there forgoes nothing'
      : 'the spending price — what it is worth to hold is a different question',
  }));

  return scoredEvaluation({
    action,
    module,
    outcomes,
    standing,
    headline: `play ${name}`,
    detail: [node('the event', does + points - risk - spent, detail, { unit: 'tsd' })],
    assumptions: mp > 0 ? [...EVENT_ASSUMPTIONS, ...PERMANENT_ASSUMPTIONS] : EVENT_ASSUMPTIONS,
  });
}

/**
 * @module ai/h2/modules/events/events
 *
 * The `events` module — short events, priced by what their effects declare.
 *
 * `play-short-event` is the largest unowned action type left, at 183 blocked
 * decisions in three self-play games, and it is the hardest kind of card to
 * price: an event does one specific thing, once, and the thing is the card's
 * text. That is the DSL's territory, not a module's.
 *
 * But the same seam that made `grants` possible is here too. The DSL declares
 * what an event does, and a few *families* of declared effect are worth
 * something this design already knows how to compute:
 *
 * - **A card comes back.** `move ... to: "hand"` or `to: "deck"` recovers a
 *   card, worth at least what a draw is worth — a floor, because the card is
 *   chosen rather than drawn.
 * - **Something leaves play.** `move ... from: "in-play" to: "discard"` filtered
 *   to hazard events takes an attached hazard off one of our characters, which
 *   is worth the corruption it was carrying.
 * - **A company is shut to creatures.** Stealth adds
 *   `no-creature-hazards-on-company` for the turn, and that is worth the whole
 *   hazard plan the opponent would otherwise aim at it — `defence`, against the
 *   creatures this opponent has actually shown. It is the most-offered short
 *   event in the game by a wide margin, 150 of 276 appearances in three games.
 *
 * Everything else is declined per action. That is the honest outcome and it is
 * most of them: an event whose value is "the opponent may not do X this turn"
 * cannot be priced without modelling X.
 *
 * The cost is the card itself, at its shadow price — which for an event whose
 * effect this module cannot read is the flat floor. Note what that means: an
 * event is never scored *negative* here, because a family it cannot price is
 * declined rather than charged. Charging for the card and crediting nothing
 * would make H2 refuse to play any event in the game, which is worse than
 * having no opinion.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCardPrices } from '../../services/card-price.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { computeDefence } from '../../services/defence.js';
import { rosterOf } from '../../services/strike/prowess.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-short-event'] as const;

/** A declared effect, as far as this module reads one. */
interface Effect {
  readonly type?: string;
  readonly from?: string | readonly string[];
  readonly to?: string;
  readonly count?: number;
  readonly filter?: { readonly cardType?: unknown };
  readonly constraint?: string;
  readonly cost?: { readonly tap?: string };
  readonly apply?: Effect;
}

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

/** The corruption a card puts on whoever it is attached to. */
function attachedCorruption(def: CardDefinition | undefined): number {
  const fields = def as unknown as {
    effects?: readonly { type?: string; stat?: string; value?: number }[];
  } | undefined;
  return (fields?.effects ?? [])
    .filter(effect => effect.type === 'stat-modifier' && effect.stat === 'corruption-points')
    .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
}

/** The most corruption any one attached hazard is putting on our characters. */
function worstAttachedHazard(
  context: ModuleContext,
): { characterId: CardInstanceId; corruption: number } | null {
  let worst: { characterId: CardInstanceId; corruption: number } | null = null;
  for (const character of Object.values(context.view.self.characters)) {
    for (const hazard of character.hazards) {
      const corruption = attachedCorruption(context.cardPool[hazard.definitionId]);
      if (corruption <= 0) continue;
      if (!worst || corruption > worst.corruption) {
        worst = { characterId: character.instanceId, corruption };
      }
    }
  }
  return worst;
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
 * It names him in `targetScoutInstanceId`, though — not `targetCharacterId`,
 * which is what other character-targeting short events use. Reading one field
 * where the engine keeps the answer in another is the sixth bug of this shape
 * in this project, and the sixth to be invisible: a module that finds nothing
 * declines, and a decline reads as an unowned action type. All the spellings
 * are read here.
 */
function targetCompanyRoster(
  action: GameAction,
  context: ModuleContext,
): { roster: readonly StrikeTarget[]; size: number } | null {
  const named = action as unknown as {
    targetCharacterId?: CardInstanceId;
    targetScoutInstanceId?: CardInstanceId;
    targetInstanceId?: CardInstanceId;
    characterId?: CardInstanceId;
  };
  const targetId = named.targetCharacterId ?? named.targetScoutInstanceId
    ?? named.targetInstanceId ?? named.characterId;
  if (!targetId) return null;
  const company = context.view.self.companies.find(c => c.characters.includes(targetId));
  if (!company) return null;
  return {
    roster: rosterOf(company, context.view.self.characters, context.cardPool),
    size: company.characters.length,
  };
}

/** What an event is worth if it resolves, or null when the family is unknown. */
function gainOf(
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
    const harm = defence.expectedHarm(target.roster, target.size);
    return {
      tsd: harm,
      reason: `no creature may be played on that company this turn — ${harm.toFixed(1)} of harm `
        + `they cannot aim at its ${target.size} character(s)`,
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
    const worst = worstAttachedHazard(context);
    if (!worst) return null;
    const relief = computeCharacterValue(context.view, context.cardPool, context.standing, tunables)
      .corruptionRelief(worst.characterId, worst.corruption);
    return { tsd: relief.tsd, reason: relief.reason };
  }

  return null;
}

/**
 * The events module. No context gate: a short event is always its own, and
 * what it cannot price it declines per action rather than per decision.
 */
export const eventsModule: H2Module = {
  name: 'events',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type !== 'play-short-event') return null;
    const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!instanceId) return null;
    const card = context.view.self.hand.find(c => c.instanceId === instanceId);
    if (!card) return null;

    const def = context.cardPool[card.definitionId];
    const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
    const gain = gainOf(effects, context, action);
    // A family this module cannot read is declined, not charged. Charging for
    // the card and crediting nothing would make H2 refuse every event in the
    // game, which is worse than having no opinion about them.
    if (!gain) return null;

    const { standing, tunables } = context;
    const price = computeCardPrices(context.view, context.cardPool, standing, tunables)
      .worth(instanceId);
    const spent = price?.tsd ?? tunables.provisionalCardPrice;
    const name = (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string);

    const dtsd = netTsdDelta({ realized: gain.tsd, tempo: spent }, tunables);
    const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${gain.reason}`, dtsd }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('event', name),
      leaf('what it does', gain.tsd, { unit: 'tsd', note: gain.reason }),
      leaf('the card it spends', spent, {
        unit: 'tsd',
        note: price?.reason ?? 'the flat price',
      }),
    ];

    return {
      action,
      module: 'events',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${name}`, scored.utility, [
        node('the event', gain.tsd - spent, detail, { unit: 'tsd' }),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: [
        'an event is priced by the *family* of effect it declares, not by its text: a card that '
        + 'also restricts, cancels or enables something is under-valued here',
        'the play is assumed to cost only the card; a tap or discard the event also demands is not '
        + 'charged',
        'removing an attached hazard is priced against the worst one our characters carry, not '
        + 'against whichever the card\'s filter would actually reach',
      ],
    };
  },
};

/**
 * @module ai/h2/modules/grants/grants
 *
 * The `grants` module — abilities a card in play gives its holder.
 *
 * `activate-granted-action` is one action type covering a dozen unrelated
 * things: shaking off a Lure, fetching a spell out of the discard, eating a
 * Cram to untap. It was the largest unowned type in the game at 213 blocked
 * decisions, and the reason nobody had taken it is that it looks like a
 * card-by-card problem — which is the DSL's work, not a module's.
 *
 * It is not, quite. The DSL already declares both halves of every grant:
 *
 * ```json
 * { "type": "grant-action", "action": "saruman-fetch-spell",
 *   "cost": { "tap": "self" },
 *   "apply": { "type": "move", "from": "discard", "to": "hand" } }
 * ```
 *
 * So this module prices **families of declared effect**, not cards. A cost of
 * `tap` is what `character-value` says tapping that character forfeits; a
 * `move` into hand is a card gained; an `on-success` that discards the granting
 * card is that card stopping whatever it was doing. Cards this project has
 * never seen are priced the moment their effects are written, and cards whose
 * effect is not in the list below are declined — which leaves the decision
 * honestly uncovered rather than scored at an invented number.
 *
 * Why a module of its own rather than a case inside `corruption`, where the
 * Lures first landed: `claims()` is per *decision*, not per action, so two
 * modules sharing this type would fight over a decision offering one grant of
 * each kind, and whichever lost would leave its own grant unscored. One action
 * type, one owner, dispatching on what the card declares.
 */

import { CardStatus, Phase } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { pAtLeast } from '../../core/dice.js';
import { leaf, node } from '../../core/rationale.js';
import { scoredEvaluation } from '../../core/evaluation.js';
import type { Tunables } from '../../core/tunables.js';
import { computeCharacterValue } from '../../services/character-value.js';
import type { CharacterValue } from '../../services/character-value.js';
import { nameOf } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['activate-granted-action'] as const;

/**
 * What declining to tap costs on the roll.
 *
 * `grant-action-apply.ts` applies -3 when the action carries `noTap`, and the
 * engine publishes the *unmodified* threshold on both variants — so unlike a
 * strike's `need`, this one has to be adjusted here. Mirrored rather than
 * guessed, and the calibration harness checks it against the reducer.
 */
const NO_TAP_PENALTY = 3;

/** The shape of a `grant-action` effect, as the DSL declares it. */
interface GrantEffect {
  readonly type?: string;
  readonly action?: string;
  readonly cost?: { readonly tap?: string; readonly discard?: string };
  readonly apply?: GrantApply;
}

/** What a grant does when it resolves. */
interface GrantApply {
  readonly type?: string;
  readonly from?: string;
  readonly to?: string;
  readonly status?: string;
  readonly target?: string;
  readonly fetchCount?: number;
  readonly onSuccess?: GrantApply;
}

/** The grant on a card matching the identifier the action names. */
function grantOf(def: CardDefinition | undefined, actionId: string): GrantEffect | null {
  const effects = (def as unknown as { effects?: readonly GrantEffect[] } | undefined)?.effects ?? [];
  return effects.find(e => e.type === 'grant-action' && e.action === actionId) ?? null;
}

/**
 * Corruption the granting card is putting on its bearer.
 *
 * Declared as a standing `stat-modifier`, not as the top-level number resource
 * cards print — reading only the number found zero on every attached hazard in
 * the game, which is the whole family the remove-self grant exists for. Only
 * top-level modifiers count: one nested inside an `on-event` is something the
 * card does when that event fires, not corruption being carried now.
 */
function attachedCorruption(def: CardDefinition | undefined): number {
  const fields = def as unknown as {
    corruptionPoints?: number;
    effects?: readonly { type?: string; stat?: string; value?: number }[];
  } | undefined;
  if (!fields) return 0;
  const fromEffects = (fields.effects ?? [])
    .filter(effect => effect.type === 'stat-modifier' && effect.stat === 'corruption-points')
    .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
  return fromEffects > 0 ? fromEffects : (fields.corruptionPoints ?? 0);
}

/**
 * What activating costs, priced from the cost the grant declares.
 *
 * A grant may declare both halves — Healing Herbs, Athelas and Dragon-lore tap
 * the bearer *and* discard themselves — so they are summed, not either-or.
 *
 * Discarding the card is charged at least `provisionalCardPrice`, on top of any
 * marshalling points it carries. A card of ours leaves play for good, along
 * with every other use it had: Cram discarded to untap its bearer can no
 * longer buy the extra region of movement it also grants. Priced at zero, a
 * pointless activation tied the do-nothing move and won the random draw — the
 * modular AI would have eaten a Cram in every untap phase of recorded game
 * mueq69r2-wyopxj, where the bearer was about to untap anyway, while the
 * human took the untap step.
 */
function costOf(
  grant: GrantEffect,
  characterId: CardInstanceId,
  characterValue: CharacterValue,
  sourceMpLoss: number,
  tunables: Tunables,
): { tsd: number; reason: string } {
  const parts: { tsd: number; reason: string }[] = [];
  if (grant.cost?.tap) {
    const tap = characterValue.tapCost(characterId);
    parts.push({ tsd: tap.tsd, reason: `taps ${grant.cost.tap} — ${tap.reason}` });
  }
  if (grant.cost?.discard) {
    parts.push({
      tsd: sourceMpLoss + tunables.provisionalCardPrice,
      reason: sourceMpLoss > 0
        ? 'discards the card itself, its marshalling points and every other use it had'
        : 'discards the card itself and every other use it had, at the price of a card',
    });
  }
  if (parts.length === 0) return { tsd: 0, reason: 'the grant declares no cost' };
  return {
    tsd: parts.reduce((sum, part) => sum + part.tsd, 0),
    reason: parts.map(part => part.reason).join('; '),
  };
}

/**
 * The engine's refusal of a resource play for want of a character standing up.
 *
 * Items, allies and factions are refused with exactly this wording
 * (`legal-actions/site.ts`) when the company has nobody untapped to carry or
 * influence them — the one refusal an untap can lift.
 */
const NO_UNTAPPED_CHARACTER = 'no untapped character in company';

/**
 * Whether standing this character up lets his company make a play *now*.
 *
 * True only in our own site phase, for the company whose site phase it is,
 * when the engine is refusing some resource play because nobody in the company
 * is untapped.
 */
function untapUnlocksAPlay(view: PlayerView, characterId: CardInstanceId): boolean {
  if (view.activePlayer !== view.self.id) return false;
  const phaseState = view.phaseState as { phase: string; activeCompanyIndex?: number };
  if (phaseState.phase !== Phase.Site) return false;
  const company = view.self.companies[phaseState.activeCompanyIndex ?? -1];
  if (!company?.characters.includes(characterId)) return false;
  return view.legalActions.some(e => !e.viable && e.reason?.includes(NO_UNTAPPED_CHARACTER) === true);
}

/**
 * What untapping a tapped bearer is worth.
 *
 * The ability is instant and can be used in any phase, so it is worth using
 * only at the moment a play needs him standing: our site phase, with the
 * engine refusing a resource for want of an untapped character. Anywhere else
 * spending the card now buys nothing that spending it then would not — and in
 * the untap phase or at end of turn, the next untap step stands him up for
 * free. The recorded human games agree: offered this 7129 times, humans took
 * it in 129 of 2424 site-phase offers, once in 1051 untap-phase offers, and
 * never in 979 end-of-turn ones.
 *
 * When it does unlock a play, it is worth exactly what tapping him would
 * forfeit *were he untapped* — which cannot be read off his own `tapCost`,
 * since that is zero for a character already tapped, and the grant is only
 * ever offered while he is. So the price is taken from the same view with the
 * bearer standing up.
 */
function untapGainOf(context: ModuleContext, characterId: CardInstanceId): { tsd: number; reason: string } {
  const { view } = context;
  const character = view.self.characters[characterId];
  if (!character || character.status !== CardStatus.Tapped) {
    return { tsd: 0, reason: 'he is not tapped — there is nothing to untap' };
  }
  if (!untapUnlocksAPlay(view, characterId)) {
    return { tsd: 0, reason: 'no play needs him standing yet — the ability keeps until one does' };
  }
  const upright: PlayerView = {
    ...view,
    self: {
      ...view.self,
      characters: { ...view.self.characters, [characterId]: { ...character, status: CardStatus.Untapped } },
    },
  };
  const tap = computeCharacterValue(upright, context.cardPool, context.standing, context.tunables)
    .tapCost(characterId);
  return { tsd: tap.tsd, reason: `untaps him for a play that needs him — worth what tapping him would forfeit (${tap.reason})` };
}

/** What the grant is worth if it resolves, or null when it cannot be priced. */
function gainOf(
  apply: GrantApply | undefined,
  context: ModuleContext,
  characterId: CardInstanceId,
  characterValue: CharacterValue,
  corruption: number,
): { tsd: number; reason: string } | null {
  if (!apply) return null;
  const { tunables } = context;

  // A roll gate wraps the real effect; the odds are handled by the caller from
  // the threshold the engine publishes on the action.
  if (apply.type === 'roll-then-apply') {
    return gainOf(apply.onSuccess, context, characterId, characterValue, corruption);
  }

  // The card takes itself out of play. Worth what it was doing to the bearer,
  // which this module can price when that is corruption and not otherwise.
  if (apply.type === 'move' && apply.to === 'discard' && apply.target !== 'bearer') {
    if (corruption <= 0) return null;
    const relief = characterValue.corruptionRelief(characterId, corruption);
    return { tsd: relief.tsd, reason: relief.reason };
  }

  // A card comes back to hand — a tutor, so at least what a draw is worth.
  if ((apply.type === 'move' && apply.to === 'hand') || apply.type === 'enqueue-pending-fetch') {
    const cards = apply.fetchCount ?? 1;
    return {
      tsd: cards * tunables.resourceDrawValue,
      reason: `${cards} card(s) recovered, priced at what a draw is worth — a floor, since this `
        + 'one is chosen rather than drawn',
    };
  }

  // Untapping the bearer gives back exactly what tapping him costs.
  if (apply.type === 'set-character-status' && apply.status === 'untapped' && apply.target === 'bearer') {
    return untapGainOf(context, characterId);
  }
  if (apply.type === 'set-character-status' && apply.status === 'untapped') {
    const tap = characterValue.tapCost(characterId);
    return { tsd: tap.tsd, reason: `untaps him — worth what tapping him forfeits (${tap.reason})` };
  }

  return null;
}

/**
 * The grants module.
 *
 * No context gate: `activate-granted-action` is always this module's, and what
 * it cannot price it declines per action rather than per decision.
 */
export const grantsModule: H2Module = {
  name: 'grants',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type !== 'activate-granted-action') return null;
    const record = action as unknown as {
      actionId?: string;
      characterId?: CardInstanceId;
      sourceCardDefinitionId?: string;
      rollThreshold?: number;
    };
    const { actionId, characterId, sourceCardDefinitionId } = record;
    if (!actionId || !characterId || !sourceCardDefinitionId) return null;
    const character = context.view.self.characters[characterId];
    if (!character) return null;

    const def = context.cardPool[sourceCardDefinitionId];
    const grant = grantOf(def, actionId);
    if (!grant) return null;

    const { standing, tunables } = context;
    const characterValue = computeCharacterValue(context.view, context.cardPool, standing, tunables);
    const corruption = attachedCorruption(def);
    const printed = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const points = printed?.marshallingPoints ?? 0;
    const sourceMpLoss = points > 0
      ? standing.tsd - standing.tsdAfter({ [printed.marshallingCategory ?? 'misc']: -points })
      : 0;

    const gain = gainOf(grant.apply, context, characterId, characterValue, corruption);
    // Nothing here can say what an extra region of movement or a company buff
    // is worth. Declining says so; inventing a number would not.
    if (!gain) return null;

    // Declining to tap costs -3 on the roll (`grant-action-apply.ts`), and the
    // engine publishes the *unmodified* threshold on both variants — unlike a
    // strike, where `need` arrives already modified. Calibration is what found
    // this: the same claim of 83.3% measured 84.0% against the reducer for the
    // tapping variant and 40.4% for the no-tap one, which is `pAtLeast(5 + 3)`.
    const noTap = (action as unknown as { noTap?: true }).noTap === true;
    const cost = noTap
      ? { tsd: 0, reason: 'declines to tap — at -3 on the roll' }
      : costOf(grant, characterId, characterValue, sourceMpLoss, tunables);
    const threshold = (record.rollThreshold ?? 0) + (noTap ? NO_TAP_PENALTY : 0);
    const success = pAtLeast(threshold);
    const name = printed?.name ?? sourceCardDefinitionId;
    const bearer = nameOf(context.cardPool, character.definitionId as string, characterId);

    const outcomes: Outcome[] = [
      {
        p: success,
        label: `${name}: ${gain.reason}`,
        dtsd: netTsdDelta({ realized: gain.tsd, tempo: cost.tsd }, tunables),
      },
      {
        p: 1 - success,
        label: `${name}: the roll fails — the cost is paid anyway`,
        dtsd: netTsdDelta({ realized: 0, tempo: cost.tsd }, tunables),
      },
    ].filter(outcome => outcome.p > 0);

    const detail: Rationale[] = [
      leaf('granted by', name),
      leaf('activated by', bearer),
      leaf('needs on 2d6', threshold, {
        note: threshold > 0
          ? `${(success * 100).toFixed(1)}% to succeed`
            + (noTap ? ` — ${record.rollThreshold ?? 0} plus ${NO_TAP_PENALTY} for not tapping` : '')
          : 'no roll — it simply happens',
      }),
      leaf('what it is worth', gain.tsd, { unit: 'tsd', note: gain.reason }),
      leaf('what it costs', cost.tsd, { unit: 'tsd', note: cost.reason }),
    ];

    return scoredEvaluation({
      action,
      module: 'grants',
      outcomes,
      standing,
      headline: `activate ${name}`,
      detail: [node('the ability', gain.tsd - cost.tsd, detail, { unit: 'tsd' })],
      assumptions: [
        'the ability is priced by the *family* of effect the card declares, not by what the card '
        + 'does in full: a grant that also restricts or enables something else is under-valued',
        'a no-tap variant is priced at the published threshold plus 3, mirroring the engine; if that '
        + 'penalty ever changes there, this has to change with it',
        'a card recovered to hand is priced at what an average draw is worth, which is a floor — '
        + 'choosing the card beats drawing one',
        'shedding a card is priced only for the corruption it was carrying, against one future '
        + 'check, the same simplification `resources` makes when charging for that corruption',
      ],
    });
  },
};

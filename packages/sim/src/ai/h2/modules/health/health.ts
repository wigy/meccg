/**
 * @module ai/h2/modules/health/health
 *
 * The `health` module — moving items between characters, and banking them.
 *
 * Two actions with very different shapes share this module because they share
 * a subject: who is carrying what.
 *
 * **Storing** an item at a haven is a real marshalling-point decision and the
 * one place H1 already had the arithmetic right — `storeItemMpGain` in
 * `evaluators/common.ts` computes the difference between what an item scores
 * carried and what it scores in the out-of-play pile, which is *negative* for
 * an ordinary item (stored items score nothing unless they carry a
 * `storable-at` override). What H1 could not do is price that difference: it
 * is worth what a point in the item source is worth in this standing, which
 * may be double, or nothing at all.
 *
 * **Transferring** an item between characters moves no points, so it is scored
 * as the neutral action it is rather than given an invented preference. That
 * is deliberate: the reasons to transfer — spreading corruption, moving a
 * weapon to the character who will face the strike, freeing a bearer to be
 * stored — are real, but each belongs to a module that owns that concern, and
 * inventing a number here is how the weight soup starts.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { storeItemMpGain } from '../../../evaluators/common.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['store-item', 'transfer-item'] as const;

/** The item an action names, wherever it is attached. */
function itemOf(
  context: ModuleContext,
  instanceId: CardInstanceId | undefined,
): { name: string; definitionId: string; source: MpSource } | null {
  if (!instanceId) return null;
  for (const character of Object.values(context.view.self.characters)) {
    const item = character.items.find(i => i.instanceId === instanceId);
    if (!item) continue;
    const def: CardDefinition | undefined = context.cardPool[item.definitionId];
    const fields = def as unknown as { name?: string; marshallingCategory?: string } | undefined;
    return {
      name: fields?.name ?? (instanceId as string),
      definitionId: item.definitionId,
      source: (fields?.marshallingCategory ?? 'item') as MpSource,
    };
  }
  return null;
}

/** Assumptions every health evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'a transfer is scored as marshalling-point neutral, which it is — the reasons to transfer '
  + '(spreading corruption, arming the character who will face a strike, freeing a bearer) belong '
  + 'to the modules that own those concerns and are not invented here',
  'storing is priced by the marshalling points it moves; the trip to the haven that made it '
  + 'possible is `travel`\'s cost, not counted twice here',
];

/** The health module. No context gate: both actions are always its own. */
export const healthModule: H2Module = {
  name: 'health',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const record = action as unknown as { itemInstanceId?: CardInstanceId; cardInstanceId?: CardInstanceId };
    const item = itemOf(context, record.itemInstanceId ?? record.cardInstanceId);
    if (!item) return null;
    const { standing, tunables } = context;

    let dtsd = 0;
    let detail: Rationale[];
    let label: string;

    if (action.type === 'store-item') {
      // `storeItemMpGain` returns the change in printed points: negative for an
      // ordinary item, which scores nothing once stored, and positive only for
      // one whose `storable-at` override pays more than carrying it does.
      const pointsMoved = storeItemMpGain(context.cardPool, item.definitionId);
      dtsd = pointsMoved === 0
        ? 0
        : netTsdDelta({ realized: standing.tsdAfter({ [item.source]: pointsMoved }) - standing.tsd }, tunables);
      label = pointsMoved >= 0
        ? `store ${item.name} — ${pointsMoved} ${item.source} MP`
        : `store ${item.name} — gives up ${-pointsMoved} ${item.source} MP`;
      detail = [
        leaf('item', item.name),
        leaf('points moved by storing', pointsMoved, {
          unit: 'mp',
          note: pointsMoved < 0
            ? 'an ordinary item scores nothing in the out-of-play pile'
            : 'a `storable-at` override pays more stored than carried',
        }),
        leaf(`worth of one ${item.source} point here`, standing.marginal[item.source], {
          unit: 'tsd',
          note: 'CoE 10.3, after doubling and the diversity cap',
        }),
      ];
    } else {
      label = `transfer ${item.name}`;
      detail = [
        leaf('item', item.name),
        leaf('marshalling points moved', 0, {
          unit: 'mp',
          note: 'a transfer changes who carries the item, not what it scores',
        }),
      ];
    }

    const outcomes: Outcome[] = [{ p: 1, label, dtsd }];
    const scored = standing.score(outcomes);

    return {
      action,
      module: 'health',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(label, scored.utility, [node('item', dtsd, detail), scored.rationale], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};

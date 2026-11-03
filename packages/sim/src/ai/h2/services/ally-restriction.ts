/**
 * @module ai/h2/services/ally-restriction
 *
 * Allies who are discarded when their company arrives outside their home
 * regions: Treebeard (tw-353), Leaflock (tw-265), Skinbark (tw-328), Tom
 * Bombadil (tw-350) and Last Child of Ungoliant (le-153).
 *
 * Two questions price this and they have to agree. `travel` asks what a
 * particular trip costs, and `organization` asks which goals an arrangement
 * can serve. When only `travel` knew, the arrangement credited a company with
 * goals the trip would then refuse, so a five-character company stayed beside
 * Treebeard and no split ever looked worth making.
 */

import { isSiteCard, matchesCondition } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import type { Standing } from '../core/types.js';
import type { Tunables } from '../core/tunables.js';
import type { MpDelta, MpSource } from '../core/tsd.js';

/**
 * Whether an ally's own `on-event: company-arrives-at-site` effect discards
 * it the moment its company arrives in `region`.
 *
 * Mirrors the engine's own match in `fireAllyArrivalEffects`
 * (`mh-hazard-play.ts`) rather than importing it: the sim depends only on
 * `@meccg/shared`'s public surface, not on internal reducer helpers.
 */
function allyDiscardedByArrivingIn(ally: CardDefinition | undefined, region: string): boolean {
  const effects = (ally as unknown as {
    readonly effects?: readonly {
      readonly type?: string;
      readonly event?: string;
      readonly apply?: { readonly type?: string; readonly select?: string; readonly to?: string };
      readonly when?: Parameters<typeof matchesCondition>[0];
    }[];
  } | undefined)?.effects ?? [];
  return effects.some(e => e.type === 'on-event' && e.event === 'company-arrives-at-site'
    && e.apply?.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard'
    && (!e.when || matchesCondition(e.when, { site: { region } })));
}

/** What a roster loses by arriving at a site. */
export interface ArrivalAllyLoss {
  /** Definition ids of the allies discarded by arriving. */
  readonly allyDefinitionIds: readonly string[];
  /**
   * Priced the way `character-value` prices losing a character: the
   * marshalling points leaving with the ally, plus the flat
   * `eliminationTempoCost` every loss carries.
   */
  readonly harmTsd: number;
}

/** The allies `characterIds` would lose by arriving at `siteDefinitionId`. */
export function allyLossOnArrival(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  characterIds: readonly (CardInstanceId | string)[],
  siteDefinitionId: string,
  standing: Standing,
  tunables: Tunables,
): ArrivalAllyLoss {
  const site = cardPool[siteDefinitionId];
  const region = site && isSiteCard(site) ? site.region : undefined;
  if (region === undefined) return { allyDefinitionIds: [], harmTsd: 0 };
  const lost = characterIds
    .flatMap(id => view.self.characters[id as CardInstanceId]?.allies ?? [])
    .map(ally => ally.definitionId as string)
    .filter(definitionId => allyDiscardedByArrivingIn(cardPool[definitionId], region));
  const harmTsd = lost.reduce((sum, definitionId) => {
    const fields = cardPool[definitionId] as unknown as
      { readonly marshallingPoints?: number; readonly marshallingCategory?: string } | undefined;
    const points = fields?.marshallingPoints ?? 0;
    const source = (fields?.marshallingCategory ?? 'ally') as MpSource;
    const delta: MpDelta = points ? { [source]: -points } : {};
    return sum + (standing.tsd - standing.tsdAfter(delta)) + tunables.eliminationTempoCost;
  }, 0);
  return { allyDefinitionIds: lost, harmTsd };
}

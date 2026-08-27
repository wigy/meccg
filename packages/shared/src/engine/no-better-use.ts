/**
 * @module engine/no-better-use
 *
 * No Better Use (ba-41) — "Playable on a character during your organization
 * phase. One time you may tap your character to place an opponent's character
 * 'off to the side' with this card. Do this in lieu of making opponent's
 * character's body check in company vs. company combat with your character's
 * company. Discard all cards on opponent's character. If your character
 * becomes wounded or leaves active play, discard this card — opponent's
 * character then forms a company at your character's current or new site.
 * During the site phase at Shelob's Lair, your character may tap and discard
 * this card to eliminate opponent's character — whom you then receive as kill
 * marshalling points."
 *
 * Shares the "strip and hold off to the side" shape with Press-gang (ba-22,
 * `press-gang.ts`): the same negative-MP / 0-GI / never-untaps scoring shape (a distinct
 * `character-captured-by-bearer` constraint kind, treated identically to
 * `character-pressed` by `recompute-derived.ts` / `reducer-untap.ts` /
 * `influence-overflow.ts` — see the kind's own doc comment in `pending.ts`
 * for why it is not literally `character-pressed`), same discard of
 * every attached item/ally/hazard, same followers-revert-to-general-influence
 * treatment (CRF ruling for Press-gang, reused here for consistency). It
 * differs in two ways Press-gang does not need:
 *
 * - **Capture trigger**: an activated ability offered *in lieu of* a pending
 *   CvCC character body check (`legal-actions/combat.ts`
 *   `captureInLieuOfBodyCheckActions`, handled by
 *   `combat-actions.ts::handleCaptureInLieuOfBodyCheck`), not an interception
 *   of a would-be discard. One-time-per-card, enforced by a persistent
 *   `granted-action-used` lock (`actionId: 'no-better-use-capture'`).
 * - **Release destination**: not the owner's hand (Press-gang) but a fresh
 *   one-character company at the *capturing* character's current site, formed
 *   the moment that character is wounded or leaves active play. Watching
 *   "wounded or leaves active play" needs no per-seam interception (unlike
 *   Press-gang's five discard seams): {@link sweepNoBetterUseCaptures} runs
 *   every `postReduce` pass and simply checks whether the bearer character
 *   (recorded on the `character-captured-by-bearer` constraint as `bearerCharacterId`)
 *   is still resolvable and un-wounded — covering every removal path (discard
 *   *or* elimination, by any means) uniformly, and refreshing a
 *   `bearerLastKnownSite` snapshot each pass so the release site is correct
 *   even once the bearer itself is gone.
 */

import type { GameState, CardInstanceId, PlayerId, PlayerState, CardInstance, CharacterInPlay, Company, SiteInPlay } from '../index.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { addConstraint, removeConstraint } from './pending.js';
import { resolveInstanceId } from '../types/state.js';
import { toCardInstance, cleanupEmptyCompanies, nextCompanyId } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';
import { partitionLeavingTrophies } from './trophy-dispersal.js';
import { freeOrDiscardFollowers } from './follower-dispersal.js';

/** True when the No Better Use host `hostInstanceId` has already used its one-time capture ability. */
export function noBetterUseAlreadyUsed(state: GameState, hostInstanceId: CardInstanceId): boolean {
  return state.activeConstraints.some(
    c => c.kind.type === 'granted-action-used'
      && c.kind.sourceInstanceId === hostInstanceId
      && c.kind.actionId === 'no-better-use-capture',
  );
}

/** The character (if any) currently held off to the side with the given No Better Use host. */
export function noBetterUseHeldCharacter(state: GameState, hostInstanceId: CardInstanceId): CardInstanceId | null {
  const c = state.activeConstraints.find(
    con => con.target.kind === 'character'
      && con.kind.type === 'character-captured-by-bearer'
      && con.kind.hostInstanceId === hostInstanceId,
  );
  return c && c.target.kind === 'character' ? c.target.characterId : null;
}

/** Remove the `character-captured-by-bearer` constraint for the given host, wherever its target is. No-op if none is held. */
export function removeCharacterPressedConstraint(state: GameState, hostInstanceId: CardInstanceId): GameState {
  let s = state;
  for (const con of state.activeConstraints) {
    if (con.kind.type === 'character-captured-by-bearer' && con.kind.hostInstanceId === hostInstanceId) {
      s = removeConstraint(s, con.id);
    }
  }
  return s;
}

/**
 * Capture `characterId` (owned by `capturedOwnerIndex`) off to the side with
 * the No Better Use host `hostInstanceId`, in lieu of its body check.
 *
 * 1. Discards all items/allies on the character to its owner's discard pile
 *    and all attached hazards to their owners' discard piles ("discard all
 *    cards on opponent's character").
 * 2. Reverts the character's followers to general influence (CoE 2.II.2.2.3),
 *    mirroring Press-gang's capture.
 * 3. Removes the character from every company and strips its possessions,
 *    but keeps the bare card in its owner's `characters` map (off to the
 *    side).
 * 4. Adds a `character-captured-by-bearer` constraint tying it to the host, recording
 *    the capturing character/owner/site so {@link sweepNoBetterUseCaptures}
 *    can watch it.
 * 5. Records the persistent one-time-use lock on the host.
 *
 * Returns the original state unchanged if the character is not in play.
 */
export function captureCharacterInLieuOfBodyCheck(
  state: GameState,
  capturedOwnerIndex: number,
  characterId: CardInstanceId,
  hostInstanceId: CardInstanceId,
  bearerCharacterId: CardInstanceId,
  bearerOwnerId: PlayerId,
  site: SiteInPlay | null,
): GameState {
  const char = state.players[capturedOwnerIndex]?.characters[characterId];
  if (!char) {
    logDetail(`No Better Use: character ${characterId as string} not in play — capture skipped`);
    return state;
  }
  const charDefId = char.definitionId;

  const ownerAdds: CardInstance[] = [...char.items.map(toCardInstance), ...char.allies.map(toCardInstance)];
  const { toKillPile: trophyKill, toOutOfPlay: trophyOop } =
    partitionLeavingTrophies(state, char, 'No Better Use capture');
  const hazardAddsByOwner = new Map<string, CardInstance[]>();
  for (const hazard of char.hazards) {
    const hazOwnerId = state.players[1 - capturedOwnerIndex].id as string;
    const list = hazardAddsByOwner.get(hazOwnerId) ?? [];
    list.push(toCardInstance(hazard));
    hazardAddsByOwner.set(hazOwnerId, list);
  }
  logDetail(`No Better Use: capturing ${characterId as string} — discarding ${char.items.length} item(s), ${char.allies.length} ally/allies, ${char.hazards.length} hazard(s); ${char.followers.length} follower(s) revert to GI`);

  const players = state.players.map((p): PlayerState => {
    let characters = p.characters;
    let companies = p.companies;
    let discardPile = p.discardPile;
    let killPile = p.killPile;
    let outOfPlayPile = p.outOfPlayPile;

    if (p.characters[characterId]) {
      const stripped: CharacterInPlay = { ...char, items: [], allies: [], hazards: [], followers: [], trophies: [] };
      const next: Record<CardInstanceId, CharacterInPlay> = { ...p.characters, [characterId as string]: stripped };
      freeOrDiscardFollowers(state, next, char, 'No Better Use capture');
      for (const [cid, cdata] of Object.entries(next)) {
        if (cid === (characterId as string)) continue;
        if (cdata.followers.includes(characterId)) {
          next[cid as CardInstanceId] = { ...cdata, followers: cdata.followers.filter(id => id !== characterId) };
        }
      }
      characters = next;
      companies = p.companies.map(c => ({ ...c, characters: c.characters.filter(id => id !== characterId) }));
      discardPile = [...p.discardPile, ...ownerAdds];
      killPile = [...p.killPile, ...trophyKill];
      outOfPlayPile = [...p.outOfPlayPile, ...trophyOop];
    }

    const hazAdds = hazardAddsByOwner.get(p.id as string);
    if (hazAdds && hazAdds.length > 0) {
      discardPile = [...discardPile, ...hazAdds];
    }

    if (characters === p.characters && companies === p.companies && discardPile === p.discardPile
        && killPile === p.killPile && outOfPlayPile === p.outOfPlayPile) return p;
    return { ...p, characters, companies, discardPile, killPile, outOfPlayPile };
  }) as [PlayerState, PlayerState];

  let s: GameState = { ...state, players };

  s = addConstraint(s, {
    source: hostInstanceId,
    sourceDefinitionId: charDefId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId },
    kind: { type: 'character-captured-by-bearer', hostInstanceId, bearerCharacterId, bearerOwnerId, bearerLastKnownSite: site },
  });

  // Persistent one-time-use lock — this host can never capture again, even
  // after the held character is later released.
  const hostDefId = resolveInstanceId(s, hostInstanceId);
  s = addConstraint(s, {
    source: hostInstanceId,
    sourceDefinitionId: hostDefId ?? charDefId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId: bearerOwnerId },
    kind: { type: 'granted-action-used', sourceInstanceId: hostInstanceId, actionId: 'no-better-use-capture' },
  });

  return cleanupEmptyCompanies(s);
}

/** Form a fresh one-character company for `characterId` (owned by `ownerIndex`) at `site`, with no planned movement. */
function releaseCapturedCharacterToNewCompany(
  state: GameState,
  characterId: CardInstanceId,
  site: SiteInPlay | null,
): GameState {
  const ownerIndex = state.players.findIndex(p => p.characters[characterId] !== undefined);
  if (ownerIndex === -1) return state;
  const player = state.players[ownerIndex];
  const newCompany: Company = {
    id: nextCompanyId(player),
    characters: [characterId],
    currentSite: site,
    siteCardOwned: false,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  };
  logDetail(`No Better Use: releasing ${characterId as string} — forms new company ${newCompany.id as string} at ${site?.definitionId ?? 'no known site'}`);
  return {
    ...state,
    players: state.players.map((p, idx) => idx === ownerIndex ? { ...p, companies: [...p.companies, newCompany] } : p) as [PlayerState, PlayerState],
  };
}

/** Discard the host card from the (still-in-play, now-wounded) bearer's items to its owner's discard pile. */
function discardHostFromBearer(
  state: GameState,
  bearerOwnerId: PlayerId,
  bearerCharacterId: CardInstanceId,
  hostInstanceId: CardInstanceId,
): GameState {
  const ownerIdx = getPlayerIndex(state, bearerOwnerId);
  if (ownerIdx < 0) return state;
  const player = state.players[ownerIdx];
  const bearer = player.characters[bearerCharacterId];
  if (!bearer) return state;
  const hostItem = bearer.items.find(i => i.instanceId === hostInstanceId);
  if (!hostItem) return state; // already discarded via a leaves-play path
  const updatedChar: CharacterInPlay = { ...bearer, items: bearer.items.filter(i => i.instanceId !== hostInstanceId) };
  logDetail(`No Better Use: bearer ${bearerCharacterId as string} wounded — discarding host card ${hostInstanceId as string}`);
  return {
    ...state,
    players: state.players.map((p, idx) => idx === ownerIdx
      ? { ...p, characters: { ...p.characters, [bearerCharacterId as string]: updatedChar }, discardPile: [...p.discardPile, toCardInstance(hostItem)] }
      : p) as [PlayerState, PlayerState],
  };
}

/** Immutably refresh the `bearerLastKnownSite` snapshot on one `character-captured-by-bearer` constraint. */
function refreshSiteSnapshot(state: GameState, constraintId: string, site: SiteInPlay | null): GameState {
  return {
    ...state,
    activeConstraints: state.activeConstraints.map(c =>
      c.id === constraintId && c.kind.type === 'character-captured-by-bearer' ? { ...c, kind: { ...c.kind, bearerLastKnownSite: site } } : c),
  };
}

/**
 * `postReduce` sweep: for every No Better Use capture (a `character-captured-by-bearer`
 * constraint carrying `bearerCharacterId`), check the capturing character —
 * "if your character becomes wounded or leaves active play, discard this
 * card — opponent's character then forms a company at your character's
 * current or new site":
 *
 * - Bearer still in play and not wounded: refresh the site snapshot (so a
 *   later release uses the bearer's *current* site, not its site at capture
 *   time) and keep the capture.
 * - Bearer wounded (still present, but `Inverted`): discard the host card
 *   from the bearer's items and release the captured character.
 * - Bearer no longer resolvable at all (discarded/eliminated by any path):
 *   its items were already discarded along with it — just release the
 *   captured character, using the last-known site snapshot.
 *
 * Mirrors `sweepSetAside`/`sweepPressGang` — the single load-bearing
 * disposition point so a capture never survives its watched character as a
 * silent orphan.
 */
export function sweepNoBetterUseCaptures(state: GameState): GameState {
  let s = state;
  for (const con of state.activeConstraints) {
    if (con.target.kind !== 'character' || con.kind.type !== 'character-captured-by-bearer') continue;
    const { bearerCharacterId, bearerOwnerId, hostInstanceId } = con.kind;
    if (!bearerCharacterId || !bearerOwnerId) continue; // Press-gang capture — not this mechanism.

    const bearerOwnerIdx = getPlayerIndex(s, bearerOwnerId);
    const bearer = bearerOwnerIdx >= 0 ? s.players[bearerOwnerIdx].characters[bearerCharacterId] : undefined;
    const company = bearer ? s.players[bearerOwnerIdx].companies.find(c => c.characters.includes(bearerCharacterId)) : undefined;

    if (bearer && bearer.status !== CardStatus.Inverted) {
      const site = company?.currentSite ?? null;
      if (site !== (con.kind.bearerLastKnownSite ?? null)) {
        s = refreshSiteSnapshot(s, con.id, site);
      }
      continue;
    }

    const site = company?.currentSite ?? con.kind.bearerLastKnownSite ?? null;
    logDetail(`No Better Use: bearer ${bearerCharacterId as string} ${bearer ? 'wounded' : 'left play'} — releasing captured character ${con.target.characterId as string}`);
    s = removeCharacterPressedConstraint(s, hostInstanceId);
    s = releaseCapturedCharacterToNewCompany(s, con.target.characterId, site);
    if (bearer) {
      s = discardHostFromBearer(s, bearerOwnerId, bearerCharacterId, hostInstanceId);
    }
  }
  // No `cleanupEmptyCompanies` here: this sweep only ever *adds* a
  // one-character company, never empties one, and it runs on every
  // `postReduce` pass. Dissolving empty companies unconditionally would
  // return their sites early and break CoE 2.07 (a company that lost all its
  // characters keeps its site until the end of all M/H phases).
  return s;
}

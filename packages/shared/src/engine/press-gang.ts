/**
 * @module engine/press-gang
 *
 * Press-gang (ba-22) — "When a character would otherwise be discarded from
 * play, discard all cards on him, place him 'off to the side' with this card,
 * and return any character already with this card to its owner's hand. A
 * character with this card gives his player negative character marshalling
 * points. Cannot be duplicated."
 *
 * Press-gang is a hazard permanent-event that *intercepts* the discard of a
 * character. Rather than the character reaching its owner's discard pile, it is
 * held "off to the side" with the Press-gang card: it stays in its owner's
 * `characters` map (the "no card disappears" invariant), removed from every
 * company, stripped of all possessions, and marked with a `character-pressed`
 * active constraint pointing back at the Press-gang instance.
 *
 * A pressed character is scored like a prisoner (CoE 8.35): it costs 0 general
 * influence and is worth **negative** character marshalling points to its owner
 * (`recompute-derived.ts`), and it never untaps or heals (`reducer-untap.ts`).
 *
 * Only characters of the Press-gang controller's **opponent** are captured (the
 * card is a hazard that penalises the enemy; "his player" is the character's
 * owner). Only elimination-to-*discard* is intercepted — a character eliminated
 * to the out-of-play pile (combat death, corruption hard-fail) is "eliminated",
 * not "discarded from play", and is left alone.
 *
 * Lifecycle:
 * - Press-gang holds **at most one** character. Capturing a second returns the
 *   prior one to its owner's hand (per the card text).
 * - When the Press-gang card leaves play, the held character is returned to its
 *   owner's hand by {@link sweepPressGang} (a `postReduce` sweep, mirroring
 *   `sweepSetAside`). "Off to the side" is never a silent drop.
 *
 * CRF ruling (CoE 2023): followers controlled by the pressed character are
 * **not** discarded — they revert to general influence like any freed follower.
 */

import type { GameState, CardInstanceId, PlayerState, CardInstance, CharacterInPlay } from '../index.js';
import { ownerOf } from '../types/state.js';
import { addConstraint, removeConstraint } from './pending.js';
import { toCardInstance, defById, getCardEffects, cleanupEmptyCompanies } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';
import { partitionLeavingTrophies } from './trophy-dispersal.js';
import { freeOrDiscardFollowers } from './follower-dispersal.js';

/**
 * Return the instance id of a Press-gang (`press-gang-capture` effect) in play
 * for the **opponent** of the player at `ownerIndex`, or `null` if none can
 * capture. A set-aside copy of the card never captures.
 */
export function findCapturingPressGang(state: GameState, ownerIndex: number): CardInstanceId | null {
  const opponent = state.players[ownerIndex === 0 ? 1 : 0];
  for (const card of opponent.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = defById(state, card.definitionId);
    if (getCardEffects(def).some(e => e.type === 'press-gang-capture')) {
      return card.instanceId;
    }
  }
  return null;
}

/** The character (if any) currently held off to the side with the given Press-gang host. */
export function pressGangHeldCharacter(state: GameState, hostInstanceId: CardInstanceId): CardInstanceId | null {
  const c = state.activeConstraints.find(
    con => con.target.kind === 'character'
      && con.kind.type === 'character-pressed'
      && con.kind.hostInstanceId === hostInstanceId,
  );
  return c && c.target.kind === 'character' ? c.target.characterId : null;
}

/**
 * Return a pressed character to its owner's hand: remove the `character-pressed`
 * constraint(s) targeting it and move the character card from its owner's
 * `characters` map to that owner's hand. The character was already stripped of
 * possessions on capture, so only the bare card returns.
 */
export function returnPressedCharacter(state: GameState, characterId: CardInstanceId): GameState {
  const ownerIdx = state.players.findIndex(p => p.characters[characterId] !== undefined);
  if (ownerIdx === -1) return state;
  const char = state.players[ownerIdx].characters[characterId];

  let s = state;
  for (const con of state.activeConstraints) {
    if (con.target.kind === 'character' && con.target.characterId === characterId && con.kind.type === 'character-pressed') {
      s = removeConstraint(s, con.id);
    }
  }

  const players = s.players.map((p, idx): PlayerState => {
    if (idx !== ownerIdx) return p;
    const { [characterId]: _held, ...rest } = p.characters;
    void _held;
    return {
      ...p,
      characters: rest,
      hand: [...p.hand, { instanceId: char.instanceId, definitionId: char.definitionId }],
    };
  }) as [PlayerState, PlayerState];

  logDetail(`Press-gang: returning held character ${characterId as string} to its owner's hand`);
  return { ...s, players };
}

/**
 * Capture a would-be-discarded character with the Press-gang host `hostInstanceId`.
 *
 * Reads the character from `state.players[ownerIndex].characters[characterId]`:
 * 1. Returns any character already held by this host to its owner's hand.
 * 2. Discards all items/allies on the character to its owner's discard pile and
 *    all attached hazards to their owners' discard piles ("discard all cards on
 *    him").
 * 3. Reverts the character's followers to general influence (CRF: not
 *    discarded), with the mind subtraction deferred to the follower's player's
 *    next organization phase per CoE 2.II.2.2.3 ({@link freeOrDiscardFollowers}).
 * 4. Removes the character from every company and strips its possessions, but
 *    keeps the bare card in its owner's `characters` map (off to the side).
 * 5. Adds a `character-pressed` constraint tying it to the host.
 *
 * Returns the original state unchanged if the character is not in play.
 */
export function capturePressGang(
  state: GameState,
  ownerIndex: number,
  characterId: CardInstanceId,
  hostInstanceId: CardInstanceId,
): GameState {
  if (!state.players[ownerIndex]?.characters[characterId]) {
    logDetail(`capturePressGang: character ${characterId as string} not in play — no-op`);
    return state;
  }

  // (1) A Press-gang holds at most one character — return any prior one to hand.
  const prior = pressGangHeldCharacter(state, hostInstanceId);
  let s = prior && prior !== characterId ? returnPressedCharacter(state, prior) : state;

  const char = s.players[ownerIndex].characters[characterId];
  const charDefId = char.definitionId;

  // (2) Route the character's possessions to the appropriate discard piles.
  const ownerAdds: CardInstance[] = [...char.items.map(toCardInstance), ...char.allies.map(toCardInstance)];
  // A pressed character leaves active play, so its trophies are discarded per
  // CoE 3.IV.4 — worth MP → the holder's marshalling-point pile, otherwise
  // removed from play. Keeping them on the stripped record would leave the
  // creature CardInstance to vanish when the character later returns to hand.
  const { toKillPile: pgTrophyKill, toOutOfPlay: pgTrophyOop } =
    partitionLeavingTrophies(s, char, 'press-gang capture');
  const hazardAddsByOwner = new Map<string, CardInstance[]>();
  for (const hazard of char.hazards) {
    const hazOwner = ownerOf(hazard.instanceId) as string;
    const list = hazardAddsByOwner.get(hazOwner) ?? [];
    list.push(toCardInstance(hazard));
    hazardAddsByOwner.set(hazOwner, list);
  }
  logDetail(`Press-gang: capturing ${characterId as string} — discarding ${char.items.length} item(s), ${char.allies.length} ally/allies, ${char.hazards.length} hazard(s); ${char.followers.length} follower(s) revert to GI`);

  const players = s.players.map((p): PlayerState => {
    let characters = p.characters;
    let companies = p.companies;
    let discardPile = p.discardPile;
    let killPile = p.killPile;
    let outOfPlayPile = p.outOfPlayPile;

    if (p.characters[characterId]) {
      // Owner of the pressed character: strip it to a bare off-to-the-side card,
      // free its followers to general influence, and drop it from its company.
      const stripped: CharacterInPlay = { ...char, items: [], allies: [], hazards: [], followers: [], trophies: [] };
      const next: Record<CardInstanceId, CharacterInPlay> = { ...p.characters, [characterId as string]: stripped };
      freeOrDiscardFollowers(s, next, char, 'Press-gang capture');
      // The pressed character is off to the side in no company — if it was itself
      // a follower, drop it from its leader's follower list so nothing stale
      // references it as a company member.
      for (const [cid, cdata] of Object.entries(next)) {
        if (cid === (characterId as string)) continue;
        if (cdata.followers.includes(characterId)) {
          next[cid as CardInstanceId] = { ...cdata, followers: cdata.followers.filter(id => id !== characterId) };
        }
      }
      characters = next;
      companies = p.companies.map(c => ({ ...c, characters: c.characters.filter(id => id !== characterId) }));
      discardPile = [...p.discardPile, ...ownerAdds];
      killPile = [...p.killPile, ...pgTrophyKill];
      outOfPlayPile = [...p.outOfPlayPile, ...pgTrophyOop];
    }

    const hazAdds = hazardAddsByOwner.get(p.id as string);
    if (hazAdds && hazAdds.length > 0) {
      discardPile = [...discardPile, ...hazAdds];
    }

    if (characters === p.characters && companies === p.companies && discardPile === p.discardPile
        && killPile === p.killPile && outOfPlayPile === p.outOfPlayPile) return p;
    return { ...p, characters, companies, discardPile, killPile, outOfPlayPile };
  }) as [PlayerState, PlayerState];

  s = { ...s, players };

  // (5) Mark the character as pressed (negative MP, 0 GI, no untap).
  s = addConstraint(s, {
    source: hostInstanceId,
    sourceDefinitionId: charDefId, // record the pressed character's def for tracing
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId },
    kind: { type: 'character-pressed', hostInstanceId },
  });

  return cleanupEmptyCompanies(s);
}

/**
 * `postReduce` sweep: when a Press-gang host has left play, return every
 * character it still holds to its owner's hand. Mirrors `sweepSetAside` — the
 * single load-bearing disposition point so a pressed character never survives
 * its host as a silent orphan.
 */
export function sweepPressGang(state: GameState): GameState {
  const liveHosts = new Set<string>();
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (c.setAsideHost === undefined) liveHosts.add(c.instanceId as string);
    }
  }

  let s = state;
  for (const con of state.activeConstraints) {
    if (con.target.kind !== 'character' || con.kind.type !== 'character-pressed') continue;
    if (liveHosts.has(con.kind.hostInstanceId as string)) continue;
    logDetail(`sweepPressGang: host ${con.kind.hostInstanceId as string} gone — releasing ${con.target.characterId as string}`);
    s = returnPressedCharacter(s, con.target.characterId);
  }
  return s;
}

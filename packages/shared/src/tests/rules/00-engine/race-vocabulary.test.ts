/**
 * @module race-vocabulary
 *
 * Engine data integrity — the game has exactly one identifier per race.
 *
 * Regression for Not Slay Needlessly (le-212), which lists the races it may be
 * played against. Its `enemy.race` condition carried the printed plural
 * spellings (`"elves"`, `"dwarves"`, `"dúnedain"`, `"men"`) while the engine
 * compares against the canonical singular race a site's automatic-attack
 * normalizes to (`"elf"`, `"dwarf"`, `"dunadan"`, `"man"`), so the card was
 * never offered on a Dúnedain or Elves automatic-attack. Star-glass (tw-330)
 * had the identical defect with `"spiders"/"animals"/"wolves"`, and the card
 * data at large mixed the two spellings — the same race written two ways, one
 * of which silently matched nothing.
 *
 * These assertions close the vocabulary: {@link Race} is the only race
 * namespace, every race-typed value in the card data must be exactly one of
 * its members (never a comma-joined list — a creature with several races puts
 * the extras in `additionalRaces`), and every printed automatic-attack label
 * must normalize into it or into `undefined`. Adding a race therefore means
 * adding it to the enum first.
 */

import { describe, test, expect } from 'vitest';
import { Race } from '../../../index.js';
import { normalizeCreatureRace } from '../../../engine/effects/index.js';
import { collectRaceValuesFromCardData, collectCreatureTypesFromCardData } from '../../test-helpers.js';
import { loadCardPool } from '../../../data/index.js';

/**
 * Automatic-attack labels that name no race at all: Vile Fumes' "Gas" attack
 * and the empty label carried by runtime-injected attacks. They normalize to
 * `undefined` and match no race condition, which is the intended behaviour.
 */
const NON_RACE_ATTACK_LABELS: readonly string[] = ['gas', ''];

describe('race vocabulary', () => {
  const canonical = new Set<string>(Object.values(Race));
  const pool = loadCardPool();

  test('every race value in the card data is a canonical Race', () => {
    const offenders = collectRaceValuesFromCardData()
      .filter(entry => !canonical.has(entry.value))
      .map(entry => `${entry.cardId} ${entry.key}: "${entry.value}"`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  test('no race is spelled two ways — plural and accented forms are absent', () => {
    const banned = ['orcs', 'elves', 'dwarves', 'wolves', 'spiders', 'trolls', 'men',
      'animals', 'giants', 'dragons', 'drakes', 'hobbits', 'woses', 'ents', 'eagles',
      'dúnedain', 'dúnadan', 'nazgûl', 'nazgul', 'pûkel-creature'];
    const offenders = collectRaceValuesFromCardData()
      .filter(entry => banned.includes(entry.value.toLowerCase()))
      .map(entry => `${entry.cardId} ${entry.key}: "${entry.value}"`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  test('a race-typed value is a single race — none packs several into one string', () => {
    // Beorning Skin-changers (ba-10) "Animals. Men. Bears.", Goblin-faces
    // (wh-13) "Orcs. Men." and Durin's Bane (dm-107) each used to store
    // `"animal,man,bear"`-style values that equalled no race and so matched
    // nothing; the extra races belong in `additionalRaces`.
    const offenders = collectRaceValuesFromCardData()
      .filter(entry => entry.value.includes(','))
      .map(entry => `${entry.cardId} ${entry.key}: "${entry.value}"`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  test('multi-race creatures name their primary race first and the rest separately', () => {
    const multi = Object.values(pool)
      .filter((def): def is typeof def & { additionalRaces: readonly Race[] } =>
        Array.isArray((def as { additionalRaces?: unknown }).additionalRaces));
    expect(multi.map(def => def.id as string).sort())
      .toEqual(['ba-10', 'dm-107', 'wh-13']);
    for (const def of multi) {
      const primary = (def as unknown as { race: Race }).race;
      expect(canonical.has(primary)).toBe(true);
      for (const extra of def.additionalRaces) {
        expect(canonical.has(extra)).toBe(true);
        // The extras genuinely add to the primary rather than repeating it.
        expect(extra).not.toBe(primary);
      }
    }
  });

  test('every printed automatic-attack label normalizes to a canonical Race', () => {
    const offenders = collectCreatureTypesFromCardData()
      .filter(entry => !NON_RACE_ATTACK_LABELS.includes(entry.value.toLowerCase()))
      .filter(entry => normalizeCreatureRace(entry.value) === undefined)
      .map(entry => `${entry.cardId} ${entry.key}: "${entry.value}"`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  test('a label that names no race normalizes to undefined, not to itself', () => {
    // Keeps "gas" (Vile Fumes wh-54) and the empty injected-attack label out of
    // every Race-typed slot instead of letting them pose as a race.
    for (const label of NON_RACE_ATTACK_LABELS) {
      expect(normalizeCreatureRace(label)).toBeUndefined();
    }
  });

  test('the plural labels the cards print normalize onto the singular races', () => {
    expect(normalizeCreatureRace('Elves')).toBe(Race.Elf);
    expect(normalizeCreatureRace('Dúnedain')).toBe(Race.Dunadan);
    expect(normalizeCreatureRace('Men')).toBe(Race.Man);
    expect(normalizeCreatureRace('Dwarves')).toBe(Race.Dwarf);
    expect(normalizeCreatureRace('Nazgûl')).toBe(Race.Ringwraith);
    expect(normalizeCreatureRace('Pûkel-creature')).toBe(Race.PukelCreature);
  });

  test('Not Slay Needlessly (le-212) keys off the canonical races it names', () => {
    const races = collectRaceValuesFromCardData()
      .filter(entry => entry.cardId === 'le-212')
      .map(entry => entry.value);
    expect([...new Set(races)].sort()).toEqual([Race.Dunadan, Race.Dwarf, Race.Elf, Race.Man].sort());
  });

  test('Star-glass (tw-330) keys off the canonical races it names', () => {
    const races = collectRaceValuesFromCardData()
      .filter(entry => entry.cardId === 'tw-330')
      .map(entry => entry.value);
    // Spiders/Animals/Wolves for the +1 prowess mode, Undead for the tap-to-cancel mode.
    expect([...new Set(races)].sort())
      .toEqual([Race.Animal, Race.Spider, Race.Undead, Race.Wolf].sort());
  });
});

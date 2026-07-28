/**
 * @module ai/h2/architecture.test
 *
 * Structural guards against the failure mode §9 of the plan calls "module
 * sprawl / hidden coupling".
 *
 * These are written before the modules exist deliberately. A rule that arrives
 * after the second module has already reached into the first is a rule nobody
 * can enforce without a refactor; a rule that is already failing the moment
 * the import is written costs one line to obey.
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_MODULES } from './core/registry.js';

const H2_ROOT = __dirname;
const MODULES_DIR = path.join(H2_ROOT, 'modules');
const SERVICES_DIR = path.join(H2_ROOT, 'services');
const CORE_DIR = path.join(H2_ROOT, 'core');

/** Every `.ts` source file under a directory, tests excluded. */
function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Import specifiers used by a source file. */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, 'utf-8');
  return [...source.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
}

/**
 * Which module a path belongs to, or `null` when it is outside `modules/`.
 * Works for both layouts — `modules/combat.ts` and `modules/combat/x.ts` —
 * so the guard does not quietly stop applying if the layout changes.
 */
function moduleOwning(target: string): string | null {
  const relative = path.relative(MODULES_DIR, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [head] = relative.split(path.sep);
  return head.endsWith('.ts') ? head.slice(0, -'.ts'.length) : head.replace(/\.js$/, '');
}

describe('module boundaries', () => {
  test('no module imports another module directly', () => {
    // Cross-module access goes through a declared service on the module
    // context, which is what lets `combat` be tested against a stub `hand`
    // and lets a module be ablated in a gate without dragging its neighbours
    // along.
    const offenders: string[] = [];
    for (const file of sourceFiles(MODULES_DIR)) {
      const own = moduleOwning(file);
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = moduleOwning(path.resolve(path.dirname(file), specifier));
        if (target !== null && target !== own) {
          offenders.push(`${path.relative(H2_ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('a service never reaches into a module', () => {
    // The direction of the dependency is the whole design: a service is a
    // number more than one module needs, so a service that imported a module
    // would make that module's opinion everyone's. It is also the rule that
    // decides where new code goes — `denial` started inside `hazards` and had
    // to move the moment `card-price` needed it, and this test is what says so
    // rather than a reviewer noticing.
    const offenders: string[] = [];
    for (const file of sourceFiles(SERVICES_DIR)) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        if (moduleOwning(target) !== null) {
          offenders.push(`${path.relative(H2_ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('core depends on nothing above it', () => {
    // `core` is the vocabulary — TSD, dice, the risk oracle, the rationale
    // tree. A service or module leaking into it would make the vocabulary
    // depend on one of the things that speaks it.
    const offenders: string[] = [];
    for (const file of sourceFiles(CORE_DIR)) {
      // The registry is the one place that names every module — that is what a
      // registry is. Exempting it by name rather than by pattern keeps the
      // exception to exactly one file.
      if (path.basename(file) === 'registry.ts') continue;
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        const inServices = !path.relative(SERVICES_DIR, target).startsWith('..');
        if (moduleOwning(target) !== null || inServices) {
          offenders.push(`${path.relative(H2_ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the ownership registry has no duplicate names or contested action types', () => {
    const names = ALL_MODULES.map(m => m.name);
    expect(new Set(names).size).toBe(names.length);

    // Two modules may own the same action type — `pass` means something
    // different everywhere, and `cancel-attack` is a tactical question for
    // `combat` and a portfolio one for `kill`. What they may not do is rely on
    // registry order to tell them apart: every owner of a shared type must
    // define a `claims()` gate, so the separation is stated in the module
    // rather than implied by an array's ordering.
    const owners = new Map<string, string[]>();
    for (const module of ALL_MODULES) {
      for (const type of module.ownedActionTypes) {
        owners.set(type, [...(owners.get(type) ?? []), module.name]);
      }
    }
    const ungated: string[] = [];
    for (const [type, names] of owners) {
      if (names.length < 2) continue;
      for (const name of names) {
        const module = ALL_MODULES.find(m => m.name === name)!;
        if (!module.claims) ungated.push(`${type}: ${name} shares it but has no claims() gate`);
      }
    }
    expect(ungated).toEqual([]);
  });
});

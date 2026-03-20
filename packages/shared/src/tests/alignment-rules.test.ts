import { describe, it, expect } from 'vitest';
import { getAlignmentRules } from '../alignment-rules.js';
import { Alignment } from '../types/common.js';

describe('getAlignmentRules', () => {
  it('wizard has max 5 starting characters and 1 starting site', () => {
    const rules = getAlignmentRules(Alignment.Wizard);
    expect(rules.maxStartingCompanySize).toBe(5);
    expect(rules.maxStartingSites).toBe(1);
  });

  it('ringwraith has max 6 starting characters and 2 starting sites', () => {
    const rules = getAlignmentRules(Alignment.Ringwraith);
    expect(rules.maxStartingCompanySize).toBe(6);
    expect(rules.maxStartingSites).toBe(2);
  });

  it('balrog has max 6 starting characters and 2 starting sites', () => {
    const rules = getAlignmentRules(Alignment.Balrog);
    expect(rules.maxStartingCompanySize).toBe(6);
    expect(rules.maxStartingSites).toBe(2);
  });

  it('fallen-wizard has max 5 starting characters and 1 starting site', () => {
    const rules = getAlignmentRules(Alignment.FallenWizard);
    expect(rules.maxStartingCompanySize).toBe(5);
    expect(rules.maxStartingSites).toBe(1);
  });

  it('all alignments have at least one default starting site', () => {
    for (const alignment of Object.values(Alignment)) {
      const rules = getAlignmentRules(alignment);
      expect(rules.defaultStartingSites.length).toBeGreaterThanOrEqual(1);
    }
  });
});

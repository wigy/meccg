/**
 * @module rule-8.35-prisoners
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.35: Prisoners
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Certain hazards may have an effect on an attack or strike that results in a character being taken prisoner. These hazards are called "hazard hosts," and will take the character prisoner at a site called the "rescue site."
 * A hazard host can only be played if the rescue site is available to come from the hazard player's location deck AND if that rescue site adheres to the following restrictions:
 * • If the character is moving with Starter Movement, the rescue site must be located in the region containing the site of origin or the region containing the new site.
 * • If the character is moving with Region Movement, the rescue site must be located in a region in which the character was moving or in a region adjacent to a region in which the character was moving.
 * • If the character is not moving, the rescue site must be located in the same region as the character's site.
 * If a character is at or moving to a site adjacent to an Under-deeps site, the rescue site may be that Under-deeps site (even if the character is not using Under-deeps Movement).
 * When a character is taken prisoner, all of its followers revert to general influence but their mind value(s) are not subtracted from general influence until their player's next organization phase. Any other non-ring cards on the character taken prisoner are immediately discarded.
 * While taken prisoner, a character does not cost influence to control, cannot take any actions including healing or untapping, cannot be affected except by cards that specifically affect prisoners, and is worth negative marshalling points to its player (and continues to be worth negative marshalling points if eliminated while prisoner).
 */

import { describe, test } from 'vitest';

describe('Rule 8.35 — Prisoners', () => {
  test.todo('Hazard hosts take characters prisoner at rescue site; followers revert to GI; prisoner cannot act; worth negative MP');
});

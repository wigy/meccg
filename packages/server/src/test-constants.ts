import type { PlayerId, CardDefinitionId } from '@meccg/shared';

const did = (s: string) => s as CardDefinitionId;

// ---- Players ----

export const PLAYER_1 = 'p1' as PlayerId;
export const PLAYER_2 = 'p2' as PlayerId;

// ---- Characters ----

export const GANDALF = did('tw-156');
export const ARAGORN = did('tw-120');
export const LEGOLAS = did('tw-168');
export const GIMLI = did('tw-159');
export const FRODO = did('tw-152');
export const FARAMIR = did('tw-149');
export const BILBO = did('tw-131');

// ---- Items ----

export const GLAMDRING = did('tw-244');
export const STING = did('tw-333');
export const THE_ONE_RING = did('tw-347');
export const THE_MITHRIL_COAT = did('tw-345');
export const DAGGER_OF_WESTERNESSE = did('tw-206');

// ---- Creatures ----

export const CAVE_DRAKE = did('tw-020');
export const ORC_PATROL = did('tw-074');
export const BARROW_WIGHT = did('tw-015');

// ---- Sites ----

export const RIVENDELL = did('tw-421');
export const LORIEN = did('tw-408');
export const MORIA = did('tw-413');
export const MINAS_TIRITH = did('tw-412');
export const MOUNT_DOOM = did('tw-414');

// ---- Regions ----

export const RHUDAUR = did('tw-482');
export const HOLLIN = did('tw-466');
export const ROHAN = did('tw-483');
export const ITHILIEN = did('tw-470');

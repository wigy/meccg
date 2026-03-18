import {
  CardDefinitionId,
  Race,
  Skill,
  RegionType,
  SiteType,
  MarshallingCategory,
} from './common.js';

// ---- Hero Character ----

export interface HeroCharacterCard {
  readonly cardType: 'hero-character';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: true;
  readonly race: Race;
  readonly skills: readonly Skill[];
  readonly prowess: number;
  readonly body: number;
  readonly mind: number | null;
  readonly directInfluence: number;
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory.Character;
  readonly corruptionModifier: number;
  readonly homesite: string;
}

// ---- Hero Resources ----

export type ItemSubtype = 'minor' | 'major' | 'greater' | 'gold-ring' | 'special';

export interface ItemCard {
  readonly cardType: 'hero-resource-item';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly subtype: ItemSubtype;
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory.Item;
  readonly corruptionPoints: number;
  readonly prowessModifier: number;
  readonly bodyModifier: number;
  readonly playableAt: readonly SiteType[];
}

export interface FactionCard {
  readonly cardType: 'hero-resource-faction';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: true;
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory.Faction;
  readonly influenceNumber: number;
  readonly race: Race;
  readonly playableAt: string;
}

export interface AllyCard {
  readonly cardType: 'hero-resource-ally';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly prowess: number;
  readonly body: number;
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory.Ally;
  readonly playableAt: readonly SiteType[];
}

export interface HeroResourceEventCard {
  readonly cardType: 'hero-resource-event';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly eventType: 'short' | 'long' | 'permanent';
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory.Misc;
}

// ---- Hazards ----

export interface CreatureKeyRestriction {
  readonly regionTypes?: readonly RegionType[];
  readonly regionNames?: readonly string[];
  readonly siteTypes?: readonly SiteType[];
}

export interface CreatureCard {
  readonly cardType: 'hazard-creature';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly strikes: number;
  readonly prowess: number;
  readonly body: number | null;
  readonly killMarshallingPoints: number;
  readonly keyedTo: readonly CreatureKeyRestriction[];
}

export interface HazardEventCard {
  readonly cardType: 'hazard-event';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly eventType: 'short' | 'long' | 'permanent';
}

export interface CorruptionCard {
  readonly cardType: 'hazard-corruption';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly unique: boolean;
  readonly corruptionPoints: number;
}

// ---- Sites & Regions ----

export type PlayableResourceType = ItemSubtype | 'faction' | 'ally' | 'information';

export interface AutomaticAttack {
  readonly creatureType: string;
  readonly strikes: number;
  readonly prowess: number;
}

export interface HeroSiteCard {
  readonly cardType: 'hero-site';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly siteType: SiteType;
  readonly sitePath: readonly RegionType[];
  readonly nearestHaven: string;
  readonly playableResources: readonly PlayableResourceType[];
  readonly automaticAttacks: readonly AutomaticAttack[];
}

export interface RegionCard {
  readonly cardType: 'region';
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly regionType: RegionType;
  readonly adjacentRegions: readonly string[];
}

// ---- Union types ----

export type HeroResourceCard = ItemCard | FactionCard | AllyCard | HeroResourceEventCard;
export type HazardCard = CreatureCard | HazardEventCard | CorruptionCard;
export type PlayDeckCard = HeroResourceCard | HazardCard;
export type CardDefinition =
  | HeroCharacterCard
  | ItemCard
  | FactionCard
  | AllyCard
  | HeroResourceEventCard
  | CreatureCard
  | HazardEventCard
  | CorruptionCard
  | HeroSiteCard
  | RegionCard;

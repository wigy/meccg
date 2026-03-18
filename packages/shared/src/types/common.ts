// Branded ID types for type safety
export type PlayerId = string & { readonly __brand: 'PlayerId' };
export type CardInstanceId = string & { readonly __brand: 'CardInstanceId' };
export type CardDefinitionId = string & { readonly __brand: 'CardDefinitionId' };
export type CompanyId = string & { readonly __brand: 'CompanyId' };

// Dice
export type DieRoll = 1 | 2 | 3 | 4 | 5 | 6;
export interface TwoDiceSix {
  readonly die1: DieRoll;
  readonly die2: DieRoll;
}

// Enums
export enum Race {
  Hobbit = 'hobbit',
  Elf = 'elf',
  Dwarf = 'dwarf',
  Dunadan = 'dunadan',
  Man = 'man',
  Wizard = 'wizard',
}

export enum Skill {
  Warrior = 'warrior',
  Scout = 'scout',
  Ranger = 'ranger',
  Sage = 'sage',
  Diplomat = 'diplomat',
}

export enum RegionType {
  Wilderness = 'wilderness',
  Shadow = 'shadow',
  Dark = 'dark',
  Coastal = 'coastal',
  Free = 'free',
  Border = 'border',
}

export enum SiteType {
  Haven = 'haven',
  FreeHold = 'free-hold',
  BorderHold = 'border-hold',
  RuinsAndLairs = 'ruins-and-lairs',
  ShadowHold = 'shadow-hold',
  DarkHold = 'dark-hold',
}

export enum MarshallingCategory {
  Character = 'character',
  Item = 'item',
  Faction = 'faction',
  Ally = 'ally',
  Kill = 'kill',
  Misc = 'misc',
}

export enum WizardName {
  Gandalf = 'gandalf',
  Saruman = 'saruman',
  Radagast = 'radagast',
  Alatar = 'alatar',
  Pallando = 'pallando',
}

export enum CharacterStatus {
  Untapped = 'untapped',
  Tapped = 'tapped',
  Wounded = 'wounded',
}

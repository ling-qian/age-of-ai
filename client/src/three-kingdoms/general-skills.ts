/**
 * Serializable signature-skill data for Three Kingdoms generals.
 *
 * This is a serializable data registry. battle-engine.ts validates ownership,
 * target patterns, resource limits, and deterministic effect resolution. Keeping
 * definitions data-only makes ownership and balance auditable and save-safe.
 */
export type GeneralSkillTarget =
  | 'self'
  | 'ally'
  | 'enemy'
  | 'enemy_frontline'
  | 'enemy_all';

export type GeneralSkillEffect =
  | { type: 'heal_troops'; amount: number }
  | { type: 'damage'; multiplier: number }
  | { type: 'suppress'; durationRounds: number; outgoingDamageMultiplier: number }
  | { type: 'guard'; durationRounds: number };

export interface GeneralSkillDefinition {
  id: string;
  ownerGeneralId: string;
  name: string;
  description: string;
  target: GeneralSkillTarget;
  cooldownRounds: number;
  usesPerBattle: number;
  effect: GeneralSkillEffect;
}

export interface GeneralSkillState {
  skillId: string;
  cooldownRemaining: number;
  usesRemaining: number;
}

/**
 * Initial M2-C balance baseline (balance set m2c-alpha-1).
 * Values are explicit and versioned so later tuning is reviewable. These
 * definitions are executed by the deterministic M2-C combat rules.
 */
export const GENERAL_SKILL_BALANCE_VERSION = 'm2c-alpha-1';

export const GENERAL_SKILLS: readonly GeneralSkillDefinition[] = [
  {
    id: 'liu-bei-rende',
    ownerGeneralId: 'liu-bei',
    name: 'Benevolence (Rende)',
    description: 'Restore 35 troops to one allied unit.',
    target: 'ally',
    cooldownRounds: 2,
    usesPerBattle: 2,
    effect: { type: 'heal_troops', amount: 35 },
  },
  {
    id: 'guan-yu-qinglong-strike',
    ownerGeneralId: 'guan-yu',
    name: 'Azure Dragon Strike',
    description: 'Deal 1.65× normal attack casualties to one enemy.',
    target: 'enemy',
    cooldownRounds: 3,
    usesPerBattle: 2,
    effect: { type: 'damage', multiplier: 1.65 },
  },
  {
    id: 'zhang-fei-thunderous-roar',
    ownerGeneralId: 'zhang-fei',
    name: 'Thunderous Roar',
    description: 'Suppress one enemy frontline unit’s next outgoing attack at 0.65× damage.'
    target: 'enemy_frontline',
    cooldownRounds: 3,
    usesPerBattle: 1,
    effect: { type: 'suppress', durationRounds: 1, outgoingDamageMultiplier: 0.65 },
  },
] satisfies readonly GeneralSkillDefinition[];

const skillsById = new Map(GENERAL_SKILLS.map((skill) => [skill.id, skill]));
const skillsByOwner = new Map(GENERAL_SKILLS.map((skill) => [skill.ownerGeneralId, skill]));

export function getGeneralSkillById(skillId: string): GeneralSkillDefinition | undefined {
  return skillsById.get(skillId);
}

export function getGeneralSkillForOwner(generalId: string): GeneralSkillDefinition | undefined {
  return skillsByOwner.get(generalId);
}

export function createInitialGeneralSkillState(skillId: string): GeneralSkillState {
  const definition = getGeneralSkillById(skillId);
  if (!definition) throw new Error(`Unknown general skill: ${skillId}`);
  return {
    skillId: definition.id,
    cooldownRemaining: 0,
    usesRemaining: definition.usesPerBattle,
  };
}

/** Fail fast if the static roster accidentally contains duplicate IDs/owners. */
export function validateGeneralSkillRegistry(): void {
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const skill of GENERAL_SKILLS) {
    if (!skill.id.trim() || !skill.ownerGeneralId.trim()) {
      throw new Error('General skill IDs and owner IDs must be non-empty');
    }
    if (ids.has(skill.id)) throw new Error(`Duplicate general skill ID: ${skill.id}`);
    if (owners.has(skill.ownerGeneralId)) throw new Error(`Duplicate skill owner: ${skill.ownerGeneralId}`);
    ids.add(skill.id);
    owners.add(skill.ownerGeneralId);
    if (!Number.isInteger(skill.cooldownRounds) || skill.cooldownRounds < 0) {
      throw new Error(`Invalid cooldown for skill ${skill.id}`);
    }
    if (!Number.isInteger(skill.usesPerBattle) || skill.usesPerBattle < 1) {
      throw new Error(`Invalid use limit for skill ${skill.id}`);
    }
    if (skill.effect.type === 'heal_troops' && (!Number.isInteger(skill.effect.amount) || skill.effect.amount < 1)) {
      throw new Error(`Invalid healing amount for skill ${skill.id}`);
    }
    if (skill.effect.type === 'damage' && (!Number.isFinite(skill.effect.multiplier) || skill.effect.multiplier <= 1)) {
      throw new Error(`Invalid damage multiplier for skill ${skill.id}`);
    }
    if (skill.effect.type === 'suppress'
      && (!Number.isInteger(skill.effect.durationRounds) || skill.effect.durationRounds < 1
        || !Number.isFinite(skill.effect.outgoingDamageMultiplier)
        || skill.effect.outgoingDamageMultiplier < 0
        || skill.effect.outgoingDamageMultiplier > 1)) {
      throw new Error(`Invalid suppression effect for skill ${skill.id}`);
    }
    if (skill.effect.type === 'guard'
      && (!Number.isInteger(skill.effect.durationRounds) || skill.effect.durationRounds < 1)) {
      throw new Error(`Invalid guard effect for skill ${skill.id}`);
    }
  }
}

validateGeneralSkillRegistry();

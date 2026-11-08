import {
  createInitialGeneralSkillState,
  getGeneralSkillById,
  getGeneralSkillForOwner,
  type GeneralSkillDefinition,
  type GeneralSkillState,
} from './general-skills';

/**
 * Deterministic, single-player Three Kingdoms tactical battle rules.
 *
 * This module is deliberately isolated from the Age of AI real-time RTS.
 * It has no browser, DOM, network, storage, clock, or random-global dependency.
 */

export type BattleSide = 'player' | 'enemy';
export type UnitClass = 'infantry' | 'archer' | 'cavalry';
export type Formation = 'arrow' | 'square' | 'wedge' | 'turtle';
export type DeploymentDepth = 'front' | 'middle' | 'rear';
export type DeploymentLane = 'left' | 'center' | 'right';
export type DeploymentSlot =
  | 'front-left' | 'front-center' | 'front-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'rear-left' | 'rear-center' | 'rear-right';
export interface DeploymentAssignment { unitId: string; slot: DeploymentSlot; }

export const DEPLOYMENT_SLOTS: readonly DeploymentSlot[] = [
  'front-left', 'front-center', 'front-right',
  'middle-left', 'middle-center', 'middle-right',
  'rear-left', 'rear-center', 'rear-right',
];

const DEFAULT_DEPLOYMENT_SLOTS: readonly DeploymentSlot[] = [
  'front-center', 'front-left', 'front-right',
];

const DEPLOYMENT_DEPTH_ORDER: Record<DeploymentDepth, number> = { front: 0, middle: 1, rear: 2 };

export function getDeploymentDepth(slot: DeploymentSlot): DeploymentDepth {
  return slot.split('-')[0] as DeploymentDepth;
}

export function getDeploymentLane(slot: DeploymentSlot): DeploymentLane {
  return slot.split('-')[1] as DeploymentLane;
}
export type BattleOutcome = 'victory' | 'defeat' | 'draw';

export interface GeneralStats {
  martial: number;
  intelligence: number;
  leadership: number;
}

export interface BattleUnitConfig {
  id: string;
  generalId: string;
  name: string;
  unitClass: UnitClass;
  stats: GeneralStats;
  troops: number;
  maxTroops: number;
  /** Set only when this unit is a named general with a registered personal skill. */
  skillId?: string | null;
  /** Optional pre-battle slot; omitted configs receive deterministic front-row defaults. */
  slot?: DeploymentSlot;
}

export interface BattleConfig {
  playerUnits: BattleUnitConfig[];
  enemyUnits: BattleUnitConfig[];
}

export interface BattleUnit extends BattleUnitConfig {
  slot: DeploymentSlot;
  side: BattleSide;
  skillId: string | null;
  skillState: GeneralSkillState | null;
  /** Last round in which suppression can affect an outgoing attack; optional for older v2 saves. */
  suppressedUntilRound?: number | null;
  schemeUsed: boolean;
  guarded: boolean;
  suppressed: boolean;
}

export type UnitOrder =
  | { unitId: string; type: 'attack'; targetId: string }
  | { unitId: string; type: 'scheme'; targetId: string }
  | { unitId: string; type: 'skill'; targetId?: string }
  | { unitId: string; type: 'wait' };

export interface RoundInput {
  formations: Record<BattleSide, Formation>;
  orders: UnitOrder[];
}

export type BattleLogEntry =
  | { type: 'battle_started'; round: number; playerUnitIds: string[]; enemyUnitIds: string[] }
  | { type: 'deployment_changed'; round: number; side: BattleSide; assignments: DeploymentAssignment[] }
  | { type: 'formation_selected'; round: number; side: BattleSide; formation: Formation }
  | { type: 'unit_attacked'; round: number; attackerId: string; targetId: string; hitChance: number; roll: number; hit: boolean }
  | { type: 'troops_lost'; round: number; targetId: string; casualties: number; remainingTroops: number }
  | { type: 'scheme_attempted'; round: number; casterId: string; targetId: string; successChance: number; roll: number; success: boolean }
  | { type: 'general_skill_used'; round: number; skillId: string; casterId: string; targetId: string; effectType: 'heal_troops' | 'damage' | 'suppress' | 'guard'; success: boolean }
  | { type: 'troops_restored'; round: number; targetId: string; amount: number; remainingTroops: number }
  | { type: 'unit_guarded'; round: number; unitId: string }
  | { type: 'unit_defeated'; round: number; unitId: string; side: BattleSide }
  | { type: 'order_skipped'; round: number; unitId: string; reason: 'unit_defeated' | 'target_defeated' | 'target_invalid' }
  | { type: 'battle_finished'; round: number; outcome: BattleOutcome; playerTroops: number; enemyTroops: number };

export interface BattleState {
  version: 3;
  round: number;
  phase: 'ready' | 'finished';
  rngState: number;
  formations: Record<BattleSide, Formation>;
  units: BattleUnit[];
  outcome: BattleOutcome | null;
  log: BattleLogEntry[];
}

export const BATTLE_RULES = {
  version: 1,
  unitsPerSide: 3,
  maxRounds: 20,
  seedFallback: 0x6d2b79f5,
  hitChanceMin: 5,
  hitChanceMax: 95,
  schemeChanceMin: 10,
  schemeChanceMax: 90,
  baseCasualties: 35,
  martialCasualtyWeight: 0.75,
  leadershipCasualtyWeight: 0.25,
  minimumCasualties: 1,
  strengthBase: 0.5,
  strengthTroopWeight: 0.5,
  arrowOutgoingMultiplier: 1.15,
  squareIncomingMultiplier: 0.8,
  wedgeCavalryOutgoingMultiplier: 1.3,
  wedgeOtherOutgoingMultiplier: 0.9,
  turtleOutgoingMultiplier: 0.85,
  turtleIncomingMultiplier: 0.75,
  cavalryFlankMultiplier: 1.2,
  guardMultiplier: 0.7,
  suppressionMultiplier: 0.65,
  schemeBaseChance: 50,
  schemeIntelligenceWeight: 0.5,
  classHitChance: {
    infantry: { infantry: 50, archer: 80, cavalry: 20 },
    archer: { infantry: 20, archer: 50, cavalry: 60 },
    cavalry: { infantry: 80, archer: 60, cavalry: 50 },
  } satisfies Record<UnitClass, Record<UnitClass, number>>,
} as const;

const UINT32_MAX = 0xffff_ffff;

function fail(message: string): never {
  throw new Error(`Invalid battle state/input: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} must be a non-empty string`);
}

function assertInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer in [${min}, ${max}]`);
  }
}

function assertStats(value: unknown, label: string): asserts value is GeneralStats {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assertInteger(value.martial, 1, 100, `${label}.martial`);
  assertInteger(value.intelligence, 1, 100, `${label}.intelligence`);
  assertInteger(value.leadership, 1, 100, `${label}.leadership`);
}

function assertUnitClass(value: unknown, label: string): asserts value is UnitClass {
  if (value !== 'infantry' && value !== 'archer' && value !== 'cavalry') {
    fail(`${label} must be infantry, archer, or cavalry`);
  }
}

function assertSide(value: unknown, label: string): asserts value is BattleSide {
  if (value !== 'player' && value !== 'enemy') fail(`${label} must be player or enemy`);
}

function assertFormation(value: unknown, label: string): asserts value is Formation {
  if (value !== 'arrow' && value !== 'square' && value !== 'wedge' && value !== 'turtle') {
    fail(`${label} must be arrow, square, wedge, or turtle`);
  }
}

function assertDeploymentSlot(value: unknown, label: string): asserts value is DeploymentSlot {
  if (typeof value !== 'string' || !DEPLOYMENT_SLOTS.includes(value as DeploymentSlot)) {
    fail(`${label} is not a valid 3x3 deployment slot`);
  }
}

function assertUnitCore(value: unknown, label: string, allowZeroTroops: boolean): asserts value is BattleUnit {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.generalId, `${label}.generalId`);
  assertNonEmptyString(value.name, `${label}.name`);
  assertDeploymentSlot(value.slot, `${label}.slot`);
  assertSide(value.side, `${label}.side`);
  assertUnitClass(value.unitClass, `${label}.unitClass`);
  assertStats(value.stats, `${label}.stats`);
  assertInteger(value.maxTroops, 1, 1_000_000, `${label}.maxTroops`);
  assertInteger(value.troops, allowZeroTroops ? 0 : 1, value.maxTroops, `${label}.troops`);
  if (typeof value.skillId !== 'string' && value.skillId !== null) fail(`${label}.skillId must be a string or null`);
  const registeredSkill = getGeneralSkillForOwner(value.generalId);
  if (value.skillId === null) {
    if (value.skillState !== null) fail(`${label} without a skill cannot have skill state`);
  } else {
    assertNonEmptyString(value.skillId, `${label}.skillId`);
    const definition = getGeneralSkillById(value.skillId);
    if (!definition) fail(`${label} references unknown skill ${value.skillId}`);
    if (definition.ownerGeneralId !== value.generalId) fail(`${label} does not own skill ${value.skillId}`);
    if (!isRecord(value.skillState)) fail(`${label}.skillState must be an object`);
    if (value.skillState.skillId !== value.skillId) fail(`${label}.skillState skill ID does not match unit`);
    assertInteger(value.skillState.cooldownRemaining, 0, definition.cooldownRounds, `${label}.skillState.cooldownRemaining`);
    assertInteger(value.skillState.usesRemaining, 0, definition.usesPerBattle, `${label}.skillState.usesRemaining`);
  }
  if (registeredSkill && value.skillId !== registeredSkill.id) {
    fail(`${label} is missing its registered personal skill ${registeredSkill.id}`);
  }
  if (value.suppressedUntilRound !== undefined && value.suppressedUntilRound !== null) {
    assertInteger(value.suppressedUntilRound, 1, BATTLE_RULES.maxRounds + 1, `${label}.suppressedUntilRound`);
    if (value.suppressed !== true) fail(`${label}.suppressedUntilRound requires suppressed status`);
  }
  if (typeof value.schemeUsed !== 'boolean' || typeof value.guarded !== 'boolean' || typeof value.suppressed !== 'boolean') {
    fail(`${label} status flags must be booleans`);
  }
}

/** Unicode code-point comparison; never depends on locale or host settings. */
export function compareIdsByCodePoint(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0) ?? 0);
  const right = Array.from(b, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Explicit hit-chance safety clamp; exported so both rule boundaries are testable. */
export function clampHitChance(value: number): number {
  if (!Number.isFinite(value)) fail('hit chance must be finite');
  return clamp(value, BATTLE_RULES.hitChanceMin, BATTLE_RULES.hitChanceMax);
}

export function calculateHitChance(attacker: BattleUnit, defender: BattleUnit): number {
  const base = BATTLE_RULES.classHitChance[attacker.unitClass][defender.unitClass];
  const leadershipAdjustment = Math.round((attacker.stats.martial - defender.stats.leadership) * 0.10);
  return clampHitChance(base + leadershipAdjustment);
}

export function calculateSchemeChance(caster: BattleUnit, target: BattleUnit): number {
  const intelligenceAdjustment = Math.round(
    (caster.stats.intelligence - target.stats.intelligence) * BATTLE_RULES.schemeIntelligenceWeight,
  );
  return clamp(
    BATTLE_RULES.schemeBaseChance + intelligenceAdjustment,
    BATTLE_RULES.schemeChanceMin,
    BATTLE_RULES.schemeChanceMax,
  );
}

/**
 * Xorshift32. The returned roll is an integer 0..99. A zero state is replaced
 * with the documented non-zero fallback so the generator cannot get stuck.
 */
export function nextRandom(state: number): { value: number; state: number } {
  assertInteger(state, 0, UINT32_MAX, 'rngState');
  let next = state === 0 ? BATTLE_RULES.seedFallback : state;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { value: next % 100, state: next };
}

function assertBattleState(state: unknown, allowFinished: boolean): asserts state is BattleState {
  if (!isRecord(state)) fail('state must be an object');
  if (state.version !== 3) fail('unsupported state version');
  assertInteger(state.round, 1, BATTLE_RULES.maxRounds, 'state.round');
  if (state.phase !== 'ready' && state.phase !== 'finished') fail('state.phase is invalid');
  if (!allowFinished && state.phase !== 'ready') fail('battle is already finished');
  assertInteger(state.rngState, 1, UINT32_MAX, 'state.rngState');
  if (!isRecord(state.formations)) fail('state.formations must be an object');
  assertFormation(state.formations.player, 'state.formations.player');
  assertFormation(state.formations.enemy, 'state.formations.enemy');
  if (!Array.isArray(state.units) || state.units.length !== BATTLE_RULES.unitsPerSide * 2) {
    fail('state must contain exactly three units per side');
  }
  const ids = new Set<string>();
  const sideCounts: Record<BattleSide, number> = { player: 0, enemy: 0 };
  const occupiedSlots: Record<BattleSide, Set<DeploymentSlot>> = { player: new Set(), enemy: new Set() };
  for (const [index, candidate] of state.units.entries()) {
    assertUnitCore(candidate, `state.units[${index}]`, true);
    if (ids.has(candidate.id)) fail(`duplicate unit id: ${candidate.id}`);
    ids.add(candidate.id);
    if (occupiedSlots[candidate.side].has(candidate.slot)) fail(`duplicate ${candidate.side} deployment slot ${candidate.slot}`);
    occupiedSlots[candidate.side].add(candidate.slot);
    sideCounts[candidate.side]++;
  }
  if (sideCounts.player !== 3 || sideCounts.enemy !== 3) fail('state must contain three player and three enemy units');
  if (!Array.isArray(state.log)) fail('state.log must be an array');
  if (state.phase === 'ready' && state.outcome !== null) fail('ready battle cannot have an outcome');
  if (state.phase === 'finished' && state.outcome !== 'victory' && state.outcome !== 'defeat' && state.outcome !== 'draw') {
    fail('finished battle must have a valid outcome');
  }
}

export function isBattleState(value: unknown): value is BattleState {
  try {
    assertBattleState(value, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upgrade a valid M2-B version-1 battle state without replaying a round.
 * Starter generals receive their one-time initial skill allowance; ordinary
 * troop units remain skill-less. This function must only run for version 1.
 */
/**
 * Upgrade a Phase-1 version-2 battle to version 3 by assigning deterministic
 * default slots. Existing skills, cooldowns, formations, round, RNG, and log
 * remain untouched.
 */
export function migrateBattleStateV2ToV3(value: unknown): BattleState {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.units)) {
    fail('only a version-2 battle state can be migrated to v3');
  }
  const sideIndexes: Record<BattleSide, number> = { player: 0, enemy: 0 };
  const units = value.units.map((candidate, index) => {
    if (!isRecord(candidate)) fail(`version-2 state.units[${index}] is invalid`);
    assertSide(candidate.side, `version-2 state.units[${index}].side`);
    const defaultSlot = DEFAULT_DEPLOYMENT_SLOTS[sideIndexes[candidate.side] % DEFAULT_DEPLOYMENT_SLOTS.length];
    sideIndexes[candidate.side]++;
    return {
      ...candidate,
      slot: candidate.slot ?? defaultSlot,
      suppressedUntilRound: candidate.suppressed === true
        ? (candidate.suppressedUntilRound ?? Number(value.round))
        : null,
    };
  });
  const migrated = { ...value, version: 3, units };
  assertBattleState(migrated, true);
  return migrated;
}

/** Upgrade an original v1 campaign battle directly to the current v3 format. */
export function migrateBattleStateV1ToV3(value: unknown): BattleState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.units)) {
    fail('only a version-1 battle state can be migrated');
  }
  const units = value.units.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.generalId !== 'string') {
      fail(`version-1 state.units[${index}] is invalid`);
    }
    const skill = getGeneralSkillForOwner(candidate.generalId);
    return {
      ...candidate,
      skillId: skill?.id ?? null,
      skillState: skill ? createInitialGeneralSkillState(skill.id) : null,
      suppressedUntilRound: candidate.suppressed === true ? Number(value.round) : null,
    };
  });
  return migrateBattleStateV2ToV3({ ...value, version: 2, units });
}

function cloneState(state: BattleState): BattleState {
  return {
    ...state,
    formations: { ...state.formations },
    units: state.units.map((unit) => ({
      ...unit,
      stats: { ...unit.stats },
      skillState: unit.skillState ? { ...unit.skillState } : null,
      suppressedUntilRound: unit.suppressed
        ? (unit.suppressedUntilRound ?? state.round)
        : null,
    })),
    log: state.log.map((entry) => {
      if (entry.type === 'battle_started') {
        return { ...entry, playerUnitIds: [...entry.playerUnitIds], enemyUnitIds: [...entry.enemyUnitIds] };
      }
      if (entry.type === 'deployment_changed') {
        return { ...entry, assignments: entry.assignments.map((assignment) => ({ ...assignment })) };
      }
      return { ...entry };
    }),
  };
}

function validateUnitConfig(candidate: unknown, side: BattleSide, label: string, defaultSlot: DeploymentSlot): BattleUnit {
  if (!isRecord(candidate)) fail(`${label} must be an object`);
  assertNonEmptyString(candidate.id, `${label}.id`);
  assertNonEmptyString(candidate.generalId, `${label}.generalId`);
  assertNonEmptyString(candidate.name, `${label}.name`);
  assertUnitClass(candidate.unitClass, `${label}.unitClass`);
  assertStats(candidate.stats, `${label}.stats`);
  assertInteger(candidate.maxTroops, 1, 1_000_000, `${label}.maxTroops`);
  assertInteger(candidate.troops, 1, candidate.maxTroops, `${label}.troops`);
  const slot = candidate.slot === undefined ? defaultSlot : candidate.slot;
  assertDeploymentSlot(slot, `${label}.slot`);
  const skillId = candidate.skillId === undefined ? null : candidate.skillId;
  const registeredSkill = getGeneralSkillForOwner(candidate.generalId);
  if (skillId !== null) {
    assertNonEmptyString(skillId, `${label}.skillId`);
    const definition = getGeneralSkillById(skillId);
    if (!definition) fail(`${label} references unknown skill ${skillId}`);
    if (definition.ownerGeneralId !== candidate.generalId) fail(`${label} does not own skill ${skillId}`);
  }
  if (registeredSkill && skillId !== registeredSkill.id) {
    fail(`${label} must declare its registered personal skill ${registeredSkill.id}`);
  }
  return {
    id: candidate.id,
    generalId: candidate.generalId,
    name: candidate.name,
    side,
    unitClass: candidate.unitClass,
    stats: { ...candidate.stats },
    troops: candidate.troops,
    maxTroops: candidate.maxTroops,
    skillId,
    slot,
    skillState: skillId ? createInitialGeneralSkillState(skillId) : null,
    suppressedUntilRound: null,
    schemeUsed: false,
    guarded: false,
    suppressed: false,
  };
}

/** Build a fresh 3v3 battle. Seed is an unsigned 32-bit integer; zero uses fallback. */
export function createBattle(config: BattleConfig, seed: number): BattleState {
  if (!isRecord(config)) fail('config must be an object');
  if (!Array.isArray(config.playerUnits) || config.playerUnits.length !== BATTLE_RULES.unitsPerSide) {
    fail('config.playerUnits must contain exactly three units');
  }
  if (!Array.isArray(config.enemyUnits) || config.enemyUnits.length !== BATTLE_RULES.unitsPerSide) {
    fail('config.enemyUnits must contain exactly three units');
  }
  assertInteger(seed, 0, UINT32_MAX, 'seed');

  const playerUnits = config.playerUnits.map((unit, index) => validateUnitConfig(
    unit, 'player', `config.playerUnits[${index}]`, DEFAULT_DEPLOYMENT_SLOTS[index],
  ));
  const enemyUnits = config.enemyUnits.map((unit, index) => validateUnitConfig(
    unit, 'enemy', `config.enemyUnits[${index}]`, DEFAULT_DEPLOYMENT_SLOTS[index],
  ));
  const units = [...playerUnits, ...enemyUnits];
  const ids = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) fail(`duplicate unit id: ${unit.id}`);
    ids.add(unit.id);
  }

  return {
    version: 3,
    round: 1,
    phase: 'ready',
    rngState: seed === 0 ? BATTLE_RULES.seedFallback : seed,
    formations: { player: 'arrow', enemy: 'arrow' },
    units,
    outcome: null,
    log: [{
      type: 'battle_started',
      round: 1,
      playerUnitIds: playerUnits.map((unit) => unit.id),
      enemyUnitIds: enemyUnits.map((unit) => unit.id),
    }],
  };
}

function livingUnits(state: BattleState, side: BattleSide): BattleUnit[] {
  return state.units.filter((unit) => unit.side === side && unit.troops > 0);
}

export function remainingTroops(state: BattleState, side: BattleSide): number {
  assertBattleState(state, true);
  return state.units
    .filter((unit) => unit.side === side)
    .reduce((total, unit) => total + unit.troops, 0);
}

/** Composition-aware enemy doctrine. Pure: does not mutate state or RNG. */
export function chooseEnemyFormation(state: BattleState): Formation {
  assertBattleState(state, true);
  const enemies = livingUnits(state, 'enemy');
  const cavalry = enemies.filter((unit) => unit.unitClass === 'cavalry').length;
  const archers = enemies.filter((unit) => unit.unitClass === 'archer').length;
  const enemyTroops = remainingTroops(state, 'enemy');
  const playerTroops = remainingTroops(state, 'player');
  if (cavalry >= 2 && enemyTroops >= playerTroops * 0.8) return 'wedge';
  if (archers >= 2 && enemyTroops < playerTroops) return 'turtle';
  return enemyTroops >= playerTroops ? 'arrow' : 'square';
}

/** Determine whether a skill target satisfies its owner's typed target rule. */
export function isValidSkillTarget(
  actor: BattleUnit,
  target: BattleUnit,
  definition: GeneralSkillDefinition,
): boolean {
  if (target.troops <= 0) return false;
  switch (definition.target) {
    case 'self':
      return target.id === actor.id;
    case 'ally':
      if (target.side !== actor.side || target.id === actor.id) return false;
      return definition.effect.type !== 'heal_troops' || target.troops < target.maxTroops;
    case 'enemy':
      return target.side !== actor.side;
    case 'enemy_frontline':
      return target.side !== actor.side && getDeploymentDepth(target.slot) === 'front';
    case 'enemy_all':
      return target.side !== actor.side;
  }
}

function skillTargetsFor(state: BattleState, actor: BattleUnit, definition: GeneralSkillDefinition): BattleUnit[] {
  if (definition.target === 'self') return [actor];
  if (definition.target === 'enemy_all') {
    return livingUnits(state, actor.side === 'player' ? 'enemy' : 'player');
  }
  if (definition.target === 'ally') {
    return state.units
      .filter((unit) => isValidSkillTarget(actor, unit, definition))
      .sort((a, b) => a.troops - b.troops || compareIdsByCodePoint(a.id, b.id));
  }
  return state.units
    .filter((unit) => isValidSkillTarget(actor, unit, definition))
    .sort((a, b) => a.troops - b.troops || compareIdsByCodePoint(a.id, b.id));
}

/** Enemy orders are returned in stable unit-ID order and do not consume RNG. */
export function chooseEnemyOrders(state: BattleState): UnitOrder[] {
  assertBattleState(state, true);
  const enemies = livingUnits(state, 'enemy').sort((a, b) => compareIdsByCodePoint(a.id, b.id));
  const players = livingUnits(state, 'player');
  return enemies.map((enemy) => {
    if (enemy.skillId && enemy.skillState
      && enemy.skillState.cooldownRemaining === 0
      && enemy.skillState.usesRemaining > 0) {
      const definition = getGeneralSkillById(enemy.skillId);
      if (definition && definition.ownerGeneralId === enemy.generalId) {
        const targets = skillTargetsFor(state, enemy, definition);
        const target = targets[0];
        if (definition.target === 'enemy_all' && targets.length > 0) {
          return { unitId: enemy.id, type: 'skill' };
        }
        if (target) return { unitId: enemy.id, type: 'skill', targetId: target.id };
      }
    }
    if (enemy.stats.intelligence >= 65 && !enemy.schemeUsed && players.length > 0) {
      const target = [...players].sort((a, b) =>
        b.stats.martial - a.stats.martial || compareIdsByCodePoint(a.id, b.id),
      )[0];
      return { unitId: enemy.id, type: 'scheme', targetId: target.id };
    }
    const attackTargets = getValidAttackTargets(state, enemy.id);
    if (attackTargets.length > 0) {
      const target = [...attackTargets].sort((a, b) =>
        a.troops - b.troops || compareIdsByCodePoint(a.id, b.id),
      )[0];
      return { unitId: enemy.id, type: 'attack', targetId: target.id };
    }
    return { unitId: enemy.id, type: 'wait' };
  });
}

function isExposedEnemyInLane(state: BattleState, target: BattleUnit): boolean {
  const lane = getDeploymentLane(target.slot);
  const defenders = livingUnits(state, target.side)
    .filter((unit) => getDeploymentLane(unit.slot) === lane)
    .sort((left, right) =>
      DEPLOYMENT_DEPTH_ORDER[getDeploymentDepth(left.slot)]
        - DEPLOYMENT_DEPTH_ORDER[getDeploymentDepth(right.slot)]
      || compareIdsByCodePoint(left.id, right.id),
    );
  return defenders[0]?.id === target.id;
}

/** Melee units can attack the front-most living unit in a lane; archers can reach any row. */
export function isValidAttackTarget(state: BattleState, attacker: BattleUnit, target: BattleUnit): boolean {
  if (attacker.troops <= 0 || target.troops <= 0 || attacker.side === target.side) return false;
  return attacker.unitClass === 'archer' || isExposedEnemyInLane(state, target);
}

export function getValidAttackTargets(state: BattleState, attackerId: string): BattleUnit[] {
  assertBattleState(state, true);
  const attacker = state.units.find((unit) => unit.id === attackerId);
  if (!attacker || attacker.troops <= 0) return [];
  return livingUnits(state, attacker.side === 'player' ? 'enemy' : 'player')
    .filter((target) => isValidAttackTarget(state, attacker, target))
    .sort((left, right) => compareIdsByCodePoint(left.id, right.id));
}

/**
 * Assign all units for one side before the first round. The three assignments
 * must cover every unit exactly once and cannot reuse a grid cell.
 */
export function setUnitDeployment(
  state: BattleState,
  side: BattleSide,
  assignments: DeploymentAssignment[],
): BattleState {
  assertBattleState(state, false);
  const combatStarted = state.log.some((entry) =>
    entry.type !== 'battle_started' && entry.type !== 'deployment_changed',
  );
  if (state.round !== 1 || combatStarted) fail('deployment is locked after the first round begins');
  if (!Array.isArray(assignments) || assignments.length !== BATTLE_RULES.unitsPerSide) {
    fail('deployment must assign exactly three units');
  }
  const sideUnits = state.units.filter((unit) => unit.side === side);
  const expectedIds = new Set(sideUnits.map((unit) => unit.id));
  const assignedIds = new Set<string>();
  const assignedSlots = new Set<DeploymentSlot>();
  for (const [index, assignment] of assignments.entries()) {
    if (!isRecord(assignment)) fail(`deployment[${index}] must be an object`);
    assertNonEmptyString(assignment.unitId, `deployment[${index}].unitId`);
    assertDeploymentSlot(assignment.slot, `deployment[${index}].slot`);
    if (!expectedIds.has(assignment.unitId)) fail(`unit ${assignment.unitId} is not on side ${side}`);
    if (assignedIds.has(assignment.unitId)) fail(`duplicate deployment unit ${assignment.unitId}`);
    if (assignedSlots.has(assignment.slot)) fail(`duplicate deployment slot ${assignment.slot}`);
    assignedIds.add(assignment.unitId);
    assignedSlots.add(assignment.slot);
  }
  for (const unit of sideUnits) {
    if (!assignedIds.has(unit.id)) fail(`deployment is missing unit ${unit.id}`);
  }

  const next = cloneState(state);
  const slotByUnitId = new Map(assignments.map((assignment) => [assignment.unitId, assignment.slot]));
  next.units = next.units.map((unit) => unit.side === side
    ? { ...unit, slot: slotByUnitId.get(unit.id)! }
    : unit);
  const orderedAssignments = assignments
    .map((assignment) => ({ ...assignment }))
    .sort((left, right) => compareIdsByCodePoint(left.unitId, right.unitId));
  next.log.push({ type: 'deployment_changed', round: next.round, side, assignments: orderedAssignments });
  assertBattleState(next, true);
  return next;
}

function validateRoundInput(state: BattleState, input: unknown): asserts input is RoundInput {
  if (!isRecord(input)) fail('round input must be an object');
  if (!isRecord(input.formations)) fail('input.formations must be an object');
  assertFormation(input.formations.player, 'input.formations.player');
  assertFormation(input.formations.enemy, 'input.formations.enemy');
  if (!Array.isArray(input.orders)) fail('input.orders must be an array');

  const unitsById = new Map(state.units.map((unit) => [unit.id, unit]));
  const living = state.units.filter((unit) => unit.troops > 0);
  if (input.orders.length !== living.length) {
    fail(`exactly one order is required for each living unit (expected ${living.length}, got ${input.orders.length})`);
  }

  const seen = new Set<string>();
  for (const [index, rawOrder] of input.orders.entries()) {
    if (!isRecord(rawOrder)) fail(`orders[${index}] must be an object`);
    assertNonEmptyString(rawOrder.unitId, `orders[${index}].unitId`);
    if (seen.has(rawOrder.unitId)) fail(`duplicate order for unit ${rawOrder.unitId}`);
    seen.add(rawOrder.unitId);
    const actor = unitsById.get(rawOrder.unitId);
    if (!actor) fail(`unknown acting unit ${rawOrder.unitId}`);
    if (actor.troops <= 0) fail(`defeated unit ${actor.id} cannot submit an order`);

    if (rawOrder.type === 'wait') continue;
    if (rawOrder.type === 'skill') {
      if (!actor.skillId || !actor.skillState) fail(`unit ${actor.id} has no personal skill`);
      const definition = getGeneralSkillById(actor.skillId);
      if (!definition || definition.ownerGeneralId !== actor.generalId) fail(`unit ${actor.id} does not own its skill`);
      if (actor.skillState.skillId !== definition.id) fail(`unit ${actor.id} skill state does not match its skill`);
      if (actor.skillState.usesRemaining <= 0) fail(`skill ${definition.id} has no uses remaining`);
      if (actor.skillState.cooldownRemaining > 0) fail(`skill ${definition.id} is on cooldown`);
      if (definition.target === 'enemy_all') {
        if (rawOrder.targetId !== undefined) fail(`skill ${definition.id} does not accept a single target`);
        if (!livingUnits(state, actor.side === 'player' ? 'enemy' : 'player').length) fail(`skill ${definition.id} has no valid targets`);
        continue;
      }
      assertNonEmptyString(rawOrder.targetId, `orders[${index}].targetId`);
      const target = unitsById.get(rawOrder.targetId);
      if (!target) fail(`unknown target ${rawOrder.targetId}`);
      if (!isValidSkillTarget(actor, target, definition)) fail(`target ${target.id} is invalid for skill ${definition.id}`);
      continue;
    }
    if (rawOrder.type !== 'attack' && rawOrder.type !== 'scheme') fail(`orders[${index}].type is invalid`);
    assertNonEmptyString(rawOrder.targetId, `orders[${index}].targetId`);
    const target = unitsById.get(rawOrder.targetId);
    if (!target) fail(`unknown target ${rawOrder.targetId}`);
    if (target.troops <= 0) fail(`defeated target ${target.id} cannot be selected`);
    if (target.side === actor.side) fail(`unit ${actor.id} cannot target a friendly unit`);
    if (rawOrder.type === 'attack' && !isValidAttackTarget(state, actor, target)) {
      fail(`target ${target.id} is screened by the frontline`);
    }
    if (rawOrder.type === 'scheme' && actor.schemeUsed) fail(`unit ${actor.id} has already used Scheme`);
  }

  for (const unit of living) {
    if (!seen.has(unit.id)) fail(`missing order for living unit ${unit.id}`);
  }
}

function calculateCasualties(
  attacker: BattleUnit,
  defender: BattleUnit,
  state: BattleState,
  defenderWasGuarded: boolean,
  attackerWasSuppressed: boolean,
  skillMultiplier = 1,
): number {
  const base = BATTLE_RULES.baseCasualties
    + attacker.stats.martial * BATTLE_RULES.martialCasualtyWeight
    + attacker.stats.leadership * BATTLE_RULES.leadershipCasualtyWeight;
  const strength = BATTLE_RULES.strengthBase
    + BATTLE_RULES.strengthTroopWeight * (attacker.troops / attacker.maxTroops);
  const attackerFormation = state.formations[attacker.side];
  const defenderFormation = state.formations[defender.side];
  const outgoing = attackerFormation === 'arrow'
    ? BATTLE_RULES.arrowOutgoingMultiplier
    : attackerFormation === 'wedge'
      ? (attacker.unitClass === 'cavalry' ? BATTLE_RULES.wedgeCavalryOutgoingMultiplier : BATTLE_RULES.wedgeOtherOutgoingMultiplier)
      : attackerFormation === 'turtle' ? BATTLE_RULES.turtleOutgoingMultiplier : 1;
  const incoming = defenderFormation === 'square'
    ? BATTLE_RULES.squareIncomingMultiplier
    : defenderFormation === 'turtle' ? BATTLE_RULES.turtleIncomingMultiplier : 1;
  const flank = attacker.unitClass === 'cavalry'
    && getDeploymentLane(attacker.slot) !== getDeploymentLane(defender.slot)
    ? BATTLE_RULES.cavalryFlankMultiplier
    : 1;
  const guard = defenderWasGuarded ? BATTLE_RULES.guardMultiplier : 1;
  const suppression = attackerWasSuppressed ? BATTLE_RULES.suppressionMultiplier : 1;
  return Math.min(
    defender.troops,
    Math.max(BATTLE_RULES.minimumCasualties,
      Math.round(base * strength * outgoing * incoming * flank * guard * suppression * skillMultiplier)),
  );
}

function markDefeatedIfNeeded(state: BattleState, target: BattleUnit): boolean {
  if (target.troops !== 0) return false;
  state.log.push({ type: 'unit_defeated', round: state.round, unitId: target.id, side: target.side });
  return finishIfSideDefeated(state);
}

function resolveGeneralSkill(state: BattleState, actor: BattleUnit, order: Extract<UnitOrder, { type: 'skill' }>): boolean {
  const skillId = actor.skillId;
  if (!skillId || !actor.skillState) return false;
  const definition = getGeneralSkillById(skillId);
  if (!definition) return false;
  const targets = definition.target === 'enemy_all'
    ? skillTargetsFor(state, actor, definition)
    : [state.units.find((unit) => unit.id === order.targetId)].filter((unit): unit is BattleUnit => Boolean(unit));
  if (!targets.length) return false;

  // A validated skill command consumes one use and starts its cooldown even
  // when a damage skill misses. Invalid orders are rejected before any action.
  actor.skillState.usesRemaining -= 1;
  actor.skillState.cooldownRemaining = definition.cooldownRounds;

  for (const target of targets) {
    if (target.troops <= 0) continue;
    let success = true;
    if (definition.effect.type === 'heal_troops') {
      const restored = Math.min(definition.effect.amount, target.maxTroops - target.troops);
      success = restored > 0;
      if (restored > 0) {
        target.troops += restored;
        state.log.push({
          type: 'troops_restored',
          round: state.round,
          targetId: target.id,
          amount: restored,
          remainingTroops: target.troops,
        });
      }
    } else if (definition.effect.type === 'damage') {
      const attackerWasSuppressed = consumeSuppression(actor, state.round);
      const suppressionMultiplier = attackerWasSuppressed ? BATTLE_RULES.suppressionMultiplier : 1;
      const hitChance = calculateHitChance(actor, target);
      const random = nextRandom(state.rngState);
      state.rngState = random.state;
      const hit = random.value < hitChance;
      success = hit;
      state.log.push({
        type: 'unit_attacked',
        round: state.round,
        attackerId: actor.id,
        targetId: target.id,
        hitChance,
        roll: random.value,
        hit,
      });
      if (hit) {
        const defenderWasGuarded = target.guarded;
        if (defenderWasGuarded) target.guarded = false;
        const casualties = calculateCasualties(
          actor,
          target,
          state,
          defenderWasGuarded,
          attackerWasSuppressed,
          definition.effect.multiplier,
        );
        target.troops -= casualties;
        state.log.push({
          type: 'troops_lost',
          round: state.round,
          targetId: target.id,
          casualties,
          remainingTroops: target.troops,
        });
      }
    } else if (definition.effect.type === 'suppress') {
      target.suppressed = true;
      target.suppressedUntilRound = state.round + definition.effect.durationRounds;
    } else if (definition.effect.type === 'guard') {
      target.guarded = true;
    }

    state.log.push({
      type: 'general_skill_used',
      round: state.round,
      skillId,
      casterId: actor.id,
      targetId: target.id,
      effectType: definition.effect.type,
      success,
    });
    if (definition.effect.type === 'damage' && target.troops === 0) {
      if (markDefeatedIfNeeded(state, target)) return true;
    }
  }
  return false;
}

function consumeSuppression(unit: BattleUnit, round: number): boolean {
  const active = unit.suppressed
    && (unit.suppressedUntilRound === undefined || unit.suppressedUntilRound === null || round <= unit.suppressedUntilRound);
  unit.suppressed = false;
  unit.suppressedUntilRound = null;
  return active;
}

function tickSkillCooldowns(state: BattleState): void {
  for (const unit of state.units) {
    if (unit.skillState && unit.skillState.cooldownRemaining > 0) {
      unit.skillState.cooldownRemaining = Math.max(0, unit.skillState.cooldownRemaining - 1);
    }
    if (unit.suppressed && unit.suppressedUntilRound !== undefined
      && unit.suppressedUntilRound !== null && state.round >= unit.suppressedUntilRound) {
      unit.suppressed = false;
      unit.suppressedUntilRound = null;
    }
  }
}

function addFinishedLog(state: BattleState, outcome: BattleOutcome): void {
  state.phase = 'finished';
  state.outcome = outcome;
  state.log.push({
    type: 'battle_finished',
    round: state.round,
    outcome,
    playerTroops: remainingTroopsUnchecked(state, 'player'),
    enemyTroops: remainingTroopsUnchecked(state, 'enemy'),
  });
}

function remainingTroopsUnchecked(state: BattleState, side: BattleSide): number {
  return state.units
    .filter((unit) => unit.side === side)
    .reduce((total, unit) => total + unit.troops, 0);
}

function finishIfSideDefeated(state: BattleState): boolean {
  const playerAlive = livingUnits(state, 'player').length > 0;
  const enemyAlive = livingUnits(state, 'enemy').length > 0;
  if (playerAlive && enemyAlive) return false;
  const outcome: BattleOutcome = playerAlive ? 'victory' : enemyAlive ? 'defeat' : 'draw';
  addFinishedLog(state, outcome);
  return true;
}

/** Resolve one complete simultaneous-submission / initiative-ordered round. */
export function resolveRound(state: BattleState, input: RoundInput): BattleState {
  assertBattleState(state, false);
  validateRoundInput(state, input);

  const next = cloneState(state);
  next.formations = { player: input.formations.player, enemy: input.formations.enemy };
  next.log.push(
    { type: 'formation_selected', round: next.round, side: 'player', formation: next.formations.player },
    { type: 'formation_selected', round: next.round, side: 'enemy', formation: next.formations.enemy },
  );

  const unitsById = new Map(next.units.map((unit) => [unit.id, unit]));
  const sortedOrders = [...input.orders].sort((left, right) => {
    const leftUnit = unitsById.get(left.unitId)!;
    const rightUnit = unitsById.get(right.unitId)!;
    return rightUnit.stats.leadership - leftUnit.stats.leadership
      || compareIdsByCodePoint(left.unitId, right.unitId);
  });

  for (const order of sortedOrders) {
    const actor = unitsById.get(order.unitId)!;
    if (actor.troops <= 0) {
      next.log.push({ type: 'order_skipped', round: next.round, unitId: actor.id, reason: 'unit_defeated' });
      continue;
    }

    if (order.type === 'wait') {
      actor.guarded = true;
      next.log.push({ type: 'unit_guarded', round: next.round, unitId: actor.id });
      continue;
    }

    if (order.type === 'skill') {
      if (order.targetId) {
        const selected = unitsById.get(order.targetId);
        if (!selected || !isValidSkillTarget(actor, selected, getGeneralSkillById(actor.skillId ?? '')!)) {
          next.log.push({ type: 'order_skipped', round: next.round, unitId: actor.id, reason: 'target_invalid' });
          continue;
        }
      } else if (!skillTargetsFor(next, actor, getGeneralSkillById(actor.skillId ?? '')!).length) {
        next.log.push({ type: 'order_skipped', round: next.round, unitId: actor.id, reason: 'target_invalid' });
        continue;
      }
      const finished = resolveGeneralSkill(next, actor, order);
      if (finished) break;
      continue;
    }

    const target = unitsById.get(order.targetId)!;
    if (target.troops <= 0) {
      next.log.push({ type: 'order_skipped', round: next.round, unitId: actor.id, reason: 'target_defeated' });
      continue;
    }

    if (order.type === 'scheme') {
      actor.schemeUsed = true;
      const successChance = calculateSchemeChance(actor, target);
      const random = nextRandom(next.rngState);
      next.rngState = random.state;
      const success = random.value < successChance;
      if (success) {
        target.suppressed = true;
        target.suppressedUntilRound = next.round + 1;
      }
      next.log.push({
        type: 'scheme_attempted',
        round: next.round,
        casterId: actor.id,
        targetId: target.id,
        successChance,
        roll: random.value,
        success,
      });
      continue;
    }

    const attackerWasSuppressed = consumeSuppression(actor, next.round);
    const suppressionMultiplier = attackerWasSuppressed ? BATTLE_RULES.suppressionMultiplier : 1;
    const hitChance = calculateHitChance(actor, target);
    const random = nextRandom(next.rngState);
    next.rngState = random.state;
    const hit = random.value < hitChance;
    next.log.push({
      type: 'unit_attacked',
      round: next.round,
      attackerId: actor.id,
      targetId: target.id,
      hitChance,
      roll: random.value,
      hit,
    });

    if (!hit) continue;

    const defenderWasGuarded = target.guarded;
    if (defenderWasGuarded) target.guarded = false;

    const casualties = calculateCasualties(actor, target, next, defenderWasGuarded, attackerWasSuppressed);

    target.troops -= casualties;
    next.log.push({
      type: 'troops_lost',
      round: next.round,
      targetId: target.id,
      casualties,
      remainingTroops: target.troops,
    });
    if (markDefeatedIfNeeded(next, target)) break;
  }

  tickSkillCooldowns(next);
  if (next.phase === 'finished') return next;

  if (next.round >= BATTLE_RULES.maxRounds) {
    const playerTroops = remainingTroopsUnchecked(next, 'player');
    const enemyTroops = remainingTroopsUnchecked(next, 'enemy');
    const outcome: BattleOutcome = playerTroops > enemyTroops
      ? 'victory'
      : enemyTroops > playerTroops
        ? 'defeat'
        : 'draw';
    addFinishedLog(next, outcome);
    return next;
  }

  next.round += 1;
  return next;
}

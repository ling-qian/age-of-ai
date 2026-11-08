import {
  createInitialGeneralSkillState,
  getGeneralSkillById,
  getGeneralSkillForOwner,
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
export type Formation = 'arrow' | 'square';
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
}

export interface BattleConfig {
  playerUnits: BattleUnitConfig[];
  enemyUnits: BattleUnitConfig[];
}

export interface BattleUnit extends BattleUnitConfig {
  side: BattleSide;
  skillId: string | null;
  skillState: GeneralSkillState | null;
  schemeUsed: boolean;
  guarded: boolean;
  suppressed: boolean;
}

export type UnitOrder =
  | { unitId: string; type: 'attack'; targetId: string }
  | { unitId: string; type: 'scheme'; targetId: string }
  | { unitId: string; type: 'wait' };

export interface RoundInput {
  formations: Record<BattleSide, Formation>;
  orders: UnitOrder[];
}

export type BattleLogEntry =
  | { type: 'battle_started'; round: number; playerUnitIds: string[]; enemyUnitIds: string[] }
  | { type: 'formation_selected'; round: number; side: BattleSide; formation: Formation }
  | { type: 'unit_attacked'; round: number; attackerId: string; targetId: string; hitChance: number; roll: number; hit: boolean }
  | { type: 'troops_lost'; round: number; targetId: string; casualties: number; remainingTroops: number }
  | { type: 'scheme_attempted'; round: number; casterId: string; targetId: string; successChance: number; roll: number; success: boolean }
  | { type: 'unit_guarded'; round: number; unitId: string }
  | { type: 'unit_defeated'; round: number; unitId: string; side: BattleSide }
  | { type: 'order_skipped'; round: number; unitId: string; reason: 'unit_defeated' | 'target_defeated' }
  | { type: 'battle_finished'; round: number; outcome: BattleOutcome; playerTroops: number; enemyTroops: number };

export interface BattleState {
  version: 2;
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
  if (value !== 'arrow' && value !== 'square') fail(`${label} must be arrow or square`);
}

function assertUnitCore(value: unknown, label: string, allowZeroTroops: boolean): asserts value is BattleUnit {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.generalId, `${label}.generalId`);
  assertNonEmptyString(value.name, `${label}.name`);
  assertSide(value.side, `${label}.side`);
  assertUnitClass(value.unitClass, `${label}.unitClass`);
  assertStats(value.stats, `${label}.stats`);
  assertInteger(value.maxTroops, 1, 1_000_000, `${label}.maxTroops`);
  assertInteger(value.troops, allowZeroTroops ? 0 : 1, value.maxTroops, `${label}.troops`);
  if (typeof value.skillId !== 'string' && value.skillId !== null) fail(`${label}.skillId must be a string or null`);
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
  if (state.version !== 2) fail('unsupported state version');
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
  for (const [index, candidate] of state.units.entries()) {
    assertUnitCore(candidate, `state.units[${index}]`, true);
    if (ids.has(candidate.id)) fail(`duplicate unit id: ${candidate.id}`);
    ids.add(candidate.id);
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
export function migrateBattleStateV1ToV2(value: unknown): BattleState {
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
    };
  });
  const migrated = { ...value, version: 2, units };
  assertBattleState(migrated, true);
  return migrated;
}

function cloneState(state: BattleState): BattleState {
  return {
    ...state,
    formations: { ...state.formations },
    units: state.units.map((unit) => ({
      ...unit,
      stats: { ...unit.stats },
      skillState: unit.skillState ? { ...unit.skillState } : null,
    })),
    log: state.log.map((entry) => {
      if (entry.type === 'battle_started') {
        return { ...entry, playerUnitIds: [...entry.playerUnitIds], enemyUnitIds: [...entry.enemyUnitIds] };
      }
      return { ...entry };
    }),
  };
}

function validateUnitConfig(candidate: unknown, side: BattleSide, label: string): BattleUnit {
  if (!isRecord(candidate)) fail(`${label} must be an object`);
  assertNonEmptyString(candidate.id, `${label}.id`);
  assertNonEmptyString(candidate.generalId, `${label}.generalId`);
  assertNonEmptyString(candidate.name, `${label}.name`);
  assertUnitClass(candidate.unitClass, `${label}.unitClass`);
  assertStats(candidate.stats, `${label}.stats`);
  assertInteger(candidate.maxTroops, 1, 1_000_000, `${label}.maxTroops`);
  assertInteger(candidate.troops, 1, candidate.maxTroops, `${label}.troops`);
  const skillId = candidate.skillId === undefined ? null : candidate.skillId;
  if (skillId !== null) {
    assertNonEmptyString(skillId, `${label}.skillId`);
    const definition = getGeneralSkillById(skillId);
    if (!definition) fail(`${label} references unknown skill ${skillId}`);
    if (definition.ownerGeneralId !== candidate.generalId) fail(`${label} does not own skill ${skillId}`);
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
    skillState: skillId ? createInitialGeneralSkillState(skillId) : null,
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

  const playerUnits = config.playerUnits.map((unit, index) => validateUnitConfig(unit, 'player', `config.playerUnits[${index}]`));
  const enemyUnits = config.enemyUnits.map((unit, index) => validateUnitConfig(unit, 'enemy', `config.enemyUnits[${index}]`));
  const units = [...playerUnits, ...enemyUnits];
  const ids = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) fail(`duplicate unit id: ${unit.id}`);
    ids.add(unit.id);
  }

  return {
    version: 2,
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

/** Enemy formation heuristic. Pure: does not mutate state or RNG. */
export function chooseEnemyFormation(state: BattleState): Formation {
  assertBattleState(state, true);
  return remainingTroops(state, 'enemy') >= remainingTroops(state, 'player') ? 'arrow' : 'square';
}

/** Enemy orders are returned in stable unit-ID order and do not consume RNG. */
export function chooseEnemyOrders(state: BattleState): UnitOrder[] {
  assertBattleState(state, true);
  const enemies = livingUnits(state, 'enemy').sort((a, b) => compareIdsByCodePoint(a.id, b.id));
  const players = livingUnits(state, 'player');
  return enemies.map((enemy) => {
    if (enemy.stats.intelligence >= 65 && !enemy.schemeUsed && players.length > 0) {
      const target = [...players].sort((a, b) =>
        b.stats.martial - a.stats.martial || compareIdsByCodePoint(a.id, b.id),
      )[0];
      return { unitId: enemy.id, type: 'scheme', targetId: target.id };
    }
    if (players.length > 0) {
      const target = [...players].sort((a, b) =>
        a.troops - b.troops || compareIdsByCodePoint(a.id, b.id),
      )[0];
      return { unitId: enemy.id, type: 'attack', targetId: target.id };
    }
    return { unitId: enemy.id, type: 'wait' };
  });
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
    if (rawOrder.type !== 'attack' && rawOrder.type !== 'scheme') fail(`orders[${index}].type is invalid`);
    assertNonEmptyString(rawOrder.targetId, `orders[${index}].targetId`);
    const target = unitsById.get(rawOrder.targetId);
    if (!target) fail(`unknown target ${rawOrder.targetId}`);
    if (target.troops <= 0) fail(`defeated target ${target.id} cannot be selected`);
    if (target.side === actor.side) fail(`unit ${actor.id} cannot target a friendly unit`);
    if (rawOrder.type === 'scheme' && actor.schemeUsed) fail(`unit ${actor.id} has already used Scheme`);
  }

  for (const unit of living) {
    if (!seen.has(unit.id)) fail(`missing order for living unit ${unit.id}`);
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
      if (success) target.suppressed = true;
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

    const suppressionMultiplier = actor.suppressed ? BATTLE_RULES.suppressionMultiplier : 1;
    if (actor.suppressed) actor.suppressed = false;
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
    const attackerSuppressed = suppressionMultiplier < 1;
    if (defenderWasGuarded) target.guarded = false;
    if (attackerSuppressed) actor.suppressed = false;

    // Casualty calculation uses the statuses captured immediately before this hit.
    const base = BATTLE_RULES.baseCasualties
      + actor.stats.martial * BATTLE_RULES.martialCasualtyWeight
      + actor.stats.leadership * BATTLE_RULES.leadershipCasualtyWeight;
    const strength = BATTLE_RULES.strengthBase
      + BATTLE_RULES.strengthTroopWeight * (actor.troops / actor.maxTroops);
    const outgoing = next.formations[actor.side] === 'arrow' ? BATTLE_RULES.arrowOutgoingMultiplier : 1;
    const incoming = next.formations[target.side] === 'square' ? BATTLE_RULES.squareIncomingMultiplier : 1;
    const guard = defenderWasGuarded ? BATTLE_RULES.guardMultiplier : 1;
    const suppression = attackerSuppressed ? BATTLE_RULES.suppressionMultiplier : 1;
    const casualties = Math.min(
      target.troops,
      Math.max(BATTLE_RULES.minimumCasualties, Math.round(base * strength * outgoing * incoming * guard * suppression)),
    );

    target.troops -= casualties;
    next.log.push({
      type: 'troops_lost',
      round: next.round,
      targetId: target.id,
      casualties,
      remainingTroops: target.troops,
    });
    if (target.troops === 0) {
      next.log.push({ type: 'unit_defeated', round: next.round, unitId: target.id, side: target.side });
      if (finishIfSideDefeated(next)) break;
    }
  }

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

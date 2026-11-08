/**
 * Deterministic tests for M2-C general-specific skill execution.
 * Run: npx tsx scripts/three_kingdoms_skill_execution_test.ts
 */
import assert from 'node:assert/strict';
import {
  calculateHitChance,
  chooseEnemyOrders,
  createBattle,
  nextRandom,
  resolveRound,
  type BattleConfig,
  type BattleState,
  type BattleUnit,
  type UnitOrder,
} from '../client/src/three-kingdoms/battle-engine.ts';
import {
  CAMPAIGN_SAVE_VERSION,
  loadCampaignSave,
  type CampaignSave,
} from '../client/src/three-kingdoms/campaign-save.ts';

let passed = 0;
let failed = 0;

function test(name: string, run: () => void): void {
  try {
    run();
    passed++;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL — ${name}`);
    console.error(error);
  }
}

const config: BattleConfig = {
  playerUnits: [
    { id: 'p-liu', generalId: 'liu-bei', name: 'Liu Bei', unitClass: 'infantry', stats: { martial: 70, intelligence: 76, leadership: 100 }, troops: 220, maxTroops: 220, skillId: 'liu-bei-rende' },
    { id: 'p-guan', generalId: 'guan-yu', name: 'Guan Yu', unitClass: 'cavalry', stats: { martial: 96, intelligence: 78, leadership: 90 }, troops: 210, maxTroops: 210, skillId: 'guan-yu-qinglong-strike' },
    { id: 'p-zhang', generalId: 'zhang-fei', name: 'Zhang Fei', unitClass: 'infantry', stats: { martial: 98, intelligence: 48, leadership: 80 }, troops: 230, maxTroops: 230, skillId: 'zhang-fei-thunderous-roar' },
  ],
  enemyUnits: [
    { id: 'e-captain', generalId: 'raider-captain', name: 'Raider Captain', unitClass: 'infantry', stats: { martial: 64, intelligence: 42, leadership: 60 }, troops: 500, maxTroops: 500 },
    { id: 'e-archer', generalId: 'rebel-archer', name: 'Rebel Archer', unitClass: 'archer', stats: { martial: 60, intelligence: 54, leadership: 55 }, troops: 175, maxTroops: 175 },
    { id: 'e-spearman', generalId: 'rebel-spearman', name: 'Rebel Spearman', unitClass: 'infantry', stats: { martial: 58, intelligence: 35, leadership: 50 }, troops: 500, maxTroops: 500 },
  ],
};

function makeBattle(seed = 0x01842026): BattleState {
  return createBattle(config, seed);
}

function setTroops(state: BattleState, id: string, troops: number): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === id ? { ...unit, troops } : unit),
  };
}

function setLeadership(state: BattleState, id: string, leadership: number): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === id
      ? { ...unit, stats: { ...unit.stats, leadership } }
      : unit),
  };
}

function ordersWith(state: BattleState, overrides: Record<string, UnitOrder>): UnitOrder[] {
  return state.units.filter((unit) => unit.troops > 0).map((unit) =>
    overrides[unit.id] ?? { unitId: unit.id, type: 'wait' },
  );
}

function resolveWith(state: BattleState, overrides: Record<string, UnitOrder>): BattleState {
  return resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: ordersWith(state, overrides),
  });
}

function findSeed(hit: boolean, hitChance: number): number {
  for (let seed = 1; seed < 100_000; seed++) {
    if ((nextRandom(seed).value < hitChance) === hit) return seed;
  }
  throw new Error('could not find deterministic skill test seed');
}

function skillState(state: BattleState, unitId: string) {
  return state.units.find((unit) => unit.id === unitId)?.skillState;
}

function logSkill(state: BattleState, skillId: string) {
  return state.log.filter((entry) => entry.type === 'general_skill_used' && entry.skillId === skillId);
}

test('Liu Bei Rende restores a wounded ally, clamps at max troops, consumes one use, and starts cooldown', () => {
  const state = setTroops(makeBattle(), 'p-guan', 200);
  const result = resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  });
  assert.equal(result.units.find((unit) => unit.id === 'p-guan')?.troops, 220);
  assert.equal(result.units.find((unit) => unit.id === 'p-guan')?.maxTroops, 210);
  assert.equal(skillState(result, 'p-liu')?.usesRemaining, 1);
  assert.equal(skillState(result, 'p-liu')?.cooldownRemaining, 1);
  assert.equal(result.log.some((entry) => entry.type === 'troops_restored' && entry.targetId === 'p-guan' && entry.amount === 10), true);
  assert.equal(logSkill(result, 'liu-bei-rende')[0]?.success, true);
});

test('Liu Bei Rende rejects enemy, self, and fully restored ally targets before consuming a use', () => {
  const state = makeBattle();
  assert.throws(() => resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'e-captain' },
  }), /invalid for skill/);
  assert.throws(() => resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-liu' },
  }), /invalid for skill/);

  const full = setTroops(state, 'p-guan', 210);
  assert.throws(() => resolveWith(full, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  }), /invalid for skill/);
  assert.equal(skillState(state, 'p-liu')?.usesRemaining, 2, 'failed validation must not mutate input uses');
});

test('Guan Yu Azure Dragon Strike deals greater deterministic damage than a normal attack', () => {
  const initial = makeBattle();
  const attacker = initial.units.find((unit) => unit.id === 'p-guan')!;
  const defender = initial.units.find((unit) => unit.id === 'e-captain')!;
  const hitChance = calculateHitChance(attacker, defender);
  const seed = findSeed(true, hitChance);
  const state = { ...initial, rngState: seed };
  const normal = resolveWith(state, {
    'p-guan': { unitId: 'p-guan', type: 'attack', targetId: 'e-captain' },
  });
  const skilled = resolveWith(state, {
    'p-guan': { unitId: 'p-guan', type: 'skill', targetId: 'e-captain' },
  });
  const normalLoss = normal.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e-captain');
  const skilledLoss = skilled.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e-captain');
  assert.ok(normalLoss && normalLoss.type === 'troops_lost');
  assert.ok(skilledLoss && skilledLoss.type === 'troops_lost');
  assert.ok(skilledLoss.casualties > normalLoss.casualties);
  assert.equal(skillState(skilled, 'p-guan')?.usesRemaining, 1);
  assert.equal(skillState(skilled, 'p-guan')?.cooldownRemaining, 2);
  assert.equal(logSkill(skilled, 'guan-yu-qinglong-strike')[0]?.success, true);
});

test('Guan Yu consumes a use and cooldown when the damage skill misses', () => {
  const state = makeBattle();
  const attacker = state.units.find((unit) => unit.id === 'p-guan')!;
  const defender = state.units.find((unit) => unit.id === 'e-captain')!;
  const seed = findSeed(false, calculateHitChance(attacker, defender));
  const result = resolveWith({ ...state, rngState: seed }, {
    'p-guan': { unitId: 'p-guan', type: 'skill', targetId: 'e-captain' },
  });
  assert.equal(logSkill(result, 'guan-yu-qinglong-strike')[0]?.success, false);
  assert.equal(skillState(result, 'p-guan')?.usesRemaining, 1);
  assert.equal(skillState(result, 'p-guan')?.cooldownRemaining, 2);
  assert.equal(result.units.find((unit) => unit.id === 'e-captain')?.troops, 500);
});

test('Zhang Fei Thunderous Roar suppresses an enemy frontline unit but rejects an archer', () => {
  const state = makeBattle();
  assert.throws(() => resolveWith(state, {
    'p-zhang': { unitId: 'p-zhang', type: 'skill', targetId: 'e-archer' },
  }), /invalid for skill/);

  const result = resolveWith(state, {
    'p-zhang': { unitId: 'p-zhang', type: 'skill', targetId: 'e-captain' },
  });
  assert.equal(result.units.find((unit) => unit.id === 'e-captain')?.suppressed, true);
  assert.equal(skillState(result, 'p-zhang')?.usesRemaining, 0);
  assert.equal(skillState(result, 'p-zhang')?.cooldownRemaining, 2);
  assert.equal(logSkill(result, 'zhang-fei-thunderous-roar')[0]?.success, true);
});

test('a personal skill cannot be used by a unit that does not own that skill', () => {
  const state = makeBattle();
  const invalid = {
    ...state,
    units: state.units.map((unit) => unit.id === 'p-guan'
      ? { ...unit, skillId: 'liu-bei-rende', skillState: { skillId: 'liu-bei-rende', cooldownRemaining: 0, usesRemaining: 2 } }
      : unit),
  } as unknown as BattleState;
  assert.throws(() => resolveWith(invalid, {
    'p-guan': { unitId: 'p-guan', type: 'skill', targetId: 'p-liu' },
  }), /does not own skill/);
});

test('a general without a skill cannot submit a skill order', () => {
  const state = makeBattle();
  assert.throws(() => resolveWith(state, {
    'e-captain': { unitId: 'e-captain', type: 'skill', targetId: 'p-liu' },
  }), /no personal skill/);
});

test('cooldown decreases once at each completed round and the final use cannot be exceeded', () => {
  let state = setTroops(makeBattle(), 'p-guan', 190);
  state = resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  });
  assert.equal(skillState(state, 'p-liu')?.cooldownRemaining, 1, 'two-round cooldown ticks once after use round');
  assert.throws(() => resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  }), /on cooldown/);

  state = resolveWith(state, {});
  assert.equal(state.round, 3);
  assert.equal(skillState(state, 'p-liu')?.cooldownRemaining, 0);
  state = resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  });
  assert.equal(skillState(state, 'p-liu')?.usesRemaining, 0);
  assert.throws(() => resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  }), /no uses remaining/);
});

test('a skill target defeated before the caster acts is skipped without consuming the skill', () => {
  let state = makeBattle();
  state = setLeadership(state, 'p-liu', 120);
  state = setLeadership(state, 'p-guan', 90);
  state = setTroops(state, 'e-captain', 1);
  const result = resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'attack', targetId: 'e-captain' },
    'p-guan': { unitId: 'p-guan', type: 'skill', targetId: 'e-captain' },
  });
  assert.equal(result.units.find((unit) => unit.id === 'e-captain')?.troops, 0);
  assert.equal(skillState(result, 'p-guan')?.usesRemaining, 2);
  assert.ok(result.log.some((entry) => entry.type === 'order_skipped' && entry.unitId === 'p-guan' && entry.reason === 'target_invalid'));
});

test('duplicate commands cannot grant a general a second action in the same round', () => {
  const state = makeBattle();
  const duplicate = ordersWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  });
  duplicate.push({ unitId: 'p-liu', type: 'wait' });
  assert.throws(() => resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: duplicate,
  }), /duplicate order/);
});

test('enemy AI selects a ready personal skill deterministically and respects cooldown', () => {
  const enemySkillConfig: BattleConfig = {
    playerUnits: [
      { id: 'p1', generalId: 'common-p1', name: 'P1', unitClass: 'infantry', stats: { martial: 40, intelligence: 40, leadership: 50 }, troops: 200, maxTroops: 200 },
      { id: 'p2', generalId: 'common-p2', name: 'P2', unitClass: 'infantry', stats: { martial: 40, intelligence: 40, leadership: 40 }, troops: 200, maxTroops: 200 },
      { id: 'p3', generalId: 'common-p3', name: 'P3', unitClass: 'infantry', stats: { martial: 40, intelligence: 40, leadership: 30 }, troops: 200, maxTroops: 200 },
    ],
    enemyUnits: [
      { id: 'e1', generalId: 'liu-bei', name: 'Enemy Liu Bei', unitClass: 'infantry', stats: { martial: 70, intelligence: 76, leadership: 70 }, troops: 150, maxTroops: 200, skillId: 'liu-bei-rende' },
      { id: 'e2', generalId: 'ally-e2', name: 'Enemy Ally', unitClass: 'infantry', stats: { martial: 30, intelligence: 30, leadership: 30 }, troops: 100, maxTroops: 200 },
      { id: 'e3', generalId: 'ally-e3', name: 'Enemy Ally 2', unitClass: 'infantry', stats: { martial: 30, intelligence: 30, leadership: 20 }, troops: 170, maxTroops: 200 },
    ],
  };
  const state = createBattle(enemySkillConfig, 1234);
  const before = JSON.stringify(state);
  const orders = chooseEnemyOrders(state);
  assert.deepEqual(orders[0], { unitId: 'e1', type: 'skill', targetId: 'e2' });
  assert.equal(JSON.stringify(state), before, 'AI evaluation must not mutate battle state');
  const cooling = {
    ...state,
    units: state.units.map((unit) => unit.id === 'e1' && unit.skillState
      ? { ...unit, skillState: { ...unit.skillState, cooldownRemaining: 1 } }
      : unit),
  };
  assert.notEqual(chooseEnemyOrders(cooling)[0]?.type, 'skill');
});

test('skill uses and cooldown survive campaign JSON save/load exactly', () => {
  const state = setTroops(makeBattle(), 'p-guan', 185);
  const afterSkill = resolveWith(state, {
    'p-liu': { unitId: 'p-liu', type: 'skill', targetId: 'p-guan' },
  });
  const save: CampaignSave = {
    version: CAMPAIGN_SAVE_VERSION,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 5, supplies: 2, bond: 2, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle',
    battleState: afterSkill,
    playerFormation: 'square',
    playerOrders: [{ unitId: 'p-liu', type: 'skill', targetId: 'p-guan' }],
  };
  const restored = loadCampaignSave(JSON.stringify(save));
  assert.equal(restored.status, 'current');
  assert.deepEqual(
    restored.save.battleState?.units.find((unit) => unit.id === 'p-liu')?.skillState,
    { skillId: 'liu-bei-rende', cooldownRemaining: 1, usesRemaining: 1 },
  );
  assert.deepEqual(restored.save.playerOrders, save.playerOrders);
  assert.equal(restored.save.battleState?.round, afterSkill.round);
  assert.deepEqual(restored.save.battleState?.log, afterSkill.log);
});

console.log(`\nM2-C SKILL EXECUTION TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

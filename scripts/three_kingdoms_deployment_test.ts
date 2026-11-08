/**
 * Headless deterministic tests for M2-C 3x3 deployment, line screening,
 * unit-class roles, and army doctrine.
 * Run: npx tsx scripts/three_kingdoms_deployment_test.ts
 */
import assert from 'node:assert/strict';
import {
  chooseEnemyFormation,
  chooseEnemyOrders,
  createBattle,
  getValidAttackTargets,
  isValidAttackTarget,
  nextRandom,
  resolveRound,
  setUnitDeployment,
  type BattleConfig,
  type BattleSide,
  type BattleState,
  type BattleUnitConfig,
  type DeploymentAssignment,
  type DeploymentSlot,
  type Formation,
  type UnitClass,
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

const baseStats = { martial: 50, intelligence: 50, leadership: 50 };

function unit(
  id: string,
  side: BattleSide,
  overrides: Partial<Omit<BattleUnitConfig, 'id' | 'generalId'>> & { generalId?: string } = {},
): BattleUnitConfig {
  return {
    id,
    generalId: overrides.generalId ?? `general-${id}`,
    name: overrides.name ?? id,
    unitClass: overrides.unitClass ?? 'infantry',
    stats: { ...baseStats, ...(overrides.stats ?? {}) },
    troops: overrides.troops ?? 200,
    maxTroops: overrides.maxTroops ?? 200,
    ...(overrides.slot ? { slot: overrides.slot } : {}),
  };
}

function config(
  player: BattleUnitConfig[] = [
    unit('p1', 'player'),
    unit('p2', 'player'),
    unit('p3', 'player'),
  ],
  enemy: BattleUnitConfig[] = [
    unit('e1', 'enemy'),
    unit('e2', 'enemy'),
    unit('e3', 'enemy'),
  ],
): BattleConfig {
  return { playerUnits: player, enemyUnits: enemy };
}

function makeBattle(value: BattleConfig = config(), seed = 0x33445566): BattleState {
  return createBattle(value, seed);
}

function ordersFor(
  state: BattleState,
  replacements: Record<string, UnitOrder> = {},
): UnitOrder[] {
  return state.units
    .filter((candidate) => candidate.troops > 0)
    .map((candidate) => replacements[candidate.id] ?? { unitId: candidate.id, type: 'wait' });
}

function withOrders(
  state: BattleState,
  replacements: Record<string, UnitOrder>,
  formations: Record<BattleSide, Formation> = { player: 'arrow', enemy: 'arrow' },
): BattleState {
  return resolveRound(state, { formations, orders: ordersFor(state, replacements) });
}

function setTroops(state: BattleState, unitId: string, troops: number): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === unitId ? { ...unit, troops } : unit),
  };
}

function screenedBattle(): BattleState {
  return makeBattle(config(
    [
      unit('p-front', 'player', { slot: 'front-center', troops: 220 }),
      unit('p-middle', 'player', { slot: 'middle-center', troops: 180 }),
      unit('p-rear', 'player', { slot: 'rear-center', unitClass: 'archer', troops: 160 }),
    ],
    [
      unit('e-melee', 'enemy', { slot: 'front-left', unitClass: 'infantry' }),
      unit('e-archer', 'enemy', { slot: 'front-right', unitClass: 'archer' }),
      unit('e-cavalry', 'enemy', { slot: 'rear-left', unitClass: 'cavalry' }),
    ],
  ));
}

function attackCasualties(
  attackerClass: UnitClass,
  attackerSlot: DeploymentSlot,
  targetSlot: DeploymentSlot,
  attackerFormation: Formation,
  defenderFormation: Formation,
): number {
  const remainingEnemySlots: DeploymentSlot[] = DEPLOYMENT_SLOTS_FOR_TARGET(targetSlot);
  const state = makeBattle(config(
    [
      unit('p-attacker', 'player', {
        unitClass: attackerClass,
        slot: attackerSlot,
        stats: { martial: 85, leadership: 100 },
      }),
      unit('p2', 'player', { slot: 'front-center' === attackerSlot ? 'front-left' : 'front-center' }),
      unit('p3', 'player', { slot: 'front-right' }),
    ],
    [
      unit('e-target', 'enemy', {
        slot: targetSlot,
        troops: 500,
        maxTroops: 500,
        stats: { leadership: 1 },
      }),
      unit('e2', 'enemy', { slot: remainingEnemySlots[0] }),
      unit('e3', 'enemy', { slot: remainingEnemySlots[1] }),
    ],
  ));
  const resolved = withOrders(
    state,
    { 'p-attacker': { unitId: 'p-attacker', type: 'attack', targetId: 'e-target' } },
    { player: attackerFormation, enemy: defenderFormation },
  );
  const loss = resolved.log.find((entry) =>
    entry.type === 'troops_lost' && entry.targetId === 'e-target',
  );
  assert.ok(loss && loss.type === 'troops_lost');
  return loss.casualties;
}

function DEPLOYMENT_SLOTS_FOR_TARGET(targetSlot: DeploymentSlot): [DeploymentSlot, DeploymentSlot] {
  const all: DeploymentSlot[] = [
    'front-left', 'front-center', 'front-right',
    'middle-left', 'middle-center', 'middle-right',
    'rear-left', 'rear-center', 'rear-right',
  ];
  return all.filter((slot) => slot !== targetSlot).slice(0, 2) as [DeploymentSlot, DeploymentSlot];
}

test('fresh battle assigns deterministic, unique 3x3 slots for both sides', () => {
  const state = makeBattle();
  assert.equal(state.version, 3);
  assert.deepEqual(state.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot), [
    'front-center', 'front-left', 'front-right',
  ]);
  assert.deepEqual(state.units.filter((unit) => unit.side === 'enemy').map((unit) => unit.slot), [
    'front-center', 'front-left', 'front-right',
  ]);
});

test('battle creation rejects duplicate deployment slots on the same side', () => {
  const invalid = config(
    [
      unit('p1', 'player', { slot: 'front-center' }),
      unit('p2', 'player', { slot: 'front-center' }),
      unit('p3', 'player', { slot: 'front-right' }),
    ],
    [
      unit('e1', 'enemy'),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
  );
  assert.throws(() => makeBattle(invalid), /duplicate player deployment slot/);
});

test('mirrored deployment slots are legal because each army owns its own 3x3 grid', () => {
  const state = makeBattle();
  assert.deepEqual(
    state.units.filter((unit) => unit.slot === 'front-center').map((unit) => unit.side).sort(),
    ['enemy', 'player'],
  );
});

test('setUnitDeployment moves each general exactly once, logs assignments, and does not mutate the input', () => {
  const state = makeBattle();
  const before = JSON.stringify(state);
  const assignments: DeploymentAssignment[] = [
    { unitId: 'p1', slot: 'rear-right' },
    { unitId: 'p2', slot: 'middle-center' },
    { unitId: 'p3', slot: 'front-left' },
  ];
  const next = setUnitDeployment(state, 'player', assignments);
  assert.deepEqual(
    next.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot),
    ['rear-right', 'middle-center', 'front-left'],
  );
  assert.equal(next.log.some((entry) =>
    entry.type === 'deployment_changed'
      && entry.side === 'player'
      && entry.assignments.length === 3,
  ), true);
  assert.equal(JSON.stringify(state), before);
});

test('setUnitDeployment rejects duplicate cells, duplicate units, missing units, and enemy IDs on the wrong side', () => {
  const state = makeBattle();
  assert.throws(() => setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-left' },
    { unitId: 'p2', slot: 'front-left' },
    { unitId: 'p3', slot: 'rear-right' },
  ]), /duplicate deployment slot/);
  assert.throws(() => setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-left' },
    { unitId: 'p1', slot: 'middle-left' },
    { unitId: 'p3', slot: 'rear-right' },
  ]), /duplicate deployment unit/);
  assert.throws(() => setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-left' },
    { unitId: 'p2', slot: 'middle-left' },
  ]), /exactly three units/);
  assert.throws(() => setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-left' },
    { unitId: 'p2', slot: 'middle-left' },
    { unitId: 'e3', slot: 'rear-right' },
  ]), /not on side player/);
});

test('deployment can be adjusted repeatedly before combat, but locks after round one', () => {
  let state = makeBattle();
  state = setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'rear-left' },
    { unitId: 'p2', slot: 'middle-center' },
    { unitId: 'p3', slot: 'front-right' },
  ]);
  state = setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-center' },
    { unitId: 'p2', slot: 'rear-center' },
    { unitId: 'p3', slot: 'middle-right' },
  ]);
  assert.equal(state.log.filter((entry) => entry.type === 'deployment_changed').length, 2);
  state = withOrders(state, {});
  assert.equal(state.round, 2);
  assert.throws(() => setUnitDeployment(state, 'player', [
    { unitId: 'p1', slot: 'front-left' },
    { unitId: 'p2', slot: 'front-center' },
    { unitId: 'p3', slot: 'front-right' },
  ]), /locked/);
});

test('infantry and cavalry are screened by the front-most living unit in the same lane', () => {
  const state = screenedBattle();
  const melee = state.units.find((unit) => unit.id === 'e-melee')!;
  const front = state.units.find((unit) => unit.id === 'p-front')!;
  const middle = state.units.find((unit) => unit.id === 'p-middle')!;
  const rear = state.units.find((unit) => unit.id === 'p-rear')!;
  assert.equal(isValidAttackTarget(state, melee, front), true);
  assert.equal(isValidAttackTarget(state, melee, middle), false);
  assert.equal(isValidAttackTarget(state, melee, rear), false);
  assert.deepEqual(getValidAttackTargets(state, 'e-melee').map((unit) => unit.id), ['p-front']);
});

test('archers can attack a protected rear unit without clearing its frontline first', () => {
  const state = screenedBattle();
  const archer = state.units.find((unit) => unit.id === 'e-archer')!;
  const rear = state.units.find((unit) => unit.id === 'p-rear')!;
  assert.equal(isValidAttackTarget(state, archer, rear), true);
  assert.ok(getValidAttackTargets(state, 'e-archer').some((unit) => unit.id === 'p-rear'));
  const resolved = withOrders(state, {
    'e-archer': { unitId: 'e-archer', type: 'attack', targetId: 'p-rear' },
  });
  assert.ok(resolved.log.some((entry) => entry.type === 'unit_attacked'
    && entry.attackerId === 'e-archer'
    && entry.targetId === 'p-rear'));
});

test('defeating the front unit exposes the next living unit in that same lane', () => {
  const state = setTroops(screenedBattle(), 'p-front', 0);
  const melee = state.units.find((unit) => unit.id === 'e-melee')!;
  const middle = state.units.find((unit) => unit.id === 'p-middle')!;
  const rear = state.units.find((unit) => unit.id === 'p-rear')!;
  assert.equal(isValidAttackTarget(state, melee, middle), true);
  assert.equal(isValidAttackTarget(state, melee, rear), false);
});

test('a middle unit is not screened by a front unit in a different lane', () => {
  const state = makeBattle(config(
    [
      unit('p-front-left', 'player', { slot: 'front-left' }),
      unit('p-middle-center', 'player', { slot: 'middle-center' }),
      unit('p-rear-right', 'player', { slot: 'rear-right' }),
    ],
    [
      unit('e1', 'enemy', { slot: 'front-center' }),
      unit('e2', 'enemy', { slot: 'front-left' }),
      unit('e3', 'enemy', { slot: 'front-right' }),
    ],
  ));
  const attacker = state.units.find((unit) => unit.id === 'e1')!;
  const middle = state.units.find((unit) => unit.id === 'p-middle-center')!;
  assert.equal(isValidAttackTarget(state, attacker, middle), true);
});

test('the round engine rejects a melee order against a screened rear target', () => {
  const state = screenedBattle();
  assert.throws(() => withOrders(state, {
    'e-melee': { unitId: 'e-melee', type: 'attack', targetId: 'p-middle' },
  }), /screened by the frontline/);
});

test('enemy AI never selects a screened target for its melee units', () => {
  const state = screenedBattle();
  const meleeOrder = chooseEnemyOrders(state).find((order) => order.unitId === 'e-melee');
  assert.ok(meleeOrder && 'targetId' in meleeOrder);
  assert.equal(meleeOrder.targetId, 'p-front');
});

test('cavalry gains the configured flank damage bonus when attacking another lane', () => {
  const sameLane = attackCasualties('cavalry', 'front-left', 'front-left', 'square', 'square');
  const flanking = attackCasualties('cavalry', 'front-left', 'front-center', 'square', 'square');
  assert.ok(flanking > sameLane);
});

test('Wedge strengthens cavalry charges and Turtle strengthens incoming defence', () => {
  const arrowCavalry = attackCasualties('cavalry', 'front-left', 'front-center', 'arrow', 'square');
  const wedgeCavalry = attackCasualties('cavalry', 'front-left', 'front-center', 'wedge', 'square');
  const arrowInfantry = attackCasualties('infantry', 'front-left', 'front-center', 'arrow', 'square');
  const wedgeInfantry = attackCasualties('infantry', 'front-left', 'front-center', 'wedge', 'square');
  const squareDefense = attackCasualties('infantry', 'front-left', 'front-center', 'arrow', 'square');
  const turtleDefense = attackCasualties('infantry', 'front-left', 'front-center', 'arrow', 'turtle');
  assert.ok(wedgeCavalry > arrowCavalry, 'Wedge should amplify cavalry damage');
  assert.ok(wedgeInfantry < squareDefense, 'Wedge should reduce non-cavalry damage');
  assert.ok(turtleDefense < squareDefense, 'Turtle should improve incoming protection');
});

test('enemy formation selection uses cavalry composition for Wedge and ranged composition for Turtle', () => {
  const wedge = makeBattle(config(
    [unit('p1', 'player'), unit('p2', 'player'), unit('p3', 'player')],
    [
      unit('e1', 'enemy', { unitClass: 'cavalry', troops: 200 }),
      unit('e2', 'enemy', { unitClass: 'cavalry', troops: 200 }),
      unit('e3', 'enemy', { unitClass: 'infantry', troops: 200 }),
    ],
  ));
  assert.equal(chooseEnemyFormation(wedge), 'wedge');

  const turtle = makeBattle(config(
    [
      unit('p1', 'player', { troops: 250 }),
      unit('p2', 'player', { troops: 250 }),
      unit('p3', 'player', { troops: 250 }),
    ],
    [
      unit('e1', 'enemy', { unitClass: 'archer', troops: 100 }),
      unit('e2', 'enemy', { unitClass: 'archer', troops: 100 }),
      unit('e3', 'enemy', { unitClass: 'infantry', troops: 100 }),
    ],
  ));
  assert.equal(chooseEnemyFormation(turtle), 'turtle');
});

test('deployment slots, army doctrine, and battle log survive campaign JSON save/load', () => {
  const state = setUnitDeployment(makeBattle(), 'player', [
    { unitId: 'p1', slot: 'rear-right' },
    { unitId: 'p2', slot: 'middle-center' },
    { unitId: 'p3', slot: 'front-left' },
  ]);
  const battle = { ...state, formations: { ...state.formations, player: 'turtle' as const } };
  const save: CampaignSave = {
    version: CAMPAIGN_SAVE_VERSION,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 5, supplies: 4, bond: 2, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle',
    battleState: battle,
    playerFormation: 'wedge',
    playerOrders: [{ unitId: 'p1', type: 'wait' }],
  };
  const loaded = loadCampaignSave(JSON.stringify(save));
  assert.equal(loaded.status, 'current');
  assert.equal(loaded.save.battleState?.units.find((unit) => unit.id === 'p1')?.slot, 'rear-right');
  assert.equal(loaded.save.battleState?.formations.player, 'turtle');
  assert.equal(loaded.save.playerFormation, 'wedge');
  assert.deepEqual(loaded.save.battleState?.log, battle.log);
});

console.log(`\nM2-C DEPLOYMENT/CLASS/FORMATION TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

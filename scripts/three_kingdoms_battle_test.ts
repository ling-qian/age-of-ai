/**
 * Headless deterministic tests for the isolated Three Kingdoms M2-A battle engine.
 * Run: npx tsx scripts/three_kingdoms_battle_test.ts
 */
import assert from 'node:assert/strict';
import {
  BATTLE_RULES,
  calculateHitChance,
  calculateSchemeChance,
  chooseEnemyFormation,
  chooseEnemyOrders,
  compareIdsByCodePoint,
  createBattle,
  nextRandom,
  remainingTroops,
  resolveRound,
  type BattleConfig,
  type BattleState,
  type BattleUnit,
  type BattleUnitConfig,
  type BattleSide,
  type Formation,
  type UnitClass,
  type UnitOrder,
} from '../client/src/three-kingdoms/battle-engine.ts';

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

function makeBattle(
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
  seed = 12345,
): BattleState {
  return createBattle(config(player, enemy), seed);
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

function logEntry<T extends BattleState['log'][number]['type']>(
  state: BattleState,
  type: T,
): Extract<BattleState['log'][number], { type: T }> {
  const found = state.log.find((entry) => entry.type === type);
  assert.ok(found, `missing log entry: ${type}`);
  return found as Extract<BattleState['log'][number], { type: T }>;
}

function seedForRoll(predicate: (roll: number) => boolean): number {
  for (let seed = 1; seed < 2_000_000; seed++) {
    if (predicate(nextRandom(seed).value)) return seed;
  }
  throw new Error('could not find a deterministic seed for the requested roll');
}

function seedForRollSequence(count: number, predicate: (rolls: number[]) => boolean): number {
  for (let seed = 1; seed < 2_000_000; seed++) {
    let rngState = seed;
    const rolls: number[] = [];
    for (let index = 0; index < count; index++) {
      const next = nextRandom(rngState);
      rolls.push(next.value);
      rngState = next.state;
    }
    if (predicate(rolls)) return seed;
  }
  throw new Error('could not find a deterministic seed sequence');
}

function expectedCasualties(
  attacker: BattleUnit,
  defender: BattleUnit,
  attackerFormation: Formation,
  defenderFormation: Formation,
  guarded: boolean,
  suppressed: boolean,
): number {
  const base = 35 + attacker.stats.martial * 0.75 + attacker.stats.leadership * 0.25;
  const strength = 0.5 + 0.5 * (attacker.troops / attacker.maxTroops);
  const outgoing = attackerFormation === 'arrow' ? 1.15 : 1;
  const incoming = defenderFormation === 'square' ? 0.8 : 1;
  const guard = guarded ? 0.7 : 1;
  const suppression = suppressed ? 0.65 : 1;
  return Math.min(
    defender.troops,
    Math.max(1, Math.round(base * strength * outgoing * incoming * guard * suppression)),
  );
}

test('createBattle builds a fresh serializable 3v3 state and uses the documented zero-seed fallback', () => {
  const input = config();
  const before = JSON.stringify(input);
  const state = createBattle(input, 0);
  assert.equal(state.version, 1);
  assert.equal(state.round, 1);
  assert.equal(state.phase, 'ready');
  assert.equal(state.rngState, BATTLE_RULES.seedFallback);
  assert.equal(state.units.length, 6);
  assert.equal(state.units.filter((candidate) => candidate.side === 'player').length, 3);
  assert.equal(state.units.filter((candidate) => candidate.side === 'enemy').length, 3);
  assert.deepEqual(state.formations, { player: 'arrow', enemy: 'arrow' });
  assert.equal(state.log[0]?.type, 'battle_started');
  assert.equal(JSON.stringify(input), before, 'createBattle must not mutate its config');
});

test('xorshift32 produces stable 0..99 rolls and advances exactly one state per call', () => {
  const first = nextRandom(12345);
  const second = nextRandom(12345);
  assert.deepEqual(first, second);
  assert.ok(first.value >= 0 && first.value <= 99);
  assert.notEqual(first.state, 12345);
  assert.equal(nextRandom(0).state, nextRandom(BATTLE_RULES.seedFallback).state);
});

test('code-point ID comparison is deterministic and locale independent', () => {
  assert.ok(compareIdsByCodePoint('alpha', 'beta') < 0);
  assert.ok(compareIdsByCodePoint('beta', 'alpha') > 0);
  assert.equal(compareIdsByCodePoint('same', 'same'), 0);
  assert.ok(compareIdsByCodePoint('A', 'a') < 0);
  assert.ok(compareIdsByCodePoint('😀', '𐀀') > 0);
});

test('all nine unit-class hit-matrix cells are applied exactly', () => {
  const classes: UnitClass[] = ['infantry', 'archer', 'cavalry'];
  for (const attackerClass of classes) {
    for (const defenderClass of classes) {
      const state = makeBattle(
        [
          unit('p1', 'player', { unitClass: attackerClass, stats: { martial: 50, leadership: 50 } }),
          unit('p2', 'player'),
          unit('p3', 'player'),
        ],
        [
          unit('e1', 'enemy', { unitClass: defenderClass, stats: { leadership: 50 }, troops: 500, maxTroops: 500 }),
          unit('e2', 'enemy'),
          unit('e3', 'enemy'),
        ],
      );
      const result = withOrders(state, {
        p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
      });
      const attack = result.log.find((entry) => entry.type === 'unit_attacked');
      assert.ok(attack && attack.type === 'unit_attacked');
      assert.equal(
        attack.hitChance,
        BATTLE_RULES.classHitChance[attackerClass][defenderClass],
        `${attackerClass} versus ${defenderClass}`,
      );
    }
  }
});

test('hit-chance formula reaches its legal lower and upper values under valid stat bounds', () => {
  const lowBattle = makeBattle(
    [unit('p1', 'player', { unitClass: 'infantry', stats: { martial: 1 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { unitClass: 'archer', stats: { leadership: 100 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
  );
  const highBattle = makeBattle(
    [unit('p1', 'player', { unitClass: 'infantry', stats: { martial: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { unitClass: 'archer', stats: { leadership: 1 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
  );
  assert.equal(calculateHitChance(lowBattle.units[0], lowBattle.units[3]), 10);
  assert.equal(calculateHitChance(highBattle.units[0], highBattle.units[3]), 90);
  // With stats constrained to 1..100, the 5/95 safety clamp is a guardrail:
  // the 3x3 matrix plus the maximum +/-10 adjustment makes 10..90 reachable.
  assert.equal(BATTLE_RULES.hitChanceMin, 5);
  assert.equal(BATTLE_RULES.hitChanceMax, 95);
});

test('deterministic attack roll boundary is exclusive: roll 49 hits at 50%, roll 50 misses', () => {
  const seedHit = seedForRoll((roll) => roll === 49);
  const seedMiss = seedForRoll((roll) => roll === 50);
  const make = (seed: number) => {
    const state = makeBattle(
      [unit('p1', 'player', { stats: { martial: 50, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
      [unit('e1', 'enemy', { stats: { leadership: 50 }, troops: 500, maxTroops: 500 }), unit('e2', 'enemy'), unit('e3', 'enemy')],
      seed,
    );
    return withOrders(state, { p1: { unitId: 'p1', type: 'attack', targetId: 'e1' } });
  };
  const hit = logEntry(make(seedHit), 'unit_attacked');
  const miss = logEntry(make(seedMiss), 'unit_attacked');
  assert.equal(hit.hitChance, 50);
  assert.equal(hit.roll, 49);
  assert.equal(hit.hit, true);
  assert.equal(miss.hitChance, 50);
  assert.equal(miss.roll, 50);
  assert.equal(miss.hit, false);
});

test('scheme chance clamps to its 10% minimum and 90% maximum', () => {
  const maximum = makeBattle(
    [unit('p1', 'player', { stats: { intelligence: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { stats: { intelligence: 1 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
  );
  const minimum = makeBattle(
    [unit('p1', 'player', { stats: { intelligence: 1 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { stats: { intelligence: 100 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
  );
  assert.equal(calculateSchemeChance(maximum.units[0], maximum.units[3]), 90);
  assert.equal(calculateSchemeChance(minimum.units[0], minimum.units[3]), 10);
});

test('attack casualties follow the formula, stop at remaining troops, and never go negative', () => {
  const seed = seedForRoll((roll) => roll < 90);
  const state = makeBattle(
    [unit('p1', 'player', { stats: { martial: 100, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
    seed,
  );
  const beforeAttacker = state.units.find((candidate) => candidate.id === 'p1')!;
  const beforeDefender = state.units.find((candidate) => candidate.id === 'e1')!;
  const expected = expectedCasualties(beforeAttacker, beforeDefender, 'arrow', 'arrow', false, false);
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
  });
  const loss = result.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e1');
  assert.ok(loss && loss.type === 'troops_lost');
  assert.equal(loss.casualties, expected);
  assert.equal(loss.casualties, 1);
  assert.equal(loss.remainingTroops, 0);
  assert.equal(result.units.find((candidate) => candidate.id === 'e1')?.troops, 0);
  assert.ok(result.units.every((candidate) => candidate.troops >= 0));
});

test('Arrow increases outgoing casualties and Square reduces incoming casualties', () => {
  const seed = seedForRoll((roll) => roll < 90);
  const make = (playerFormation: Formation, enemyFormation: Formation) => {
    const state = makeBattle(
      [unit('p1', 'player', { stats: { martial: 100, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
      [unit('e1', 'enemy', { troops: 500, maxTroops: 500, stats: { leadership: 1 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
      seed,
    );
    const result = withOrders(
      state,
      { p1: { unitId: 'p1', type: 'attack', targetId: 'e1' } },
      { player: playerFormation, enemy: enemyFormation },
    );
    const loss = result.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e1');
    assert.ok(loss && loss.type === 'troops_lost');
    return loss.casualties;
  };

  const neutral = make('square', 'arrow');
  const arrow = make('arrow', 'arrow');
  const squareDefense = make('arrow', 'square');
  assert.ok(arrow > neutral, 'Arrow must raise outgoing casualties');
  assert.ok(squareDefense < arrow, 'Square must reduce incoming casualties');
});

test('initiative sorts Leadership descending and breaks ties by code-point unit ID', () => {
  const state = makeBattle(
    [
      unit('p2', 'player', { stats: { leadership: 90 } }),
      unit('p1', 'player', { stats: { leadership: 90 } }),
      unit('p3', 'player', { stats: { leadership: 30 } }),
    ],
    [
      unit('e2', 'enemy', { stats: { leadership: 90 } }),
      unit('e1', 'enemy', { stats: { leadership: 100 } }),
      unit('e3', 'enemy', { stats: { leadership: 20 } }),
    ],
  );
  const result = withOrders(state, {});
  const guardedIds = result.log
    .filter((entry) => entry.type === 'unit_guarded')
    .map((entry) => entry.type === 'unit_guarded' ? entry.unitId : '');
  assert.deepEqual(guardedIds, ['e1', 'e2', 'p1', 'p2', 'p3', 'e3']);
});

test('a unit defeated before its initiative has its pending order skipped', () => {
  const seed = seedForRoll((roll) => roll < 90);
  const state = makeBattle(
    [unit('p1', 'player', { stats: { martial: 100, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
    seed,
  );
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
  });
  assert.ok(result.log.some((entry) =>
    entry.type === 'order_skipped' && entry.unitId === 'e1' && entry.reason === 'unit_defeated',
  ));
  assert.equal(result.units.find((candidate) => candidate.id === 'e1')?.troops, 0);
});

test('round validation rejects duplicate and missing unit orders', () => {
  const state = makeBattle();
  const duplicate = ordersFor(state);
  duplicate[1] = { ...duplicate[0] };
  assert.throws(() => resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: duplicate,
  }), /duplicate order/);

  const missing = ordersFor(state).slice(1);
  assert.throws(() => resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: missing,
  }), /exactly one order/);
});

test('round validation rejects friendly targets, defeated actors, and defeated targets', () => {
  const state = makeBattle();
  assert.throws(() => resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: ordersFor(state, {
      p1: { unitId: 'p1', type: 'attack', targetId: 'p2' },
    }),
  }), /friendly unit/);

  const deadTargetState: BattleState = {
    ...state,
    units: state.units.map((candidate) =>
      candidate.id === 'e1' ? { ...candidate, troops: 0 } : candidate,
    ),
  };
  assert.throws(() => resolveRound(deadTargetState, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: ordersFor(deadTargetState, {
      p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
    }),
  }), /defeated target/);

  const deadActorOrders = ordersFor(deadTargetState);
  deadActorOrders.pop();
  deadActorOrders.push({ unitId: 'e1', type: 'wait' });
  assert.throws(() => resolveRound(deadTargetState, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: deadActorOrders,
  }), /defeated unit/);
});

test('Scheme succeeds deterministically, consumes its one-use flag, and suppresses the target', () => {
  const seed = seedForRoll((roll) => roll < 90);
  const state = makeBattle(
    [unit('p1', 'player', { stats: { intelligence: 100, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { stats: { intelligence: 1, leadership: 50 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
    seed,
  );
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'scheme', targetId: 'e1' },
  });
  const scheme = logEntry(result, 'scheme_attempted');
  assert.equal(scheme.successChance, 90);
  assert.equal(scheme.success, true);
  assert.equal(result.units.find((candidate) => candidate.id === 'p1')?.schemeUsed, true);
  assert.equal(result.units.find((candidate) => candidate.id === 'e1')?.suppressed, true);

  assert.throws(() => resolveRound(result, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: ordersFor(result, {
      p1: { unitId: 'p1', type: 'scheme', targetId: 'e1' },
    }),
  }), /already used Scheme/);
});

test('Scheme failure still consumes the one-use flag and does not suppress the target', () => {
  const seed = seedForRoll((roll) => roll >= 10);
  const state = makeBattle(
    [unit('p1', 'player', { stats: { intelligence: 1, leadership: 100 } }), unit('p2', 'player'), unit('p3', 'player')],
    [unit('e1', 'enemy', { stats: { intelligence: 100, leadership: 50 } }), unit('e2', 'enemy'), unit('e3', 'enemy')],
    seed,
  );
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'scheme', targetId: 'e1' },
  });
  const scheme = logEntry(result, 'scheme_attempted');
  assert.equal(scheme.successChance, 10);
  assert.equal(scheme.success, false);
  assert.equal(result.units.find((candidate) => candidate.id === 'p1')?.schemeUsed, true);
  assert.equal(result.units.find((candidate) => candidate.id === 'e1')?.suppressed, false);
});

test('successful Scheme suppression is consumed by the target next Attack at the 0.65 multiplier', () => {
  const schemeSeed = seedForRoll((roll) => roll < 90);
  const attackSeed = seedForRoll((roll) => roll < 90);
  const initial = makeBattle(
    [
      unit('p1', 'player', { stats: { intelligence: 100, leadership: 100 } }),
      unit('p2', 'player', { stats: { martial: 60, leadership: 10 } }),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { martial: 100, leadership: 80, intelligence: 1 }, troops: 500, maxTroops: 500 }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    schemeSeed,
  );
  const schemed = withOrders(initial, {
    p1: { unitId: 'p1', type: 'scheme', targetId: 'e1' },
  });
  assert.equal(schemed.units.find((candidate) => candidate.id === 'e1')?.suppressed, true);

  const nextState: BattleState = { ...schemed, rngState: attackSeed };
  const attacking = withOrders(nextState, {
    e1: { unitId: 'e1', type: 'attack', targetId: 'p2' },
    p2: { unitId: 'p2', type: 'attack', targetId: 'e2' },
  });
  const loss = attacking.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'p2');
  assert.ok(loss && loss.type === 'troops_lost');
  const attacker = nextState.units.find((candidate) => candidate.id === 'e1')!;
  const defender = nextState.units.find((candidate) => candidate.id === 'p2')!;
  const expected = expectedCasualties(attacker, defender, 'arrow', 'arrow', false, true);
  assert.equal(loss.casualties, expected);
  assert.equal(attacking.units.find((candidate) => candidate.id === 'e1')?.suppressed, false);
});

test('a Scheme applied after the target already acted persists to the target next attack', () => {
  const schemeSeed = seedForRoll((roll) => roll < 90);
  const attackSeed = seedForRoll((roll) => roll < 90);
  const initial = makeBattle(
    [
      unit('p1', 'player', { stats: { intelligence: 100, leadership: 50 } }),
      unit('p2', 'player', { stats: { leadership: 10 } }),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { martial: 100, leadership: 100, intelligence: 1 }, troops: 500, maxTroops: 500 }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    schemeSeed,
  );
  const round1 = withOrders(initial, {
    e1: { unitId: 'e1', type: 'attack', targetId: 'p2' },
    p1: { unitId: 'p1', type: 'scheme', targetId: 'e1' },
  });
  assert.equal(round1.units.find((candidate) => candidate.id === 'e1')?.suppressed, true);

  const round2State: BattleState = { ...round1, rngState: attackSeed };
  const round2 = withOrders(round2State, {
    e1: { unitId: 'e1', type: 'attack', targetId: 'p2' },
  });
  const loss = round2.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'p2');
  assert.ok(loss && loss.type === 'troops_lost');
  const attacker = round2State.units.find((candidate) => candidate.id === 'e1')!;
  const defender = round2State.units.find((candidate) => candidate.id === 'p2')!;
  assert.equal(loss.casualties, expectedCasualties(attacker, defender, 'arrow', 'arrow', false, true));
});

test('Wait grants guard, reduces the first successful incoming hit, and consumes the guard', () => {
  const hitSeed = seedForRoll((roll) => roll < 50);
  const initial = makeBattle(
    [
      unit('p1', 'player', { stats: { leadership: 10 } }),
      unit('p2', 'player'),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { martial: 100, leadership: 100 }, troops: 500, maxTroops: 500 }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    hitSeed,
  );
  const guardedRound = withOrders(initial, {});
  assert.equal(guardedRound.units.find((candidate) => candidate.id === 'p1')?.guarded, true);

  const unguardedState: BattleState = {
    ...guardedRound,
    units: guardedRound.units.map((candidate) =>
      candidate.id === 'p1' ? { ...candidate, guarded: false } : candidate,
    ),
    rngState: hitSeed,
  };
  const guardedState: BattleState = { ...guardedRound, rngState: hitSeed };
  const orders = {
    e1: { unitId: 'e1', type: 'attack', targetId: 'p1' } as UnitOrder,
    p1: { unitId: 'p1', type: 'attack', targetId: 'e2' } as UnitOrder,
  };
  const guardedResult = withOrders(guardedState, orders);
  const unguardedResult = withOrders(unguardedState, orders);
  const guardedLoss = guardedResult.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'p1');
  const unguardedLoss = unguardedResult.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'p1');
  assert.ok(guardedLoss && guardedLoss.type === 'troops_lost');
  assert.ok(unguardedLoss && unguardedLoss.type === 'troops_lost');
  assert.ok(guardedLoss.casualties < unguardedLoss.casualties);
  assert.equal(guardedResult.units.find((candidate) => candidate.id === 'p1')?.guarded, false);
});

test('Wait guard persists across a round when the incoming attack misses', () => {
  const missSeed = seedForRoll((roll) => roll >= 50);
  const initial = makeBattle(
    [
      unit('p1', 'player', { stats: { leadership: 10 } }),
      unit('p2', 'player'),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { martial: 50, leadership: 100 } }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    missSeed,
  );
  const guardedRound = withOrders(initial, {});
  const result = withOrders(
    { ...guardedRound, rngState: missSeed },
    {
      e1: { unitId: 'e1', type: 'attack', targetId: 'p1' },
      p1: { unitId: 'p1', type: 'attack', targetId: 'e2' },
    },
  );
  const attack = result.log.find((entry) => entry.type === 'unit_attacked' && entry.attackerId === 'e1');
  assert.ok(attack && attack.type === 'unit_attacked');
  assert.equal(attack.hit, false);
  assert.equal(result.units.find((candidate) => candidate.id === 'p1')?.guarded, true);
});

test('enemy AI formation and orders follow deterministic troop/target priorities without consuming RNG', () => {
  const state = makeBattle(
    [
      unit('p1', 'player', { stats: { martial: 90 }, troops: 100, maxTroops: 100 }),
      unit('p2', 'player', { stats: { martial: 80 }, troops: 80, maxTroops: 100 }),
      unit('p3', 'player', { stats: { martial: 70 }, troops: 60, maxTroops: 100 }),
    ],
    [
      unit('e1', 'enemy', { stats: { intelligence: 70 }, troops: 100, maxTroops: 100 }),
      unit('e2', 'enemy', { stats: { intelligence: 50 }, troops: 100, maxTroops: 100 }),
      unit('e3', 'enemy', { stats: { intelligence: 50 }, troops: 100, maxTroops: 100 }),
    ],
  );
  const before = JSON.stringify(state);
  assert.equal(chooseEnemyFormation(state), 'arrow');
  const aiOrders = chooseEnemyOrders(state);
  assert.deepEqual(aiOrders, [
    { unitId: 'e1', type: 'scheme', targetId: 'p1' },
    { unitId: 'e2', type: 'attack', targetId: 'p3' },
    { unitId: 'e3', type: 'attack', targetId: 'p3' },
  ]);
  assert.equal(JSON.stringify(state), before, 'AI helpers must not mutate state or RNG');
});

test('defeated enemies are never selected by the enemy AI', () => {
  const state = makeBattle();
  const withDeadPlayer: BattleState = {
    ...state,
    units: state.units.map((candidate) => candidate.id === 'p1' ? { ...candidate, troops: 0 } : candidate),
  };
  const orders = chooseEnemyOrders(withDeadPlayer);
  assert.ok(orders.every((order) => !('targetId' in order) || order.targetId !== 'p1'));
});

test('immediate victory occurs when the last enemy unit is defeated', () => {
  const seed = seedForRollSequence(3, (rolls) => rolls.every((roll) => roll < 95));
  const state = makeBattle(
    [
      unit('p1', 'player', { stats: { martial: 100, leadership: 100 } }),
      unit('p2', 'player', { stats: { martial: 100, leadership: 99 } }),
      unit('p3', 'player', { stats: { martial: 100, leadership: 98 } }),
    ],
    [
      unit('e1', 'enemy', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
      unit('e2', 'enemy', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
      unit('e3', 'enemy', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
    ],
    seed,
  );
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
    p2: { unitId: 'p2', type: 'attack', targetId: 'e2' },
    p3: { unitId: 'p3', type: 'attack', targetId: 'e3' },
  });
  assert.equal(result.phase, 'finished');
  assert.equal(result.outcome, 'victory');
  assert.equal(logEntry(result, 'battle_finished').outcome, 'victory');
  assert.equal(remainingTroops(result, 'enemy'), 0);
});

test('immediate defeat occurs when the last player unit is defeated', () => {
  const seed = seedForRollSequence(3, (rolls) => rolls.every((roll) => roll < 95));
  const state = makeBattle(
    [
      unit('p1', 'player', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
      unit('p2', 'player', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
      unit('p3', 'player', { troops: 1, maxTroops: 1, stats: { leadership: 1 } }),
    ],
    [
      unit('e1', 'enemy', { stats: { martial: 100, leadership: 100 } }),
      unit('e2', 'enemy', { stats: { martial: 100, leadership: 99 } }),
      unit('e3', 'enemy', { stats: { martial: 100, leadership: 98 } }),
    ],
    seed,
  );
  const result = withOrders(state, {
    e1: { unitId: 'e1', type: 'attack', targetId: 'p1' },
    e2: { unitId: 'e2', type: 'attack', targetId: 'p2' },
    e3: { unitId: 'e3', type: 'attack', targetId: 'p3' },
  });
  assert.equal(result.phase, 'finished');
  assert.equal(result.outcome, 'defeat');
  assert.equal(logEntry(result, 'battle_finished').outcome, 'defeat');
  assert.equal(remainingTroops(result, 'player'), 0);
});

function waitToRound20(playerTroops: number, enemyTroops: number): BattleState {
  let state = makeBattle(
    [
      unit('p1', 'player', { troops: playerTroops, maxTroops: playerTroops }),
      unit('p2', 'player', { troops: playerTroops, maxTroops: playerTroops }),
      unit('p3', 'player', { troops: playerTroops, maxTroops: playerTroops }),
    ],
    [
      unit('e1', 'enemy', { troops: enemyTroops, maxTroops: enemyTroops }),
      unit('e2', 'enemy', { troops: enemyTroops, maxTroops: enemyTroops }),
      unit('e3', 'enemy', { troops: enemyTroops, maxTroops: enemyTroops }),
    ],
  );
  while (state.phase === 'ready') {
    state = resolveRound(state, {
      formations: { player: 'square', enemy: 'square' },
      orders: ordersFor(state),
    });
  }
  return state;
}

test('20-round adjudication returns draw, victory, or defeat according to remaining troop totals', () => {
  const draw = waitToRound20(100, 100);
  const victory = waitToRound20(200, 100);
  const defeat = waitToRound20(100, 200);
  assert.equal(draw.round, 20);
  assert.equal(draw.outcome, 'draw');
  assert.equal(victory.outcome, 'victory');
  assert.equal(defeat.outcome, 'defeat');
  assert.equal(logEntry(draw, 'battle_finished').outcome, 'draw');
});

test('same seed and same orders produce byte-equivalent state and log', () => {
  const make = () => makeBattle(
    [
      unit('p1', 'player', { stats: { martial: 80, leadership: 100 } }),
      unit('p2', 'player'),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { leadership: 10 }, troops: 500, maxTroops: 500 }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    987654321,
  );
  const resolve = (state: BattleState) => withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
  });
  assert.equal(JSON.stringify(resolve(make())), JSON.stringify(resolve(make())));
});

test('different seeds can change rolls without changing hit chance or non-random casualty math', () => {
  const seeds: number[] = [];
  const rolls = new Set<number>();
  for (let seed = 1; seed < 10_000 && seeds.length < 2; seed++) {
    const roll = nextRandom(seed).value;
    if (roll < 90 && !rolls.has(roll)) {
      seeds.push(seed);
      rolls.add(roll);
    }
  }
  assert.equal(seeds.length, 2);
  const make = (seed: number) => makeBattle(
    [
      unit('p1', 'player', { stats: { martial: 100, leadership: 100 } }),
      unit('p2', 'player'),
      unit('p3', 'player'),
    ],
    [
      unit('e1', 'enemy', { stats: { leadership: 1 }, troops: 500, maxTroops: 500 }),
      unit('e2', 'enemy'),
      unit('e3', 'enemy'),
    ],
    seed,
  );
  const resolve = (state: BattleState) => withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
  });
  const first = resolve(make(seeds[0]));
  const second = resolve(make(seeds[1]));
  const firstAttack = first.log.find((entry) => entry.type === 'unit_attacked');
  const secondAttack = second.log.find((entry) => entry.type === 'unit_attacked');
  const firstLoss = first.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e1');
  const secondLoss = second.log.find((entry) => entry.type === 'troops_lost' && entry.targetId === 'e1');
  assert.ok(firstAttack && firstAttack.type === 'unit_attacked');
  assert.ok(secondAttack && secondAttack.type === 'unit_attacked');
  assert.ok(firstLoss && firstLoss.type === 'troops_lost');
  assert.ok(secondLoss && secondLoss.type === 'troops_lost');
  assert.notEqual(firstAttack.roll, secondAttack.roll);
  assert.equal(firstAttack.hitChance, secondAttack.hitChance);
  assert.equal(firstAttack.hit, true);
  assert.equal(secondAttack.hit, true);
  assert.equal(firstLoss.casualties, secondLoss.casualties);
});

test('resolveRound returns a new state and never mutates its input', () => {
  const state = makeBattle();
  const before = JSON.stringify(state);
  const result = withOrders(state, {
    p1: { unitId: 'p1', type: 'attack', targetId: 'e1' },
  });
  assert.notEqual(result, state);
  assert.notEqual(result.units, state.units);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.round, 1);
  assert.equal(state.log.length, 1);
});

test('round resolver rejects a finished battle', () => {
  const state = waitToRound20(100, 100);
  assert.throws(() => resolveRound(state, {
    formations: { player: 'arrow', enemy: 'arrow' },
    orders: [],
  }), /already finished/);
});

console.log(`\nM2-A BATTLE ENGINE TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

/**
 * Headless tests for M2-C campaign-save migration and general skill data.
 * Run: npx tsx scripts/three_kingdoms_campaign_save_test.ts
 */
import assert from 'node:assert/strict';
import {
  createBattle,
  type BattleConfig,
} from '../client/src/three-kingdoms/battle-engine.ts';
import {
  GENERAL_SKILL_BALANCE_VERSION,
  GENERAL_SKILLS,
  getGeneralSkillForOwner,
} from '../client/src/three-kingdoms/general-skills.ts';
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
    { id: 'player-liu-bei', generalId: 'liu-bei', name: 'Liu Bei', unitClass: 'infantry', stats: { martial: 70, intelligence: 76, leadership: 92 }, troops: 220, maxTroops: 220, skillId: 'liu-bei-rende' },
    { id: 'player-guan-yu', generalId: 'guan-yu', name: 'Guan Yu', unitClass: 'cavalry', stats: { martial: 96, intelligence: 78, leadership: 90 }, troops: 210, maxTroops: 210, skillId: 'guan-yu-qinglong-strike' },
    { id: 'player-zhang-fei', generalId: 'zhang-fei', name: 'Zhang Fei', unitClass: 'infantry', stats: { martial: 98, intelligence: 48, leadership: 84 }, troops: 230, maxTroops: 230, skillId: 'zhang-fei-thunderous-roar' },
  ],
  enemyUnits: [
    { id: 'enemy-captain', generalId: 'raider-captain', name: 'Raider Captain', unitClass: 'infantry', stats: { martial: 64, intelligence: 42, leadership: 62 }, troops: 205, maxTroops: 205 },
    { id: 'enemy-archer', generalId: 'rebel-archer', name: 'Rebel Archer', unitClass: 'archer', stats: { martial: 60, intelligence: 54, leadership: 55 }, troops: 175, maxTroops: 175 },
    { id: 'enemy-spearman', generalId: 'rebel-spearman', name: 'Rebel Spearman', unitClass: 'infantry', stats: { martial: 58, intelligence: 35, leadership: 51 }, troops: 190, maxTroops: 190 },
  ],
};

const currentBattle = createBattle(config, 0x01842026);

function legacyBattleV1() {
  const units = currentBattle.units.map((unit) => {
    const legacyUnit = { ...unit } as Record<string, unknown>;
    delete legacyUnit.skillId;
    delete legacyUnit.skillState;
    delete legacyUnit.slot;
    delete legacyUnit.suppressedUntilRound;
    return legacyUnit;
  });
  return { ...currentBattle, version: 1, units };
}

function legacySaveV1(battleState: unknown): Record<string, unknown> {
  return {
    version: 1,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 5, supplies: 2, bond: 2, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: battleState ? 'battle' : 'battle-entry',
    battleState: battleState ?? null,
    playerFormation: 'square',
    playerOrders: [
      { unitId: 'player-liu-bei', type: 'attack', targetId: 'enemy-captain' },
      { unitId: 'player-guan-yu', type: 'wait' },
    ],
  };
}

test('starter roster has three unique, owner-bound personal skill definitions', () => {
  assert.equal(GENERAL_SKILL_BALANCE_VERSION, 'm2c-alpha-1');
  assert.equal(GENERAL_SKILLS.length, 3);
  assert.equal(new Set(GENERAL_SKILLS.map((skill) => skill.id)).size, 3);
  assert.equal(new Set(GENERAL_SKILLS.map((skill) => skill.ownerGeneralId)).size, 3);
  for (const generalId of ['liu-bei', 'guan-yu', 'zhang-fei']) {
    assert.ok(getGeneralSkillForOwner(generalId), `${generalId} must own a skill`);
  }
});

test('new battle initializes one serializable skill state per starter general', () => {
  assert.equal(currentBattle.version, 3);
  const expected = [
    ['liu-bei', 'liu-bei-rende', 2],
    ['guan-yu', 'guan-yu-qinglong-strike', 2],
    ['zhang-fei', 'zhang-fei-thunderous-roar', 1],
  ];
  for (const [generalId, skillId, uses] of expected) {
    const unit = currentBattle.units.find((candidate) => candidate.generalId === generalId);
    assert.ok(unit);
    assert.equal(unit.skillId, skillId);
    assert.deepEqual(unit.skillState, { skillId, cooldownRemaining: 0, usesRemaining: uses });
  }
  assert.equal(currentBattle.units.find((unit) => unit.generalId === 'rebel-archer')?.skillId, null);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(currentBattle)));
});

test('battle creation rejects a skill assigned to a different general owner', () => {
  const invalid: BattleConfig = {
    ...config,
    playerUnits: config.playerUnits.map((unit, index) =>
      index === 0 ? { ...unit, skillId: 'guan-yu-qinglong-strike' } : unit,
    ),
  };
  assert.throws(() => createBattle(invalid, 123), /does not own skill/);
});

test('version-1 campaign and battle saves migrate without losing battle progress', () => {
  const oldBattle = legacyBattleV1();
  const oldJson = JSON.stringify(legacySaveV1(oldBattle));
  const loaded = loadCampaignSave(oldJson);
  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.canPersist, true);
  assert.equal(loaded.save.version, CAMPAIGN_SAVE_VERSION);
  assert.equal(loaded.save.selectedChoiceId, 'swear_oath');
  assert.deepEqual(loaded.save.resources, { morale: 5, supplies: 2, bond: 2, allies: 0 });
  assert.deepEqual(loaded.save.eventFlags, ['taoyuan_oath_resolved']);
  assert.equal(loaded.save.stage, 'battle');
  assert.equal(loaded.save.playerFormation, 'square');
  assert.deepEqual(loaded.save.playerOrders, [
    { unitId: 'player-liu-bei', type: 'attack', targetId: 'enemy-captain' },
    { unitId: 'player-guan-yu', type: 'wait' },
  ]);
  const migratedBattle = loaded.save.battleState;
  assert.ok(migratedBattle);
  assert.equal(migratedBattle.version, 3);
  assert.equal(migratedBattle.round, oldBattle.round);
  assert.equal(migratedBattle.rngState, oldBattle.rngState);
  assert.deepEqual(migratedBattle.log, oldBattle.log);
  assert.deepEqual(migratedBattle.units.map((unit) => unit.troops), oldBattle.units.map((unit: { troops: number }) => unit.troops));
  assert.equal(migratedBattle.units.find((unit) => unit.generalId === 'liu-bei')?.skillState?.usesRemaining, 2);
  assert.deepEqual(migratedBattle.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot), ['front-center', 'front-left', 'front-right']);
  assert.deepEqual(migratedBattle.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot), ['front-center', 'front-left', 'front-right']);
});

test('version-2 campaign and battle saves migrate to v3 and assign default deployment slots', () => {
  const oldUnits = currentBattle.units.map((unit) => {
    const oldUnit = { ...unit } as Record<string, unknown>;
    delete oldUnit.slot;
    return oldUnit;
  });
  const battleV2 = { ...currentBattle, version: 2, units: oldUnits };
  const saveV2 = {
    version: 2,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 4, supplies: 4, bond: 2, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle',
    battleState: battleV2,
    playerFormation: 'wedge',
    playerOrders: [{ unitId: 'player-liu-bei', type: 'wait' }],
  };
  const loaded = loadCampaignSave(JSON.stringify(saveV2));
  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.save.version, 3);
  assert.equal(loaded.save.playerFormation, 'wedge');
  assert.equal(loaded.save.battleState?.version, 3);
  assert.deepEqual(
    loaded.save.battleState?.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot),
    ['front-center', 'front-left', 'front-right'],
  );
  assert.equal(
    loaded.save.battleState?.units.find((unit) => unit.generalId === 'liu-bei')?.skillState?.usesRemaining,
    2,
  );
});

test('version-1 oath/briefing save migrates without inventing a battle', () => {
  const loaded = loadCampaignSave(JSON.stringify(legacySaveV1(null)));
  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.save.stage, 'battle-entry');
  assert.equal(loaded.save.battleState, null);
  assert.equal(loaded.save.selectedChoiceId, 'swear_oath');
});

test('version-2 campaign and battle saves migrate to v3 with default slots', () => {
  const legacyUnits = currentBattle.units.map((unit) => {
    const legacyUnit = { ...unit } as Record<string, unknown>;
    delete legacyUnit.slot;
    return legacyUnit;
  });
  const battleV2 = { ...currentBattle, version: 2, units: legacyUnits };
  const legacySave = {
    version: 2,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 4, supplies: 3, bond: 1, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle',
    battleState: battleV2,
    playerFormation: 'turtle',
    playerOrders: [{ unitId: 'player-liu-bei', type: 'wait' }],
  };
  const loaded = loadCampaignSave(JSON.stringify(legacySave));
  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.save.version, 3);
  assert.equal(loaded.save.playerFormation, 'turtle');
  assert.equal(loaded.save.battleState?.version, 3);
  assert.deepEqual(
    loaded.save.battleState?.units.filter((unit) => unit.side === 'player').map((unit) => unit.slot),
    ['front-center', 'front-left', 'front-right'],
  );
  assert.equal(loaded.save.battleState?.units.find((unit) => unit.generalId === 'liu-bei')?.skillState?.usesRemaining, 2);
});

test('version-3 skill cooldown and remaining uses are restored exactly', () => {
  const battleState = {
    ...currentBattle,
    units: currentBattle.units.map((unit) => unit.generalId === 'liu-bei'
      ? { ...unit, skillState: { skillId: 'liu-bei-rende', cooldownRemaining: 1, usesRemaining: 1 } }
      : unit),
  };
  const save: CampaignSave = {
    version: CAMPAIGN_SAVE_VERSION,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 4, supplies: 3, bond: 1, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle',
    battleState,
    playerFormation: 'arrow',
    playerOrders: [{ unitId: 'player-liu-bei', type: 'wait' }],
  };
  const loaded = loadCampaignSave(JSON.stringify(save));
  assert.equal(loaded.status, 'current');
  assert.deepEqual(
    loaded.save.battleState?.units.find((unit) => unit.generalId === 'liu-bei')?.skillState,
    { skillId: 'liu-bei-rende', cooldownRemaining: 1, usesRemaining: 1 },
  );
});

test('malformed or unsupported saves are read-only and cannot silently overwrite source data', () => {
  const malformed = loadCampaignSave('{ definitely not json');
  assert.equal(malformed.status, 'invalid');
  assert.equal(malformed.canPersist, false);
  assert.ok(malformed.message);

  const unsupported = loadCampaignSave(JSON.stringify({ version: 99 }));
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.canPersist, false);
  assert.ok(unsupported.message);
});

console.log(`\nM2-C SAVE/SKILL MODEL TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

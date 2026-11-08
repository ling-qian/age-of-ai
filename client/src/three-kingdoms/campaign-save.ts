/**
 * Versioned local campaign-save schema for Three Kingdoms.
 *
 * Keep the legacy storage key stable: existing users have data under the
 * :campaign:v1 key. The JSON schema version is upgraded independently.
 */
import {
  isBattleState,
  migrateBattleStateV1ToV3,
  migrateBattleStateV2ToV3,
  type BattleState,
  type Formation,
  type UnitOrder,
} from './battle-engine';

export const CAMPAIGN_SAVE_KEY = 'ageofai:three-kingdoms:campaign:v1';
export const CAMPAIGN_SAVE_VERSION = 3;

export interface CampaignResources {
  morale: number;
  supplies: number;
  bond: number;
  allies: number;
}

export type CampaignStage = 'oath' | 'battle-entry' | 'deployment' | 'battle';

export interface CampaignSave {
  version: 3;
  eventFlags: string[];
  resources: CampaignResources;
  selectedChoiceId: string | null;
  stage: CampaignStage;
  battleState: BattleState | null;
  playerFormation: Formation;
  playerOrders: UnitOrder[];
}

export type CampaignSaveLoadStatus = 'empty' | 'current' | 'migrated' | 'invalid' | 'unsupported';

export interface CampaignSaveLoadResult {
  save: CampaignSave;
  status: CampaignSaveLoadStatus;
  canPersist: boolean;
  message: string | null;
}

export function createDefaultCampaignSave(): CampaignSave {
  return {
    version: CAMPAIGN_SAVE_VERSION,
    eventFlags: [],
    resources: { morale: 3, supplies: 3, bond: 0, allies: 0 },
    selectedChoiceId: null,
    stage: 'oath',
    battleState: null,
    playerFormation: 'arrow',
    playerOrders: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResources(value: unknown): value is CampaignResources {
  if (!isRecord(value)) return false;
  return ['morale', 'supplies', 'bond', 'allies'].every((key) => {
    const amount = value[key];
    return typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && amount <= 1_000_000;
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isUnitOrder(value: unknown): value is UnitOrder {
  if (!isRecord(value) || typeof value.unitId !== 'string' || value.unitId.trim().length === 0) return false;
  if (value.type === 'wait') return true;
  if (value.type === 'skill') {
    return value.targetId === undefined
      || (typeof value.targetId === 'string' && value.targetId.trim().length > 0);
  }
  return (value.type === 'attack' || value.type === 'scheme')
    && typeof value.targetId === 'string'
    && value.targetId.trim().length > 0;
}

function isUnitOrderArray(value: unknown): value is UnitOrder[] {
  return Array.isArray(value) && value.every(isUnitOrder);
}

function isStage(value: unknown): value is CampaignStage {
  return value === 'oath' || value === 'battle-entry' || value === 'deployment' || value === 'battle';
}

function isFormation(value: unknown): value is Formation {
  return value === 'arrow' || value === 'square' || value === 'wedge' || value === 'turtle';
}

function readCommonFields(raw: Record<string, unknown>): Omit<CampaignSave, 'version' | 'battleState'> {
  if (!isStringArray(raw.eventFlags)) throw new Error('eventFlags must be an array of strings');
  if (!isResources(raw.resources)) throw new Error('campaign resources are invalid');
  if (raw.selectedChoiceId !== null && typeof raw.selectedChoiceId !== 'string') {
    throw new Error('selectedChoiceId must be a string or null');
  }
  if (!isStage(raw.stage)) throw new Error('campaign stage is invalid');
  if (!isFormation(raw.playerFormation)) throw new Error('player formation is invalid');
  if (!isUnitOrderArray(raw.playerOrders)) throw new Error('saved player orders are invalid');
  return {
    eventFlags: [...raw.eventFlags],
    resources: { ...raw.resources },
    selectedChoiceId: raw.selectedChoiceId,
    stage: raw.stage,
    playerFormation: raw.playerFormation,
    playerOrders: raw.playerOrders.map((order) => ({ ...order })),
  };
}

function buildCampaignSave(
  common: Omit<CampaignSave, 'version' | 'battleState'>,
  battleState: BattleState | null,
): CampaignSave {
  const stage = (common.stage === 'battle' || common.stage === 'deployment') && !battleState
    ? 'battle-entry'
    : common.stage;
  return {
    version: CAMPAIGN_SAVE_VERSION,
    ...common,
    stage,
    battleState,
    playerOrders: battleState ? common.playerOrders : [],
  };
}

/**
 * Decode the stable localStorage key. A v1 campaign save is upgraded in
 * memory, including its nested v1 battle state. Callers persist only a
 * successful migration. Invalid/unknown saves are read-only until the user
 * explicitly resets the campaign, preventing accidental destructive writes.
 */
export function loadCampaignSave(rawText: string | null): CampaignSaveLoadResult {
  if (rawText === null) {
    return {
      save: createDefaultCampaignSave(),
      status: 'empty',
      canPersist: true,
      message: null,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText) as unknown;
  } catch {
    return {
      save: createDefaultCampaignSave(),
      status: 'invalid',
      canPersist: false,
      message: 'The saved campaign data is unreadable. It has been preserved; reset the campaign only if you want to discard it.',
    };
  }

  if (!isRecord(raw) || typeof raw.version !== 'number') {
    return {
      save: createDefaultCampaignSave(),
      status: 'invalid',
      canPersist: false,
      message: 'The saved campaign data has an invalid structure and was not overwritten.',
    };
  }

  if (raw.version !== 1 && raw.version !== 2 && raw.version !== CAMPAIGN_SAVE_VERSION) {
    return {
      save: createDefaultCampaignSave(),
      status: 'unsupported',
      canPersist: false,
      message: `This campaign save uses unsupported version ${String(raw.version)}. The original data was preserved.`,
    };
  }

  try {
    const common = readCommonFields(raw);
    let battleState: BattleState | null = null;
    if (raw.battleState !== null) {
      if (raw.battleState === undefined) throw new Error('battleState is missing');
      if (raw.version === 1) {
        battleState = migrateBattleStateV1ToV3(raw.battleState);
      } else if (raw.version === 2) {
        battleState = migrateBattleStateV2ToV3(raw.battleState);
      } else {
        if (!isBattleState(raw.battleState)) throw new Error('version-3 battle state is invalid');
        battleState = raw.battleState;
      }
    }

    const save = buildCampaignSave(common, battleState);
    return {
      save,
      status: raw.version < CAMPAIGN_SAVE_VERSION ? 'migrated' : 'current',
      canPersist: true,
      message: raw.version < CAMPAIGN_SAVE_VERSION
        ? `Campaign save upgraded to version ${CAMPAIGN_SAVE_VERSION}. Your story choice, resources, battle progress, and history were preserved.`
        : null,
    };
  } catch (error) {
    return {
      save: createDefaultCampaignSave(),
      status: 'invalid',
      canPersist: false,
      message: `The saved campaign failed validation and was not overwritten: ${error instanceof Error ? error.message : 'unknown validation error'}.`,
    };
  }
}

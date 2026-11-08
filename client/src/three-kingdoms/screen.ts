import storyEvents from './story-events.json';
import { el } from '../ui';
import { getGeneralSkillById } from './general-skills';
import {
  CAMPAIGN_SAVE_KEY,
  createDefaultCampaignSave,
  loadCampaignSave,
  type CampaignSave,
} from './campaign-save';
import {
  chooseEnemyFormation,
  chooseEnemyOrders,
  compareIdsByCodePoint,
  createBattle,
  DEPLOYMENT_SLOTS,
  getValidAttackTargets,
  getValidSkillTargets,
  isValidAttackTarget,
  lockUnitDeployment,
  setUnitDeployment,
  type DeploymentAssignment,
  type DeploymentSlot,
  isValidSkillTarget,
  resolveRound,
  type BattleConfig,
  type BattleLogEntry,
  type BattleOutcome,
  type BattleState,
  type BattleUnit,
  type Formation,
  type UnitOrder,
} from './battle-engine';

type Choice = {
  id: string;
  text: string;
  description: string;
  effects: Record<string, number>;
  result: string;
};

type StoryEvent = {
  id: string;
  title: string;
  year: number;
  narrative: string;
  choices?: Choice[];
  nextEventId?: string;
  battleEntry?: {
    enemy: string;
    objective: string;
    playerRoster: string[];
    enemyRoster: string[];
  };
};

const BATTLE_SEED = 0x01842026;
const events = storyEvents as Record<string, StoryEvent>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function livingUnits(state: BattleState, side: 'player' | 'enemy'): BattleUnit[] {
  return state.units.filter((unit) => unit.side === side && unit.troops > 0);
}

function defaultPlayerOrders(state: BattleState): UnitOrder[] {
  return livingUnits(state, 'player').map((unit) => {
    const targets = getValidAttackTargets(state, unit.id).sort((a, b) =>
      a.troops - b.troops || compareIdsByCodePoint(a.id, b.id),
    );
    return targets[0]
      ? { unitId: unit.id, type: 'attack', targetId: targets[0].id }
      : { unitId: unit.id, type: 'wait' };
  });
}

function restorePlayerOrders(state: BattleState, raw: unknown): UnitOrder[] {
  const defaults = defaultPlayerOrders(state);
  if (!Array.isArray(raw)) return defaults;
  const saved = new Map<string, unknown>();
  for (const candidate of raw) {
    if (isRecord(candidate) && typeof candidate.unitId === 'string') {
      saved.set(candidate.unitId, candidate);
    }
  }
  const enemyIds = new Set(livingUnits(state, 'enemy').map((unit) => unit.id));
  return defaults.map((fallback) => {
    const candidate = saved.get(fallback.unitId);
    if (!isRecord(candidate)) return fallback;
    if (candidate.type === 'wait') return { unitId: fallback.unitId, type: 'wait' };
    const actor = state.units.find((unit) => unit.id === fallback.unitId);
    if (candidate.type === 'skill') {
      if (!actor?.skillId || !actor.skillState || actor.skillState.cooldownRemaining > 0 || actor.skillState.usesRemaining <= 0) return fallback;
      const definition = getGeneralSkillById(actor.skillId);
      if (!definition || definition.ownerGeneralId !== actor.generalId) return fallback;
      if (definition.target === 'enemy_all') {
        return candidate.targetId === undefined && livingUnits(state, 'enemy').length > 0
          ? { unitId: fallback.unitId, type: 'skill' }
          : fallback;
      }
      if (typeof candidate.targetId !== 'string') return fallback;
      const target = state.units.find((unit) => unit.id === candidate.targetId);
      return target && isValidSkillTarget(actor, target, definition)
        ? { unitId: fallback.unitId, type: 'skill', targetId: target.id }
        : fallback;
    }
    if ((candidate.type !== 'attack' && candidate.type !== 'scheme')
      || typeof candidate.targetId !== 'string'
      || !enemyIds.has(candidate.targetId)) return fallback;
    const target = state.units.find((unit) => unit.id === candidate.targetId);
    if (!actor || !target || (candidate.type === 'scheme' && actor.schemeUsed)) return fallback;
    if (candidate.type === 'attack' && !isValidAttackTarget(state, actor, target)) return fallback;
    return {
      unitId: fallback.unitId,
      type: candidate.type,
      targetId: candidate.targetId,
    } as UnitOrder;
  });
}

function readCampaignSaveText(): string | null {
  try {
    return localStorage.getItem(CAMPAIGN_SAVE_KEY);
  } catch {
    return null;
  }
}

function unitClassName(unit: BattleUnit): string {
  switch (unit.unitClass) {
    case 'infantry': return 'Infantry';
    case 'archer': return 'Archers';
    case 'cavalry': return 'Light cavalry';
  }
}

function unitById(state: BattleState, id: string): BattleUnit | undefined {
  return state.units.find((unit) => unit.id === id);
}

function formationName(formation: Formation): string {
  switch (formation) {
    case 'arrow': return 'Arrow';
    case 'square': return 'Square';
    case 'wedge': return 'Wedge';
    case 'turtle': return 'Turtle';
  }
}

function describeBattleLog(state: BattleState, entry: BattleLogEntry): string {
  const name = (id: string): string => unitById(state, id)?.name ?? id;
  switch (entry.type) {
    case 'battle_started':
      return `Battle begins: ${entry.playerUnitIds.length} vanguard units face ${entry.enemyUnitIds.length} Yellow Turban raiders.`;
    case 'deployment_changed':
      return `${entry.side === 'player' ? 'Your army' : 'The raiders'} redeploy: ${entry.assignments.map((item) => `${name(item.unitId)} to ${item.slot}`).join(', ')}.`;
    case 'deployment_locked':
      return `Deployment is locked. The armies take their positions for round ${entry.round}.`;
    case 'deployment_locked':
      return `Deployment is locked. The armies take their positions for round ${entry.round}.`;
    case 'formation_selected':
      return `${entry.side === 'player' ? 'Your army' : 'The raiders'} adopt ${formationName(entry.formation)} formation.`;
    case 'unit_attacked':
      return `${name(entry.attackerId)} attacks ${name(entry.targetId)} — ${entry.hit ? 'hit' : 'miss'} (chance ${entry.hitChance}%, roll ${entry.roll}).`;
    case 'troops_lost':
      return `${name(entry.targetId)} loses ${entry.casualties} troops; ${entry.remainingTroops} remain.`;
    case 'scheme_attempted':
      return `${name(entry.casterId)} uses a scheme against ${name(entry.targetId)} — ${entry.success ? 'the target is suppressed' : 'the scheme fails'} (chance ${entry.successChance}%, roll ${entry.roll}).`;
    case 'general_skill_used':
      return `${name(entry.casterId)} uses ${entry.skillId} on ${name(entry.targetId)} — ${entry.success ? 'resolved' : 'missed'}.`;
    case 'troops_restored':
      return `${name(entry.targetId)} regains ${entry.amount} troops; ${entry.remainingTroops} remain.`;
    case 'unit_guarded':
      return `${name(entry.unitId)} takes a guarded stance.`;
    case 'unit_defeated':
      return `${name(entry.unitId)} is defeated.`;
    case 'order_skipped':
      return `${name(entry.unitId)} cannot act: ${entry.reason === 'unit_defeated' ? 'the unit has been defeated' : entry.reason === 'target_invalid' ? 'the selected target is no longer valid' : 'the target has fallen'}.`;
    case 'battle_finished':
      return `Battle ends — ${entry.outcome}. Remaining troops: your army ${entry.playerTroops}, raiders ${entry.enemyTroops}.`;
  }
}

function createFirstBattleConfig(): BattleConfig {
  return {
    playerUnits: [
      {
        id: 'player-liu-bei',
        generalId: 'liu-bei',
        slot: 'front-center',
        skillId: 'liu-bei-rende',
        name: 'Liu Bei',
        unitClass: 'infantry',
        stats: { martial: 70, intelligence: 76, leadership: 92 },
        troops: 220,
        maxTroops: 220,
      },
      {
        id: 'player-guan-yu',
        generalId: 'guan-yu',
        slot: 'front-left',
        skillId: 'guan-yu-qinglong-strike',
        name: 'Guan Yu',
        unitClass: 'cavalry',
        stats: { martial: 96, intelligence: 78, leadership: 90 },
        troops: 210,
        maxTroops: 210,
      },
      {
        id: 'player-zhang-fei',
        generalId: 'zhang-fei',
        slot: 'front-right',
        skillId: 'zhang-fei-thunderous-roar',
        name: 'Zhang Fei',
        unitClass: 'infantry',
        stats: { martial: 98, intelligence: 48, leadership: 84 },
        troops: 230,
        maxTroops: 230,
      },
    ],
    enemyUnits: [
      {
        id: 'enemy-raider-captain',
        generalId: 'raider-captain',
        slot: 'front-center',
        name: 'Raider Captain',
        unitClass: 'infantry',
        stats: { martial: 64, intelligence: 42, leadership: 62 },
        troops: 205,
        maxTroops: 205,
      },
      {
        id: 'enemy-rebel-archer',
        generalId: 'rebel-archer',
        slot: 'rear-center',
        name: 'Rebel Archer',
        unitClass: 'archer',
        stats: { martial: 60, intelligence: 54, leadership: 55 },
        troops: 175,
        maxTroops: 175,
      },
      {
        id: 'enemy-rebel-spearman',
        generalId: 'rebel-spearman',
        slot: 'front-left',
        name: 'Rebel Spearman',
        unitClass: 'infantry',
        stats: { martial: 58, intelligence: 35, leadership: 51 },
        troops: 190,
        maxTroops: 190,
      },
    ],
  };
}

export class ThreeKingdomsScreen {
  readonly el: HTMLElement;
  private save: CampaignSave;
  private saveWritable = true;
  private saveWarning: string | null = null;
  private battleError = '';

  constructor(private deps: { onBack: () => void }) {
    this.el = el('section', 'screen tk-screen');
    const loaded = loadCampaignSave(readCampaignSaveText());
    this.save = loaded.save;
    this.saveWritable = loaded.canPersist;
    this.saveWarning = loaded.status === 'migrated' ? null : loaded.message;
    if (loaded.status === 'migrated') this.persist();
    this.render();
  }

  private persist(): void {
    if (!this.saveWritable) return;
    try {
      localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(this.save));
    } catch {
      // Local save is optional when browser storage is unavailable.
    }
  }

  private choose(choice: Choice): void {
    if (this.save.selectedChoiceId) return;
    for (const [key, value] of Object.entries(choice.effects)) {
      if (key === 'morale' || key === 'supplies' || key === 'bond' || key === 'allies') {
        this.save.resources[key] = Math.max(0, this.save.resources[key] + value);
      }
    }
    this.save.selectedChoiceId = choice.id;
    if (!this.save.eventFlags.includes('taoyuan_oath_resolved')) {
      this.save.eventFlags.push('taoyuan_oath_resolved');
    }
    this.persist();
    this.render();
  }

  private resetCampaign(): void {
    this.save = createDefaultCampaignSave();
    this.saveWritable = true;
    this.saveWarning = null;
    this.battleError = '';
    this.persist();
    this.render();
  }

  private beginBattle(): void {
    if (!this.save.selectedChoiceId) return;
    const battleState = createBattle(createFirstBattleConfig(), BATTLE_SEED);
    this.save.battleState = battleState;
    this.save.playerFormation = 'arrow';
    this.save.playerOrders = defaultPlayerOrders(battleState);
    this.save.stage = 'deployment';
    this.save.playerOrders = [];
    this.battleError = '';
    this.persist();
    this.render();
  }

  private cancelDeployment(): void {
    if (this.save.stage !== 'deployment') return;
    this.resetBattle();
  }

  private changeDeployment(unitId: string, slot: DeploymentSlot): void {
    const state = this.save.battleState;
    if (!state || this.save.stage !== 'deployment') return;
    const assignments: DeploymentAssignment[] = state.units
      .filter((unit) => unit.side === 'player')
      .map((unit) => ({ unitId: unit.id, slot: unit.id === unitId ? slot : unit.slot }));
    try {
      this.save.battleState = setUnitDeployment(state, 'player', assignments);
      this.battleError = '';
      this.persist();
      this.render();
    } catch (error) {
      this.battleError = error instanceof Error ? error.message : 'The deployment could not be saved.';
      this.render();
    }
  }

  private startDeployedBattle(): void {
    const state = this.save.battleState;
    if (!state || this.save.stage !== 'deployment') return;
    try {
      this.save.battleState = lockUnitDeployment(state);
      this.save.playerOrders = defaultPlayerOrders(this.save.battleState);
      this.save.stage = 'battle';
      this.battleError = '';
      this.persist();
      this.render();
    } catch (error) {
      this.battleError = error instanceof Error ? error.message : 'The battle could not begin.';
      this.render();
    }
  }

  private resetBattle(): void {
    this.save.battleState = null;
    this.save.playerFormation = 'arrow';
    this.save.playerOrders = [];
    this.save.stage = 'battle-entry';
    this.battleError = '';
    this.persist();
    this.render();
  }

  private returnToOath(): void {
    this.save.stage = 'oath';
    this.persist();
    this.render();
  }

  private setFormation(formation: Formation): void {
    this.save.playerFormation = formation;
    this.persist();
    this.render();
  }

  private setPlayerOrder(order: UnitOrder): void {
    this.save.playerOrders = [
      ...this.save.playerOrders.filter((candidate) => candidate.unitId !== order.unitId),
      order,
    ];
    this.persist();
    this.render();
  }

  private changeOrderType(unit: BattleUnit, type: string, targetId: string): void {
    if (type === 'wait') {
      this.setPlayerOrder({ unitId: unit.id, type: 'wait' });
      return;
    }
    const state = this.save.battleState;
    if (!state) return;

    if (type === 'skill') {
      const definition = unit.skillId ? getGeneralSkillById(unit.skillId) : undefined;
      const candidates = getValidSkillTargets(state, unit.id);
      if (!definition || !candidates.length) return;
      if (definition.target === 'enemy_all') {
        this.setPlayerOrder({ unitId: unit.id, type: 'skill' });
        return;
      }
      const validTarget = candidates.some((candidate) => candidate.id === targetId)
        ? targetId
        : [...candidates].sort((a, b) => a.troops - b.troops || compareIdsByCodePoint(a.id, b.id))[0]?.id;
      if (validTarget) this.setPlayerOrder({ unitId: unit.id, type: 'skill', targetId: validTarget });
      return;
    }

    if (type !== 'attack' && type !== 'scheme') return;
    if (type === 'scheme' && unit.schemeUsed) return;
    const candidates = type === 'attack' ? getValidAttackTargets(state, unit.id) : livingUnits(state, 'enemy');
    const validTarget = candidates.some((enemy) => enemy.id === targetId)
      ? targetId
      : [...candidates].sort((a, b) => a.troops - b.troops || compareIdsByCodePoint(a.id, b.id))[0]?.id;
    if (!validTarget) {
      this.setPlayerOrder({ unitId: unit.id, type: 'wait' });
      return;
    }
    this.setPlayerOrder({ unitId: unit.id, type, targetId: validTarget });
  }

  private resolveBattleRound(): void {
    const state = this.save.battleState;
    if (!state || state.phase !== 'ready') return;
    try {
      const playerOrders = restorePlayerOrders(state, this.save.playerOrders);
      const enemyOrders = chooseEnemyOrders(state);
      const enemyFormation = chooseEnemyFormation(state);
      const next = resolveRound(state, {
        formations: {
          player: this.save.playerFormation,
          enemy: enemyFormation,
        },
        orders: [...playerOrders, ...enemyOrders],
      });
      this.save.battleState = next;
      this.save.playerOrders = next.phase === 'ready' ? defaultPlayerOrders(next) : [];
      this.battleError = '';
      this.persist();
      this.render();
    } catch (error) {
      this.battleError = error instanceof Error ? error.message : 'The round could not be resolved.';
      this.render();
    }
  }

  private render(): void {
    this.el.innerHTML = '';
    const shell = el('div', 'tk-shell');
    const top = el('div', 'tk-topline');
    top.appendChild(el('span', 'tk-kicker', 'A THREE KINGDOMS STORY'));
    const back = el('button', 'btn tk-back', 'Back to Age of AI');
    back.addEventListener('click', this.deps.onBack);
    top.appendChild(back);
    shell.appendChild(top);

    shell.appendChild(el('h1', 'tk-title', 'THREE KINGDOMS'));
    shell.appendChild(el('p', 'tk-subtitle', 'FATE OF THE HAN · CAMPAIGN I: THE YELLOW TURBAN REBELLION'));
    if (this.saveWarning) {
      const warning = el('div', 'tk-battle-error', this.saveWarning);
      const reset = el('button', 'btn tk-secondary', 'Discard saved data and start a new campaign');
      reset.addEventListener('click', () => this.resetCampaign());
      warning.appendChild(reset);
      shell.appendChild(warning);
    }

    const stats = el('div', 'tk-stats');
    for (const [label, value] of [
      ['Morale', this.save.resources.morale],
      ['Supplies', this.save.resources.supplies],
      ['Brotherhood', this.save.resources.bond],
      ['Local Allies', this.save.resources.allies],
    ] as Array<[string, number]>) {
      const card = el('div', 'tk-stat');
      card.appendChild(el('span', 'tk-stat-label', label));
      card.appendChild(el('strong', 'tk-stat-value', String(value)));
      stats.appendChild(card);
    }
    shell.appendChild(stats);

    if (this.save.stage === 'deployment' && this.save.battleState) {
      this.renderDeployment(shell, this.save.battleState);
    } else if (this.save.stage === 'battle' && this.save.battleState) {
      this.renderBattle(shell, this.save.battleState);
    } else if (this.save.stage === 'battle-entry' && this.save.selectedChoiceId) {
      this.renderBattleEntry(shell);
    } else {
      this.renderOath(shell);
    }

    this.el.appendChild(shell);
  }

  private renderOath(shell: HTMLElement): void {
    const event = events.taoyuan_oath;
    const panel = el('article', 'tk-panel');
    panel.appendChild(el('div', 'tk-eyebrow', 'YEAR 184 · STORY EVENT'));
    panel.appendChild(el('h2', 'tk-event-title', event.title));
    panel.appendChild(el('p', 'tk-narrative', event.narrative));

    const choices = el('div', 'tk-choices');
    for (const choice of event.choices ?? []) {
      const button = el('button', 'tk-choice');
      button.disabled = Boolean(this.save.selectedChoiceId);
      button.appendChild(el('strong', 'tk-choice-title', choice.text));
      button.appendChild(el('span', 'tk-choice-desc', choice.description));
      button.addEventListener('click', () => this.choose(choice));
      choices.appendChild(button);
    }
    panel.appendChild(choices);

    if (this.save.selectedChoiceId) {
      const choice = event.choices?.find((item) => item.id === this.save.selectedChoiceId);
      if (choice) {
        const result = el('div', 'tk-result');
        result.appendChild(el('span', 'tk-eyebrow', 'YOUR DECISION'));
        result.appendChild(el('p', '', choice.result));
        panel.appendChild(result);
      }
      const continueBtn = el('button', 'btn primary tk-continue', 'Proceed to the Yellow Turban Rebellion');
      continueBtn.addEventListener('click', () => {
        this.save.stage = 'battle-entry';
        this.persist();
        this.render();
      });
      panel.appendChild(continueBtn);
    }
    shell.appendChild(panel);
  }

  private renderBattleEntry(shell: HTMLElement): void {
    const event = events.yellow_turban_first_battle;
    const battle = event.battleEntry;
    if (!battle) return;
    const panel = el('article', 'tk-panel');
    panel.appendChild(el('div', 'tk-eyebrow', 'YEAR 184 · FIRST BATTLE'));
    panel.appendChild(el('h2', 'tk-event-title', event.title));
    panel.appendChild(el('p', 'tk-narrative', event.narrative));
    panel.appendChild(el('div', 'tk-objective-label', 'BATTLE OBJECTIVE'));
    panel.appendChild(el('p', 'tk-objective', battle.objective));

    const rosters = el('div', 'tk-rosters');
    const allies = el('div', 'tk-roster');
    allies.appendChild(el('h3', '', 'Your Vanguard'));
    for (const name of battle.playerRoster) allies.appendChild(el('div', 'tk-roster-unit', name));
    const enemies = el('div', 'tk-roster enemy');
    enemies.appendChild(el('h3', '', battle.enemy));
    for (const name of battle.enemyRoster) enemies.appendChild(el('div', 'tk-roster-unit', name));
    rosters.appendChild(allies);
    rosters.appendChild(enemies);
    panel.appendChild(rosters);

    panel.appendChild(el('p', 'tk-m2-note', 'Before the first clash, arrange your generals on the 3×3 field and choose an army doctrine. Every general brings a personal skill into battle.'));
    const actions = el('div', 'tk-actions');
    const startBtn = el('button', 'btn primary tk-begin-battle', 'Prepare deployment');
    startBtn.addEventListener('click', () => this.beginBattle());
    const resetBtn = el('button', 'btn tk-secondary', 'Restart opening');
    resetBtn.addEventListener('click', () => this.resetCampaign());
    const backBtn = el('button', 'btn tk-continue', 'Back to campaign event');
    backBtn.addEventListener('click', () => this.returnToOath());
    actions.appendChild(startBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(backBtn);
    panel.appendChild(actions);
    shell.appendChild(panel);
  }

  private renderDeployment(shell: HTMLElement, state: BattleState): void {
    const panel = el('article', 'tk-panel tk-deployment-panel');
    panel.appendChild(el('div', 'tk-eyebrow', 'YEAR 184 · PRE-BATTLE DEPLOYMENT'));
    panel.appendChild(el('h2', 'tk-event-title', 'Place your vanguard'));
    panel.appendChild(el('p', 'tk-narrative', 'Choose each general’s position before the first clash. Frontline units screen the same lane; archers can strike protected rear targets. Deployment locks when combat begins.'));

    const doctrine = el('div', 'tk-deployment-doctrine');
    const doctrineLabel = el('label', 'tk-command-label', 'Army doctrine');
    const doctrineSelect = el('select', 'tk-deployment-doctrine-select');
    const doctrines: Array<[Formation, string]> = [
      ['arrow', 'Arrow — stronger attacks'],
      ['square', 'Square — stronger defence'],
      ['wedge', 'Wedge — cavalry charge, weaker other attacks'],
      ['turtle', 'Turtle — strongest defence, weaker attacks'],
    ];
    for (const [value, label] of doctrines) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = this.save.playerFormation === value;
      doctrineSelect.appendChild(option);
    }
    doctrineSelect.addEventListener('change', () => {
      const selected = doctrineSelect.value;
      if (selected === 'arrow' || selected === 'square' || selected === 'wedge' || selected === 'turtle') {
        this.setFormation(selected);
      }
    });
    doctrineLabel.appendChild(doctrineSelect);
    doctrine.appendChild(doctrineLabel);
    panel.appendChild(doctrine);

    const boards = el('div', 'tk-deployment-boards');
    const playerBoard = el('section', 'tk-deployment-side player');
    playerBoard.appendChild(el('h3', '', 'Your formation · editable'));
    const playerGrid = el('div', 'tk-deployment-grid player');
    for (const slot of DEPLOYMENT_SLOTS) {
      const cell = el('div', 'tk-deployment-cell');
      cell.dataset.slot = slot;
      cell.appendChild(el('span', 'tk-deployment-cell-label', slot.replace('-', ' · ').toUpperCase()));
      const occupant = state.units.find((unit) => unit.side === 'player' && unit.slot === slot);
      if (occupant) {
        cell.appendChild(el('strong', 'tk-deployment-cell-unit', occupant.name));
        cell.appendChild(el('span', 'tk-deployment-cell-class', unitClassName(occupant)));
      } else {
        cell.appendChild(el('span', 'tk-deployment-empty', 'Open position'));
      }
      playerGrid.appendChild(cell);
    }
    playerBoard.appendChild(playerGrid);

    const controls = el('div', 'tk-deployment-controls');
    for (const unit of state.units.filter((candidate) => candidate.side === 'player')) {
      const card = el('article', 'tk-deployment-unit');
      card.dataset.unitId = unit.id;
      const heading = el('div', 'tk-battle-unit-heading');
      heading.appendChild(el('strong', '', unit.name));
      heading.appendChild(el('span', 'tk-unit-class', unitClassName(unit)));
      card.appendChild(heading);
      card.appendChild(el('div', 'tk-unit-troops', `${unit.troops} / ${unit.maxTroops} troops`));
      const definition = unit.skillId ? getGeneralSkillById(unit.skillId) : undefined;
      if (definition) {
        card.appendChild(el('div', 'tk-general-skill-name', definition.name));
        card.appendChild(el('p', 'tk-general-skill-description', definition.description));
        card.appendChild(el('span', 'tk-general-skill-limit', `${definition.usesPerBattle} uses · ${definition.cooldownRounds}-round cooldown`));
      }
      const label = el('label', 'tk-command-label', 'Battlefield position');
      const select = el('select', 'tk-deployment-slot-select');
      select.dataset.unitId = unit.id;
      for (const slot of DEPLOYMENT_SLOTS) {
        const occupant = state.units.find((candidate) =>
          candidate.side === 'player' && candidate.slot === slot && candidate.id !== unit.id,
        );
        const option = document.createElement('option');
        option.value = slot;
        option.textContent = slot.replace('-', ' · ');
        option.selected = unit.slot === slot;
        option.disabled = Boolean(occupant);
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        const selected = select.value;
        if (DEPLOYMENT_SLOTS.includes(selected as DeploymentSlot)) {
          this.changeDeployment(unit.id, selected as DeploymentSlot);
        }
      });
      label.appendChild(select);
      card.appendChild(label);
      controls.appendChild(card);
    }
    playerBoard.appendChild(controls);
    boards.appendChild(playerBoard);

    const enemyBoard = el('section', 'tk-deployment-side enemy');
    enemyBoard.appendChild(el('h3', '', 'Enemy intelligence · known positions'));
    const enemyGrid = el('div', 'tk-deployment-grid enemy');
    for (const slot of DEPLOYMENT_SLOTS) {
      const cell = el('div', 'tk-deployment-cell');
      cell.dataset.slot = slot;
      cell.appendChild(el('span', 'tk-deployment-cell-label', slot.replace('-', ' · ').toUpperCase()));
      const occupant = state.units.find((unit) => unit.side === 'enemy' && unit.slot === slot);
      if (occupant) {
        cell.appendChild(el('strong', 'tk-deployment-cell-unit', occupant.name));
        cell.appendChild(el('span', 'tk-deployment-cell-class', unitClassName(occupant)));
      } else {
        cell.appendChild(el('span', 'tk-deployment-empty', 'Unknown / empty'));
      }
      enemyGrid.appendChild(cell);
    }
    enemyBoard.appendChild(enemyGrid);
    boards.appendChild(enemyBoard);
    panel.appendChild(boards);

    if (this.battleError) panel.appendChild(el('p', 'tk-battle-error', this.battleError));
    const actions = el('div', 'tk-actions');
    const start = el('button', 'btn primary tk-start-deployed-battle', 'Lock positions · Begin battle');
    start.addEventListener('click', () => this.startDeployedBattle());
    const cancel = el('button', 'btn tk-secondary tk-cancel-deployment', 'Cancel encounter');
    cancel.addEventListener('click', () => this.cancelDeployment());
    actions.appendChild(start);
    actions.appendChild(cancel);
    panel.appendChild(actions);
    shell.appendChild(panel);
  }

  private renderBattle(shell: HTMLElement, state: BattleState): void {
    const event = events.yellow_turban_first_battle;
    const panel = el('article', 'tk-panel tk-battle-panel');
    panel.appendChild(el('div', 'tk-eyebrow', `YEAR 184 · ROUND ${state.round}`));
    panel.appendChild(el('h2', 'tk-event-title', event.title));
    panel.appendChild(el('p', 'tk-narrative', event.battleEntry?.objective ?? ''));

    const formationRow = el('div', 'tk-formation-row');
    const formationLabel = el('label', 'tk-command-label', 'Your army doctrine');
    const formationSelect = el('select', 'tk-formation-select');
    formationSelect.dataset.testid = 'tk-formation';
    const doctrines: Array<[Formation, string]> = [
      ['arrow', 'Arrow — stronger attacks'],
      ['square', 'Square — stronger defence'],
      ['wedge', 'Wedge — cavalry charge'],
      ['turtle', 'Turtle — stronger defence'],
    ];
    for (const [value, label] of doctrines) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = this.save.playerFormation === value;
      formationSelect.appendChild(option);
    }
    formationSelect.addEventListener('change', () => {
      const selected = formationSelect.value;
      if (selected === 'arrow' || selected === 'square' || selected === 'wedge' || selected === 'turtle') {
        this.setFormation(selected);
      }
    });
    formationLabel.appendChild(formationSelect);
    formationRow.appendChild(formationLabel);
    formationRow.appendChild(el('span', 'tk-enemy-formation', `Enemy formation: ${formationName(state.formations.enemy)}`));
    panel.appendChild(formationRow);

    const battlefield = el('div', 'tk-battlefield');
    const playerColumn = el('section', 'tk-battle-side');
    playerColumn.appendChild(el('h3', '', 'Your vanguard'));
    const enemyColumn = el('section', 'tk-battle-side enemy');
    enemyColumn.appendChild(el('h3', '', 'Yellow Turban raiders'));

    const normalizedOrders = restorePlayerOrders(state, this.save.playerOrders);
    for (const unit of state.units.filter((candidate) => candidate.side === 'player')) {
      playerColumn.appendChild(this.renderPlayerUnit(unit, state, normalizedOrders));
    }
    for (const unit of state.units.filter((candidate) => candidate.side === 'enemy')) {
      enemyColumn.appendChild(this.renderEnemyUnit(unit));
    }
    battlefield.appendChild(playerColumn);
    battlefield.appendChild(enemyColumn);
    panel.appendChild(battlefield);

    if (this.battleError) panel.appendChild(el('p', 'tk-battle-error', this.battleError));

    if (state.phase === 'finished' && state.outcome) {
      const title = state.outcome === 'victory' ? 'Victory — the road is held'
        : state.outcome === 'defeat' ? 'Defeat — the raiders break your line'
          : 'Draw — neither army can claim the field';
      const result = el('div', 'tk-battle-result');
      result.appendChild(el('span', 'tk-eyebrow', 'BATTLE RESULT'));
      result.appendChild(el('h3', '', title));
      result.appendChild(el('p', '', `Your remaining troops: ${state.units.filter((unit) => unit.side === 'player').reduce((sum, unit) => sum + unit.troops, 0)} · Enemy remaining troops: ${state.units.filter((unit) => unit.side === 'enemy').reduce((sum, unit) => sum + unit.troops, 0)}`));
      panel.appendChild(result);
    } else {
      const resolveBtn = el('button', 'btn primary tk-resolve-round', 'Resolve round');
      resolveBtn.dataset.testid = 'tk-resolve-round';
      resolveBtn.addEventListener('click', () => this.resolveBattleRound());
      panel.appendChild(resolveBtn);
    }

    const logPanel = el('section', 'tk-battle-log-panel');
    logPanel.appendChild(el('h3', '', 'Battle log'));
    const log = el('ol', 'tk-battle-log');
    for (const entry of state.log.slice(-30)) {
      log.appendChild(el('li', '', describeBattleLog(state, entry)));
    }
    logPanel.appendChild(log);
    panel.appendChild(logPanel);

    const actions = el('div', 'tk-actions');
    const restartBattle = el('button', 'btn tk-secondary', 'Restart battle');
    restartBattle.addEventListener('click', () => this.resetBattle());
    const restartCampaign = el('button', 'btn tk-secondary', 'Restart opening');
    restartCampaign.addEventListener('click', () => this.resetCampaign());
    const back = el('button', 'btn tk-continue', 'Back to campaign event');
    back.addEventListener('click', () => this.returnToOath());
    actions.appendChild(restartBattle);
    actions.appendChild(restartCampaign);
    actions.appendChild(back);
    panel.appendChild(actions);
    shell.appendChild(panel);
  }


  private renderPlayerUnit(
    unit: BattleUnit,
    state: BattleState,
    orders: UnitOrder[],
  ): HTMLElement {
    const card = el('article', 'tk-battle-unit player');
    card.dataset.unitId = unit.id;
    const heading = el('div', 'tk-battle-unit-heading');
    heading.appendChild(el('strong', '', unit.name));
    heading.appendChild(el('span', 'tk-unit-class', unitClassName(unit)));
    card.appendChild(heading);
    card.appendChild(el('div', 'tk-unit-troops', `${unit.troops} / ${unit.maxTroops} troops`));
    card.appendChild(el('div', 'tk-unit-position', `Position: ${unit.slot.replace('-', ' · ')}`));
    const statuses = [unit.guarded ? 'Guarded' : '', unit.suppressed ? 'Suppressed' : '', unit.schemeUsed ? 'Scheme used' : '']
      .filter(Boolean);
    card.appendChild(el('div', 'tk-unit-status', statuses.length ? statuses.join(' · ') : 'Ready'));

    const definition = unit.skillId ? getGeneralSkillById(unit.skillId) : undefined;
    if (definition && unit.skillState) {
      const skill = el('div', 'tk-general-skill');
      skill.appendChild(el('strong', 'tk-general-skill-name', definition.name));
      skill.appendChild(el('p', 'tk-general-skill-description', definition.description));
      const cooldownText = unit.skillState.cooldownRemaining > 0
        ? `Cooldown: ${unit.skillState.cooldownRemaining} round(s)`
        : 'Ready';
      skill.appendChild(el('span', 'tk-general-skill-limit',
        `${cooldownText} · ${unit.skillState.usesRemaining}/${definition.usesPerBattle} uses left`,
      ));
      card.appendChild(skill);
    }
    if (unit.troops <= 0) {
      card.classList.add('defeated');
      card.appendChild(el('span', 'tk-defeated-label', 'DEFEATED'));
      return card;
    }

    const currentOrder = orders.find((order) => order.unitId === unit.id) ?? { unitId: unit.id, type: 'wait' as const };
    const skillTargets = getValidSkillTargets(state, unit.id);
    const skillReady = Boolean(definition && unit.skillState
      && unit.skillState.cooldownRemaining === 0
      && unit.skillState.usesRemaining > 0
      && skillTargets.length > 0);
    const commandRow = el('div', 'tk-unit-command');
    const typeLabel = el('label', 'tk-command-label', 'Order');
    const typeSelect = el('select', 'tk-order-type');
    typeSelect.dataset.unitId = unit.id;
    const typeOptions = [
      { value: 'attack', label: 'Attack' },
      { value: 'scheme', label: 'Scheme' },
      ...(definition ? [{ value: 'skill', label: `Personal skill — ${definition.name}` }] : []),
      { value: 'wait', label: 'Wait' },
    ];
    for (const item of typeOptions) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.disabled = (item.value === 'scheme' && unit.schemeUsed)
        || (item.value === 'skill' && !skillReady);
      option.selected = currentOrder.type === item.value;
      typeSelect.appendChild(option);
    }
    typeLabel.appendChild(typeSelect);
    commandRow.appendChild(typeLabel);

    const targetLabel = el('label', 'tk-command-label', 'Target');
    const targetSelect = el('select', 'tk-order-target');
    targetSelect.dataset.unitId = unit.id;
    const legalTargets = currentOrder.type === 'skill'
      ? skillTargets
      : currentOrder.type === 'scheme'
        ? livingUnits(state, 'enemy')
        : currentOrder.type === 'attack'
          ? getValidAttackTargets(state, unit.id)
          : [];
    for (const target of legalTargets) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = `${target.name} — ${target.troops} · ${target.slot.replace('-', ' ')}`;
      option.selected = 'targetId' in currentOrder && currentOrder.targetId === target.id;
      targetSelect.appendChild(option);
    }
    targetSelect.disabled = currentOrder.type === 'wait' || legalTargets.length === 0;
    if (currentOrder.type !== 'wait' && 'targetId' in currentOrder && currentOrder.targetId
      && !legalTargets.some((target) => target.id === currentOrder.targetId)) {
      targetSelect.value = legalTargets[0]?.id ?? '';
    }
    targetLabel.appendChild(targetSelect);
    commandRow.appendChild(targetLabel);

    typeSelect.addEventListener('change', () => {
      this.changeOrderType(unit, typeSelect.value, targetSelect.value);
    });
    targetSelect.addEventListener('change', () => {
      if (typeSelect.value === 'attack' || typeSelect.value === 'scheme' || typeSelect.value === 'skill') {
        const selected = state.units.find((candidate) => candidate.id === targetSelect.value);
        if (typeSelect.value === 'attack' && (!selected || !isValidAttackTarget(state, unit, selected))) {
          const fallback = getValidAttackTargets(state, unit.id)[0];
          this.setPlayerOrder(fallback
            ? { unitId: unit.id, type: 'attack', targetId: fallback.id }
            : { unitId: unit.id, type: 'wait' });
          return;
        }
        if (typeSelect.value === 'skill' && (!selected || !isValidSkillTarget(unit, selected, definition!))) {
          const fallback = skillTargets[0];
          if (fallback) this.setPlayerOrder({ unitId: unit.id, type: 'skill', targetId: fallback.id });
          return;
        }
        this.setPlayerOrder({ unitId: unit.id, type: typeSelect.value, targetId: targetSelect.value });
      }
    });
    card.appendChild(commandRow);
    return card;
  }

  private renderEnemyUnit(unit: BattleUnit): HTMLElement {
    const card = el('article', 'tk-battle-unit enemy');
    const heading = el('div', 'tk-battle-unit-heading');
    heading.appendChild(el('strong', '', unit.name));
    heading.appendChild(el('span', 'tk-unit-class', unitClassName(unit)));
    card.appendChild(heading);
    card.appendChild(el('div', 'tk-unit-troops', `${unit.troops} / ${unit.maxTroops} troops`));
    const statuses = [unit.guarded ? 'Guarded' : '', unit.suppressed ? 'Suppressed' : '', unit.schemeUsed ? 'Scheme used' : '']
      .filter(Boolean);
    card.appendChild(el('div', 'tk-unit-status', statuses.length ? statuses.join(' · ') : 'Ready'));
    if (unit.troops <= 0) {
      card.classList.add('defeated');
      card.appendChild(el('span', 'tk-defeated-label', 'DEFEATED'));
    }
    return card;
  }
}

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
  const enemies = livingUnits(state, 'enemy').sort((a, b) =>
    a.troops - b.troops || compareIdsByCodePoint(a.id, b.id),
  );
  const target = enemies[0];
  return livingUnits(state, 'player').map((unit) => target
    ? { unitId: unit.id, type: 'attack', targetId: target.id }
    : { unitId: unit.id, type: 'wait' });
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
    if (!actor || (candidate.type === 'scheme' && actor.schemeUsed)) return fallback;
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

function describeBattleLog(state: BattleState, entry: BattleLogEntry): string {
  const name = (id: string): string => unitById(state, id)?.name ?? id;
  switch (entry.type) {
    case 'battle_started':
      return `Battle begins: ${entry.playerUnitIds.length} vanguard units face ${entry.enemyUnitIds.length} Yellow Turban raiders.`;
    case 'formation_selected':
      return `${entry.side === 'player' ? 'Your army' : 'The raiders'} adopt ${entry.formation === 'arrow' ? 'Arrow' : 'Square'} formation.`;
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
        name: 'Raider Captain',
        unitClass: 'infantry',
        stats: { martial: 64, intelligence: 42, leadership: 62 },
        troops: 205,
        maxTroops: 205,
      },
      {
        id: 'enemy-rebel-archer',
        generalId: 'rebel-archer',
        name: 'Rebel Archer',
        unitClass: 'archer',
        stats: { martial: 60, intelligence: 54, leadership: 55 },
        troops: 175,
        maxTroops: 175,
      },
      {
        id: 'enemy-rebel-spearman',
        generalId: 'rebel-spearman',
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
    this.save.stage = 'battle';
    this.battleError = '';
    this.persist();
    this.render();
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
    if (type !== 'attack' && type !== 'scheme') return;
    if (type === 'scheme' && unit.schemeUsed) return;
    const state = this.save.battleState;
    if (!state) return;
    const validTarget = livingUnits(state, 'enemy').some((enemy) => enemy.id === targetId)
      ? targetId
      : livingUnits(state, 'enemy').sort((a, b) => a.troops - b.troops || a.id.localeCompare(b.id))[0]?.id;
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

    if (this.save.stage === 'battle' && this.save.battleState) {
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

    panel.appendChild(el('p', 'tk-m2-note', 'M2-B now runs a deterministic 3v3 turn-based battle. Choose a formation and issue one order to each living unit.'));
    const actions = el('div', 'tk-actions');
    const startBtn = el('button', 'btn primary tk-begin-battle', 'Begin tactical battle');
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

  private renderBattle(shell: HTMLElement, state: BattleState): void {
    const event = events.yellow_turban_first_battle;
    const panel = el('article', 'tk-panel tk-battle-panel');
    panel.appendChild(el('div', 'tk-eyebrow', `YEAR 184 · ROUND ${state.round}`));
    panel.appendChild(el('h2', 'tk-event-title', event.title));
    panel.appendChild(el('p', 'tk-narrative', event.battleEntry?.objective ?? ''));

    const formationRow = el('div', 'tk-formation-row');
    const formationLabel = el('label', 'tk-command-label', 'Your formation');
    const formationSelect = el('select', 'tk-formation-select');
    formationSelect.dataset.testid = 'tk-formation';
    for (const [value, label] of [['arrow', 'Arrow — stronger attacks'], ['square', 'Square — stronger defence']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = this.save.playerFormation === value;
      formationSelect.appendChild(option);
    }
    formationSelect.addEventListener('change', () => {
      if (formationSelect.value === 'arrow' || formationSelect.value === 'square') {
        this.setFormation(formationSelect.value);
      }
    });
    formationLabel.appendChild(formationSelect);
    formationRow.appendChild(formationLabel);
    formationRow.appendChild(el('span', 'tk-enemy-formation', `Enemy formation: ${state.formations.enemy === 'arrow' ? 'Arrow' : 'Square'}`));
    panel.appendChild(formationRow);

    const battlefield = el('div', 'tk-battlefield');
    const playerColumn = el('section', 'tk-battle-side');
    playerColumn.appendChild(el('h3', '', 'Your vanguard'));
    const enemyColumn = el('section', 'tk-battle-side enemy');
    enemyColumn.appendChild(el('h3', '', 'Yellow Turban raiders'));

    const livingEnemies = livingUnits(state, 'enemy');
    const targetOptions = livingEnemies.slice().sort((a, b) => a.troops - b.troops || a.id.localeCompare(b.id));
    const normalizedOrders = restorePlayerOrders(state, this.save.playerOrders);
    for (const unit of state.units.filter((candidate) => candidate.side === 'player')) {
      playerColumn.appendChild(this.renderPlayerUnit(unit, state, normalizedOrders, targetOptions));
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
    targets: BattleUnit[],
  ): HTMLElement {
    const card = el('article', 'tk-battle-unit player');
    card.dataset.unitId = unit.id;
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
      return card;
    }

    const currentOrder = orders.find((order) => order.unitId === unit.id) ?? { unitId: unit.id, type: 'wait' as const };
    const commandRow = el('div', 'tk-unit-command');
    const typeLabel = el('label', 'tk-command-label', 'Order');
    const typeSelect = el('select', 'tk-order-type');
    typeSelect.dataset.unitId = unit.id;
    const typeOptions = [
      { value: 'attack', label: 'Attack' },
      { value: 'scheme', label: 'Scheme' },
      { value: 'wait', label: 'Wait' },
    ];
    for (const item of typeOptions) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.disabled = item.value === 'scheme' && unit.schemeUsed;
      option.selected = currentOrder.type === item.value;
      typeSelect.appendChild(option);
    }
    typeLabel.appendChild(typeSelect);
    commandRow.appendChild(typeLabel);

    const targetLabel = el('label', 'tk-command-label', 'Target');
    const targetSelect = el('select', 'tk-order-target');
    targetSelect.dataset.unitId = unit.id;
    for (const target of targets) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = `${target.name} — ${target.troops}`;
      option.selected = 'targetId' in currentOrder && currentOrder.targetId === target.id;
      targetSelect.appendChild(option);
    }
    targetSelect.disabled = currentOrder.type === 'wait' || targets.length === 0;
    targetLabel.appendChild(targetSelect);
    commandRow.appendChild(targetLabel);

    typeSelect.addEventListener('change', () => {
      this.changeOrderType(unit, typeSelect.value, targetSelect.value);
    });
    targetSelect.addEventListener('change', () => {
      if (typeSelect.value === 'attack' || typeSelect.value === 'scheme') {
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

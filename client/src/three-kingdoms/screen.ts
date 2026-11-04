import storyEvents from './story-events.json';
import { el } from '../ui';

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

type CampaignSave = {
  version: 1;
  eventFlags: string[];
  resources: { morale: number; supplies: number; bond: number; allies: number };
  selectedChoiceId: string | null;
  stage: 'oath' | 'battle-entry';
};

const SAVE_KEY = 'ageofai:three-kingdoms:campaign:v1';
const events = storyEvents as Record<string, StoryEvent>;

function loadSave(): CampaignSave {
  const defaults: CampaignSave = {
    version: 1,
    eventFlags: [],
    resources: { morale: 3, supplies: 3, bond: 0, allies: 0 },
    selectedChoiceId: null,
    stage: 'oath',
  };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CampaignSave>;
    if (parsed.version !== 1 || !Array.isArray(parsed.eventFlags) || !parsed.resources) return defaults;
    return {
      ...defaults,
      ...parsed,
      resources: {
        morale: Number(parsed.resources.morale) || 0,
        supplies: Number(parsed.resources.supplies) || 0,
        bond: Number(parsed.resources.bond) || 0,
        allies: Number(parsed.resources.allies) || 0,
      },
      selectedChoiceId: typeof parsed.selectedChoiceId === 'string' ? parsed.selectedChoiceId : null,
      stage: parsed.stage === 'battle-entry' ? 'battle-entry' : 'oath',
    };
  } catch {
    return defaults;
  }
}

export class ThreeKingdomsScreen {
  readonly el: HTMLElement;
  private save: CampaignSave;

  constructor(private deps: { onBack: () => void }) {
    this.el = el('section', 'screen tk-screen');
    this.save = loadSave();
    this.render();
  }

  private persist(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
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
    this.save = {
      version: 1,
      eventFlags: [],
      resources: { morale: 3, supplies: 3, bond: 0, allies: 0 },
      selectedChoiceId: null,
      stage: 'oath',
    };
    this.persist();
    this.render();
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

    if (this.save.stage === 'battle-entry' && this.save.selectedChoiceId) {
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

    panel.appendChild(el('p', 'tk-m2-note', 'The battle entry is wired in M1. The playable 3v3 tactical combat loop arrives in M2.'));
    const actions = el('div', 'tk-actions');
    const resetBtn = el('button', 'btn tk-secondary', 'Restart opening');
    resetBtn.addEventListener('click', () => this.resetCampaign());
    const backBtn = el('button', 'btn primary tk-continue', 'Back to campaign event');
    backBtn.addEventListener('click', () => {
      this.save.stage = 'oath';
      this.persist();
      this.render();
    });
    actions.appendChild(resetBtn);
    actions.appendChild(backBtn);
    panel.appendChild(actions);
    shell.appendChild(panel);
  }
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const BASE_URL = 'http://127.0.0.1:5199';
const SERVER_PORT = Number(process.env.PORT) || 8080;
const CLIENT_PORT = 5199;

const children = [];
const browserErrors = [];

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${label}] exited with code ${code}\n${output}`);
    }
  });
  children.push({ child, label });
  return child;
}

async function waitForPort(port, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Port ${port} did not become available within ${timeoutMs}ms`);
}

function parseFrame(payload) {
  try {
    const raw = typeof payload === 'string' ? payload : payload?.toString?.();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function installWebSocketProbe(page) {
  await page.addInitScript(() => {
    window.__m1WsFrames = [];
    const NativeWebSocket = window.WebSocket;
    class ProbedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        if (protocols === undefined) super(url);
        else super(url, protocols);
        this.addEventListener('message', (event) => {
          if (typeof event.data === 'string') window.__m1WsFrames.push(event.data);
        });
      }
    }
    Object.setPrototypeOf(ProbedWebSocket, NativeWebSocket);
    window.WebSocket = ProbedWebSocket;
  });
}

async function readBrowserMessages(page) {
  const frames = await page.evaluate(() => window.__m1WsFrames ?? []);
  return frames.map(parseFrame).filter(Boolean);
}

function collectSocketMessages(page, target, label = 'browser') {
  page.on('websocket', (socket) => {
    console.log(`[${label}] WebSocket opened: ${socket.url()}`);
    socket.on('framereceived', (payload) => {
      const message = parseFrame(payload);
      if (message) {
        target.push(message);
        if (message.type === 'gameStart' || message.type === 'snapshot' || message.type === 'welcome' || message.type === 'roomState') {
          console.log(`[${label}] WebSocket received: ${message.type}`);
        }
      } else {
        console.log(`[${label}] WebSocket received an unparsed frame`);
      }
    });
    socket.on('socketerror', (error) => console.error(`[${label}] WebSocket error: ${error}`));
    socket.on('close', () => console.log(`[${label}] WebSocket closed`));
  });
  page.on('pageerror', (error) => browserErrors.push(`${page.url()}: ${error.message}`));
}

async function getCampaignStats(page) {
  return page.locator('.tk-stat').evaluateAll((cards) => Object.fromEntries(
    cards.map((card) => [
      card.querySelector('.tk-stat-label')?.textContent?.trim(),
      card.querySelector('.tk-stat-value')?.textContent?.trim(),
    ]),
  ));
}

async function testStoryChoice(browser, choice, expected, index) {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const playerName = `m1-preserve-${index}`;
  const settingsValue = JSON.stringify({
    lang: 'en',
    musicVol: 0.17,
    sfxVol: 0.29,
    renderScale: 0.75,
  });

  await page.addInitScript(({ playerName, settingsValue }) => {
    localStorage.setItem('ageofai:name', playerName);
    localStorage.setItem('ageofai:settings', settingsValue);
  }, { playerName, settingsValue });
  collectSocketMessages(page, []);

  await page.goto(BASE_URL);
  await page.locator('.tk-launch-btn').click();
  await page.locator('.tk-event-title').filter({ hasText: 'The Peach Garden Oath' }).waitFor();
  assert.equal(await page.locator('.tk-choice').count(), 3, 'opening event must show exactly three choices');

  await page.locator('.tk-choice').filter({ hasText: choice }).click();
  assert.deepEqual(await getCampaignStats(page), expected, `wrong effects for choice: ${choice}`);
  assert.equal(await page.locator('.tk-choice:disabled').count(), 3, 'choice must not be applied twice');

  await page.reload();
  await page.locator('.tk-launch-btn').click();
  await page.locator('.tk-event-title').filter({ hasText: 'The Peach Garden Oath' }).waitFor();
  assert.deepEqual(await getCampaignStats(page), expected, `campaign save did not survive refresh for: ${choice}`);
  assert.equal(await page.locator('.tk-choice:disabled').count(), 3, 'selected choice must remain locked after refresh');

  await page.locator('.tk-continue').click();
  await page.locator('.tk-event-title').filter({ hasText: 'The Yellow Turban Rebellion' }).waitFor();
  assert.equal(await page.locator('.tk-roster .tk-roster-unit').count(), 6, 'battle briefing must show both 3-unit rosters');

  // Battle-entry stage must also survive a full browser reload.
  await page.reload();
  await page.locator('.tk-launch-btn').click();
  await page.locator('.tk-event-title').filter({ hasText: 'The Yellow Turban Rebellion' }).waitFor();
  assert.equal(await page.locator('.tk-roster .tk-roster-unit').count(), 6, 'battle-entry save must restore both rosters after refresh');
  assert.deepEqual(await getCampaignStats(page), expected, 'battle-entry refresh must preserve the chosen campaign effects');
  const restoredStage = await page.evaluate(() => JSON.parse(
    localStorage.getItem('ageofai:three-kingdoms:campaign:v1') || 'null',
  )?.stage);
  assert.equal(restoredStage, 'battle-entry', 'battle-entry refresh must retain the saved stage');

  await page.getByRole('button', { name: 'Restart opening' }).click();
  await page.locator('.tk-event-title').filter({ hasText: 'The Peach Garden Oath' }).waitFor();
  assert.deepEqual(await getCampaignStats(page), {
    Morale: '3',
    Supplies: '3',
    Brotherhood: '0',
    'Local Allies': '0',
  }, 'restart must reset the campaign to initial values');
  assert.equal(await page.locator('.tk-choice:disabled').count(), 0, 'restart must unlock all three choices');

  const preserved = await page.evaluate(() => ({
    name: localStorage.getItem('ageofai:name'),
    settings: localStorage.getItem('ageofai:settings'),
    campaign: JSON.parse(localStorage.getItem('ageofai:three-kingdoms:campaign:v1') || 'null'),
  }));
  assert.equal(preserved.name, playerName, 'campaign reset must not change the RTS player name');
  assert.equal(preserved.settings, settingsValue, 'campaign reset must not change RTS preferences');
  assert.equal(preserved.campaign.selectedChoiceId, null, 'campaign reset must clear the selected choice');
  assert.equal(preserved.campaign.stage, 'oath', 'campaign reset must return to the opening event');

  await page.locator('.tk-back').click();
  await page.locator('.entry-login input').waitFor();
  console.log(`PASS — Three Kingdoms story choice / save / reset: ${choice}`);
  await context.close();
}

function latestSnapshot(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'snapshot') return messages[i];
  }
  return null;
}

async function waitUntil(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function isClearGroundPoint(x, y, snapshot) {
  const diagHit = (x0, y0, x1, y1, maxK) => {
    const lo = Math.max(x0 - x, y0 - y, -0.05);
    const hi = Math.min(x1 - x, y1 - y, maxK);
    return lo <= hi;
  };

  for (const unit of snapshot.units ?? []) {
    const radius = (unit.type === 'villager' ? 0.28 : unit.type === 'knight' ? 0.44 : 0.35) + 0.2;
    const t = Math.max(0, Math.min(1.4, ((unit.x - x) + (unit.y - y)) / 2));
    const dx = unit.x - (x + t);
    const dy = unit.y - (y + t);
    if (dx * dx + dy * dy <= radius * radius) return false;
  }

  for (const sheep of snapshot.sheep ?? []) {
    const t = Math.max(0, Math.min(0.6, ((sheep.x - x) + (sheep.y - y)) / 2));
    const dx = sheep.x - (x + t);
    const dy = sheep.y - (y + t);
    if (dx * dx + dy * dy <= 0.55 * 0.55) return false;
  }

  const buildingSizes = {
    town_center: 3, house: 2, barracks: 3, archery_range: 3, stable: 3,
    blacksmith: 3, market: 3, mill: 2, lumber_camp: 2, mining_camp: 2,
    dock: 3, farm: 1, wall: 1, watch_tower: 1,
  };
  const buildingHeights = {
    town_center: 1.2, house: 1.7, wall: 0.9, watch_tower: 3.4,
    market: 2.0, mill: 1.6, lumber_camp: 1.4, mining_camp: 1.4,
    farm: 0.2,
  };
  for (const building of snapshot.buildings ?? []) {
    const size = buildingSizes[building.type] ?? 2;
    if (diagHit(
      building.tileX + (building.type === 'town_center' ? 0.25 : 0),
      building.tileY + (building.type === 'town_center' ? 0.25 : 0),
      building.tileX + size - (building.type === 'town_center' ? 0.25 : 0),
      building.tileY + size - (building.type === 'town_center' ? 0.25 : 0),
      buildingHeights[building.type] ?? 2.5,
    )) return false;
  }

  const nodeHeights = { tree: 1.9, berry_bush: 0.4, gold_mine: 0.9, stone_mine: 0.9, fish: 0.5 };
  for (const node of snapshot.nodes ?? []) {
    if (diagHit(node.tileX, node.tileY, node.tileX + 1, node.tileY + 1, nodeHeights[node.type] ?? 0.5)) {
      return false;
    }
  }

  return true;
}

function chooseMoveTarget(map, snapshot, unit) {
  const size = map?.size;
  const tiles = map?.tiles;
  assert.ok(Number.isInteger(size) && Array.isArray(tiles), 'missing map data in gameStart');

  const candidates = [];
  for (let radius = 3; radius <= 9; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = Math.floor(unit.x + dx) + 0.5;
        const y = Math.floor(unit.y + dy) + 0.5;
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        if (tx < 1 || ty < 1 || tx >= size - 1 || ty >= size - 1) continue;
        if (tiles[ty * size + tx] !== 0) continue; // TILE_GRASS
        if (!isClearGroundPoint(x, y, snapshot)) continue;
        candidates.push({ x, y, distance: Math.hypot(x - unit.x, y - unit.y) });
      }
    }
    if (candidates.length) break;
  }

  assert.ok(candidates.length, `no clear grass destination found near unit ${unit.id}`);
  return candidates.sort((a, b) => a.distance - b.distance)[0];
}

async function testOriginalRtsMultiplayer(browser) {
  const contextA = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  let messagesA = [];
  let messagesB = [];
  await Promise.all([installWebSocketProbe(pageA), installWebSocketProbe(pageB)]);
  collectSocketMessages(pageA, [], 'RTS browser A');
  collectSocketMessages(pageB, [], 'RTS browser B');

  const suffix = Date.now().toString(36);
  const nameA = `M1Alpha-${suffix}`;
  const nameB = `M1Bravo-${suffix}`;

  try {
    await Promise.all([pageA.goto(BASE_URL), pageB.goto(BASE_URL)]);
    await pageA.locator('.entry-login input').fill(nameA);
    await pageB.locator('.entry-login input').fill(nameB);
    await Promise.all([
      pageA.locator('.entry-login button.btn.primary').click(),
      pageB.locator('.entry-login button.btn.primary').click(),
    ]);
    await Promise.all([
      pageA.locator('.lobby-create').waitFor(),
      pageB.locator('.lobby-create').waitFor(),
    ]);

    await pageA.locator('.lobby-create').click();
    await pageA.locator('.sala-title').waitFor();

    // The current RTS creates a helper bot with a new room. Remove it so two
    // distinct browser players can occupy the two human slots.
    const removeBot = pageA.locator('button.rem-bot');
    if (await removeBot.isVisible().catch(() => false)) {
      await removeBot.click();
    }

    await pageB.locator('.lobby-refresh').click();
    await pageB.locator('.room-item button:not(.watch)').first().waitFor();
    await pageB.locator('.room-item button:not(.watch)').first().click();

    await Promise.all([
      pageA.locator('.pcard.human').filter({ hasText: nameB }).waitFor(),
      pageB.locator('.pcard.host').filter({ hasText: nameA }).waitFor(),
    ]);

    await pageB.locator('.sala-act:not(.start):not(.danger)').click();
    await pageA.waitForFunction(() => {
      const button = document.querySelector('.sala-act.start');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await pageA.locator('.sala-act.start').click();

    await Promise.all([
      pageA.locator('#game-canvas').waitFor(),
      pageB.locator('#game-canvas').waitFor(),
    ]);
    await waitUntil(async () => {
      messagesA = await readBrowserMessages(pageA);
      messagesB = await readBrowserMessages(pageB);
      return messagesA.some((m) => m.type === 'gameStart') && messagesB.some((m) => m.type === 'gameStart')
        && latestSnapshot(messagesA) && latestSnapshot(messagesB);
    }, 15_000, 'both browser clients to receive gameStart and snapshots');

    const gameStartA = messagesA.find((m) => m.type === 'gameStart');
    const gameStartB = messagesB.find((m) => m.type === 'gameStart');
    const playerAId = gameStartA?.you;
    const playerBId = gameStartB?.you;
    assert.ok(playerAId !== undefined && playerBId !== undefined, 'both clients must receive authoritative player IDs');

    // Each browser selects an idle villager through the existing HUD button,
    // issues a right-click move order, and verifies both browsers observe the
    // authoritative unit position change in server snapshots.
    for (const [page, playerId, label, map] of [
      [pageA, playerAId, 'host', gameStartA.map],
      [pageB, playerBId, 'second player', gameStartB.map],
    ]) {
      messagesA = await readBrowserMessages(pageA);
      messagesB = await readBrowserMessages(pageB);
      const ownSnapshot = latestSnapshot(label === 'host' ? messagesA : messagesB);
      const idleVillagers = (ownSnapshot?.units ?? [])
        .filter((unit) => unit.owner === playerId && unit.type === 'villager' && unit.state === 'idle')
        .sort((a, b) => a.id - b.id);
      assert.ok(idleVillagers.length > 0, `${label} should have an idle villager to command`);
      const selectedUnit = idleVillagers[0];

      const idleButton = page.locator('.idle-vil:not(.hidden)');
      await idleButton.waitFor({ timeout: 10_000 });
      await idleButton.click();
      await page.locator('.sel-panel:not(.hidden)').waitFor({ timeout: 5_000 });

      const destination = chooseMoveTarget(map, ownSnapshot, selectedUnit);
      const canvasBox = await page.locator('#game-canvas').boundingBox();
      assert.ok(canvasBox, `${label} RTS canvas must have a measurable bounding box`);

      // The idle-villager HUD action centers the camera on the selected unit.
      const cameraX = Math.max(-4, Math.min(map.size + 4, selectedUnit.x));
      const cameraY = Math.max(-4, Math.min(map.size + 4, selectedUnit.y));
      const deltaX = destination.x - cameraX;
      const deltaY = destination.y - cameraY;
      const screenX = canvasBox.x + canvasBox.width / 2 + (deltaX - deltaY) * 32 * 1.1;
      const screenY = canvasBox.y + canvasBox.height / 2 + (deltaX + deltaY) * 16 * 1.1;
      assert.ok(
        screenX >= canvasBox.x + 40 && screenX <= canvasBox.x + canvasBox.width - 40
          && screenY >= canvasBox.y + 120 && screenY <= canvasBox.y + canvasBox.height - 170,
        `${label} selected a move destination outside the unobstructed game area`,
      );

      await page.mouse.click(screenX, screenY, { button: 'right' });
      await waitUntil(async () => {
        messagesA = await readBrowserMessages(pageA);
        messagesB = await readBrowserMessages(pageB);
        const snapshotA = latestSnapshot(messagesA);
        const snapshotB = latestSnapshot(messagesB);
        const movedA = snapshotA?.units?.find((unit) => unit.id === selectedUnit.id);
        const movedB = snapshotB?.units?.find((unit) => unit.id === selectedUnit.id);
        const movedEnough = (unit) => unit && Math.hypot(unit.x - selectedUnit.x, unit.y - selectedUnit.y) > 0.35;
        return movedEnough(movedA) && movedEnough(movedB);
      }, 12_000, `both browsers to observe ${label} villager movement`);
      console.log(`PASS — ${label} issued a move order; both browsers observed unit ${selectedUnit.id} move`);
    }

    // Chat verifies that both live browser sessions continue to exchange
    // messages after the match starts.
    const marker = `m1-browser-chat-${suffix}`;
    await pageA.keyboard.press('Enter');
    await pageA.locator('.game-chat-input').fill(marker);
    await pageA.keyboard.press('Enter');
    await pageB.locator('.chat-msg').filter({ hasText: marker }).waitFor({ timeout: 5_000 });

    // Exercise the existing in-game exit flow from a real browser. The host
    // confirms "leave room", returns to the lobby, and the other player sees
    // the game-over screen and can independently return to the same lobby.
    await pageA.locator('#settings-gear').click();
    const leaveButton = pageA.locator('.opt-card .btn.danger');
    await leaveButton.waitFor({ timeout: 5_000 });
    await leaveButton.click(); // first click requests confirmation in-game
    await leaveButton.click(); // second click confirms leaving the room
    await pageA.locator('.lobby-create').waitFor({ timeout: 8_000 });

    await pageB.locator('.result-title').waitFor({ timeout: 8_000 });
    await pageB.locator('body > .overlay:not(.hidden) .btn.primary').click();
    await pageB.locator('.lobby-create').waitFor({ timeout: 8_000 });

    assert.equal(browserErrors.length, 0, `browser runtime errors: ${browserErrors.join('; ')}`);
    console.log('PASS — original RTS: two browsers joined, started, synchronized moves/chat, and both returned to lobby');
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
}

async function testThreeKingdomsBattle(browser) {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const playerName = 'm2b-battle-ui';
  const settingsValue = JSON.stringify({
    lang: 'en',
    musicVol: 0.2,
    sfxVol: 0.3,
    renderScale: 1,
  });
  const campaignSave = {
    version: 1,
    eventFlags: ['taoyuan_oath_resolved'],
    resources: { morale: 5, supplies: 4, bond: 2, allies: 0 },
    selectedChoiceId: 'swear_oath',
    stage: 'battle-entry',
    battleState: null,
    playerFormation: 'arrow',
    playerOrders: [],
  };

  await page.addInitScript(({ playerName, settingsValue, campaignSave }) => {
    localStorage.setItem('ageofai:name', playerName);
    localStorage.setItem('ageofai:settings', settingsValue);
    localStorage.setItem('ageofai:three-kingdoms:campaign:v1', JSON.stringify(campaignSave));
  }, { playerName, settingsValue, campaignSave });
  collectSocketMessages(page, [], 'M2-B battle UI');

  try {
    await page.goto(BASE_URL);
    await page.locator('.tk-launch-btn').click();
    await page.locator('.tk-event-title').filter({ hasText: 'The Yellow Turban Rebellion' }).waitFor();
    await page.locator('.tk-begin-battle').click();

    await page.locator('.tk-battle-panel').waitFor();
    assert.equal(await page.locator('.tk-battle-unit.player').count(), 3, 'battle UI must show three player units');
    assert.equal(await page.locator('.tk-battle-unit.enemy').count(), 3, 'battle UI must show three enemy units');
    assert.equal(await page.locator('.tk-order-type').count(), 3, 'each living player unit must receive one order control');

    // Configure all three order types and a non-default formation using the
    // real DOM controls. Each change persists the order into the campaign save.
    await page.locator('.tk-formation-select').selectOption('square');
    await page.locator('.tk-order-target[data-unit-id="player-liu-bei"]').selectOption('enemy-raider-captain');
    await page.locator('.tk-order-type[data-unit-id="player-guan-yu"]').selectOption('scheme');
    await page.locator('.tk-order-target[data-unit-id="player-guan-yu"]').selectOption('enemy-rebel-archer');
    await page.locator('.tk-order-type[data-unit-id="player-zhang-fei"]').selectOption('wait');

    await page.locator('.tk-resolve-round').click();
    await page.locator('.tk-battle-panel .tk-eyebrow').filter({ hasText: 'ROUND 2' }).waitFor();
    const persisted = await page.evaluate(() => ({
      campaign: JSON.parse(localStorage.getItem('ageofai:three-kingdoms:campaign:v1') || 'null'),
      name: localStorage.getItem('ageofai:name'),
      settings: localStorage.getItem('ageofai:settings'),
    }));
    assert.equal(persisted.campaign.stage, 'battle', 'the battle stage must be saved');
    assert.equal(persisted.campaign.battleState.round, 2, 'resolving a round must advance the saved round');
    assert.equal(persisted.campaign.battleState.formations.player, 'square', 'the selected formation must be saved');
    assert.ok(persisted.campaign.battleState.log.some((entry) => entry.type === 'unit_attacked'), 'Attack must create a structured battle log entry');
    assert.ok(persisted.campaign.battleState.log.some((entry) => entry.type === 'scheme_attempted'), 'Scheme must create a structured battle log entry');
    assert.ok(persisted.campaign.battleState.log.some((entry) => entry.type === 'unit_guarded'), 'Wait must create a guarded log entry');
    assert.equal(persisted.campaign.battleState.units.length, 6, 'the save must retain all six battle units');
    assert.equal(persisted.name, playerName, 'battle save must preserve the original RTS name');
    assert.equal(persisted.settings, settingsValue, 'battle save must preserve the original RTS preferences');

    const logCount = persisted.campaign.battleState.log.length;
    await page.reload();
    await page.locator('.tk-launch-btn').click();
    await page.locator('.tk-battle-panel .tk-eyebrow').filter({ hasText: 'ROUND 2' }).waitFor();
    assert.equal(await page.locator('.tk-battle-unit.player').count(), 3, 'refresh must restore player units');
    assert.equal(await page.locator('.tk-battle-unit.enemy').count(), 3, 'refresh must restore enemy units');
    assert.equal(await page.locator('.tk-formation-select').inputValue(), 'square', 'refresh must restore the selected formation');
    assert.equal(await page.locator('.tk-battle-log li').count(), Math.min(logCount, 30), 'refresh must restore the battle log');
    const restored = await page.evaluate(() => ({
      campaign: JSON.parse(localStorage.getItem('ageofai:three-kingdoms:campaign:v1') || 'null'),
      name: localStorage.getItem('ageofai:name'),
      settings: localStorage.getItem('ageofai:settings'),
    }));
    assert.equal(restored.campaign.battleState.round, 2, 'refresh must not rerun or rewind the round');
    assert.equal(restored.campaign.battleState.log.length, logCount, 'refresh must preserve the existing log exactly');
    assert.equal(restored.name, playerName, 'refresh must preserve the RTS name');
    assert.equal(restored.settings, settingsValue, 'refresh must preserve RTS preferences');
    assert.equal(restored.name, undefined, 'campaign persistence must not add or overwrite RTS identity fields');

    await page.locator('.tk-back').click();
    await page.locator('.entry-login input').waitFor();
    assert.equal(browserErrors.length, 0, 'M2-B battle UI must not raise browser runtime errors');
    console.log('PASS — M2-B battle UI: 3v3 setup, formation, Attack/Scheme/Wait, round resolution, battle log, save and refresh');
  } finally {
    await context.close();
  }
}

async function main() {
  const serverProcess = start('npm', ['run', 'dev', '--workspace', 'server'], 'RTS server');
  const viteProcess = start('npm', ['run', 'dev', '--workspace', 'client'], 'Vite client');
  await waitForPort(SERVER_PORT, 30_000).catch((error) => {
    console.error(`RTS server output before startup failure:\\n${serverProcess.output}`);
    throw error;
  });
  await waitForPort(CLIENT_PORT, 30_000).catch((error) => {
    console.error(`Vite output before startup failure:\\n${viteProcess.output}`);
    throw error;
  });

  const browser = await chromium.launch({ headless: true });
  try {
    await testStoryChoice(browser, 'Swear the brotherhood oath', {
      Morale: '5',
      Supplies: '2',
      Brotherhood: '2',
      'Local Allies': '0',
    }, 1);
    await testStoryChoice(browser, 'Secure arms and provisions first', {
      Morale: '3',
      Supplies: '5',
      Brotherhood: '1',
      'Local Allies': '0',
    }, 2);
    await testStoryChoice(browser, 'Rally the villages against the raiders', {
      Morale: '4',
      Supplies: '3',
      Brotherhood: '1',
      'Local Allies': '2',
    }, 3);
    await testThreeKingdomsBattle(browser);
    await testOriginalRtsMultiplayer(browser);
  } finally {
    await browser.close();
  }

  assert.equal(browserErrors.length, 0, `uncaught browser errors: ${browserErrors.join('; ')}`);
  console.log('ALL M1 BROWSER REGRESSION CHECKS PASSED');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const { child, label } of children) {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        console.log(`Stopped ${label}`);
      }
    }
  });

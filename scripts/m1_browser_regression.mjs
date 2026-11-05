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

function collectSocketMessages(page, target) {
  page.on('websocket', (socket) => {
    socket.on('framereceived', (payload) => {
      const message = parseFrame(payload);
      if (message) target.push(message);
    });
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
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function testOriginalRtsMultiplayer(browser) {
  const contextA = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const messagesA = [];
  const messagesB = [];
  collectSocketMessages(pageA, messagesA);
  collectSocketMessages(pageB, messagesB);

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
    await waitUntil(
      () => messagesA.some((m) => m.type === 'gameStart') && messagesB.some((m) => m.type === 'gameStart')
        && latestSnapshot(messagesA) && latestSnapshot(messagesB),
      10_000,
      'both browser clients to receive gameStart and snapshots',
    );

    const gameStartA = messagesA.find((m) => m.type === 'gameStart');
    const playerAId = gameStartA?.you;
    assert.ok(playerAId !== undefined, 'host must receive its authoritative player ID');

    // Center the camera on the Town Center, select it, and enqueue a villager
    // through the actual RTS HUD. Both browsers must observe the newly trained
    // unit in authoritative snapshots.
    await pageA.keyboard.press('h');
    const canvasBox = await pageA.locator('#game-canvas').boundingBox();
    assert.ok(canvasBox, 'RTS canvas must have a measurable bounding box');
    await pageA.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await pageA.locator('.act-panel .act-title').filter({ hasText: 'Train' }).waitFor({ timeout: 10_000 });
    const trainButton = pageA.locator('.act-panel .cmd-tile:not(.off)').first();
    await trainButton.waitFor();
    await trainButton.click();

    await waitUntil(() => {
      const a = latestSnapshot(messagesA);
      const b = latestSnapshot(messagesB);
      const count = (snapshot) => (snapshot?.units ?? []).filter(
        (unit) => unit.owner === playerAId && unit.type === 'villager',
      ).length;
      return count(a) >= 4 && count(b) >= 4;
    }, 25_000, 'both RTS browser clients to observe the newly trained villager');

    // Chat verifies that both live browser sessions continue to exchange
    // messages after the match starts.
    const marker = `m1-browser-chat-${suffix}`;
    await pageA.keyboard.press('Enter');
    await pageA.locator('.game-chat-input').fill(marker);
    await pageA.keyboard.press('Enter');
    await pageB.locator('.chat-msg').filter({ hasText: marker }).waitFor({ timeout: 5_000 });

    assert.equal(browserErrors.length, 0, `browser runtime errors: ${browserErrors.join('; ')}`);
    console.log('PASS — original RTS: two browsers joined, started, trained a unit, and observed synchronized state/chat');
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
}

async function main() {
  start('npm', ['run', 'dev:server'], 'RTS server');
  start('npm', ['run', 'dev:client', '--', '--host', '127.0.0.1'], 'Vite client');
  await waitForPort(SERVER_PORT);
  await waitForPort(CLIENT_PORT);

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
        child.kill('SIGTERM');
        console.log(`Stopped ${label}`);
      }
    }
  });

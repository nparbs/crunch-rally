// Drive the game in headless Chrome and save screenshots to ./shots.
// Usage: node scripts/screenshots.mjs [scenario...]   (needs `npm run dev`, URL=... to override)
// Scenarios: desktop, nacho, pads, phone, portrait. window.cr exposes rc, room, world, screen.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync('shots', { recursive: true });

const scenarios = process.argv.slice(2);
const want = (s) => !scenarios.length || scenarios.includes(s);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1500);
  return page;
}
const wait = (page, ms) => page.waitForTimeout(ms);
const shot = async (page, name) => { await page.screenshot({ path: `shots/${name}.png` }); console.log('shot', name); };
const hold = async (page, keys, ms) => { for (const k of keys) await page.keyboard.down(k); await wait(page, ms); for (const k of keys) await page.keyboard.up(k); };

async function soloRace(page, track, laps = 1) {
  await page.click('#solo');
  await wait(page, 500);
  await page.click(`[data-t="${track}"]`);
  await wait(page, 200);
  await page.click(`[data-l="${laps}"]`);
  await wait(page, 200);
  await page.click('#start');
  await wait(page, 700);
}

if (want('desktop')) {
  const page = await open({ width: 1280, height: 720 });
  await shot(page, '01-title');
  await page.click('[data-c="kernel"]');
  await wait(page, 400);
  await shot(page, '02-title-kernel');
  await page.click('#solo');
  await wait(page, 600);
  await shot(page, '03-lobby');
  await page.click('#start');
  await wait(page, 300);
  await shot(page, '04-countdown');
  await wait(page, 2700);
  await page.keyboard.down('ArrowUp');
  await wait(page, 2500);
  await shot(page, '05-racing');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await wait(page, 1600);
  await shot(page, '06-drifting');
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await wait(page, 300);
  await shot(page, '07-boost');
  const st = await page.evaluate(() => { const k = window.cr.rc.me; return { s: k.s, lap: k.lap, speed: k.speed, place: window.cr.rc.place, item: window.cr.rc.item }; });
  console.log('state', JSON.stringify(st));
  await page.keyboard.up('ArrowUp');
}

if (want('nacho')) {
  const page = await open({ width: 1280, height: 720 });
  await soloRace(page, 'nacho');
  await wait(page, 3200);
  // Teleport my kart up onto the bridge and look around.
  for (const [name, s] of [['08-nacho-start', 30], ['09-nacho-bridge', 0.47], ['10-nacho-salsa', 0.27]]) {
    await page.evaluate((s) => {
      const rc = window.cr.rc; const k = rc.me; const t = rc.track;
      const d = s < 1 ? s * t.length : s;
      const p = t.pointAt(d, 0);
      Object.assign(k, { x: p.x, y: p.y, z: p.z, h: p.h, speed: 0, si: t.indexAt(d), s: d });
    }, s);
    await wait(page, 900);
    await shot(page, name);
  }
}

if (want('pads')) {
  // Park behind each boost pad and the ramp: the chevrons should point away from the camera.
  const page = await open({ width: 1280, height: 720 });
  await soloRace(page, 'picnic');
  await wait(page, 3200);
  for (const [name, at, lat] of [['15-pad-boost', 0.3, 3], ['16-pad-ramp', 0.555, 0]]) {
    await page.evaluate(([at, lat]) => {
      const rc = window.cr.rc; const k = rc.me; const t = rc.track;
      const d = at * t.length - 14;
      const p = t.pointAt(d, lat);
      Object.assign(k, { x: p.x, y: p.y, z: p.z, h: p.h, speed: 0, si: t.indexAt(d), s: d });
    }, [at, lat]);
    await wait(page, 1200);
    await shot(page, name);
  }
}

/** Hold an on-screen pedal with a pointer, the way a thumb would. */
async function press(page, sel) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
}

if (want('phone')) {
  const page = await open({ width: 640, height: 360 }, { touch: true });
  await shot(page, '11-phone-title');
  await soloRace(page, 'picnic');
  await wait(page, 2000);
  await press(page, '.tb-gas');
  await wait(page, 2500);
  await shot(page, '12-phone-race');
  const st = await page.evaluate(() => ({ speed: window.cr.rc.me.speed, gas: document.querySelector('.tb-gas').classList.contains('down') }));
  console.log('phone state', JSON.stringify(st));
  await page.mouse.up();
}

if (want('portrait')) {
  const page = await open({ width: 360, height: 640 }, { touch: true });
  await shot(page, '13-portrait-title');
  await soloRace(page, 'picnic');
  await wait(page, 2000);
  await press(page, '.tb-gas');
  await wait(page, 2500);
  await shot(page, '14-portrait-race');
  await page.mouse.up();
}

await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}

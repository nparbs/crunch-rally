// Two headless browsers in one online room: A creates, B joins by code, A starts, both drive.
// Needs the server running (npm run server, serves dist on :8792) or URL=...
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.URL ?? 'http://localhost:8792/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  await page.fill('#name', name);
  return page;
}

const a = await open('Alpha');
await a.click('[data-c="gummo"]');
await a.click('#create');
await a.waitForSelector('.code', { timeout: 5000 });
const code = (await a.textContent('.code')).trim();
console.log('room', code);
const b = await open('Bravo');
await b.click('[data-c="fizz"]');
await b.fill('#code', code);
await b.click('#join');
await b.waitForSelector('.players li:nth-child(2)', { timeout: 5000 });
await a.waitForTimeout(400);
await a.screenshot({ path: 'shots/mp-1-lobby.png' });
await a.click('[data-l="1"]');
await a.waitForTimeout(300);
await a.click('#start');
await Promise.all([a.waitForSelector('.hud'), b.waitForSelector('.hud')]);
console.log('both racing');
await a.waitForTimeout(3600);
await Promise.all([a.keyboard.down('ArrowUp'), b.keyboard.down('ArrowUp')]);
await a.waitForTimeout(5000);
await b.screenshot({ path: 'shots/mp-2-race-b.png' });
const view = await b.evaluate(() => {
  const rc = window.cr.rc;
  const others = [...rc.others.values()].map((o) => ({ id: o.id, x: +o.kart.x.toFixed(1), s: +o.kart.s.toFixed(1) }));
  return { me: { s: +rc.me.s.toFixed(1), speed: +rc.me.speed.toFixed(1) }, place: rc.place, others: others.slice(0, 3), objs: rc.objs.size };
});
console.log('B sees', JSON.stringify(view));
const health = await (await fetch(new URL('/health', BASE))).json();
console.log('health', JSON.stringify(health));
await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}

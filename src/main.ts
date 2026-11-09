// Crunch Rally: screens, the race loop and the HUD.

import '@fontsource/lilita-one/400.css';
import './ui/style.css';
import { sfx, type SfxName } from './audio/sfx';
import { RaceClient, type ClientEvent } from './game/raceClient';
import { isTouch, mountTouch, readControls } from './game/input';
import { LocalLink, WsLink, hello, type Link } from './net/link';
import { EMOTES, type PlayerInfo, type RoomSettings, type ServerMsg } from './net/protocol';
import { World, TIER_COLORS } from './render/world';
import { ABILITIES, CHARACTERS, charById } from './sim/characters';
import { ITEMS, type ItemId } from './sim/items';
import type { Result } from './sim/race';
import { CPU_LEVELS, type CpuLevel } from './sim/bot';
import { TRACKS } from './sim/tracks';

declare const __APP_VERSION__: string;

// ---- Saved profile --------------------------------------------------------------------------

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem('crunch.' + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem('crunch.' + k, v);
    } catch {
      /* private mode */
    }
  },
};
const profile = {
  name: store.get('name') ?? '',
  char: charById(store.get('char') ?? CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id).id,
};

// ---- State ------------------------------------------------------------------------------------

const ui = document.getElementById('ui')!;
const world = new World(document.getElementById('view') as HTMLCanvasElement);
let link: Link | null = null;
let room: Extract<ServerMsg, { t: 'room' }> | null = null;
let rc: RaceClient | null = null;
let screen: 'title' | 'lobby' | 'race' = 'title';
let paused = false;
let results: Result[] | null = null;
let titleError = '';

const ITEM_ICON: Record<ItemId, string> = { jawbreaker: '🔴', taffy: '🍬', butter: '🧈', espresso: '☕', gum: '🫧', sugarCrash: '🍭' };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th');
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

document.body.classList.toggle('touchui', isTouch());
addEventListener('pointerdown', () => sfx.unlock(), { once: false });
addEventListener('keydown', () => sfx.unlock());

// ---- Title screen ---------------------------------------------------------------------------

function showTitle(): void {
  screen = 'title';
  rc = null;
  results = null;
  document.body.classList.remove('racing');
  world.showPreview(profile.char);
  sfx.stopEngine();
  const code = new URLSearchParams(location.search).get('room') ?? '';
  ui.innerHTML = `
    <div class="screen title">
      <div class="title-left">
        <h1 class="logo">CRUNCH RALLY<small>snack-mascot kart racing</small></h1>
        <div class="panel">
          <p class="label">Pick your racer</p>
          <div class="chars">${CHARACTERS.map((c) => `<button class="char${c.id === profile.char ? ' on' : ''}" data-c="${c.id}"><span class="dot" style="background:${hex(c.color)}"></span>${esc(c.name)}</button>`).join('')}</div>
        </div>
        <div class="panel who"></div>
      </div>
      <div class="title-right">
        <div class="panel">
          <p class="label">Your name</p>
          <input class="field" id="name" maxlength="14" placeholder="Racer" value="${esc(profile.name)}" autocomplete="off" />
        </div>
        <button class="btn go" id="solo">Race the CPUs</button>
        <button class="btn" id="create">Create a room</button>
        <div class="row"><input class="field code-in grow" id="code" maxlength="4" placeholder="CODE" value="${esc(code.toUpperCase())}" /><button class="btn alt" id="join">Join</button></div>
        <div class="err">${esc(titleError)}</div>
        <div class="panel keys">${isTouch() ? 'Drag on the left to steer. Hold <b>GAS</b> to drive (hold it as GO! lands for a rocket start). Slide onto <b>DRIFT</b> while turning, let go for a boost.' : '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> or <kbd>WASD</kbd> drive · <kbd>Space</kbd> hop / drift (hold while turning, let go to boost) · <kbd>E</kbd> item · <kbd>Q</kbd> ability · <kbd>1</kbd>-<kbd>8</kbd> emotes · gamepads work too'}</div>
        <div class="foot">v${__APP_VERSION__} · <a href="https://github.com/nparbs/crunch-rally" target="_blank" rel="noopener">source</a></div>
      </div>
    </div>`;
  titleError = '';
  renderWho();
  for (const b of ui.querySelectorAll<HTMLButtonElement>('.char')) {
    b.onclick = () => {
      profile.char = b.dataset.c!;
      store.set('char', profile.char);
      ui.querySelectorAll('.char').forEach((x) => x.classList.toggle('on', x === b));
      world.showPreview(profile.char);
      renderWho();
      sfx.play('click');
    };
  }
  const nameIn = ui.querySelector<HTMLInputElement>('#name')!;
  nameIn.oninput = () => {
    profile.name = nameIn.value;
    store.set('name', profile.name);
  };
  const name = () => profile.name.trim() || 'Racer';
  ui.querySelector<HTMLButtonElement>('#solo')!.onclick = () => connect(new LocalLink(name(), profile.char));
  ui.querySelector<HTMLButtonElement>('#create')!.onclick = () => connect(new WsLink(hello(name(), profile.char)));
  const codeIn = ui.querySelector<HTMLInputElement>('#code')!;
  const join = () => {
    const c = codeIn.value.trim().toUpperCase();
    if (c.length !== 4) return setTitleError('Room codes are 4 letters.');
    connect(new WsLink(hello(name(), profile.char, c)));
  };
  ui.querySelector<HTMLButtonElement>('#join')!.onclick = join;
  codeIn.onkeydown = (e) => e.key === 'Enter' && join();
}

function setTitleError(msg: string): void {
  const el = ui.querySelector('.err');
  if (el) el.textContent = msg;
}

function renderWho(): void {
  const c = charById(profile.char);
  const ab = ABILITIES[c.ability];
  const bar = (label: string, v: number) => `<span>${label}</span><div class="bar"><i style="width:${v * 20}%"></i></div>`;
  ui.querySelector('.who')!.innerHTML = `
    <h2>${esc(c.name)}</h2><p class="snack">${esc(c.snack)}</p><p class="bio">${esc(c.bio)}</p>
    <div class="stats">${bar('Speed', c.speed)}${bar('Accel', c.accel)}${bar('Handling', c.handling)}${bar('Weight', c.weight)}</div>
    <div class="ability"><b>★ ${esc(ab.name)}</b><br>${esc(ab.text)}</div>`;
}

// ---- Connection and lobby -------------------------------------------------------------------

function connect(l: Link): void {
  link?.close();
  link = l;
  sfx.play('click');
  l.onMessage = onMessage;
  l.onClose = (reason) => {
    if (link !== l) return;
    link = null;
    room = null;
    titleError = reason;
    showTitle();
  };
  if (l instanceof LocalLink) l.flush();
}

function leave(): void {
  link?.close();
  link = null;
  room = null;
  history.replaceState(null, '', location.pathname);
  showTitle();
}

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'error':
      if (m.refresh) {
        titleError = m.msg;
        location.reload();
        return;
      }
      link?.close();
      link = null;
      titleError = m.msg;
      if (screen === 'title') setTitleError(m.msg);
      else showTitle();
      break;
    case 'room': {
      const first = !room;
      room = m;
      if (!link?.local && first) history.replaceState(null, '', `?room=${m.code}`);
      if (screen !== 'race') showLobby();
      break;
    }
    case 'race':
      startRace(m.track, m.laps, m.entrants);
      break;
    case 'snap':
      rc?.snapshot(m.s);
      break;
    case 'ev':
      rc?.event(m.e);
      break;
    case 'emote': {
      const p = room?.players.find((x) => x.id === m.id);
      feed(`${esc(p?.name ?? '?')}: ${EMOTES[m.e] ?? ''}`);
      break;
    }
  }
}

function showLobby(): void {
  if (!room || !link) return;
  screen = 'lobby';
  document.body.classList.remove('racing');
  if (!world['preview']) world.showPreview(myChar());
  const solo = link.local;
  const host = room.host === room.you;
  const s = room.settings;
  const inRace = room.phase === 'race';
  const share = `${location.origin}${location.pathname}?room=${room.code}`;
  ui.innerHTML = `
    <div class="screen lobby">
      <div class="panel">
        <div class="lobby-top">
          ${solo ? '<h2 class="logo" style="font-size:34px">SOLO RACE</h2>' : `<div><p class="label">Room code</p><div class="code">${room.code}</div></div>
          <button class="btn alt" id="copy">Copy invite link</button>`}
        </div>
        ${solo ? '' : `<ul class="players">${room.players.map((p) => playerRow(p)).join('')}</ul>`}
        <p class="label">Track${host ? '' : ' (the host picks)'}</p>
        <div class="tracks">${TRACKS.map((t) => `<button class="track${t.id === s.track ? ' on' : ''}" data-t="${t.id}" ${host ? '' : 'disabled'}><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}</div>
        <div class="setting">Laps ${[1, 2, 3, 4, 5].map((n) => `<button class="pill${n === s.laps ? ' on' : ''}" data-l="${n}" ${host ? '' : 'disabled'}>${n}</button>`).join('')}
          ${solo ? '' : `<span style="margin-left:12px">CPU racers</span> <button class="pill${s.fill ? ' on' : ''}" id="fill" ${host ? '' : 'disabled'}>${s.fill ? 'On' : 'Off'}</button>`}
        </div>
        ${solo || s.fill ? `<div class="setting">CPUs ${CPU_LEVELS.map((c) => `<button class="pill${c === s.cpu ? ' on' : ''}" data-c="${c}" ${host ? '' : 'disabled'}>${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>` : ''}
        <div class="setting">Racer: <span style="font-family:var(--font);font-size:20px">${esc(charById(myChar()).name)}</span>
          <button class="pill" id="prev">◀</button><button class="pill" id="next">▶</button></div>
        <div class="lobby-actions">
          <button class="btn alt" id="leave">${solo ? 'Back' : 'Leave room'}</button>
          ${host ? `<button class="btn go" id="start" ${inRace ? 'disabled' : ''}>${inRace ? 'Race in progress…' : 'Start race'}</button>` : `<span style="font-weight:800;align-self:center">${inRace ? 'A race is on. You join the next one.' : 'Waiting for the host to start…'}</span>`}
        </div>
      </div>
    </div>`;
  const send = (settings: Partial<RoomSettings>) => link?.send({ t: 'settings', settings: { ...s, ...settings } });
  ui.querySelectorAll<HTMLButtonElement>('.track').forEach((b) => (b.onclick = () => send({ track: b.dataset.t! })));
  ui.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => (b.onclick = () => send({ laps: Number(b.dataset.l) })));
  ui.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => send({ cpu: b.dataset.c as CpuLevel })));
  const fill = ui.querySelector<HTMLButtonElement>('#fill');
  if (fill) fill.onclick = () => send({ fill: !s.fill });
  const cycle = (d: number) => {
    const i = CHARACTERS.findIndex((c) => c.id === myChar());
    const c = CHARACTERS[(i + d + CHARACTERS.length) % CHARACTERS.length].id;
    profile.char = c;
    store.set('char', c);
    link?.send({ t: 'char', char: c });
    world.showPreview(c);
  };
  ui.querySelector<HTMLButtonElement>('#prev')!.onclick = () => cycle(-1);
  ui.querySelector<HTMLButtonElement>('#next')!.onclick = () => cycle(1);
  ui.querySelector<HTMLButtonElement>('#leave')!.onclick = leave;
  const start = ui.querySelector<HTMLButtonElement>('#start');
  if (start) start.onclick = () => link?.send({ t: 'start' });
  const copy = ui.querySelector<HTMLButtonElement>('#copy');
  if (copy)
    copy.onclick = () => {
      navigator.clipboard?.writeText(share).then(() => (copy.textContent = 'Copied!'), () => (copy.textContent = share));
    };
  if (solo && link instanceof LocalLink) link.flush();
}

function myChar(): string {
  return room?.players.find((p) => p.id === room!.you)?.char ?? profile.char;
}

function playerRow(p: PlayerInfo): string {
  const c = charById(p.char);
  const tags = [p.id === room?.host ? 'host' : '', p.id === room?.you ? 'you' : '', p.racing ? 'racing' : ''].filter(Boolean).join(' · ');
  return `<li><span class="dot" style="background:${hex(c.color)}"></span>${esc(p.name)}<small>${tags}</small></li>`;
}

// ---- Race -------------------------------------------------------------------------------------

let hud: {
  place: HTMLElement; lap: HTMLElement; time: HTMLElement; slot: HTMLElement; meter: HTMLElement; center: HTMLElement;
  wrong: HTMLElement; feed: HTMLElement; map: HTMLCanvasElement; blind: HTMLElement; abBtn: HTMLElement | null;
} | null = null;
let centerT = 0;
let lastCount = 99;
let finalLapShown = false;

function startRace(track: string, laps: number, entrants: { id: string; name: string; char: string; bot: boolean }[]): void {
  if (!room || !link) return;
  screen = 'race';
  paused = false;
  results = null;
  lastCount = 99;
  finalLapShown = false;
  document.body.classList.add('racing');
  document.body.classList.toggle('touchui', isTouch());
  rc = new RaceClient(track, laps, entrants, room.you, (m) => link?.send(m), onRaceEvent);
  world.setupRace(rc);
  const ab = ABILITIES[charById(myChar()).ability];
  ui.innerHTML = `
    <div class="hud">
      <div class="blind"></div>
      <div class="lap"></div><div class="time"></div>
      <canvas class="map" width="260" height="260"></canvas>
      <div class="place"></div>
      <div class="meter"><div class="mbar"><i></i></div><div class="mname">★ ${esc(ab.name)}${isTouch() ? '' : ' [Q]'}</div></div>
      <div class="slot"></div>
      <div class="center"></div><div class="wrong"></div><div class="feed"></div>
    </div>
    <div class="touch"></div>
    <button class="pausebtn" id="pause">II</button>`;
  const q = <T extends HTMLElement>(s: string) => ui.querySelector<T>(s)!;
  mountTouch(q('.touch'));
  hud = {
    place: q('.place'), lap: q('.lap'), time: q('.time'), slot: q('.slot'), meter: q('.meter'), center: q('.center'),
    wrong: q('.wrong'), feed: q('.feed'), map: q<HTMLCanvasElement>('.map'), blind: q('.blind'), abBtn: ui.querySelector('.tb-ability'),
  };
  q('#pause').onclick = togglePause;
  drawMapBase();
  sfx.music(true);
}

function onRaceEvent(e: ClientEvent, mine: boolean): void {
  if (!rc) return;
  const play = (n: SfxName, vol = 1) => sfx.play(n, { vol });
  const near = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - rc!.me.x, z - rc!.me.z) / 60);
  switch (e.k) {
    case 'mt':
      play('miniturbo', 0.6 + e.tier * 0.2);
      if (mine) world.burst(rc.me.x, rc.me.y, rc.me.z, [TIER_COLORS[e.tier]], 10, 5, 0.4);
      break;
    case 'tier':
      if (e.tier > 0) play(`tier${e.tier}` as SfxName);
      break;
    case 'hop': play('hop', 0.5); break;
    case 'trick':
      play('trick');
      center('TRICK!', true);
      break;
    case 'ramp': play('ramp'); break;
    case 'land': play('land'); break;
    case 'pad': play('boostpad'); break;
    case 'draft':
      play('boostpad', 0.7);
      if (mine) center('SLIPSTREAM!', true);
      break;
    case 'wall':
      play('wall', Math.min(1, e.power / 20));
      world.addShake(Math.min(0.4, e.power / 60));
      break;
    case 'fall': play('fall'); break;
    case 'respawn': play('respawn'); break;
    case 'lap':
      if (e.lap === rc.laps && rc.laps > 1 && !finalLapShown) {
        finalLapShown = true;
        center('FINAL LAP!', true);
        play('finallap');
      } else if (e.lap > 1 && e.lap <= rc.laps) {
        center(`LAP ${e.lap}`, true);
        play('lap');
      }
      break;
    case 'item':
      if (mine && e.roll > 0) play('crate');
      break;
    case 'box': {
      const p = world && rc;
      if (p) play('crate', near(rc.me.x, rc.me.z) * 0.3);
      break;
    }
    case 'hit':
      world.burst(e.x, rc.me.y, e.z, [0xffffff, 0xffd23f], 12, 6, 0.5);
      if (mine) {
        play(e.kind === 'slow' ? 'slowed' : 'hit');
        world.addShake(0.5);
      } else play('hit', near(e.x, e.z) * 0.6);
      break;
    case 'blocked':
      world.burst(e.x, rc.me.y + 1, e.z, [0xff8fd0, 0xffffff], 16, 7, 0.5);
      play('blocked', mine ? 1 : near(e.x, e.z));
      break;
    case 'buff':
      if (mine) play(e.buff === 'gum' ? 'shield' : 'whoosh');
      break;
    case 'ability': {
      const who = rc.entrant(e.id);
      play(mine ? 'ability' : 'pop', mine ? 1 : 0.4);
      if (!mine && who) feed(`${esc(who.name)}: ${esc(ABILITIES[e.ability].name)}!`);
      if (mine) center(ABILITIES[e.ability].name.toUpperCase() + '!', true);
      break;
    }
    case 'pop':
      if (e.r > 0) world.ring(e.x, e.y, e.z, e.r, 0xfff3c4);
      else world.burst(e.x, e.y, e.z, [0xff3fd2, 0xffd23f, 0x4fd8ff], 18, 8, 0.5);
      play('pop', near(e.x, e.z));
      break;
    case 'go':
      break;
    case 'finish':
      if (mine) {
        center(`${ordinal(e.place)}!`, false);
        centerT = 99;
        play('finish');
      } else {
        const who = rc.entrant(e.id);
        if (who && e.place === 1) feed(`${esc(who.name)} wins!`);
      }
      break;
    case 'done':
      results = e.results;
      setTimeout(() => {
        if (screen === 'race' && results) showResults();
      }, mineFinished() ? 1800 : 300);
      break;
  }
}

const mineFinished = () => !!rc?.me.finished;

function showResults(): void {
  if (!results || !room) return;
  sfx.stopEngine();
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="panel"><h2>Results</h2>
    <table class="results">${results
      .map((r) => {
        const c = charById(r.char);
        return `<tr class="${r.id === room!.you ? 'me' : ''}"><td>${ordinal(r.place)}</td><td><span class="dot" style="background:${hex(c.color)}"></span>${esc(r.name)}${r.bot ? ' <small>(CPU)</small>' : ''}</td><td class="t">${r.time !== null ? fmtTime(r.time) : '—'}</td></tr>`;
      })
      .join('')}</table>
    <div class="lobby-actions"><button class="btn go" id="cont">Continue</button></div></div>`;
  ui.appendChild(el);
  el.querySelector<HTMLButtonElement>('#cont')!.onclick = () => {
    sfx.music(false);
    world.clearRace();
    rc = null;
    screen = 'lobby';
    world.showPreview(myChar());
    showLobby();
  };
}

function togglePause(): void {
  if (!rc || results) return;
  const existing = ui.querySelector('.overlay.pause');
  if (existing) {
    existing.remove();
    paused = false;
    return;
  }
  paused = !!link?.local;
  const el = document.createElement('div');
  el.className = 'overlay pause';
  el.innerHTML = `<div class="panel"><h2>${paused ? 'Paused' : 'Menu'}</h2>
    <p style="text-align:center;font-weight:700">${paused ? '' : 'The race keeps going while this is open.'}</p>
    ${link?.local ? '' : `<div class="row" style="flex-wrap:wrap;justify-content:center">${EMOTES.map((e, i) => `<button class="pill" data-e="${i}">${e}</button>`).join('')}</div>`}
    <div class="setting" style="justify-content:center">Sound <button class="pill${sfx.muted ? '' : ' on'}" id="snd">${sfx.muted ? 'Off' : 'On'}</button></div>
    <div class="lobby-actions"><button class="btn alt" id="quit">Leave race</button><button class="btn go" id="resume">Resume</button></div></div>`;
  ui.appendChild(el);
  el.querySelector<HTMLButtonElement>('#resume')!.onclick = togglePause;
  el.querySelector<HTMLButtonElement>('#quit')!.onclick = () => {
    sfx.music(false);
    leave();
  };
  el.querySelector<HTMLButtonElement>('#snd')!.onclick = (ev) => {
    sfx.muted = !sfx.muted;
    (ev.target as HTMLElement).textContent = sfx.muted ? 'Off' : 'On';
    (ev.target as HTMLElement).classList.toggle('on', !sfx.muted);
  };
  el.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => (b.onclick = () => link?.send({ t: 'emote', e: Number(b.dataset.e) })));
}

function center(text: string, flash: boolean): void {
  if (!hud) return;
  hud.center.textContent = text;
  hud.center.classList.toggle('small', text.length > 6);
  hud.center.classList.remove('pop');
  void hud.center.offsetWidth;
  hud.center.classList.add('pop');
  centerT = flash ? 1.3 : 99;
}

function feed(html: string): void {
  if (!hud) return;
  const d = document.createElement('div');
  d.innerHTML = html;
  hud.feed.appendChild(d);
  setTimeout(() => d.remove(), 3000);
  while (hud.feed.children.length > 3) hud.feed.firstChild!.remove();
}

// Minimap: the track drawn once, karts drawn every frame.
let mapBase: HTMLCanvasElement | null = null;
let mapXf = { cx: 0, cz: 0, k: 1 };
function drawMapBase(): void {
  if (!rc || !hud) return;
  const t = rc.track;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < t.n; i++) {
    x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]);
    z0 = Math.min(z0, t.z[i]); z1 = Math.max(z1, t.z[i]);
  }
  mapXf = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, k: 220 / Math.max(x1 - x0, z1 - z0) };
  mapBase = document.createElement('canvas');
  mapBase.width = mapBase.height = 260;
  const g = mapBase.getContext('2d')!;
  const P = (i: number) => mapPt(t.x[i], t.z[i]);
  for (const [w, c] of [[16, 'rgba(42,26,16,.85)'], [9, '#fff6e3']] as const) {
    g.lineWidth = w;
    g.strokeStyle = c;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= t.n; i++) {
      const [x, y] = P(i % t.n);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  const [sx, sy] = P(0);
  g.fillStyle = '#e8443a';
  g.fillRect(sx - 6, sy - 6, 12, 12);
}
function mapPt(x: number, z: number): [number, number] {
  // Rotate so the start straight points up the map.
  const t = rc!.track;
  const a = -Math.PI / 2 - t.heading(0);
  const dx = (x - mapXf.cx) * mapXf.k, dz = (z - mapXf.cz) * mapXf.k;
  return [130 + dx * Math.cos(a) - dz * Math.sin(a), 130 + dx * Math.sin(a) + dz * Math.cos(a)];
}
function drawMap(): void {
  if (!rc || !hud || !mapBase) return;
  const g = hud.map.getContext('2d')!;
  g.clearRect(0, 0, 260, 260);
  g.drawImage(mapBase, 0, 0);
  const karts = rc.allKarts();
  for (let i = karts.length - 1; i >= 0; i--) {
    const k = karts[i];
    const [x, y] = mapPt(k.x, k.z);
    const me = k === rc.me;
    g.beginPath();
    g.arc(x, y, me ? 11 : 8, 0, Math.PI * 2);
    g.fillStyle = hex(charById(k.char).color);
    g.fill();
    g.lineWidth = me ? 4 : 2.5;
    g.strokeStyle = me ? '#fff' : '#2a1a10';
    g.stroke();
  }
}

function updateHud(dt: number): void {
  if (!rc || !hud) return;
  const k = rc.me;
  const n = rc.entrants.length;
  const place = k.finished && rc.finishPlace ? rc.finishPlace : rc.place + 1;
  const ord = ordinal(place);
  hud.place.innerHTML = `${place}<sup>${ord.slice(-2)}</sup><span style="font-size:.35em">/${n}</span>`;
  hud.lap.textContent = `LAP ${Math.max(1, Math.min(rc.laps, k.lap))}/${rc.laps}`;
  hud.time.textContent = fmtTime(Math.max(0, k.finished && k.finishTime ? k.finishTime : rc.clock));
  // Item slot with a roulette while rolling.
  if (rc.rollT > 0) {
    const ids = Object.keys(ITEMS) as ItemId[];
    const shown = ids[Math.floor(rc.clock * 14) % ids.length];
    hud.slot.innerHTML = ITEM_ICON[shown];
    if (Math.floor(rc.clock * 14) !== Math.floor((rc.clock - dt) * 14)) sfx.play('roulette', { vol: 0.4 });
    hud.slot.classList.add('rolling');
  } else {
    hud.slot.classList.remove('rolling');
    hud.slot.innerHTML = rc.item ? `${ITEM_ICON[rc.item]}${rc.count > 1 ? `<span class="count">×${rc.count}</span>` : ''}` : '';
  }
  const full = rc.meter >= 1;
  if (full && !hud.meter.classList.contains('full')) sfx.play('abilityReady');
  hud.meter.classList.toggle('full', full);
  hud.meter.querySelector<HTMLElement>('i')!.style.width = `${Math.round(rc.meter * 100)}%`;
  hud.abBtn?.classList.toggle('full', full);
  // Countdown.
  if (rc.clock < 0) {
    const c = Math.ceil(-rc.clock);
    if (c !== lastCount && c <= 3) {
      lastCount = c;
      center(String(c), true);
      sfx.play('countdown');
    }
  } else if (lastCount !== 0) {
    lastCount = 0;
    center('GO!', true);
    sfx.play('go');
  }
  centerT -= dt;
  if (centerT <= 0) hud.center.textContent = '';
  hud.wrong.textContent = k.wrongT > 1 && !k.finished ? 'WRONG WAY!' : '';
  hud.blind.classList.toggle('on', k.blindT > 0);
  drawMap();
}

// ---- Main loop --------------------------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const c = readControls();
  if (c.pause && screen === 'race') togglePause();
  if (!paused) link?.update(dt);
  if (rc && screen === 'race' && !paused) {
    rc.update(dt, results ? { throttle: 0, steer: 0, drift: false } : c);
    if (c.item) rc.useItem();
    if (c.ability) rc.useAbility();
    if (c.emote >= 0 && !link?.local) link?.send({ t: 'emote', e: c.emote });
    updateHud(dt);
    const k = rc.me;
    const loc = Math.abs(k.lat) > rc.track.w[Math.max(0, k.si)] / 2 + 0.6;
    if (!results) sfx.engine(Math.min(1, Math.abs(k.speed) / 34), rc.clock < 0 ? Math.max(0, c.throttle) : Math.abs(c.throttle), k.drift !== 0, k.boostT > 0, loc && !k.air);
  }
  world.render(dt, screen === 'race' ? rc : null);
  requestAnimationFrame(frame);
}

// Expose for headless checks.
(window as unknown as { cr: object }).cr = { get rc() { return rc; }, get room() { return room; }, world, get screen() { return screen; } };

showTitle();
requestAnimationFrame(frame);

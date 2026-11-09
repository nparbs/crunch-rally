// Keyboard, gamepad and touch, merged into one Input each frame.
// Phones get drag-to-steer on the left half, and gas, brake, drift, item and ability buttons on the right.
// A thumb can slide between GAS, DRIFT and BRAKE without lifting. Holding DRIFT also gives gas.

import type { Input } from '../sim/kart';

export interface Controls extends Input {
  item: boolean; // pressed this frame
  ability: boolean;
  emote: number; // -1 or an emote index pressed this frame
  pause: boolean;
}

const keys = new Set<string>();
const pressed = new Set<string>();
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && document.body.classList.contains('racing')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const touch = { steer: 0, gas: false, drift: false, brake: false, item: false, ability: false, used: false };
/** Which pedal button each finger is on, by pointer id. */
const pedalFingers = new Map<number, Pedal>();
type Pedal = 'gas' | 'drift' | 'brake';
function syncPedals(): void {
  const on = new Set(pedalFingers.values());
  touch.gas = on.has('gas');
  touch.drift = on.has('drift');
  touch.brake = on.has('brake');
}
let padPrev: boolean[] = [];

export const isTouch = () => matchMedia('(pointer: coarse)').matches || touch.used;

export function readControls(): Controls {
  const k = (...c: string[]) => c.some((x) => keys.has(x));
  const p = (...c: string[]) => c.some((x) => pressed.has(x));
  let throttle = (k('ArrowUp', 'KeyW') ? 1 : 0) - (k('ArrowDown', 'KeyS') ? 1 : 0);
  let steer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
  let drift = k('Space', 'ShiftLeft', 'ShiftRight', 'KeyK');
  let item = p('KeyE', 'KeyJ', 'KeyX', 'ControlLeft', 'Enter');
  let ability = p('KeyQ', 'KeyL', 'KeyC');
  let emote = -1;
  for (let i = 1; i <= 8; i++) if (p('Digit' + i)) emote = i - 1;
  const pause = p('Escape', 'KeyP');

  // Gamepad (standard mapping).
  const gp = navigator.getGamepads?.().find((g) => g && g.mapping === 'standard');
  if (gp) {
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const was = (i: number) => !!padPrev[i];
    const ax = gp.axes[0] ?? 0;
    if (Math.abs(ax) > 0.15) steer = Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85;
    if (b(14)) steer = -1;
    if (b(15)) steer = 1;
    const gas = Math.max(b(0) ? 1 : 0, gp.buttons[7]?.value ?? 0);
    const brake = Math.max(b(1) ? 1 : 0, gp.buttons[6]?.value ?? 0);
    if (gas || brake) throttle = gas - brake;
    drift = drift || b(5) || b(4);
    if (b(2) && !was(2)) item = true;
    if (b(3) && !was(3)) ability = true;
    padPrev = gp.buttons.map((x) => x.pressed);
  }

  if (touch.used) {
    if (!keys.size) {
      throttle = touch.brake ? -1 : touch.gas || touch.drift ? 1 : 0;
      steer = touch.steer;
    }
    drift = drift || touch.drift;
    item = item || touch.item;
    ability = ability || touch.ability;
    touch.item = touch.ability = false;
  }
  pressed.clear();
  return { throttle, steer: Math.max(-1, Math.min(1, steer)), drift, item, ability, emote, pause };
}

/** Build the on-screen controls inside `root`. */
export function mountTouch(root: HTMLElement): void {
  releaseTouch();
  root.innerHTML = `
    <div class="steer-zone"><div class="steer-base"><div class="steer-knob"></div></div></div>
    <div class="tbtns">
      <button class="tb tb-ability" data-b="ability">★</button>
      <button class="tb tb-item" data-b="item">ITEM</button>
      <button class="tb tb-brake" data-p="brake">BRAKE</button>
      <button class="tb tb-drift" data-p="drift">DRIFT</button>
      <button class="tb tb-gas" data-p="gas">GAS</button>
    </div>`;
  const zone = root.querySelector<HTMLElement>('.steer-zone')!;
  const base = root.querySelector<HTMLElement>('.steer-base')!;
  const knob = root.querySelector<HTMLElement>('.steer-knob')!;
  let steerId = -1, startX = 0;
  const RANGE = 55;
  zone.addEventListener('pointerdown', (e) => {
    touch.used = true;
    steerId = e.pointerId;
    startX = e.clientX;
    zone.setPointerCapture(e.pointerId);
    base.style.left = `${e.clientX - zone.getBoundingClientRect().left}px`;
    base.style.top = `${e.clientY - zone.getBoundingClientRect().top}px`;
    base.classList.add('on');
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    const d = Math.max(-RANGE, Math.min(RANGE, e.clientX - startX));
    touch.steer = d / RANGE;
    knob.style.transform = `translateX(${d}px)`;
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    steerId = -1;
    touch.steer = 0;
    knob.style.transform = '';
    base.classList.remove('on');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  // Item and ability: one press each.
  for (const btn of root.querySelectorAll<HTMLButtonElement>('.tb[data-b]')) {
    const which = btn.dataset.b as 'item' | 'ability';
    btn.addEventListener('pointerdown', (e) => {
      touch.used = true;
      touch[which] = true;
      btn.classList.add('down');
      e.preventDefault();
    });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Pedals: a finger holds whichever pedal it's over, and can slide from one to another.
  const pedals = [...root.querySelectorAll<HTMLButtonElement>('.tb[data-p]')];
  const pedalAt = (x: number, y: number): Pedal | null => {
    for (const b of pedals) {
      const r = b.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return b.dataset.p as Pedal;
    }
    return null;
  };
  const show = () => {
    const on = new Set(pedalFingers.values());
    for (const b of pedals) b.classList.toggle('down', on.has(b.dataset.p as Pedal));
  };
  const box = root.querySelector<HTMLElement>('.tbtns')!;
  for (const b of pedals) {
    b.addEventListener('pointerdown', (e) => {
      touch.used = true;
      b.releasePointerCapture?.(e.pointerId);
      box.setPointerCapture(e.pointerId);
      pedalFingers.set(e.pointerId, b.dataset.p as Pedal);
      syncPedals();
      show();
      e.preventDefault();
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  box.addEventListener('pointermove', (e) => {
    if (!pedalFingers.has(e.pointerId)) return;
    const p = pedalAt(e.clientX, e.clientY);
    if (p && p !== pedalFingers.get(e.pointerId)) {
      pedalFingers.set(e.pointerId, p);
      syncPedals();
      show();
    }
  });
  const lift = (e: PointerEvent) => {
    if (!pedalFingers.delete(e.pointerId)) return;
    syncPedals();
    show();
  };
  box.addEventListener('pointerup', lift);
  box.addEventListener('pointercancel', lift);
}

/** Let go of every touch pedal (e.g. when the race screen closes). */
export function releaseTouch(): void {
  pedalFingers.clear();
  syncPedals();
  touch.steer = 0;
}

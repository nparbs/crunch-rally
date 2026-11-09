// Keyboard, gamepad and touch, merged into one Input each frame.
// Phones get auto-gas, drag-to-steer on the left half, and big buttons on the right.

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

const touch = { steer: 0, drift: false, brake: false, item: false, ability: false, used: false };
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
      throttle = touch.brake ? -1 : 1;
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
  root.innerHTML = `
    <div class="steer-zone"><div class="steer-base"><div class="steer-knob"></div></div></div>
    <div class="tbtns">
      <button class="tb tb-ability" data-b="ability">★</button>
      <button class="tb tb-item" data-b="item">ITEM</button>
      <button class="tb tb-brake" data-b="brake">◀◀</button>
      <button class="tb tb-drift" data-b="drift">DRIFT</button>
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

  for (const btn of root.querySelectorAll<HTMLButtonElement>('.tb')) {
    const which = btn.dataset.b as 'drift' | 'brake' | 'item' | 'ability';
    btn.addEventListener('pointerdown', (e) => {
      touch.used = true;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('down');
      if (which === 'drift' || which === 'brake') touch[which] = true;
      else touch[which] = true;
      e.preventDefault();
    });
    const up = () => {
      btn.classList.remove('down');
      if (which === 'drift' || which === 'brake') touch[which] = false;
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

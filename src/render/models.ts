// Low-poly racer and item models built from primitives. No assets, everything is procedural.
import * as THREE from 'three';
import type { CharacterDef } from '../sim/characters';

export interface RacerModel {
  root: THREE.Group; // origin on ground at kart center, kart faces +Z
  body: THREE.Group; // kart + driver (tilt/yaw for drift and spin)
  driver: THREE.Group; // mascot only (bob/squash); origin is the seat top
  /** 4 wheel groups [FL, FR, RL, RR], rotation.order = 'YXZ': rotation.x = roll, rotation.y = steer (front only). */
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[]; // [FL, FR], same objects as wheels[0..1]
  exhaust: THREE.Object3D[]; // 2 empties just behind the exhaust pipe tips
}

type ItemKind = 'crate' | 'jawbreaker' | 'taffy' | 'butter' | 'espresso' | 'gum' | 'rocket' | 'flame' | 'puddle' | 'stink' | 'sugar';

export const ITEM_ICON_COLORS: Record<string, string> = {
  crate: '#ffc94a', jawbreaker: '#e8443a', taffy: '#ff7fb5', butter: '#ffe680', espresso: '#6b3e26',
  gum: '#ff8fc7', rocket: '#c0392b', flame: '#ff7a1a', puddle: '#9bbf2a', stink: '#b5c93a', sugar: '#ffd6ec',
};

// ---------- helpers ----------
type Mat = THREE.MeshStandardMaterial;
const PI = Math.PI;
const mat = (color: number | string, o: THREE.MeshStandardMaterialParameters = {}): Mat =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...o });
const glow = (color: number, i = 1, o: THREE.MeshStandardMaterialParameters = {}) => mat(color, { emissive: color, emissiveIntensity: i, ...o });
const ghost = (color: number, opacity: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  mat(color, { transparent: true, opacity, depthWrite: false, ...o });
const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const pick = <T,>(a: T[], i: number): T => a[((i % a.length) + a.length) % a.length] as T;

function put<T extends THREE.Object3D>(p: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T {
  o.position.set(x, y, z);
  p.add(o);
  return o;
}
function mesh(p: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true) {
  const me = new THREE.Mesh(geo, m);
  me.castShadow = shadow;
  return put(p, me, x, y, z);
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const polar = (r: number, deg: number, y: number): [number, number, number] => [r * Math.sin((deg * PI) / 180), y, r * Math.cos((deg * PI) / 180)];

/** Cartoon eyes (white sphere + black pupil) and a smile. mouthY is the top of the smile arc. */
function face(p: THREE.Object3D, y: number, z: number, spread: number, r: number, mouthY: number, mouthZ: number, mouthR = 0.09) {
  const w = mat(0xffffff, { roughness: 0.4 }), k = mat(0x111111, { roughness: 0.3 });
  const eg = sph(r), pg = sph(r * 0.55, 8);
  for (const s of [-1, 1]) {
    mesh(p, eg, w, s * spread, y, z);
    mesh(p, pg, k, s * spread, y - r * 0.05, z + r * 0.7, false);
  }
  const mo = mesh(p, new THREE.TorusGeometry(mouthR, 0.03, 5, 8, PI), mat(0x4a0d0d), 0, mouthY, mouthZ, false);
  mo.rotation.z = PI;
}

/** Cylinder limb between two points. */
function limb(p: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: Mat) {
  const d = b.clone().sub(a), len = d.length();
  const me = mesh(p, cyl(r, r, len, 6), m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len));
}

// ---------- drivers (local origin = seat top, face toward +Z) ----------
type DriverFn = (g: THREE.Group, d: CharacterDef) => void;

const DRIVERS: Record<string, DriverFn> = {
  hal(g, d) {
    const red = mat(d.color), white = mat(0xffffff), green = mat(0x2e9e3a);
    mesh(g, cyl(0.4, 0.4, 0.8), red, 0, 0.4, 0);
    mesh(g, cyl(0.15, 0.4, 0.3), red, 0, 0.95, 0);
    mesh(g, cyl(0.15, 0.15, 0.2, 10), red, 0, 1.2, 0);
    mesh(g, cyl(0.18, 0.18, 0.14, 10), green, 0, 1.37, 0);
    mesh(g, cyl(0.415, 0.415, 0.38), white, 0, 0.3, 0);
    const f1 = mesh(g, cone(0.12, 0.3, 5), glow(0xff7a1a, 0.5), 0, 0.3, 0.41);
    f1.scale.z = 0.3;
    const f2 = mesh(g, cone(0.06, 0.17, 5), glow(0xffd23f, 0.6), 0, 0.26, 0.43, false);
    f2.scale.z = 0.3;
    face(g, 0.7, 0.36, 0.15, 0.11, 0.56, 0.41);
  },
  dill(g, d) {
    const green = mat(d.color), dark = mat(darker(d.color, 0.7)), light = mat(d.accent);
    mesh(g, new THREE.CapsuleGeometry(0.38, 0.6, 5, 10), green, 0, 0.68, 0);
    for (const [a, y] of [[-70, 0.5], [60, 0.9], [-120, 1.15], [110, 0.4], [180, 0.7], [-40, 0.22], [20, 1.22]] as const) {
      mesh(g, sph(0.075, 7), dark, ...polar(0.39, a, y), false);
    }
    for (const [a, y] of [[-35, 0.35], [35, 0.5], [0, 0.22], [-60, 1.0], [55, 1.12]] as const) {
      mesh(g, sph(0.065, 7), light, ...polar(0.385, a, y), false);
    }
    face(g, 0.98, 0.32, 0.14, 0.11, 0.82, 0.39);
  },
  glaze(g, d) {
    const cy = 0.62;
    const dough = new THREE.TorusGeometry(0.4, 0.2, 8, 14);
    mesh(g, dough, mat(d.accent), 0, cy, 0);
    const frost = mesh(g, new THREE.TorusGeometry(0.4, 0.19, 8, 14), mat(d.color), 0, cy, 0.12);
    frost.scale.z = 0.6;
    const sg = box(0.11, 0.03, 0.03), cols = [0xff3b3b, 0xffd23f, 0x3bd1ff, 0x4cd964, 0xffffff, 0x9b59ff];
    const smats = cols.map((c) => mat(c, { roughness: 0.5 }));
    [0, 15, 75, 105, 165, 180, 195, 215, 325, 345].forEach((deg, i) => {
      const a = (deg * PI) / 180, r = 0.4 + (i % 2 ? 0.08 : -0.08);
      const s = mesh(g, sg, pick(smats, i), r * Math.cos(a), cy + r * Math.sin(a), 0.238, false);
      s.rotation.z = i * 1.7;
    });
    face(g, cy + 0.28, 0.24, 0.28, 0.09, cy - 0.38, 0.25, 0.08);
  },
  kernel(g, d) {
    const red = mat(d.color), cream = mat(d.accent);
    mesh(g, cyl(0.45, 0.32, 0.8, 20), red, 0, 0.4, 0);
    for (let i = 0; i < 10; i += 2) {
      const c = new THREE.CylinderGeometry(0.455, 0.324, 0.8, 2, 1, true, (i * 36 - 18) * (PI / 180), (36 * PI) / 180);
      mesh(g, c, mat(d.accent, { side: THREE.DoubleSide }), 0, 0.4, 0, false);
    }
    mesh(g, cyl(0.49, 0.46, 0.1, 20), cream, 0, 0.82, 0);
    const pop = [mat(0xfff3c4), mat(0xffe8a0)];
    [[0, 1.0, 0], [0.26, 0.97, 0.1], [-0.26, 0.97, 0.05], [0.12, 0.97, -0.28], [-0.16, 1.0, -0.26], [0.3, 0.95, -0.18], [-0.32, 0.95, -0.2], [0, 1.15, 0.05], [0.14, 1.18, -0.12]]
      .forEach(([x, y, z], i) => mesh(g, sph(0.2, 7), pick(pop, i), x, y, z));
    face(g, 0.55, 0.39, 0.15, 0.11, 0.4, 0.4);
  },
  brie(g, d) {
    const s = new THREE.Shape();
    s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0, 1.15); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false });
    geo.translate(0, 0, -0.3);
    mesh(g, geo, [mat(d.color), mat(d.accent)], 0, 0, 0);
    const hole = mat(darker(d.accent, 0.6)), hg = cyl(1, 1, 0.04, 8);
    for (const [x, y, r] of [[-0.33, 0.13, 0.1], [0.3, 0.2, 0.07], [0, 0.85, 0.05], [0.22, 0.04, 0.05]] as const) {
      const h = mesh(g, hg, hole, x, y, 0.3, false);
      h.rotation.x = PI / 2;
      h.scale.set(r, 1, r);
    }
    face(g, 0.58, 0.3, 0.13, 0.09, 0.4, 0.31, 0.08);
  },
  fizz(g, d) {
    const blue = mat(d.color, { roughness: 0.4 }), silver = mat(d.accent, { roughness: 0.3, metalness: 0.6 });
    mesh(g, cyl(0.36, 0.36, 0.9, 14), blue, 0, 0.45, 0);
    mesh(g, cyl(0.3, 0.36, 0.1, 14), silver, 0, 0.95, 0);
    mesh(g, cyl(0.3, 0.3, 0.04, 14), silver, 0, 1.02, 0);
    mesh(g, box(0.2, 0.02, 0.1), silver, 0, 1.05, 0.05, false);
    const ring = mesh(g, new THREE.TorusGeometry(0.05, 0.015, 4, 8), silver, 0, 1.06, -0.05, false);
    ring.rotation.x = PI / 2;
    const sw = mesh(g, new THREE.CylinderGeometry(0.385, 0.385, 0.1, 14, 1, true, -0.8, 1.6), mat(0xffffff, { side: THREE.DoubleSide }), 0, 0.28, 0, false);
    sw.rotation.z = 0.4;
    face(g, 0.72, 0.33, 0.14, 0.1, 0.56, 0.355);
  },
  gummo(g, d) {
    const gum = mat(d.color, { transparent: true, opacity: 0.88, emissive: d.color, emissiveIntensity: 0.35, roughness: 0.3 });
    const light = mat(d.accent, { transparent: true, opacity: 0.9, emissive: d.accent, emissiveIntensity: 0.3 });
    const body = mesh(g, sph(0.42, 12), gum, 0, 0.5, 0);
    body.scale.y = 0.95;
    const belly = mesh(g, sph(0.26, 8), light, 0, 0.5, 0.36, false);
    belly.scale.z = 0.35;
    mesh(g, sph(0.34, 12), gum, 0, 1.05, 0);
    for (const s of [-1, 1]) {
      mesh(g, sph(0.12, 8), gum, s * 0.24, 1.34, -0.02);
      mesh(g, sph(0.06, 6), light, s * 0.24, 1.34, 0.07, false);
      mesh(g, sph(0.17, 8), gum, s * 0.26, 0.15, 0.22);
    }
    mesh(g, sph(0.16, 9), light, 0, 0.97, 0.28, false);
    mesh(g, sph(0.05, 6), mat(0x3a1a05), 0, 1.07, 0.43, false);
    face(g, 1.15, 0.29, 0.14, 0.09, 0.97, 0.43, 0.07);
  },
  brock(g, d) {
    const stalk = mat(d.accent), dk = mat(d.color), lt = mat(0x3fae4a);
    mesh(g, cyl(0.26, 0.3, 0.7, 10), stalk, 0, 0.35, 0);
    mesh(g, sph(0.38, 9), dk, 0, 1.0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i * PI) / 3 + 0.3;
      mesh(g, sph(0.24, 7), i % 2 ? lt : dk, Math.sin(a) * 0.34, 0.92, Math.cos(a) * 0.34);
    }
    for (const [x, z] of [[0.12, 0.08], [-0.15, 0.0], [0.02, -0.16]] as const) mesh(g, sph(0.2, 7), pick([lt, dk], x > 0 ? 0 : 1), x, 1.24, z);
    face(g, 0.48, 0.26, 0.11, 0.08, 0.35, 0.3, 0.07);
    const gl = mat(0x222222), rg = new THREE.TorusGeometry(0.12, 0.02, 5, 12);
    for (const s of [-1, 1]) mesh(g, rg, gl, s * 0.11, 0.48, 0.33, false);
    mesh(g, box(0.06, 0.02, 0.02), gl, 0, 0.48, 0.33, false);
  },
};

// ---------- racer ----------
export function buildRacer(def: CharacterDef): RacerModel {
  const root = new THREE.Group();
  const body = put(root, new THREE.Group());
  const driver = put(body, new THREE.Group(), 0, 0.5, -0.25);
  const paint = mat(def.kart), acc = mat(def.accent), dark = mat(0x2a2a2e), steel = mat(0x9a9a9a, { metalness: 0.5, roughness: 0.4 });

  // chassis
  mesh(body, box(1.0, 0.2, 2.1), paint, 0, 0.3, 0);
  mesh(body, box(0.84, 0.28, 0.8), paint, 0, 0.54, 0.62);
  mesh(body, box(0.16, 0.03, 0.8), acc, 0, 0.695, 0.62, false);
  for (const s of [-1, 1]) mesh(body, box(0.12, 0.3, 1.0), paint, s * 0.5, 0.5, -0.15);
  mesh(body, box(0.9, 0.5, 0.5), dark, 0, 0.65, -0.85);
  mesh(body, box(0.74, 0.5, 0.12), paint, 0, 0.72, -0.55);
  mesh(body, box(0.7, 0.1, 0.7), dark, 0, 0.45, -0.2);
  mesh(body, box(1.3, 0.16, 0.14), acc, 0, 0.36, 1.17);
  const lamp = glow(0xfff2a8, 0.8), lg = sph(0.08, 7);
  for (const s of [-1, 1]) mesh(body, lg, lamp, s * 0.3, 0.56, 1.03, false);

  // steering wheel + column
  const sw = mesh(body, new THREE.TorusGeometry(0.17, 0.03, 6, 12), dark, 0, 1.0, 0.5);
  sw.rotation.x = 0.9;
  const col = mesh(body, cyl(0.03, 0.03, 0.4, 6), dark, 0, 0.845, 0.625);
  col.rotation.x = -0.67;

  // exhaust
  const exhaust: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pipe = mesh(body, cyl(0.07, 0.07, 0.3, 8), steel, s * 0.28, 0.5, -1.2);
    pipe.rotation.x = PI / 2;
    exhaust.push(put(body, new THREE.Object3D(), s * 0.28, 0.5, -1.38));
  }

  // wheels: group (roll = rotation.x, steer = rotation.y, order YXZ) holding tire, hub, spoke plate
  const tg = cyl(0.36, 0.36, 0.3, 10), hg = cyl(0.2, 0.2, 0.34, 10), pg = box(0.38, 0.07, 0.34);
  const tire = mat(0x1c1c1c, { roughness: 0.9 }), hub = mat(0xd0d0d0, { metalness: 0.3 }), plate = mat(0x555555);
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const w = put(body, new THREE.Group(), x * 0.66, 0.36, z * 0.72);
    w.rotation.order = 'YXZ';
    mesh(w, tg, tire).rotation.z = PI / 2;
    mesh(w, hg, hub, 0, 0, 0, false).rotation.z = PI / 2;
    mesh(w, pg, plate, 0, 0, 0, false);
    wheels.push(w);
  }
  for (const z of [0.72, -0.72]) {
    const ax = mesh(body, cyl(0.05, 0.05, 1.3, 6), dark, 0, 0.36, z, false);
    ax.rotation.z = PI / 2;
  }

  // driver + arms to the wheel
  (DRIVERS[def.id] ?? DRIVERS.hal as DriverFn)(driver, def);
  const armM = mat(def.color), glove = mat(0xffffff, { roughness: 0.5 }), hg2 = sph(0.085, 8);
  for (const s of [-1, 1]) {
    const hand = new THREE.Vector3(s * 0.17, 0.5, 0.75);
    limb(driver, new THREE.Vector3(s * 0.34, 0.58, 0.05), hand, 0.06, armM);
    mesh(driver, hg2, glove, hand.x, hand.y, hand.z, false);
  }

  return { root, body, driver, wheels, frontWheels: [wheels[0] as THREE.Object3D, wheels[1] as THREE.Object3D], exhaust };
}

// ---------- items ----------
function starGeo(outer: number, inner: number, pts: number, depth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i * PI) / pts + PI / 2, r = i % 2 ? inner : outer;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

const ITEMS: Record<ItemKind, (g: THREE.Group) => void> = {
  // centered on its origin, ~1.6 m
  crate(g) {
    mesh(g, box(1.5, 1.5, 1.5), ghost(0xfff0b0, 0.5, { emissive: 0xffc94a, emissiveIntensity: 0.35 }), 0, 0, 0, false);
    let i = 0;
    const edge = (w: number, h: number, d: number, x: number, y: number, z: number) =>
      mesh(g, box(w, h, d), mat(new THREE.Color().setHSL((i++ % 12) / 12, 0.85, 0.55).getHex()), x, y, z);
    for (const a of [-0.75, 0.75]) for (const b of [-0.75, 0.75]) {
      edge(1.6, 0.12, 0.12, 0, a, b); edge(0.12, 1.6, 0.12, a, 0, b); edge(0.12, 0.12, 1.6, a, b, 0);
    }
    const star = starGeo(0.5, 0.22, 5, 0.04), disc = cyl(0.6, 0.6, 0.04, 14);
    const cookie = mat(0xd9a25a), white = glow(0xffffff, 0.4);
    const faces: [number, number, number, number, number][] = [
      [0, 0, 0.75, 0, 0], [0, 0, -0.75, PI, 0], [0.75, 0, 0, 0, PI / 2], [-0.75, 0, 0, 0, -PI / 2], [0, 0.75, 0, -PI / 2, 0], [0, -0.75, 0, PI / 2, 0],
    ];
    for (const [x, y, z, rx, ry] of faces) {
      const f = put(g, new THREE.Group(), x, y, z);
      f.rotation.set(rx, ry, 0);
      mesh(f, disc, cookie, 0, 0, 0.0, false).rotation.x = PI / 2;
      mesh(f, star, white, 0, 0, 0.04, false);
    }
  },
  jawbreaker(g) {
    const cols = [0xe8443a, 0xffd23f, 0xffffff, 0x2f7be0, 0x4cd964, 0xff7fb5], n = cols.length;
    const ball = put(g, new THREE.Group(), 0, 0.5, 0);
    ball.rotation.z = 0.5;
    cols.forEach((c, i) => mesh(ball, new THREE.SphereGeometry(0.5, 16, 8, 0, PI * 2, (i * PI) / n, PI / n), mat(c, { flatShading: false, roughness: 0.15, metalness: 0.05 }), 0, 0, 0, i === 0));
  },
  // homing missile: long axis along Z, flies toward +Z
  taffy(g) {
    const c = put(g, new THREE.Group(), 0, 0.45, 0);
    const pink = mat(0xff7fb5, { roughness: 0.4 }), white = mat(0xffffff, { roughness: 0.4 });
    mesh(c, new THREE.CapsuleGeometry(0.3, 0.7, 4, 10), pink).rotation.x = PI / 2;
    const rg = new THREE.TorusGeometry(0.31, 0.04, 5, 12);
    for (const z of [-0.3, 0, 0.3]) mesh(c, rg, white, 0, 0, z, false);
    for (const s of [-1, 1]) {
      const w = put(c, new THREE.Group(), 0, 0, s * 0.85);
      w.rotation.z = s * 0.6;
      const fan = mesh(w, cone(0.32, 0.5, 4), s > 0 ? white : pink, 0, 0, s * 0.1);
      fan.rotation.x = -s * PI / 2;
      fan.scale.x = 1.4;
      fan.scale.z = 0.35;
    }
  },
  // flat trap, ~1.6 m across
  butter(g) {
    const blue = mat(0x3a7bd5, { roughness: 0.3 });
    mesh(g, cyl(0.8, 0.7, 0.08, 16), blue, 0, 0.04, 0);
    mesh(g, new THREE.TorusGeometry(0.76, 0.05, 5, 16), mat(0x7fb0f0, { roughness: 0.3 }), 0, 0.09, 0).rotation.x = PI / 2;
    mesh(g, box(0.9, 0.28, 0.55), mat(0xffd84a, { roughness: 0.4 }), 0, 0.22, 0);
    mesh(g, box(0.82, 0.08, 0.48), mat(0xffee9a, { roughness: 0.4 }), 0, 0.38, 0, false);
    mesh(g, cyl(0.2, 0.22, 0.02, 8), mat(0xffd84a), 0.55, 0.09, 0.25, false);
  },
  espresso(g) {
    const white = mat(0xffffff, { roughness: 0.3 });
    mesh(g, cyl(0.45, 0.4, 0.05, 14), white, 0, 0.025, 0);
    mesh(g, cyl(0.3, 0.2, 0.32, 12), white, 0, 0.21, 0);
    mesh(g, cyl(0.26, 0.26, 0.02, 12), mat(0x3a1c0e, { roughness: 0.3 }), 0, 0.36, 0, false);
    mesh(g, new THREE.TorusGeometry(0.1, 0.035, 5, 10), white, 0.32, 0.22, 0);
  },
  // translucent shield bubble ~2.8 m, centered 0.9 above the origin
  gum(g) {
    mesh(g, new THREE.SphereGeometry(1.4, 18, 14), ghost(0xff8fc7, 0.35, { flatShading: false, emissive: 0xff5fa8, emissiveIntensity: 0.25, roughness: 0.2 }), 0, 0.9, 0, false);
  },
  // cola-bottle rocket lying along +Z, ~2 m long, centered at y 0.5
  rocket(g) {
    const r = put(g, new THREE.Group(), 0, 0.5, -0.95);
    r.rotation.x = PI / 2;
    const prof = [[0, 0], [0.35, 0.05], [0.38, 0.2], [0.38, 0.9], [0.3, 1.2], [0.17, 1.4], [0.15, 1.7]].map(([x, y]) => new THREE.Vector2(x, y));
    mesh(r, new THREE.LatheGeometry(prof, 12), mat(0x4a2214, { roughness: 0.3, side: THREE.DoubleSide }));
    mesh(r, cyl(0.39, 0.39, 0.4), mat(0xffffff), 0, 0.55, 0, false);
    mesh(r, cyl(0.17, 0.17, 0.15, 10), mat(0xd7261e), 0, 1.77, 0);
    mesh(r, cone(0.19, 0.3, 10), mat(0xd7261e), 0, 1.95, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * PI) / 3, f = mesh(r, box(0.05, 0.45, 0.3), mat(0xd7261e), Math.sin(a) * 0.4, 0.22, Math.cos(a) * 0.4);
      f.rotation.y = a;
    }
  },
  // ground hazard ~1.2 m tall
  flame(g) {
    const o = glow(0xff6a10, 1, { transparent: true, opacity: 0.9 });
    mesh(g, cone(0.4, 1.2, 6), o, 0, 0.6, 0, false);
    mesh(g, cone(0.3, 0.8, 6), o, -0.3, 0.4, 0.05, false);
    mesh(g, cone(0.28, 0.7, 6), o, 0.3, 0.35, -0.05, false);
    mesh(g, cone(0.22, 0.8, 6), glow(0xffd23f, 1.2), 0, 0.4, 0.1, false);
  },
  // radius 1, y just above ground
  puddle(g) {
    const d = mesh(g, new THREE.CircleGeometry(1, 20), ghost(0x9bbf2a, 0.75, { roughness: 0.2 }), 0, 0.06, 0, false);
    d.rotation.x = -PI / 2;
    const d2 = mesh(g, new THREE.CircleGeometry(0.6, 14), ghost(0xd2e04a, 0.6, { roughness: 0.2 }), 0.1, 0.065, -0.05, false);
    d2.rotation.x = -PI / 2;
  },
  // ~1 unit radius cloud, sitting on the ground
  stink(g) {
    const m = ghost(0xb5c93a, 0.55, { flatShading: false });
    [[0, 0.6, 0, 0.5], [0.5, 0.45, 0.2, 0.4], [-0.5, 0.45, 0.15, 0.42], [0.2, 0.5, -0.5, 0.4], [-0.25, 0.5, -0.45, 0.38], [0.1, 0.95, 0.1, 0.4], [-0.2, 0.9, 0.3, 0.3], [0.35, 0.85, -0.2, 0.3]]
      .forEach(([x, y, z, r]) => mesh(g, sph(r as number, 9), m, x, y, z, false));
  },
  // sparkly burst aura, centered 0.8 above the origin
  sugar(g) {
    const c = put(g, new THREE.Group(), 0, 0.8, 0);
    const w = glow(0xffffff, 0.8), p = glow(0xff8fc7, 0.8);
    mesh(c, sph(0.22, 8), w, 0, 0, 0, false);
    const sp = cone(0.12, 0.8, 4);
    for (let i = 0; i < 8; i++) {
      const a = (i * PI) / 4, s = mesh(c, sp, i % 2 ? p : w, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0, false);
      s.rotation.z = a - PI / 2;
      if (i % 2) s.scale.y = 0.7;
    }
    for (const s of [-1, 1]) {
      const t = mesh(c, sp, p, 0, 0, s * 0.5, false);
      t.rotation.x = s * PI / 2;
    }
  },
};

export function buildItem(kind: ItemKind): THREE.Object3D {
  const g = new THREE.Group();
  ITEMS[kind](g);
  return g;
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
  });
}

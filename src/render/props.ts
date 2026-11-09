// Decorative scenery around the track. Everything static is merged into a few vertex-colored
// meshes so the whole thing costs about 10-20 draw calls. Placement is deterministic per track id.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash3(a: number, b: number, c: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

type V3 = [number, number, number];
type Scale = number | V3;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

function local(pos: V3, rot: V3, scale: Scale, order: THREE.EulerOrder): THREE.Matrix4 {
  _p.set(pos[0], pos[1], pos[2]);
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], order));
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Collects transformed, vertex-colored geometry and merges it into one mesh. */
class Batch {
  geos: THREE.BufferGeometry[] = [];
  base = new THREE.Matrix4();

  at(x: number, z: number, yaw = 0, s = 1, y = 0): this {
    _p.set(x, y, z);
    _q.setFromAxisAngle(_up, yaw);
    _s.set(s, s, s);
    this.base.compose(_p, _q, _s);
    return this;
  }

  add(
    geo: THREE.BufferGeometry,
    color: number,
    pos: V3 = [0, 0, 0],
    rot: V3 = [0, 0, 0],
    scale: Scale = 1,
    order: THREE.EulerOrder = 'XYZ',
  ): this {
    return this.addM(geo, color, local(pos, rot, scale, order));
  }

  addM(geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4): this {
    let g = geo.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.base, m));
    if (g.index) g = g.toNonIndexed();
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.geos.push(g);
    return this;
  }

  build(material: THREE.Material, shadow = false): THREE.Mesh | null {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = shadow;
    return mesh;
  }
}

/** Instanced mesh with per-instance transform and color. */
class Inst {
  mesh: THREE.InstancedMesh;
  i = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
  }
  add(pos: V3, rot: V3, scale: Scale, color: number, order: THREE.EulerOrder = 'XYZ'): void {
    if (this.i >= this.max) return;
    this.mesh.setMatrixAt(this.i, local(pos, rot, scale, order));
    this.mesh.setColorAt(this.i, new THREE.Color(color));
    this.i++;
  }
  done(): THREE.InstancedMesh | null {
    if (!this.i) return null;
    this.mesh.count = this.i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return this.mesh;
  }
}

interface SceneryData {
  clouds: THREE.Object3D[];
  ants: THREE.Object3D[];
  glow: THREE.MeshStandardMaterial | null;
}

export function buildScenery(track: Track): THREE.Group {
  const def = track.def;
  const th = def.theme;
  const rnd = mulberry32(hashStr(def.id));
  const R = (a: number, b: number) => a + (b - a) * rnd();
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length) % a.length];

  const group = new THREE.Group();
  group.name = 'scenery';
  const ud: SceneryData = { clouds: [], ants: [], glow: null };
  group.userData = ud as unknown as Record<string, unknown>;

  // ---- materials (cached) ----
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (key: string, make: () => THREE.MeshStandardMaterial) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = make()));
    return m;
  };
  const vcMat = mat('vc', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  const flatMat = mat(
    'flat',
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
  );
  const whiteInst = mat('white', () => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }));

  // ---- road clearance ----
  const n = track.n;
  const kill: boolean[] = [];
  for (let i = 0; i < n; i++) kill.push(track.edge[i] === 'kill');
  const roadClear = (x: number, z: number, r: number): boolean => {
    for (let i = 0; i < n; i++) {
      const lim = track.w[i] / 2 + 14 + r + (kill[i] ? 32 : 0);
      const dx = x - track.x[i], dz = z - track.z[i];
      if (dx * dx + dz * dz < lim * lim) return false;
    }
    return true;
  };
  const circles: V3[] = [];
  const free = (x: number, z: number, r: number): boolean => {
    for (const c of circles) {
      const dx = x - c[0], dz = z - c[1], rr = r + c[2];
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  };
  /** Reserve a spot if it is off the road and not on top of another prop. */
  const place = (x: number, z: number, r: number): boolean => {
    if (!free(x, z, r) || !roadClear(x, z, r)) return false;
    circles.push([x, z, r]);
    return true;
  };
  const scatter = (count: number, x0: number, x1: number, z0: number, z1: number, rad: (() => number) | number, cb: (x: number, z: number, r: number) => void, reserve = true) => {
    let got = 0;
    for (let tries = 0; tries < count * 25 && got < count; tries++) {
      const x = R(x0, x1), z = R(z0, z1);
      const r = typeof rad === 'number' ? rad : rad();
      const ok = reserve ? place(x, z, r) : free(x, z, r) && roadClear(x, z, r);
      if (!ok) continue;
      got++;
      cb(x, z, r);
    }
  };

  const solid = new Batch();
  const shaded = new Batch(); // casts shadows
  const flat = new Batch(); // 1 cm decals
  const glowB = new Batch();
  const finish = () => {
    const a = solid.build(vcMat);
    const b = shaded.build(vcMat, true);
    const c = flat.build(flatMat);
    if (a) group.add(a);
    if (b) group.add(b);
    if (c) group.add(c);
    if (ud.glow) {
      const d = glowB.build(ud.glow);
      if (d) group.add(d);
    }
  };

  // ---- shared geometries ----
  const ico0 = new THREE.IcosahedronGeometry(1, 0);
  const ico1 = new THREE.IcosahedronGeometry(1, 1);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl10 = new THREE.CylinderGeometry(1, 1, 1, 10);
  const plane = new THREE.PlaneGeometry(1, 1);

  if (th.props === 'picnic') buildPicnic();
  else buildNacho();
  finish();
  return group;

  // =====================================================================================
  function buildPicnic() {
    const C = { x: 35, z: 98 };
    const yaw = 0.15;
    const green = [0x3fa83a, 0x4cbb44, 0x34993a, 0x58c24a];

    // Blanket: gingham, 1 cm above ground.
    const cell = 4, cols = 13, rows = 11;
    flat.at(C.x, C.z, yaw, 1, 0.01);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const col = (i + j) % 2 === 0 ? th.curbA : th.curbB;
        flat.add(plane, col, [(i - (cols - 1) / 2) * cell, 0, (j - (rows - 1) / 2) * cell], [-Math.PI / 2, 0, 0], cell);
      }
    circles.push([C.x, C.z, 34]);

    // Giant basket.
    shaded.at(C.x - 15, C.z - 6, 0.35);
    shaded.add(box, 0xb77a3a, [0, 3, 0], [0, 0, 0], [11, 6, 8]);
    shaded.add(box, 0x93601f, [0, 1.2, 0], [0, 0, 0], [11.3, 0.8, 8.3]);
    shaded.add(box, 0x93601f, [0, 4.6, 0], [0, 0, 0], [11.3, 0.8, 8.3]);
    shaded.add(box, 0xc68a47, [-2.9, 6.3, 0], [0, 0, 0.45], [6, 0.7, 8.4]);
    shaded.add(box, 0xc68a47, [2.9, 6.3, 0], [0, 0, -0.45], [6, 0.7, 8.4]);
    shaded.add(new THREE.TorusGeometry(1, 0.1, 5, 12, Math.PI), 0x6e4515, [0, 6.6, 0], [0, 0, 0], [3.4, 5, 3.4]);

    // Paper cups with straws.
    const cupBody = new THREE.CylinderGeometry(3.4, 2.4, 8, 10);
    const cupBand = new THREE.CylinderGeometry(3.17, 2.73, 2.4, 10);
    const cupLid = new THREE.CylinderGeometry(3.6, 3.5, 0.7, 10);
    const straw = new THREE.CylinderGeometry(0.3, 0.3, 7, 5);
    for (const [dx, dz, c] of [[14, -9, 0xe8443a], [0, -14, 0x3a8be8], [20, 4, 0xffa21f]] as [number, number, number][]) {
      shaded.at(C.x + dx, C.z + dz, R(0, 6));
      shaded.add(cupBody, c, [0, 4, 0]);
      shaded.add(cupBand, 0xfff6e8, [0, 4, 0]);
      shaded.add(cupLid, 0xfff6e8, [0, 8.3, 0]);
      shaded.add(straw, 0xffd23f, [0.6, 11.5, 0], [0, 0, 0.18]);
    }

    // Sandwich.
    shaded.at(C.x + 6, C.z + 10, 0.5);
    shaded.add(box, 0xe3b866, [0, 0.9, 0], [0, 0, 0], [12, 1.8, 12]);
    shaded.add(box, 0x6fbf4a, [0, 2.1, 0], [0, 0.2, 0], [12.8, 0.6, 12.8]);
    shaded.add(cyl10, 0xe8443a, [-2.5, 2.8, 2], [0, 0, 0], [3.2, 0.7, 3.2]);
    shaded.add(cyl10, 0xe8443a, [3, 2.8, -2.5], [0, 0, 0], [3.2, 0.7, 3.2]);
    shaded.add(box, 0xffd23f, [0, 3.5, 0], [0, 0.78, 0], [11.6, 0.7, 11.6]);
    shaded.add(box, 0xf2a0a0, [0, 4.1, 0], [0, 0.1, 0], [11.4, 0.6, 11.4]);
    shaded.add(box, 0xe3b866, [0, 5.6, 0], [0, 0, 0], [12, 2.4, 12]);
    shaded.add(box, 0xc99646, [0, 6.9, 0], [0, 0, 0], [11, 0.4, 11]);

    // Watermelon slices (half discs standing on their flat edge).
    const mel = (r: number, t: number) => new THREE.CylinderGeometry(r, r, t, 12, 1, false, 0, Math.PI);
    const melG = mel(6, 2.2), melW = mel(5.6, 2.24), melR = mel(5.2, 2.28);
    const seed = new THREE.BoxGeometry(0.5, 0.2, 0.9);
    for (const [dx, dz, a] of [[-6, 14, 0.2], [14, 15, -0.5], [-24, 8, 1.0]] as [number, number, number][]) {
      shaded.at(C.x + dx, C.z + dz, a);
      shaded.add(melG, 0x2f8f3a, [0, 0, 0], [Math.PI / 2, 0, Math.PI / 2], 1, 'ZYX');
      shaded.add(melW, 0xe8f5d0, [0, 0, 0], [Math.PI / 2, 0, Math.PI / 2], 1, 'ZYX');
      shaded.add(melR, 0xf0384e, [0, 0, 0], [Math.PI / 2, 0, Math.PI / 2], 1, 'ZYX');
      for (const side of [1, -1])
        for (const [sx, sy] of [[1.5, 1.6], [3, 2.2], [2.2, 3.4], [0.6, 3.6]] as [number, number][])
          shaded.add(seed, 0x20141a, [sy, sx - 0.0, side * 1.18], [0, 0, 0.2], 1);
    }

    // Ants.
    const antGeo = () => {
      const b = new Batch();
      const dark = 0x2b1a12, mid = 0x3d2418;
      b.add(ico1, dark, [-2.7, 1.9, 0], [0, 0, 0], [2.4, 1.7, 1.7]);
      b.add(ico1, mid, [0.1, 1.8, 0], [0, 0, 0], [1.3, 1.2, 1.2]);
      b.add(ico1, dark, [2.2, 2.1, 0], [0, 0, 0], [1.3, 1.2, 1.3]);
      for (let k = 0; k < 3; k++)
        for (const side of [1, -1]) {
          b.add(box, mid, [-0.5 + k * 0.9, 1.0, side * 1.5], [-side * 0.7, 0, 0], [0.22, 0.22, 3]);
        }
      for (const side of [1, -1]) b.add(box, mid, [3.2, 3.2, side * 0.6], [0, 0, 0.7], [1.9, 0.15, 0.15]);
      return b.build(vcMat);
    };
    for (const [dx, dz, a] of [[-2, 3, 2.4], [-10, 9, 0.6], [24, 12, 4.0], [4, 22, 1.5], [-22, -12, 5.2]] as [number, number, number][]) {
      const ant = antGeo();
      if (!ant) continue;
      ant.name = 'ant';
      ant.scale.setScalar(1.5);
      ant.position.set(C.x + dx, 0.03, C.z + dz);
      ant.rotation.y = a;
      ant.userData = { by: a, ph: R(0, 6.28) };
      ant.castShadow = true;
      ud.ants.push(ant);
      group.add(ant);
    }

    // Lollipop trees.
    const trunk = new THREE.CylinderGeometry(1.0, 1.5, 7, 6);
    const crown = new THREE.IcosahedronGeometry(1, 1);
    let treeCount = 0;
    for (let tries = 0; tries < 1200 && treeCount < 62; tries++) {
      const s = R(0.8, 1.6);
      const x = R(-240, 320), z = R(-160, 380);
      if (!place(x, z, 6.5 * s)) continue;
      treeCount++;
      shaded.at(x, z, R(0, 6.28), s);
      shaded.add(trunk, 0x5a3a22, [0, 3.5, 0]);
      shaded.add(crown, pick(green), [0, 12.5, 0], [0, R(0, 3), 0], [6, 5.6, 6]);
    }

    // Flowers, in clusters.
    const flowerHead = new Inst(ico0, whiteInst, 360);
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 4);
    const stems = new Inst(stemGeo, whiteInst, 360);
    const petals = [0xff5a8a, 0xffd23f, 0xffffff, 0xb06cff, 0xff8a3a];
    for (let c = 0; c < 28; c++) {
      const cx = R(-230, 320), cz = R(-160, 380);
      const col = pick(petals);
      for (let k = 0; k < 12; k++) {
        const x = cx + R(-9, 9), z = cz + R(-9, 9);
        if (!free(x, z, 1) || !roadClear(x, z, 1.5)) continue;
        const h = R(2.5, 4.2);
        stems.add([x, h / 2, z], [0, 0, 0], [1, h, 1], 0x3a9a3a);
        flowerHead.add([x, h + 0.3, z], [R(0, 3), R(0, 3), 0], R(0.9, 1.4), rnd() < 0.8 ? col : pick(petals));
      }
    }
    const fh = flowerHead.done(), st = stems.done();
    if (fh) group.add(fh);
    if (st) group.add(st);

    // Grass tufts.
    const tuftGeo = new THREE.ConeGeometry(0.8, 2.6, 4);
    tuftGeo.translate(0, 1.3, 0);
    const tufts = new Inst(tuftGeo, whiteInst, 340);
    scatter(340, -230, 320, -160, 380, 1, (x, z) => {
      tufts.add([x, 0, z], [0, R(0, 6), 0], [R(0.8, 1.6), R(0.8, 1.8), R(0.8, 1.6)], pick([0x4cb43f, 0x5fc84a, 0x3c9a38]));
    }, false);
    const tm = tufts.done();
    if (tm) group.add(tm);

    // Horizon hills.
    const hill = new THREE.SphereGeometry(1, 9, 5);
    const hills = [0x78c85a, 0x6ab84f, 0x86d066, 0x70c25a];
    const HC = { x: 40, z: 100 };
    const nh = 18;
    for (let k = 0; k < nh; k++) {
      const a = (k / nh) * Math.PI * 2 + R(-0.12, 0.12);
      const d = R(420, 580);
      const ry = R(35, 85);
      solid.at(HC.x + Math.cos(a) * d, HC.z + Math.sin(a) * d, R(0, 6));
      solid.add(hill, pick(hills), [0, -ry * 0.25, 0], [0, 0, 0], [R(90, 170), ry, R(90, 170)]);
    }

    // Clouds.
    for (let k = 0; k < 3; k++) {
      const b = new Batch();
      const puffs = 5 + Math.floor(rnd() * 3);
      const sz = R(0.8, 1.3);
      for (let p = 0; p < puffs; p++)
        b.add(ico1, 0xffffff, [(p - puffs / 2) * 14 * sz + R(-4, 4), R(-3, 5), R(-8, 8)], [0, R(0, 3), 0], [R(12, 20) * sz, R(8, 12) * sz, R(11, 16) * sz]);
      const cm = b.build(mat('cloud', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: 0x666666 })));
      if (!cm) continue;
      cm.name = 'cloud';
      const bx = R(-500, 500);
      cm.position.set(bx, R(80, 120), R(-100, 350));
      cm.userData = { bx, sp: R(1.5, 3.5) };
      ud.clouds.push(cm);
      group.add(cm);
    }
  }

  // =====================================================================================
  function buildNacho() {
    const V = { x: -20, z: -200 };
    circles.push([V.x, V.z, 85]);

    // Volcano.
    const cone = new THREE.CylinderGeometry(12, 70, 60, 16, 4, true);
    cone.translate(0, 30, 0);
    {
      const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.9 + 0.2 * hash3(Math.round(x * 10), Math.round(y), Math.round(z * 10));
        p.setXYZ(i, x * k, y > 0.5 && y < 59.5 ? y + (hash3(Math.round(x), y, Math.round(z)) - 0.5) * 5 : y, z * k);
      }
      cone.computeVertexNormals();
    }
    solid.at(V.x, V.z);
    solid.add(cone, 0x7a4a34);
    solid.add(new THREE.CylinderGeometry(13.5, 14, 2, 16), 0x4a2a20, [0, 59.4, 0]);

    ud.glow = mat('glow', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, color: 0xffffff, emissive: 0xff3a0c, emissiveIntensity: 1.1, roughness: 0.6 }));
    glowB.at(V.x, V.z);
    glowB.add(new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xff6a1c, [0, 59.9, 0], [0, 0, 0], [11.8, 4, 11.8]);
    // Salsa drips running down the slope.
    const nd = 8;
    for (let k = 0; k < nd; k++) {
      const th2 = (k / nd) * Math.PI * 2 + R(-0.3, 0.3);
      const L = R(16, 40), wd = R(1.8, 3.2);
      const c = Math.cos(th2), s = Math.sin(th2);
      const d = new THREE.Vector3(58 * c, -60, 58 * s).normalize();
      const nrm = new THREE.Vector3(60 * c, 58, 60 * s).normalize();
      const center = new THREE.Vector3(12 * c, 60, 12 * s).addScaledVector(d, L / 2 + 1).addScaledVector(nrm, 0.45);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, d.clone().negate());
      const col = pick([0xff4a14, 0xff6a1c, 0xe8321c]);
      glowB.addM(box, col, new THREE.Matrix4().compose(center, q, new THREE.Vector3(wd, L, 0.6)));
      const end = center.clone().addScaledVector(d, L / 2);
      glowB.addM(ico1, col, new THREE.Matrix4().compose(end, q, new THREE.Vector3(wd * 0.75, wd * 0.6, 0.8)));
    }

    // Hazy mountain ring.
    const haze = new THREE.Color(th.fog).lerp(new THREE.Color(0xa0603c), 0.4).getHex();
    const hazeB = new THREE.Color(th.fog).lerp(new THREE.Color(0xb87a50), 0.3).getHex();
    const mtn = new THREE.ConeGeometry(1, 1, 6, 1);
    mtn.translate(0, 0.5, 0);
    {
      const p = mtn.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.8 + 0.4 * hash3(Math.round(x * 20), Math.round(y * 5), Math.round(z * 20));
        p.setXYZ(i, x * k, y, z * k);
      }
      mtn.computeVertexNormals();
    }
    const MC = { x: 20, z: -15 };
    const nm = 22;
    for (let k = 0; k < nm; k++) {
      const a = (k / nm) * Math.PI * 2 + R(-0.1, 0.1);
      const d = R(520, 640);
      solid.at(MC.x + Math.cos(a) * d, MC.z + Math.sin(a) * d, R(0, 6));
      const r = R(70, 140);
      solid.add(mtn, k % 2 ? haze : hazeB, [0, -4, 0], [0, 0, 0], [r, R(60, 130), r]);
    }

    // Tortilla chips stuck in the ground.
    const chipGeo = new THREE.CylinderGeometry(1, 1, 0.12, 3, 1);
    {
      const p = chipGeo.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0.9) p.setY(i, p.getY(i) + 0.25);
      chipGeo.computeVertexNormals();
    }
    const chips = new Inst(chipGeo, whiteInst, 48);
    scatter(44, -260, 300, -280, 220, () => R(3.5, 7.5), (x, z, r) => {
      const tilt = R(0.95, 1.35);
      chips.add([x, r * Math.sin(tilt) * 0.8, z], [tilt, R(0, 6.28), R(-0.2, 0.2)], [r, r * 1.1, r], pick([0xf2b640, 0xe9a82f, 0xffcb5a, 0xd99a28]), 'YXZ');
    });
    const cm = chips.done();
    if (cm) group.add(cm);

    // Jalapeno slices.
    for (let k = 0; k < 14; k++) {
      const r = R(3, 5);
      for (let tries = 0; tries < 40; tries++) {
        const x = R(-260, 300), z = R(-280, 220);
        if (!place(x, z, r + 1)) continue;
        const tilt = R(0.1, 0.5);
        solid.at(x, z, R(0, 6.28));
        solid.add(cyl10, 0x3f8f2a, [0, r * Math.sin(tilt) + 0.3, 0], [tilt, 0, 0], [r, 0.5, r]);
        solid.add(cyl10, 0xa8d470, [0, r * Math.sin(tilt) + 0.33, 0], [tilt, 0, 0], [r * 0.78, 0.5, r * 0.78]);
        solid.add(cyl10, 0xe6f0a8, [0, r * Math.sin(tilt) + 0.36, 0], [tilt, 0, 0], [r * 0.3, 0.5, r * 0.3]);
        break;
      }
    }

    // Cheese sauce puddles.
    const disc = new THREE.CircleGeometry(1, 12);
    scatter(20, -260, 300, -280, 220, () => R(5, 9), (x, z, r) => {
      flat.at(x, z, R(0, 6.28), 1, 0.04);
      flat.add(disc, pick([0xffd23a, 0xffc61f, 0xffdb52]), [0, 0, 0], [-Math.PI / 2, 0, 0], [r, r * R(0.6, 0.9), 1]);
    });

    // Cacti.
    const capTrunk = new THREE.CapsuleGeometry(1.1, 7, 2, 7);
    const capArm = new THREE.CapsuleGeometry(0.8, 2.4, 2, 6);
    const capUp = new THREE.CapsuleGeometry(0.8, 2.6, 2, 6);
    scatter(28, -260, 300, -280, 220, () => R(3, 5), (x, z) => {
      const s = R(0.9, 1.8);
      const g = pick([0x3f9a4a, 0x4aa856, 0x358a42]);
      shaded.at(x, z, R(0, 6.28), s);
      shaded.add(capTrunk, g, [0, 4.6, 0]);
      shaded.add(capArm, g, [1.9, 4.2, 0], [0, 0, Math.PI / 2]);
      shaded.add(capUp, g, [3.1, 5.9, 0]);
      if (rnd() < 0.6) {
        shaded.add(capArm, g, [-1.9, 5.8, 0], [0, 0, Math.PI / 2]);
        shaded.add(capUp, g, [-3.1, 7.5, 0]);
      }
      shaded.add(ico0, 0xff6a8a, [0, 9.4, 0], [0, 0, 0], 0.7);
    });

    // Desert rocks.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new Inst(rockGeo, whiteInst, 110);
    scatter(105, -280, 320, -300, 240, () => R(1.2, 4), (x, z, r) => {
      rocks.add([x, r * 0.35, z], [R(0, 3), R(0, 6), R(0, 3)], [r * R(0.9, 1.5), r * R(0.6, 1), r * R(0.9, 1.4)], pick([0xb5733c, 0xa0602f, 0xc98b4e, 0x8c5a34]));
    });
    const rm = rocks.done();
    if (rm) group.add(rm);

    // Salsa river: one flat mesh beside every 'kill' stretch.
    const pos: number[] = [];
    const nor: number[] = [];
    const quadPt = (i: number, lat: number): V3 => [track.x[i] - track.tz[i] * lat, 0, track.z[i] + track.tx[i] * lat];
    for (let i = 0; i < n; i++) {
      if (!kill[i]) continue;
      const j = (i + 1) % n;
      for (const side of [1, -1]) {
        const a0 = side * (track.w[i] / 2 + 2.5), b0 = side * (track.w[i] / 2 + 30);
        const a1 = side * (track.w[j] / 2 + 2.5), b1 = side * (track.w[j] / 2 + 30);
        const p0 = quadPt(i, a0), p1 = quadPt(i, b0), p2 = quadPt(j, b1), p3 = quadPt(j, a1);
        for (const v of [p0, p1, p2, p0, p2, p3]) {
          pos.push(v[0], 0, v[2]);
          nor.push(0, 1, 0);
        }
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const m = new THREE.Mesh(
        g,
        mat('salsa', () => new THREE.MeshStandardMaterial({ color: th.kill, emissive: th.kill, emissiveIntensity: 0.55, flatShading: true, roughness: 0.4, side: THREE.DoubleSide })),
      );
      m.name = 'salsa';
      m.position.y = -0.6;
      m.frustumCulled = false;
      m.receiveShadow = false;
      group.add(m);
    }
  }
}

/** Cheap idle motion: clouds drift, ants wiggle, the crater glow pulses. */
export function animateScenery(group: THREE.Group, t: number): void {
  const ud = group.userData as Partial<SceneryData>;
  if (ud.clouds)
    for (const c of ud.clouds) {
      const { bx, sp } = c.userData as { bx: number; sp: number };
      c.position.x = ((((bx + t * sp + 700) % 1400) + 1400) % 1400) - 700;
    }
  if (ud.ants)
    for (const a of ud.ants) {
      const { by, ph } = a.userData as { by: number; ph: number };
      a.rotation.y = by + Math.sin(t * 3.2 + ph) * 0.14;
      a.position.y = 0.03 + Math.abs(Math.sin(t * 7 + ph)) * 0.12;
    }
  if (ud.glow) ud.glow.emissiveIntensity = 1.1 + 0.35 * Math.sin(t * 2.2) + 0.15 * Math.sin(t * 5.3);
}

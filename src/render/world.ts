// Draws everything with Three.js: the menu turntable, and races (track, karts, items, effects).

import * as THREE from 'three';
import { charById } from '../sim/characters';
import type { Kart } from '../sim/kart';
import type { Track } from '../sim/track';
import type { RaceClient } from '../game/raceClient';
import { crateSpots } from '../sim/race';
import { buildItem, buildRacer, disposeObject, type RacerModel } from './models';
import { animateScenery, buildScenery } from './props';
import { buildTrack } from './trackMesh';

export const TIER_COLORS = [0xffffff, 0x4fd8ff, 0xff9a1f, 0xff3fd2];

interface RacerView {
  model: RacerModel;
  shield: THREE.Object3D;
  aura: THREE.Object3D;
  tag: THREE.Sprite | null;
  roll: number;
  spin: number;
}

/** A small pool of instanced particles. */
class Particles {
  readonly mesh: THREE.InstancedMesh;
  private p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grav: number }[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private next = 0;
  constructor(readonly max = 500) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.p.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, grav: 0 });
      this.mesh.setColorAt(i, this.c.setHex(0xffffff));
    }
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number, grav = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    Object.assign(this.p[i], { x, y, z, vx, vy, vz, life, max: life, size, grav });
    this.mesh.setColorAt(i, this.c.setHex(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (q.life <= 0) {
        this.m.makeScale(0, 0, 0);
      } else {
        q.life -= dt;
        q.vy -= q.grav * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.z += q.vz * dt;
        const s = q.size * Math.max(0, q.life / q.max);
        this.m.makeScale(s, s, s).setPosition(q.x, q.y, q.z);
      }
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.3, 3000);
  private scene = new THREE.Scene();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private trackGroup: THREE.Group | null = null;
  private scenery: THREE.Group | null = null;
  private racers = new Map<string, RacerView>();
  private boxes: THREE.Object3D[] = [];
  private objs = new Map<number, THREE.Object3D>();
  private particles = new Particles();
  private preview: { model: RacerModel; group: THREE.Group } | null = null;
  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  readonly lowPower: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.lowPower = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowPower, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowPower ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667744, 1.4));
    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = !this.lowPower;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 300;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.particles.mesh);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- Menu turntable -----------------------------------------------------------------

  showPreview(charId: string): void {
    this.clearRace();
    if (this.preview) {
      this.preview.group.removeFromParent();
      disposeObject(this.preview.group);
    }
    const group = new THREE.Group();
    const model = buildRacer(charById(charId));
    group.add(model.root);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.4, 32), new THREE.MeshLambertMaterial({ color: 0xffe2a8 }));
    disc.position.y = -0.2;
    disc.receiveShadow = true;
    group.add(disc);
    this.scene.add(group);
    this.preview = { model, group };
    this.scene.background = new THREE.Color(0xffb35c);
    this.scene.fog = null;
  }

  // ---- Races ------------------------------------------------------------------------------

  setupRace(rc: RaceClient): void {
    this.clearRace();
    if (this.preview) {
      this.preview.group.removeFromParent();
      disposeObject(this.preview.group);
      this.preview = null;
    }
    const tr = rc.track;
    const th = tr.def.theme;
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.fog, 120, this.lowPower ? 420 : 650);
    this.trackGroup = buildTrack(tr);
    this.scene.add(this.trackGroup);
    this.scenery = buildScenery(tr);
    const salsa = this.scenery.getObjectByName('salsa');
    if (salsa) salsa.position.y += 0.6;
    this.scene.add(this.scenery);

    for (const e of rc.entrants) {
      const model = buildRacer(charById(e.char));
      const shield = buildItem('gum');
      shield.visible = false;
      model.root.add(shield);
      const aura = buildItem('sugar');
      aura.visible = false;
      model.root.add(aura);
      const tag = !e.bot && e.id !== rc.myId ? nameTag(e.name) : null;
      if (tag) model.root.add(tag);
      this.scene.add(model.root);
      this.racers.set(e.id, { model, shield, aura, tag, roll: 0, spin: 0 });
    }
    for (const p of crateSpots(tr)) {
      const box = buildItem('crate');
      box.position.set(p.x, p.y + 1.3, p.z);
      this.scene.add(box);
      this.boxes.push(box);
    }
    const me = rc.me;
    this.camYaw = me.h;
    this.camPos.set(me.x - Math.cos(me.h) * 30, me.y + 12, me.z - Math.sin(me.h) * 30);
  }

  clearRace(): void {
    for (const g of [this.trackGroup, this.scenery]) {
      if (g) {
        g.removeFromParent();
        disposeObject(g);
      }
    }
    this.trackGroup = this.scenery = null;
    for (const v of this.racers.values()) {
      v.model.root.removeFromParent();
      disposeObject(v.model.root);
    }
    this.racers.clear();
    for (const b of this.boxes) {
      b.removeFromParent();
      disposeObject(b);
    }
    this.boxes = [];
    for (const o of this.objs.values()) {
      o.removeFromParent();
      disposeObject(o);
    }
    this.objs.clear();
  }

  /** A burst of effect particles somewhere (hits, crates, pops). */
  burst(x: number, y: number, z: number, colors: number[], n = 14, speed = 8, size = 0.7): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.particles.emit(x, y + 1, z, Math.cos(a) * speed * (0.4 + u), 3 + Math.random() * speed * 0.8, Math.sin(a) * speed * (0.4 + u), colors[i % colors.length], size, 0.6 + Math.random() * 0.4, 18);
    }
  }

  ring(x: number, y: number, z: number, r: number, color: number): void {
    const n = Math.max(12, Math.round(r * 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.emit(x, y + 0.8, z, Math.cos(a) * r * 1.6, 1.5, Math.sin(a) * r * 1.6, color, 1.1, 0.6, 0);
    }
  }

  addShake(v: number): void {
    this.shake = Math.max(this.shake, v);
  }

  render(dt: number, rc: RaceClient | null): void {
    this.time += dt;
    if (this.preview) {
      const g = this.preview.group;
      g.rotation.y += dt * 0.7;
      const narrow = innerWidth < innerHeight;
      this.camera.position.set(0, 2.6, narrow ? 9.5 : 7);
      this.camera.lookAt(0, 1, 0);
      if (narrow) this.camera.position.y += 1.2;
      this.preview.model.driver.position.y = Math.abs(Math.sin(this.time * 3)) * 0.08;
      for (const w of this.preview.model.wheels) w.rotation.x += dt * 4;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!rc) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    for (const k of rc.allKarts()) this.drawKart(k, dt);
    // Crates.
    this.boxes.forEach((b, i) => {
      const on = rc.boxes ? rc.boxes[i] !== '0' : true;
      const target = on ? 1 : 0;
      const s = b.scale.x + (target - b.scale.x) * Math.min(1, dt * (on ? 4 : 30));
      b.scale.setScalar(Math.max(0.001, s));
      b.rotation.y += dt * 1.4;
      b.position.y += Math.sin(this.time * 2.5 + i) * 0.004;
    });
    this.drawObjs(rc, dt);
    this.particles.update(dt);
    if (this.scenery) animateScenery(this.scenery, this.time);
    this.updateCamera(rc, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private drawKart(k: Kart, dt: number): void {
    const v = this.racers.get(k.id);
    if (!v) return;
    const m = v.model;
    m.root.position.set(k.x, k.y, k.z);
    m.root.rotation.y = Math.PI / 2 - k.h;
    v.spin = k.spinT > 0 ? v.spin + dt * 15 : v.spin * Math.max(0, 1 - dt * 12);
    const driftYaw = -k.drift * 0.38;
    m.body.rotation.y += (driftYaw + v.spin - m.body.rotation.y) * Math.min(1, dt * 12);
    if (k.spinT > 0) m.body.rotation.y = driftYaw + v.spin;
    m.body.rotation.z = k.drift * 0.08 + Math.sin(k.t * 30) * (k.drift ? 0.015 : 0);
    m.body.rotation.x = k.air ? -0.12 : 0;
    v.roll += (k.speed * dt) / 0.36;
    for (const w of m.wheels) w.rotation.x = v.roll;
    for (const w of m.frontWheels) w.rotation.y = -k.steerVis * 0.45;
    m.driver.position.y = Math.abs(Math.sin(k.t * 10)) * 0.04 * Math.min(1, Math.abs(k.speed) / 10);
    m.driver.scale.y = k.slowT > 0 ? 0.85 : 1;
    v.shield.visible = k.shieldT > 0;
    if (v.shield.visible) v.shield.rotation.y += dt;
    v.aura.visible = k.sugarT > 0;
    if (v.aura.visible) v.aura.rotation.y += dt * 6;
    m.root.visible = !(k.invulnT > 0 && k.sugarT <= 0 && k.shieldT <= 0 && Math.floor(this.time * 14) % 2 === 0 && k.fallT <= 0);

    // Particles: drift sparks, boost flames, fire trail, slowed puffs, offroad dust.
    const fx = Math.cos(k.h), fz = Math.sin(k.h);
    const rx = -fz, rz = fx;
    if (k.drift && k.tier > 0 && Math.random() < 0.8) {
      const col = TIER_COLORS[k.tier];
      for (const side of [-1, 1]) {
        const x = k.x - fx * 1.0 + rx * side * 0.8, z = k.z - fz * 1.0 + rz * side * 0.8;
        this.particles.emit(x, k.y + 0.2, z, (Math.random() - 0.5) * 4 - fx * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 4 - fz * 3, col, 0.28 + k.tier * 0.06, 0.25, 20);
      }
    } else if (k.drift && Math.random() < 0.3) {
      this.particles.emit(k.x - fx * 1.1, k.y + 0.2, k.z - fz * 1.1, -fx * 2, 1.5, -fz * 2, 0xeeeeee, 0.28, 0.35, 0);
    }
    if (k.boostT > 0) {
      for (let i = 0; i < 2; i++) {
        const side = i ? 0.35 : -0.35;
        this.particles.emit(k.x - fx * 1.5 + rx * side, k.y + 0.55, k.z - fz * 1.5 + rz * side, -fx * 6, 0.5, -fz * 6, Math.random() < 0.5 ? 0xffd23f : 0xff6a1f, 0.45, 0.18, 0);
      }
    }
    if (k.draftT > 0.35 && Math.random() < 0.3 + k.draftT * 0.4) {
      // Wind lines streaming past while tucked in a slipstream.
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5);
      this.particles.emit(k.x + fx * 1.5 + rx * side, k.y + 0.6 + Math.random() * 0.8, k.z + fz * 1.5 + rz * side, -fx * 16, 0, -fz * 16, 0xffffff, 0.22, 0.25, 0);
    }
    if (k.fireT > 0) this.particles.emit(k.x - fx * 1.8, k.y + 0.4, k.z - fz * 1.8, 0, 3, 0, 0xff3b1f, 0.8, 0.35, -2);
    if (k.slowT > 0 && Math.random() < 0.2) this.particles.emit(k.x, k.y + 2.2, k.z, 0, 1.5, 0, 0x5cc24a, 0.6, 0.6, 0);
    if (k.fallT > 0 && Math.random() < 0.5) this.particles.emit(k.x, k.y + 0.5, k.z, (Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3, 0xd8321c, 0.6, 0.5, 12);
  }

  private drawObjs(rc: RaceClient, dt: number): void {
    for (const [id, o] of this.objs) {
      if (!rc.objs.has(id)) {
        o.removeFromParent();
        disposeObject(o);
        this.objs.delete(id);
      }
    }
    for (const v of rc.objs.values()) {
      let o = this.objs.get(v.id);
      if (!o) {
        o = makeObj(v.kind);
        this.scene.add(o);
        this.objs.set(v.id, o);
        o.position.set(v.x, v.y, v.z);
      }
      const dx = v.x - o.position.x, dz = v.z - o.position.z;
      if (dx * dx + dz * dz > 0.0001 && (v.kind === 'taffy' || v.kind === 'rocket')) o.rotation.y = Math.atan2(dx, dz);
      o.position.set(v.x, v.kind === 'jawbreaker' || v.kind === 'taffy' || v.kind === 'rocket' ? v.y - 0.3 : v.y + 0.02, v.z);
      if (v.kind === 'jawbreaker') o.rotation.x += dt * 10;
      if (v.kind === 'flame') o.scale.setScalar(0.9 + Math.sin(this.time * 20 + v.id) * 0.15);
      if (v.kind === 'stink') o.rotation.y += dt * 0.5;
      if (v.kind === 'rocket' && Math.random() < 0.7) this.particles.emit(v.x, v.y, v.z, 0, 1, 0, 0xffffff, 0.6, 0.4, 0);
    }
  }

  private updateCamera(rc: RaceClient, dt: number): void {
    const k = rc.me;
    const narrow = innerWidth < innerHeight;
    const fall = k.fallT > 0;
    this.camYaw += wrap(k.h - this.camYaw) * Math.min(1, dt * (k.drift ? 3.2 : 5));
    const back = narrow ? 12 : 7.6;
    const up = narrow ? 5.6 : 3.3;
    const target = new THREE.Vector3(k.x - Math.cos(this.camYaw) * back, (fall ? k.y + 6 : k.y) + up, k.z - Math.sin(this.camYaw) * back);
    if (rc.clock < -1.2) {
      // Start: swing in from a wide view.
      const a = (rc.clock + 3.2) / 2;
      target.lerp(new THREE.Vector3(k.x + Math.cos(k.h) * 18 + 10, k.y + 9, k.z + Math.sin(k.h) * 18 - 6), Math.max(0, 1 - a));
    }
    this.camPos.lerp(target, Math.min(1, dt * 8));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.camera.lookAt(k.x + Math.cos(k.h) * 4, k.y + 1.2, k.z + Math.sin(k.h) * 4);
    const fov = (narrow ? 82 : 70) + (k.boostT > 0 ? 8 : 0);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
    this.sun.position.set(k.x + 40, k.y + 90, k.z + 30);
    this.sun.target.position.set(k.x, k.y, k.z);
  }
}

function makeObj(kind: string): THREE.Object3D {
  const o = buildItem(kind as Parameters<typeof buildItem>[0]);
  if (kind === 'puddle') o.scale.set(6.5, 1, 6.5);
  if (kind === 'stink') o.scale.setScalar(6);
  return o;
}

function nameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,.7)';
  g.strokeText(name, 128, 32);
  g.fillStyle = '#fff';
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.position.y = 3.6;
  return s;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export type { Track };

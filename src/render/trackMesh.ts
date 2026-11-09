// Builds the road and its edges from the sampled centerline: road, curbs, shoulders and
// embankments, walls, cliffs into salsa, bridge decks with pillars, boost pads, the ramp,
// and the start gantry. One vertex-colored mesh for most of it keeps draw calls low.

import * as THREE from 'three';
import { SHOULDER, type Track } from '../sim/track';

class Builder {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();
  quad(a: number[], b: number[], c: number[], d: number[], color: number): void {
    // a-b along one edge, d-c along the other: triangles a,b,c and a,c,d.
    this.c.setHex(color);
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }
  mesh(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
}

const shade = (hex: number, f: number) => new THREE.Color(hex).multiplyScalar(f).getHex();

export function buildTrack(track: Track): THREE.Group {
  const th = track.def.theme;
  const group = new THREE.Group();
  const n = track.n;
  const P = (i: number, lat: number, dy = 0): number[] => {
    i = ((i % n) + n) % n;
    return [track.x[i] - track.tz[i] * lat, track.y[i] + dy, track.z[i] + track.tx[i] * lat];
  };
  const half = (i: number) => track.w[((i % n) + n) % n] / 2;
  const b = new Builder();

  for (let i = 0; i < n; i++) {
    const j = i + 1;
    const hi = half(i), hj = half(j);
    const edge = track.edge[i];
    const bridge = track.bridge[i];
    // Road surface in three lanes, with a dashed center line.
    const band = Math.floor(i / 3) % 2;
    const roadC = band ? th.road : shade(th.road, 0.96);
    b.quad(P(i, -hi, 0.02), P(j, -hj, 0.02), P(j, -0.3, 0.02), P(i, -0.3, 0.02), roadC);
    b.quad(P(i, 0.3, 0.02), P(j, 0.3, 0.02), P(j, hj, 0.02), P(i, hi, 0.02), roadC);
    b.quad(P(i, -0.3, 0.02), P(j, -0.3, 0.02), P(j, 0.3, 0.02), P(i, 0.3, 0.02), band ? th.road2 : roadC);
    // Start line: a checkered band.
    if (i < 2) {
      const cells = 10;
      for (let c = 0; c < cells; c++) {
        const l0 = -hi + (c / cells) * hi * 2, l1 = -hi + ((c + 1) / cells) * hi * 2;
        b.quad(P(i, l0, 0.03), P(j, l0, 0.03), P(j, l1, 0.03), P(i, l1, 0.03), (c + i) % 2 ? 0x111111 : 0xffffff);
      }
    }
    // Curbs both sides.
    const curb = Math.floor(i / 2) % 2 ? th.curbA : th.curbB;
    for (const s of [-1, 1]) {
      b.quad(P(i, s * hi, 0.03), P(j, s * hj, 0.03), P(j, s * (hj + 1), 0.06), P(i, s * (hi + 1), 0.06), curb);
    }
    const yi = track.y[i], yj = track.y[(j) % n];
    for (const s of [-1, 1]) {
      if (edge === 'grass') {
        const out = SHOULDER.grass;
        b.quad(P(i, s * (hi + 1), 0.06), P(j, s * (hj + 1), 0.06), P(j, s * (hj + out), 0), P(i, s * (hi + out), 0), th.ground2);
        // Embankment down to the ground.
        if (yi > 0.05 || yj > 0.05) {
          const ri = hi + out + yi * 1.6, rj = hj + out + yj * 1.6;
          b.quad(P(i, s * (hi + out)), P(j, s * (hj + out)), P(j, s * rj, -yj - 0.02), P(i, s * ri, -yi - 0.02), shade(th.ground, 0.9));
        }
      } else if (edge === 'wall') {
        const w0 = hi + 1, w1 = hj + 1;
        const top = 1.1;
        const wc = Math.floor(i / 4) % 2 ? th.wall : shade(th.wall, 0.86);
        b.quad(P(i, s * w0), P(j, s * w1), P(j, s * w1, top), P(i, s * w0, top), wc);
        b.quad(P(i, s * w0, top), P(j, s * w1, top), P(j, s * (w1 + 0.6), top), P(i, s * (w0 + 0.6), top), shade(wc, 1.1));
        b.quad(P(i, s * (w0 + 0.6), top), P(j, s * (w1 + 0.6), top), P(j, s * (w1 + 0.6), -yj), P(i, s * (w0 + 0.6), -yi), shade(wc, 0.8));
        if (!bridge && (yi > 0.05 || yj > 0.05)) {
          const ri = w0 + 0.6 + yi * 1.6, rj = w1 + 0.6 + yj * 1.6;
          b.quad(P(i, s * (w0 + 0.6), -yi * 0.0), P(j, s * (w1 + 0.6), 0), P(j, s * rj, -yj - 0.02), P(i, s * ri, -yi - 0.02), shade(th.ground, 0.9));
        }
      } else {
        // Kill edge: a rocky lip, then a cliff down into the salsa.
        const out = SHOULDER.kill;
        b.quad(P(i, s * (hi + 1), 0.06), P(j, s * (hj + 1), 0.06), P(j, s * (hj + out), 0), P(i, s * (hi + out), 0), shade(th.ground2, 0.8));
        b.quad(P(i, s * (hi + out)), P(j, s * (hj + out)), P(j, s * (hj + out), -yj - 1), P(i, s * (hi + out), -yi - 1), shade(th.ground2, 0.6));
      }
    }
    // Bridge deck underside.
    if (bridge) {
      const o = hi + 1.6, oj = hj + 1.6;
      b.quad(P(i, -o, -0.9), P(j, -oj, -0.9), P(j, oj, -0.9), P(i, o, -0.9), shade(th.wall, 0.6));
    }
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
  const road = b.mesh(mat);
  road.receiveShadow = true;
  group.add(road);

  // Bridge pillars, skipping spots where they would stand on a road underneath.
  const pillarGeo = new THREE.CylinderGeometry(0.9, 1.1, 1, 8);
  const pillarMat = new THREE.MeshLambertMaterial({ color: shade(th.wall, 0.75), flatShading: true });
  for (let i = 0; i < n; i += 7) {
    if (!track.bridge[i] || track.y[i] < 3) continue;
    for (const s of [-1, 1]) {
      const p = P(i, s * (half(i) + 0.4));
      const below = track.locate(p[0], p[2], -1, 0);
      if (Math.abs(below.lat) < below.half + 3 && below.y < track.y[i] - 3) continue;
      const m = new THREE.Mesh(pillarGeo, pillarMat);
      m.scale.y = track.y[i];
      m.position.set(p[0], track.y[i] / 2 - 0.5, p[2]);
      group.add(m);
    }
  }

  // Ground.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), new THREE.MeshLambertMaterial({ color: th.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  // Boost pads and the ramp.
  const padTex = chevronTexture();
  for (const pd of track.def.pads) {
    const s = pd.at * track.length;
    const w = pd.w ?? 4;
    const p = track.pointAt(s + 1.75, pd.lat);
    if (pd.kind === 'boost') {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 3.5),
        new THREE.MeshBasicMaterial({ map: padTex, transparent: true }),
      );
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.PI / 2 - p.h;
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, p.y + 0.07, p.z);
      m.name = 'pad';
      group.add(m);
    } else {
      // A wedge rising to the launch point.
      const len = 6;
      const g = new THREE.BufferGeometry();
      const v = [
        -w / 2, 0, -len, w / 2, 0, -len, w / 2, 1.1, 0, -w / 2, 0, -len, w / 2, 1.1, 0, -w / 2, 1.1, 0,
        -w / 2, 0, 0, -w / 2, 1.1, 0, w / 2, 1.1, 0, -w / 2, 0, 0, w / 2, 1.1, 0, w / 2, 0, 0,
        -w / 2, 0, -len, -w / 2, 1.1, 0, -w / 2, 0, 0, w / 2, 0, -len, w / 2, 0, 0, w / 2, 1.1, 0,
      ];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xff8a1f, side: THREE.DoubleSide, flatShading: true }));
      const q = track.pointAt(s, pd.lat);
      m.position.set(q.x, q.y, q.z);
      m.rotation.y = Math.PI / 2 - q.h;
      m.castShadow = true;
      group.add(m);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, len * 1.02), new THREE.MeshBasicMaterial({ map: padTex, transparent: true }));
      stripe.rotation.order = 'YXZ';
      stripe.rotation.y = Math.PI / 2 - q.h;
      stripe.rotation.x = -Math.PI / 2 + Math.atan2(1.1, len);
      const mid = track.pointAt(s - len / 2, pd.lat);
      stripe.position.set(mid.x, mid.y + 0.6, mid.z);
      group.add(stripe);
    }
  }

  // Start gantry.
  const st = track.pointAt(0, 0);
  const gw = half(0) + 2;
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x333344 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), postMat);
    post.position.set(s * gw, 4, 0);
    gantry.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(gw * 2 + 0.8, 2.2, 0.5), [
    postMat, postMat, postMat, postMat,
    new THREE.MeshBasicMaterial({ map: bannerTexture() }),
    new THREE.MeshBasicMaterial({ map: bannerTexture() }),
  ]);
  banner.position.y = 7.4;
  gantry.add(banner);
  gantry.position.set(st.x, st.y, st.z);
  gantry.rotation.y = Math.PI / 2 - st.h;
  group.add(gantry);

  return group;
}

function chevronTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff9a1f';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff36b';
  for (let k = 0; k < 2; k++) {
    const y = 8 + k * 28;
    g.beginPath();
    g.moveTo(6, y + 20);
    g.lineTo(32, y);
    g.lineTo(58, y + 20);
    g.lineTo(46, y + 20);
    g.lineTo(32, y + 9);
    g.lineTo(18, y + 20);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 512; x += 32) {
    g.fillStyle = (x / 32) % 2 ? '#e8443a' : '#ffd23f';
    g.fillRect(x, 0, 32, 64);
  }
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(96, 6, 320, 52);
  g.fillStyle = '#fff';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CRUNCH RALLY', 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

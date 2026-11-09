// Track layouts. Each control point is [x, z, height, road width, edge?, bridge?].
// Forward along the lap is the order of the points; the start line is at point 0.

export type EdgeKind = 'wall' | 'grass' | 'kill';
export type ControlPoint = [number, number, number, number, EdgeKind?, boolean?];

export interface PadDef {
  at: number; // fraction of the lap 0..1
  lat: number; // sideways offset in meters (+ = right)
  kind: 'boost' | 'ramp';
  w?: number; // width across the road (default 4)
}

export interface TrackTheme {
  sky: number;
  fog: number;
  ground: number;
  ground2: number; // patches
  road: number;
  road2: number; // stripes
  curbA: number;
  curbB: number;
  wall: number;
  kill: number; // what you fall into
  props: 'picnic' | 'nacho';
}

export interface TrackDef {
  id: string;
  name: string;
  blurb: string;
  edge: EdgeKind; // default edge for points that don't say
  points: ControlPoint[];
  itemRows: number[]; // fractions of the lap with a row of snack crates
  pads: PadDef[];
  theme: TrackTheme;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'picnic',
    name: 'Picnic Park',
    blurb: 'A wide, friendly loop around a giant picnic. One hill with a jump on top.',
    edge: 'grass',
    points: [
      [0, 0, 0, 18],
      [60, 0, 0, 18],
      [110, 4, 0, 17],
      [145, 25, 0, 16],
      [157, 65, 1, 16],
      [137, 100, 2, 15, 'wall'],
      [100, 110, 3, 15, 'wall'],
      [80, 137, 4, 15, 'wall'],
      [96, 172, 5, 15],
      [80, 205, 7, 16],
      [30, 217, 7, 16],
      [-20, 202, 4, 16],
      [-45, 166, 2, 16],
      [-32, 130, 1, 15],
      [-57, 95, 0, 15],
      [-77, 55, 0, 16],
      [-62, 15, 0, 17],
      [-32, 0, 0, 18],
    ],
    itemRows: [0.12, 0.47, 0.78],
    pads: [
      { at: 0.3, lat: 3, kind: 'boost' },
      { at: 0.555, lat: 0, kind: 'ramp', w: 8 },
      { at: 0.87, lat: -4, kind: 'boost' },
    ],
    theme: {
      sky: 0x9fd8ff,
      fog: 0xcdeeff,
      ground: 0x6cc24a,
      ground2: 0x5aae3c,
      road: 0xd9b27a,
      road2: 0xe8c896,
      curbA: 0xe8443a,
      curbB: 0xfff6e8,
      wall: 0x3f8f3a,
      kill: 0x3f8f3a,
      props: 'picnic',
    },
  },
  {
    id: 'nacho',
    name: 'Nacho Volcano',
    blurb: 'A figure-eight up and over itself, beside a river of hot salsa. Fall in and you get fished out.',
    edge: 'wall',
    points: [
      [0, 0, 0, 15],
      [70, 0, 0, 15],
      [120, -15, 0, 14],
      [150, -50, 0.5, 13, 'kill'],
      [140, -95, 2, 13, 'kill'],
      [100, -117, 4, 13, 'kill'],
      [55, -100, 6, 13],
      [36, -62, 8, 13],
      [30, -25, 10, 13, 'wall', true],
      [26, 25, 10, 13, 'wall', true],
      [12, 60, 9, 13, 'wall', true],
      [-30, 86, 7, 13],
      [-75, 80, 5, 13, 'kill'],
      [-105, 50, 3, 13, 'kill'],
      [-110, 10, 1, 14],
      [-90, -20, 0, 14],
      [-55, -28, 0, 15],
      [-25, -12, 0, 15],
    ],
    itemRows: [0.06, 0.42, 0.7],
    pads: [
      { at: 0.24, lat: 3, kind: 'boost' },
      { at: 0.5, lat: 0, kind: 'boost', w: 6 },
      { at: 0.9, lat: -3, kind: 'boost' },
    ],
    theme: {
      sky: 0xffb070,
      fog: 0xffc890,
      ground: 0xd9a441,
      ground2: 0xc48d2e,
      road: 0x5a4a44,
      road2: 0x6b5a52,
      curbA: 0xffd23f,
      curbB: 0x2b2b2b,
      wall: 0xe0b44a,
      kill: 0xd8321c,
      props: 'nacho',
    },
  },
];

export const trackById = (id: string) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];

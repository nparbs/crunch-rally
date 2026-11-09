// The racers. Stats run 1..5; they only nudge the kart, so every racer can win.

export type AbilityId = 'ghostPepper' | 'brineWave' | 'sugarRush' | 'popBurst' | 'stinkBomb' | 'colaRocket' | 'gummyGrapple' | 'healthKick';

export interface CharacterDef {
  id: string;
  name: string;
  snack: string;
  bio: string;
  color: number; // main body color
  accent: number;
  kart: number; // kart paint
  speed: number;
  accel: number;
  handling: number;
  weight: number;
  ability: AbilityId;
}

export interface AbilityDef {
  id: AbilityId;
  name: string;
  text: string;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  ghostPepper: { id: 'ghostPepper', name: 'Ghost Pepper', text: 'Speed up and leave a trail of fire. Anyone who drives through it spins out.' },
  brineWave: { id: 'brineWave', name: 'Brine Wave', text: 'Dump a huge pickle-juice puddle behind you. Karts in it slide all over.' },
  sugarRush: { id: 'sugarRush', name: 'Sugar Rush', text: 'Three seconds of speed you cannot be hit out of. Ram people for fun.' },
  popBurst: { id: 'popBurst', name: 'Pop Burst', text: 'Explode in a ring of popcorn. Everyone close by gets knocked spinning.' },
  stinkBomb: { id: 'stinkBomb', name: 'Stink Bomb', text: 'Lob a cheesy cloud down the road. Anyone inside slows down and can barely see.' },
  colaRocket: { id: 'colaRocket', name: 'Cola Rocket', text: 'Shake the can and fire a fizzing rocket that hunts down whoever is in first.' },
  gummyGrapple: { id: 'gummyGrapple', name: 'Gummy Grapple', text: 'Stretch out, grab the kart ahead and slingshot past it.' },
  healthKick: { id: 'healthKick', name: 'Health Kick', text: 'Force-feed vegetables to everyone just ahead. They feel sluggish for a while.' },
};

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'hal', name: 'Hotshot Hal', snack: 'hot sauce bottle',
    bio: 'Talks fast, drives faster, never reads the label.',
    color: 0xd7261e, accent: 0xffffff, kart: 0x2b2b2b,
    speed: 5, accel: 2, handling: 2, weight: 3, ability: 'ghostPepper',
  },
  {
    id: 'dill', name: 'Dill Pickleton', snack: 'pickle',
    bio: 'Calm, a little sour, impossible to rattle.',
    color: 0x5f9e2f, accent: 0x9ccf5a, kart: 0x2f6fd1,
    speed: 3, accel: 3, handling: 3, weight: 3, ability: 'brineWave',
  },
  {
    id: 'glaze', name: 'Glaze', snack: 'sprinkle donut',
    bio: 'Always on a sugar high. Has never once used the brake.',
    color: 0xf7a6c8, accent: 0xd99560, kart: 0xffffff,
    speed: 3, accel: 5, handling: 3, weight: 1, ability: 'sugarRush',
  },
  {
    id: 'kernel', name: 'Kernel Pop', snack: 'popcorn bucket',
    bio: 'Retired movie-theater mascot. Explosive temper.',
    color: 0xe8443a, accent: 0xfff3c4, kart: 0xffd23f,
    speed: 3, accel: 3, handling: 2, weight: 4, ability: 'popBurst',
  },
  {
    id: 'brie', name: 'Big Brie', snack: 'cheese wedge',
    bio: 'Aged to perfection. You can smell her coming.',
    color: 0xffcf3f, accent: 0xe6a812, kart: 0x7a3fa0,
    speed: 4, accel: 2, handling: 2, weight: 5, ability: 'stinkBomb',
  },
  {
    id: 'fizz', name: 'Fizz', snack: 'soda can',
    bio: 'Bubbly, jittery, under a lot of pressure.',
    color: 0x2f7be0, accent: 0xd8e4f0, kart: 0xe8443a,
    speed: 4, accel: 3, handling: 3, weight: 2, ability: 'colaRocket',
  },
  {
    id: 'gummo', name: 'Gummo', snack: 'gummy bear',
    bio: 'Stretchy, sticky and a hugger. Nobody asked for the hug.',
    color: 0xff7a1a, accent: 0xffb36b, kart: 0x2bb5a8,
    speed: 2, accel: 4, handling: 5, weight: 1, ability: 'gummyGrapple',
  },
  {
    id: 'brock', name: 'Professor Brock', snack: 'broccoli',
    bio: 'A vegetable who snuck into the snack league to make everyone eat better.',
    color: 0x2f8f3a, accent: 0xb7d98b, kart: 0xf2f2f2,
    speed: 3, accel: 3, handling: 4, weight: 2, ability: 'healthKick',
  },
];

export const charById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

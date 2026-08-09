/* Deterministic, seeded pseudo-randomness. FNV-1a over a node id (with an
   optional salt for independent streams) gives values that are stable across
   renders, so the same task always jitters, falls and grows the same way. */

export function hashInt(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const rand = (id, salt = 0) => (hashInt(id, salt) % 1000) / 1000; // [0,1)
export const jitter = (id, salt = 0) => rand(id, salt) - 0.5; // [-0.5,0.5)

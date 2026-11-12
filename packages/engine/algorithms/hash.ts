/** murmur3 finalizer: spreads FNV's weak low-entropy output across all 32 bits. */
function fmix32(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit FNV-1a + avalanche over a string or integer; stable across platforms. */
export function fnv1a(input: string | number, seed = 2166136261): number {
  const s = typeof input === "number" ? String(input) : input;
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return fmix32(h);
}

/** Small, dependency-free text helpers used by the stub heuristics and the eval harness. */

const STOPWORDS = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being it its ' +
    'this that these those i me my we our you your he she they them their his her him do did does ' +
    'have has had so very really just what why how when where which who whom there here than then ' +
    'about into over under up down out not no yes can could would should will shall may might must ' +
    'am too also any some all more most much many such only own same other'
  ).split(' '),
);

const NEGATIONS = new Set(['not', 'never', 'no', "don't", 'dont', "didn't", 'didnt', "haven't", 'havent', "isn't", 'isnt', "wasn't", 'wasnt', 'none', 'nobody', 'nothing', "can't", 'cant', "won't", 'wont']);

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokens(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}']+/gu) ?? [];
}

export function contentWords(text: string): string[] {
  return tokens(text).filter((t) => !STOPWORDS.has(t) && !NEGATIONS.has(t) && t.length > 1);
}

export function hasNegation(text: string): boolean {
  return tokens(text).some((t) => NEGATIONS.has(t));
}

export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function shingles(text: string, n = 2): string[] {
  const t = tokens(text);
  if (t.length < n) return t.length ? [t.join(' ')] : [];
  const out: string[] = [];
  for (let i = 0; i <= t.length - n; i++) out.push(t.slice(i, i + n).join(' '));
  return out;
}

/** Crude stemmer: enough to match "price"/"prices"/"priced" without a dependency. */
export function stem(word: string): string {
  return word.replace(/(ing|ed|es|s|ly)$/u, '') || word;
}

/** FNV-1a 32-bit. Deterministic seed for the stub provider. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG, seeded. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

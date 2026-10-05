export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

/** In-memory LRU with TTL. Same interface can be backed by Redis later. */
export class LruCache<T> implements Cache<T> {
  private map = new Map<string, { v: T; exp: number }>();
  constructor(private max = 500, private ttlMs = 24 * 60 * 60 * 1000) {}
  get(key: string) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, e); // refresh recency
    return e.v;
  }
  set(key: string, value: T) {
    this.map.delete(key);
    this.map.set(key, { v: value, exp: Date.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

import { CacheEntry } from '../types/index.js';
import { DEFAULT_TTL_MS, SystemType } from '../constants/systems.js';

/**
 * Simple in-memory cache with TTL support
 */
export class Cache {
  private cache: Map<string, CacheEntry<any>>;
  private maxEntries: number;
  private ttlOverrides: Map<SystemType, number>;

  constructor(maxEntries = 1000) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.ttlOverrides = new Map();
  }

  /**
   * Set custom TTL for a specific system
   */
  setTTLOverride(system: SystemType, ttlMs: number): void {
    this.ttlOverrides.set(system, ttlMs);
  }

  /**
   * Get TTL for a system (with override support)
   */
  private getTTL(system: SystemType): number {
    return this.ttlOverrides.get(system) || DEFAULT_TTL_MS[system];
  }

  /**
   * Build cache key for package versions
   */
  static packageKey(system: SystemType, name: string): string {
    return `${system}:${name}#package`;
  }

  /**
   * Build cache key for specific version
   */
  static versionKey(system: SystemType, name: string, version: string): string {
    return `${system}:${name}@${version}#version`;
  }

  /**
   * Build cache key for manifest inspection
   */
  static manifestKey(ecosystem: SystemType, hash: string): string {
    return `${ecosystem}:${hash}#inspect`;
  }

  /**
   * Get value from cache if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set value in cache with TTL
   */
  set<T>(key: string, data: T, system: SystemType): void {
    // Enforce max entries (simple LRU: delete oldest)
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const ttl = this.getTTL(system);
    const expiresAt = Date.now() + ttl;

    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  stats(): { size: number; maxEntries: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
    };
  }

  /**
   * Remove expired entries (manual cleanup)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

import { z } from 'zod';
import { DepsDevClient } from '../depsdev/client.js';
import { Cache } from '../cache/cache.js';
import { inspectManifest, hashContent } from '../manifest/inspect.js';
import { SUPPORTED_SYSTEMS } from '../constants/systems.js';
import type { DepsDevError } from '../types/index.js';

export const GetPackageVersionsSchema = z.object({
  system: z.enum(SUPPORTED_SYSTEMS),
  name: z.string(),
});

export const GetLatestVersionSchema = z.object({
  system: z.enum(SUPPORTED_SYSTEMS),
  name: z.string(),
  includePrerelease: z.boolean().optional(),
});

export const InspectManifestSchema = z.object({
  manifestPath: z.string(),
  content: z.string().optional(),
});

export const GetPackageVersionsBatchSchema = z.object({
  packages: z.array(z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string() })),
});

export const GetLatestVersionsBatchSchema = z.object({
  packages: z.array(z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string(), includePrerelease: z.boolean().optional() })),
});

export const GeneratePurlSchema = z.object({
  system: z.enum(SUPPORTED_SYSTEMS),
  name: z.string(),
  version: z.string().optional(),
  includePrerelease: z.boolean().optional(),
});

export const GeneratePurlsBatchSchema = z.object({
  packages: z.array(z.object({
    system: z.enum(SUPPORTED_SYSTEMS),
    name: z.string(),
    version: z.string().optional(),
    includePrerelease: z.boolean().optional(),
  }))
});

function formatError(error: unknown): { isError: true; content: Array<{ type: 'text'; text: string }>; _meta?: any } {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const depsError = error as DepsDevError;
    return { isError: true, content: [{ type: 'text' as const, text: depsError.message }], _meta: { status: depsError.status, endpoint: depsError.endpoint } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export class VersionTools {
  constructor(private client: DepsDevClient, private cache: Cache) {}

  async getPackageVersions(args: z.infer<typeof GetPackageVersionsSchema>) {
    try {
      const { system, name } = args;
      const cacheKey = Cache.packageKey(system, name);
      const cached = this.cache.get(cacheKey);
      if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached, null, 2) }], structuredContent: cached as Record<string, unknown> };
      const result = await this.client.getPackageVersions(system, name);
      this.cache.set(cacheKey, result, system);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: (result as unknown as Record<string, unknown>) };
    } catch (error) {
      return formatError(error);
    }
  }

  async getLatestVersion(args: z.infer<typeof GetLatestVersionSchema>) {
    try {
      const { system, name, includePrerelease = false } = args;
      // Use a distinct cache key to avoid collision with full versions list
      const cacheKey = Cache.packageKey(system, `${name}|latest`);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(cached, null, 2) }], structuredContent: cached as Record<string, unknown> };
      }
      const result = await this.client.getLatestVersion(system, name, includePrerelease);
      this.cache.set(cacheKey, result, system);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: (result as unknown as Record<string, unknown>) };
    } catch (error) {
      return formatError(error);
    }
  }

  async inspectManifest(args: z.infer<typeof InspectManifestSchema>) {
    try {
      const { manifestPath, content } = args;
      const contentHash = content ? hashContent(content) : undefined;
      if (contentHash) {
        const cacheKey = Cache.packageKey('NPM', `${manifestPath}:${contentHash}`);
        const cached = this.cache.get(cacheKey);
        if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached, null, 2) }], structuredContent: cached as Record<string, unknown> };
      }
      const result = await inspectManifest(manifestPath, content);
      if (contentHash) {
        const cacheKey = Cache.packageKey('NPM', `${manifestPath}:${contentHash}`);
        this.cache.set(cacheKey, result, 'NPM');
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: (result as unknown as Record<string, unknown>) };
    } catch (error) {
      return formatError(error);
    }
  }

  async getPackageVersionsBatch(args: z.infer<typeof GetPackageVersionsBatchSchema>) {
    try {
      const { packages } = args;
      if (packages.length === 0) return { content: [{ type: 'text' as const, text: JSON.stringify({ packages: [], summary: { total: 0, successful: 0, failed: 0, cached: 0 } }, null, 2) }], structuredContent: { results: [], summary: { total: 0, successful: 0, failed: 0, cached: 0 } } as Record<string, unknown> };
      const results: any[] = [];
      const cacheSummary = { hits: 0, misses: 0 };
      for (const pkg of packages) {
        const cacheKey = Cache.packageKey(pkg.system, pkg.name);
        const cached = this.cache.get(cacheKey);
        if (cached) {
          cacheSummary.hits++;
          results.push({ system: pkg.system, name: pkg.name, cached: true, result: cached });
        } else {
          cacheSummary.misses++;
        }
      }
      if (cacheSummary.misses > 0) {
        const toFetch = packages.filter(pkg => !this.cache.get(Cache.packageKey(pkg.system, pkg.name)));
        const fetchResults = await this.client.getPackageVersionsBatch(toFetch);
        for (const item of fetchResults) {
          if (item.result) {
            const cacheKey = Cache.packageKey(item.system, item.name);
            this.cache.set(cacheKey, item.result, item.system);
          }
          results.push({ system: item.system, name: item.name, cached: false, result: item.result, error: item.error });
        }
      }
      const summary = { total: packages.length, successful: results.filter(r => r.result).length, failed: results.filter(r => r.error).length, cached: cacheSummary.hits };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ results, summary }, null, 2) }], structuredContent: { results, summary } as Record<string, unknown> };
    } catch (error) {
      return formatError(error);
    }
  }

  async getLatestVersionsBatch(args: z.infer<typeof GetLatestVersionsBatchSchema>) {
    try {
      const { packages } = args;
      if (packages.length === 0) return { content: [{ type: 'text' as const, text: JSON.stringify({ packages: [], summary: { total: 0, successful: 0, failed: 0, cached: 0 } }, null, 2) }], structuredContent: { results: [], summary: { total: 0, successful: 0, failed: 0, cached: 0 } } as Record<string, unknown> };
      const results: any[] = [];
      const cacheSummary = { hits: 0, misses: 0 };
      for (const pkg of packages) {
        const cacheKey = Cache.packageKey(pkg.system, pkg.name);
        const cached = this.cache.get(cacheKey);
        if (cached) {
          cacheSummary.hits++;
          results.push({ system: pkg.system, name: pkg.name, cached: true, result: cached });
        } else {
          cacheSummary.misses++;
        }
      }
      if (cacheSummary.misses > 0) {
        const toFetch = packages.filter(pkg => {
          const cacheKey = Cache.packageKey(pkg.system, pkg.name);
          return !this.cache.get(cacheKey);
        });
        const fetchResults = await this.client.getLatestVersionsBatch(toFetch);
        for (const item of fetchResults) {
          if (item.result) {
            const pkg = toFetch.find(p => p.system === item.system && p.name === item.name);
            if (pkg) {
              const cacheKey = Cache.packageKey(item.system, item.name);
              this.cache.set(cacheKey, item.result, item.system);
            }
          }
          results.push({ system: item.system, name: item.name, cached: false, result: item.result, error: item.error });
        }
      }
      const summary = { total: packages.length, successful: results.filter(r => r.result).length, failed: results.filter(r => r.error).length, cached: cacheSummary.hits };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ results, summary }, null, 2) }], structuredContent: { results, summary } as Record<string, unknown> };
    } catch (error) {
      return formatError(error);
    }
  }

  private purlSystemMap: Record<string,string> = {
    NPM: 'npm',
    CARGO: 'cargo',
    PYPI: 'pypi',
    GO: 'golang',
    RUBYGEMS: 'gem',
    NUGET: 'nuget'
  };

  async generatePurl(args: z.infer<typeof GeneratePurlSchema>) {
    try {
      const { system, name, version, includePrerelease = false } = args;
      let finalVersion = version;
      let source: 'provided' | 'latest_fetched' = 'provided';
      if (!finalVersion) {
        const latest = await this.getLatestVersion({ system, name, includePrerelease });
        if ('structuredContent' in latest) {
          finalVersion = (latest.structuredContent as any).version;
          source = 'latest_fetched';
        } else {
          throw new Error('Failed to resolve latest version');
        }
      }
      if (!finalVersion) throw new Error('No version available');
      const purl = `pkg:${this.purlSystemMap[system]}/${name}@${finalVersion}`;
      const structured = { purl, system, name, version: finalVersion, source };
      return { content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }], structuredContent: structured as Record<string, unknown> };
    } catch (error) {
      return formatError(error);
    }
  }

  async generatePurlsBatch(args: z.infer<typeof GeneratePurlsBatchSchema>) {
    try {
      const { packages } = args;
      const results: any[] = [];
      for (const pkg of packages) {
        const single = await this.generatePurl(pkg);
        if ('structuredContent' in single) {
          results.push(single.structuredContent);
        } else {
          results.push({ system: pkg.system, name: pkg.name, error: (single.content?.[0]?.text) || 'Unknown error' });
        }
      }
      const structured = { total: packages.length, results };
      return { content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }], structuredContent: structured as Record<string, unknown> };
    } catch (error) {
      return formatError(error);
    }
  }
}

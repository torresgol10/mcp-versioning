import { SystemType } from '../constants/systems.js';
import { PackageVersionsResponse, LatestVersionResponse, DepsDevError } from '../types/index.js';
import { valid, rcompare, parse as parseSemver } from 'semver';

const DEPS_DEV_API_BASE = 'https://api.deps.dev/v3alpha';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff with jitter
 */
function getBackoffDelay(attempt: number): number {
  const exponentialDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return exponentialDelay + jitter;
}

/**
 * Determine if an error is retriable
 */
function isRetriableError(status?: number): boolean {
  if (!status) return true; // Network errors are retriable
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(url: string, endpoint: string): Promise<Response> {
  let lastError: Error | null = null;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      
      if (response.ok) {
        return response;
      }

      lastStatus = response.status;

      // Handle non-2xx responses
      if (!isRetriableError(response.status)) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw {
          status: response.status,
          endpoint,
          message: `HTTP ${response.status}: ${errorText}`,
        } as DepsDevError;
      }

      // For retriable errors, continue to retry logic below
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error: any) {
      if (error.status) {
        // Already a DepsDevError, throw it
        throw error;
      }

      lastError = error;
      lastStatus = undefined;

      // Network errors are retriable
      if (!isRetriableError(lastStatus)) {
        throw {
          status: 0,
          endpoint,
          message: `Network error: ${error.message}`,
        } as DepsDevError;
      }
    }

    // Wait before retrying (except on last attempt)
    if (attempt < MAX_RETRIES - 1) {
      const delay = getBackoffDelay(attempt);
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw {
    status: lastStatus || 0,
    endpoint,
    message: `Failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`,
  } as DepsDevError;
}

/**
 * DepsDevClient - Client for deps.dev API v3alpha
 */
export class DepsDevClient {
  /**
   * Get all versions for a package
   */
  async getPackageVersions(system: SystemType, name: string): Promise<PackageVersionsResponse> {
    const encodedName = encodeURIComponent(name);
    const url = `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedName}`;
    const endpoint = `GET /systems/${system}/packages/${name}`;

    const response = await fetchWithRetry(url, endpoint);
    const data = await response.json() as any;

    // Map deps.dev response to our format
    const versions = (data.versions || []).map((v: any) => ({
      version: v.versionKey?.version || v.version,
      publishedAt: v.publishedAt,
      isDefault: v.isDefault || false,
      isDeprecated: v.isDeprecated || false,
    }));

    return {
      system: data.packageKey?.system || system,
      name: data.packageKey?.name || name,
      versions,
    };
  }

  /**
   * Get the latest version for a package
   */
  async getLatestVersion(
    system: SystemType,
    name: string,
    includePrerelease = false
  ): Promise<LatestVersionResponse> {
    const versionsData = await this.getPackageVersions(system, name);

    if (versionsData.versions.length === 0) {
      throw {
        status: 404,
        endpoint: `GET /systems/${system}/packages/${name}`,
        message: 'No versions found for package',
      } as DepsDevError;
    }

    // Find default version first
    const defaultVersion = versionsData.versions.find(v => v.isDefault);
    if (defaultVersion && !defaultVersion.isDeprecated) {
      return {
        version: defaultVersion.version,
        publishedAt: defaultVersion.publishedAt,
        isDefault: true,
      };
    }

    // Filter deprecated
    let candidateVersions = versionsData.versions.filter(v => !v.isDeprecated);
    // If not including prerelease, drop semver prereleases when detectable
    if (!includePrerelease) {
      candidateVersions = candidateVersions.filter(v => {
        const sv = parseSemver(v.version, { loose: true });
        return !sv || sv.prerelease.length === 0; // keep if parse fails (non-semver) or no prerelease
      });
    }
    // Sort using semver when possible, fallback to lexicographic
    const sortedVersions = candidateVersions.sort((a, b) => {
      const va = valid(a.version, { loose: true });
      const vb = valid(b.version, { loose: true });
      if (va && vb) return rcompare(va, vb); // descending
      if (va && !vb) return -1; // valid semver before non-semver
      if (!va && vb) return 1;
      return b.version.localeCompare(a.version);
    });

    if (sortedVersions.length === 0) {
      throw {
        status: 404,
        endpoint: `GET /systems/${system}/packages/${name}`,
        message: 'No non-deprecated versions found',
      } as DepsDevError;
    }

    return {
      version: sortedVersions[0].version,
      publishedAt: sortedVersions[0].publishedAt,
      isDefault: sortedVersions[0].isDefault,
    };
  }

  /**
   * Search/validate a package exists
   */
  async findPackage(system: SystemType, name: string): Promise<{ exists: boolean; versionsCount: number }> {
    try {
      const versionsData = await this.getPackageVersions(system, name);
      return {
        exists: true,
        versionsCount: versionsData.versions.length,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { exists: false, versionsCount: 0 };
      }
      throw error;
    }
  }

  /**
   * Get package versions for multiple packages in parallel (batch)
   */
  async getPackageVersionsBatch(
    packages: Array<{ system: SystemType; name: string }>
  ): Promise<Array<{ system: SystemType; name: string; result?: PackageVersionsResponse; error?: string }>> {
    const results = await Promise.allSettled(
      packages.map(async ({ system, name }) => {
        try {
          const result = await this.getPackageVersions(system, name);
          return { system, name, result };
        } catch (error: any) {
          return { system, name, error: error.message || String(error) };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          system: packages[index].system,
          name: packages[index].name,
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }

  /**
   * Get latest versions for multiple packages in parallel (batch)
   */
  async getLatestVersionsBatch(
    packages: Array<{ system: SystemType; name: string; includePrerelease?: boolean }>
  ): Promise<Array<{ system: SystemType; name: string; result?: LatestVersionResponse; error?: string }>> {
    const results = await Promise.allSettled(
      packages.map(async ({ system, name, includePrerelease }) => {
        try {
          const result = await this.getLatestVersion(system, name, includePrerelease);
          return { system, name, result };
        } catch (error: any) {
          return { system, name, error: error.message || String(error) };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          system: packages[index].system,
          name: packages[index].name,
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }
}

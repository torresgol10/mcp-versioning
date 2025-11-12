import assert from 'assert';
import test from 'node:test';
import { VersionTools } from '../src/tools/index.js';
import { DepsDevClient } from '../src/depsdev/client.js';
import { Cache } from '../src/cache/cache.js';
import type { SystemType } from '../src/constants/systems.js';
import type { PackageVersionsResponse, LatestVersionResponse } from '../src/types/index.js';

// Lightweight mock for DepsDevClient to avoid network calls
class MockClient extends DepsDevClient {
  constructor(){ super(); }
  async getPackageVersions(system: SystemType, name: string): Promise<PackageVersionsResponse> {
    return { system, name, versions: [ { version: '1.0.0', isDefault: true } ] };
  }
  async getLatestVersion(system: SystemType, name: string): Promise<LatestVersionResponse> {
    return { version: '1.0.0', isDefault: true };
  }
  async getPackageVersionsBatch(packages: Array<{ system: SystemType; name: string }>) {
    return packages.map(p => ({
      system: p.system,
      name: p.name,
      result: { system: p.system, name: p.name, versions: [{ version: '1.0.0', isDefault: true }] }
    }));
  }
  async getLatestVersionsBatch(packages: Array<{ system: SystemType; name: string; includePrerelease?: boolean }>) {
    return packages.map(p => ({
      system: p.system,
      name: p.name,
      result: { version: '1.0.0', isDefault: true }
    }));
  }
}

const client = new MockClient();
const cache = new Cache();
const tools = new VersionTools(client, cache);

function hasStructuredContent(x: any): x is { structuredContent: Record<string, any>; content: any[] } {
  return x && typeof x === 'object' && 'structuredContent' in x;
}

test('get_package_versions returns structuredContent with name', async () => {
  const r1 = await tools.getPackageVersions({ system: 'NPM', name: 'react' });
  assert.ok(hasStructuredContent(r1));
  assert.equal((r1.structuredContent as any).name, 'react');
});

test('get_latest_version returns structuredContent with version', async () => {
  const r2 = await tools.getLatestVersion({ system: 'NPM', name: 'react' });
  assert.ok(hasStructuredContent(r2));
  assert.equal((r2.structuredContent as any).version, '1.0.0');
});

test('get_package_versions_batch returns single result', async () => {
  const r3 = await tools.getPackageVersionsBatch({ packages: [{ system:'NPM', name:'react' }] });
  assert.ok(hasStructuredContent(r3));
  assert.equal((r3.structuredContent as any).results.length, 1);
});

test('get_latest_versions_batch returns single result', async () => {
  const r4 = await tools.getLatestVersionsBatch({ packages: [{ system:'NPM', name:'react' }] });
  assert.ok(hasStructuredContent(r4));
  assert.equal((r4.structuredContent as any).results.length, 1);
});

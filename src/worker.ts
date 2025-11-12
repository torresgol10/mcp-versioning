import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DepsDevClient } from './depsdev/client.js';
import { Cache } from './cache/cache.js';
import toml from 'toml';
import { XMLParser } from 'fast-xml-parser';

// Zod Schemas (duplicated to avoid Node-only imports)
const SUPPORTED_SYSTEMS = ['NPM','CARGO','PYPI','GO','RUBYGEMS','NUGET'] as const;

const GetPackageVersionsSchema = z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string() });
const GetLatestVersionSchema = z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string(), includePrerelease: z.boolean().optional() });
const InspectManifestSchema = z.object({ manifestPath: z.string(), content: z.string() }); // content required in worker
const GetPackageVersionsBatchSchema = z.object({ packages: z.array(z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string() })) });
const GetLatestVersionsBatchSchema = z.object({ packages: z.array(z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string(), includePrerelease: z.boolean().optional() })) });
const GeneratePurlSchema = z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string(), version: z.string().optional(), includePrerelease: z.boolean().optional() });
const GeneratePurlsBatchSchema = z.object({ packages: z.array(z.object({ system: z.enum(SUPPORTED_SYSTEMS), name: z.string(), version: z.string().optional(), includePrerelease: z.boolean().optional() })) });

// Singletons
const client = new DepsDevClient();
const cache = new Cache();

// Hash helper using Web Crypto
async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

// Manifest parsing (subset identical to node version minus fs)
function parsePackageJson(content: string) {
  const json = JSON.parse(content);
  const deps: any[] = [];
  const pushDeps = (obj: Record<string,string>|undefined, kind: string) => {
    if (!obj) return;
    for (const [name, spec] of Object.entries(obj)) {
      deps.push({ system: 'NPM', name, spec, kind, source: 'manifest' });
    }
  };
  pushDeps(json.dependencies,'prod');
  pushDeps(json.devDependencies,'dev');
  pushDeps(json.peerDependencies,'peer');
  pushDeps(json.optionalDependencies,'optional');
  return { system: 'NPM', dependencies: deps, warnings: [], metadata: { workspace: !!json.workspaces } };
}

function parseCargoToml(content: string) {
  const data = toml.parse(content);
  const sections = ['dependencies','dev-dependencies','build-dependencies'];
  const deps: any[] = [];
  for (const sec of sections) {
    const block = (data as any)[sec];
    if (!block) continue;
    for (const [name, val] of Object.entries(block)) {
      let spec = typeof val === 'string' ? val : (val as any).version || '*';
      deps.push({ system: 'CARGO', name, spec, kind: sec.replace('-dependencies',''), source: 'manifest' });
    }
  }
  return { system: 'CARGO', dependencies: deps, warnings: [], metadata: {} };
}

function parsePyProject(content: string) {
  // Minimal extraction using regex for version specs
  const deps: any[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"?([^"]+)"?/);
    if (m) deps.push({ system: 'PYPI', name: m[1], spec: m[2], kind: 'prod', source: 'manifest' });
  }
  return { system: 'PYPI', dependencies: deps, warnings: [], metadata: {} };
}

function parseRequirementsTxt(content: string) {
  const deps: any[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)([><=~!].+)?$/);
    if (m) deps.push({ system: 'PYPI', name: m[1], spec: m[2] || '*', kind: 'prod', source: 'manifest' });
  }
  return { system: 'PYPI', dependencies: deps, warnings: [], metadata: {} };
}

function parseGemfile(content: string) {
  const deps: any[] = [];
  const gemRegex = /gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/g;
  let match: RegExpExecArray | null;
  while ((match = gemRegex.exec(content))) {
    deps.push({ system: 'RUBYGEMS', name: match[1], spec: match[2] || '*', kind: 'prod', source: 'manifest' });
  }
  return { system: 'RUBYGEMS', dependencies: deps, warnings: [], metadata: {} };
}

function parseGoMod(content: string) {
  const deps: any[] = [];
  const requireBlock = /require\s*\(([^)]+)\)/m.exec(content);
  const singleRequireRegex = /^require\s+([^\s]+)\s+([^\s]+)$/m;
  const addDepLine = (line: string) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) deps.push({ system: 'GO', name: parts[0], spec: parts[1], kind: 'prod', source: 'manifest' });
  };
  if (requireBlock) {
    for (const line of requireBlock[1].split(/\r?\n/)) if (line.trim()) addDepLine(line);
  } else {
    const m = singleRequireRegex.exec(content);
    if (m) deps.push({ system: 'GO', name: m[1], spec: m[2], kind: 'prod', source: 'manifest' });
  }
  return { system: 'GO', dependencies: deps, warnings: [], metadata: {} };
}

function parseCsProj(content: string) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(content);
  const deps: any[] = [];
  const items = xml.Project?.ItemGroup || [];
  const groups = Array.isArray(items) ? items : [items];
  for (const group of groups) {
    for (const kind of ['PackageReference','DotNetCliToolReference']) {
      const refs = group[kind];
      if (!refs) continue;
      const list = Array.isArray(refs) ? refs : [refs];
      for (const r of list) {
        const name = r['@_Include'];
        const spec = r['@_Version'] || '*';
        if (name) deps.push({ system: 'NUGET', name, spec, kind: 'prod', source: 'manifest' });
      }
    }
  }
  return { system: 'NUGET', dependencies: deps, warnings: [], metadata: {} };
}

async function inspectManifestWorker(manifestPath: string, content: string) {
  const lower = manifestPath.toLowerCase();
  if (lower.endsWith('package.json')) return parsePackageJson(content);
  if (lower.endsWith('cargo.toml')) return parseCargoToml(content);
  if (lower.endsWith('pyproject.toml')) return parsePyProject(content);
  if (lower.endsWith('requirements.txt')) return parseRequirementsTxt(content);
  if (lower.endsWith('gemfile')) return parseGemfile(content);
  if (lower.endsWith('go.mod')) return parseGoMod(content);
  if (lower.endsWith('.csproj') || lower.endsWith('.fsproj') || lower.endsWith('.vbproj')) return parseCsProj(content);
  return { system: 'NPM', dependencies: [], warnings: ['Tipo de manifiesto no soportado en Worker'], metadata: {} };
}

const toolRegistry = [
  { name: 'get_package_versions', description: 'Get all versions for a package', inputSchema: zodToJsonSchema(GetPackageVersionsSchema), outputSchema: { type: 'object', properties: { system: { type: 'string' }, name: { type: 'string' }, versions: { type: 'array', items: { type: 'object' } } } } },
  { name: 'get_latest_version', description: 'Get latest version for a package', inputSchema: zodToJsonSchema(GetLatestVersionSchema), outputSchema: { type: 'object', properties: { version: { type: 'string' }, publishedAt: { type: 'string' }, isDefault: { type: 'boolean' } } } },
  { name: 'inspect_manifest', description: 'Parse manifest (content obligatorio en Worker)', inputSchema: zodToJsonSchema(InspectManifestSchema), outputSchema: { type: 'object', properties: { system: { type: 'string' }, dependencies: { type: 'array' }, warnings: { type: 'array', items: { type: 'string' } } } } },
  { name: 'get_package_versions_batch', description: 'Batch package versions', inputSchema: zodToJsonSchema(GetPackageVersionsBatchSchema), outputSchema: { type: 'object', properties: { total: { type: 'number' }, results: { type: 'array' } } } },
  { name: 'get_latest_versions_batch', description: 'Batch latest versions', inputSchema: zodToJsonSchema(GetLatestVersionsBatchSchema), outputSchema: { type: 'object', properties: { total: { type: 'number' }, results: { type: 'array' } } } },
  { name: 'generate_purl', description: 'Generate a PURL for a single package', inputSchema: zodToJsonSchema(GeneratePurlSchema), outputSchema: { type: 'object', properties: { purl: { type: 'string' }, system: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, source: { type: 'string' } } } },
  { name: 'generate_purls_batch', description: 'Generate PURLs for multiple packages', inputSchema: zodToJsonSchema(GeneratePurlsBatchSchema), outputSchema: { type: 'object', properties: { total: { type: 'number' }, results: { type: 'array' } } } }
];

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function makeError(id: JsonRpcResponse['id'], code: number, message: string, data?: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

async function handleToolCall(name: string, args: any) {
  switch (name) {
    case 'get_package_versions': {
      const parsed = GetPackageVersionsSchema.parse(args);
      const cacheKey = Cache.packageKey(parsed.system, parsed.name);
      const hit = cache.get(cacheKey);
      if (hit) return { content: [{ type: 'text', text: JSON.stringify(hit, null, 2) }], structuredContent: hit };
      const result = await client.getPackageVersions(parsed.system, parsed.name);
      cache.set(cacheKey, result, parsed.system);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }
    case 'get_latest_version': {
      const parsed = GetLatestVersionSchema.parse(args);
      const cacheKey = Cache.packageKey(parsed.system, parsed.name);
      const hit = cache.get(cacheKey);
      if (hit && (hit as any).versions) {
        const versions = (hit as any).versions;
        const latest = versions.find((v: any) => v.isDefault) || versions[0];
        return { content: [{ type: 'text', text: JSON.stringify(latest, null, 2) }], structuredContent: latest };
      }
      const result = await client.getLatestVersion(parsed.system, parsed.name, parsed.includePrerelease || false);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }
    case 'inspect_manifest': {
      const parsed = InspectManifestSchema.parse(args);
      const h = await hashContent(parsed.content);
      const cacheKey = Cache.packageKey('NPM', `${parsed.manifestPath}:${h}`);
      const hit = cache.get(cacheKey);
      if (hit) return { content: [{ type: 'text', text: JSON.stringify(hit, null, 2) }], structuredContent: hit };
      const result = await inspectManifestWorker(parsed.manifestPath, parsed.content);
      cache.set(cacheKey, result, 'NPM');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }
    case 'get_package_versions_batch': {
      const parsed = GetPackageVersionsBatchSchema.parse(args);
      const toFetch: typeof parsed.packages = [];
      const results: any[] = [];
      for (const p of parsed.packages) {
        const cacheKey = Cache.packageKey(p.system, p.name);
        const hit = cache.get(cacheKey);
        if (hit) {
          results.push({ system: p.system, name: p.name, cached: true, result: hit });
        } else {
          toFetch.push(p);
        }
      }
      if (toFetch.length) {
        const fetched = await client.getPackageVersionsBatch(toFetch);
        for (const r of fetched) {
          if (r.result) cache.set(Cache.packageKey(r.system, r.name), r.result, r.system);
          results.push({ system: r.system, name: r.name, cached: false, result: r.result, error: r.error });
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ total: parsed.packages.length, results }, null, 2) }], structuredContent: { total: parsed.packages.length, results } };
    }
    case 'get_latest_versions_batch': {
      const parsed = GetLatestVersionsBatchSchema.parse(args);
      const fetched = await client.getLatestVersionsBatch(parsed.packages);
      return { content: [{ type: 'text', text: JSON.stringify({ total: parsed.packages.length, results: fetched }, null, 2) }], structuredContent: { total: parsed.packages.length, results: fetched } };
    }
    case 'generate_purl': {
      const parsed = GeneratePurlSchema.parse(args);
      let version = parsed.version;
      let source: 'provided' | 'latest_fetched' = 'provided';
      if (!version) {
        const latest = await client.getLatestVersion(parsed.system, parsed.name, parsed.includePrerelease || false);
        version = latest.version;
        source = 'latest_fetched';
      }
      const systemMap: Record<string,string> = { NPM:'npm', CARGO:'cargo', PYPI:'pypi', GO:'golang', RUBYGEMS:'gem', NUGET:'nuget' };
      const purl = `pkg:${systemMap[parsed.system]}/${parsed.name}@${version}`;
      const structured = { purl, system: parsed.system, name: parsed.name, version, source };
      return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    }
    case 'generate_purls_batch': {
      const parsed = GeneratePurlsBatchSchema.parse(args);
      const results: any[] = [];
      for (const p of parsed.packages) {
        try {
          const single = await handleToolCall('generate_purl', p);
          if ((single as any).structuredContent) {
            results.push((single as any).structuredContent);
          } else {
            results.push({ system: p.system, name: p.name, error: 'Unknown error' });
          }
        } catch (e: any) {
          results.push({ system: p.system, name: p.name, error: e.message || String(e) });
        }
      }
      const structured = { total: parsed.packages.length, results };
      return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function processRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  try {
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: toolRegistry.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            outputSchema: t.outputSchema,
          }))
        }
      };
    }

    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string') {
        return makeError(id, -32602, 'Invalid params: expected { name, arguments }');
      }
      const result = await handleToolCall(params.name, params.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result: result
      };
    }

    return makeError(id, -32601, `Method not found: ${method}`);
  } catch (err: any) {
    return makeError(id, -32000, err.message || 'Internal error');
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health/info endpoint
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({
        name: (globalThis as any).MCP_SERVER_NAME || 'mcp-versioning',
        version: (globalThis as any).MCP_SERVER_VERSION || '0.2.1',
        tools: toolRegistry.map(t => t.name),
        cacheStats: cache.stats()
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (req.method !== 'POST') {
      return new Response('Only POST supported for JSON-RPC', { status: 405 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify(makeError(null, -32700, 'Parse error')), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Batch or single
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((r: any) => processRpc(r)));
      return new Response(JSON.stringify(responses), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const response = await processRpc(body as JsonRpcRequest);
      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
};

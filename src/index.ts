#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DepsDevClient } from './depsdev/client.js';
import { Cache } from './cache/cache.js';
import {
  VersionTools,
  GetPackageVersionsSchema,
  GetLatestVersionSchema,
  InspectManifestSchema,
  GetPackageVersionsBatchSchema,
  GetLatestVersionsBatchSchema,
} from './tools/index.js';
import { SUPPORTED_SYSTEMS } from './constants/systems.js';

/**
 * MCP Server for querying package versions across ecosystems
 */
class VersioningMCPServer {
  private server: McpServer;
  private client: DepsDevClient;
  private cache: Cache;
  private tools: VersionTools;

  constructor() {
    this.server = new McpServer(
        {
          name: 'MCP Versioning Server',
          version: '0.2.1',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.client = new DepsDevClient();
    this.cache = new Cache(1000);
    this.tools = new VersionTools(this.client, this.cache);

    this.registerTools();

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private registerTools() {
    // Register: get_package_versions
    this.server.registerTool(
      'get_package_versions',
      {
        description: 'Get all versions for a package in a specific ecosystem (NPM, CARGO, PYPI, GO, RUBYGEMS, NUGET)',
        inputSchema: {
          system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]).describe('Package ecosystem'),
          name: z.string().describe('Package name'),
        },
        outputSchema: {
          system: z.string(),
          name: z.string(),
          versions: z.array(
            z.object({
              version: z.string(),
              publishedAt: z.string().optional(),
              isDefault: z.boolean().optional(),
              isDeprecated: z.boolean().optional(),
            })
          )
        }
      },
      async (args) => {
        return await this.tools.getPackageVersions(args as z.infer<typeof GetPackageVersionsSchema>);
      }
    );

    // Register: get_latest_version
    this.server.registerTool(
      'get_latest_version',
      {
        description: 'Get the latest version for a package',
        inputSchema: {
          system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]).describe('Package ecosystem'),
          name: z.string().describe('Package name'),
          includePrerelease: z.boolean().optional().describe('Include prerelease versions (default: false)'),
        },
        outputSchema: {
          version: z.string(),
          publishedAt: z.string().optional(),
          isDefault: z.boolean().optional(),
          isDeprecated: z.boolean().optional(),
        }
      },
      async (args) => {
        return await this.tools.getLatestVersion(args as z.infer<typeof GetLatestVersionSchema>);
      }
    );

    // Register: inspect_manifest
    this.server.registerTool(
      'inspect_manifest',
      {
        description: 'Parse a manifest file (package.json, Cargo.toml, pyproject.toml, requirements.txt, Gemfile, go.mod) and extract dependencies. IMPORTANT: Provide the "content" parameter with the file contents to avoid multiple permission prompts.',
        inputSchema: {
          manifestPath: z.string().describe('Path to the manifest file (used for detecting ecosystem type)'),
          content: z.string().optional().describe('Manifest file content (RECOMMENDED: pass this to avoid permission prompts)'),
        },
        outputSchema: {
          system: z.string(),
          dependencies: z.array(
            z.object({
              system: z.string(),
              name: z.string(),
              spec: z.string().optional(),
              kind: z.string(),
              source: z.string(),
            })
          ),
          warnings: z.array(z.string()),
          metadata: z.object({}).passthrough()
        }
      },
      async (args) => {
        return await this.tools.inspectManifest(args as z.infer<typeof InspectManifestSchema>);
      }
    );

    // Register: get_package_versions_batch
    this.server.registerTool(
      'get_package_versions_batch',
      {
        description: 'Get all versions for multiple packages in parallel (batch operation). Efficient for checking many packages at once. Supports up to 50 packages per request.',
        inputSchema: {
          packages: z.array(
            z.object({
              system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]).describe('Package ecosystem'),
              name: z.string().describe('Package name'),
            })
          ).describe('Array of packages to query'),
        },
        outputSchema: {
          total: z.number(),
          successful: z.number().optional(),
          failed: z.number().optional(),
          cached: z.number().optional(),
          results: z.array(
            z.object({
              system: z.string(),
              name: z.string(),
              cached: z.boolean().optional(),
              result: z.any().optional(),
              error: z.string().optional(),
            })
          )
        }
      },
      async (args) => {
        return await this.tools.getPackageVersionsBatch(args as z.infer<typeof GetPackageVersionsBatchSchema>);
      }
    );

    // Register: get_latest_versions_batch
    this.server.registerTool(
      'get_latest_versions_batch',
      {
        description: 'Get the latest version for multiple packages in parallel (batch operation). Efficient for checking updates across many packages. Supports up to 50 packages per request.',
        inputSchema: {
          packages: z.array(
            z.object({
              system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]).describe('Package ecosystem'),
              name: z.string().describe('Package name'),
              includePrerelease: z.boolean().optional().describe('Include prerelease versions (default: false)'),
            })
          ).describe('Array of packages to query'),
        },
        outputSchema: {
          total: z.number(),
          successful: z.number().optional(),
          failed: z.number().optional(),
          cached: z.number().optional(),
          results: z.array(
            z.object({
              system: z.string(),
              name: z.string(),
              result: z.any().optional(),
              error: z.string().optional(),
            })
          )
        }
      },
      async (args) => {
        return await this.tools.getLatestVersionsBatch(args as z.infer<typeof GetLatestVersionsBatchSchema>);
      }
    );

    // Register: generate_purl
    this.server.registerTool(
      'generate_purl',
      {
        description: 'Generate a Package URL (PURL) for a given package. If version is omitted, latest version is resolved first.',
        inputSchema: {
          system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]).describe('Package ecosystem'),
          name: z.string().describe('Package name'),
          version: z.string().optional().describe('Explicit version (optional)'),
          includePrerelease: z.boolean().optional().describe('Include prerelease resolution when version omitted'),
        },
        outputSchema: {
          purl: z.string(),
          system: z.string(),
          name: z.string(),
          version: z.string(),
          source: z.enum(['provided','latest_fetched'])
        }
      },
      async (args) => {
        const { GeneratePurlSchema } = await import('./tools/index.js');
        return await this.tools.generatePurl(args as z.infer<typeof GeneratePurlSchema>);
      }
    );

    // Register: generate_purls_batch
    this.server.registerTool(
      'generate_purls_batch',
      {
        description: 'Generate PURLs for multiple packages. Versions resolved when omitted.',
        inputSchema: {
          packages: z.array(
            z.object({
              system: z.enum(Array.from(SUPPORTED_SYSTEMS) as [string, ...string[]]),
              name: z.string(),
              version: z.string().optional(),
              includePrerelease: z.boolean().optional(),
            })
          ).describe('Packages for which to generate PURLs'),
        },
        outputSchema: {
          total: z.number(),
          results: z.array(
            z.object({
              purl: z.string().optional(),
              system: z.string(),
              name: z.string(),
              version: z.string().optional(),
              source: z.string().optional(),
              error: z.string().optional(),
            })
          )
        }
      },
      async (args) => {
        const { GeneratePurlsBatchSchema } = await import('./tools/index.js');
        return await this.tools.generatePurlsBatch(args as z.infer<typeof GeneratePurlsBatchSchema>);
      }
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Versioning Server running on stdio');
  }
}

// Start server
const server = new VersioningMCPServer();
server.run().catch(console.error);

import { readFile } from 'fs/promises';
import { parse as parseToml } from 'toml';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'crypto';
import { SystemType, MANIFEST_TO_SYSTEM } from '../constants/systems.js';
import { DependencySpec, InspectManifestResponse } from '../types/index.js';

const MAX_MANIFEST_SIZE = 256 * 1024; // 256 KB

/**
 * Calculate SHA256 hash of content for cache keys
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect system from manifest filename
 */
export function detectSystemFromFilename(filename: string): SystemType | null {
  const basename = filename.split(/[/\\]/).pop() || '';
  return MANIFEST_TO_SYSTEM[basename] || null;
}

/**
 * Parse package.json (NPM)
 */
function parsePackageJson(content: string): InspectManifestResponse {
  const pkg = JSON.parse(content);
  const dependencies: DependencySpec[] = [];
  const warnings: string[] = [];

  // Production dependencies
  if (pkg.dependencies) {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      const specStr = spec as string;
      
      // Skip workspace protocol, git URLs, file paths
      if (specStr.startsWith('workspace:') || specStr.startsWith('link:')) {
        warnings.push(`Skipping workspace dependency: ${name}`);
        continue;
      }
      if (specStr.startsWith('git+') || specStr.startsWith('http')) {
        warnings.push(`Skipping VCS dependency: ${name}`);
        continue;
      }
      if (specStr.startsWith('file:') || specStr.startsWith('.') || specStr.startsWith('/')) {
        warnings.push(`Skipping file dependency: ${name}`);
        continue;
      }

      dependencies.push({
        system: 'NPM',
        name,
        spec: specStr,
        kind: 'prod',
        source: 'manifest',
      });
    }
  }

  // Dev dependencies
  if (pkg.devDependencies) {
    for (const [name, spec] of Object.entries(pkg.devDependencies)) {
      const specStr = spec as string;
      if (!specStr.startsWith('workspace:') && !specStr.startsWith('git+') && !specStr.startsWith('file:')) {
        dependencies.push({
          system: 'NPM',
          name,
          spec: specStr,
          kind: 'dev',
          source: 'manifest',
        });
      }
    }
  }

  // Optional dependencies
  if (pkg.optionalDependencies) {
    for (const [name, spec] of Object.entries(pkg.optionalDependencies)) {
      const specStr = spec as string;
      if (!specStr.startsWith('workspace:') && !specStr.startsWith('git+') && !specStr.startsWith('file:')) {
        dependencies.push({
          system: 'NPM',
          name,
          spec: specStr,
          kind: 'optional',
          source: 'manifest',
        });
      }
    }
  }

  // Peer dependencies
  if (pkg.peerDependencies) {
    for (const [name, spec] of Object.entries(pkg.peerDependencies)) {
      const specStr = spec as string;
      if (!specStr.startsWith('workspace:') && !specStr.startsWith('git+') && !specStr.startsWith('file:')) {
        dependencies.push({
          system: 'NPM',
          name,
          spec: specStr,
          kind: 'peer',
          source: 'manifest',
        });
      }
    }
  }

  return {
    system: 'NPM',
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
    metadata: {
      workspace: !!pkg.workspaces,
    },
  };
}

/**
 * Parse Cargo.toml (Rust)
 */
function parseCargoToml(content: string): InspectManifestResponse {
  const cargo = parseToml(content);
  const dependencies: DependencySpec[] = [];
  const warnings: string[] = [];

  // Production dependencies
  if (cargo.dependencies) {
    for (const [name, spec] of Object.entries(cargo.dependencies)) {
      if (typeof spec === 'string') {
        dependencies.push({
          system: 'CARGO',
          name,
          spec,
          kind: 'prod',
          source: 'manifest',
        });
      } else if (typeof spec === 'object' && spec !== null) {
        const depObj = spec as any;
        
        // Skip path and git dependencies
        if (depObj.path) {
          warnings.push(`Skipping path dependency: ${name}`);
          continue;
        }
        if (depObj.git) {
          warnings.push(`Skipping git dependency: ${name}`);
          continue;
        }

        if (depObj.version) {
          dependencies.push({
            system: 'CARGO',
            name,
            spec: depObj.version,
            kind: 'prod',
            source: 'manifest',
          });
        }
      }
    }
  }

  // Dev dependencies
  if (cargo['dev-dependencies']) {
    for (const [name, spec] of Object.entries(cargo['dev-dependencies'])) {
      if (typeof spec === 'string') {
        dependencies.push({
          system: 'CARGO',
          name,
          spec,
          kind: 'dev',
          source: 'manifest',
        });
      } else if (typeof spec === 'object' && spec !== null) {
        const depObj = spec as any;
        if (!depObj.path && !depObj.git && depObj.version) {
          dependencies.push({
            system: 'CARGO',
            name,
            spec: depObj.version,
            kind: 'dev',
            source: 'manifest',
          });
        }
      }
    }
  }

  // Build dependencies
  if (cargo['build-dependencies']) {
    for (const [name, spec] of Object.entries(cargo['build-dependencies'])) {
      if (typeof spec === 'string') {
        dependencies.push({
          system: 'CARGO',
          name,
          spec,
          kind: 'build',
          source: 'manifest',
        });
      } else if (typeof spec === 'object' && spec !== null) {
        const depObj = spec as any;
        if (!depObj.path && !depObj.git && depObj.version) {
          dependencies.push({
            system: 'CARGO',
            name,
            spec: depObj.version,
            kind: 'build',
            source: 'manifest',
          });
        }
      }
    }
  }

  return {
    system: 'CARGO',
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
    metadata: {
      workspace: !!cargo.workspace,
    },
  };
}

/**
 * Parse pyproject.toml (Python)
 */
function parsePyprojectToml(content: string): InspectManifestResponse {
  const pyproject = parseToml(content);
  const dependencies: DependencySpec[] = [];
  const warnings: string[] = [];

  // PEP 621 format
  if (pyproject.project?.dependencies) {
    for (const dep of pyproject.project.dependencies) {
      // Parse PEP 440 format: "package>=1.0.0" or "package[extra]>=1.0.0"
      const match = dep.match(/^([a-zA-Z0-9_-]+)(?:\[.*?\])?\s*(.*)$/);
      if (match) {
        const [, name, spec] = match;
        dependencies.push({
          system: 'PYPI',
          name: name.toLowerCase().replace(/_/g, '-'), // Normalize PyPI names
          spec: spec || undefined,
          kind: 'prod',
          source: 'manifest',
        });
      }
    }
  }

  // Poetry format
  if (pyproject.tool?.poetry?.dependencies) {
    for (const [name, spec] of Object.entries(pyproject.tool.poetry.dependencies)) {
      if (name === 'python') continue; // Skip Python version constraint
      
      if (typeof spec === 'string') {
        dependencies.push({
          system: 'PYPI',
          name: name.toLowerCase().replace(/_/g, '-'),
          spec,
          kind: 'prod',
          source: 'manifest',
        });
      } else if (typeof spec === 'object' && spec !== null) {
        const depObj = spec as any;
        if (depObj.path || depObj.git) {
          warnings.push(`Skipping VCS/path dependency: ${name}`);
          continue;
        }
        if (depObj.version) {
          dependencies.push({
            system: 'PYPI',
            name: name.toLowerCase().replace(/_/g, '-'),
            spec: depObj.version,
            kind: 'prod',
            source: 'manifest',
          });
        }
      }
    }
  }

  // Poetry dev dependencies
  if (pyproject.tool?.poetry?.['dev-dependencies']) {
    for (const [name, spec] of Object.entries(pyproject.tool.poetry['dev-dependencies'])) {
      if (typeof spec === 'string') {
        dependencies.push({
          system: 'PYPI',
          name: name.toLowerCase().replace(/_/g, '-'),
          spec,
          kind: 'dev',
          source: 'manifest',
        });
      }
    }
  }

  return {
    system: 'PYPI',
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Parse requirements.txt (Python)
 */
function parseRequirementsTxt(content: string): InspectManifestResponse {
  const dependencies: DependencySpec[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Skip options like -e, -r, --index-url
    if (trimmed.startsWith('-')) continue;

    // Parse package spec: "package==1.0.0" or "package>=1.0.0,<2.0"
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)(.*)$/);
    if (match) {
      const [, name, spec] = match;
      dependencies.push({
        system: 'PYPI',
        name: name.toLowerCase().replace(/_/g, '-'),
        spec: spec || undefined,
        kind: 'prod',
        source: 'manifest',
      });
    }
  }

  return {
    system: 'PYPI',
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Parse Gemfile (Ruby)
 */
function parseGemfile(content: string): InspectManifestResponse {
  const dependencies: DependencySpec[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Match gem declarations: gem 'name', '~> 1.0' or gem "name", version: "1.0"
    const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
    if (match) {
      const [, name, spec] = match;
      dependencies.push({
        system: 'RUBYGEMS',
        name,
        spec: spec || undefined,
        kind: 'prod',
        source: 'manifest',
      });
    }
  }

  return {
    system: 'RUBYGEMS',
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Parse go.mod (Go)
 */
function parseGoMod(content: string): InspectManifestResponse {
  const dependencies: DependencySpec[] = [];
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('//')) continue;
    
    // Handle require block
    if (trimmed.startsWith('require (')) {
      inRequireBlock = true;
      continue;
    }
    if (trimmed === ')' && inRequireBlock) {
      inRequireBlock = false;
      continue;
    }

    // Match require statements: require module v1.2.3 or just module v1.2.3 inside block
    let match;
    if (inRequireBlock) {
      match = trimmed.match(/^([^\s]+)\s+v?([^\s]+)/);
    } else {
      match = trimmed.match(/^require\s+([^\s]+)\s+v?([^\s]+)/);
    }

    if (match) {
      const [, name, version] = match;
      dependencies.push({
        system: 'GO',
        name,
        spec: version,
        kind: 'prod',
        source: 'manifest',
      });
    }
  }

  return {
    system: 'GO',
    dependencies,
  };
}

/**
 * Main manifest inspection function
 */
export async function inspectManifest(
  manifestPath: string,
  content?: string
): Promise<InspectManifestResponse> {
  // Read content if not provided
  const manifestContent = content || await readFile(manifestPath, 'utf-8');

  // Check size limit
  if (manifestContent.length > MAX_MANIFEST_SIZE) {
    throw new Error(`Manifest size exceeds limit of ${MAX_MANIFEST_SIZE} bytes`);
  }

  // Detect system from filename
  const system = detectSystemFromFilename(manifestPath);
  
  if (!system) {
    throw new Error(`Unable to detect system from manifest filename: ${manifestPath}`);
  }

  // Parse based on system
  try {
    switch (system) {
      case 'NPM':
        return parsePackageJson(manifestContent);
      case 'CARGO':
        return parseCargoToml(manifestContent);
      case 'PYPI': {
        // Check if it's pyproject.toml or requirements.txt
        if (manifestPath.endsWith('pyproject.toml')) {
          return parsePyprojectToml(manifestContent);
        } else {
          return parseRequirementsTxt(manifestContent);
        }
      }
      case 'RUBYGEMS':
        return parseGemfile(manifestContent);
      case 'GO':
        return parseGoMod(manifestContent);
      default:
        throw new Error(`Unsupported system: ${system}`);
    }
  } catch (error: any) {
    throw new Error(`Failed to parse manifest: ${error.message}`);
  }
}

/**
 * Supported package ecosystems in deps.dev API v3alpha
 */
export const SUPPORTED_SYSTEMS = [
  'NPM',
  'CARGO',
  'PYPI',
  'GO',
  'RUBYGEMS',
  'NUGET',
] as const;

export type SystemType = typeof SUPPORTED_SYSTEMS[number];

/**
 * Cache TTL (in milliseconds) per ecosystem
 * Based on typical publish frequency
 */
export const DEFAULT_TTL_MS: Record<SystemType, number> = {
  NPM: 30 * 60 * 1000,        // 30 minutes
  CARGO: 2 * 60 * 60 * 1000,  // 2 hours
  PYPI: 60 * 60 * 1000,       // 1 hour
  GO: 2 * 60 * 60 * 1000,     // 2 hours
  RUBYGEMS: 60 * 60 * 1000,   // 1 hour
  NUGET: 60 * 60 * 1000,      // 1 hour
};

/**
 * Manifest filename to system mapping
 */
export const MANIFEST_TO_SYSTEM: Record<string, SystemType> = {
  'package.json': 'NPM',
  'Cargo.toml': 'CARGO',
  'pyproject.toml': 'PYPI',
  'requirements.txt': 'PYPI',
  'Gemfile': 'RUBYGEMS',
  'go.mod': 'GO',
  '.csproj': 'NUGET',
  '.fsproj': 'NUGET',
  '.vbproj': 'NUGET',
};

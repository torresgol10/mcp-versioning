import { SystemType } from '../constants/systems.js';

export interface PackageVersion {
  version: string;
  publishedAt?: string;
  isDefault?: boolean;
  isDeprecated?: boolean;
}

export interface PackageVersionsResponse {
  system: string;
  name: string;
  versions: PackageVersion[];
}

export interface LatestVersionResponse {
  version: string;
  publishedAt?: string;
  isDefault?: boolean;
}

export interface DependencySpec {
  system: SystemType;
  name: string;
  spec?: string;
  kind: 'prod' | 'dev' | 'optional' | 'peer' | 'build';
  source: 'manifest';
}

export interface InspectManifestResponse {
  system?: SystemType;
  dependencies: DependencySpec[];
  warnings?: string[];
  metadata?: {
    workspace?: boolean;
    notes?: string[];
  };
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface DepsDevError {
  status: number;
  endpoint: string;
  message: string;
}

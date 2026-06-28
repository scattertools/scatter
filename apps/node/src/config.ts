import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { z } from 'zod';

const DEFAULT_DATA_DIR = join(homedir(), '.scatter');

export const configSchema = z.object({
  nodeId: z.string().nullable(),
  coordinator: z.string().url(),
  capacityBytes: z.number().int().positive(),
  dataDir: z.string(),
  port: z.number().int().min(1).max(65535),
  sessionToken: z.string().nullable().optional(), // for linking to an account
  nodeToken: z.string().nullable().optional(), // node auth token from coordinator
});

export type Config = z.infer<typeof configSchema>;

export interface ConfigOverrides {
  dataDir?: string;
  coordinator?: string;
  capacityBytes?: number;
  port?: number;
}

const defaults: Omit<Config, 'dataDir'> = {
  nodeId: null,
  coordinator: 'http://localhost:4000',
  capacityBytes: 10 * 1024 * 1024 * 1024, // 10 GB
  port: 7878,
  sessionToken: null,
  nodeToken: null,
};

function configPath(dataDir: string) {
  return join(dataDir, 'config.json');
}

export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const dataDir = overrides.dataDir ?? DEFAULT_DATA_DIR;
  mkdirSync(dataDir, { recursive: true });
  const path = configPath(dataDir);

  let raw: unknown;
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = {};
    }
  } else {
    raw = {};
  }

  const merged = {
    ...defaults,
    ...(raw as object),
    dataDir,
    ...(overrides.coordinator !== undefined && {
      coordinator: overrides.coordinator,
    }),
    ...(overrides.capacityBytes !== undefined && {
      capacityBytes: overrides.capacityBytes,
    }),
    ...(overrides.port !== undefined && { port: overrides.port }),
  };

  return configSchema.parse(merged);
}

export function saveConfig(config: Config) {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(configPath(config.dataDir), JSON.stringify(config, null, 2));
}

/** Parse sizes like "50GB", "100MB", "512KB" */
export function parseSize(s: string): number {
  const match = s.trim().match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|K|M|G|T|B)?$/i);
  if (!match) throw new Error(`Invalid size: ${s}`);
  const num = parseFloat(match[1]);
  const unit = (match[2] ?? 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    K: 1024,
    KB: 1024,
    M: 1024 ** 2,
    MB: 1024 ** 2,
    G: 1024 ** 3,
    GB: 1024 ** 3,
    T: 1024 ** 4,
    TB: 1024 ** 4,
  };
  return Math.floor(num * (multipliers[unit] ?? 1));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

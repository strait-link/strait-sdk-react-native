/** React Native entry (picked by Metro / Jest): same API, real phone runtime by default, no dynamic import(). */
import { resolveDeferredLink as resolveWith, type MatchResult, type StraitConfig } from './index.js';
import { createStrait as createStraitWith, type Strait, type CreateStraitConfig } from './strait.js';
import { moduleInstallReferrer, nativeRuntime } from './native.js';

export * from './index.js';

export function createStrait(config: CreateStraitConfig): Strait {
  return createStraitWith({
    ...config,
    runtime: config.runtime ?? nativeRuntime({ installReferrer: config.installReferrer }),
  });
}

export function resolveDeferredLink(config: StraitConfig): Promise<MatchResult> {
  return resolveWith({
    ...config,
    adapter: config.adapter ?? nativeRuntime({ installReferrer: moduleInstallReferrer }),
  });
}

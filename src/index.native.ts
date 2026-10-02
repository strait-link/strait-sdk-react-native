/** React Native entry (picked by Metro / Jest): same API, real phone runtime by default. */
import { createStrait as createStraitWith, type Strait, type CreateStraitConfig } from './strait.js';
import { nativeRuntime } from './native.js';

export * from './index.js';

export function createStrait(config: CreateStraitConfig): Strait {
  return createStraitWith({
    ...config,
    runtime: config.runtime ?? nativeRuntime({ installReferrer: config.installReferrer }),
  });
}

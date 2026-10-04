import { describe, expect, it, vi } from 'vitest';

// A phone held in landscape on first launch: Dimensions reports 844×390.
vi.mock('react-native', () => {
  const sub = { remove() {} };
  return {
    AppState: { addEventListener: () => sub },
    Dimensions: { get: () => ({ width: 844, height: 390, scale: 3, fontScale: 1 }) },
    Linking: { getInitialURL: async () => null, addEventListener: () => sub },
    NativeModules: {},
    PixelRatio: { get: () => 3 },
    Platform: { OS: 'ios' },
  };
});

describe('device fields report the portrait screen width (B17)', () => {
  it('createReactNativeRuntime', async () => {
    const { createReactNativeRuntime } = await import('../src/strait.js');
    expect((await createReactNativeRuntime()).collectDevice().screenWidth).toBe(390);
  });
  it('nativeRuntime (Metro / index.native)', async () => {
    const { nativeRuntime } = await import('../src/native.js');
    expect(nativeRuntime().collectDevice().screenWidth).toBe(390);
  });
  it('createReactNativeAdapter', async () => {
    const { createReactNativeAdapter } = await import('../src/adapter.js');
    expect((await createReactNativeAdapter()).collectDevice().screenWidth).toBe(390);
  });
});

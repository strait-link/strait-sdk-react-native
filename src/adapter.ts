/**
 * Native bindings the SDK needs, behind an interface so the pure resolution
 * logic is testable in plain Node (no React Native runtime required). The one
 * real implementation is `nativeRuntime` in native.ts.
 */

export interface DeviceFields {
  screenWidth: number;
  pixelRatio: number;
  language: string;
  timezone: string;
}

export interface NativeAdapter {
  platform(): 'ios' | 'android' | 'other';
  collectDevice(): DeviceFields;
  /**
   * Android only: the Play Install Referrer string (e.g.
   * "strait_link=lnk_123&utm_source=..."), or null if unavailable / iOS.
   */
  getInstallReferrer(): Promise<string | null>;
}

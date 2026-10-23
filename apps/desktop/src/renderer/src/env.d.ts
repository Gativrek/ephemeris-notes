import type { VxBridge } from '@shared/bridge';

declare global {
  interface Window {
    readonly vx: VxBridge;
  }
  /** The app version from apps/desktop/package.json (Settings > About). */
  const __APP_VERSION__: string;
}

export {};

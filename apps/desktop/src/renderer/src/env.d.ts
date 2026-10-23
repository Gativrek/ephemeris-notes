import type { VxBridge } from '@shared/bridge';

declare global {
  interface Window {
    readonly vx: VxBridge;
  }
}

export {};

import type { SidecarStatus } from "./sidecar/sidecar-manager";

declare global {
  interface Window {
    zj: {
      desktop: {
        getStatus(): Promise<SidecarStatus>;
      };
      window: {
        minimize(): Promise<void>;
        close(): Promise<void>;
      };
    };
  }
}

export {};


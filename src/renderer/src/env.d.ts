import type { DesktopAPI } from '../../shared/types';
declare global {
  interface Window {
    md: DesktopAPI;
  }
}
export {};

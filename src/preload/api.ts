// The API exposed to the renderer as `window.api`. Type-only so both sides can share it.
export interface Api {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  getAppVersion: () => Promise<string>;
}

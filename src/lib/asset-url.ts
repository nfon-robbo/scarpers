import { Capacitor } from "@capacitor/core";

// When running inside the Capacitor native shell the app is served from
// a local origin (https://localhost or capacitor://localhost). Relative
// Lovable-CDN paths like `/__l5e/assets-v1/...` resolve against that
// origin and 404, so binary assets (videos, images, fonts) never load.
// Prefix them with the public CDN origin so the WebView can fetch them.
const ABSOLUTE_ORIGIN = "https://www.scarpers.co.uk";

export function assetUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (Capacitor.isNativePlatform() && url.startsWith("/")) {
    return `${ABSOLUTE_ORIGIN}${url}`;
  }
  return url;
}

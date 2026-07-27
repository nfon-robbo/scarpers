import type { CapacitorConfig } from '@capacitor/cli';

const useLiveReload = process.env.CAPACITOR_USE_LIVE_RELOAD === '1';
const liveReloadUrl = useLiveReload ? process.env.CAPACITOR_LIVE_RELOAD_URL : undefined;

const config: CapacitorConfig = {
  appId: 'app.lovable.a8999b7f99894a1fa2b0909ccd9e7b62',
  appName: 'scarpers',
  webDir: 'dist',
  ...(liveReloadUrl
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: true,
        },
      }
    : {}),
};

export default config;

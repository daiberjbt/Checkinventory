import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.checkinventory.app',
  appName: 'CheckInventory',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;

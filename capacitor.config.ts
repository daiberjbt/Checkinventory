import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.checkinventory.app',
  appName: 'CheckInventory',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // La web NO se dibuja debajo de la barra de estado ni de la barra de navegacion
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'contain' },
  },
};

export default config;

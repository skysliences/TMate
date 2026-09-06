import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'dev.bugo.voltlog',
  appName: 'TMate',
  webDir: 'www',
  backgroundColor: '#eef3fa',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};
export default config;

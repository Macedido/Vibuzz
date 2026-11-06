import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json at build time. EXPO_BASE_URL lets the web build live under a
 * sub-path, e.g. GitHub Pages project sites (https://user.github.io/vibuzz/).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const baseUrl = process.env.EXPO_BASE_URL?.replace(/\/+$/, '');
  return {
    ...config,
    experiments: { ...config.experiments, ...(baseUrl ? { baseUrl } : {}) },
  } as ExpoConfig;
};

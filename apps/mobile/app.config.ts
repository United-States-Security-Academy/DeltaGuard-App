import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json holds the configuration; this file only adds build-time switches.
//
// IOS_CRITICAL_ALERTS=1 (set it in the EAS build profile's env) turns on iOS
// Critical Alerts for welfare check alarms: the entitlement, and the app then
// asks for the permission and sends alarms as critical (they sound even on
// silent and in Focus). Switch it on ONLY after Apple has granted Deltacon the
// Critical Alerts entitlement for com.deltaconsecurity.deltaguard: a build
// with an entitlement Apple hasn't granted fails to sign.
const criticalAlerts = process.env.IOS_CRITICAL_ALERTS === '1';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  ios: {
    ...config.ios,
    entitlements: {
      ...config.ios?.entitlements,
      ...(criticalAlerts ? { 'com.apple.developer.usernotifications.critical-alerts': true } : {}),
    },
  },
  extra: { ...config.extra, criticalAlerts },
});

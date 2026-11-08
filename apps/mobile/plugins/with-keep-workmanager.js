// Release builds shrink code with R8. WorkManager (used by expo-background-task) builds its
// Room database by reflection, so its classes must be kept or the app closes on launch.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const RULES = `
# Vibuzz: keep WorkManager / Room (created by reflection)
-keep class androidx.work.** { *; }
-keep class * extends androidx.room.RoomDatabase { <init>(...); }
-keep class androidx.room.** { *; }
-dontwarn androidx.work.**
`;

module.exports = function withKeepWorkManager(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes('androidx.work')) fs.writeFileSync(file, `${current.trimEnd()}\n${RULES}`);
      return cfg;
    },
  ]);
};

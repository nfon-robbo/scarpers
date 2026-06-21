import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const androidDir = join(process.cwd(), "android");
const variablesPath = join(androidDir, "variables.gradle");
const buildGradlePath = join(androidDir, "build.gradle");
const gradlePropertiesPath = join(androidDir, "gradle.properties");
const stringsPath = join(androidDir, "app", "src", "main", "res", "values", "strings.xml");
const manifestPath = join(androidDir, "app", "src", "main", "AndroidManifest.xml");
const healthConnectPluginDir = join(process.cwd(), "node_modules", "@devmaxime", "capacitor-health-connect", "android", "src", "main", "java", "com", "devmaxime", "capacitor", "health", "connect");
const healthConnectPluginKtPath = join(healthConnectPluginDir, "AndroidHealthConnectPlugin.kt");
const healthConnectKtPath = join(healthConnectPluginDir, "AndroidHealthConnect.kt");

const upsertGradleProperty = (contents, key, value) => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedKey}\\s*=.*$`, "m");
  const replacement = `${key}=${value}`;

  if (pattern.test(contents)) {
    return contents.replace(pattern, replacement);
  }

  return `${contents.trimEnd()}\n${replacement}\n`;
};

if (!existsSync(androidDir)) {
  console.error("No android folder found. Run `npx cap add android` first.");
  process.exit(1);
}

if (!existsSync(variablesPath)) {
  console.error("Missing android/variables.gradle. Re-run `npx cap sync android` and try again.");
  process.exit(1);
}

let variables = readFileSync(variablesPath, "utf8");
if (/minSdkVersion\s*=\s*\d+/.test(variables)) {
  variables = variables.replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 26");
} else {
  variables = variables.replace(/ext\s*\{/, "ext {\n    minSdkVersion = 26");
}
writeFileSync(variablesPath, variables);

if (!existsSync(buildGradlePath)) {
  console.error("Missing android/build.gradle. Re-run `npx cap sync android` and try again.");
  process.exit(1);
}

let buildGradle = readFileSync(buildGradlePath, "utf8");
const kotlinJvmTargetBlock = `

// Health Connect's Kotlin plugin does not understand Java 21 as a JVM target.
// Keep both Java and Kotlin bytecode at Java 17 even when Android Studio runs Gradle on JDK 21.
subprojects { subproject ->
    afterEvaluate {
        tasks.matching { task -> task.class.name.contains("KotlinCompile") }.configureEach { task ->
            if (task.hasProperty("kotlinOptions")) {
                task.kotlinOptions.jvmTarget = "17"
            }
        }
        tasks.withType(JavaCompile).configureEach {
            sourceCompatibility = "17"
            targetCompatibility = "17"
        }
        if (subproject.hasProperty("android")) {
            subproject.android {
                compileOptions {
                    sourceCompatibility JavaVersion.VERSION_17
                    targetCompatibility JavaVersion.VERSION_17
                }
            }
        }
    }
}
`;

if (buildGradle.includes("Health Connect's Kotlin plugin")) {
  // Replace any prior version of the block with the latest one.
  buildGradle = buildGradle.replace(/\n\n\/\/ Health Connect's Kotlin plugin[\s\S]*$/m, "");
}
buildGradle = `${buildGradle.trimEnd()}${kotlinJvmTargetBlock}`;
writeFileSync(buildGradlePath, buildGradle);

let gradleProperties = existsSync(gradlePropertiesPath) ? readFileSync(gradlePropertiesPath, "utf8") : "";
gradleProperties = upsertGradleProperty(gradleProperties, "android.useFullClasspathForDexingTransform", "true");
writeFileSync(gradlePropertiesPath, gradleProperties);

if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, "utf8");
  strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">scarpers</string>');
  strings = strings.replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">scarpers</string>');
  writeFileSync(stringsPath, strings);
}

// ---------- AndroidManifest: Health Connect permissions + rationale intent ----------
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, "utf8");

  const hcPermissions = [
    "android.permission.health.READ_STEPS",
    "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
    "android.permission.health.READ_HEART_RATE",
    "android.permission.health.READ_RESTING_HEART_RATE",
    "android.permission.health.READ_SLEEP",
    "android.permission.health.READ_HEALTH_DATA_HISTORY",
  ];

  for (const perm of hcPermissions) {
    if (!manifest.includes(`"${perm}"`)) {
      manifest = manifest.replace(
        /<manifest([^>]*)>/,
        `<manifest$1>\n    <uses-permission android:name="${perm}" />`
      );
    }
  }

  // Queries block so the app can detect the Health Connect package on Android 13-.
  if (!manifest.includes("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE") || !manifest.includes("<queries>")) {
    const queriesBlock = `
    <queries>
        <package android:name="com.google.android.apps.healthdata" />
        <intent>
            <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
        </intent>
    </queries>
`;
    if (!manifest.includes("<queries>")) {
      manifest = manifest.replace(/<\/manifest>/, `${queriesBlock}</manifest>`);
    }
  }

  // Permission-usage rationale activity — Health Connect requires the app to
  // expose an activity that handles the rationale intent, otherwise permission
  // grants are auto-denied on Android 14+.
  const rationaleActivity = `
        <activity-alias
            android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity=".MainActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
            </intent-filter>
        </activity-alias>

        <activity
            android:name=".PermissionsRationaleActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
            </intent-filter>
        </activity>
`;
  if (!manifest.includes("ViewPermissionUsageActivity")) {
    manifest = manifest.replace(/<\/application>/, `${rationaleActivity}    </application>`);
  }

  writeFileSync(manifestPath, manifest);
  console.log("AndroidManifest patched with Health Connect permissions + rationale activity.");
} else {
  console.warn("AndroidManifest.xml not found — run `npx cap sync android` first.");
}

// ---------- Patch plugin to request Health Connect history access ----------
if (existsSync(healthConnectPluginKtPath)) {
  let pluginKt = readFileSync(healthConnectPluginKtPath, "utf8");

  if (!pluginKt.includes("PERMISSION_READ_HEALTH_DATA_HISTORY")) {
    pluginKt = pluginKt.replace(
      "import androidx.health.connect.client.HealthConnectClient\n",
      "import androidx.health.connect.client.HealthConnectClient\nimport androidx.health.connect.client.permission.HealthPermission.Companion.PERMISSION_READ_HEALTH_DATA_HISTORY\n"
    );
  }

  if (!pluginKt.includes("includeHistoryPermission")) {
    pluginKt = pluginKt.replace(
      /\s*val result = implementation\.buildPermissionSet\(readPermissionsArray, writePermissionsArray\)\n\s*\/\/ Store both valid permissions and invalid records\.\n\s*requestedPermissions = result\.validPermissions\n/,
      "        val result = implementation.buildPermissionSet(readPermissionsArray, writePermissionsArray)\n        val includeHistoryPermission = call.getBoolean(\"readHistory\", false) == true\n        // Store both valid permissions and invalid records.\n        requestedPermissions = result.validPermissions + if (includeHistoryPermission) setOf(PERMISSION_READ_HEALTH_DATA_HISTORY) else emptySet<String>()\n"
    );
  }

  if (!pluginKt.includes("Log.d(\"HealthConnect\", \"Requesting permissions:")) {
    pluginKt = pluginKt.replace(
      "        permissionCall = call\n        permissionLauncher.launch(requestedPermissions)\n",
      "        permissionCall = call\n        Log.d(\"HealthConnect\", \"Requesting permissions: $requestedPermissions\")\n        permissionLauncher.launch(requestedPermissions)\n"
    );
  }

  writeFileSync(healthConnectPluginKtPath, pluginKt);
  console.log("Health Connect plugin patched to request read-history permission.");
} else {
  console.warn("Health Connect plugin source not found — run `npm install --legacy-peer-deps` first.");
}

if (existsSync(healthConnectKtPath)) {
  let healthConnectKt = readFileSync(healthConnectKtPath, "utf8");
  if (!healthConnectKt.includes('result.put("raw", rawArray)')) {
    healthConnectKt = healthConnectKt.replace(
      "        val writeArray = JSArray()\n",
      "        val writeArray = JSArray()\n        val rawArray = JSArray()\n"
    );
    healthConnectKt = healthConnectKt.replace(
      "        for (perm in granted) {\n            // Use reversePermission to convert the raw permission string.\n",
      "        for (perm in granted) {\n            rawArray.put(perm)\n            // Use reversePermission to convert the raw permission string.\n"
    );
    healthConnectKt = healthConnectKt.replace(
      "        result.put(\"read\", readArray)\n        result.put(\"write\", writeArray)\n",
      "        result.put(\"read\", readArray)\n        result.put(\"write\", writeArray)\n        result.put(\"raw\", rawArray)\n"
    );
    writeFileSync(healthConnectKtPath, healthConnectKt);
    console.log("Health Connect plugin patched to expose raw granted permissions.");
  }
} else {
  console.warn("Health Connect implementation source not found — run `npm install --legacy-peer-deps` first.");
}

console.log("Android build settings fixed: minSdkVersion 26, Kotlin JVM target 17, full classpath dexing enabled, app label set to scarpers, Health Connect permissions/history access declared.");
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const androidDir = join(process.cwd(), "android");
const variablesPath = join(androidDir, "variables.gradle");
const buildGradlePath = join(androidDir, "build.gradle");
const gradlePropertiesPath = join(androidDir, "gradle.properties");
const stringsPath = join(androidDir, "app", "src", "main", "res", "values", "strings.xml");

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
// Keep Kotlin bytecode at Java 17 even when Android Studio runs Gradle on JDK 21.
subprojects { subproject ->
    afterEvaluate {
        tasks.matching { task -> task.class.name.contains("KotlinCompile") }.configureEach { task ->
            if (task.hasProperty("kotlinOptions")) {
                task.kotlinOptions.jvmTarget = "17"
            }
        }
    }
}
`;

if (!buildGradle.includes("Health Connect's Kotlin plugin")) {
  buildGradle = `${buildGradle.trimEnd()}${kotlinJvmTargetBlock}`;
  writeFileSync(buildGradlePath, buildGradle);
}

let gradleProperties = existsSync(gradlePropertiesPath) ? readFileSync(gradlePropertiesPath, "utf8") : "";
gradleProperties = upsertGradleProperty(gradleProperties, "android.useFullClasspathForDexingTransform", "true");
writeFileSync(gradlePropertiesPath, gradleProperties);

if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, "utf8");
  strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">scarpers</string>');
  strings = strings.replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">scarpers</string>');
  writeFileSync(stringsPath, strings);
}

console.log("Android build settings fixed: minSdkVersion 26, Kotlin JVM target 17, full classpath dexing enabled, app label set to scarpers.");
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const androidDir = join(process.cwd(), "android");
const variablesPath = join(androidDir, "variables.gradle");
const buildGradlePath = join(androidDir, "build.gradle");

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

console.log("Android Health Connect build settings fixed: minSdkVersion 26, Kotlin JVM target 17.");
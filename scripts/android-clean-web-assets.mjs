import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const staleAssetDirs = [
  join(projectRoot, "android", "app", "src", "main", "assets", "public"),
  join(projectRoot, "android", "app", "build", "intermediates", "assets"),
  join(projectRoot, "android", "app", "build", "intermediates", "merged_assets"),
];

for (const dir of staleAssetDirs) {
  if (!existsSync(dir)) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log(`Removed stale Android web assets: ${dir}`);
}
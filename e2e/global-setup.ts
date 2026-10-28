import { execFileSync } from "node:child_process";

/** Seeds the demo data once, after the API is up (the seed calls it). The seed is idempotent. */
export default function globalSetup(): void {
  execFileSync("node", ["--import", "tsx", "scripts/seed.ts"], {
    cwd: "backend",
    stdio: "inherit",
    env: process.env,
  });
}

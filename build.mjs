import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist/client"), { recursive: true });
await mkdir(resolve(root, "dist/server"), { recursive: true });
await mkdir(resolve(root, "dist/server/racing"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/client"), { recursive: true });
await cp(resolve(root, "worker.js"), resolve(root, "dist/server/index.js"));
await cp(resolve(root, "racing/edge.js"), resolve(root, "dist/server/racing/edge.js"));
await cp(resolve(root, "racing/metrics.js"), resolve(root, "dist/server/racing/metrics.js"));
await cp(resolve(root, "racing/analytics.js"), resolve(root, "dist/server/racing/analytics.js"));
await cp(resolve(root, "racing/irishracing.js"), resolve(root, "dist/server/racing/irishracing.js"));
await cp(resolve(root, "racing/decision-contract.js"), resolve(root, "dist/server/racing/decision-contract.js"));
await cp(resolve(root, "racing/research.js"), resolve(root, "dist/server/racing/research.js"));
console.log("Built Worker bundle and client assets");

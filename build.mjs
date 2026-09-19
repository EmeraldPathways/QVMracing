import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist/client"), { recursive: true });
await mkdir(resolve(root, "dist/server"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/client"), { recursive: true });
await cp(resolve(root, "worker.js"), resolve(root, "dist/server/index.js"));
console.log("Built Worker bundle and client assets");

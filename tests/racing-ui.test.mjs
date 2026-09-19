import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("racing UI keeps paper-only vocabulary and required evidence fields", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const text = html + js;
  for (const required of ["QVM Racing Workbench", "PAPER ONLY", "Quote age", "Model probability", "Market probability", "Fair odds", "Executable odds", "Edge", "Data quality", "Last completed", "Last successful sync", "Last attempted sync", "Open-Meteo", "The Racing API", "Historical results", "/api/qvm/racing/fixtures", "liveFixtures"]) assert.match(text, new RegExp(required.replace(/[+]/g, "\\+")));
  assert.doesNotMatch(text, /Place live bet|Submit order|Dixon.Coles|home\/draw\/away/i);
});

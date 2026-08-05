import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { defaultPaideiaPaths, loadPaideiaConfig } from "../src/config.js";

test("Paideia public defaults keep downloads inside the repository", () => {
  const paths = defaultPaideiaPaths({});
  assert.equal(path.basename(paths.uniRoot), ".UNI V2");
  assert.match(paths.uniRoot, /[\\/]downloads[\\/]\.UNI V2$/i);
  assert.equal(paths.uniRoot, path.resolve("downloads", ".UNI V2"));
});

test("Paideia config enables Educación Continua automatically", async () => {
  const config = await loadPaideiaConfig({
    PAIDEIA_USER: "fixture-user",
    PAIDEIA_PASS: "fixture-pass"
  });

  assert.equal(config.baseUrl, "https://paideiacursos.pucp.edu.pe");
  assert.equal(
    config.continuingBaseUrl,
    "https://paideiaprogramas.pucp.edu.pe"
  );
});

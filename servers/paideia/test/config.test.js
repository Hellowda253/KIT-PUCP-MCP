import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { defaultPaideiaPaths, loadPaideiaConfig } from "../src/config.js";

test("Paideia public defaults keep downloads inside the repository", () => {
  const paths = defaultPaideiaPaths({});
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  assert.equal(path.basename(paths.uniRoot), "Paideia");
  assert.match(paths.uniRoot, /[\\/]downloads[\\/]Paideia$/i);
  assert.equal(paths.uniRoot, path.join(repositoryRoot, "downloads", "Paideia"));
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

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  defaultCampusPaths,
  loadCampusConfig
} from "../src/config.js";

test("Campus config prefers CAMPUS credentials and falls back to Paideia without mutating env", async () => {
  const env = {
    CAMPUS_PUCP_USER: "campus-user",
    CAMPUS_PUCP_PASS: "campus-pass",
    PAIDEIA_USER: "fallback-user",
    PAIDEIA_PASS: "fallback-pass",
    CAMPUS_PUCP_BASE_URL: "https://campus.example.edu/",
    CAMPUS_PUCP_PORTAL_URL:
      "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp",
    CAMPUS_PUCP_AUTH_HOSTS: "pandora.pucp.edu.pe,auth.pucp.edu.pe",
    CAMPUS_PUCP_READ_HOSTS: "eros.pucp.edu.pe",
    CAMPUS_PUCP_MAX_RESPONSE_BYTES: "2048"
  };
  const before = { ...env };
  const config = await loadCampusConfig(env, { filePath: "" });
  assert.equal(config.user, "campus-user");
  assert.equal(config.pass, "campus-pass");
  assert.equal(config.baseUrl, "https://campus.example.edu");
  assert.equal(
    config.portalUrl,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );
  assert.deepEqual(config.authHosts, ["pandora.pucp.edu.pe", "auth.pucp.edu.pe"]);
  assert.deepEqual(config.readHosts, ["eros.pucp.edu.pe"]);
  assert.equal(config.maxResponseBytes, 2048);
  assert.deepEqual(env, before);

  const fallback = await loadCampusConfig({
    PAIDEIA_USER: "fallback-user",
    PAIDEIA_PASS: "fallback-pass"
  }, { filePath: "" });
  assert.equal(fallback.user, "fallback-user");
  assert.equal(fallback.pass, "fallback-pass");
  assert.deepEqual(fallback.readHosts, [
    "eros.pucp.edu.pe",
    "ares.pucp.edu.pe"
  ]);
  assert.equal(
    fallback.portalUrl,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );
});

test("Campus config honors explicit academic and private download roots", () => {
  const paths = defaultCampusPaths({
    PUCP_DATA_DIR: "D:\\safe-data",
    CAMPUS_PUCP_UNI_ROOT: "D:\\.UNI V2",
    CAMPUS_PUCP_PRIVATE_ROOT: "D:\\PUCP Privado"
  });
  assert.equal(paths.cachePath, path.resolve("D:\\safe-data", "cache.json"));
  assert.equal(paths.historyPath, path.resolve("D:\\safe-data", "sync-history.json"));
  assert.equal(paths.manifestPath, path.resolve("D:\\safe-data", "download-manifest.json"));
  assert.equal(paths.schedulePath, path.resolve("D:\\safe-data", "course-schedules.json"));
  assert.equal(paths.preferencesPath, path.resolve("D:\\safe-data", "schedule-preferences.local.json"));
  assert.equal(paths.uniRoot, path.resolve("D:\\.UNI V2"));
  assert.equal(paths.privateRoot, path.resolve("D:\\PUCP Privado"));
});

test("Campus public defaults keep downloads inside the repository", () => {
  const paths = defaultCampusPaths({});
  assert.equal(path.basename(paths.uniRoot), "Campus");
  assert.equal(path.basename(paths.privateRoot), "Privado");
  assert.match(paths.uniRoot, /[\\/]downloads[\\/]Campus$/i);
  assert.match(paths.privateRoot, /[\\/]downloads[\\/]Privado$/i);
  assert.equal(paths.uniRoot, path.resolve("downloads", "Campus"));
  assert.equal(paths.privateRoot, path.resolve("downloads", "Privado"));
});

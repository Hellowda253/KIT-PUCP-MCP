import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyCampusDownload,
  createCampusDocumentDownloader,
  createCampusDownloadManifest,
  resolveSafeCampusWritePath,
  routeDocumentDestination
} from "../src/downloads.js";
import { createCampusUrlPolicy } from "../src/url-policy.js";

test("cached document sensitivity selects fixed academic or private roots", () => {
  const roots = {
    uniRoot: "C:\\Users\\student\\OneDrive\\.UNI V2",
    privateRoot: "C:\\Users\\student\\OneDrive\\PUCP Privado"
  };
  assert.equal(
    routeDocumentDestination({
      title: "Programa analítico de Simulación",
      category: "Programa analítico",
      sensitivity: "academic"
    }, roots),
    path.join(roots.uniRoot, "Simulacion")
  );
  assert.equal(
    routeDocumentDestination({
      title: "Boleta de notas",
      category: "Calificaciones",
      sensitivity: "private"
    }, roots),
    path.join(roots.privateRoot, "Calificaciones")
  );
  assert.equal(
    routeDocumentDestination({
      title: "Programa analítico",
      category: "Sílabo",
      sensitivity: "academic"
    }, roots),
    path.join(roots.uniRoot, "Campus Virtual")
  );
});

test("approved MIME/extensions are required and executable disguises are refused", () => {
  assert.deepEqual(
    classifyCampusDownload({
      url: "https://campus.example.edu/file.pdf",
      contentType: "application/pdf"
    }),
    { downloadable: true, extension: ".pdf" }
  );
  assert.equal(
    classifyCampusDownload({
      url: "https://campus.example.edu/payload.exe",
      contentType: "application/pdf"
    }).downloadable,
    false
  );
  assert.equal(
    classifyCampusDownload({
      url: "https://campus.example.edu/file.pdf",
      contentType: "text/html"
    }).downloadable,
    false
  );
});

test("manifest deduplicates URL first and then content size/hash", () => {
  const manifest = createCampusDownloadManifest({
    entries: [{ sourceUrl: "https://x/a", size: 3, sha256: "one" }]
  });
  assert.equal(manifest.hasUrl("https://x/a"), true);
  assert.equal(manifest.hasContent({ size: 3, sha256: "one" }), true);
  assert.equal(manifest.hasContent({ size: 3, sha256: "two" }), false);
});

test("final realpaths and existing reparse ancestors are constrained to approved roots", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-path-"));
  const root = path.join(temporary, ".UNI V2");
  const inside = path.join(root, "inside");
  const linked = path.join(root, "linked");
  const outside = path.join(temporary, "outside");
  await mkdir(inside, { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    resolveSafeCampusWritePath(path.join(linked, "file.pdf"), [root]),
    (error) => error.code === "path_not_allowed"
  );
  await assert.rejects(
    resolveSafeCampusWritePath(path.join(outside, "file.pdf"), [root]),
    (error) => error.code === "path_not_allowed"
  );
});

test("document downloader validates final URL, size, MIME, writes once, and persists a serialized manifest", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-download-"));
  const uniRoot = path.join(temporary, ".UNI V2");
  const privateRoot = path.join(temporary, "PUCP Privado");
  const manifestPath = path.join(temporary, "manifest.json");
  await mkdir(uniRoot, { recursive: true });
  await mkdir(privateRoot, { recursive: true });
  const policy = createCampusUrlPolicy({
    baseUrl: "https://campus.example.edu",
    agendaEntryUrl: "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
    agendaJsonUrl: "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON",
    authHosts: []
  });
  let calls = 0;
  const downloader = createCampusDocumentDownloader({
    uniRoot,
    privateRoot,
    manifestPath,
    policy,
    maxResponseBytes: 1024,
    async fetchDocument(url) {
      calls += 1;
      return {
        status: 200,
        finalUrl: url,
        headers: {
          "content-type": "application/pdf",
          "content-length": "7",
          "content-disposition": 'attachment; filename="boleta.pdf"'
        },
        body: Buffer.from("PDFDATA")
      };
    }
  });
  const document = {
    id: "DOC-PRI",
    title: "Boleta de notas",
    category: "Calificaciones",
    href: "https://campus.example.edu/pucp/documentos/descarga/DOC-PRI.pdf",
    sensitivity: "private",
    downloadable: true
  };
  const first = await downloader.download(document);
  assert.equal(first.status, "downloaded");
  assert.equal(await readFile(first.path, "utf8"), "PDFDATA");
  const second = await downloader.download(document);
  assert.equal(second.reason, "source_url_seen");
  assert.equal(calls, 1);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.entries.length, 1);

  await writeFile(path.join(privateRoot, "existing.pdf"), "do-not-overwrite");
  assert.equal(first.path.startsWith(privateRoot), true);
});

test("separate concurrent downloader instances serialize updates to one manifest", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-manifest-race-"));
  const uniRoot = path.join(temporary, ".UNI V2");
  const privateRoot = path.join(temporary, "PUCP Privado");
  const manifestPath = path.join(temporary, "manifest.json");
  await mkdir(uniRoot, { recursive: true });
  await mkdir(privateRoot, { recursive: true });
  const policy = createCampusUrlPolicy({
    baseUrl: "https://campus.example.edu",
    agendaEntryUrl: "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
    agendaJsonUrl: "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON",
    authHosts: []
  });
  const makeDownloader = (name) => createCampusDocumentDownloader({
    uniRoot,
    privateRoot,
    manifestPath,
    policy,
    async fetchDocument(url) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        status: 200,
        finalUrl: url,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${name}.pdf"`
        },
        body: Buffer.from(name)
      };
    }
  });
  const documents = ["one", "two"].map((name) => ({
    id: name,
    title: name,
    category: "Certificados",
    href: `https://campus.example.edu/pucp/documentos/${name}.pdf`,
    sensitivity: "private",
    downloadable: true
  }));
  await Promise.all([
    makeDownloader("one").download(documents[0]),
    makeDownloader("two").download(documents[1])
  ]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.entries.length, 2);
});

import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLivePaideiaAdapter,
  waitForPaideiaLanding
} from "../src/live-adapter.js";

function fakePlaywright() {
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) {
        currentUrl = url;
      },
      url() {
        return currentUrl;
      },
      locator() {
        return { async count() { return 0; } };
      },
      async close() {}
    };
  };
  const context = {
    request: {
      async get() {
        return {
          ok() { return true; },
          status() { return 200; },
          headers() {
            return {
              "content-type": "application/pdf",
              "content-disposition": 'attachment; filename="resource.pdf"'
            };
          },
          async body() {
            return Buffer.from("%PDF fixture");
          }
        };
      }
    },
    async newPage() {
      return makePage();
    },
    async close() {}
  };
  return {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return context;
          },
          async close() {}
        };
      }
    }
  };
}

async function junctionFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "paideia-junction-"));
  const uniRoot = path.join(temporary, ".UNI V2");
  const courseRoot = path.join(uniRoot, "SIMULACION", "PAIDEIA NUEVO");
  const outside = path.join(temporary, "outside");
  const sectionPath = path.join(courseRoot, "Semana 1");
  await mkdir(courseRoot, { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, sectionPath, process.platform === "win32" ? "junction" : "dir");
  return { temporary, uniRoot, courseRoot, outside };
}

function fixtureAdapter() {
  return createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      chromePath: ""
    }),
    playwrightLoader: async () => fakePlaywright()
  });
}

function configurablePlaywright({ get, onBrowserClose = () => {} }) {
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) { currentUrl = url; },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async close() {}
    };
  };
  return {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              request: { get },
              async newPage() { return makePage(); },
              async close() {}
            };
          },
          async close() { onBrowserClose(); }
        };
      }
    }
  };
}

function adapterWithGet(get, config = {}) {
  return createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      authHosts: ["pandora.pucp.edu.pe"],
      maxResponseBytes: 100 * 1024 * 1024,
      chromePath: "",
      ...config
    }),
    playwrightLoader: async () => configurablePlaywright({ get })
  });
}

function responseFixture({
  url = "https://paideia.invalid/pluginfile.php/1/resource.pdf",
  status = 200,
  headers = {
    "content-type": "application/pdf",
    "content-disposition": 'attachment; filename="resource.pdf"'
  },
  body = Buffer.from("%PDF fixture"),
  onDispose = () => {}
} = {}) {
  return {
    ok() { return status >= 200 && status < 300; },
    status() { return status; },
    url() { return url; },
    headers() { return headers; },
    async body() { return body; },
    async dispose() { onDispose(); }
  };
}

test("live adapter requires local credentials before loading or launching a browser", async () => {
  let browserLoads = 0;
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "",
      pass: "",
      baseUrl: "https://paideia.invalid",
      chromePath: ""
    }),
    playwrightLoader: async () => {
      browserLoads += 1;
      throw new Error("must not load");
    }
  });

  await assert.rejects(
    adapter.sync(),
    (error) => error.code === "authentication_required"
  );
  assert.equal(browserLoads, 0);
});

test("login waits through the Pandora SAML callback until Paideia settles", async () => {
  let currentUrl =
    "https://pandora.pucp.edu.pe/pucp/idp/profile/SAML2/Callback";
  let waits = 0;
  const page = {
    url() {
      return currentUrl;
    },
    locator(selector) {
      assert.equal(
        selector,
        'a[href*="/course/view.php?id="], body#page-my-courses, [data-region="course-content"], #username'
      );
      return {
        first() {
          return this;
        },
        async waitFor(options) {
          assert.deepEqual(options, {
            state: "visible",
            timeout: 12_000
          });
          waits += 1;
          currentUrl = "https://paideia.example.edu/my/courses.php";
        }
      };
    }
  };

  await waitForPaideiaLanding(page);

  assert.equal(waits, 1);
  assert.equal(
    page.url(),
    "https://paideia.example.edu/my/courses.php"
  );
});

test("sync visits both Paideia areas with the same browser context", async () => {
  const visited = [];
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) {
        currentUrl = url;
        visited.push(url);
      },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() {
        return '<body id="page-my-courses"><div data-region="course-content"></div></body>';
      },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideiacursos.pucp.edu.pe",
      continuingBaseUrl: "https://paideiaprogramas.pucp.edu.pe",
      authHosts: ["pandora.pucp.edu.pe"],
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                async newPage() { return makePage(); },
                async close() {}
              };
            },
            async close() {}
          };
        }
      }
    })
  });

  const snapshot = await adapter.sync();

  assert.deepEqual(visited, [
    "https://paideiacursos.pucp.edu.pe/my/courses.php",
    "https://paideiaprogramas.pucp.edu.pe/my/courses.php"
  ]);
  assert.deepEqual(snapshot.areaStates, [
    { area: "pregrado_posgrado", state: "available", courseCount: 0 },
    { area: "educacion_continua", state: "available", courseCount: 0 }
  ]);
});

test("single resource download rejects a final section junction escape before writing", async () => {
  const paths = await junctionFixture();
  const adapter = fixtureAdapter();
  await assert.rejects(
    adapter.downloadResource({
      resource: {
        id: "m1",
        courseId: "1",
        course: "SIMULACIÓN",
        section: "Semana 1",
        type: "resource",
        kind: "resource",
        title: "Resource",
        url: "https://paideia.invalid/resource.pdf"
      },
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath: path.join(paths.uniRoot, "manifest-single.json"),
      overwrite: false,
      skipExisting: true
    }),
    (error) => error.code === "path_not_allowed"
  );
  await assert.rejects(access(path.join(paths.outside, "resource.pdf")));
});

test("bulk download rejects a final section junction escape before writing", async () => {
  const paths = await junctionFixture();
  const adapter = fixtureAdapter();
  const material = {
    id: "m1",
    courseId: "1",
    course: "SIMULACIÓN",
    section: "Semana 1",
    type: "resource",
    kind: "resource",
    title: "Resource",
    url: "https://paideia.invalid/resource.pdf"
  };
  await assert.rejects(
    adapter.downloadCourseMaterials({
      course: { id: "1", shortName: "SIMULACIÓN" },
      materials: [material],
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath: path.join(paths.uniRoot, "manifest-bulk.json"),
      overwrite: false,
      skipExisting: true
    }),
    (error) => error.code === "path_not_allowed"
  );
  await assert.rejects(access(path.join(paths.outside, "resource.pdf")));
});

test("download URL policy rejects foreign resource requests before network access", async () => {
  let requests = 0;
  const paths = await junctionFixture();
  const adapter = adapterWithGet(async () => {
    requests += 1;
    return responseFixture();
  });
  await assert.rejects(
    adapter.downloadResource({
      resource: {
        course: "SIMULACIÓN",
        section: "Safe",
        type: "resource",
        title: "Foreign",
        url: "https://evil.example/pluginfile.php/1/file.pdf"
      },
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath: path.join(paths.uniRoot, "foreign.json")
    }),
    (error) => error.code === "url_not_allowed"
  );
  assert.equal(requests, 0);
});

test("download validates redirects and disposes every API response", async () => {
  let disposed = 0;
  const paths = await junctionFixture();
  const adapter = adapterWithGet(async () => responseFixture({
    status: 302,
    headers: { location: "https://evil.example/file.pdf" },
    onDispose: () => { disposed += 1; }
  }));
  await assert.rejects(
    adapter.downloadResource({
      resource: {
        course: "SIMULACIÓN",
        section: "Safe",
        type: "resource",
        title: "Redirect",
        url: "https://paideia.invalid/mod/resource/view.php?id=1"
      },
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath: path.join(paths.uniRoot, "redirect.json")
    }),
    (error) => error.code === "url_not_allowed"
  );
  assert.equal(disposed, 1);
});

test("download rejects oversized responses from headers and disposes them", async () => {
  let disposed = 0;
  let bodyReads = 0;
  const paths = await junctionFixture();
  const adapter = adapterWithGet(async () => responseFixture({
    headers: {
      "content-type": "application/pdf",
      "content-length": "11",
      "content-disposition": 'attachment; filename="resource.pdf"'
    },
    body: { get length() { bodyReads += 1; return 11; } },
    onDispose: () => { disposed += 1; }
  }), { maxResponseBytes: 10 });
  await assert.rejects(
    adapter.downloadResource({
      resource: {
        course: "SIMULACIÓN",
        section: "Safe",
        type: "resource",
        title: "Large",
        url: "https://paideia.invalid/pluginfile.php/1/resource.pdf"
      },
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath: path.join(paths.uniRoot, "large.json")
    }),
    (error) => error.code === "resource_too_large"
  );
  assert.equal(bodyReads, 0);
  assert.equal(disposed, 1);
});

test("browser is closed when context creation fails", async () => {
  let browserClosed = 0;
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      authHosts: [],
      maxResponseBytes: 100,
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() { throw new Error("context failed"); },
            async close() { browserClosed += 1; }
          };
        }
      }
    })
  });
  await assert.rejects(adapter.sync(), /context failed/);
  assert.equal(browserClosed, 1);
});

test("concurrent downloads merge manifest entries without lost updates", async () => {
  const paths = await junctionFixture();
  const manifestPath = path.join(paths.uniRoot, "concurrent.json");
  const adapter = adapterWithGet(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, url.includes("one") ? 20 : 5));
    const name = url.includes("one") ? "one.pdf" : "two.pdf";
    return responseFixture({
      url,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`
      },
      body: Buffer.from(`%PDF ${name}`)
    });
  });
  const options = (name) => ({
    resource: {
      course: "SIMULACIÓN",
      section: "Safe",
      type: "resource",
      title: name,
      url: `https://paideia.invalid/pluginfile.php/1/${name}.pdf`
    },
    destination: paths.courseRoot,
    uniRoot: paths.uniRoot,
    manifestPath,
    skipExisting: true
  });
  await Promise.all([
    adapter.downloadResource(options("one")),
    adapter.downloadResource(options("two"))
  ]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    manifest.entries.map((entry) => entry.sourceUrl).sort(),
    [
      "https://paideia.invalid/pluginfile.php/1/one.pdf",
      "https://paideia.invalid/pluginfile.php/1/two.pdf"
    ]
  );
});

test("bulk manifest retains successful entries when a later resource fails", async () => {
  const paths = await junctionFixture();
  const manifestPath = path.join(paths.uniRoot, "partial.json");
  const adapter = adapterWithGet(async (url) => responseFixture({
    url,
    body: Buffer.from("%PDF retained")
  }));
  const material = (id, url) => ({
    id,
    courseId: "1",
    course: "SIMULACIÓN",
    section: "Safe",
    type: "resource",
    kind: "resource",
    title: id,
    url
  });
  await assert.rejects(
    adapter.downloadCourseMaterials({
      course: { id: "1", shortName: "SIMULACIÓN" },
      materials: [
        material("good", "https://paideia.invalid/pluginfile.php/1/good.pdf"),
        material("bad", "https://evil.example/pluginfile.php/1/bad.pdf")
      ],
      destination: paths.courseRoot,
      uniRoot: paths.uniRoot,
      manifestPath,
      skipExisting: true
    }),
    (error) => error.code === "url_not_allowed"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    manifest.entries.map((entry) => entry.sourceUrl),
    ["https://paideia.invalid/pluginfile.php/1/good.pdf"]
  );
});

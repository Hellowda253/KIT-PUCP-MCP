import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile
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
  const courseRoot = path.join(uniRoot, "SIMULACION");
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

test("Educación Continua waits for a passive SSO redirect before reading an empty catalog", async () => {
  const primaryUrl = "https://paideiacursos.pucp.edu.pe/my/courses.php";
  const continuingUrl = "https://paideiaprogramas.pucp.edu.pe/my/courses.php";
  let pageNumber = 0;
  const continuingVisits = [];
  const makePage = () => {
    const ownNumber = pageNumber++;
    let currentUrl = "about:blank";
    let closed = false;
    return {
      async goto(url) {
        if (ownNumber === 1 && url === continuingUrl) {
          continuingVisits.push(url);
          currentUrl = continuingVisits.length === 1
            ? "https://pandora.pucp.edu.pe/pucp/idp/profile/SAML2/Callback"
            : continuingUrl;
        } else {
          currentUrl = url;
        }
      },
      url() { return currentUrl; },
      async evaluate() {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (closed) throw new Error("page closed before timeline response");
        return [
          { classification: "inprogress", courses: [] },
          { classification: "future", courses: [] },
          { classification: "past", courses: [] }
        ];
      },
      locator(selector) {
        if (selector === "#username") return { async count() { return 0; } };
        return {
          first() { return this; },
          async waitFor() {
            if (currentUrl.includes("pandora.pucp.edu.pe")) currentUrl = primaryUrl;
          }
        };
      },
      async content() {
        if (closed) throw new Error("page closed before fallback content");
        return '<body id="page-my-courses"><div data-region="course-content"></div></body>';
      },
      async close() { closed = true; }
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
              return { async newPage() { return makePage(); }, async close() {} };
            },
            async close() {}
          };
        }
      }
    })
  });

  const result = await adapter.sync({ components: ["catalog"] });

  assert.deepEqual(result.areaStates, [
    { area: "pregrado_posgrado", state: "available", courseCount: 0 },
    { area: "educacion_continua", state: "available", courseCount: 0 }
  ]);
  assert.deepEqual(continuingVisits, [continuingUrl, continuingUrl]);
});

test("Paideia reuses one authenticated browser session across consecutive reads", async () => {
  let launches = 0;
  let dashboardVisits = 0;
  let browserCloses = 0;
  let contextCloses = 0;
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) {
        currentUrl = url;
        if (url.endsWith("/my/courses.php")) dashboardVisits += 1;
      },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() { return '<body id="page-my-courses"><div data-region="course-content"></div></body>'; },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    reuseSessions: true,
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideiacursos.pucp.edu.pe",
      continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"],
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          launches += 1;
          return {
            async newContext() {
              return {
                async route() {},
                async newPage() { return makePage(); },
                async close() { contextCloses += 1; }
              };
            },
            async close() { browserCloses += 1; }
          };
        }
      }
    })
  });

  await adapter.sync({ components: ["catalog"] });
  await adapter.sync({ components: ["catalog"] });
  assert.equal(launches, 1);
  assert.equal(dashboardVisits, 1);
  assert.equal(adapter.getSessionMetrics().sessionReused, 1);
  assert.deepEqual({ browserCloses, contextCloses }, { browserCloses: 0, contextCloses: 0 });
  await adapter.close();
  assert.deepEqual({ browserCloses, contextCloses }, { browserCloses: 1, contextCloses: 1 });
});

test("full Paideia synchronization reports one timing for every existing stage", async () => {
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) { currentUrl = url; },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() { return '<body id="page-my-courses"><div data-region="course-content"></div></body>'; },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user", pass: "fixture-pass",
      baseUrl: "https://paideiacursos.pucp.edu.pe", continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"], chromePath: ""
    }),
    playwrightLoader: async () => ({ chromium: { async launch() { return {
      async newContext() { return { async newPage() { return makePage(); }, async close() {} }; },
      async close() {}
    }; } } })
  });
  const result = await adapter.sync();
  for (const key of ["catalogMs", "courseContentMs", "activityDetailsMs", "announcementsMs", "gradesMs", "totalMs"]) {
    assert.equal(Number.isInteger(result.timings[key]), true, key);
    assert.equal(result.timings[key] >= 0, true, key);
  }
});

test("catalog synchronization obtains current and past courses from Moodle timeline AJAX", async () => {
  const classifications = [];
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) { currentUrl = url; },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() {
        return '<body id="page-my-courses"><div data-region="course-content"></div></body>';
      },
      async evaluate(_callback, input) {
        classifications.push(...input.classifications);
        return [
          {
            classification: "inprogress",
            courses: [{ id: 101, fullname: "2026-2 Simulación (IND123)", viewurl: `${input.baseUrl}/course/view.php?id=101` }]
          },
          {
            classification: "future",
            courses: []
          },
          {
            classification: "past",
            courses: [{ id: 303, fullname: "2023-1 Fundamentos de Cálculo (1MAT05)", viewurl: `${input.baseUrl}/course/view.php?id=303` }]
          }
        ];
      },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"],
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() {
              return { async newPage() { return makePage(); }, async close() {} };
            },
            async close() {}
          };
        }
      }
    })
  });

  const snapshot = await adapter.sync({ components: ["catalog"] });

  assert.deepEqual(classifications, ["inprogress", "future", "past"]);
  assert.deepEqual(snapshot.courses.map(({ id }) => id), ["303", "101"]);
  assert.equal(snapshot.areaStates[0].courseCount, 2);
});

test("course-specific synchronization opens only the requested past course", async () => {
  const visited = [];
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) { currentUrl = url; visited.push(url); },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() {
        if (/\/course\/view\.php/.test(currentUrl)) {
          return '<body id="page-course-view"><li class="section"><h3 class="sectionname">Semana 1</h3><a href="/mod/resource/view.php?id=501">Guía</a></li></body>';
        }
        return '<body id="page-my-courses"><div data-region="course-content"></div></body>';
      },
      async evaluate(_callback, input) {
        return [
          {
            classification: "inprogress",
            courses: [{ id: 101, fullname: "2026-2 Simulación (IND123)", viewurl: `${input.baseUrl}/course/view.php?id=101` }]
          },
          {
            classification: "future",
            courses: []
          },
          {
            classification: "past",
            courses: [{ id: 303, fullname: "2023-1 Fundamentos de Cálculo (1MAT05)", viewurl: `${input.baseUrl}/course/view.php?id=303` }]
          }
        ];
      },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"],
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() {
              return { async newPage() { return makePage(); }, async close() {} };
            },
            async close() {}
          };
        }
      }
    })
  });

  const snapshot = await adapter.sync({
    components: ["catalog", "course_content"],
    course: "Fundamentos de Cálculo"
  });

  assert.deepEqual(
    visited.filter((url) => /\/course\/view\.php/.test(url)),
    ["https://paideia.invalid/course/view.php?id=303"]
  );
  assert.equal(snapshot.materials[0].courseId, "303");
  assert.deepEqual(snapshot.coverage.courseIds, ["303"]);
  assert.equal(snapshot.coverage.allCourses, false);
});

test("component sync avoids unrelated Paideia course, detail, forum, and grade pages", async () => {
  const dashboardHtml = await readFile(new URL("./fixtures/dashboard.html", import.meta.url), "utf8");
  const courseHtml = await readFile(new URL("./fixtures/course.html", import.meta.url), "utf8");
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
        if (/\/my\/courses\.php/.test(currentUrl)) return dashboardHtml;
        if (/\/course\/view\.php/.test(currentUrl)) return courseHtml;
        return "<html><body></body></html>";
      },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      continuingBaseUrl: "",
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

  const catalog = await adapter.sync({ components: ["catalog"] });
  assert.equal(visited.filter((url) => /\/course\/view\.php/.test(url)).length, 0);
  assert.deepEqual(catalog.coverage.components, ["catalog"]);

  visited.length = 0;
  const materials = await adapter.sync({ components: ["catalog", "course_content"] });
  assert.equal(visited.filter((url) => /\/course\/view\.php/.test(url)).length, 2);
  assert.equal(visited.some((url) => /\/mod\/(?:assign|quiz|forum)\//.test(url)), false);
  assert.equal(visited.some((url) => /\/grade\/report\//.test(url)), false);
  assert.deepEqual(materials.coverage.components, ["catalog", "course_content"]);
});

test("temporarily unavailable Educación Continua is not retried on every sync", async () => {
  const visits = [];
  const dashboard = '<body id="page-my-courses"><div data-region="course-content"></div></body>';
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) {
        currentUrl = url;
        visits.push(url);
        if (url.includes("paideiaprogramas")) throw new Error("secondary unavailable");
      },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async content() { return dashboard; },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    epochNow: () => Date.parse("2026-08-21T12:00:00-05:00"),
    continuingCooldownMs: 30 * 60 * 1000,
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

  const first = await adapter.sync({ components: ["catalog"] });
  const second = await adapter.sync({ components: ["catalog"] });
  await adapter.sync({ components: ["catalog"], retryUnavailableAreas: true });

  assert.equal(visits.filter((url) => url.includes("paideiaprogramas")).length, 2);
  assert.equal(first.areaStates[1].state, "unavailable");
  assert.equal(second.areaStates[1].reason, "cooldown");
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

test("a stale manifest URL entry does not prevent re-downloading a deleted file", async () => {
  const paths = await junctionFixture();
  const manifestPath = path.join(paths.uniRoot, "stale.json");
  const sourceUrl = "https://paideia.invalid/pluginfile.php/1/restored.pdf";
  await writeFile(manifestPath, JSON.stringify({
    entries: [{
      sourceUrl,
      path: path.join(paths.courseRoot, "missing.pdf"),
      size: 12,
      sha256: "missing"
    }]
  }));
  const adapter = adapterWithGet(async () => responseFixture({
    url: sourceUrl,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="restored.pdf"'
    },
    body: Buffer.from("%PDF restored")
  }));

  const result = await adapter.downloadResource({
    resource: {
      id: "restored",
      courseId: "1",
      course: "SIMULACIÓN",
      section: "Safe",
      type: "resource",
      kind: "resource",
      title: "Restored",
      url: sourceUrl
    },
    destination: paths.courseRoot,
    uniRoot: paths.uniRoot,
    manifestPath,
    overwrite: false,
    skipExisting: true
  });

  assert.equal(result.downloaded.length, 1);
  assert.equal(result.skipped.length, 0);
});

test("a non-downloadable wrapper does not leave empty course folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paideia-empty-folder-"));
  const courseRoot = path.join(root, "Course");
  const makePage = () => {
    let currentUrl = "about:blank";
    return {
      async goto(url) { currentUrl = url; },
      url() { return currentUrl; },
      locator() { return { async count() { return 0; } }; },
      async evaluate() { return []; },
      async close() {}
    };
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"],
      maxResponseBytes: 1024,
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                request: {
                  async get() {
                    return responseFixture({
                      url: "https://paideia.invalid/mod/folder/view.php?id=1",
                      headers: { "content-type": "text/html" },
                      body: Buffer.from("<html></html>")
                    });
                  }
                },
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

  const result = await adapter.downloadResource({
    resource: {
      id: "folder-1",
      courseId: "1",
      course: "Course",
      section: "Empty Section",
      type: "folder",
      kind: "folder",
      title: "Empty folder",
      url: "https://paideia.invalid/mod/folder/view.php?id=1"
    },
    destination: courseRoot,
    uniRoot: root,
    manifestPath: path.join(root, "manifest.json"),
    overwrite: false,
    skipExisting: true
  });

  assert.equal(result.skipped[0].reason, "non_downloadable_activity");
  await assert.rejects(access(path.join(courseRoot, "Empty Section")));
});

test("folder inspection returns only unique Moodle files with nested relative paths", async () => {
  let currentUrl = "about:blank";
  const page = {
    async goto(url) { currentUrl = url; },
    url() { return currentUrl; },
    locator() { return { async count() { return 0; } }; },
    async evaluate() {
      return [
        {
          url: "https://paideia.invalid/pluginfile.php/10/mod_folder/content/0/Semana%201/Diapositivas.pdf",
          title: "Diapositivas.pdf"
        },
        {
          url: "https://paideia.invalid/pluginfile.php/10/mod_folder/content/0/Semana%201/Diapositivas.pdf",
          title: "duplicado"
        },
        {
          url: "https://paideia.invalid/pluginfile.php/10/mod_folder/content/0/Tablas.xlsx",
          title: "Tablas.xlsx"
        },
        { url: "https://evil.example/file.pdf", title: "No permitido" }
      ];
    },
    async close() {}
  };
  const adapter = createLivePaideiaAdapter({
    configLoader: async () => ({
      user: "fixture-user",
      pass: "fixture-pass",
      baseUrl: "https://paideia.invalid",
      continuingBaseUrl: "",
      authHosts: ["pandora.pucp.edu.pe"],
      chromePath: ""
    }),
    playwrightLoader: async () => ({
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                async newPage() { return page; },
                async close() {}
              };
            },
            async close() {}
          };
        }
      }
    })
  });

  const result = await adapter.getFolderContents({
    resource: {
      id: "folder-1",
      courseId: "1",
      course: "Termodinámica",
      section: "Semana 1",
      type: "folder",
      kind: "folder",
      title: "CLASE",
      url: "https://paideia.invalid/mod/folder/view.php?id=1"
    },
    limit: 20
  });

  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(({ title, relativePath }) => ({ title, relativePath })), [
    { title: "Diapositivas.pdf", relativePath: "Semana 1/Diapositivas.pdf" },
    { title: "Tablas.xlsx", relativePath: "Tablas.xlsx" }
  ]);
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

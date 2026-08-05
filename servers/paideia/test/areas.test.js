import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPaideiaAreaCourses,
  paideiaAreaDefinitions
} from "../src/areas.js";

const dashboard = (id, name) => `
  <body id="page-my-courses">
    <a href="/course/view.php?id=${id}">${name}</a>
    <a href="/course/view.php?id=${id}">${name}</a>
  </body>
`;

test("area definitions keep Pregrado/Posgrado first and Educación Continua optional", () => {
  assert.deepEqual(paideiaAreaDefinitions({
    baseUrl: "https://paideiacursos.pucp.edu.pe",
    continuingBaseUrl: "https://paideiaprogramas.pucp.edu.pe"
  }), [
    {
      id: "pregrado_posgrado",
      baseUrl: "https://paideiacursos.pucp.edu.pe",
      required: true
    },
    {
      id: "educacion_continua",
      baseUrl: "https://paideiaprogramas.pucp.edu.pe",
      required: false
    }
  ]);
});

test("area collection reads both dashboards and avoids cross-site id collisions", async () => {
  const calls = [];
  const result = await collectPaideiaAreaCourses(
    paideiaAreaDefinitions({
      baseUrl: "https://paideiacursos.pucp.edu.pe",
      continuingBaseUrl: "https://paideiaprogramas.pucp.edu.pe"
    }),
    async (area) => {
      calls.push(area.id);
      return dashboard("101", area.id === "pregrado_posgrado" ? "Curso regular" : "Programa continuo");
    }
  );

  assert.deepEqual(calls, ["pregrado_posgrado", "educacion_continua"]);
  assert.deepEqual(result.courses.map(({ id, area }) => ({ id, area })), [
    { id: "101", area: "pregrado_posgrado" },
    { id: "educacion_continua:101", area: "educacion_continua" }
  ]);
  assert.deepEqual(result.areaStates, [
    { area: "pregrado_posgrado", state: "available", courseCount: 1 },
    { area: "educacion_continua", state: "available", courseCount: 1 }
  ]);
});

test("area collection preserves regular courses when Educación Continua is unavailable", async () => {
  const result = await collectPaideiaAreaCourses(
    paideiaAreaDefinitions({
      baseUrl: "https://paideiacursos.pucp.edu.pe",
      continuingBaseUrl: "https://paideiaprogramas.pucp.edu.pe"
    }),
    async (area) => {
      if (area.id === "educacion_continua") throw new Error("secondary offline");
      return dashboard("202", "Curso regular");
    }
  );

  assert.equal(result.courses.length, 1);
  assert.deepEqual(result.areaStates[1], {
    area: "educacion_continua",
    state: "unavailable",
    courseCount: 0
  });
});

test("area collection rejects an implausible required dashboard", async () => {
  await assert.rejects(
    collectPaideiaAreaCourses(
      paideiaAreaDefinitions({
        baseUrl: "https://paideiacursos.pucp.edu.pe",
        continuingBaseUrl: ""
      }),
      async () => "<form id=login></form>"
    ),
    (error) =>
      error.code === "scrape_failed" &&
      /structurally implausible/i.test(error.message)
  );
});

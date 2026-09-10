import assert from "node:assert/strict";
import test from "node:test";

import { createCampusVirtualServer } from "../src/server.js";
import { createCampusTools } from "../src/tools.js";

const expectedTools = [
  "download_campus_document",
  "get_academic_history",
  "get_academic_performance",
  "get_campus_agenda",
  "get_campus_day",
  "get_campus_job_status",
  "get_campus_status",
  "get_curriculum_progress",
  "get_enrollment_eligibility",
  "get_course_schedule_details",
  "get_enrollment_portal_section",
  "get_final_grade_statistics",
  "get_financial_status",
  "get_partial_grade_statistics",
  "get_registration_status",
  "get_student_schedule",
  "evaluate_course_schedule",
  "list_campus_changes",
  "list_campus_modules",
  "list_allowed_courses",
  "list_cross_unit_vacancies",
  "list_enrolled_courses",
  "list_course_participants",
  "list_obligations",
  "list_official_grades",
  "list_requests",
  "prepare_course_registration",
  "recommend_course_schedules",
  "search_campus_documents",
  "search_course_schedules",
  "search_historical_course_schedules",
  "commit_course_registration",
  "sync_campus_virtual"
];

const minimalArguments = {
  download_campus_document: { document: "DOC-1" },
  get_academic_history: {},
  get_academic_performance: {},
  get_campus_agenda: {},
  get_campus_day: { date: "2026-07-24" },
  get_campus_job_status: { jobId: "sync-1" },
  get_campus_status: {},
  get_curriculum_progress: {},
  get_enrollment_eligibility: {},
  get_course_schedule_details: { course: "1IND50", schedule: "0831" },
  get_enrollment_portal_section: { section: "exceptions" },
  get_financial_status: {},
  get_final_grade_statistics: { course: "1IND50", term: "2026-1" },
  get_partial_grade_statistics: {
    course: "IEE272",
    term: "2026-1",
    evaluationType: "Ex",
    evaluationNumber: 2
  },
  get_registration_status: {},
  get_student_schedule: {},
  evaluate_course_schedule: {
    selections: [{ courseCode: "1IND50", scheduleId: "0831" }]
  },
  list_campus_changes: {},
  list_campus_modules: {},
  list_allowed_courses: {},
  list_cross_unit_vacancies: {},
  list_enrolled_courses: {},
  list_course_participants: { course: "IND270" },
  list_obligations: {},
  list_official_grades: {},
  list_requests: {},
  prepare_course_registration: { add: [{ courseCode: "1IND50", scheduleId: "0831" }] },
  recommend_course_schedules: { courseCodes: ["1IND50"] },
  search_campus_documents: {},
  search_course_schedules: { courseCodes: ["1IND50"] },
  search_historical_course_schedules: { term: "2026-1", courseCodes: ["1IND50"] },
  commit_course_registration: { confirmationToken: "token-12345678901", confirmed: true },
  sync_campus_virtual: {}
};

test("Campus exposes payment information as read-only and no payment action", () => {
  const service = new Proxy({}, {
    get: () => async () => ({})
  });
  const tools = createCampusTools(service);
  const names = tools.map(({ name }) => name);

  assert.equal(names.some((name) => /^(?:pay|make_payment|submit_payment|confirm_payment)/i.test(name)), false);
  for (const name of ["get_financial_status", "list_obligations"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} must remain available`);
    assert.match(tool.description, /read-only/i);
    assert.match(tool.description, /never (?:pays|submits a payment)/i);
  }
});

test("optimized enrollment schemas keep consolidated capabilities", () => {
  const service = new Proxy({}, { get: () => async () => ({}) });
  const tools = createCampusTools(service);
  const eligibility = tools.find(({ name }) => name === "get_enrollment_eligibility");
  const details = tools.find(({ name }) => name === "get_course_schedule_details");

  assert.equal(Object.hasOwn(eligibility.inputSchema.properties, "term"), false);
  assert.deepEqual(details.inputSchema.required, ["course"]);
  assert.ok(details.inputSchema.properties.schedule);
});

test("schedule references accept Campus labels and tools forbid inferred exam dates", () => {
  const service = new Proxy({}, { get: () => async () => ({}) });
  const tools = createCampusTools(service);
  const details = tools.find(({ name }) => name === "get_course_schedule_details");
  const evaluate = tools.find(({ name }) => name === "evaluate_course_schedule");
  const recommend = tools.find(({ name }) => name === "recommend_course_schedules");

  assert.ok(details.inputSchema.properties.schedule.maxLength >= 80);
  assert.ok(
    evaluate.inputSchema.properties.selections.items.properties.scheduleId.maxLength >= 80
  );
  assert.match(`${evaluate.description} ${recommend.description}`, /do not infer.*exam date/iu);
  assert.match(`${evaluate.description} ${recommend.description}`, /date not published/iu);
});

test("partial grade statistics expose an explicit student, schedule, or all scope", () => {
  const service = new Proxy({}, { get: () => async () => ({}) });
  const tools = createCampusTools(service);
  const partial = tools.find((candidate) => candidate.name === "get_partial_grade_statistics");
  assert.deepEqual(partial.inputSchema.properties.scope.enum, [
    "student_schedule",
    "schedule",
    "all"
  ]);
  assert.equal(partial.inputSchema.properties.scope.default, "student_schedule");
  assert.match(partial.description, /all.*Campus.*Todos/iu);
  const final = tools.find((candidate) => candidate.name === "get_final_grade_statistics");
  assert.equal(final.inputSchema.properties.scope, undefined);
});

test("Campus tool guidance distinguishes dated agenda, weekly schedule, and curriculum status", () => {
  const service = new Proxy({}, { get: () => async () => ({}) });
  const tools = createCampusTools(service);
  const description = (name) => tools.find((tool) => tool.name === name)?.description ?? "";

  assert.match(description("get_campus_day"), /specific calendar date/iu);
  assert.match(description("get_campus_day"), /empty.*no confirmed agenda event/iu);
  assert.match(description("get_campus_agenda"), /next class/iu);
  assert.match(description("get_student_schedule"), /recurring weekly pattern/iu);
  assert.match(description("get_student_schedule"), /does not confirm.*calendar date/iu);
  assert.match(description("search_course_schedules"), /schedule (?:id|code).*does not determine.*curriculum level/iu);
  assert.match(description("search_course_schedules"), /explicit.*level.*mandatory/iu);
  assert.match(description("search_course_schedules"), /Nivel 0.*electiv/iu);
  assert.match(description("search_course_schedules"), /other academic units.*active term.*schedule catalog/iu);
  assert.match(
    tools.find(({ name }) => name === "search_course_schedules")
      .inputSchema.properties.academicScope.properties.curriculumLevel.description,
    /positive level.*mandatory/iu
  );
  assert.match(
    tools.find(({ name }) => name === "search_course_schedules")
      .inputSchema.properties.academicScope.properties.curriculumLevel.description,
    /Nivel 0.*electiv/iu
  );
});

function envelope(name, args) {
  return {
    source: "campus_virtual_pucp",
    retrievedAt: "2026-07-24T10:00:00.000Z",
    cache: {
      generatedAt: "2026-07-24T10:00:00.000Z",
      ageSeconds: 0,
      stale: false
    },
    data: { name, args },
    warnings: []
  };
}

test("Campus MCP advertises complete schemas and dispatches all required public tools", async () => {
  const calls = [];
  const methods = {
    downloadCampusDocument: "download_campus_document",
    getAcademicHistory: "get_academic_history",
    getAcademicPerformance: "get_academic_performance",
    getCampusAgenda: "get_campus_agenda",
    getCampusDay: "get_campus_day",
    getCampusJobStatus: "get_campus_job_status",
    getCampusStatus: "get_campus_status",
    getCurriculumProgress: "get_curriculum_progress",
    getEnrollmentEligibility: "get_enrollment_eligibility",
    getCourseScheduleDetails: "get_course_schedule_details",
    getEnrollmentPortalSection: "get_enrollment_portal_section",
    getFinancialStatus: "get_financial_status",
    getFinalGradeStatistics: "get_final_grade_statistics",
    getPartialGradeStatistics: "get_partial_grade_statistics",
    getRegistrationStatus: "get_registration_status",
    getStudentSchedule: "get_student_schedule",
    evaluateCourseSchedule: "evaluate_course_schedule",
    listCampusChanges: "list_campus_changes",
    listCampusModules: "list_campus_modules",
    listAllowedCourses: "list_allowed_courses",
    listCrossUnitVacancies: "list_cross_unit_vacancies",
    listEnrolledCourses: "list_enrolled_courses",
    listCourseParticipants: "list_course_participants",
    listObligations: "list_obligations",
    listOfficialGrades: "list_official_grades",
    listRequests: "list_requests",
    prepareCourseRegistration: "prepare_course_registration",
    recommendCourseSchedules: "recommend_course_schedules",
    searchCampusDocuments: "search_campus_documents",
    searchCourseSchedules: "search_course_schedules",
    searchHistoricalCourseSchedules: "search_historical_course_schedules",
    commitCourseRegistration: "commit_course_registration",
    syncCampusVirtual: "sync_campus_virtual"
  };
  const service = Object.fromEntries(
    Object.entries(methods).map(([method, tool]) => [
      method,
      async (args = {}) => {
        calls.push(tool);
        return envelope(tool, args);
      }
    ])
  );
  const server = createCampusVirtualServer({ service });
  const listed = await server.handleMessage({
    jsonrpc: "2.0", id: 1, method: "tools/list", params: {}
  });
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name).sort(),
    expectedTools.toSorted()
  );
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  for (const [index, name] of expectedTools.entries()) {
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: index + 2,
      method: "tools/call",
      params: { name, arguments: minimalArguments[name] }
    });
    assert.equal(response.result.isError, undefined, name);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.source, "campus_virtual_pucp", name);
    assert.deepEqual(
      Object.keys(payload),
      ["source", "retrievedAt", "cache", "data", "warnings"],
      name
    );
  }
  assert.deepEqual(calls.sort(), expectedTools.toSorted());
});

test("Campus MCP rejects incomplete and unknown tool input without invoking the service", async () => {
  const server = createCampusVirtualServer({
    service: {
      async getCampusDay() {
        throw new Error("must not be called");
      }
    }
  });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: { name: "get_campus_day", arguments: {} }
  });
  assert.equal(response.result.isError, true);
  assert.equal(
    JSON.parse(response.result.content[0].text).error.code,
    "tool_input_invalid"
  );
});

test("schedule search contract exposes only visible academic scope fields", async () => {
  const server = createCampusVirtualServer({ service: {} });
  const listed = await server.handleMessage({
    jsonrpc: "2.0", id: 99, method: "tools/list", params: {}
  });
  const schedule = listed.result.tools.find(({ name }) => name === "search_course_schedules");
  const historical = listed.result.tools.find(({ name }) => name === "search_historical_course_schedules");
  assert.equal(Object.hasOwn(schedule.inputSchema.properties, "term"), false);
  assert.deepEqual(historical.inputSchema.required, ["term"]);
  const scope = schedule.inputSchema.properties.academicScope.properties;
  assert.deepEqual(Object.keys(scope).sort(), ["academicUnit", "curriculumLevel", "specialty"]);
  assert.equal(scope.curriculumLevel.type, "integer");
  assert.equal(scope.curriculumLevel.minimum, 0);
  assert.match(scope.curriculumLevel.description, /Nivel 0/);
  assert.equal(Object.hasOwn(scope, "stage"), false);
  assert.equal(Object.hasOwn(scope, "branchCode"), false);
});

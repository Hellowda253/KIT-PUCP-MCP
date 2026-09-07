const refresh = {
  forceRefresh: {
    type: "boolean",
    description: "Queue a metadata-only refresh while returning the last good cache."
  }
};

const commonFilters = {
  query: { type: "string" },
  term: { type: "string", minLength: 1 },
  status: { type: "string", minLength: 1 },
  limit: { type: "integer", minimum: 1, maximum: 500 },
  ...refresh
};

const enrollmentTerm = {
  type: "string",
  pattern: "^\\d{4}-\\d{1,2}$",
  description: "Academic term such as 2026-2. Defaults to the active enrollment term."
};

const courseCode = {
  type: "string",
  pattern: "^[A-Za-z0-9-]{3,15}$"
};

const courseCodes = {
  type: "array",
  minItems: 1,
  maxItems: 10,
  uniqueItems: true,
  items: courseCode
};

const registrationSelections = {
  type: "array",
  maxItems: 20,
  uniqueItems: true,
  items: {
    type: "object",
    properties: {
      courseCode,
      scheduleId: { type: "string", minLength: 1, maxLength: 15 },
      scheduleType: {
        type: "string",
        enum: ["class", "practice", "exam", "laboratory", "directed_practice", "workshop", "advising"],
        description: "Optional only when Campus publishes more than one component with the same schedule id."
      }
    },
    required: ["courseCode", "scheduleId"],
    additionalProperties: false
  }
};

const preferenceProperties = {
  freeDays: {
    type: "array",
    uniqueItems: true,
    items: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }
  },
  preferredDays: {
    type: "array",
    uniqueItems: true,
    items: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }
  },
  earliestStart: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
  latestEnd: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
  unavailable: {
    type: "array",
    maxItems: 50,
    items: {
      type: "object",
      properties: {
        day: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
        start: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
        end: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }
      },
      required: ["day", "start", "end"],
      additionalProperties: false
    }
  },
  preferredModality: { type: "string", enum: ["any", "presential", "virtual", "hybrid"] },
  preferredProfessors: { type: "array", maxItems: 30, items: { type: "string", minLength: 1 } },
  avoidedProfessors: { type: "array", maxItems: 30, items: { type: "string", minLength: 1 } },
  maxDays: { type: "integer", minimum: 1, maximum: 7 },
  maxGapMinutes: { type: "integer", minimum: 0, maximum: 720 },
  timePreference: { type: "string", enum: ["any", "morning", "afternoon"] },
  weights: {
    type: "object",
    properties: {
      vacancySafety: { type: "number", minimum: 0, maximum: 100 },
      fewerGaps: { type: "number", minimum: 0, maximum: 100 },
      fewerDays: { type: "number", minimum: 0, maximum: 100 },
      preferredHours: { type: "number", minimum: 0, maximum: 100 },
      professorSurvey: { type: "number", minimum: 0, maximum: 100 },
      modalityLocation: { type: "number", minimum: 0, maximum: 100 }
    },
    additionalProperties: false
  }
};

const preferences = {
  type: "object",
  properties: preferenceProperties,
  additionalProperties: false
};

function schema(properties = {}, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

export function createCampusTools(service) {
  return [
    {
      name: "get_campus_status",
      description: "Report local Campus cache/module/job status and alerts without contacting PUCP.",
      inputSchema: schema(),
      handler: () => service.getCampusStatus()
    },
    {
      name: "sync_campus_virtual",
      description: "Queue a headless metadata-only Campus refresh; never downloads, pays, enrolls, submits forms, creates requests, or changes profile data.",
      inputSchema: schema({
        start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        days: { type: "integer", minimum: 1, maximum: 365 },
        moduleConcurrency: { type: "integer", minimum: 1, maximum: 4 }
      }),
      handler: (args) => service.syncCampusVirtual(args)
    },
    {
      name: "get_campus_job_status",
      description: "Return safe status/result metadata for a Campus sync or explicit document-download job.",
      inputSchema: schema({
        jobId: { type: "string", minLength: 1 }
      }, ["jobId"]),
      handler: (args) => service.getCampusJobStatus(args)
    },
    {
      name: "list_campus_modules",
      description: "List cached visible Campus modules with supported/unavailable state and alerts only.",
      inputSchema: schema(refresh),
      handler: (args) => service.listCampusModules(args)
    },
    {
      name: "get_campus_agenda",
      description: "Query confirmed Campus agenda events by inclusive date range, course, or comma-separated kinds. Use this for the next class or dated events; if one day is empty, widen the range instead of substituting the recurring weekly schedule.",
      inputSchema: schema({
        start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        course: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        ...refresh
      }),
      handler: (args) => service.getCampusAgenda(args)
    },
    {
      name: "get_campus_day",
      description: "Return confirmed Campus agenda events for one specific calendar date (YYYY-MM-DD). An empty result means no confirmed agenda event for that date; do not infer one from the recurring weekly schedule.",
      inputSchema: schema({
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        course: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        ...refresh
      }, ["date"]),
      handler: (args) => service.getCampusDay(args)
    },
    {
      name: "list_enrolled_courses",
      description: "List the authenticated student's normalized cached enrolled courses.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.listEnrolledCourses(args)
    },
    {
      name: "list_course_participants",
      description: "List students visible in the authenticated Campus course Alumnos view. Returns names, schedules, and specialties; institutional email is omitted unless includeEmail is explicitly true. Never sends mail or submits roster forms.",
      inputSchema: schema({
        course: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Visible enrolled course code or an unambiguous course name. Prefer the course code."
        },
        schedule: { type: "string", minLength: 1, maxLength: 15 },
        query: { type: "string", minLength: 1, maxLength: 120 },
        includeEmail: {
          type: "boolean",
          default: false,
          description: "Include the E-mail column only when the user needs it explicitly."
        },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      }, ["course"]),
      handler: (args) => service.listCourseParticipants(args)
    },
    {
      name: "list_official_grades",
      description: "List cached partial and final grades; each item explicitly identifies whether Campus marks it official.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.listOfficialGrades(args)
    },
    {
      name: "get_partial_grade_statistics",
      description: "Fetch or return cached institutional Campus statistics for one partial assessment, including mean, median, deviation, pass rates, and distribution.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        term: { type: "string", pattern: "^\\d{4}-\\d+$" },
        evaluationType: { type: "string", minLength: 1, maxLength: 20 },
        evaluationNumber: { type: "integer", minimum: 1, maximum: 99 },
        schedule: { type: "string", minLength: 1, maxLength: 10 },
        ...refresh
      }, ["course", "term", "evaluationType", "evaluationNumber"]),
      handler: (args) => service.getPartialGradeStatistics(args)
    },
    {
      name: "get_final_grade_statistics",
      description: "Fetch or return cached institutional Campus statistics for one final course grade, including mean, median, deviation, pass rates, and distribution.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        term: { type: "string", pattern: "^\\d{4}-\\d+$" },
        schedule: { type: "string", minLength: 1, maxLength: 10 },
        ...refresh
      }, ["course", "term"]),
      handler: (args) => service.getFinalGradeStatistics(args)
    },
    {
      name: "get_academic_history",
      description: "Return the authenticated student's cached academic history.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.getAcademicHistory(args)
    },
    {
      name: "get_academic_performance",
      description: "Return cached weighted average, CRAEst, merit order, and faculty population by term.",
      inputSchema: schema({
        term: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        ...refresh
      }),
      handler: (args) => service.getAcademicPerformance(args)
    },
    {
      name: "get_curriculum_progress",
      description: "Return the current plan summary and cached curriculum courses, credits, state, and prerequisites.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.getCurriculumProgress(args)
    },
    {
      name: "get_enrollment_eligibility",
      description: "Return one cohesive read-only enrollment eligibility overview with active term, turn, portal state, calendar, impediments, and permitted-course count.",
      inputSchema: schema(refresh),
      handler: (args) => service.getEnrollmentEligibility(args)
    },
    {
      name: "get_student_schedule",
      description: "Return the authenticated student's own recurring weekly pattern from the Campus Horario button, including classes, practices, laboratories, exams, rooms, and overlaps. It describes the usual timetable but does not confirm that a session occurs on a specific calendar date; use Campus agenda for today or the next class.",
      inputSchema: schema(refresh),
      handler: (args) => service.getStudentSchedule(args)
    },
    {
      name: "get_registration_status",
      description: "Read live registered or prematriculated courses, statuses, and personal relative positions from the active regular or structurally compatible extemporaneous view.",
      inputSchema: schema(refresh),
      handler: (args) => service.getRegistrationStatus(args)
    },
    {
      name: "list_allowed_courses",
      description: "List the authenticated student's cached courses permitted for the enrollment term.",
      inputSchema: schema({ term: enrollmentTerm, ...refresh }),
      handler: (args) => service.listAllowedCourses(args)
    },
    {
      name: "search_course_schedules",
      description: "Search the active term using the live registration view when available and otherwise the shared PUCP schedule catalog; never accepts a term or uses historical data. For courses from other academic units in the active term, keep using this tool: it automatically falls back to the schedule catalog when the personalized enrollment scope cannot represent them. A schedule id or code such as 0721 does not determine curriculum level. Use only the explicit Campus level: a positive level identifies its mandatory courses and Nivel 0 identifies electives; if absent, report the classification as unknown.",
      inputSchema: schema({
        courseCodes: { ...courseCodes, maxItems: 30 },
        courseName: { type: "string", maxLength: 120 },
        academicScope: {
          type: "object",
          properties: {
            academicUnit: { type: "string", minLength: 1, maxLength: 120 },
            specialty: { type: "string", maxLength: 120 },
            curriculumLevel: { type: "integer", minimum: 0, maximum: 30, description: "Official curriculum level shown by Campus. A positive level identifies mandatory courses of that level; Nivel 0 contains Cursos Electivos. Requires specialty and is never inferred from a course or schedule code." }
          },
          required: ["academicUnit"],
          additionalProperties: false
        },
        page: { type: "integer", minimum: 1, maximum: 1000 },
        pageSize: { type: "integer", minimum: 1, maximum: 500 },
        ...refresh
      }),
      handler: (args) => service.searchCourseSchedules(args)
    },
    {
      name: "search_historical_course_schedules",
      description: "Search the shared PUCP schedule catalog for an explicitly requested historical term; results are never used for active enrollment or registration writes. Classify mandatory courses and electives only from the explicit Campus curriculum level, never from a schedule id such as 0721.",
      inputSchema: schema({
        term: enrollmentTerm,
        courseCodes: { ...courseCodes, maxItems: 30 },
        academicScope: {
          type: "object",
          properties: {
            academicUnit: { type: "string", minLength: 1, maxLength: 120 },
            specialty: { type: "string", maxLength: 120 },
            curriculumLevel: { type: "integer", minimum: 0, maximum: 30, description: "Official curriculum level shown by the historical report. A positive level identifies mandatory courses of that level; Nivel 0 contains Cursos Electivos; schedule ids do not define the level." }
          },
          required: ["academicUnit"],
          additionalProperties: false
        },
        page: { type: "integer", minimum: 1, maximum: 1000 },
        pageSize: { type: "integer", minimum: 1, maximum: 500 },
        ...refresh
      }, ["term"]),
      handler: (args) => service.searchHistoricalCourseSchedules(args)
    },
    {
      name: "get_course_schedule_details",
      description: "Return one or all active-term sections of a course with linked sessions, professors, rooms, modality, survey, live-or-cached capacity, personal position when published, and explained risk.",
      inputSchema: schema({ course: courseCode, schedule: { type: "string", minLength: 1, maxLength: 15 }, ...refresh }, ["course"]),
      handler: (args) => service.getCourseScheduleDetails(args)
    },
    {
      name: "list_cross_unit_vacancies",
      description: "List active-term courses and schedules for which other PUCP academic units publish differentiated vacancies; availability does not imply course eligibility.",
      inputSchema: schema({ term: enrollmentTerm, course: courseCode, academicUnit: { type: "string", maxLength: 120 }, limit: { type: "integer", minimum: 1, maximum: 500 }, ...refresh }),
      handler: (args) => service.listCrossUnitVacancies(args)
    },
    {
      name: "recommend_course_schedules",
      description: "Generate and rank active-term schedules after grouping every class, practice, laboratory, and exam belonging to each selected schedule. Incomplete component evidence is rejected rather than reported as conflict-free; never enrolls or controls the Campus generator.",
      inputSchema: schema({ courseCodes, preferences, maxResults: { type: "integer", minimum: 1, maximum: 20 }, ...refresh }, ["courseCodes"]),
      handler: (args) => service.recommendCourseSchedules(args)
    },
    {
      name: "evaluate_course_schedule",
      description: "Evaluate every class, practice, laboratory, and exam in a selected cached schedule combination. Returns incomplete validation instead of valid=true when required components or sessions cannot be resolved.",
      inputSchema: schema({
        selections: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: { courseCode, scheduleId: { type: "string", minLength: 1, maxLength: 15 } },
            required: ["courseCode", "scheduleId"],
            additionalProperties: false
          }
        },
        preferences
      }, ["selections"]),
      handler: (args) => service.evaluateCourseSchedule(args)
    },
    {
      name: "prepare_course_registration",
      description: "In verified regular enrollment only, prepare an exact live add/remove registration diff and a five-minute one-use token; this tool never writes to Campus and its result must be shown for explicit confirmation.",
      inputSchema: schema({
        add: registrationSelections,
        remove: registrationSelections
      }),
      handler: (args) => service.prepareCourseRegistration(args)
    },
    {
      name: "commit_course_registration",
      description: "In verified regular enrollment only and after explicit user confirmation, consume one prepared token and save exactly that registration diff once; never performs final matrícula or any other form action.",
      inputSchema: schema({
        confirmationToken: { type: "string", minLength: 16, maxLength: 200 },
        confirmed: { type: "boolean" }
      }, ["confirmationToken", "confirmed"]),
      handler: (args) => service.commitCourseRegistration(args)
    },
    {
      name: "get_enrollment_portal_section",
      description: "Return cached read-only content for one secondary enrollment portal section; never submits its actions.",
      inputSchema: schema({
        section: { type: "string", enum: ["student_data", "courses_schedules", "exceptions", "insurance_services", "contacts"] },
        includeSensitive: { type: "boolean", description: "Include personal values only when explicitly requested." },
        ...refresh
      }, ["section"]),
      handler: (args) => service.getEnrollmentPortalSection(args)
    },
    {
      name: "get_financial_status",
      description: "Read-only financial summary with amounts, due dates, payment dates, and status; never pays.",
      inputSchema: schema(refresh),
      handler: (args) => service.getFinancialStatus(args)
    },
    {
      name: "list_obligations",
      description: "Read-only list of cached obligations with available amounts, due dates, and status; never submits a payment.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.listObligations(args)
    },
    {
      name: "list_requests",
      description: "List cached request status only; never creates, updates, or submits a request.",
      inputSchema: schema(commonFilters),
      handler: (args) => service.listRequests(args)
    },
    {
      name: "search_campus_documents",
      description: "Search cached Campus document metadata; does not open or download files.",
      inputSchema: schema({
        query: { type: "string" },
        category: { type: "string", minLength: 1 },
        term: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        ...refresh
      }),
      handler: (args) => service.searchCampusDocuments(args)
    },
    {
      name: "download_campus_document",
      description: "Explicitly queue one cached Campus document download; routing uses cached sensitivity and cannot be overridden.",
      inputSchema: schema({
        document: { type: "string", minLength: 1 }
      }, ["document"]),
      handler: (args) => service.downloadCampusDocument(args)
    },
    {
      name: "list_campus_changes",
      description: "Return bounded summarized metadata changes per Campus module across recent syncs.",
      inputSchema: schema({
        module: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }),
      handler: (args) => service.listCampusChanges(args)
    }
  ];
}

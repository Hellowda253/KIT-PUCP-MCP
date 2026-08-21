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
      description: "Query cached Campus agenda events by inclusive date range, course, or comma-separated kinds.",
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
      description: "Return cached Campus agenda events for one YYYY-MM-DD date.",
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
      name: "get_enrollment_status",
      description: "Return cached read-only enrollment eligibility/status; never changes enrollment.",
      inputSchema: schema(refresh),
      handler: (args) => service.getEnrollmentStatus(args)
    },
    {
      name: "get_student_schedule",
      description: "Return the authenticated student's own active weekly schedule from the Campus Horario button, including classes, practices, laboratories, exams, rooms, and overlaps.",
      inputSchema: schema(refresh),
      handler: (args) => service.getStudentSchedule(args)
    },
    {
      name: "get_registration_portal_status",
      description: "Read the live active-registration view status, mode (regular or extemporaneous), term, enrollment turn, and course/credit totals without exposing identity or session fields.",
      inputSchema: schema(refresh),
      handler: (args) => service.getRegistrationPortalStatus(args)
    },
    {
      name: "get_registration_status",
      description: "Read live registered or prematriculated courses, statuses, and personal relative positions from the active regular or structurally compatible extemporaneous view.",
      inputSchema: schema(refresh),
      handler: (args) => service.getRegistrationStatus(args)
    },
    {
      name: "list_schedule_scopes",
      description: "List the faculties and specialties exposed by the live registration view while that view is available.",
      inputSchema: schema(refresh),
      handler: (args) => service.listScheduleScopes(args)
    },
    {
      name: "get_enrollment_calendar",
      description: "Return cached enrollment dates, windows, temporary closures, deadlines, and downloadable official calendar metadata.",
      inputSchema: schema({ term: enrollmentTerm, ...refresh }),
      handler: (args) => service.getEnrollmentCalendar(args)
    },
    {
      name: "get_enrollment_impediments",
      description: "Return cached read-only enrollment impediments and eligibility warnings; never resolves or submits them.",
      inputSchema: schema({ term: enrollmentTerm, ...refresh }),
      handler: (args) => service.getEnrollmentImpediments(args)
    },
    {
      name: "list_allowed_courses",
      description: "List the authenticated student's cached courses permitted for the enrollment term.",
      inputSchema: schema({ term: enrollmentTerm, ...refresh }),
      handler: (args) => service.listAllowedCourses(args)
    },
    {
      name: "search_course_schedules",
      description: "Search the active term using the live registration view when available and otherwise the shared PUCP schedule catalog; never accepts a term or uses historical data.",
      inputSchema: schema({
        courseCodes: { ...courseCodes, maxItems: 30 },
        courseName: { type: "string", maxLength: 120 },
        academicScope: {
          type: "object",
          properties: {
            academicUnit: { type: "string", minLength: 1, maxLength: 120 },
            specialty: { type: "string", maxLength: 120 },
            curriculumLevel: { type: "integer", minimum: 0, maximum: 30, description: "Official curriculum level shown by Campus; Nivel 0 contains Cursos Electivos. Requires specialty and is never inferred from course codes." }
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
      description: "Search the shared PUCP schedule catalog for an explicitly requested historical term; results are never used for active enrollment or registration writes.",
      inputSchema: schema({
        term: enrollmentTerm,
        courseCodes: { ...courseCodes, maxItems: 30 },
        academicScope: {
          type: "object",
          properties: {
            academicUnit: { type: "string", minLength: 1, maxLength: 120 },
            specialty: { type: "string", maxLength: 120 },
            curriculumLevel: { type: "integer", minimum: 0, maximum: 30, description: "Official curriculum level shown by the historical report; Nivel 0 contains Cursos Electivos." }
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
      description: "Return one active-term course schedule with linked sessions, professor, rooms, modality, survey, and capacity evidence.",
      inputSchema: schema({ course: courseCode, schedule: { type: "string", minLength: 1, maxLength: 15 }, ...refresh }, ["course", "schedule"]),
      handler: (args) => service.getCourseScheduleDetails(args)
    },
    {
      name: "get_course_enrollment_statistics",
      description: "Return active-term capacity, registrations, enrollment, personal position when published, and an explained non-guaranteed risk level.",
      inputSchema: schema({ course: courseCode, schedule: { type: "string", maxLength: 15 }, ...refresh }, ["course"]),
      handler: (args) => service.getCourseEnrollmentStatistics(args)
    },
    {
      name: "list_cross_unit_vacancies",
      description: "List active-term courses and schedules for which other PUCP academic units publish differentiated vacancies; availability does not imply course eligibility.",
      inputSchema: schema({ term: enrollmentTerm, course: courseCode, academicUnit: { type: "string", maxLength: 120 }, limit: { type: "integer", minimum: 1, maximum: 500 }, ...refresh }),
      handler: (args) => service.listCrossUnitVacancies(args)
    },
    {
      name: "recommend_course_schedules",
      description: "Generate and rank active-term non-conflicting schedules from the best currently available Campus source; never enrolls or controls the Campus generator.",
      inputSchema: schema({ courseCodes, preferences, maxResults: { type: "integer", minimum: 1, maximum: 20 }, ...refresh }, ["courseCodes"]),
      handler: (args) => service.recommendCourseSchedules(args)
    },
    {
      name: "evaluate_course_schedule",
      description: "Evaluate a selected cached schedule combination for overlaps, hard constraints, capacity risk, and ranking score.",
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
      name: "get_schedule_preferences",
      description: "Return effective default and optional private local schedule preferences without exposing credentials.",
      inputSchema: schema(),
      handler: () => service.getSchedulePreferences()
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
      name: "list_enrollment_portal_sections",
      description: "List all cached enrollment portal tabs, read-only actions, and permanently blocked mutation actions.",
      inputSchema: schema(refresh),
      handler: (args) => service.listEnrollmentPortalSections(args)
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

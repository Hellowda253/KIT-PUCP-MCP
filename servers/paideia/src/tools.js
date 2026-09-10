const refreshProperties = {
  forceRefresh: {
    type: "boolean",
    description: "Start a metadata refresh when true while returning the last good cache."
  }
};

const highStakesTopicPolicy = "For an assignment or TA, practical, lab, or exam topic, use authorized email > explicit Paideia instructions > current syllabus > materials. Stop on a clear instruction and label the result confirmed, scheduled, or inferred. An ordinary class uses the fast academic-week flow.";

const filterProperties = {
  course: { type: "string", minLength: 1 },
  section: { type: "string", minLength: 1 },
  type: { type: "string", minLength: 1 },
  query: { type: "string" },
  limit: { type: "integer", minimum: 1 },
  ...refreshProperties
};

function schema(properties = {}, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

export function createPaideiaTools(service) {
  return [
    {
      name: "get_paideia_status",
      description: "Report local Paideia cache freshness and background job state without contacting PUCP.",
      inputSchema: schema(),
      handler: () => service.getStatus()
    },
    {
      name: "sync_paideia",
      description: "Queue a headless metadata refresh. Use a focused scope to avoid loading unrelated course pages; full remains the default. Never downloads files or opens quiz attempts.",
      inputSchema: schema({
        scope: {
          enum: ["full", "catalog", "materials", "activities", "announcements", "grades"],
          description: "Refresh all metadata or only the component needed for the current task."
        },
        course: {
          type: "string",
          minLength: 1,
          description: "Optional course id, code, or name. Refreshes content only for that course while still updating the full current/future/past catalog."
        },
        courseConcurrency: { type: "integer", minimum: 1, maximum: 6 },
        detailConcurrency: { type: "integer", minimum: 1, maximum: 8 },
        retryUnavailableAreas: {
          type: "boolean",
          description: "Bypass the temporary Educación Continua cooldown for this explicit sync."
        }
      }),
      handler: (args) => service.syncPaideia(args)
    },
    {
      name: "get_paideia_job_status",
      description: "Return status and safe results for a Paideia sync or download job.",
      inputSchema: schema({
        jobId: { type: "string", minLength: 1 }
      }, ["jobId"]),
      handler: (args) => service.getJobStatus(args)
    },
    {
      name: "list_courses",
      description: "List normalized cached current, future, and past courses with their timeline classification and Paideia area.",
      inputSchema: schema({
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        ...refreshProperties
      }),
      handler: (args) => service.listCourses(args)
    },
    {
      name: "get_course_outline",
      description: `Return cached sections and compact activity samples for one unambiguous course. ${highStakesTopicPolicy}`,
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        maxSections: { type: "integer", minimum: 1, maximum: 60 },
        sampleLimit: { type: "integer", minimum: 1, maximum: 20 },
        includeEmptySections: {
          type: "boolean",
          description: "Include empty unnamed Moodle structural sections for diagnostics. Defaults to false."
        },
        ...refreshProperties
      }, ["course"]),
      handler: (args) => service.getCourseOutline(args)
    },
    {
      name: "list_activities",
      description: "Filter normalized cached Paideia activities by course, section, type, or text.",
      inputSchema: schema({
        ...filterProperties,
        limit: { type: "integer", minimum: 1, maximum: 200 }
      }),
      handler: (args) => service.listActivities(args)
    },
    {
      name: "get_activity_details",
      description: "Return or fetch on demand the safe overview details for a known assignment or quiz as explicit Paideia evidence; never opens an attempt or submission editor.",
      inputSchema: schema({
        activity: { type: "string", minLength: 1 },
        ...refreshProperties
      }, ["activity"]),
      handler: (args) => service.getActivityDetails(args)
    },
    {
      name: "list_pending_items",
      description: "List cached assignments and quizzes with deterministic filters and ordering.",
      inputSchema: schema({
        ...filterProperties,
        type: { enum: ["assignment", "quiz"] },
        limit: { type: "integer", minimum: 1, maximum: 100 }
      }),
      handler: (args) => service.listPendingItems(args)
    },
    {
      name: "list_next_pending_items",
      description: "Return the nearest dated cached assignments and quizzes.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        includePast: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
        ...refreshProperties
      }),
      handler: (args) => service.listNextPendingItems(args)
    },
    {
      name: "list_announcements",
      description: "List identifiable posts from a dedicated course announcements/news forum.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        ...refreshProperties
      }, ["course"]),
      handler: (args) => service.listAnnouncements(args)
    },
    {
      name: "list_course_grades",
      description: "Return cached rows from the authenticated student's own visible Moodle grade report.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        query: { type: "string" },
        ...refreshProperties
      }, ["course"]),
      handler: (args) => service.listCourseGrades(args)
    },
    {
      name: "search_materials",
      description: "Search cached material metadata; does not download or open files. For a TA, practical, lab, or exam topic, materials are last-resort evidence rather than confirmed instructions.",
      inputSchema: schema({
        ...filterProperties,
        limit: { type: "integer", minimum: 1, maximum: 80 }
      }),
      handler: (args) => service.searchMaterials(args)
    },
    {
      name: "get_paideia_folder_contents",
      description: "Queue a live, read-only inspection of one Moodle folder and return its visible nested files through get_paideia_job_status. Does not download files.",
      inputSchema: schema({
        folder: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      }, ["folder"]),
      handler: (args) => service.getFolderContents(args)
    },
    {
      name: "list_material_changes",
      description: "Summarize additions, removals, and metadata changes across recent Paideia syncs.",
      inputSchema: schema({
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }),
      handler: (args) => service.listMaterialChanges(args)
    },
    {
      name: "download_paideia_resource",
      description: "Explicitly queue one cached Paideia file or folder download inside the configured safe download root.",
      inputSchema: schema({
        resource: { type: "string", minLength: 1 },
        destination: { type: "string", minLength: 1 },
        overwrite: { type: "boolean" },
        skipExisting: { type: "boolean" }
      }, ["resource"]),
      handler: (args) => service.downloadResource(args)
    },
    {
      name: "download_course_materials",
      description: "Explicitly queue filtered downloads for exactly one course; existing files are skipped by default.",
      inputSchema: schema({
        course: { type: "string", minLength: 1 },
        section: { type: "string", minLength: 1 },
        type: {
          enum: ["resource", "folder"]
        },
        query: { type: "string" },
        destination: { type: "string", minLength: 1 },
        overwrite: { type: "boolean" },
        skipExisting: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      }, ["course"]),
      handler: (args) => service.downloadCourseMaterials(args)
    }
  ];
}

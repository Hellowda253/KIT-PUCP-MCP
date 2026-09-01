function tool(name, description, properties, handler, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    },
    handler
  };
}

const dateRange = {
  start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  days: { type: "integer", minimum: 1, maximum: 90 },
  limit: { type: "integer", minimum: 1, maximum: 200 }
};

const highStakesTopicPolicy = "For an assignment or TA, practical, lab, or exam topic, use authorized email > explicit Paideia instructions > current syllabus > materials. Stop on a clear instruction and label the result confirmed, scheduled, or inferred. An ordinary class uses the fast academic-week flow.";

export function createOverviewTools(service) {
  return [
    tool(
      "get_academic_overview",
      "Combine cached Paideia and Campus Virtual schedule, deadlines, grades, materials, and status-only alerts.",
      dateRange,
      (args) => service.getAcademicOverview(args)
    ),
    tool(
      "get_course_workspace",
      `Return one course workspace combining Paideia materials and pending work with Campus schedule and official grades. ${highStakesTopicPolicy}`,
      { course: { type: "string", minLength: 1 } },
      (args) => service.getCourseWorkspace(args),
      ["course"]
    ),
    tool(
      "list_upcoming_academic_items",
      "List upcoming cached Campus events and Paideia due items in chronological order.",
      {
        ...dateRange,
        course: { type: "string" }
      },
      (args) => service.listUpcomingAcademicItems(args)
    ),
    tool(
      "list_recent_academic_changes",
      "List summarized recent changes from Paideia and Campus Virtual sync history.",
      { limit: { type: "integer", minimum: 1, maximum: 100 } },
      (args) => service.listRecentAcademicChanges(args)
    ),
    tool(
      "get_academic_data_status",
      "Return availability, freshness, and generation timestamps for both academic caches.",
      {},
      () => service.getAcademicDataStatus()
    )
  ];
}

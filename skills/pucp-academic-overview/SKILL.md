---
name: pucp-academic-overview
description: Use when a PUCP student needs one combined view of current Paideia and Campus Virtual information, upcoming academic items, changes, or cross-source course context.
---

# Resumen académico PUCP

Usa `pucp_academic_overview` para una vista combinada. Prioriza Paideia para
entregas, actividades, avisos y materiales actuales; prioriza Campus Virtual
para horarios, aulas, modalidad y notas oficiales.

Durante matrícula, el resumen también puede incluir próximas fechas,
impedimentos y alertas agregadas de riesgo de vacante. Trata estas alertas como
señales basadas en la última consulta: muestra su antigüedad y no prometas una
vacante ni expongas detalles sensibles sin una consulta específica al servidor
de Campus. Las consultas históricas de horarios no alimentan estas alertas.

Usa `get_academic_overview` para el resumen general, `get_course_workspace`
para un curso, `list_upcoming_academic_items` para próximos eventos y
`list_recent_academic_changes` para novedades. Si una fuente no está disponible,
informa la advertencia y conserva la información de la otra; no inventes ni
elijas silenciosamente entre valores en conflicto.

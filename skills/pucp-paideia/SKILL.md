---
name: pucp-paideia
description: Use when a PUCP student asks about Paideia courses, activities, pending work, announcements, visible grades, continuing education, or explicit material downloads.
---

# Paideia PUCP

Usa el servidor `paideia`; no crees un perfil ni servidor adicional
para Educación Continua. Empieza con lecturas de caché:
`get_paideia_status`, `list_courses`, `list_pending_items`,
`list_announcements`, `list_course_grades` y `search_materials`.

La caché combina Pregrado/Posgrado y Educación Continua con la misma cuenta.
Conserva `area` al presentar o relacionar cursos. Revisa `areaStates`: si
`educacion_continua` aparece `unavailable`, explica que esa área no pudo leerse;
no concluyas que el estudiante carece de cursos allí.

Solicita `sync_paideia` solo si el usuario pide datos actuales o la caché está
vencida. La sincronización devuelve un trabajo; consulta su resultado con
`get_paideia_job_status`. Prefiere el alcance más pequeño que resuelva la
consulta: `catalog`, `materials`, `activities`, `announcements` o `grades`;
usa `full` cuando se necesite una actualización integral. Las consultas con
`forceRefresh` ya seleccionan automáticamente el componente pertinente. Si
Educación Continua está temporalmente inaccesible puede aparecer en `cooldown`;
no fuerces reintentos repetidos salvo que el usuario pida comprobarla ahora.

Descarga material únicamente si el usuario lo pide de forma explícita. Usa
`download_paideia_resource` o `download_course_materials`; no habilites
sobrescritura sin confirmación. Nunca abras intentos de quiz/examen ni envíes
tareas, mensajes o formularios.

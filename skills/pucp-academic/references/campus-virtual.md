# Campus Virtual

Usa el servidor `campus_virtual_pucp`. Si una consulta devuelve `pending`, sigue `get_campus_job_status` y repítela al completar el trabajo.

## Consultas personales

- Horario propio semanal: `get_student_schedule`, fuente del botón autenticado **Horario**. Prefiérelo sobre búsquedas de oferta cuando el estudiante pida su horario habitual, pero no lo uses para afirmar que una sesión ocurre en una fecha concreta.
- Agenda: usa `get_campus_day` para una fecha y `get_campus_agenda` para un rango. Para “hoy” o una fecha concreta prevalece la agenda; para “próxima clase”, consulta `get_campus_agenda` con un rango suficiente hasta hallar el siguiente evento. Un día vacío significa que no hay un evento confirmado allí: amplía el rango, no lo reemplaces con el horario semanal.
- Cursos matriculados: `list_enrolled_courses`.
- Compañeros de un curso visible: `list_course_participants`. Usa la clave del curso; filtra por horario si el usuario pide su sección. Los correos se omiten por defecto y `includeEmail: true` se usa solo cuando el usuario los necesita expresamente. No envíes correos ni uses los formularios del padrón.
- Notas oficiales: `list_official_grades`; para distribuciones publicadas usa las herramientas de estadísticas parciales o finales.
- Historia y rendimiento: `get_academic_history`, `get_academic_performance` y `get_curriculum_progress`.
- Documentos: busca primero y descarga solo si el usuario lo pide.
- Finanzas: `get_financial_status` y `list_obligations` solo informan montos, conceptos, vencimientos y estado. Nunca efectúan pagos.

Una agenda puede complementar una sesión cuando el detalle de oferta está incompleto, pero debe identificarse como fuente alternativa. Distingue `unavailable`, `not_visible`, `stale` y fallos de autenticación; no conviertas cualquiera de ellos en “no existe”.

Las acciones marcadas `blocked` son informativas. No envíes trámites, excepciones, seguros, solicitudes ni otros formularios.

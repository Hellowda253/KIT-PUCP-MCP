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

## Semana del ciclo y avance del curso

Aplica esta orientación cuando la pregunta dependa del momento académico, no para una duda conceptual independiente.

- Identifica la fecha actual en la zona horaria del Campus (America/Lima), el ciclo y el calendario oficial aplicable al programa del alumno. Usa la numeración institucional de semanas si existe; en su ausencia, estima la semana contando intervalos de siete días desde el inicio de clases y aclara que es una estimación. No uses el inicio de matrícula como inicio de clases ni extrapoles semanas fuera del periodo lectivo.
- Para «¿de qué trata mi próxima clase?», ubica primero la siguiente sesión fechada con `get_campus_agenda`. Distingue la semana actual de la semana de esa sesión si cruza de semana.
- Contrasta el cronograma del sílabo, las secciones de Paideia y los anuncios recientes. Consulta sesiones anteriores del curso cuando ayuden a ubicar el avance; una agenda pasada registra programación, no demuestra que se impartiera la clase ni qué tema se enseñó. No necesitas rastrear todos los cursos ni todas sus sesiones.
- No asumas semana 1 por ser el primer material visible. Semana del ciclo, unidad y número de sesión no son equivalentes: considera feriados, evaluaciones y reprogramaciones según la evidencia disponible.
- Si faltan fechas, el cronograma o el historial, o la respuesta es parcial, no inventes una semana ni un tema exactos. Distingue contenido programado de avance estimado y pide una aclaración solo si cambia la respuesta.

Las acciones marcadas `blocked` son informativas. No envíes trámites, excepciones, seguros, solicitudes ni otros formularios.

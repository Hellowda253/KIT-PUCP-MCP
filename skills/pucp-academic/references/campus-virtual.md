# Campus Virtual

Usa el servidor `campus_virtual_pucp`. Si una consulta devuelve `pending`, sigue `get_campus_job_status` y repítela al completar el trabajo.

## Consultas personales

- Horario propio semanal: `get_student_schedule`, fuente del botón autenticado **Horario**. Prefiérelo sobre búsquedas de oferta cuando el estudiante pida su horario habitual. Si devuelve `answerReady: false`, espera el job indicado y repite la consulta antes de entregar docentes, aulas, prácticas o exámenes. No lo uses para afirmar que una sesión ocurre en una fecha concreta.
- Agenda: usa `get_campus_day` para una fecha y `get_campus_agenda` para un rango. Para “hoy” o una fecha concreta prevalece la agenda; para “próxima clase”, consulta `get_campus_agenda` con un rango suficiente hasta hallar el siguiente evento. Un día vacío significa que no hay un evento confirmado allí: amplía el rango, no lo reemplaces con el horario semanal.
- Cursos matriculados: `list_enrolled_courses`.
- Compañeros de un curso visible: `list_course_participants`. Usa la clave del curso; filtra por horario si el usuario pide su sección. Los correos se omiten por defecto y `includeEmail: true` se usa solo cuando el usuario los necesita expresamente. No envíes correos ni uses los formularios del padrón.
- Notas oficiales: `list_official_grades`; para distribuciones publicadas usa las herramientas de estadísticas parciales o finales.
- Historia y rendimiento: `get_academic_history`, `get_academic_performance` y `get_curriculum_progress`.
- Documentos: busca primero y recupera los archivos pertinentes cuando sean necesarios para responder. No pidas una confirmación adicional para leerlos; mantén la confirmación antes de sobrescribir un archivo existente.
- Finanzas: `get_financial_status` y `list_obligations` solo informan montos, conceptos, vencimientos y estado. Nunca efectúan pagos.

Una agenda puede complementar una sesión cuando el detalle de oferta está incompleto, pero debe identificarse como fuente alternativa. Distingue `unavailable`, `not_visible`, `stale` y fallos de autenticación; no conviertas cualquiera de ellos en “no existe”.

## Semana del ciclo y avance del curso

Aplica esta orientación cuando la pregunta dependa del momento académico, no para una duda conceptual independiente.

Antes de elegir materiales, lee `academicContext` en la respuesta MCP: `currentDate` y `currentWeek` corresponden al reloj actual; `referenceDate` y `referenceWeek`, a la fecha de la clase consultada. No uses `cache.generatedAt` como fecha actual. Para una próxima clase, toma su fecha de la agenda y pásala como `referenceDate` al consultar el esquema o materiales de Paideia.

Si falta el calendario o el alcance es ambiguo, consulta `get_academic_calendar` en `pucp_academic_overview`. Si aparece `calendarRegistration.required`, cumple esa acción y repite la consulta antes de escoger una sección por semana. Para registrar o actualizar el calendario tras verificar la fuente, lee [calendario académico](academic-calendar.md). No reutilices otro ciclo, programa o calendario regular para verano. Explicita en una frase la fecha, semana y sección usadas antes de explicar el tema; si falta esa vinculación, presenta el tema como estimado, no confirmado.

- Identifica la fecha actual en la zona horaria del Campus (America/Lima), el ciclo y el calendario oficial aplicable al programa del alumno. Usa la numeración institucional de semanas si existe; en su ausencia, estima la semana contando intervalos de siete días desde el inicio de clases y aclara que es una estimación. No uses el inicio de matrícula como inicio de clases ni extrapoles semanas fuera del periodo lectivo.
- Para «¿de qué trata mi próxima clase?», ubica primero la siguiente sesión fechada con `get_campus_agenda`. Distingue la semana actual de la semana de esa sesión si cruza de semana.
- Contrasta el cronograma del sílabo, las secciones de Paideia y los anuncios recientes. Consulta sesiones anteriores del curso cuando ayuden a ubicar el avance; una agenda pasada registra programación, no demuestra que se impartiera la clase ni qué tema se enseñó. No necesitas rastrear todos los cursos ni todas sus sesiones.
- No asumas semana 1 por ser el primer material visible. Semana del ciclo, unidad y número de sesión no son equivalentes: considera feriados, evaluaciones y reprogramaciones según la evidencia disponible.
- `matchingSections` y `sectionMatchesReferenceWeek` solo comparan etiquetas explícitas de semanas. Comprueba anuncios y cronograma antes de adoptar esa selección; si `sectionsTruncated` es verdadero, amplía `maxSections` o consulta los materiales de la sección pertinente. No declares ausente una semana por no aparecer en una muestra limitada.
- Si faltan fechas, el cronograma o el historial, o la respuesta es parcial, no inventes una semana ni un tema exactos. Distingue contenido programado de avance estimado y pide una aclaración solo si cambia la respuesta.

## Tema de tareas, prácticas, laboratorios y exámenes

Este es un flujo estricto para tareas académicas —incluidas las TAs—, prácticas,
laboratorios y exámenes. No lo apliques a una clase teórica ordinaria: para una
próxima clase conserva el flujo rápido de agenda, semana, sección de Paideia y,
solo si hace falta, sílabo; no consultes el correo por defecto.

Primero identifica sin ambigüedad curso, actividad, fecha, horario, grupo o
sección y semana académica. Después respeta esta jerarquía de mayor a menor
autoridad:

1. **Correo institucional autorizado.** Si el agente dispone de acceso concedido
   por el usuario, busca indicaciones recientes del docente o jefe de práctica.
   Si no tiene acceso, continúa sin bloquearse y sugiere revisarlo únicamente
   cuando las fuentes disponibles no hayan confirmado la respuesta.
2. **Indicaciones explícitas de Paideia.** Revisa anuncios, detalle y adjuntos de
   la actividad, y documentos o secciones como “Programación de laboratorios”,
   “Indicaciones de laboratorio/examen”, “Sesiones de laboratorio” y nombres
   equivalentes. Verifica que correspondan al grupo y fecha consultados.
3. **Sílabo vigente.** Usa su cronograma y sistema de evaluación. Una indicación
   posterior y específica del correo o Paideia prevalece sobre el sílabo.
4. **Materiales relacionados.** Solo en último término infiere a partir de guías,
   diapositivas, lecturas o ejercicios de la semana pertinente.

Si aparece un documento explícito de programación, indicaciones o sesiones,
lee su contenido y vincula la fila correspondiente con la fecha y el grupo antes
de pasar al sílabo o a materiales de menor autoridad. El título o la metadata del
archivo no bastan. No saltes a fuentes inferiores porque el documento sea un
`resource` en vez de una carpeta.

Detén la búsqueda al hallar una indicación inequívoca; no consultes fuentes
inferiores salvo que necesites resolver una discrepancia. Presenta el resultado
como **indicado/confirmado**, **programado** o **probablemente inferido** según la
fuente. Nunca ocultes la falta de evidencia ni conviertas una inferencia de
materiales en una instrucción del docente. No tomes el primer archivo visible ni
el contenido genérico de una clase como tema de una TA, práctica, laboratorio o
examen.

Las acciones marcadas `blocked` son informativas. No envíes trámites, excepciones, seguros, solicitudes ni otros formularios.

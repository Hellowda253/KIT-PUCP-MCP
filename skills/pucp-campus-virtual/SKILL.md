---
name: pucp-campus-virtual
description: Use when a PUCP student asks about Campus Virtual data, grades, enrollment, course schedules (horarios), vacancies, documents, or a final or possible schedule as an HTML file.
---

# Campus Virtual PUCP

Usa `campus_virtual_pucp` y la herramienta más específica. Si devuelve
`pending`, espera con `get_campus_job_status` y repite.

## Matrícula y horarios

Para **su propio horario**, usa `get_student_schedule`: lee el botón autenticado
`Horario` y conserva clases, prácticas, laboratorios, exámenes, aulas y cruces.

Durante matrícula, “Inscríbete aquí” es la fuente principal de la oferta. Si la
vista cerró, `search_course_schedules` usa el catálogo compartido; advierte que
`Vac.`, `Vac.Unid`, `Ins.` y `Mat.` pueden diferir. Consulta
`get_registration_status`, `list_allowed_courses`, calendario e impedimentos
solo cuando estén disponibles.

`search_course_schedules` obtiene el ciclo vigente sin aceptar `term`. Usa
`search_historical_course_schedules` solo si piden otro ciclo; nunca mezcles sus
resultados con recomendaciones o cambios actuales. Mientras inscripción esté
activa, sus valores de capacidad, estado y `Posic. Relat.` prevalecen.
`get_course_enrollment_statistics` refresca la posición como `userPosition`.

`enrollmentMode: regular` es el flujo verificado. `extemporaneous` y `unknown`
son solo lectura y prohíben preparar o grabar.

Para facultad o especialidad usa `list_schedule_scopes` y pasa nombres visibles
en `academicScope`, no códigos internos. Un nivel exige especialidad; “Cursos
Electivos” es nivel `0`. No infieras niveles por prefijos o departamentos.

Para elegir usa `recommend_course_schedules`; no uses el generador del Campus.
Explica cruces, huecos, días y riesgo. Nunca describas una vacante como garantizada.
Evalúa con `evaluate_course_schedule`.

Si el usuario pide un horario visual, final, posible o elegido como archivo
HTML, lee y sigue `references/horario-html.md`. Usa el renderizador incluido y
entrega el archivo resultante. No escribas un HTML propio ni recrees la
plantilla desde cero.

## Cambios de inscripción

Solo guardar inscripción admite escritura y exige que el estado vivo indique
`enrollmentMode: "regular"`.

1. Llama `prepare_course_registration` con los cursos por agregar o retirar.
   Preparar no modifica Campus.
2. Muestra completos `before`, `add`, `remove`, `after`, advertencias y
   vencimiento. Pide confirmación explícita del cambio exacto.
3. Llama `commit_course_registration` con el token y `confirmed: true` solo
   tras una respuesta afirmativa inequívoca. Silencio, pregunta, corrección o
   aprobación parcial no cuentan.

El token dura cinco minutos y se consume al intentarlo. Si vence o cambia el
estado, prepara otro. Ante `registration_reconciliation_required`, consulta el
estado y no reintentes `Grabar`. No confirma la matrícula definitiva.

## Otras consultas y límites

Usa `list_official_grades` para notas oficiales; historia y rendimiento para
datos consolidados. Usa `get_academic_performance` para CRAEst, promedios y
mérito, y `get_enrollment_impediments` para bloqueos de matrícula. Usa las
herramientas estadísticas para evaluaciones. Si no
se publicaron estadísticas, informa `statistics_not_published`.

Usa `list_cross_unit_vacancies` para cupos de otras unidades. Diferencia
`Vac. Total` y `Vac. Unidad`; contrasta permisos con `list_allowed_courses`.

Para pagos, `get_financial_status` y `list_obligations` solo muestran montos,
fechas y estado; nunca pagan ni modifican datos.

Una acción marcada `blocked` solo se informa. Fuera del flujo confirmado, no
envíes matrícula, pagos, solicitudes, seguros, mensajes ni formularios.
Descarga documentos solo a petición.

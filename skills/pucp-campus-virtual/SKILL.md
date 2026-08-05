---
name: pucp-campus-virtual
description: Use when a PUCP student asks about Campus Virtual data, grades, enrollment, course schedules (horarios), vacancies, documents, or a final or possible schedule as an HTML file.
---

# Campus Virtual PUCP

Usa `campus_virtual_pucp` y la herramienta más específica. Para datos vencidos,
sincroniza; si devuelve `pending`, espera con `get_campus_job_status` y repite.

## Matrícula y horarios

Para matrícula, “Inscríbete aquí” es la fuente principal. Consulta
`get_registration_status`, `list_allowed_courses`, calendario e impedimentos.

Descubre la oferta vigente con `search_course_schedules`. No le pases un ciclo:
el servidor usa el encabezado visible del portal. Usa
`search_historical_course_schedules` con `term` solo si el estudiante pide otro
ciclo; nunca uses resultados históricos en recomendaciones ni cambios actuales.
Para `Vac.`, `Vac.Unid`, `Ins.`, `Mat.`, estado y `Posic. Relat.` prevalece el
portal vivo.

`get_registration_status` da `Posic. Relat.` al horario principal;
asociados usan `not_applicable`. `get_course_enrollment_statistics` la refresca
y expone como `userPosition`.

Revisa `enrollmentMode`: `regular` es el flujo verificado. `extemporaneous`
permite intentar consultas compatibles de cursos, horarios, vacantes y estado,
pero es solo lectura anticipada; al igual que `unknown`, prohíbe preparar o
grabar.

Antes de buscar por facultad o especialidad usa `list_schedule_scopes`. Pasa sus
nombres en `academicScope`, nunca códigos internos. Un nivel requiere también
especialidad; “Cursos Electivos” es nivel `0`. No deduzcas niveles por prefijo,
departamento, orden o mallas no consultadas: usa la clasificación del Campus.

Para elegir horario usa `recommend_course_schedules`. No uses el generador del Campus
ni combinaciones manuales. Explica cruces, huecos, días y riesgo.
Nunca describas una vacante como garantizada. Evalúa con `evaluate_course_schedule`. Para HTML lee
`references/horario-html.md` y conserva la plantilla.

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
estado y no reintentes `Grabar`. Esto no confirma la matrícula definitiva.

## Otras consultas y límites

Usa `list_official_grades` para notas oficiales; historia y rendimiento para
datos consolidados. Usa `get_academic_performance` para CRAEst, promedios y
mérito, y `get_enrollment_impediments` para bloqueos de matrícula. Usa las
herramientas estadísticas para evaluaciones. Si no
se publicaron estadísticas, informa `statistics_not_published`.

Usa `list_cross_unit_vacancies` cuando el estudiante pregunte por cursos o cupos
ofrecidos desde otra unidad académica. Diferencia `Vac. Total`, `Vac. Unidad` y
la distribución por unidad sin inferir permisos. Un resultado no confirma que el
curso esté permitido: contrástalo con `list_allowed_courses`.

Para pagos usa solo `get_financial_status` o `list_obligations`: muestran
montos, vencimientos, fechas y estado. Nunca pagan, confirman pagos ni modifican
datos financieros.

Una acción marcada `blocked` solo se informa. Fuera del flujo confirmado
anterior, no envíes matrícula, pagos, solicitudes, excepciones, seguros,
mensajes ni formularios. Descarga documentos solo a petición y muestra datos
sensibles únicamente cuando la consulta sea específica.

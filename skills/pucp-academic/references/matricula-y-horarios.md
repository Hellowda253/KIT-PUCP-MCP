# Matrícula y horarios

## Elegir la fuente

Para el ciclo actual usa las herramientas de matrícula y `search_course_schedules`. Si el curso pertenece a otra unidad académica, conserva `search_course_schedules`: el MCP pasa al catálogo institucional cuando el alcance personalizado no lo contiene; no uses `search_historical_course_schedules` solo por tratarse de una facultad externa. Durante una ventana activa prevalece el portal de inscripción; cuando cierre, el MCP usa el consultor autenticado y advierte que vacantes o inscritos pueden diferir. Para otro ciclo usa exclusivamente `search_historical_course_schedules` con `term`; nunca mezcles resultados históricos con recomendaciones o acciones actuales.

Para el horario ya matriculado del estudiante usa `get_student_schedule`, no una reconstrucción desde la oferta.

## Consultar y recomendar

- Consulta elegibilidad, turno, fechas e impedimentos con `get_enrollment_eligibility`.
- Consulta selección y `Posic. Relat.` con `get_registration_status`.
- Usa `list_allowed_courses` para permisos y `list_cross_unit_vacancies` para cupos de otras unidades; un cupo no equivale a permiso.
- Busca por códigos o `academicScope`. Obtén facultades y especialidades de los selectores reales; no supongas Ingeniería Industrial ni filtres por el prefijo del curso.
- Un nivel requiere la especialidad completa. En el consultor compartido/público respeta sus separadores: un nivel explícito positivo identifica los cursos obligatorios de ese nivel y **Cursos Electivos** corresponde al nivel `0`. El código de horario (`0721`, `0821`, etc.) no indica el nivel ni la obligatoriedad. Si el resultado no trae `curriculumLevel` o `curriculumGroup`, informa clasificación desconocida y no la deduzcas del código.
- Usa `get_course_schedule_details` para sesiones, asociados, docentes, aulas, capacidad, riesgo y posición.
- Usa `recommend_course_schedules` para generar alternativas y `evaluate_course_schedule` para una combinación concreta. Explica cruces, huecos, días, preferencias y evidencia de riesgo. Una vacante nunca está garantizada.

## Cambiar la inscripción

Solo el modo `regular` validado admite escritura:

1. Invoca `prepare_course_registration` con `add` y `remove`. No modifica Campus.
2. Muestra el antes, cambios, después, advertencias y vencimiento; pide confirmación explícita del cambio exacto.
3. Solo tras una respuesta afirmativa inequívoca invoca `commit_course_registration` con el token y `confirmed: true`.

El token dura cinco minutos, es de un uso y queda invalidado si cambia el estado. Ante `registration_reconciliation_required`, consulta el estado real y no reintentes `Grabar`. Este flujo no confirma la matrícula definitiva. Matrícula extemporánea permanece en lectura hasta que el conector valide esa vista.

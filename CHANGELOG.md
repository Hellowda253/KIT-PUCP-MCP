# Changelog

## Unreleased

## 0.4.0 - 2026-09-10

- Deduplica calendarios equivalentes, normaliza los nombres de programa y da precedencia al registro curado frente a respaldos locales.
- Devuelve `statistics_not_published` para notas finales aún no publicadas sin iniciar un trabajo de scraping innecesario.
- Compara cambios de agenda únicamente dentro del rango temporal compartido, registra el alcance usado y neutraliza diffs antiguos cuyo rango se desconoce.
- Reutiliza una sola sesión autenticada de navegador durante la vida de cada servidor y renueva solo lecturas idempotentes cuando la sesión expira.
- Enriquece el horario personal con una búsqueda agrupada y reintentos individuales únicamente para cursos omitidos, sin sustituir la fuente autoritativa del alumno.
- Descarga un registro JSON curado de calendarios actuales y próximos desde el repositorio, con caché persistente, copia incluida y respaldo local opcional.
- Documenta una línea base de tres sincronizaciones reales de Paideia y conserva la concurrencia actual al no existir una etapa que domine por sí sola el tiempo total.
- Evita cerrar la pestaña de Educación Continua mientras su catálogo AJAX sigue cargando y vuelve a abrir el área exacta cuando el SSO termina en Pregrado/Posgrado.
- Evita sondeos lentos del portal de inscripción después de las fechas publicadas y usa la semana académica verificada como respaldo cuando el calendario de matrícula no está disponible.
- Añade `forceProbe` a `get_registration_status` para reaperturas excepcionales y mantiene el catálogo de horarios y el horario matriculado como alternativas inmediatas.
- Hace que Profe PUCP sugiera, de forma pertinente y no repetitiva, hasta dos acciones complementarias que realmente pueda realizar con la evidencia disponible.

## 0.3.1 - 2026-09-06

- Agrupa clase, práctica, laboratorio y examen como una sola opción antes de recomendar o validar horarios; los componentes incompletos ya no pueden aparecer como una combinación válida.
- Degrada limpiamente las consultas de inscripción cuando la ventana de matrícula está cerrada y conserva como respaldo el horario matriculado y el catálogo vigente.
- Unifica la resolución de cursos de Paideia por ID, clave y nombre, permite recuperar detalles de actividades bajo demanda y deja de exponer rutas locales en el estado.
- Distingue cursos en curso o sin calificar de cursos desaprobados y enlaza el horario recurrente real dentro del espacio combinado del curso.
- Separa la frescura por curso, explicita el alcance de las estadísticas por horario y consolida el contexto académico cuando todos los eventos apuntan al mismo calendario.
- Convierte la ausencia del calendario académico en una acción de inicialización explícita para el agente, con evidencia oficial y persistencia JSON local.
- Permite calendarios verificados que cubren un programa completo mediante `courseKeys: ["*"]`.
- Bloquea cálculos superiores a la semana 19 hasta verificar el ciclo activo y actualizar el registro.
- Amplía a 700 palabras el umbral de compactación de la skill enrutadora `pucp-academic`.

## 0.3.0 - 2026-08-31

- Añade `get_academic_calendar` y `set_academic_calendar`: registro local de calendarios revisados por el agente, con alcance de programa, ciclo y cursos.
- Calcula la semana en cada consulta desde el reloj de America/Lima, separada de la fecha de caché y de la semana de una sesión futura o pasada.
- Admite verano, intensivos, intervalos publicados y semanas desconocidas sin inventar fechas.
- Añade contexto temporal y coincidencias de etiquetas de semanas a las respuestas académicas, sin ocultar materiales ni inferir el avance docente.
- Refuerza las skills para seleccionar materiales según fecha, semana y evidencia. Conserva el registro de calendarios fuera de Git.
- Actualiza contratos y pruebas de protocolo, reloj, límites y aislamiento.

## 0.2.0 - 2026-08-29

### Campus Virtual

- Simplifica la superficie pública de herramientas de matrícula y horarios.
- Separa las consultas del ciclo activo de las consultas históricas y mejora la resolución dinámica de unidades, especialidades y niveles.
- Mejora la lectura del horario propio, agenda, elegibilidad, vacantes entre unidades y participantes de cursos.
- Conserva los flujos de inscripción y retiro bajo vista previa y confirmación explícita.

### Paideia

- Añade sincronizaciones focalizadas por componente y mejores estados de trabajos en segundo plano.
- Permite explorar el contenido de carpetas Moodle y descargar archivos o carpetas bajo petición.
- Reduce actualizaciones innecesarias y conserva resultados parciales cuando un área no está disponible.

### Skills y horarios

- Consolida el kit en tres skills: `pucp-academic`, `profe-pucp` y `pucp-context`.
- Incluye el renderizador HTML de horarios y validaciones que impiden ocultar exámenes para sortear datos incompletos.
- Hace que Profe PUCP use, bajo demanda, materiales y bibliografía citada en el sílabo sin atribuirse acceso a fuentes no consultadas.
- Permite ofrecer durante la instalación una biblioteca académica opcional y configurable mediante `PUCP_DOWNLOADS_DIR`.

### Distribución

- Actualiza contratos MCP, pruebas, documentación de instalación y manifiestos para Codex, Antigravity y Claude.

## 0.1.0 - 2026-07-29

- Primera versión pública del kit comunitario PUCP-MCP.

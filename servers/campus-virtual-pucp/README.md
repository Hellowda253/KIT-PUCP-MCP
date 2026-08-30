# Campus Virtual PUCP MCP

Servidor MCP local y headless para el usuario autenticado de Campus Virtual
PUCP. Las consultas son de lectura; la única escritura habilitada guarda una
inscripción de cursos tras una vista previa y confirmación explícita de un solo
uso. No confirma la matrícula definitiva ni envía otros formularios.

## Herramientas

- `get_campus_status`, `get_campus_job_status`
- `sync_campus_virtual`, `list_campus_modules`, `list_campus_changes`
- `get_campus_agenda`, `get_campus_day`
- `get_student_schedule`
- `list_enrolled_courses`, `list_course_participants`, `list_official_grades`
- `get_partial_grade_statistics`, `get_final_grade_statistics`
- `get_academic_history`, `get_academic_performance`
- `get_curriculum_progress`, `get_enrollment_eligibility`
- `get_registration_status`
- `list_allowed_courses`, `search_course_schedules`
- `search_historical_course_schedules`
- `get_course_schedule_details`
- `list_cross_unit_vacancies`
- `recommend_course_schedules`, `evaluate_course_schedule`
- `prepare_course_registration`, `commit_course_registration`
- `get_enrollment_portal_section`
- `get_financial_status` y `list_obligations` consultan importes, vencimientos,
  fechas de pago y estados. No existe ninguna herramienta para pagar, confirmar
  pagos ni modificar información financiera.
- `list_requests`
- `search_campus_documents`, `download_campus_document`

Todas las respuestas exitosas usan el sobre de cinco campos con
`source: "campus_virtual_pucp"`. Los TTL son 12 horas para agenda, 2 horas para
datos académicos/notas y 48 horas para administración/documentos. Una consulta
vencida o con `forceRefresh` devuelve el último caché bueno y el `jobId` de la
actualización en segundo plano.

`list_course_participants` abre en vivo la vista autenticada **Alumnos** de un
curso visible para la cuenta. Puede limitarse a un horario y buscar por nombre
o especialidad. Devuelve nombre, horario y especialidad; la columna de correo
institucional solo aparece con `includeEmail: true`. No persiste el padrón en
los cachés, no devuelve códigos de alumno y nunca activa “Enviar Mail” ni los
formularios presentes en esa página.

Durante la ventana activa de matrícula, horarios, vacantes y oferta usan un TTL
de 5 minutos; cursos permitidos e impedimentos, 15 minutos. Fuera de esa
ventana usan 30 minutos y 2 horas, respectivamente. Calendario, programación y
secciones informativas usan 12 horas.

`list_cross_unit_vacancies` consulta el reporte autenticado “Vacantes que
ofrecen otras unidades” para el ciclo activo. Conserva la unidad oferente, curso,
créditos, tipo y número de horario, modalidad, horario asociado, `Vac. Total`,
`Vac. Unidad` y la distribución diferenciada publicada por el Campus. Sus filtros
por curso y unidad se aplican localmente sobre el reporte completo. Que un curso
aparezca no prueba que el alumno pueda llevarlo: debe contrastarse con
`list_allowed_courses` y las restricciones visibles de matrícula.

`get_registration_status` consulta en vivo `BuscarCursosInscritos` y conserva
la `Posic. Relat.` exacta del horario principal. Los horarios asociados que no
tienen una posición independiente se marcan `not_applicable`.
`get_course_schedule_details` reúne sesiones, docentes, aulas, capacidad y
riesgo; usa la misma posición viva para `capacity.userPosition` cuando la vista
de inscripción está disponible y recurre a evidencia del catálogo cuando no.
Si se omite `schedule`, devuelve todas las secciones encontradas del curso con
su capacidad y riesgo; si se proporciona, limita la respuesta a esa sección y
sus horarios vinculados.

`get_enrollment_eligibility` consolida ciclo, turno, estado del portal,
calendario, impedimentos y cantidad de cursos permitidos. El detalle completo
de estos últimos permanece en `list_allowed_courses` para evitar respuestas
innecesariamente grandes. Cada componente conserva su propio estado y fecha:
si una vista no está disponible, el resumen sigue entregando las demás y marca
la elegibilidad como `partial` en vez de ocultarlas.

## Migración de la superficie pública

La interfaz de matrícula se consolidó para reducir herramientas redundantes sin
eliminar los extractores internos:

- estado general, calendario e impedimentos se consultan con
  `get_enrollment_eligibility`;
- turno, resumen, cursos inscritos y posición relativa se consultan con
  `get_registration_status`;
- estadísticas de una sección o de todas las secciones de un curso se consultan
  con `get_course_schedule_details`;
- facultades y especialidades se resuelven dentro de
  `search_course_schedules`, a partir de sus nombres visibles;
- las preferencias efectivas aparecen en las respuestas de recomendación y
  evaluación, incluso cuando no existe una combinación válida;
- las secciones secundarias se abren directamente con
  `get_enrollment_portal_section`.

Los nombres públicos anteriores de esas consultas dejaron de anunciarse en
`tools/list`. Los contratos generados eliminan automáticamente sus archivos
JSON obsoletos para que Codex, Antigravity y Claude reciban la misma interfaz.

## Matrícula y recomendación de horarios

`get_student_schedule` es la fuente principal cuando el alumno pide su propio
horario: lee el botón autenticado `Horario` de Cursos y actividades académicas
y normaliza clases, prácticas, laboratorios, exámenes, aulas y superposiciones.

Para la oferta del ciclo vigente, durante una ventana activa el servidor
consulta primero “Inscríbete aquí”, cuyo encabezado visible determina el ciclo.
Cuando el calendario indica que la ventana terminó y la vista ya no se anuncia,
omite ese intento y consulta directamente el catálogo compartido de horarios,
evitando el timeout de una página cerrada. `search_course_schedules` no acepta
`term`; informa fuentes, antigüedad y discrepancias. Mientras el portal de
inscripción está activo, este prevalece para `Vac.`, `Vac.Unid`, `Ins.`, `Mat.`,
estado y `Posic. Relat.`. Fuera de esa ventana se advierte que los conteos del
catálogo pueden diferir de los valores de inscripción.
`search_historical_course_schedules` exige un ciclo y consulta ese mismo
catálogo; sus resultados no alimentan recomendaciones ni acciones actuales.

Si Campus reemplaza el rótulo por “Matrícula extemporánea”, el servidor intenta
leer la misma estructura y marca la respuesta con
`enrollmentMode: "extemporaneous"`. Esta compatibilidad anticipada solo habilita
consultas: preparar o grabar cambios queda bloqueado hasta validar la vista real.
El flujo regular conserva `enrollmentMode: "regular"` y su comportamiento
actual.

El servidor consulta directamente los reportes de cursos permitidos y horarios.
No abre ni controla el generador de horarios del Campus. `search_course_schedules`
requiere claves de curso o un alcance académico y pagina los resultados. Conserva
los valores oficiales de vacantes, inscritos y matriculados junto con sesiones,
profesores, aulas, modalidad, horarios asociados y evaluación docente cuando el
Campus los publica.

Las consultas con varias claves intentan primero el reporte por lote y recurren
automáticamente a un reporte exacto por curso si el Campus devuelve una
maquetación no reconocida. El resultado combinado identifica cualquier curso
que no pudo recuperarse en lugar de convertir toda la consulta en cero filas.

Las consultas por `academicScope` funcionan para todas las unidades publicadas
en el selector del Campus. El servidor normaliza nombres como `Facultad de
Ciencias Sociales`, resuelve el código oficial de la unidad y carga bajo demanda
el selector de carreras de esa facultad. La interfaz pública acepta únicamente
`academicUnit`, `specialty` y `curriculumLevel`; los códigos heredados de los
formularios de Campus se resuelven dinámicamente y nunca se solicitan al agente.
Para filtrar por nivel es obligatorio identificar también la especialidad, lo
que evita convertir una consulta incompleta en un listado plano de toda la
facultad.

El reporte completo separa la oferta con filas como `Nivel 4`, `Nivel 7` y
`Cursos Electivos`. El parser conserva esa clasificación en cada sección como
`curriculumLevel` y `curriculumGroup`; `Cursos Electivos` corresponde al nivel
`0`. Para pedir un nivel concreto se envía, por ejemplo,
`academicScope: { academicUnit: "CIENCIAS SOCIALES", specialty: "ECONOMÍA",
curriculumLevel: 5 }`. El filtro se aplica sobre las agrupaciones oficiales del
reporte; no usa prefijos de claves, departamentos ni una malla externa. Así se
conservan cursos obligatorios administrados por otras unidades y claves que
empiezan con un dígito.

`recommend_course_schedules` genera localmente combinaciones sin cruces para un
máximo de diez cursos. Por defecto ordena hasta cinco alternativas equilibrando
vacantes (35 %), huecos (20 %), días de asistencia (15 %), horas preferidas
(15 %), evaluación docente (10 %) y modalidad/ubicación (5 %). El usuario puede
sobrescribir preferencias y pesos en cada consulta. El riesgo nunca se presenta
como garantía y una sección riesgosa se penaliza, no se oculta.

El perfil opcional se lee desde
`data/campus-virtual-pucp/schedule-preferences.local.json` o la raíz definida por
`PUCP_DATA_DIR`. Es privado, está excluido de Git y nunca se envía al Campus.

Las estadísticas se consultan bajo demanda para evitar recorrer
automáticamente todas las evaluaciones. La primera llamada devuelve un
`jobId`; `get_campus_job_status` entrega el resultado y las llamadas
posteriores usan `grade-statistics.json` durante dos horas. La respuesta
normaliza cantidad, media, desviación estándar, mediana, mínimo, máximo,
porcentajes de aprobación/desaprobación, frecuencias y tipos de nota.

## Configuración local

Variables principales:

```dotenv
CAMPUS_PUCP_USER=
CAMPUS_PUCP_PASS=
CAMPUS_PUCP_BASE_URL=https://campusvirtual.pucp.edu.pe
CAMPUS_PUCP_PORTAL_URL=https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp
CAMPUS_PUCP_AGENDA_ENTRY_URL=https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda
CAMPUS_PUCP_AGENDA_JSON_URL=https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON
CAMPUS_PUCP_CHROME_PATH=
CAMPUS_PUCP_AUTH_HOSTS=pandora.pucp.edu.pe
CAMPUS_PUCP_READ_HOSTS=eros.pucp.edu.pe,ares.pucp.edu.pe
CAMPUS_PUCP_MAX_RESPONSE_BYTES=52428800
CAMPUS_PUCP_UNI_ROOT=.\downloads\Campus
CAMPUS_PUCP_PRIVATE_ROOT=.\downloads\Privado
```

Las credenciales Campus tienen prioridad y, si faltan, se usan
`PAIDEIA_USER`/`PAIDEIA_PASS`. No se guardan cookies ni contraseñas en Git, el
caché o los errores. El navegador siempre es headless y no ofrece un inicio de
sesión interactivo.

El caché predeterminado está en `data/campus-virtual-pucp/` y contiene
`cache.json`, `course-schedules.json`, `grade-statistics.json`,
`schedule-preferences.local.json`, `sync-history.json` y
`download-manifest.json`. También se puede
seleccionar una raíz local con `PUCP_DATA_DIR`.

## Seguridad de consultas y escritura confirmada

La política central exige HTTPS y orígenes PUCP exactos configurados. Bloquea
localhost, IP privadas, orígenes extranjeros, redirecciones finales no
permitidas, verbos/rutas/parámetros de mutación y formularios de módulo que
creen, guarden, paguen, matriculen, retiren, suban o modifiquen información.
Las credenciales solo se rellenan cuando la URL final pertenece exactamente a
un origen de autenticación permitido.

`sync_campus_virtual` nunca descarga archivos ni envía formularios de negocio.
Solo autentica, visita vistas de lectura y usa el POST conocido de Eros
`MostrarMiAgendaJSON` con las cuatro claves esperadas. La agenda conserva los
filtros de fechas/tipos del conector legado y decodifica la respuesta
ISO-8859-1 antes de normalizar acentos.

Dos reportes heredados adicionales —Rendimiento académico y Consolidado
curricular— requieren enviar su propio formulario. La política admite
exclusivamente los endpoints exactos de esos reportes, exige
`accion=Consultar`, limita tamaño/campos y mantiene bloqueado cualquier POST de
matrícula, pagos, solicitudes, edición o publicación.

En Rendimiento académico, el conector elige el reporte más reciente de alumnos
matriculados (`tiporend=2`) y no confunde el reporte de turno de matrícula
(`tiporend=1`) con CRAEst, promedios u orden de mérito. La verificación de
impedimentos permite únicamente `ValidarImpedimentos` sin cuerpo; también
acepta su redirección exacta de lectura POST→GET, pero rechaza parámetros
adicionales.

Los reportes de matrícula admitidos se limitan a sus formularios exactos. Una
excepción estrecha permite únicamente `ActualizarInscripcion`: primero
`prepare_course_registration` obtiene datos vivos, valida el resultado y crea
un token de cinco minutos; `commit_course_registration` vuelve a verificar el
estado y ejecuta `Grabar` una sola vez. El token se consume ante cualquier
intento. Una respuesta incierta exige conciliación con
`get_registration_status` y nunca provoca un reintento automático.

La excepción de escritura exige además que la vista viva sea la inscripción
regular verificada. Los modos `extemporaneous` y `unknown` son siempre de solo
lectura, aunque sus tablas puedan consultarse correctamente.

Permanecen bloqueados la matrícula definitiva, pagos, cursos permitidos,
excepciones, seguros, servicios y cualquier otro formulario. Las demás pestañas
solo se catalogan como lectura o `blocked`.

Las estadísticas de evaluaciones parciales y notas finales usan exclusivamente
`/pucp/estadist/eswnotpa/eswnotpa` y
`/pucp/estadist/eswnotfi/eswnotfi`. La política exige `accion=Dibuja` y valida
la lista exacta y el formato de cada campo observado en Campus.

La sincronización normaliza:

- notas parciales por evaluación, identificadas como `No oficial`;
- notas finales e historia por ciclo, conservando su estado oficial;
- CRAEst, promedios, créditos y orden de mérito de facultad/especialidad;
- plan vigente, créditos requeridos/acumulados y avance de cada curso;
- matrícula actual y turno a partir de la historia autenticada; los cursos
  permitidos quedan en `null` hasta que el Campus los publique;
- documentos realmente visibles dentro de cada curso, con una URL de descarga
  sin código de alumno ni identificador de sesión.

## Descargas

`download_campus_document` requiere un documento inequívoco ya presente en el
caché. El llamador no puede declarar ni reemplazar su sensibilidad:

- programas analíticos, sílabos y material académico se guardan en
  `<raíz académica>\<curso>`;
- cuando el curso no puede inferirse, se usa
  `<raíz académica>\Campus Virtual`;
- notas, certificados y documentos de pago/personales se guardan en
  `<raíz privada>\<categoría>`.

Se validan origen/redirección, MIME, extensión y tamaño antes de escribir. Las
rutas finales y todos los ancestros existentes se comprueban contra junctions
o enlaces; no se sobrescriben archivos. El manifiesto serializado deduplica
primero por URL y luego por tamaño/SHA-256.

## Ejecución y pruebas

```powershell
npm run start:campus
npm test --workspace @pucp-academic-mcp/campus-virtual-pucp
```

Las pruebas usan únicamente fixtures sanitizados e inyección de sesión/red; no
contactan a la PUCP.

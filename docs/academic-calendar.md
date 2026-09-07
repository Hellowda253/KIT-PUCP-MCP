# Contexto temporal académico

El kit calcula la semana al responder, usando el reloj del servidor en America/Lima. No utiliza la fecha de sincronización como fecha actual ni almacena la semana calculada en las cachés académicas.

## Contrato

- `get_academic_calendar`: consulta local, sin sesión PUCP; devuelve los calendarios registrados y sus semanas actuales. Permite `calendarId`, `course`, `term`, `program` y `date` opcional para otra fecha. Si falta uno, devuelve `calendarRegistration` para que el agente lo inicialice desde una fuente oficial antes de responder.
- `set_academic_calendar`: registro local de evidencia oficial revisada por el agente; sustituye un único id. No contacta ni modifica Campus. Conserva fecha de registro y verificación declarada por el agente. No valida automáticamente el contenido remoto de la fuente.
- Ambos se exponen en `pucp_academic_overview`. En web se integran en el único conector, sin requerir terminal.
- Las consultas de agenda, horario propio, materiales, esquema de curso, carpeta y overview incluyen `academicContext`. `referenceDate` opcional no altera `currentDate`. Los eventos fechados tienen su propia `academicTiming`.

Los campos de registro y el flujo para agentes están en [la referencia de la skill](../skills/pucp-academic/references/academic-calendar.md). No se distribuyen calendarios ni asignaciones personales en el repositorio.

## Persistencia y límites

El registro común se ubica en `data/academic-calendars.json` dentro del kit, o bajo `PUCP_DATA_DIR` si está configurado en el entorno del proceso. Los tres procesos locales deben compartir esa ruta. El conector remoto usa un archivo independiente bajo el directorio de cada perfil.

Las escrituras son atómicas y se serializan dentro del proceso que recibe las herramientas de calendario. No ejecute varios procesos escritores sobre el mismo registro. Cada respuesta lee una instantánea y calcula sus fechas de nuevo; no abre Playwright ni accede a PUCP para calcular semanas.

La asociación a cursos es explícita, sin deducir programa por carrera o prefijo. `courseKeys: ["*"]` representa todos los cursos únicamente cuando la evidencia cubre el programa completo. Dos calendarios coincidentes devuelven ambigüedad. Sin calendario, sin semana publicada para un intervalo, antes del inicio o después del fin de clases, no se inventa una semana. Los periodos de verano/intensivos usan registros separados.

La coincidencia de secciones reconoce etiquetas como “Semana 3”, “Semanas 3 y 4” y “Semanas 3 a 5”. Es una pista basada en el título, no una selección obligatoria ni prueba del avance real. No modifica los materiales originales ni oculta secciones.

El reloj del equipo servidor debe estar sincronizado. Los cambios de calendario requieren volver a verificar y registrar la fuente. Si un registro produciría una semana mayor que 19, el servidor oculta ese número y exige comprobar el ciclo activo. El registro es semiautomático por el agente: la página o PDF aporta evidencia y el MCP persiste el JSON local; no intenta mantener un extractor universal de todos los calendarios institucionales.

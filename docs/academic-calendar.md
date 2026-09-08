# Contexto temporal académico

El kit calcula la semana al responder, usando el reloj del servidor en America/Lima. No utiliza la fecha de sincronización como fecha actual ni almacena la semana calculada en las cachés académicas.

## Contrato

- `get_academic_calendar`: descarga periódicamente el registro JSON curado del repositorio, conserva una copia local y calcula sus semanas con el reloj actual. No requiere sesión PUCP. Permite `calendarId`, `course`, `term`, `program` y `date` opcional para otra fecha.
- `set_academic_calendar`: respaldo local para un ciclo oficial que aún no figure en el registro compartido; sustituye un único id. No contacta ni modifica Campus. Conserva fecha de registro y verificación declarada por el agente.
- Ambos se exponen en `pucp_academic_overview`. En web se integran en el único conector, sin requerir terminal.
- Las consultas de agenda, horario propio, materiales, esquema de curso, carpeta y overview incluyen `academicContext`. `referenceDate` opcional no altera `currentDate`. Los eventos fechados tienen su propia `academicTiming`.

Los campos y el flujo para agentes están en [la referencia de la skill](../skills/pucp-academic/references/academic-calendar.md). El repositorio distribuye únicamente fechas institucionales curadas, nunca asignaciones personales.

## Persistencia y límites

El registro compartido se publica en `config/academic-calendars.json` y se consulta desde la URL `raw.githubusercontent.com` del repositorio. El servidor guarda su última copia válida como `academic-calendar-registry-cache.json`. Los respaldos locales creados con `set_academic_calendar` se ubican en `data/academic-calendars.json`, o bajo `PUCP_DATA_DIR`; un respaldo con el mismo id prevalece localmente.

Las escrituras son atómicas y se serializan dentro del proceso que recibe las herramientas de calendario. No ejecute varios procesos escritores sobre el mismo registro. Cada respuesta lee una instantánea y calcula sus fechas de nuevo; no abre Playwright ni accede a PUCP para calcular semanas.

La asociación a cursos es explícita, sin deducir programa por carrera o prefijo. `courseKeys: ["*"]` representa todos los cursos únicamente cuando la evidencia cubre el programa completo. Dos calendarios coincidentes devuelven ambigüedad. Sin calendario, sin semana publicada para un intervalo, antes del inicio o después del fin de clases, no se inventa una semana. Los periodos de verano/intensivos usan registros separados.

La coincidencia de secciones reconoce etiquetas como “Semana 3”, “Semanas 3 y 4” y “Semanas 3 a 5”. Es una pista basada en el título, no una selección obligatoria ni prueba del avance real. No modifica los materiales originales ni oculta secciones.

El reloj del equipo servidor debe estar sincronizado. Si un registro produciría una semana mayor que 19, el servidor oculta ese número y pide refrescar el registro para comprobar el ciclo activo. La página o PDF oficial aporta la evidencia y el mantenedor cura el JSON del repositorio; el MCP no intenta mantener un extractor universal de todos los calendarios institucionales.

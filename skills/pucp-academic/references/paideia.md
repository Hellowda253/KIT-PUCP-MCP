# Paideia

Usa el servidor `paideia`. La misma cuenta puede contener las áreas `pregrado_posgrado` y `educacion_continua`; conserva `area` y revisa `areaStates` antes de afirmar que no existen cursos.

## Flujo

1. Empieza con la caché mediante la consulta específica: cursos, esquema del curso, actividades, pendientes, anuncios, notas visibles o materiales.
2. Si el usuario pide información actual o la caché está vencida, solicita una sincronización del componente mínimo: `catalog`, `materials`, `activities`, `announcements` o `grades`.
3. Si la sincronización devuelve un trabajo, consulta `get_paideia_job_status` hasta que termine y repite la consulta original.
4. Usa `full` solo cuando la solicitud realmente necesite todas las áreas y componentes.

Si Educación Continua está `unavailable` o en `cooldown`, conserva los resultados de Pregrado/Posgrado y explica la limitación. No fuerces reintentos repetidos salvo que el usuario pida comprobar esa área ahora.

## Inspección, descargas y límites

Para materiales de la semana o próxima clase, revisa `academicContext` y sigue [semana y avance](campus-virtual.md). Usa `referenceDate` para la fecha de la próxima sesión: nunca selecciones la primera sección visible por defecto.

Cuando el usuario pregunte por el tema o las indicaciones de una TA, tarea
académica, práctica, laboratorio o examen, aplica íntegramente «Tema de tareas,
prácticas, laboratorios y exámenes» en [Campus Virtual](campus-virtual.md). En
Paideia busca primero anuncios y el detalle de la actividad; después inspecciona
secciones, carpetas y documentos explícitos de programación, indicaciones o
sesiones. No sustituyas esas indicaciones por una inferencia basada en el primer
material encontrado.

`search_materials` descubre metadata. Una pregunta sobre el contenido, tema o
indicaciones autoriza recuperar los archivos estrictamente necesarios para
responder; no exige otra confirmación. Antes de abrir un resultado, enruta según
su `type`:

- `folder` -> `get_paideia_folder_contents`; espera el trabajo con
  `get_paideia_job_status` y revisa sus `items`.
- `resource` -> `download_paideia_resource`; después lee el archivo según su
  formato. El título o la URL por sí solos no sustituyen su contenido.
- `assignment` o `quiz` -> `get_activity_details`; nunca abras un intento.
- `forum` -> `list_announcements` cuando sea el foro de avisos del curso.

Si `get_paideia_folder_contents` devuelve `resource_not_folder`, no abandones la
fuente ni infieras desde materiales de menor autoridad: vuelve a la metadata,
confirma que es `resource` y continúa con `download_paideia_resource`. Si el
cliente no puede leer el archivo recuperado, explica esa limitación y entrega el
enlace de descarga disponible para que el usuario lo adjunte; no finjas haberlo
inspeccionado.

`download_paideia_resource` acepta un id, URL o título no ambiguo. Si la
referencia no estaba en la caché, hará una actualización focalizada antes de
descargar. Usa `download_course_materials` cuando la consulta abarque varios
materiales del curso. Nunca sobrescribas por defecto.

Tras una descarga masiva o un archivo grande, y ocasionalmente cuando varias
descargas acumulen un volumen considerable, informa la ruta de destino y el
espacio total aproximado ocupado por los materiales. No lo repitas después de
cada descarga pequeña ni inventes el tamaño: calcúlalo solo cuando el MCP o el
entorno puedan medirlo.

No abras intentos de quiz o examen ni envíes tareas, mensajes o formularios.

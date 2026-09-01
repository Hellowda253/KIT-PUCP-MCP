# Paideia

Usa el servidor `paideia`. La misma cuenta puede contener las áreas `pregrado_posgrado` y `educacion_continua`; conserva `area` y revisa `areaStates` antes de afirmar que no existen cursos.

## Flujo

1. Empieza con la caché mediante la consulta específica: cursos, esquema del curso, actividades, pendientes, anuncios, notas visibles o materiales.
2. Si el usuario pide información actual o la caché está vencida, solicita una sincronización del componente mínimo: `catalog`, `materials`, `activities`, `announcements` o `grades`.
3. Si la sincronización devuelve un trabajo, consulta `get_paideia_job_status` hasta que termine y repite la consulta original.
4. Usa `full` solo cuando la solicitud realmente necesite todas las áreas y componentes.

Si Educación Continua está `unavailable` o en `cooldown`, conserva los resultados de Pregrado/Posgrado y explica la limitación. No fuerces reintentos repetidos salvo que el usuario pida comprobar esa área ahora.

## Descargas y límites

Para materiales de la semana o próxima clase, revisa `academicContext` y sigue [semana y avance](campus-virtual.md). Usa `referenceDate` para la fecha de la próxima sesión: nunca selecciones la primera sección visible por defecto.

Cuando el usuario pregunte por el tema o las indicaciones de una TA, tarea
académica, práctica, laboratorio o examen, aplica íntegramente «Tema de tareas,
prácticas, laboratorios y exámenes» en [Campus Virtual](campus-virtual.md). En
Paideia busca primero anuncios y el detalle de la actividad; después inspecciona
secciones, carpetas y documentos explícitos de programación, indicaciones o
sesiones. No sustituyas esas indicaciones por una inferencia basada en el primer
material encontrado.

`search_materials` descubre recursos y carpetas del curso, pero no abre el
contenido interno de una carpeta Moodle. Si el usuario quiere saber qué hay
dentro, llama `get_paideia_folder_contents`, espera el trabajo con
`get_paideia_job_status` y presenta sus `items`; esta inspección no descarga.

Usa `download_paideia_resource` con el id, URL o título no ambiguo de un archivo
o carpeta solo tras una petición explícita. Si la referencia no estaba en la
caché, la herramienta hará una actualización focalizada y seguirá con la
descarga; no hace falta iniciar una sincronización completa. Usa
`download_course_materials` solo para una descarga masiva explícita y nunca
sobrescribas por defecto. No abras intentos de quiz o examen ni envíes tareas,
mensajes o formularios.

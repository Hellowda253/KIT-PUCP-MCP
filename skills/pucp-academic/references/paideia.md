# Paideia

Usa el servidor `paideia`. La misma cuenta puede contener las áreas `pregrado_posgrado` y `educacion_continua`; conserva `area` y revisa `areaStates` antes de afirmar que no existen cursos.

## Flujo

1. Empieza con la caché mediante la consulta específica: cursos, esquema del curso, actividades, pendientes, anuncios, notas visibles o materiales.
2. Si el usuario pide información actual o la caché está vencida, solicita una sincronización del componente mínimo: `catalog`, `materials`, `activities`, `announcements` o `grades`.
3. Si la sincronización devuelve un trabajo, consulta `get_paideia_job_status` hasta que termine y repite la consulta original.
4. Usa `full` solo cuando la solicitud realmente necesite todas las áreas y componentes.

Si Educación Continua está `unavailable` o en `cooldown`, conserva los resultados de Pregrado/Posgrado y explica la limitación. No fuerces reintentos repetidos salvo que el usuario pida comprobar esa área ahora.

## Descargas y límites

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

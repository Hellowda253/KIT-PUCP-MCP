# Servidor MCP de Paideia

Servidor local MCP por `stdio` para consultar un caché normalizado de Paideia
y, solo cuando se solicita explícitamente, sincronizar metadatos o descargar
materiales visibles para el usuario autenticado.

## Inicio y autenticación

```powershell
npm run start:paideia
```

Las credenciales se leen desde variables de entorno o un `.env.local` local
(directorio actual, raíz del monorepo o directorio del servidor):

- `PAIDEIA_USER` y `PAIDEIA_PASS`;
- `PAIDEIA_BASE_URL` (por defecto
  `https://paideiacursos.pucp.edu.pe`);
- `PAIDEIA_CONTINUING_BASE_URL` (por defecto
  `https://paideiaprogramas.pucp.edu.pe`); normalmente no debe cambiarse.
- `PAIDEIA_CHROME_PATH`, opcional, para un Chrome local explícito.
- `PAIDEIA_AUTH_HOSTS`, lista separada por comas de hosts HTTPS exactos
  autorizados para autenticación (por defecto `pandora.pucp.edu.pe`);
- `PAIDEIA_MAX_RESPONSE_BYTES`, límite por archivo descargado (100 MiB por
  defecto).

La automatización siempre inicia el navegador en modo headless. No abre una
ventana, no persiste cookies ni `storage-state` y no registra credenciales. Si
faltan credenciales o la sesión no se completa, el trabajo termina con
`authentication_required`.

Playwright es una dependencia del workspace. Los tests usan fixtures HTML
sanitizados e inyección del adaptador: nunca contactan a la PUCP.

## Caché y frescura

Por defecto, los archivos locales ignorados por Git están en:

```text
data/paideia/cache.json
data/paideia/sync-history.json
data/paideia/download-manifest.json
```

`PUCP_DATA_DIR` permite mover esa raíz. Los datos académicos usan TTL de 2
horas y los metadatos de materiales usan 48 horas. Una consulta vencida o con
`forceRefresh: true` devuelve inmediatamente el último caché válido con una
advertencia y un `refreshJobId`; la actualización corre en segundo plano. Un
fallo de actualización no elimina el último caché bueno.

`sync_paideia` usa la misma cuenta y sesión para consultar, en este orden:

1. Pregrado/Posgrado como área principal.
2. Educación Continua como área secundaria opcional.

No requiere perfiles ni un servidor MCP adicional. Cada curso indica `area`,
`areas` y `sourceId`. Los identificadores de Educación Continua se prefijan
para que no colisionen con identificadores numéricos iguales del otro Moodle.
`areaStates` informa si cada panel estuvo `available` o `unavailable`; un fallo
del área secundaria no elimina los cursos regulares. Si Educación Continua
falla, se aplica un enfriamiento temporal de 30 minutos para no repetir una
navegación fallida en cada consulta; `retryUnavailableAreas: true` permite un
reintento manual explícito.

La sincronización completa sigue siendo el valor predeterminado. Para consultas
específicas se admiten alcances generales y reutilizables: `catalog`,
`materials`, `activities`, `announcements` y `grades`. Las consultas con
`forceRefresh` eligen automáticamente el alcance pertinente. Por ejemplo, una
búsqueda de materiales actualiza catálogos y páginas de curso, pero no abre
detalles de tareas, foros de anuncios ni reportes de notas. El resultado del
trabajo incluye componentes, tiempos por etapa y fallos sanitizados.

La sincronización solo lee:

- listado y páginas visibles de cursos;
- páginas de descripción general de tareas y cuestionarios;
- foros dedicados identificables como avisos, anuncios, novedades o noticias;
- el reporte de calificaciones visible para el estudiante autenticado.

La sincronización no descarga archivos, no abre intentos de cuestionario, no
entra a editores de entrega y no lee información de otros estudiantes. Cuando
Paideia no expone un foro dedicado o reporte compatible, el caché registra
`state: "unavailable"` en lugar de fallar.

Todas las navegaciones, solicitudes y redirecciones pasan por una política
central: solo HTTPS, los dos orígenes exactos de Paideia y los orígenes de
autenticación configurados. Se rechazan hosts extranjeros, localhost, direcciones privadas,
intentos de cuestionario, acciones de edición/entrega y rutas que no sean de
lectura. Las credenciales solo se completan en un origen de autenticación
exactamente permitido.

## Herramientas públicas

Consultas de caché:

- `get_paideia_status`
- `list_courses`
- `get_course_outline`
- `list_activities`
- `get_activity_details`
- `list_pending_items`
- `list_next_pending_items`
- `list_announcements`
- `list_course_grades`
- `search_materials`
- `list_material_changes`

Operaciones asíncronas:

- `sync_paideia`
- `download_paideia_resource`
- `download_course_materials`
- `get_paideia_job_status`

Las operaciones que contactan Paideia devuelven un `jobId` sin bloquear
`stdio`. Toda respuesta exitosa usa `source`, `retrievedAt`, `cache`, `data` y
`warnings`, con `source: "paideia"`.

Los filtros de curso aceptan id, nombre o fragmento no ambiguo. Se puede filtrar
además por sección, tipo o texto según la herramienta. Los límites están
acotados por los esquemas MCP y el orden es determinista.

Los trabajos de descarga equivalentes en curso se deduplican y se admiten como
máximo dos descargas activas por defecto. Los trabajos terminados se resumen y
se eliminan por antigüedad/cantidad para no retener listas grandes de archivos
indefinidamente.

## Descargas explícitas y rutas seguras

Una sincronización jamás descarga archivos. Las únicas escrituras de material
parten de una llamada explícita a una herramienta `download_*` y se ejecutan
como trabajo asíncrono.

La raíz por defecto es:

```text
downloads\Paideia
```

`PUCP_DOWNLOADS_DIR` puede señalar cualquier raíz absoluta elegida por el
usuario. Cada curso se organiza genéricamente como `<raíz>\<curso>\<sección>`;
no existen mapeos personales ni nombres de carpetas especiales. Un destino
explícito también queda confinado mediante la comprobación léxica y de
`realpath` común.

Se admiten recursos/archivos y carpetas visibles. Las actividades URL, páginas,
foros, tareas y cuestionarios se distinguen como no descargables. Los formatos
visibles admitidos incluyen PDF, PowerPoint, Word, Excel/CSV, imágenes,
ZIP/RAR/7z y texto; también se respeta un nombre indicado por
`Content-Disposition`.

Por defecto no se sobrescribe. El manifiesto persistente deduplica primero por
URL de origen y después por tamaño más SHA-256; si el archivo registrado fue
eliminado, permite descargarlo nuevamente. Las páginas contenedoras sin archivos
no dejan directorios vacíos. La descarga masiva exige un
curso explícito, acepta filtros y omite archivos existentes por defecto.
Cada archivo exitoso se incorpora al manifiesto mediante una transacción
serializada y escritura atómica, por lo que un fallo posterior del lote no
elimina los éxitos anteriores.

Los nombres de Windows eliminan puntos/espacios finales, neutralizan nombres de
dispositivo y solo conservan una extensión académica aprobada. Antes de crear
directorios y antes de abrir cada archivo se repite la validación de ruta y se
rechaza cualquier ancestro existente que sea symlink/junction. Sin
sobrescritura se usa creación exclusiva (`wx`). Como en cualquier aplicación
local, queda una ventana TOCTOU mínima entre la última comprobación y la llamada
al sistema operativo; un proceso local con permisos suficientes podría cambiar
la jerarquía justo en ese instante.

## Pruebas

```powershell
npm test
npm test --workspace @pucp-academic-mcp/paideia
```

Ninguna prueba requiere credenciales, navegador ni red.

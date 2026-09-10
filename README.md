# PUCP-MCP

Kit MCP comunitario y local para estudiantes de la
Pontificia Universidad Católica del Perú. Integra Paideia, Campus Virtual PUCP
y un resumen académico combinado para asistentes compatibles con MCP.

Versión estable actual: **0.4.0**. Consulta el [historial de cambios](CHANGELOG.md).

Incluye [contexto de semana académica](docs/academic-calendar.md): descarga del
repositorio un registro JSON curado con los ciclos actuales y próximos, calcula
con el reloj actual y vuelve a verificar el ciclo antes de aceptar una semana
mayor que 19. Admite verano e intensivos mediante calendarios independientes.

> Proyecto comunitario no oficial. No está afiliado, respaldado ni operado por
> la PUCP. Cada estudiante ejecuta el servidor en su propio equipo y usa sus
> propias credenciales.

## Descripción

PUCP-MCP es un kit local y de código abierto que conecta asistentes de IA con
Paideia y Campus Virtual PUCP mediante Model Context Protocol (MCP). Permite
consultar cursos, materiales, actividades, notas, estadísticas, historia
académica, agenda, matrícula, vacantes, horarios, documentos e información de
pagos sin enviar las credenciales a un servidor administrado por este proyecto.

El kit incluye tres servidores MCP —Paideia, Campus Virtual y Academic
Overview— además de skills para orientar al agente sobre fuentes oficiales,
estudio académico y uso correcto de las herramientas. También puede comparar y
recomendar horarios y generar un horario HTML imprimible. La única escritura
permitida es guardar cambios de inscripción previamente preparados, mostrados y
confirmados explícitamente; tareas, formularios, pagos y matrícula definitiva
permanecen bloqueados.

## Qué incluye

- `paideia`: cursos de Pregrado/Posgrado y Educación Continua, actividades,
  entregas, avisos, calificaciones visibles y materiales descargables.
- `campus_virtual_pucp`: agenda, cursos matriculados, notas, historia,
  rendimiento, currículo, matrícula, finanzas, trámites, documentos y
  estadísticas institucionales de evaluaciones. También consulta en vivo los
  compañeros visibles en la pestaña `Alumnos` de cada curso, minimizando sus
  datos y ocultando correos por defecto. El horario propio se lee del
  botón autenticado `Horario`. Durante una ventana de matrícula consulta
  “Inscríbete aquí” como fuente principal; cuando esa vista ya cerró va
  directamente al catálogo compartido de horarios, cuyos conteos pueden diferir
  de los valores de inscripción. Separa las consultas actuales de las históricas y genera
  localmente recomendaciones de horarios. Puede preparar cambios de inscripción y
  guardarlos solo tras una confirmación explícita con token de un uso. Reconoce
  de forma anticipada una vista equivalente de “Matrícula extemporánea” para
  consultas, pero la mantiene en solo lectura hasta validarla contra el portal
  real.
- `pucp_academic_overview`: combina ambas fuentes sin iniciar sesión de nuevo.

Los tres servidores usan `stdio`, caché local, trabajos asíncronos y respuestas
MCP normalizadas. Las sincronizaciones nunca descargan archivos ni realizan
acciones académicas o administrativas.

## Instalación local

Requiere Node.js 20 o posterior.

### Instalación dirigida por un agente

Entrega el enlace de este repositorio a Codex, Antigravity, Claude Code o a un
agente con acceso al terminal y usa este mensaje:

> Instala PUCP-MCP desde este repositorio. Sigue `AGENTS.md`, configura este cliente,
> instala las skills y verifica los tres servidores. No muestres mis credenciales.

El agente puede generar una propuesta específica para Codex, Antigravity, Claude
Code o Claude Desktop y verificarla con `npm run doctor`. Consulta la
[guía de instalación](docs/installation.md) para credenciales, actualización,
reversión y desinstalación.

### Instalación manual

```powershell
git clone <URL-DEL-REPOSITORIO> PUCP-MCP
cd PUCP-MCP
npm ci
Copy-Item .env.example .env.local
```

Completa en `.env.local` solo tus credenciales y, de forma opcional, tus rutas
de descarga. No publiques ni compartas ese archivo.

```dotenv
PAIDEIA_USER=
PAIDEIA_PASS=
CAMPUS_PUCP_USER=
CAMPUS_PUCP_PASS=
```

Los valores por defecto guardan información local ignorada por Git en
`data/` y descargas en `downloads/Paideia`, `downloads/Campus` y
`downloads/Privado`. Puedes
cambiar esas rutas mediante las variables de `.env.example`.

### Primer uso

Reinicia el cliente después de instalar la configuración y las skills. Luego
puedes pedirle al agente:

> Sincroniza Paideia y Campus Virtual, espera a que terminen ambos trabajos y
> comprueba el estado de PUCP Academic Overview.

Overview combina las cachés locales; antes de la primera sincronización devuelve
`cache_unavailable`, que es el comportamiento esperado y no un fallo de
instalación.

## Ejecución

```powershell
npm run start:paideia
npm run start:campus
npm run start:overview
npm test
npm run doctor
```

Los servidores reciben JSON-RPC por stdin y escriben solo las respuestas MCP en
stdout. Consulta los README de cada servidor para su catálogo completo de
herramientas y límites:

- [Paideia](servers/paideia/README.md)
- [Campus Virtual PUCP](servers/campus-virtual-pucp/README.md)
- [Resumen académico](servers/overview/README.md)

## Seguridad y privacidad

- No se envían tareas, mensajes, pagos, solicitudes ni matrícula definitiva.
- La única escritura admitida es guardar una inscripción de cursos previamente
  mostrada y confirmada de forma explícita; todas las demás acciones quedan
  bloqueadas.
- Las descargas ocurren solo por una llamada explícita y no sobrescriben por
  defecto.
- Credenciales, cookies, cachés, descargas y registros locales están excluidos
  de Git.
- No subas capturas, HTML de sesión, documentos personales ni `data/` al
  repositorio.
- Revisa las condiciones de uso de Paideia y Campus Virtual antes de utilizarlo.

## Skills para asistentes

El repositorio incluye skills genéricas en [`skills/`](skills/) para orientar a
Codex u otros agentes que soporten el formato `SKILL.md`:

- `pucp-academic`: una entrada única para información personal de Paideia,
  Campus Virtual, matrícula, recomendaciones de horario y el horario HTML. Sus
  referencias especializadas se cargan solo cuando la consulta las necesita.
- `pucp-context`: selecciona fuentes oficiales para reglamentos, calendarios,
  trámites, servicios, bienestar, bibliotecas y oportunidades estudiantiles.
- `profe-pucp`: tutoría, preparación de evaluaciones y mejora académica basada
  en el contexto actual del estudiante.

Instálalas o cópialas en el directorio de skills de tu cliente. No contienen
datos de un estudiante ni rutas personales.

`pucp-context` mantiene su catálogo en
[`references/official-sources.yaml`](skills/pucp-context/references/official-sources.yaml).
El catálogo guarda puntos de entrada y criterios de consulta, no copias de la
información institucional; fechas, costos, convocatorias y contactos se
verifican en vivo.

## Desarrollo y contribuciones

Ejecuta `npm test` antes de abrir un cambio. Las pruebas usan fixtures
sanitizados y no requieren credenciales ni conexión a la PUCP. Conserva el
enfoque de mínimo privilegio: herramientas explícitas, validación exacta de
URL/campos y datos normalizados. Una escritura nueva requiere un flujo separado
de vista previa, confirmación y conciliación.

Para preparar una versión consulta la [lista de publicación](docs/release-checklist.md).

## Licencia

Código, documentación y skills se distribuyen bajo la [licencia MIT](LICENSE).
PUCP, Paideia y Campus Virtual son nombres y servicios de sus respectivos
titulares; este proyecto comunitario no concede derechos sobre ellos.

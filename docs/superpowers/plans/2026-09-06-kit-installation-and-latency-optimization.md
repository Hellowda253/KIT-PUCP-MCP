# KIT PUCP MCP: instalación agent-first y optimización de latencia

> **Para la ejecución:** usar `superpowers:executing-plans` y completar las tareas en esta misma sesión, sin subagentes. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** reducir una instalación nueva de aproximadamente veinte minutos a un flujo reproducible de dos a cinco minutos y reducir la latencia de las consultas en vivo sin alterar los resultados académicos.

**Arquitectura:** la vía principal para Windows será un ZIP portátil publicado en cada GitHub Release con Node 24 LTS, dependencias de producción, servidores, skills, plantilla y recursos. Un manifiesto JSON permitirá que un agente conozca la ruta exacta sin explorar alternativas y un bootstrap pequeño configurará el cliente de forma no interactiva e idempotente. Campus y Paideia conservarán su caché actual; las operaciones en vivo reutilizarán el navegador y renovarán la sesión cuando PUCP la invalide.

**Tecnologías:** PowerShell 5.1+, Node.js 24 LTS, npm workspaces, Playwright, MCP stdio, `node:test`, GitHub Actions y GitHub Releases.

---

## Decisiones fijadas

- La instalación estará diseñada principalmente para agentes con acceso a terminal.
- Git no será necesario para estudiantes; quedará como opción de desarrollo.
- El bootstrap no instalará software global, no modificará `PATH` y no requerirá administrador.
- Windows 11 x64 será soportado; Windows 10 22H2 x64 tendrá compatibilidad probada de mejor esfuerzo.
- ChatGPT y Claude web seguirán usando el MCP remoto; el paquete local será para Codex, Antigravity, Claude Desktop/Code y clientes similares.
- La instalación normal no ejecutará `npm test` ni contactará a PUCP.
- Ningún artefacto incluirá credenciales, cachés, descargas, perfiles o datos personales.
- Una herramienta puede usar un job interno, pero el agente no entregará al usuario un horario final incompleto cuando haya pedido detalles.
- Educación Continua accesible y sin cursos seguirá siendo `available` con `courseCount: 0`; el cooldown solo se aplicará a errores reales.
- No se reescribirá todo para eliminar Playwright: el catálogo de horarios ya usa solicitudes HTTP dentro de una sesión.

## Mapa de archivos

### Crear

- `installation-manifest.json`: contrato legible por agentes.
- `scripts/bootstrap-windows.ps1`: configurador no interactivo.
- `scripts/build-portable-release.ps1`: constructor reproducible del ZIP.
- `scripts/lib/install-telemetry.js`: tiempos de instalación sanitizados.
- `packages/common/src/browser-discovery.js`: detección compartida de Chrome y Edge.
- `packages/common/test/browser-discovery.test.js`: pruebas de detección.
- `test/bootstrap-windows.test.js`: pruebas de bootstrap y manifiesto.
- `.github/workflows/release-portable-windows.yml`: creación automática del artefacto.
- `servers/campus-virtual-pucp/src/session-manager.js`: navegador y sesión reutilizables.
- `servers/campus-virtual-pucp/test/session-manager.test.js`: ciclo de vida de sesión.
- `docs/performance-baseline.md`: mediciones antes/después.

### Modificar

- `package.json`, `AGENTS.md`, `README.md` y `docs/installation.md`.
- `packages/common/src/index.js`.
- `scripts/lib/doctor.js`, `scripts/lib/installation-config.js` y `scripts/generate-install-config.js`.
- Configuración y adaptadores de Paideia y Campus.
- Servicio, herramientas y pruebas de horarios de Campus.

---

## Entrega A — instalación agent-first

### Tarea 1: contrato de instalación para agentes

- [ ] Crear primero pruebas que exijan estos campos en `installation-manifest.json`:

```json
{
  "recommendedMethod": "portable-release",
  "requiresGit": false,
  "requiresAdmin": false,
  "platform": "win-x64",
  "supportedClients": ["codex", "antigravity", "claude-desktop", "claude-code"],
  "servers": ["paideia", "campus_virtual_pucp", "pucp_academic_overview"],
  "skills": ["pucp-academic", "pucp-context", "profe-pucp"],
  "installCommand": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-windows.ps1 -Json",
  "verificationCommand": "runtime/node/node.exe scripts/doctor.js --json"
}
```

- [ ] Hacer que `AGENTS.md` ordene leer primero el manifiesto, preferir la release portátil, no instalar Git y no probar estrategias distintas antes de ejecutar el bootstrap.
- [ ] Probar con `node --test test/installation-flow.test.js test/installation-docs.test.js test/bootstrap-windows.test.js`.
- [ ] Commit: `docs: define agent-first installation contract`.

### Tarea 2: artefacto portátil reproducible

- [ ] Escribir una prueba que inspeccione un artefacto simulado y rechace `.env.local`, `data/`, `remote-data/`, cachés, descargas, rutas personales y archivos fuera del inventario.
- [ ] Implementar `scripts/build-portable-release.ps1` para descargar una versión exacta de Node 24 LTS desde `nodejs.org`, verificar su SHA-256 oficial, ejecutar `npm ci --omit=dev` en un directorio temporal y copiar servidores, paquetes, skills, plantilla, documentación y contratos.
- [ ] Generar `KIT-PUCP-MCP-vX.Y.Z-win-x64.zip` y `SHA256SUMS.txt`; eliminar el directorio temporal al finalizar.
- [ ] Añadir en `package.json`:

```json
{
  "build:portable": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable-release.ps1",
  "bootstrap:windows": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-windows.ps1",
  "verify:install": "node scripts/doctor.js --json"
}
```

- [ ] Probar el contenido del ZIP y ejecutar `doctor` utilizando el `node.exe` empaquetado.
- [ ] Commit: `build: create portable Windows release`.

### Tarea 3: bootstrap pequeño, idempotente y recuperable

- [ ] Escribir pruebas `-DryRun -Json` para Codex, Antigravity, Claude Desktop y Claude Code.
- [ ] Implementar parámetros explícitos `Client`, `InstallDir`, `Json`, `DryRun` y `Update`.
- [ ] Detectar cliente y navegador una sola vez, crear copias de seguridad, escribir rutas absolutas hacia el Node incluido, instalar las tres skills y conservar todos los recursos.
- [ ] Guardar únicamente versión, cliente y archivos administrados en `.runtime/install-state.json`.
- [ ] En una segunda ejecución, no duplicar servidores ni skills y omitir escrituras innecesarias.
- [ ] Si `doctor` falla, restaurar la configuración anterior y devolver JSON con código, etapa y siguiente acción.
- [ ] No descargar Node, instalar Git, ejecutar `npm ci`, abrir interfaces ni modificar el entorno global.
- [ ] Commit: `feat: add idempotent agent bootstrap`.

### Tarea 4: navegador compartido y verificación rápida

- [ ] Escribir pruebas para esta precedencia: override específico → Chrome → Edge → navegador de Playwright → error estructurado.
- [ ] Implementar `discoverBrowserExecutable()` con dependencias inyectables para probar Windows sin depender de la máquina real.
- [ ] Usar la misma función en `doctor`, Campus y Paideia.
- [ ] No exponer la ruta completa del navegador en respuestas MCP públicas.
- [ ] Mantener en `doctor` los tres handshakes `initialize` y `tools/list`; añadir duración por servidor y evitar cualquier inicio de sesión PUCP.
- [ ] Mover `npm test` a la sección de desarrollo de la documentación.
- [ ] Probar detección, configuraciones y doctor en una sola ejecución focalizada.
- [ ] Commit: `fix: share browser discovery and fast verification`.

### Tarea 5: publicación automatizada y matriz Windows

- [ ] Crear un workflow que se ejecute para etiquetas, construya el ZIP, busque secretos y datos personales, ejecute `doctor` con Node empaquetado y adjunte ZIP y hashes a GitHub Releases.
- [ ] Probar manualmente en VM limpia con Windows 10 22H2 x64 y Windows 11 x64.
- [ ] Registrar tiempos de descarga, extracción, configuración y verificación.
- [ ] Objetivos: 15–40 segundos con artefacto descargado y 1–3 minutos incluyendo descarga, sin exploración de métodos alternativos por el agente.
- [ ] Commit: `ci: publish tested portable Windows artifacts`.

---

## Entrega B — latencia de las consultas en vivo

### Tarea 6: reutilización del navegador y sesión

- [ ] Escribir pruebas que demuestren que dos lecturas consecutivas crean un solo navegador y una sola autenticación.
- [ ] Crear el navegador de forma perezosa en la primera consulta y mantenerlo durante la vida del proceso MCP.
- [ ] Reutilizar un contexto autenticado mientras Campus o Paideia lo acepten.
- [ ] Ante una redirección de autenticación, renovar el contexto una vez y repetir únicamente lecturas idempotentes.
- [ ] No reintentar escrituras de matrícula ni respuestas inciertas.
- [ ] Cerrar páginas tras cada operación y cerrar contexto/navegador cuando termine stdin o el proceso MCP.
- [ ] Registrar solo `browserCreated`, `sessionReused`, `authenticationMs`, `operationMs` y códigos sanitizados.
- [ ] Probar el administrador de sesiones y ambos adaptadores.
- [ ] Commit: `perf: reuse authenticated browser sessions`.

### Tarea 7: horario personal completo con consulta agrupada

- [ ] Escribir una prueba donde tres cursos sin docentes generen una sola búsqueda agrupada.
- [ ] Si la respuesta agrupada omite un curso, consultar individualmente solo ese código.
- [ ] Deduplicar trabajos concurrentes del mismo ciclo y conjunto de cursos.
- [ ] Mantener el protocolo `jobId` para evitar timeouts, pero indicar en la herramienta y la skill que el agente debe esperar y volver a consultar antes de responder cuando el usuario pidió profesores, aulas, prácticas o exámenes.
- [ ] Si el enriquecimiento falla definitivamente, conservar el horario personal autoritativo e identificar únicamente los campos faltantes.
- [ ] No sustituir silenciosamente el horario personal por la agenda; la agenda seguirá siendo la fuente para eventos en fechas concretas.
- [ ] Commit: `perf: batch complete student schedule enrichment`.

### Tarea 8: validar la sincronización actual de Paideia

- [ ] Confirmar mediante pruebas los tiempos ya existentes: `catalogMs`, `courseContentMs`, `activityDetailsMs`, `announcementsMs`, `gradesMs` y `totalMs`.
- [ ] Confirmar que Educación Continua accesible y vacía devuelve `{"area":"educacion_continua","state":"available","courseCount":0}`.
- [ ] Confirmar que solo un fallo real activa el cooldown existente y que `retryUnavailableAreas: true` lo omite expresamente.
- [ ] No crear un segundo sistema de métricas ni aumentar concurrencia sin evidencia.
- [ ] Medir tres sincronizaciones reales y optimizar únicamente la etapa que explique la mayor parte del tiempo.
- [ ] Commit: `test: validate Paideia performance behavior`.

---

## Verificación final

- [ ] Ejecutar `npm test` como mantenedor.
- [ ] Ejecutar el artefacto portátil en Windows 10 y 11 limpios.
- [ ] Instalarlo con un agente usando únicamente el enlace del repositorio y comprobar que lee primero el manifiesto.
- [ ] Repetir la instalación y confirmar que no duplica ni rompe configuraciones.
- [ ] Probar `initialize`, `tools/list` y una llamada segura en cada servidor.
- [ ] Medir consulta fría y caliente del horario personal.
- [ ] Confirmar que no aparecen credenciales, cookies, identificadores personales, rutas privadas ni cachés en ZIP, logs o respuestas públicas.
- [ ] Guardar resultados en `docs/performance-baseline.md` antes de crear el release.

# Especificación técnica: PUCP MCP remoto basado en APIs institucionales

**Estado:** propuesta de arquitectura aprobada para especificación  
**Fecha:** 2026-08-18  
**Audiencia:** DTI PUCP, equipos responsables de Campus Virtual, Paideia, identidad, seguridad e infraestructura  
**Relación con el proyecto actual:** evolución del `KIT-PUCP-MCP` local, conservando sus contratos funcionales y retirando Playwright del camino principal

## 1. Resumen ejecutivo

La solución objetivo es un complemento remoto llamado **PUCP**, accesible desde clientes compatibles con MCP como ChatGPT, Claude y Gemini. El complemento permitirá que cada estudiante consulte y, en casos expresamente autorizados, modifique información académica utilizando su identidad institucional.

El MCP remoto no navegará las interfaces HTML de Campus Virtual ni Paideia. Consumirá una **API Académica PUCP** estable, autenticada y auditable. Esta API unificará datos provenientes de Campus Virtual y Paideia/Moodle sin entregar al MCP acceso directo a sus bases de datos.

La arquitectura separará dos clases de operaciones:

- **Lectura y descarga:** cursos, horarios, notas, estadísticas, agenda, materiales, documentos, vacantes, matrícula, obligaciones e información de pagos.
- **Comandos confirmados:** inicialmente, agregar o retirar cursos durante la inscripción. Cada operación seguirá el flujo `prepare → confirmación explícita → commit`.

Playwright podrá mantenerse temporalmente como adaptador de compatibilidad para funciones todavía no cubiertas por una API, pero no formará parte del contrato público ni de la arquitectura final.

## 2. Objetivos

1. Mantener las capacidades académicas útiles del MCP local en clientes web.
2. Eliminar la dependencia operativa de navegadores automatizados para el uso normal.
3. Autenticar estudiantes mediante identidad institucional sin entregar contraseñas al agente.
4. Aplicar autorización por usuario, rol, recurso y acción.
5. Ofrecer contratos estables aunque cambien las interfaces de Campus o Paideia.
6. Escalar durante periodos de alta demanda, especialmente matrícula.
7. Producir trazabilidad suficiente para investigar accesos y comandos sensibles.
8. Permitir que el MCP local y el remoto compartan modelos, herramientas y pruebas de contrato.

## 3. Fuera de alcance inicial

- Envío de tareas, respuestas de cuestionarios o publicaciones en foros de Paideia.
- Pagos, transferencias o modificación de información financiera.
- Matrícula definitiva u otros trámites distintos de la inscripción o retiro de cursos expresamente habilitados.
- Acceso directo del MCP a bases de datos productivas.
- Entrega de cookies, contraseñas o tokens institucionales al modelo de IA.
- Uso de resultados históricos para ejecutar acciones sobre un ciclo vigente.
- Persistencia automática de documentos en el equipo local desde clientes web.

## 4. Arquitectura objetivo

```text
┌──────────────────────────────────────────────────────────────┐
│ ChatGPT web · Claude web · Gemini · otros clientes MCP       │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTPS + MCP Streamable HTTP
                               │ OAuth 2.0 / PKCE
┌──────────────────────────────▼───────────────────────────────┐
│ MCP remoto PUCP                                              │
│ herramientas · validación · confirmaciones · presentación    │
└──────────────────────────────┬───────────────────────────────┘
                               │ token institucional delegado
┌──────────────────────────────▼───────────────────────────────┐
│ API Gateway Académico PUCP                                  │
│ autenticación · autorización · cuotas · auditoría · routing  │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼───────────────┐
│ API de Campus Virtual       │  │ API de integración Paideia │
│ agenda, notas, matrícula,   │  │ Moodle web services/plugin │
│ currículo, documentos      │  │ cursos, tareas, materiales │
└───────────────┬──────────────┘  └────────────┬───────────────┘
                │                              │
       Campus Virtual                      Paideia/Moodle

Servicios transversales:
identidad · caché · eventos · trabajos · archivos · auditoría · observabilidad
```

## 5. Componentes

### 5.1 Proveedor de identidad PUCP

Responsabilidades:

- Autenticar al usuario en una página institucional.
- Emitir identidad verificable y tokens de corta duración.
- Incorporar `sub`, código interno estable, rol y afiliación cuando corresponda.
- Permitir autorización delegada con OAuth 2.0/OpenID Connect.
- Renovar y revocar sesiones sin exponer credenciales al MCP.

Si la identidad institucional actual está basada en SAML, se implementará un broker institucional que traduzca la sesión SAML a tokens OAuth/OIDC para aplicaciones modernas. No se intentará convertir cookies de navegador en credenciales del MCP.

### 5.2 API Gateway Académico

Será el único punto de entrada a las APIs académicas. Aplicará:

- Validación de tokens.
- Autorización por scopes y propietario del recurso.
- Limitación de solicitudes por usuario, cliente y endpoint.
- Identificadores de correlación.
- Auditoría de comandos.
- Enrutamiento a Campus, Paideia, archivos y trabajos.
- Versionado y retirada controlada de contratos.

### 5.3 API de Campus Virtual

Expondrá modelos normalizados para agenda, cursos, horarios, notas, estadísticas, historia académica, currículo, inscripción, vacantes, documentos, obligaciones e información de pagos.

Su implementación podrá envolver servicios internos existentes o una capa de dominio nueva. El MCP nunca dependerá de nombres de formularios, columnas HTML, JavaScript de la interfaz ni identificadores de sesión visibles en URLs.

### 5.4 API de integración Paideia

Se implementará preferentemente como un plugin o servicio web limitado de Moodle. Aplicará los permisos y la visibilidad reales del usuario en cada curso.

Funciones iniciales:

- Cursos y secciones visibles.
- Estructura del curso.
- Actividades y fechas.
- Anuncios.
- Calificaciones y retroalimentación publicadas.
- Metadatos y descarga autorizada de materiales.

No expondrá funciones generales de administración Moodle ni tokens amplios de servicio.

### 5.5 Servicio de archivos

Responsabilidades:

- Validar que el usuario puede acceder al archivo solicitado.
- Emitir URL firmada de corta duración o transmitir el archivo.
- Conservar nombre, MIME, tamaño, hash y fuente.
- Evitar exponer rutas, cookies o IDs internos sensibles.
- Registrar la descarga sin almacenar el documento en logs.

### 5.6 MCP remoto PUCP

Será un servidor MCP por **Streamable HTTP**. El endpoint canónico propuesto es `https://mcp.pucp.edu.pe/mcp`; infraestructura podrá sustituir el hostname conservando la ruta y el contrato. Traducirá herramientas MCP a llamadas de la API Académica.

No contendrá lógica de scraping. Sus responsabilidades serán:

- Declarar herramientas y esquemas estrictos.
- Validar argumentos del agente.
- Llamar APIs con el token delegado del usuario.
- Reducir respuestas al contexto necesario.
- Aplicar el flujo de confirmación para comandos.
- Devolver errores estructurados y explicables.
- Producir artefactos descargables, como el horario HTML.

### 5.7 Caché, eventos y trabajos

- Redis o equivalente para caché efímera, tokens de confirmación y rate limiting.
- Cola institucional para trabajos largos y sincronizaciones.
- Eventos de Campus/Paideia para invalidar datos cuando sea posible.
- Base relacional para auditoría, configuración y metadatos; no para replicar indiscriminadamente expedientes académicos.

## 6. Autenticación y autorización

### 6.1 Flujo del cliente MCP

1. El cliente descubre que el MCP requiere autorización.
2. Abre la página institucional de autorización.
3. El usuario inicia sesión en PUCP.
4. PUCP muestra el alcance solicitado.
5. El usuario autoriza la conexión.
6. El cliente recibe un código mediante Authorization Code + PKCE.
7. El código se intercambia por un token de corta duración.
8. El MCP valida el token y obtiene autorización delegada para la API Académica.

Los tokens nunca aparecerán en argumentos, respuestas o logs de herramientas.

### 6.2 Scopes propuestos

| Scope | Permiso |
|---|---|
| `academic.profile.read` | Identidad académica mínima y roles |
| `academic.courses.read` | Cursos matriculados y permitidos |
| `academic.schedule.read` | Horarios, agenda, aulas y exámenes |
| `academic.grades.read` | Notas y estadísticas publicadas |
| `academic.history.read` | Historia, rendimiento y currículo |
| `academic.materials.read` | Materiales y metadatos Paideia |
| `academic.documents.read` | Documentos autorizados |
| `academic.enrollment.read` | Estado, vacantes y posición relativa |
| `academic.enrollment.write` | Preparar y confirmar cambios de inscripción |
| `academic.obligations.read` | Impedimentos, obligaciones e información de pagos |

El cliente solicitará únicamente los scopes requeridos. Las acciones de inscripción exigirán consentimiento específico y no se incluirán automáticamente en una conexión de solo lectura.

### 6.3 Reglas de autorización

- Un alumno solo accede a su expediente y a cursos en los que tenga visibilidad.
- Las estadísticas agregadas no revelarán identidades de otros estudiantes.
- Los documentos conservarán las reglas de Campus y Moodle.
- El rol docente, administrativo o de soporte no se incluirá en la primera versión estudiantil.
- La API volverá a verificar autorización en cada solicitud; el MCP no será una frontera de seguridad.

## 7. Convenciones de la API Académica

### 7.1 Base y versionado

```text
https://api.pucp.edu.pe/academic/v1
```

El versionado mayor estará en la URL. Cambios compatibles se añadirán sin renombrar campos existentes. Las retiradas se anunciarán mediante cabeceras y documentación OpenAPI.

### 7.2 Cabeceras

```http
Authorization: Bearer <access-token>
Accept: application/json
X-Request-Id: <uuid>
Idempotency-Key: <uuid>        # comandos
If-Match: "<version>"          # commit de estado
```

### 7.3 Respuesta común

```json
{
  "data": {},
  "meta": {
    "source": "campus_virtual",
    "retrievedAt": "2026-08-18T15:00:00-05:00",
    "generatedAt": "2026-08-18T14:59:58-05:00",
    "stale": false,
    "requestId": "7a9d...",
    "activeTerm": "2026-2"
  },
  "warnings": []
}
```

### 7.4 Errores

Se usará `application/problem+json`:

```json
{
  "type": "https://api.pucp.edu.pe/problems/enrollment-state-changed",
  "title": "El estado de inscripción cambió",
  "status": 409,
  "code": "enrollment_state_changed",
  "detail": "Las vacantes o la selección cambiaron después de la vista previa.",
  "requestId": "7a9d...",
  "nextAction": "Prepare una nueva operación antes de confirmar."
}
```

No se devolverán stack traces, SQL, cookies, tokens ni respuestas internas sin sanitizar.

### 7.5 Paginación y filtros

- Cursor opaco: `?cursor=<token>&limit=50`.
- Máximo normal: 200 elementos.
- Fechas ISO 8601 y zona `America/Lima` cuando el origen no incluya zona.
- Códigos institucionales conservados junto con IDs opacos estables.
- Los filtros desconocidos producirán `400`, no serán ignorados.

## 8. Endpoints de Campus Virtual

### 8.1 Estado y perfil

```text
GET /me
GET /terms/current
GET /campus/modules
GET /campus/status
```

### 8.2 Agenda y cursos

```text
GET /agenda?start=&end=&courseId=
GET /agenda/{date}
GET /courses/enrolled?term=
GET /courses/allowed?term=
GET /courses/{courseId}
```

### 8.3 Notas y rendimiento

```text
GET /grades/official?term=&courseId=
GET /grades/partial-statistics?courseId=&assessmentId=&scope=
GET /grades/final-statistics?courseId=&term=&scope=
GET /academic/history
GET /academic/performance
GET /curriculum/progress
```

`scope` admitirá únicamente valores institucionales autorizados, por ejemplo `section` o `course`. Las estadísticas nunca incluirán nombres, códigos ni notas individualizables de terceros.

### 8.4 Horarios y matrícula

```text
GET /enrollment/status
GET /enrollment/calendar
GET /enrollment/impediments
GET /enrollment/registration
GET /enrollment/schedule-scopes
GET /schedules/search?term=&unitId=&specialtyId=&level=&courseCode=&name=
GET /schedules/{scheduleId}
GET /schedules/{scheduleId}/statistics
GET /enrollment/cross-unit-vacancies
```

La consulta vigente usará el ciclo activo devuelto por `/terms/current`. Las consultas históricas exigirán `term` explícito y estarán marcadas como no válidas para acciones de matrícula.

### 8.5 Documentos, solicitudes y obligaciones

```text
GET /documents?query=&type=&term=&courseId=
POST /documents/{documentId}/download-ticket
GET /requests
GET /obligations
GET /financial/status
```

`/financial/status` será informativo: monto, concepto, vencimiento y estado cuando el usuario esté autorizado. No habrá endpoints de pago.

## 9. Endpoints de Paideia

```text
GET /paideia/status
GET /paideia/areas
GET /paideia/courses?area=&term=&cursor=
GET /paideia/courses/{courseId}/outline
GET /paideia/courses/{courseId}/activities?type=&status=&from=&to=
GET /paideia/activities/{activityId}
GET /paideia/pending?courseId=&from=&to=
GET /paideia/announcements?courseId=&from=
GET /paideia/courses/{courseId}/grades
GET /paideia/materials?courseId=&query=&type=&modifiedSince=
GET /paideia/materials/changes?courseId=&since=
POST /paideia/resources/{resourceId}/download-ticket
```

### 9.1 Construcción de la integración Moodle

1. Inventariar versión de Moodle, plugins PUCP y mecanismos actuales de matrícula y archivos.
2. Identificar funciones estándar que respeten permisos del usuario.
3. Crear un servicio externo restringido o plugin `local_pucp_academic_api` para los datos faltantes.
4. Definir funciones específicas, no una API genérica para ejecutar llamadas Moodle arbitrarias.
5. Resolver identidad mediante el `sub` institucional y el usuario Moodle correspondiente.
6. Aplicar `require_capability` y contexto de curso antes de leer cada recurso.
7. Generar tickets de descarga breves en lugar de exponer tokens Moodle.
8. Probar cursos ocultos, grupos, restricciones de fecha, actividades condicionales y calificaciones no publicadas.

Las actividades de cuestionario se devolverán únicamente como metadatos de disponibilidad y fecha. La API no abrirá intentos ni enviará respuestas.

## 10. Modelo canónico mínimo

### 10.1 Curso

```json
{
  "id": "crs_01...",
  "source": "paideia",
  "sourceId": "opaque",
  "code": "1IND52",
  "name": "Diseño de la Cadena de Suministros",
  "term": "2026-2",
  "section": "0732",
  "credits": 4,
  "academicUnit": { "id": "unit_...", "name": "Ciencias e Ingeniería" },
  "specialty": { "id": "spc_...", "name": "Ingeniería Industrial" },
  "visibility": "visible"
}
```

### 10.2 Sesión de horario

```json
{
  "id": "ses_01...",
  "type": "class",
  "dayOfWeek": 1,
  "startTime": "10:00",
  "endTime": "13:00",
  "timeZone": "America/Lima",
  "room": "O303",
  "modality": "in_person",
  "dateRange": { "start": "2026-08-17", "end": "2026-12-05" }
}
```

### 10.3 Nota

```json
{
  "id": "grd_01...",
  "courseId": "crs_01...",
  "assessmentId": "asm_01...",
  "label": "Examen 1",
  "value": 15,
  "scale": { "minimum": 0, "maximum": 20, "passing": 11 },
  "status": "published",
  "official": true,
  "publishedAt": "2026-08-18T12:00:00-05:00"
}
```

### 10.4 Capacidad e inscripción

```json
{
  "scheduleId": "sch_01...",
  "vacancies": 40,
  "unitVacancies": 40,
  "registered": 10,
  "enrolled": 8,
  "relativePosition": {
    "raw": "4/40",
    "position": 4,
    "capacity": 40,
    "state": "available",
    "observedAt": "2026-08-18T15:00:00-05:00"
  }
}
```

Los IDs expuestos serán opacos. Los valores originales necesarios para explicar resultados podrán conservarse en campos `raw`, pero nunca incluirán campos de sesión o secretos.

## 11. Comandos de inscripción

### 11.1 Preparación

```http
POST /enrollment/registration/operations
Content-Type: application/json

{
  "add": [{ "courseCode": "1IND52", "scheduleId": "sch_01..." }],
  "remove": [{ "courseCode": "IND270", "scheduleId": "sch_02..." }]
}
```

La API:

1. Consulta el estado vigente sin caché.
2. Resuelve clases, prácticas, laboratorios y exámenes asociados.
3. Valida permisos, ciclo, cruces, créditos, impedimentos y restricciones.
4. Calcula el estado propuesto.
5. No modifica Campus.
6. Devuelve un `operationId`, una versión del estado y una expiración máxima de cinco minutos.

### 11.2 Confirmación

```http
POST /enrollment/registration/operations/{operationId}/commit
Idempotency-Key: 1cc5...
If-Match: "state-version-42"

{ "confirmed": true }
```

La API:

- Consume el `operationId` ante el primer intento.
- Revalida identidad, estado, ciclo, vacantes y selección.
- Cancela con `409` si algo cambió.
- Ejecuta exactamente una transacción institucional.
- No reintenta automáticamente ante una respuesta incierta.
- Reconcilia el estado antes de decidir si el resultado fue exitoso o indeterminado.
- Invalida cachés relacionadas.
- Devuelve estado final y posición relativa cuando esté disponible.

### 11.3 Estados

```text
prepared | committed | rejected | expired | consumed |
state_changed | reconciliation_required
```

### 11.4 Auditoría

Se registrarán:

- Actor institucional y cliente autorizado.
- Operación solicitada y resultado.
- Estado previo y posterior reducido.
- Fecha, `requestId`, `operationId` e `Idempotency-Key` hasheada.
- Motivo de rechazo o reconciliación.

No se registrarán cookies, contraseñas, tokens ni documentos completos.

## 12. Herramientas MCP y mapeo

El MCP remoto conservará, cuando sea útil, los nombres públicos del kit local para facilitar compatibilidad. Algunos trabajos de sincronización local desaparecerán porque la API será la fuente viva.

| Familia MCP | Endpoints principales |
|---|---|
| Estado | `/campus/status`, `/paideia/status`, `/terms/current` |
| Cursos y overview | `/courses/*`, `/paideia/courses/*`, `/agenda` |
| Notas | `/grades/*`, `/academic/*` |
| Paideia | `/paideia/activities/*`, `/announcements`, `/materials` |
| Horarios | `/schedules/*`, `/enrollment/*` |
| Documentos | `/documents/*`, `/paideia/resources/*` |
| Inscripción | `/enrollment/registration/operations/*` |

Herramientas locales como `sync_paideia` y `sync_campus_virtual` se reemplazarán por estado/frescura o trabajos administrativos internos. No se expondrá al agente un botón genérico de sincronización masiva.

El `pucp_academic_overview` podrá ser una herramienta del mismo servidor remoto en vez de un proceso separado. Agregará datos de ambas APIs sin duplicar almacenamiento.

## 13. Horarios y artefactos

La optimización de horarios seguirá siendo lógica pura dentro del MCP o de una biblioteca compartida:

- Conflictos de clases, prácticas, laboratorios y exámenes.
- Preferencias horarias y de modalidad.
- Vacantes, inscritos, posición relativa y riesgo.
- Ranking determinista y razones de cada recomendación.

Para clientes web, la plantilla HTML se devolverá como:

1. Artefacto descargable generado en memoria, si el cliente lo admite; o
2. URL firmada temporal de un servicio de artefactos.

El servidor remoto no intentará escribir en `.UNI V2` ni en OneDrive del usuario.

## 14. Caché y consistencia

| Datos | TTL objetivo | Política |
|---|---:|---|
| Oferta y horarios durante matrícula | 1–5 min | Invalidar mediante eventos si existen |
| Vacantes y posición relativa | 0–60 s | Preferir lectura en vivo para decisiones |
| Cursos permitidos e impedimentos | 5–15 min | Revalidar antes de commit |
| Agenda | 5–15 min | Por usuario y rango |
| Notas | 5–30 min | Invalidar al publicarse |
| Materiales y anuncios | 5–30 min | ETag/fecha de modificación |
| Historia y currículo | 2–12 h | Baja volatilidad |
| Documentos | Metadatos 1–12 h | Autorización siempre en vivo |

Reglas:

- Ninguna caché autoriza por sí sola una operación.
- Las claves incluirán usuario, scope, ciclo y versión de contrato cuando corresponda.
- No se compartirán cachés personales entre alumnos.
- La oferta común podrá compartirse únicamente después de separar campos personales.
- Las respuestas indicarán `generatedAt`, `retrievedAt` y `stale`.

## 15. Trabajos asíncronos

Operaciones que superen aproximadamente cinco segundos se modelarán como trabajos:

```text
POST /jobs                         → 202 + jobId
GET  /jobs/{jobId}                 → pending|running|completed|failed
GET  /jobs/{jobId}/result          → resultado autorizado
```

Casos previstos:

- Descarga de varios materiales.
- Generación de paquetes o artefactos grandes.
- Construcción de índices de búsqueda.
- Reconciliaciones administrativas.

Los trabajos tendrán propietario, expiración, cuota y cancelación cuando corresponda.

## 16. Seguridad y privacidad

### 16.1 Controles obligatorios

- TLS en tránsito y cifrado administrado institucionalmente en reposo.
- Secretos en un gestor institucional, nunca en `.env` productivo.
- Tokens de corta duración y renovación rotada.
- PKCE para clientes públicos.
- Separación entre token del cliente, token delegado y credenciales de servicio.
- Validación de audiencia, issuer, scopes y expiración.
- URLs firmadas breves para archivos.
- Protección CSRF en páginas web de autorización.
- Rate limiting, detección de abuso y bloqueo de enumeración.
- Sanitización de HTML proveniente de Moodle.
- Análisis de malware para archivos generados o intermediados cuando aplique.
- Revisión de privacidad y retención antes de producción.

### 16.2 Clasificación de herramientas

Todas las herramientas declararán si son de lectura o tienen efectos secundarios. Los clientes deberán solicitar aprobación para comandos. El servidor no confiará únicamente en la aprobación visual del cliente: exigirá también la operación preparada y el token de confirmación de un solo uso.

### 16.3 Amenazas prioritarias

- Confusión de identidad entre sesiones concurrentes.
- Acceso horizontal al expediente de otro alumno.
- Prompt injection dentro de anuncios o documentos.
- Reutilización de confirmaciones.
- Descarga de archivos sin autorización vigente.
- Filtración de tokens en telemetría.
- Reintentos duplicados de comandos.
- Abuso masivo de endpoints durante matrícula.

## 17. Observabilidad y operación

Métricas mínimas:

- Latencia y error por endpoint, herramienta y sistema fuente.
- Tasa de caché y edad de datos.
- Consultas concurrentes y profundidad de colas.
- Errores de autorización por código, sin datos personales en etiquetas.
- Preparaciones, commits, conflictos y reconciliaciones.
- Descargas iniciadas y completadas.
- Disponibilidad diferenciada de Campus, Paideia y MCP.

Cada solicitud tendrá un `requestId` propagado desde MCP hasta el adaptador. Las trazas ocultarán parámetros sensibles y no almacenarán respuestas académicas completas.

## 18. Despliegue

### 18.1 Unidades desplegables

1. `pucp-mcp-remote`: servidor Streamable HTTP sin estado duradero local.
2. `academic-api-gateway`: autenticación, cuotas y routing.
3. `campus-academic-api`: adaptador y dominio Campus.
4. `paideia-academic-api`: plugin/servicio Moodle.
5. `academic-worker`: trabajos asíncronos.
6. Redis o equivalente.
7. Base de auditoría/configuración.
8. Servicio de artefactos/objetos con URLs firmadas.

### 18.2 Escalado

- MCP, gateway y APIs serán stateless y horizontalmente escalables.
- El estado temporal de confirmación residirá en almacenamiento compartido.
- La oferta académica común se cacheará separada de datos personales.
- Los comandos usarán bloqueo/versión por expediente y ciclo.
- Durante matrícula se aplicará autoscaling y capacidad reservada.

Al retirar Playwright, una instancia deja de necesitar un Chromium por consulta. El consumo se concentra en HTTP, caché y procesamiento de JSON, permitiendo muchas más solicitudes por núcleo.

## 19. Construcción de las APIs

### Fase A: descubrimiento institucional

1. Nombrar propietarios técnicos y funcionales de Campus, Paideia e identidad.
2. Inventariar servicios, bases y eventos existentes.
3. Identificar sistemas de registro para cada dato.
4. Clasificar datos y definir retención.
5. Seleccionar un ciclo y cuentas de prueba sanitizadas.
6. Documentar flujos actuales, incluidos matrícula y archivos.

**Salida:** catálogo de fuentes, matriz de responsables y decisiones de seguridad.

### Fase B: contratos antes de implementación

1. Definir modelos canónicos y códigos de error.
2. Escribir OpenAPI 3.1 para Campus y Paideia.
3. Definir scopes, roles y ejemplos autorizados/no autorizados.
4. Crear pruebas de contrato consumibles por el MCP.
5. Acordar SLO, cuotas y versionado.

**Salida:** especificaciones OpenAPI revisadas, fixtures y mocks.

### Fase C: API de lectura mínima

Implementar primero:

1. Identidad y ciclo actual.
2. Cursos matriculados.
3. Agenda y horarios.
4. Actividades, anuncios y materiales Paideia.
5. Notas publicadas.

Estas funciones permiten validar autenticación, autorización, archivos y agregación sin introducir efectos secundarios.

### Fase D: lectura académica ampliada

Añadir:

- Estadísticas de notas.
- Historia y rendimiento.
- Currículo.
- Cursos permitidos, impedimentos y vacantes.
- Documentos, solicitudes, obligaciones e información de pagos.
- Búsqueda y descargas mediante tickets.

### Fase E: comandos de inscripción

1. Implementar operación preparada sin escritura.
2. Validar contra cuentas de prueba y simulador de Campus.
3. Añadir commit transaccional e idempotente.
4. Probar respuestas inciertas y reconciliación.
5. Incorporar auditoría y alertas.
6. Habilitar gradualmente mediante feature flags.

### Fase F: MCP remoto

1. Implementar `/mcp` con Streamable HTTP.
2. Integrar OAuth y descubrimiento de autorización.
3. Mapear herramientas a APIs sin lógica de scraping.
4. Incorporar contratos estrictos y respuestas reducidas.
5. Añadir confirmaciones y artefactos.
6. Ejecutar pruebas desde los clientes web objetivo.

## 20. Migración desde Playwright

Se aplicará una migración por estrangulamiento:

```text
Herramienta MCP
      │
      ▼
AcademicPort (interfaz estable)
      ├── ApiAcademicAdapter       # preferido
      └── PlaywrightLegacyAdapter  # temporal
```

Pasos:

1. Extraer interfaces de dominio del código actual.
2. Mantener contratos MCP y fixtures existentes.
3. Implementar cada endpoint API detrás de la misma interfaz.
4. Ejecutar pruebas de paridad entre API y adaptador legado.
5. Activar la API por herramienta mediante feature flag.
6. Medir discrepancias y corregir la fuente.
7. Desactivar Playwright cuando la API alcance criterios de aceptación.
8. Eliminar credenciales, navegadores y selectores del despliegue remoto.

No se mantendrá fallback automático de escritura mediante Playwright. Si la API de comandos no está disponible, la herramienta de escritura estará `unavailable`.

## 21. Estrategia de pruebas

### 21.1 API

- Validación OpenAPI y schemas.
- Autorización positiva y negativa por scope.
- Aislamiento entre alumnos.
- Paginación, filtros y límites.
- Caché, invalidación y datos stale.
- Archivos visibles, ocultos, expirados y revocados.
- Errores sanitizados.

### 21.2 Paideia

- Cursos ocultos y finalizados.
- Grupos y restricciones de acceso.
- Actividades condicionales.
- Notas no publicadas.
- Materiales externos, carpetas, ZIP y archivos grandes.
- Pregrado/posgrado y educación continua en la misma cuenta.

### 21.3 Matrícula

- Agregar y retirar cursos.
- Horarios asociados y cruces.
- Cambio de vacantes entre prepare y commit.
- Token vencido, reutilizado o de otro usuario.
- Doble envío con la misma clave idempotente.
- Respuesta de red incierta y reconciliación.
- Posición relativa pendiente o actualizada.
- Acciones fuera de la ventana de matrícula.

### 21.4 MCP

- `initialize`, `tools/list` y llamadas de lectura.
- OAuth ausente, vencido y revocado.
- Aprobación de herramientas con efectos.
- Resultados grandes y paginación.
- Trabajos asíncronos.
- Pruebas de humo desde ChatGPT, Claude y Gemini.

## 22. Criterios de aceptación

1. Ninguna llamada normal abre Chromium.
2. Las contraseñas no ingresan al MCP ni a las APIs académicas.
3. Un alumno no puede consultar recursos de otro alumno modificando IDs.
4. Campus y Paideia son sustituibles detrás de contratos estables.
5. Las notas no publicadas y materiales ocultos no se exponen.
6. Las descargas requieren autorización vigente y tickets breves.
7. Los comandos no funcionan sin preparación y confirmación.
8. Un commit duplicado no produce una segunda modificación.
9. Los datos históricos no se usan para acciones vigentes.
10. Las respuestas indican fuente y antigüedad.
11. Una caída de Paideia no elimina las funciones disponibles de Campus, y viceversa.
12. Las herramientas críticas cumplen pruebas de paridad con el MCP local.

## 23. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sistemas heredados sin API estable | Capa adaptadora institucional y contratos propios |
| Identidad SAML no delegable directamente | Broker OIDC/OAuth administrado por PUCP |
| Exposición excesiva de Moodle | Plugin/servicio con funciones y capacidades mínimas |
| Picos de matrícula | Caché, cuotas, autoscaling y capacidad reservada |
| Datos divergentes entre Campus y Paideia | Reglas explícitas de precedencia y warnings |
| Prompt injection en contenido académico | Tratar contenido externo como datos, sanitizar y limitar acciones |
| Duplicación de inscripción | Idempotencia, versión de estado y reconciliación |
| Dependencia prolongada de Playwright | Métricas de migración y fecha de retirada por herramienta |

## 24. Entregables del equipo

- Especificaciones OpenAPI 3.1 de Campus y Paideia.
- Catálogo de scopes y matriz de autorización.
- Plugin/servicio de integración Moodle.
- API de dominio Campus.
- API Gateway y conexión con identidad institucional.
- Servidor MCP remoto Streamable HTTP.
- SDK interno generado desde OpenAPI.
- Pruebas de contrato y entorno sandbox.
- Runbooks, dashboards y alertas.
- Evaluación de seguridad y privacidad.
- Plan de migración y retirada de Playwright.
- Documentación para registrar el complemento en clientes compatibles.

## 25. Decisiones fijadas

- La solución remota será institucional y multiusuario.
- La arquitectura preferida será API Gateway + APIs separadas de Campus y Paideia.
- Las APIs serán la frontera de seguridad; el MCP no accederá a bases de datos.
- Paideia se integrará mediante servicios web o plugin Moodle restringido.
- Playwright será únicamente una compatibilidad temporal de lectura.
- Se contemplan lectura y comandos, pero los comandos se habilitarán después de estabilizar la lectura.
- Las únicas escrituras iniciales serán agregar o retirar cursos con confirmación explícita.
- No habrá pagos ni envíos académicos automatizados.
- El MCP local podrá evolucionar más rápido; el remoto utilizará versiones estables y desplegadas institucionalmente.

## 26. Próximo paso recomendado

Realizar un taller técnico con DTI, Campus, Paideia e Identidad para completar el catálogo de fuentes y confirmar tres elementos antes de escribir el plan de implementación:

1. Qué APIs o servicios internos ya existen.
2. Cómo emitir identidad delegada para el MCP.
3. Qué equipo será propietario de cada contrato y operación.

Con esas respuestas se podrá transformar esta arquitectura en un plan de trabajo con entregas, dependencias y criterios de paso por entorno.

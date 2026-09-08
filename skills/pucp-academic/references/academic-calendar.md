# Calendario académico y semana de consulta

Las herramientas `get_academic_calendar` y `set_academic_calendar` pertenecen a `pucp_academic_overview` y funcionan sin sincronización ni terminal, también en el conector web.

## Registro curado automático

En la primera consulta que dependa de la semana, llama `get_academic_calendar`. El servidor descarga automáticamente el registro curado de `config/academic-calendars.json` en el repositorio oficial, conserva una copia local y usa el archivo incluido en el kit si GitHub no responde. No pidas al usuario ni al agente buscar las fechas si el ciclo ya está en ese registro.

1. Identifica ciclo, programa y cursos pertinentes con Campus/Paideia y consulta `get_academic_calendar`.
2. Si el ciclo existe, usa sus fechas y `currentWeek`, calculada siempre con el reloj vivo del servidor en `America/Lima`.
3. Si no existe después de refrescar el registro, informa que el calendario curado todavía no contiene ese ciclo. Solo como respaldo temporal, verifica una fuente oficial y usa `set_academic_calendar` con `calendar`: `id` estable, `term`, `program`, `kind` (`regular`, `summer`, `intensive` o `continuing`), `startDate`, `endDate`, `courseKeys` y `source`.
4. Si la fuente oficial aplica a todos los cursos del programa, usa `courseKeys: ["*"]`. Si el calendario es específico, enumera coincidencias exactas de ids de Paideia, claves y/o nombres. No uses `"*"` para otro programa ni infieras el programa por el prefijo del curso.
5. `source` exige `url`, `title` y `evidence`: un extracto breve no personal que fundamente las fechas y su alcance. Usa una URL pública HTTPS de PUCP sin parámetros, fragmentos ni sesión, preferiblemente el calendario o PDF oficial. No incluyas credenciales ni información personal. El servidor registra la verificación **declarada por el agente**, no afirma haber leído la fuente por sí mismo.
6. Cuando el documento publique numeración especial, añade `weeks`: intervalos `{number, start, end}` en fechas ISO. Los huecos quedan sin semana; no se rellenan ni se renumeran automáticamente. Sin `weeks`, el número se estima por intervalos de siete días desde `startDate`, sin restar feriados.

La página o el PDF son la evidencia; el registro operativo compartido es JSON. Los calendarios curados pertenecen al repositorio y los respaldos creados con `set_academic_calendar` se guardan solo en el directorio privado de datos. Un respaldo local con el mismo `id` prevalece hasta que se elimine o reemplace. No modifica Campus.

## Control de cambio de ciclo

Si `get_academic_calendar` devuelve `calendar_verification_required`, `calendarRegistration.reason: week_exceeds_19` o un cálculo mayor que 19, detente: no presentes ese número como semana vigente. Refresca el registro para obtener el ciclo actual. Si el mantenedor todavía no lo publicó, informa la ausencia; usa un respaldo local verificado solo cuando resulte necesario. Esta comprobación evita heredar un semestre regular en verano.

## Interpretar el resultado

- `queriedAt` y `currentDate` vienen del reloj del servidor en `America/Lima`, no de la caché de Campus/Paideia.
- `currentWeek` es la semana de hoy; `referenceWeek` es la semana de `referenceDate`, que puede ser una clase futura o pasada. El cálculo no cambia al reutilizar materiales antiguos.
- `weekBasis: calculated_from_start` es un cálculo, no numeración institucional confirmada. `published_intervals` usa los intervalos registrados de la fuente.
- `calendarAgeSeconds` indica hace cuánto se registró la evidencia, no hace cuánto se calculó la semana. Ante anuncios de cambio o fuentes contradictorias, vuelve a verificarla.
- `calendar_unavailable`, `calendar_ambiguous`, `scope_required`, `calendar_verification_required` o semanas nulas requieren resolver el alcance antes de hacer una afirmación dependiente de la semana. Antes/después de clases no se extrapola una semana lectiva.

El repositorio distribuye el último calendario curado conocido y consulta su versión de GitHub periódicamente. El mantenedor añade el ciclo actual y los próximos solo cuando existen fechas oficiales. Verano no hereda el calendario regular: tiene fechas e intervalos propios. La semana no prueba por sí sola la unidad, el número de sesión ni el avance real del docente.

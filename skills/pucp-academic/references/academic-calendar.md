# Calendario académico y semana de consulta

Las herramientas `get_academic_calendar` y `set_academic_calendar` pertenecen a `pucp_academic_overview` y funcionan sin sincronización ni terminal, también en el conector web.

## Cuando falta el calendario

1. Identifica ciclo, programa y cursos pertinentes con Campus/Paideia. Consulta `get_academic_calendar` para reutilizar un registro aplicable.
2. Si no existe, usa `pucp-context` para localizar y leer el calendario oficial del programa: inicio y fin de **clases**, no de matrícula. Verifica que corresponde a ese ciclo. Para cursos intensivos o Educación Continua, comprueba sus fechas propias.
3. Invoca `set_academic_calendar` con `calendar`: `id` estable, `term`, `program`, `kind` (`regular`, `summer`, `intensive` o `continuing`), `startDate`, `endDate`, `courseKeys` y `source`.
4. `courseKeys` son coincidencias exactas de ids de Paideia, claves y/o nombres de cursos: incluye los identificadores que usan ambas fuentes. No asignes el calendario a cursos de otro programa sin comprobar su aplicabilidad. No se infiere programa por prefijo del curso.
5. `source` exige `url`, `title` y `evidence`: un extracto breve no personal que fundamente las fechas y su alcance. Usa una URL pública HTTPS de PUCP sin parámetros, fragmentos ni sesión, preferiblemente el calendario o PDF oficial. No incluyas credenciales ni información personal. El servidor registra la verificación **declarada por el agente**, no afirma haber leído la fuente por sí mismo.
6. Cuando el documento publique numeración especial, añade `weeks`: intervalos `{number, start, end}` en fechas ISO. Los huecos quedan sin semana; no se rellenan ni se renumeran automáticamente. Sin `weeks`, el número se estima por intervalos de siete días desde `startDate`, sin restar feriados.

El registro sustituye solo el mismo `id` y se guarda localmente bajo el directorio de datos, nunca en Git. Usa otro id para cada programa/ciclo; actualiza el existente si se corrige el calendario. No requiere confirmación de inscripción: no modifica Campus.

## Interpretar el resultado

- `queriedAt` y `currentDate` vienen del reloj del servidor en `America/Lima`, no de la caché de Campus/Paideia.
- `currentWeek` es la semana de hoy; `referenceWeek` es la semana de `referenceDate`, que puede ser una clase futura o pasada. El cálculo no cambia al reutilizar materiales antiguos.
- `weekBasis: calculated_from_start` es un cálculo, no numeración institucional confirmada. `published_intervals` usa los intervalos registrados de la fuente.
- `calendarAgeSeconds` indica hace cuánto se registró la evidencia, no hace cuánto se calculó la semana. Ante anuncios de cambio o fuentes contradictorias, vuelve a verificarla.
- `calendar_unavailable`, `calendar_ambiguous`, `scope_required` o semanas nulas requieren resolver el alcance o explicitar la incertidumbre. Antes/después de clases no se extrapola una semana lectiva.

No existe un calendario universal precargado. Al cambiar de ciclo, identifica y verifica el nuevo calendario. Verano no hereda el calendario regular: tiene fechas y, cuando se publiquen, intervalos propios. La semana no prueba por sí sola la unidad, el número de sesión ni el avance real del docente.

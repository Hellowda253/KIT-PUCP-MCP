# Horario PUCP en HTML

Usa este recurso cuando el estudiante pida el horario elegido, final o posible
como archivo HTML. Todos esos pedidos usan el mismo formato.

## Flujo preferido

Evita reconstruir manualmente las sesiones. El adaptador
`scripts/schedule-source.mjs` convierte de forma determinista los valores de
Campus: `class` se mantiene como clase y `practice` o `laboratory` se convierten
en práctica/laboratorio. Un tipo desconocido detiene la generación en lugar de
convertirse silenciosamente en clase.

- En instalaciones locales, guarda como JSON la respuesta completa de
  `get_student_schedule` y entrégala directamente a `render-schedule.mjs` con
  `--data`. No transcribas sus sesiones. Para un horario elegido, ejecuta primero
  `evaluate_course_schedule` con las secciones seleccionadas y entrega su
  respuesta completa al mismo script.
- En el conector remoto, llama `generate_schedule_html` con
  `source: "student_current"`. Para una combinación elegida usa
  `source: "selection"` y `selections`; el servidor consulta y transforma Campus
  antes de generar el enlace.
- Usa el formato manual siguiente únicamente para una composición avanzada que
  no pueda expresarse con una respuesta de Campus.

El adaptador une fragmentos contiguos solo cuando coinciden curso, sección, tipo,
aula y docente. También consolida las aulas repetidas de una evaluación sin unir
parcial y final cuando Campus publica sus fechas o tipos. Si el catálogo solo
publica un bloque de examen sin fecha ni clasificación, crea una tarjeta neutral
con todas sus aulas y conserva una advertencia; no inventa parcial o final.

## Modo avanzado: JSON manual

Construye un JSON UTF-8 con esta estructura:

```json
{
  "term": "2026-2",
  "credits": 22,
  "courses": [
    {
      "code": "CUR101",
      "name": "Nombre del curso",
      "credits": 3.5,
      "scheduleId": "0101",
      "instructor": "Docente",
      "classes": "Lun 08:00–10:00",
      "practice": "—",
      "exams": "Vie 15:00–18:00",
      "examStatus": "published"
    }
  ],
  "sessions": [
    {
      "day": 1,
      "start": "08:00",
      "end": "10:00",
      "type": "class",
      "courseCodes": ["CUR101"],
      "scheduleId": "0101",
      "title": "Nombre del curso",
      "room": "A101",
      "instructor": "Docente",
      "weeksLabel": ""
    }
  ]
}
```

`day` usa 1 para lunes y 6 para sábado. `type` admite `class`, `lab` o
`exam`. Cada examen debe incluir `examType` (`partial`, `final` o `unknown`).
Cuando Campus publica la fecha exacta, incluye `date` en formato `YYYY-MM-DD` y
usa `datePrecision: "exact_date"`. Cuando el catálogo solo publica día y hora,
conserva el examen con `datePrecision: "weekday_time_only"`, omite `date` y usa
`examStatus: "schedule_only"`; el HTML mostrará «Fecha no publicada». No
inventes una fecha ni elimines el examen. Obtén cualquier clasificación y fecha
exacta de la agenda o del detalle de Campus; no clasifiques por el orden en que
aparecen. Omite `weeksLabel` cuando no
corresponda. Conserva exactamente las
claves, secciones, docentes, aulas y sesiones obtenidas del Campus; no las
inventes.

`examStatus` distingue cuatro estados: `published` cuando Campus publicó una
fecha exacta; `schedule_only` cuando el catálogo solo publicó día y hora y deben
existir sus sesiones `type: "exam"` con `datePrecision: "weekday_time_only"`;
`not_published` únicamente
cuando Campus confirma que no hay información de examen publicada; y `unknown`
cuando todavía falta consultar el detalle. El renderizador rechaza `unknown` y
también exige `examStatus` si `exams` está vacío. Los datos antiguos que ya
declaran un examen conservan compatibilidad y se interpretan como publicados.

## Generación y validación

Sigue este flujo cuando el estudiante pida el archivo:

1. Obtén los cursos y todas sus sesiones desde Campus. Para el horario personal
   usa `get_student_schedule`; para una opción recomendada valida primero las
   secciones elegidas con `evaluate_course_schedule`.
2. Usa de preferencia la respuesta completa como `--data`. Solo si el origen no
   puede representarse así, construye el JSON avanzado anterior. No copies otro
   HTML y no escribas uno desde cero.
   Cada curso que declare exámenes en `courses[].exams` debe tener al menos una
   sesión independiente con `type: "exam"` y su clave en `courseCodes`; no
   conviertas el texto de la tabla en una sesión ni omitas las tarjetas rojas.
   No cambies `exams` a `"-"` para sortear una validación: vuelve a consultar
   `get_course_schedule_details`. Si el detalle sigue mostrando únicamente día y
   hora por provenir del catálogo general, conserva el examen como
   `schedule_only`; no bloquees el HTML ni inventes la fecha. El renderizador
   devuelve los cursos y horarios faltantes junto con esa acción recomendada.
   Conserva por separado parciales y finales: no combines fechas en
   `weeksLabel`. Para cada examen consulta la agenda o evidencia oficial y agrega
   `examType` y `date`. Usa `unknown` si Campus publica la fecha pero la evidencia
   no permite clasificarla con seguridad; nunca uses «primer examen = parcial».
3. Separa varios docentes con ` / `; no concatenes sus nombres. Conserva los
   nombres oficiales en el JSON. El renderizador crea etiquetas abreviadas y
   evita mostrar los títulos completamente en mayúsculas.
4. Desde la carpeta de esta skill ejecuta:

```powershell
node scripts/render-schedule.mjs --data RUTA_DATOS.json --output Horarios_PUCP/Horario_PUCP_2026-2.html --force
```

El script usa `assets/horario-pucp.html` y entrega un único HTML autocontenido.
Si omites `--output`, usa automáticamente
`Horarios_PUCP/Horario_PUCP_<ciclo>.html`; esta es la ubicación preferida para
evitar copias antiguas dispersas. Usa otra ruta solo cuando el usuario la pida.
No edites el CSS ni el JavaScript para cada estudiante: cambia solamente el
JSON. La plantilla distribuye en carriles horizontales y muestra lado a lado las
clases, prácticas o exámenes que se superponen; los filtros recalculan los
carriles usando solo las actividades visibles. No incluyas nombre, código de
alumno, credenciales, cookies ni otros datos personales. Antes de entregar,
confirma que los créditos y el número de cursos y sesiones coincidan con la
selección consultada.

Abre el HTML generado y verifica visualmente que aparezcan todos los cursos y
sesiones; que cada sesión tenga tipo, hora, aula y docente cuando Campus los
publique; y que clases, prácticas y exámenes no hayan sido fusionados. Los
cruces deben aparecer lado a lado y el contenido completo debe revelarse al
pasar el puntero o enfocar la tarjeta. Si falta información, vuelve a consultar
Campus y regenera el archivo; no edites manualmente el HTML para ocultarlo.
Abre también la vista previa de impresión en A4 horizontal: la cuadrícula debe
quedar completa en la primera página, sin texto cortado; el detalle tabular va
en la página siguiente. Activa «Gráficos de fondo» para conservar los colores y
desactiva «Encabezados y pies de página» para aprovechar toda la hoja.

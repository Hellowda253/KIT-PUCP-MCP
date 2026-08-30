---
name: pucp-academic
description: Use when a PUCP student asks about personal academic information or actions in Campus Virtual or Paideia, including courses, grades, deadlines, materials, announcements, schedules, enrollment, vacancies, downloads, combined summaries, or a horario HTML.
---

# PUCP Académico

Resuelve consultas académicas personales con los tres servidores del kit. Carga únicamente la referencia necesaria:

- Para una vista conjunta o una pregunta que cruza fuentes, usa `pucp_academic_overview`.
- Para cursos, actividades, anuncios, calificaciones visibles y materiales de Paideia, lee [Paideia](references/paideia.md).
- Para agenda, horario propio, notas oficiales, historia, rendimiento, currículo, documentos o información financiera, lee [Campus Virtual](references/campus-virtual.md).
- Para saber de qué trata la próxima clase o qué estudiar esta semana, aplica «Semana del ciclo y avance del curso» en [Campus Virtual](references/campus-virtual.md) antes de elegir materiales.
- Para matrícula, cursos permitidos, vacantes, búsqueda, comparación o cambios de inscripción, lee [matrícula y horarios](references/matricula-y-horarios.md).
- Para crear un horario visual, lee [horario HTML](references/horario-html.md) y usa el renderizador incluido. No escribas un HTML propio desde cero.

## Evidencia y vigencia

Usa la herramienta más pequeña que responda la pregunta. Conserva `source`, `sourcesUsed`, antigüedad de caché, advertencias y estados parciales. Si una operación devuelve `pending`, consulta su trabajo y espera el resultado antes de concluir que no hay datos.

Paideia prevalece para entregas, anuncios y materiales actuales. Campus prevalece para horario, aulas, modalidad y notas oficiales. Expón los conflictos materiales entre fuentes; no elijas silenciosamente ni presentes una vacante, posición o nota como más reciente de lo que indica la respuesta.

## Límites

Las consultas son de solo lectura salvo el flujo de inscripción descrito en su referencia. Descarga archivos únicamente a petición y no sobrescribas sin confirmación. Nunca abras intentos de evaluación ni envíes tareas, mensajes, pagos, solicitudes, matrícula definitiva u otros formularios.

La biblioteca de materiales es opcional. Ofrécela durante la instalación o cuando el usuario pida organizar sus descargas, permite reutilizar una carpeta existente y no la vuelvas a proponer si ya fue configurada o rechazada.

Para reglamentos, servicios, convocatorias o procedimientos públicos usa `pucp-context`. Para enseñar, resolver ejercicios o mejorar el rendimiento usa `profe-pucp`.

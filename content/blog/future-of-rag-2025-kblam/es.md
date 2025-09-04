---
title: ¿Quedará obsoleto RAG? Hoja de ruta 2025: del contexto largo a GraphRAG, entrenamiento sensible a la recuperación y KBLaM
description: RAG no muere; muere el RAG ingenuo de vectores con pegado de contexto. En 2025: GraphRAG, entrenamiento sensible a la recuperación, orquestación con agentes, frescura/streaming y actualizaciones puntuales en parámetros. KBLaM como línea base fiable.
date: 2025-09-02
cover: assets/blog/rag-hero-es.v5.svg
---

Nota para el lector: En el último año se repite la pregunta de pasillo: “¿El contexto largo hará obsoleto a RAG?”. Más que responder sí/no, aquí contamos la historia: por qué muchos sintieron a RAG frágil, por qué más contexto no asegura respuestas confiables y cómo luce en 2025 una pila lista para ingeniería, de punta a punta.

## Resumen (TL;DR)

RAG no muere: lo que muere es el **RAG ingenuo de vectores + pegar contexto**. En 2025, las pilas ganadoras convergen en cinco pilares: **Recuperación estructurada (GraphRAG) + Entrenamiento sensible a la recuperación (Self‑RAG / RA‑DIT / RAFT) + Orquestación con agentes (Agentic RAG + MCP) + Actualidad/índices en streaming + (cuando convenga) actualizaciones a nivel de parámetros (fine‑tuning / edición del modelo)**. Presentamos criterios de evaluación, matriz de selección y lista de implantación, y mostramos cómo **KBLaM** construye sistemas **fiables, controlables y explicables** en entornos con alta regulación y baja conectividad.

## 1. Por qué “más contexto” ≠ el fin de RAG

Analogía: volcar todo en el prompt es darle a un modelo una mochila más grande; la recuperación es un mapa vivo que se actualiza y guía. Una mochila enorme no garantiza saber a dónde ir, ni por qué.

- **Coste y escalado**: meter grandes corpus en el prompt dispara el coste; **recuperar → curar** sigue siendo más eficiente.
- **Actualidad**: el conocimiento en parámetros no se actualiza a escala de minutos; las fuentes externas sí.
- **Auditoría y cumplimiento**: RAG aporta **cadenas de evidencia trazables** (fuente, versión, fecha).
- **Privacidad y aislamientos**: el conocimiento externalizado juega mejor con **controles de acceso** y separación por dominios.
- **Robustez**: recuperar→reordenar→extraer es una tubería **modular**; el prompting puro de contexto largo es más difícil de depurar.

> Conclusión: **Más contexto reduce la frecuencia de recuperación, no elimina la necesidad de recuperar**.
>
> Viñeta: Una empresa de servicios volcó 30k páginas de SOP en prompts de contexto largo. El P95 de coste subió y las respuestas fluctuaron. Con “recuperar → paquete de evidencia → generación extractiva”, bajaron coste y latencia, y las respuestas quedaron auditables.

## 2. Modos de fallo del RAG ingenuo (evítalos)

Si RAG te parece endeble, a menudo no es que “la recuperación esté mal”, sino que el _enfoque_ lo está. Estas trampas son habituales:

1. **Solo vectores**, sin estructura (tablas/código/temporalidad).
2. **Fragmentación burda** que rompe la evidencia.
3. **Sobrecarga de contexto** que introduce ruido.
4. **Sin recuperadores específicos** ni **reordenadores de cruce**.
5. **Sin política de frescura** para contenidos volátiles.
6. **Sin trazabilidad** respuesta → evidencia → fuente.

## 3. El “juego de cinco piezas” en 2025

Hacer bien RAG es separar preocupaciones: hallar conocimiento, empaquetar evidencia y expresar respuestas. En 2025, las pilas maduras convergen en estas cinco piezas.

### 3.1 Recuperación estructurada (GraphRAG)

Índice conjunto texto + grafo; ideal para normativa, procesos, activos y **razonamiento multi‑salto**. Multi‑índice (BM25 + Denso + Cross‑Encoder), fusión grafo↔texto y **paquetes de evidencia**.

Ejemplo: En QA de normativa, primero halla la ruta “artículo → término → aplicabilidad” en el grafo, y luego extrae los fragmentos como paquete de evidencia: más estable y barato que verter diez párrafos.

### 3.2 Entrenamiento sensible a la recuperación (Self‑RAG / RA‑DIT / RAFT)

Enseña **cuándo y qué recuperar**; bucles de autoevaluación y señales de recuperación en el fine‑tuning → **respuestas más fieles y explicables**.

Analogía: Enseñar “cuándo abrir el diccionario y en qué página”, en vez de cargarlo entero siempre.

### 3.3 Agentes + MCP

Tareas reales = **pasos múltiples** con herramientas. Unifica herramientas vía MCP; añade **límites de parada, presupuesto y latencia**, y **cachés**.

Escenario: Un análisis de causas raíz puede requerir “revisar logs → ejecutar SQL → comparar telemetría → validar procedimientos”. Agentes orquestan pasos con resguardos; RAG aporta evidencia y explicación.

### 3.4 Frescura y streaming

Ingesta incremental, TTL, selección de versiones, evaluación rodante.

### 3.5 Actualizaciones en parámetros (opcional)

Para hechos cortos, estables, repetitivos: **fine‑tuning ligero** o **edición quirúrgica**. Mantén principio **evidencia‑primero** y bitácoras de procedencia.

## 4. KBLaM: línea base fiable para entornos restringidos y regulados

Con redes limitadas y cumplimiento estricto, “trazable y reproducible” pesa más que “elocuente”. **KBLaM** ofrece una base de ingeniería: del modelado de conocimiento a la trazabilidad de auditoría.

### 4.1 Componentes

Capa de conocimiento unificado (texto + **KG** + metadatos) · Planificador de recuperación · Constructor de cadenas de evidencia · Generación preferentemente **extractiva** con verificación · Evaluación y auditoría offline.

### 4.2 Flujo mínimo (pseudo)

```text
intent = clasificar(q)
plan   = planificar(q)
C      = recuperar_multietapa(q)                     # BM25 + Denso + Cross-Encoder
si necesita_grafo: C = fusionar(C, rutas_grafo(q))
E      = empaquetar_evidencia(C)
a0     = generar(q, E)
a      = verificar_y_refinar(a0) si hace falta
registrar(a, E, coste, latencia, versiones)
```

### 4.3 Consejos prácticos

Fragmenta con estructura → recuperadores por tipo → reordenamiento de cruce → comprime evidencia en **puntos con citas** → actualiza en streaming con versionado.

## 5. Matriz de selección (2025)

| Caso de uso | Actualidad | Estructura | Restricciones | Pila recomendada |
| --- | --- | --- | --- | --- |
| QA de normativa/procesos | Media | Alta | Auditoría | **GraphRAG + Self‑RAG/RAFT**, evidencia‑primero |
| Operación/alertas | Alta | Media | Baja conectividad | **Eventos + índice en streaming + Agentes** |
| Plantillas de SOP | Baja | Media | Alta consistencia | **Fine‑tuning ligero + extracción**, edición opcional |
| Noticias/mercado | Muy alta | Baja | Sensible a coste | **Rastreo en tiempo real + BM25/Denso + generación ligera** |
| Razonamiento multi‑salto | Media | Alta | Explicabilidad | **GraphRAG + rutas visibles + ReAct/Plan‑Exec** |

## 6. Evaluación y gobernanza

Mide **fidelidad**, **cobertura de evidencia**, **anclaje**, **latencia P95**, **coste/pregunta**, **resiliencia a cambios** y **bitácoras de auditoría**.

## 7. Lista de implantación

Gobernanza de datos · Recuperación base (BM25 + Denso + X‑encoder) · Plantillas Claim‑Evidence con citas en línea · Límites de agente (herramientas/$/latencia) · Conjunto offline (≥1k preguntas) · Despliegue gradual + monitorización.

> **Conclusión**: RAG no está obsoleto. El RAG **fiable, controlable y explicable** es el centro de la práctica en 2025; **KBLaM** ofrece un plano sólido para entornos regulados y con conectividad limitada.

## Referencias (fuentes oficiales)

- Self‑RAG: [arXiv](https://arxiv.org/abs/2310.11511) · [OpenReview](https://openreview.net/forum?id=VplGxL2Y1c) · [GitHub](https://github.com/AkariAsai/self-rag)
- RAFT (Retrieval‑Augmented Fine‑Tuning, 2024): [arXiv](https://arxiv.org/abs/2403.10131)
- RA‑DIT (2023): [arXiv](https://arxiv.org/abs/2310.01352) · [OpenReview](https://openreview.net/forum?id=3p3oI6G7pK)
- GraphRAG: [Microsoft Research Blog](https://microsoft.github.io/graphrag/blog_posts/) · [GitHub](https://github.com/microsoft/graphrag)
- MCP: [Anthropic Announcement](https://www.anthropic.com/news/model-context-protocol) · [GitHub](https://github.com/modelcontextprotocol) · [The Verge](https://www.theverge.com/2024/6/26/24185188/anthropic-model-context-protocol-mcp-ai-tool)
- Google Gemini 1.5 (contexto largo): [Blog oficial](https://blog.google/technology/ai/google-gemini-next-generation-model-february-2024/)

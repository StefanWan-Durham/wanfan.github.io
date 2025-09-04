---
title: ¿Está obsoleto RAG? Hoja de ruta 2025: del “contexto largo” a GraphRAG, Entrenamiento Consciente de Recuperación y KBLaM
description: RAG no muere—lo que muere es el RAG ingenuo de volcar todo al prompt. Esta guía 2025 explica por qué el contexto largo no reemplaza a RAG, cómo modernizarlo con GraphRAG y entrenamiento consciente de recuperación, y cómo aterrizarlo con KBLaM en sistemas reales.
date: 2025-09-02
draft: false
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
```

## 0. ¿Qué problema resuelve este artículo?

La discusión recurrente del último año: “Si los LLM leen un millón de tokens de una sentada, ¿seguimos necesitando RAG?”. Unos dicen “mete todo al prompt”; otros ven en RAG una cadena de herramientas con mucho margen.

Vamos más allá del sí/no. Explicamos **por qué** el contexto largo no reemplaza a RAG, **cómo** modernizar RAG para que siga siendo central en 2025 y más allá, y **qué hace falta** para que funcione en proyectos reales. Es nuestra síntesis tras revisar la literatura y seguir la práctica empresarial.

Veremos:

- **Restricciones reales**: por qué el contexto largo no lo arregla todo.
- **Autopsias**: por qué falla el RAG ingenuo.
- **El “juego de cinco piezas”**: solución de ingeniería moderna.
- **A fondo**: GraphRAG y Entrenamiento Consciente de Recuperación.
- **Despliegue**: cómo operarlo en entornos restringidos (p. ej., servidores domésticos, redes aisladas).
- **Mejoras y perspectiva**: hacia dónde debería evolucionar RAG.

---

## 1. Por qué “más contexto” no es la meta final

De Gemini 1.5 a Claude 3, las ventanas crecieron—algunas hasta el millón de tokens. A simple vista parece “adiós recuperación”. En la práctica, **una mochila más grande no garantiza un mejor viaje**.

### 1.1 Coste y latencia: el presupuesto manda

Más tokens → más coste y latencia. Equipos reportan que meter un documento de 20k caracteres en ventanas 32k+ puede costar >5× por inferencia. Con concurrencia, el P95 pasa de <1s a varios segundos—inaceptable para apps interactivas.

### 1.2 Actualidad: las actualizaciones superan a los parámetros

El conocimiento empresarial cambia a diario; finanzas/noticias/social pueden cambiar por minuto. Hornear hechos en parámetros fuerza ajustes frecuentes—caros y arriesgados. RAG mantiene el conocimiento externo y **intercambiable en caliente**.

### 1.3 Cumplimiento y auditoría: la procedencia gana

Dominios regulados necesitan no solo respuestas correctas, sino procedencia: qué documento, qué cláusula, qué versión. Volcar al prompt mezcla versiones y pierde trazabilidad. RAG registra recuperaciones, fragmentos, versiones y tiempos para una auditoría reproducible.

### 1.4 Privacidad y compartimentos

Las empresas segmentan por niveles de acceso. Meter todo en una sola ventana sobre‑expone datos. RAG recupera por solicitud dentro de los límites de control de acceso.

**Conclusión**: el contexto largo es una mochila; RAG es un mapa vivo. Los sistemas reales necesitan ambos—complementarios, no sustitutos.

---

## 2. Por qué se rompe el RAG ingenuo—autopsias

El primer RAG suele ser: trocear PDFs → embed → k‑NN → top‑k → al prompt. Sirve en demos, falla en producción. Algunos modos reales de fallo:

### 2.1 Solo vectorial, ciego a la estructura

Tras trocear manuales, un equipo usó búsqueda vectorial pura. A “¿cada cuánto se mantiene la válvula B?” devolvió una “tabla de tamaños de válvulas”—relacionada, pero sin la política numérica. Tablas y series temporales requieren recuperadores dedicados.

### 2.2 Troceado brusco fragmenta hechos

Una definición quedó partida por longitud fija. “Condiciones de seguridad: (1) presión ≥ 0,35 MPa; (2) 35–55 ℃” se separó; el modelo vio solo (1) y omitió (2).

### 2.3 Volcar contexto añade ruido

Meter 10–20 fragmentos “por si acaso” diluye la atención. En triaje de alarmas, mucho texto sobre “principios/historia” enterró los “pasos” útiles.

### 2.4 Frescura, re‑rank y trazabilidad

- **Frescura**: sin indexación incremental → leyes/avisos desactualizados.
- **Re‑rank**: sin cross‑encoder → lo “relacionado” gana sobre lo “suficiente”.
- **Sin auditoría**: respuestas sin rastro de evidencia.

No es la recuperación per se—es el método equivocado. Separa recuperación, empaquetado de evidencia, generación y verificación para desbloquear el valor de RAG.

---

## 3. El nuevo “juego de cinco piezas”: esqueleto, pasar páginas, herramientas, frescura y pequeños toques al modelo

De la investigación y despliegues, los stacks de 2025 convergen en cinco piezas, cada una corrigiendo un dolor del RAG ingenuo:

| Componente | Rol | Dónde brilla | Desafíos |
| --- | --- | --- | --- |
| Recuperación estructurada (GraphRAG) | Esqueleto del conocimiento | Saltos múltiples, regulaciones, SOPs | Extracción y mantenimiento del KG |
| Entrenamiento consciente de recuperación | Cuándo/qué recuperar | QA y resumen | Coste de entrenamiento y datos |
| Orquestación agente | Planes multi‑paso con herramientas | Planes, consultas, cálculos | Seguridad y eficiencia |
| Gestión de frescura | Índice vivo | Noticias, mercados, alta actualidad | Monitoreo y política de versiones |
| Actualizaciones de parámetros (opcional) | Hechos pequeños y estables | Plantillas, desambiguación | Alucinaciones y alcance |

Desglosamos cada pieza y cómo aterrizarla.

---

## 4. Recuperación estructurada (GraphRAG): construye el esqueleto

La recuperación con forma de grafo no es nueva; ahora es práctica a escala. La idea: añadir un **esqueleto estructurado** (KG o grafo entidad‑relación) junto a la “carne” de texto. Tareas complejas—regulaciones, procesos, análisis causal—siguen rutas por entidades y relaciones.

### 4.1 Construir el grafo: del texto al esqueleto

**Trocea + extrae**: por secciones/encabezados/párrafos con ventana deslizante; ejecuta NER/RE para extraer entidades/relaciones a un KG ligero. Mantén tipos simples (2–3) al inicio.

**Desambiguar/unir**: homónimos y sinónimos; similitud de huellas (Jaccard/Coseno) y reglas (códigos, IDs). Revisión humana para baja confianza.

### 4.2 Multi‑recuperador + re‑rank con cross‑encoder

BM25 (precisión) + denso (recobro) y re‑rank del top‑K con cross‑encoder. Reduce el “suena relevante pero no responde”.

### 4.3 Búsqueda de rutas: convertir QA en encontrar caminos

Amplía candidatos vía rutas en el KG; luego trae spans de texto. “Grafo‑luego‑texto” o al revés.

### 4.4 Paquetes de evidencia: rutas + spans

Devuelve un paquete estructurado: ruta de KG, spans, fuente/ID, versión, tiempo, offsets. El generador cita el paquete, reduce ruido y deja procedencia clara.

---

## 5. Entrenamiento consciente de recuperación: “pasar páginas”, no memorizar

Haz que el modelo sepa cuándo/qué recuperar y cómo citar.

### 5.1 Self‑RAG: auto‑chequeo + re‑recuperar

Borrador → auto‑evaluar → recuperar más → refinar hasta confianza o tope de pasos.

### 5.2 RAFT: etiquetar ruido vs. evidencia

Anota qué fragmentos recuperados distraen vs. cuáles valen; exige citas en entrenamiento.

### 5.3 RA‑DIT: aprendizaje bidireccional

Primero afina el LLM para citar; luego ajusta el recuperador (umbrales denso/BM25) con las salidas del modelo.

### 5.4 Camino práctico: empieza pequeño

Con anotaciones, empieza con RAFT en tríos pregunta‑respuesta‑evidencia. Con pocos datos, arranca sintético y revisa una muestra.

---

## 6. Orquestación agente: planes y herramientas

Muchas tareas no son de un turno: consultar manual → leer telemetría → calcular umbrales → comparar plan de mantenimiento → escribir pasos. RAG gestiona conocimiento; un Agente planifica y llama herramientas.

### 6.1 Registro de herramientas y enrutamiento

Registra herramientas (SQL, logs, hojas, APIs) con I/O y permisos. El Agente elige según intención y realimenta recuperación/LLM.

### 6.2 Límites y presupuestos

Topes duros: máx. 4–6 llamadas; presupuesto por consulta; límites de P95 y fallback seguro (“solo evidencia” si se excede).

### 6.3 Caché y reproducción

Cachea intenciones comunes con (resumen + hash de evidencia). Registra entradas/salidas para reproducibilidad y auditorías.

---

## 7. Frescura e índices en streaming

### 7.1 CDC y embeddings incrementales

Captura altas/bajas/cambios; trocea/embebe/actualiza por hora o más rápido en dominios volátiles.

### 7.2 TTL y política de versiones

TTLs por tipo de contenido y políticas conmutables: “último primero”, “estable primero” o “instantánea histórica”.

### 7.3 Evaluación rodante y monitoreo

Mantén un set de últimos 7 días; sigue tasa de acierto, NDCG, P95 y coste.

---

## 8. Actualizaciones a nivel de parámetros (opcional)

Usa LoRA/adapters para estilo/plantillas; edición quirúrgica para hechos raros. Mantén generación evidencia‑primero.

---

## 9. KBLaM: base confiable para entornos restringidos

Hemos desplegado KBLaM en servidores domésticos con recuperación externa y codificaciones estructurales. Ideas útiles para un RAG “confiable, controlable y explicable”.

### 9.1 Capa unificada de conocimiento

Une texto, tablas, grafos y metadatos; embeddings multilingües; registra procedencia (fuente/versión/tiempo/nivel).

### 9.2 Cadena de evidencia: pregunta → evidencia → respuesta

Enruta por intención; recupera/re‑rank; expande con KG; empaqueta evidencia (fuente/versión/ruta/offsets); genera; verifica por SQL/reglas si hace falta; registra para auditoría.

### 9.3 Flujo mínimo (pseudo)

```python
def responder(pregunta):
	intención = clasificar(pregunta)
	ruta = seleccionar_ruta(intención)
	candidatos = recuperar(pregunta, ruta)
	if intención.requiere_grafo:
		camino = buscar_en_grafo(candidatos)
		candidatos = unir(candidatos, camino)
	evidencia = empaquetar(candidatos)
	borrador = generar(pregunta, evidencia)
	if requiere_verificar(borrador):
		resp = verificar_y_refinar(borrador)
	else:
		resp = borrador
	log(pregunta, evidencia, resp)
	return resp
```

---

## 10. Modelo de costes y ejemplos

### 10.1 Los tokens de entrada dominan

“Volcar contexto” puede subir entradas a 30k+ tokens; un paquete de evidencia suele requerir 1–3 spans (~500–700 tokens c/u) → ~1,5k–2,1k en total—muchas veces **10× menos**.

### 10.2 Recuperar cuesta poco y ahorra mucho

BM25/denso son baratos; los re‑rankers con cross‑encoder son pequeños y van bien en CPU. “Recuperar y luego generar” gana a menudo.

### 10.3 Capacidades vs. coste

Para creación de contenido o citas largas, los híbridos funcionan: RAG para hechos, contexto largo para prosa. Cuenta tokens/llamadas/costes y elige según necesidad.

---

## 11. Checklist: de prototipo a producción

1. **Gobernanza de datos**: limpia PII; niveles de acceso; fuente/versión.
2. **Troceado**: por secciones con ventana deslizante.
3. **Recuperación base**: BM25 + denso + re‑rank; añade recuperadores de tablas/código/figuras.
4. **Paquetes de evidencia**: `source_id`, `url`, `version`, `timestamp`, `offset`, `path`, y `answer_id`.
5. **Plantillas de generación**: afirmación‑evidencia con citas en línea.
6. **Límites de agente**: lista de herramientas, pasos/presupuesto; caché de consultas frecuentes.
7. **Frescura**: crawling/embeddings incrementales; TTL y políticas; evaluación rodante.
8. **Monitoreo/reproducción**: paneles para recall/NDCG/P95/coste; reproduce pregunta→evidencia→respuesta→herramientas.
9. **Despliegue gradual**: canarios para modelos/estrategias; compara con baseline; aumenta poco a poco.
10. **Operación del equipo**: responsables claros y ciclos rápidos.

---

## 12. Próximos pasos: hacia dónde debería evolucionar RAG

### 12.1 Recuperación dinámica y gating

A escala, el coste manda; añade gating tipo ExpertRAG: solo recuperar cuando el conocimiento interno sea insuficiente y activar “expertos” dispersos por consulta.

### 12.2 Recuperación jerárquica o híbrida

Dos etapas “grueso → fino” (sparse por documento → denso en documento → cross‑encoder) ayudan en multi‑salto (véase HiRAG).

### 12.3 Conservar estructura en las codificaciones

Evita comprimir KGs a un vector; codifica tríos o subgrafos; añade numéricos/fechas; encadena rutas con CoT.

### 12.4 Compresión adaptativa y selección de conocimiento

Asigna capacidad vectorial por importancia (frecuencia, confianza, valor); descarta tokens irrelevantes—enrutamiento tipo MoE.

### 12.5 Recuperación multilingüe y cruzada

Embeddings multilingües (gtr/multi‑qa‑mpnet) con etiquetas/puertas de idioma; lo difícil es el razonamiento cruzado.

### 12.6 Chequeos externos y auto‑consistencia

Verificación post‑respuesta vía grafo/SQL; re‑recuperar o abstenerse ante contradicciones; comprobar coherencia de rutas; comprobaciones web opcionales.

---

## 13. Conclusión: el mapa no pasa de moda

RAG resuelve “encontrar y citar conocimiento”, en gran medida ortogonal al tamaño de la ventana. El contexto largo ayuda, pero no con coste, actualidad, auditorías o privacidad—ni con tareas estructuradas multi‑paso.

El “juego de cinco piezas” 2025 emerge: esqueleto + pasar páginas + herramientas + frescura + toques moderados al modelo. GraphRAG guía caminos complejos; el entrenamiento consciente enseña a citar; los agentes gestionan planes; la frescura evita caducidad; pequeñas actualizaciones ayudan a plantillas. La capa unificada, los paquetes de evidencia y las pistas de auditoría de KBLaM brindan un plano para entornos regulados.

Con gating dinámico, recuperación jerárquica, codificaciones estructuradas, compresión adaptativa y capacidad multilingüe, RAG seguirá evolucionando—posiblemente fusionándose más con modelos de inyección de conocimiento como KBLaM. Lo constante: **con presupuesto y en escenarios complejos, la recuperación es la pareja más fiable del LLM**. Lleva un mapa vivo; cualquier mochila pesa menos.

---

## Referencias (lecturas recomendadas)

1. Akari Asai et al., **Self‑RAG**, arXiv, 2024.
2. Microsoft Research, **GraphRAG**, 2024.
3. Naman Bansal, **Best Open‑Source Embedding Models Benchmarked and Ranked**, Supermemory Blog, 2025.
4. Haoyu Huang et al., **HiRAG: Retrieval‑Augmented Generation with Hierarchical Knowledge**, arXiv, 2025.
5. Esmail Gumaan, **ExpertRAG: Efficient RAG with Mixture of Experts**, arXiv, 2025.
6. Hang Luo et al., **Causal Graphs Meet Thoughts: Enhancing Complex Reasoning in Graph‑Augmented LLMs**, arXiv, 2025.
7. Wei Liu et al., **XRAG: Cross‑lingual Retrieval‑Augmented Generation**, arXiv, 2025.

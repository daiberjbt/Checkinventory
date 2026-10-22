# Lista Paginada, Filtros y Búsqueda en Servidor de Inventarios

Plan de ingeniería para transformar la gestión de inventarios de la agencia en una arquitectura orientada al servidor: paginación de 30 en 30 documentos con tiempo real en la primera página, consultas especializadas por pestaña, contadores con agregaciones de servidor (`getCountFromServer`), búsqueda indexada por prefijos (`searchTokens`) y consultas optimizadas para dependientes, manteniendo idéntico el aspecto visual actual de la aplicación.

---

## Decisiones Críticas y Resumen de Revisión

> [!IMPORTANT]
> **Preservación Visual Total:** Toda la interfaz de usuario existente (pestañas con contadores, tarjetas con etiquetas de estado, barra de búsqueda, modal de dependientes y botón de acción) conserva su diseño, tipografía, paleta Tailwind y micro-interacciones. La transformación es 100% de fontanería arquitectónica y consumo de datos Firestore.

* **Estrategia Híbrida de Paginación (Página 1 Live + "Cargar más" Snapshot):** La primera página (30 registros) se suscribe en vivo mediante `onSnapshot` para que creaciones o modificaciones recientes aparezcan de inmediato. Las páginas posteriores (2, 3, etc.) se cargan bajo demanda con `getDocs + startAfter` mediante un botón "Cargar más" discreto que solo aparece si la última página vino completa (30 documentos).
* **Contadores con `getCountFromServer` y Caché de 60s:** Las etiquetas numéricas de las 6 pestañas ya no computan `inventories.length` en memoria cliente. Se consultan directamente a la API de agregación de Firestore al entrar y se refrescan automáticamente tras eventos de mutación (guardar, archivar, asignar) o cuando expire la caché de 60 segundos. En modo sin conexión, muestran los últimos valores o se mitigan limpiamente.
* **Búsqueda Normalizada en Servidor:** Al escribir en el buscador con 400 ms de debounce, se aprovecha el índice compuesto `array-contains` sobre `searchTokens` combinado con los filtros de la pestaña activa. Para consultas multi-término, la primera palabra de 2+ caracteres ejecuta el filtro en servidor y las palabras adicionales refinan en memoria sobre los documentos devueltos.
* **Consultas Puntuales para Reglas de Negocio:** Se desacoplan las validaciones de unicidad de `internalCode` y el borrado de duplicados archivados de la lista general en memoria, ejecutando consultas específicas con `limit(5)` al servidor. Si una acción requiere un inventario fuera de las páginas visibles, se recupera mediante `getDoc(doc(db, 'inventories', id))`.
* **Consultas de Dependientes Desacopladas:** Se reemplaza el listener genérico `limit(100)` del rol dependiente por tres consultas concurrentes de solo los documentos estrictamente relevantes (borradores propios, asignaciones directas y completados dentro de la ventana de gracia de 48h).

---

## 1. Visión General y Concepto Central

### Qué Resuelve
Actualmente, la aplicación realizaba una carga en memoria de hasta 100 inventarios por agencia. Al escalar a cientos o miles de inventarios, esta aproximación consume cuota de lectura innecesaria, satura la memoria del navegador móvil y ralentiza el filtrado.

La nueva arquitectura transfiere la carga pesada al motor de índices de Firestore:
1. **Reducción de Lecturas:** Solo se descargan 30 documentos por vista en lugar de 100, y los contadores de pestañas consumen únicamente agregaciones de metadatos (1 lectura de agregación cada 1000 documentos contabilizados).
2. **Consultas Indexadas en Servidor:** Cada pestaña ejecuta una query nativa con índices compuestos ya desplegados (`[status]`, `[isReceived]`, `[status, isReceived, isAssigned]`, etc.).
3. **Resiliencia Offline:** Integración nativa con la caché persistente de Firestore para seguir navegando páginas ya vistas con el aviso contextual "Mostrando datos guardados en el teléfono".

---

## 2. Experiencia de Usuario y Flujos

### Flujo del Administrador
1. **Carga Inicial y Pestañas:**
   * Al acceder a "Mis Inventarios", se ejecutan en paralelo:
     * La suscripción en vivo de la primera página (30 inventarios más recientes según la pestaña seleccionada).
     * El cálculo de contadores de cada pestaña con `getCountFromServer` (con TTL de 60s).
   * Al cambiar de pestaña ("Todos", "Borradores", "Listos", "Firmados sin asignar", "Recibidos", "Archivados"), se cancela la suscripción anterior, se limpia la paginación y se inicia la nueva consulta de 30 ítems.
2. **Paginación Infinita ("Cargar más"):**
   * Al final del grid de tarjetas, si la página actual tiene 30 documentos, se muestra el botón "Cargar más inventarios".
   * Al hacer clic, se ejecuta `getDocs` con `startAfter(lastVisibleDoc)` para añadir los siguientes 30 inventarios a la lista combinada (deduplicada por `id`).
   * Si una página devuelve menos de 30 inventarios, el botón se oculta automáticamente.
3. **Búsqueda Instantánea con Debounce:**
   * Al teclear en el campo de búsqueda, tras 400 ms de inactividad, se genera la consulta con `searchTokens array-contains` combinada con la pestaña activa.
   * Si no hay coincidencias, se muestra el estado visual "Sin resultados" con el botón para limpiar la búsqueda.
4. **Modal de Inventarios por Dependiente:**
   * Al hacer clic en un dependiente desde la vista de equipo, su historial ya no filtra una lista local; consulta bajo demanda sus inventarios creados y asignados en bloques de 30 con `getCountFromServer` para su contador.

### Flujo del Dependiente
* El dependiente consulta exactamente lo que tiene derecho a ver:
  1. Sus borradores en curso (`createdBy == uid && status == 'draft'`).
  2. Sus asignaciones activas de entrega/recibo (`assignedTo == uid`).
  3. Sus inventarios finalizados recientemente (`createdBy == uid && status == 'completed' && completedAt > ahora - 48h`).
* Se unen los resultados sin duplicados y se registran en `PhotoSyncEngine.setPersistedInventories` para mantener sincronizadas las fotografías offline.

---

## 3. Decisiones de Producto y Compensaciones Técnicas

| Decisión | Enfoque Seleccionado | Razón Técnica y de Rendimiento |
| :--- | :--- | :--- |
| **Paginación Live vs. Estática** | Híbrida: Página 1 con `onSnapshot` + Páginas 2..N con `getDocs` | Garantiza que cualquier cambio inmediato o creación se vea al instante sin pagar el coste de mantener abiertos listeners masivos de páginas profundas. |
| **Conteo de Pestañas** | `getCountFromServer` con memoria caché de 60s | Evita descargar miles de documentos completos solo para mostrar un badge numérico. El TTL de 60s previene sobrecostes de API al navegar entre pestañas. |
| **Búsqueda Multi-palabra** | Primer término `array-contains` en servidor + filtrado cliente del resto | Firestore no permite múltiples operadores `array-contains` en una misma consulta. Filtrar el segundo término sobre el lote resultante es instantáneo y respeta las limitaciones del motor de Firestore. |
| **Lectura de Tarjetas** | Lectura estricta de `inv.photoCount ?? 0` | Elimina la iteración profunda `inv.spaces.reduce(...)` sobre arreglos de fotos en cada renderizado, mejorando drásticamente el scrolling a 60fps en dispositivos móviles. |

---

## 4. Arquitectura Técnica y Estrategia de Datos

```
┌────────────────────────────────────────────────────────────────────────┐
│                        App.tsx (Vista Inventarios)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────┐
│      Query Manager Admin        │   │     Query Manager Dependiente    │
│  - Tab Query Builder            │   │  - Drafts Query (createdBy)      │
│  - Live onSnapshot (Page 1: 30) │   │  - Assigned Query (assignedTo)   │
│  - getDocs + startAfter (>30)   │   │  - Grace Period Query (48h)      │
│  - searchTokens array-contains  │   │  - Union & Local Cache           │
└────────────────┬────────────────┘   └────────────────┬─────────────────┘
                 │                                     │
                 ▼                                     ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────┐
│     Count Cache (60s TTL)       │   │    PhotoSyncEngine Integration   │
│  - getCountFromServer por Tab   │   │  - setPersistedInventories(ids)  │
│  - Invalidation on Mutation     │   │  - Offline IndexedDB Sync        │
└────────────────┬────────────────┘   └──────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│        Firestore Database (ai-studio-70226f92-0c9c-4cd6-a0f2-...)      │
│   Índices Compuestos de Consulta y Agregaciones Server-Side            │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Definición de Consultas por Pestaña

```typescript
// Configuración de filtros según pestaña activa
function buildTabConstraints(statusFilter: string, adminEmail: string) {
  const base = [where('adminEmail', '==', adminEmail)];
  switch (statusFilter) {
    case 'draft':
      return [...base, where('status', '==', 'draft')];
    case 'completed':
      return [...base, where('status', '==', 'completed')];
    case 'received':
      return [...base, where('isReceived', '==', true)];
    case 'archived':
      return [...base, where('status', '==', 'archived')];
    case 'unassigned':
      return [
        ...base, 
        where('status', '==', 'completed'), 
        where('isReceived', '==', false), 
        where('isAssigned', '==', false)
      ];
    case 'all':
    default:
      return base;
  }
}
```

### 4.2 Lógica de Búsqueda Normalizada con Debounce
* Normalización con `normalizeText(query)`.
* Detección de palabras: `words = normalized.split(/\s+/).filter(w => w.length >= 2)`.
* Si `words.length === 1`:
  * Query Firestore: `...tabConstraints, where('searchTokens', 'array-contains', words[0]), orderBy('updatedAt', 'desc'), limit(30)`
* Si `words.length > 1`:
  * Query Firestore con `words[0]`.
  * Filtro cliente para verificar que `words[1..N]` existan en `inv.searchTokens`.
* Debounce de 400ms gestionado mediante `useRef` de temporizador para evitar consultas intermedias innecesarias al tipear.

### 4.3 Agregaciones y Sistema de Contadores
* Se crea el objeto de estado `tabCounts`:
  ```typescript
  interface TabCounts {
    all: number;
    draft: number;
    completed: number;
    unassigned: number;
    received: number;
    archived: number;
  }
  ```
* Se mantiene un `lastCountsFetchTimestamp` (referencia). Si la diferencia contra `Date.now()` es `< 60000 ms`, se reutiliza el valor en caché salvo que se fuerce por una mutación (`saveInventory`, `handleArchiveInventory`, `handleConfirmAssignment`, `handleRemoveAssignment`, `handleSaveReception`).
* Si `!isOnline`, se mantienen los últimos números conocidos o se oculta suavemente el contador si no está disponible.

### 4.4 Reglas de Negocio Desacopladas
* **Unicidad de `internalCode`:**
  ```typescript
  const codeQuery = query(
    collection(db, 'inventories'),
    where('adminEmail', '==', effectiveAdminEmail),
    where('internalCode', '==', internalCode.trim()),
    limit(5)
  );
  const snap = await getDocs(codeQuery);
  const duplicate = snap.docs.find(d => d.id !== inventoryId && d.data().status !== 'archived');
  ```
* **Búsqueda al Archivar:**
  ```typescript
  const archivedQuery = query(
    collection(db, 'inventories'),
    where('adminEmail', '==', effectiveAdminEmail),
    where('internalCode', '==', internalCode),
    where('status', '==', 'archived')
  );
  const snap = await getDocs(archivedQuery);
  // Borrar fotos y documentos de duplicados antiguos archivados antes de archivar el actual
  ```
* **Acceso a Documentos no Listados:**
  * Si `deleteInventory`, `editInventory` o `reassign` recibe un ID que no está en la página cargada, se invoca `getDoc(doc(db, 'inventories', id))` automáticamente.

### 4.5 Consultas Concurridas para Rol Dependiente
```typescript
const qDrafts = query(
  collection(db, 'inventories'),
  where('createdBy', '==', currentUser.id),
  where('status', '==', 'draft')
);
const qAssigned = query(
  collection(db, 'inventories'),
  where('assignedTo', '==', currentUser.id)
);
const qCompletedGrace = query(
  collection(db, 'inventories'),
  where('createdBy', '==', currentUser.id),
  where('status', '==', 'completed'),
  where('completedAt', '>', Date.now() - GRACE_MS)
);
```
* Se suscriben los 3 listeners y se combinan los resultados en un único mapa por ID ordenado descendentemente por `updatedAt`.
* Se notifica a `PhotoSyncEngine.getInstance().setPersistedInventories(allCombinedIds)`.

### 4.6 Optimización Estricta de Tarjetas
* En el renderizado del grid de inventarios:
  * El badge superior de fotos pasa de:
    `{typeof inv.photoCount === 'number' ? inv.photoCount : inv.spaces.reduce(...)}`
    a:
    `{inv.photoCount ?? 0} Fotos`
  * No se examinan las propiedades `inv.spaces` ni `inv.photos` en el listado, evitando cálculos en memoria durante el renderizado.

---

## 5. Plan de Ejecución por Fases (Una vez aprobado)

1. **Fase 1: Utilidades y Agregaciones**
   * Importar `getCountFromServer` de `firebase/firestore`.
   * Implementar `fetchTabCounts` con control de caché de 60s y refresco reactivo tras eventos de guardado/archivo/asignación.
2. **Fase 2: Listener Paginado y Búsqueda en Administrador**
   * Reemplazar el listener `limit(100)` por la suscripción `onSnapshot` de 30 ítems para la página 1 según la pestaña activa y término de búsqueda debounced (400 ms).
   * Implementar función `handleLoadMore` con `getDocs + startAfter` y el botón "Cargar más inventarios".
3. **Fase 3: Actualización de Reglas de Negocio en Servidor**
   * Actualizar la validación de `internalCode` en `saveInventory` para consultar directamente al servidor con `limit(5)`.
   * Actualizar `handleArchiveInventory` para buscar inventarios archivados previos mediante consulta a Firestore.
4. **Fase 4: Consultas de Dependientes y Vista de Historial**
   * Implementar las 3 consultas específicas para dependientes sin límite arbitrario de 100.
   * Adaptar el modal de historial de dependientes para paginar de 30 en 30 y usar `getCountFromServer`.
5. **Fase 5: Tarjetas, Aviso Offline y Verificación**
   * Limpiar la tarjeta para leer estrictamente `photoCount`.
   * Integrar aviso "Mostrando datos guardados en el teléfono" cuando se cargue desde caché sin conexión.
   * Ejecutar `compile_applet` y `lint_applet` para certificar la compilación perfecta.

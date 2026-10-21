# Preparación de Datos para Consultas, Filtros y Búsqueda en el Servidor (Firestore)

Plan arquitectónico y técnico para preparar los inventarios con campos calculados derivados (`searchTokens`, `isReceived`, `isAssigned`), garantizar su mantenimiento síncrono en todas las operaciones del cliente y del servidor, crear e implementar índices compuestos en Firestore, proveer migración por lotes paginada para administradores y blindar las reglas de seguridad.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Este plan se enfoca **exclusivamente** en la preparación de datos, infraestructura de base de datos y migración técnica. No modifica la apariencia visual existente de la aplicación ni la experiencia de usuario, salvo por la adición de la herramienta de optimización y migración en el Perfil de Administradores con su respectivo aviso de indexación pendiente.

- **Campos Derivados**: `searchTokens`, `isReceived` e `isAssigned` son 100% deterministas y se recalculan automáticamente en todos los puntos de mutación.
- **Rendimiento y Cuotas**: El límite de tokens se fija en un máximo estricto de 300 elementos por inventario para optimizar el tamaño de los documentos y el rendimiento de las consultas `array-contains`.
- **Tolerancia a Fallos en Migración**: La migración se ejecuta en páginas de 50 documentos con lotes `writeBatch` de máximo 400 escrituras, garantizando idempotencia, reanudación ante caídas de red y feedback visual paso a paso.

---

## 1. Overview & Core Concept

Actualmente, las consultas y filtros avanzados dependen de operaciones en memoria en el cliente tras descargar colecciones completas. Para permitir que el sistema escale a miles de inventarios por agencia sin degradación de latencia ni consumo excesivo de lecturas en Firestore, se requiere:

1. **Campos Derivados de Alta Eficiencia**:
   - `searchTokens`: Permite búsquedas textuales de prefijo instantáneas mediante consultas `array-contains` en Firestore.
   - `isReceived`: Flag booleano (`true` si existe firma en acta de entrega o de recibido) para filtrar inventarios recibidos sin inspeccionar campos de firma voluminosos.
   - `isAssigned`: Flag booleano (`true` si `assignedTo` está presente) para filtrar rápidamente asignaciones de dependientes.
2. **Mantenimiento Reactivo Garantizado**:
   - Todo flujo de guardado, finalización, firma remota, acta presencial o asignación actualiza estos campos de forma atómica.
3. **Migración Histórica y Versionado**:
   - Herramienta para que el administrador indexe el histórico existente en páginas de 50 registros por lotes seguros, marcando `searchIndexVersion: 1` en su perfil al completar.

---

## 2. User Experience & Visual Design

Conforme al requerimiento ("No cambies la interfaz ni nada más"), la interfaz se mantiene intacta con dos únicos agregados discretos en la vista de Perfil/Ajustes de administradores:

1. **Aviso de Indexación Pendiente (Solo Administradores)**:
   - Se muestra un banner informativo en la sección de configuración mientras `currentUser.searchIndexVersion !== 1`:
     - *"Tu cuenta aún no tiene optimizada la base de datos para búsquedas rápidas. Ejecuta la optimización para acelerar las consultas."*
2. **Botón y Modal de "Optimizar búsqueda"**:
   - Botón accesible en el Perfil del Administrador.
   - Al pulsar, abre un modal/panel de progreso con:
     - Estado del proceso: *"Optimizando inventario X de Y..."*
     - Barra de progreso porcentual fluida.
     - Botón para reintentar en caso de pérdida de conexión (operación idempotente y repetible).
     - Al completar exitosamente: guarda `searchIndexVersion: 1` en el documento del usuario en Firestore y emite notificación de éxito.

---

## 3. Key Product Decisions & Trade-Offs

### Decisión 1: Algoritmo de Generación de `searchTokens`
- **Algoritmo**:
  1. Extrae los textos clave del inventario: `propertyName`, `address`, `internalCode`, `ownerName` y `tenantName`.
  2. Normalización fonética/ortográfica: conversión a minúsculas, eliminación de marcas diacríticas/tildes (`normalize("NFD").replace(/[\u0300-\u036f]/g, "")`), y filtrado de caracteres no alfanuméricos.
  3. Tokenización: división en palabras de 2 o más caracteres.
  4. Generación de prefijos (n-gramas): para cada palabra, genera todos los prefijos desde 2 hasta 12 caracteres (ejemplo: "apartamento" $\rightarrow$ `["ap", "apa", "apar", "apart", "aparta", "apartam", "apartame", "apartamen", "apartament", "apartamento"]`).
  5. Inclusión del `internalCode` completo en su forma normalizada.
  6. Deduplicación mediante `Set` y limitación a un máximo de 300 tokens por documento.
- **Por qué**: Permite coincidencias parciales por prefijo en tiempo real con `array-contains` en Firestore sin necesidad de integrar motores externos (como Algolia o Typesense), manteniendo el costo de infraestructura en cero.

### Decisión 2: Inicialización de `assignedTo: null`
- **Por qué**: Firestore no indexa campos ausentes (`undefined`) en índices compuestos. Escribir explícitamente `assignedTo: null` e `isAssigned: false` al crear inventarios asegura que los documentos aparezcan correctamente en las consultas compuestas de inventarios no asignados.

### Decisión 3: Migración por Lotes y Paginada
- **Estrategia**:
  - Lectura en páginas de 50 documentos (`query(..., where("adminEmail", "==", email), orderBy("updatedAt"), startAfter(lastDoc), limit(50))`).
  - Acumulación de escrituras en `writeBatch(db)` con commit cada 400 operaciones (respetando el límite estricto de 500 de Firestore con margen de seguridad).
  - Manejo de reintentos individuales ante fallas temporales de red sin reiniciar desde cero.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                          INVENTORY LIFECYCLE                           │
└────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
[Client Mutator Points]                                    [Server Mutator Points]
 - saveInventory (draft / completed)                        - POST /api/remote-sign/confirm
 - confirmFinalSave                                           (tenantReceiveSignature /
 - handleSaveReception (owner / tenant)                        ownerDeliverySignature)
 - handleAssignDependent / Unassign                                  │
    │                                                                │
    ▼                                                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CALCULATE DERIVED FIELDS (Atómica)                   │
│  - isReceived = !!(tenantReceiveSignature || ownerDeliverySignature)   │
│  - isAssigned = !!assignedTo                                           │
│  - searchTokens = buildSearchTokens(inventory)                         │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   FIRESTORE PERSISTENCE & INDEXES                      │
│  - Inventories Collection (/inventories/{id})                          │
│  - Compound Indexes (adminEmail, status, isReceived, isAssigned...)    │
│  - firestore.rules validation (searchTokens < 400, booleans)           │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    ADMIN MIGRATION ENGINE (Profile)                    │
│  - Query chunks of 50 (adminEmail == email, orderBy updatedAt)         │
│  - writeBatch chunks (max 400)                                         │
│  - Progress Tracker UI                                                 │
│  - Set searchIndexVersion: 1 on user doc upon completion               │
└────────────────────────────────────────────────────────────────────────┘
```

### Componentes y Archivos Clave a Modificar

1. **`src/types.ts`**:
   - Agregar campos opcionales en `Inventory`:
     ```ts
     searchTokens?: string[];
     isReceived?: boolean;
     isAssigned?: boolean;
     ```
   - Agregar campo opcional en `User`:
     ```ts
     searchIndexVersion?: number;
     ```

2. **`src/lib/searchTokens.ts` (Nuevo Módulo Utilitario)**:
   - Función pura `buildSearchTokens(inv: Partial<Inventory>): string[]`:
     - Normalización (`normalize("NFD")`, regex `[^a-z0-9]`).
     - Prefijos de 2 a 12 caracteres por palabra.
     - Inclusión de `internalCode` normalizado.
     - Límite de 300 tokens deduplicados.
   - Función pura `computeDerivedInventoryFields(inv: Partial<Inventory>)`:
     - Retorna `{ searchTokens, isReceived, isAssigned }`.

3. **Puntos de Mantenimiento en `src/App.tsx`**:
   - **`saveInventory`**: Al preparar `newDocData` y `updateDocData`, calcular e incluir `searchTokens`, `isReceived`, `isAssigned`. Al crear nuevo documento, asegurar `assignedTo: null` e `isAssigned: false`.
   - **`confirmFinalSave`**: Asegurar que los datos pasados a `saveInventory` recalculen los campos derivados.
   - **`handleSaveReception`**: Al guardar firmas de acta de inquilino o propietario presenciales, escribir `isReceived: true` y recalcular `searchTokens` si cambiaron nombres.
   - **Asignación / Desasignación de Dependientes**:
     - `handleAssignDependent`: escribir `assignedTo`, `assignedToName`, `assignedAt`, `assignedBy`, `isAssigned: true`.
     - `handleUnassignDependent`: escribir `assignedTo: null`, `assignedToName: null`, `isAssigned: false`.
   - **Creación de Borrador Inicial (`startNewInventory`)**: Inicializar con `assignedTo: null` e `isAssigned: false`.

4. **Punto de Mantenimiento en `server.ts`**:
   - En la ruta `/api/remote-sign/confirm`:
     - Cuando `role === 'reception_owner'` o `role === 'reception_tenant'`, agregar a `updatePayload`:
       - `isReceived: true`
     - Recalcular `searchTokens` con `buildSearchTokens` si se actualizó `ownerName` o `tenantName`.

5. **Herramienta de Migración en Perfil (`src/App.tsx`)**:
   - Componente/sección en Ajustes (visible solo si `currentUser.role === 'admin'`).
   - Función `runSearchOptimization()`:
     - Consulta total de inventarios del tenant para la barra de progreso.
     - Loop de paginación (`getDocs` con `startAfter(lastDoc)` en lotes de 50).
     - Procesamiento con `writeBatch` (commit cada 400 documentos).
     - Guardado de `updateDoc(doc(db, 'users', currentUser.id), { searchIndexVersion: 1, updatedAt: Date.now() })`.
     - Aviso banner mientras `searchIndexVersion !== 1`.

6. **Definición de Índices Compuestos (`firestore.indexes.json`)**:
   - Crear archivo `firestore.indexes.json` con los 9 índices solicitados:
     1. `[adminEmail ASC, status ASC, updatedAt DESC]`
     2. `[adminEmail ASC, isReceived ASC, updatedAt DESC]`
     3. `[adminEmail ASC, status ASC, isReceived ASC, isAssigned ASC, updatedAt DESC]`
     4. `[adminEmail ASC, searchTokens ARRAY_CONTAINS, updatedAt DESC]`
     5. `[adminEmail ASC, status ASC, searchTokens ARRAY_CONTAINS, updatedAt DESC]`
     6. `[adminEmail ASC, internalCode ASC, updatedAt DESC]`
     7. `[createdBy ASC, status ASC, updatedAt DESC]`
     8. `[createdBy ASC, status ASC, completedAt DESC]`
     9. `[assignedTo ASC, updatedAt DESC]`
   - Configuración en `firebase.json` para referenciar `firestore.indexes.json`.
   - Despliegue de índices en Firebase Firestore.

7. **Reglas de Seguridad (`firestore.rules`)**:
   - En `isValidInventory`:
     ```cel
     (!('searchTokens' in data) || data.searchTokens == null || (data.searchTokens is list && data.searchTokens.size() < 400)) &&
     (!('isReceived' in data) || data.isReceived == null || data.isReceived is bool) &&
     (!('isAssigned' in data) || data.isAssigned == null || data.isAssigned is bool) &&
     ```
   - En `isValidUser`:
     ```cel
     (!('searchIndexVersion' in data) || data.searchIndexVersion == null || (data.searchIndexVersion is number || data.searchIndexVersion is int)) &&
     ```
   - Despliegue de `firestore.rules` mediante la herramienta `deploy_firebase`.

---

## Plan de Verificación y Pruebas

1. **Pruebas Unitarias de `buildSearchTokens`**:
   - Verificar remoción de tildes (ej. "habitación" $\rightarrow$ "habitacion", "cómodo" $\rightarrow$ "comodo").
   - Verificar prefijos de 2 a 12 caracteres.
   - Verificar deduplicación y truncamiento seguro a 300 elementos.
2. **Pruebas de Flujos de Guardado y Mutación**:
   - Creación de nuevo inventario: verificar `assignedTo: null`, `isAssigned: false`, `isReceived: false` y generación de `searchTokens`.
   - Firma de acta de recepción presencial y remota: verificar `isReceived: true`.
   - Asignación a dependiente: verificar `isAssigned: true` y `isAssigned: false` al desasignar.
3. **Prueba de Migración por Lotes**:
   - Simular ejecución con inventarios de la agencia, verificando progreso en UI y persistencia de `searchIndexVersion: 1`.
4. **Compilación y Reglas**:
   - Ejecutar `compile_applet` y `lint_applet` para verificar tipos y bundling.
   - Desplegar reglas e índices en Firebase.

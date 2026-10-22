# Preparación de Datos para Consultas, Filtros y Búsqueda en el Servidor (Paquete B)

Plan técnico detallado para la indexación y optimización de consultas en el servidor sobre la base de datos Firestore `ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f`. Incluye campos derivados (`searchTokens`, `isReceived`, `isAssigned`), gobernanza de consistencia de asignación en `firestore.rules`, 12 índices compuestos multitenant, migración resiliente con preservación de `updatedAt`, y soporte completo para actas en inventarios completados.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Configuración y Decisiones Confirmadas**:
> 1. **Base de Datos Destino**: Se utilizará exclusivamente la base `ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f` (definida en `firebase-applet-config.json`). Se configurará en `firebase.json` con `"database": "ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f"`, `"rules": "firestore.rules"` e `"indexes": "firestore.indexes.json"`.
> 2. **Gobernanza de `isAssigned`**: `saveInventory` **NO** recalculará ni enviará `isAssigned`. Solo se escribirá en la creación inicial (`false`) y en `handleAssignDependent` (`true`) y `handleUnassignDependent` (`false`). En `firestore.rules` se implementará `function isAssignedConsistent()` y se exigirá en el `allow update`.
> 3. **Migración Resiliente y Preservación de `updatedAt`**: La rutina de migración en Perfil **NO** modificará `updatedAt`. Si un lote de 50 falla en `commit()`, reintentará documento por documento, registrando los que continúen fallando para mostrarlos al usuario por su `internalCode`. Solo se guardará `searchIndexVersion: 1` si no quedaron fallos (ofreciendo "Reintentar" en caso de fallos).
> 4. **12 Índices Compuestos Específicos**: Se crearán y desplegarán los 12 índices compuestos requeridos en `firestore.indexes.json`.
> 5. **Actas en Inventarios Completados**: El guardado de actas presenciales y remotas sobre inventarios firmados incluirá `isReceived: true` (y `searchTokens` si cambiaron nombres), garantizando que las reglas de inmutabilidad de `completed` lo permitan.

---

## 1. Overview & Core Concept

El objetivo principal es permitir la búsqueda textual por prefijo, filtrado por estado, recepción y asignación directamente desde Firestore con máxima velocidad y mínimo consumo de cuota:

1. **`searchTokens`**: Tokens de prefijo generados a partir de `propertyName`, `address`, `internalCode`, `ownerName` y `tenantName` (normalizados en minúsculas, sin tildes, palabras de 2+ caracteres con prefijos de 2 a 12 caracteres, más `internalCode` completo, máximo 300 tokens deduplicados).
2. **`isReceived`**: Flag booleano (`true` si existe firma en acta de entrega `ownerDeliverySignature` o en acta de recibido `tenantReceiveSignature`).
3. **`isAssigned`**: Flag booleano que refleja estrictamente si `assignedTo != null`.
4. **Mantenimiento Atómico**: Toda mutación en cliente o servidor mantiene estos campos en estricta sincronía.

---

## 2. User Experience & Visual Design

Conforme a las especificaciones ("No cambies la interfaz ni nada más"), la interfaz se mantiene intacta con dos agregados técnicos en el Perfil de Administradores:

1. **Aviso de Indexación**:
   - Visible en Perfil/Ajustes mientras `currentUser.searchIndexVersion !== 1`:
     - *"Tu cuenta tiene inventarios pendientes de optimización para búsquedas rápidas en servidor."*
     - Botón *"Optimizar búsqueda"*.
2. **Modal de Progreso y Manejo de Errores**:
   - Barra de progreso que avanza en páginas de 50 documentos.
   - En caso de fallas puntuales:
     - Muestra: *"N inventarios no se pudieron optimizar: [CÓD-001, CÓD-002]"*.
     - Botón *"Reintentar elementos pendientes"*.
   - Al completarse al 100% sin errores:
     - Persiste `searchIndexVersion: 1` en el documento del usuario en Firestore.
     - Muestra confirmación exitosa y oculta el banner.

---

## 3. Key Product Decisions & Trade-Offs

### Decisión 1: Prevención de Sobrescritura en `saveInventory`
- `saveInventory` omite deliberadamente `isAssigned` del payload de actualización. Esto previene que una pestaña con datos desactualizados de `assignedTo` revoque la asignación de un dependiente.

### Decisión 2: Preservación de `updatedAt` en Migración
- Los documentos migrados recibirán `{ searchTokens, isReceived, isAssigned }` (y `assignedTo: null` si era inexistente), pero `updatedAt` **no** se enviará en el `writeBatch`, manteniendo intacta la fecha de modificación original para efectos de auditoría y ordenamiento.

### Decisión 3: Despliegue de Índices y Reglas en Base Dedicada
- La base de datos es `ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f`. Se configurará en `firebase.json` y se desplegarán las reglas con `deploy_firebase` y los índices mediante la CLI de Firebase con `--database ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f`.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MUTATION POINTS & DERIVED FIELDS                     │
└────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[saveInventory / FinalSave]     [Assign / Unassign]          [Reception Acts]
 - Recomputes searchTokens       - Sets assignedTo (id|null)  - Sets isReceived: true
 - Recomputes isReceived         - Sets isAssigned (t|f)      - Updates searchTokens
 - DOES NOT TOUCH isAssigned     - Atomic updateDoc            (client & server.ts)
    │                               │                               │
    └───────────────────────────────┼───────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               FIRESTORE (ai-studio-70226f92-0c9c-4cd6-a0f2...)        │
│                                                                        │
│  Collection: /inventories/{inventoryId}                                │
│    ├── searchTokens: string[] (max 300, normalized prefixes 2-12)      │
│    ├── isReceived: boolean                                             │
│    └── isAssigned: boolean                                             │
│                                                                        │
│  Security Rules (/firestore.rules):                                    │
│    ├── isValidInventory: validates searchTokens size < 400, booleans    │
│    └── isAssignedConsistent(): isAssigned == (assignedTo != null)       │
│                                                                        │
│  Compound Indexes (/firestore.indexes.json):                           │
│    ├── Multi-attribute query indexes with adminEmail & updatedAt       │
│    └── Dependent queries with createdBy / assignedTo                   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             ADMIN MIGRATION ENGINE (Settings / Profile)                │
│  - Query pages of 50 by adminEmail, orderBy updatedAt                  │
│  - writeBatch without touching updatedAt                               │
│  - Error fallback: doc-by-doc retry recording failed internalCodes     │
│  - Sets searchIndexVersion: 1 only if 0 failures                       │
└────────────────────────────────────────────────────────────────────────┘
```

### Componentes y Archivos Clave

1. **`src/types.ts`**:
   - `Inventory`: `searchTokens?: string[]`, `isReceived?: boolean`, `isAssigned?: boolean`.
   - `User`: `searchIndexVersion?: number`.

2. **`src/lib/searchTokens.ts`**:
   - Función `buildSearchTokens(inv)`:
     - Normalización sin acentos/diacríticos y en minúsculas.
     - Prefijos de 2 a 12 caracteres por palabra.
     - Inclusión del `internalCode` completo.
     - Deduplicación y truncamiento a máximo 300 tokens.
   - Función `computeIsReceived(inv)`:
     - `Boolean(inv.tenantReceiveSignature || inv.ownerDeliverySignature)`.

3. **Puntos de Mantenimiento en `src/App.tsx`**:
   - `startNewInventory`: Inicializa con `assignedTo: null`, `isAssigned: false`, `isReceived: false`, `searchTokens`.
   - `saveInventory`:
     - Calcula `searchTokens` e `isReceived`.
     - Excluye explícitamente `isAssigned` para no recalcularlo ni alterarlo.
     - En `safeUpdate` de documentos completados: incluye `isReceived` y `searchTokens`.
   - `confirmFinalSave`: Garantiza `isReceived` y `searchTokens` al delegar en `saveInventory`.
   - `handleSaveReception`: Escribe `isReceived: true`, firma correspondiente y `searchTokens` si se ingresó `receptionName`.
   - `handleAssignDependent`: Escribe `assignedTo`, `assignedToName`, `assignedAt`, `assignedBy`, `isAssigned: true`.
   - `handleUnassignDependent`: Escribe `assignedTo: null`, `assignedToName: null`, `isAssigned: false`.

4. **Punto de Mantenimiento en `server.ts`**:
   - En `/api/remote-sign/confirm`:
     - Cuando `role === 'reception_owner'` o `role === 'reception_tenant'`, agrega `isReceived: true` y recalcula `searchTokens` si se actualizó el nombre.

5. **Configuración de Firebase (`firebase.json`)**:
   ```json
   {
     "firestore": {
       "database": "ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f",
       "rules": "firestore.rules",
       "indexes": "firestore.indexes.json"
     }
   }
   ```

6. **Índices Compuestos (`firestore.indexes.json`)**:
   Los 12 índices en la colección `inventories`:
   1. `adminEmail` ASC, `status` ASC, `updatedAt` DESC
   2. `adminEmail` ASC, `isReceived` ASC, `updatedAt` DESC
   3. `adminEmail` ASC, `status` ASC, `isReceived` ASC, `isAssigned` ASC, `updatedAt` DESC
   4. `adminEmail` ASC, `searchTokens` ARRAY_CONTAINS, `updatedAt` DESC
   5. `adminEmail` ASC, `status` ASC, `searchTokens` ARRAY_CONTAINS, `updatedAt` DESC
   6. `adminEmail` ASC, `internalCode` ASC, `updatedAt` DESC
   7. `adminEmail` ASC, `isReceived` ASC, `searchTokens` ARRAY_CONTAINS, `updatedAt` DESC
   8. `adminEmail` ASC, `status` ASC, `isReceived` ASC, `isAssigned` ASC, `searchTokens` ARRAY_CONTAINS, `updatedAt` DESC
   9. `createdBy` ASC, `updatedAt` DESC
   10. `createdBy` ASC, `status` ASC, `updatedAt` DESC
   11. `createdBy` ASC, `status` ASC, `completedAt` DESC
   12. `assignedTo` ASC, `updatedAt` DESC

7. **Reglas de Seguridad (`firestore.rules`)**:
   - En `isValidInventory`:
     ```cel
     (!('searchTokens' in data) || data.searchTokens == null || (data.searchTokens is list && data.searchTokens.size() < 400)) &&
     (!('isReceived' in data) || data.isReceived == null || data.isReceived is bool) &&
     (!('isAssigned' in data) || data.isAssigned == null || data.isAssigned is bool) &&
     ```
   - Función de consistencia:
     ```cel
     function isAssignedConsistent() {
       return request.resource.data.get('isAssigned', false) == (request.resource.data.get('assignedTo', null) != null);
     }
     ```
   - Exigencia de `isAssignedConsistent()` en el `allow update` de `inventories`.
   - En `isValidUser`: validación opcional de `searchIndexVersion is number || data.searchIndexVersion is int`.

8. **Migración en Perfil de Administradores**:
   - Paginación de 50 en 50 con `startAfter(lastDoc)`.
   - Escritura sin alterar `updatedAt`.
   - Reintento unitario por documento si un lote falla, acumulando inventarios no optimizados.
   - Guardado de `searchIndexVersion: 1` solo ante éxito total.

---

## Plan de Verificación

1. **Cálculo de `searchTokens`**: Pruebas de normalización sin tildes, generación de prefijos de 2 a 12 caracteres y límite de 300 tokens.
2. **Consistencia de `isAssigned`**: Validar que `saveInventory` no toque `isAssigned`, que las asignaciones mantengan paridad con `assignedTo`, y que `isAssignedConsistent()` rechace inconsistencias.
3. **Actas en `completed`**: Validar que el guardado de actas presenciales y remotas escriba `isReceived: true` sin infringir las reglas de inmutabilidad de documentos completados.
4. **Verificación de Despliegue de Reglas e Índices**:
   - Despliegue de reglas en `ai-studio-70226f92-0c9c-4cd6-a0f2-05515103603f`.
   - Despliegue de índices y confirmación en Firebase Console.
5. **Migración**: Validar que `updatedAt` no sea alterado en ningún inventario.

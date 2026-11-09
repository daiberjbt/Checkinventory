# Plan de Implementación Ajustado: Cierre de Brecha de Seguridad en `firestore.rules`

## 1. Modificaciones Exclusivas en `firestore.rules`

No se modificará ningún archivo dentro de `src/` ni ninguna otra regla fuera de `match /inventories/{inventoryId}` y las funciones auxiliares correspondientes.

### A. Función auxiliar `myAgencyEmail()`
Se añade en la sección de funciones auxiliares:
```javascript
function myAgencyEmail() {
  let me = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
  return me.get('role', 'admin') == 'admin' ? request.auth.token.email.lower() : me.get('adminEmail', '').lower();
}
```

### B. En `match /inventories/{inventoryId}` -> `allow create`
Se utilizará **únicamente** la forma directa solicitada:
```javascript
allow create: if isAuthenticated() && 
              isUserActive() &&
              isValidInventory(request.resource.data) &&
              (isSuperAdmin() || request.resource.data.adminEmail.lower() == myAgencyEmail());
```

### C. En `match /inventories/{inventoryId}` -> `allow update`
Se añade la congelación estricta de `adminEmail` para impedir que se cambie la agencia propietaria tras la creación:
```javascript
&& (isSuperAdmin() || request.resource.data.adminEmail == resource.data.adminEmail)
```

---

## 2. Ejecución y Despliegue

1. Aplicar la edición quirúrgica en `firestore.rules`.
2. Invocar el despliegue de las reglas hacia Firebase mediante `DeployRules` (o `deploy_firebase`).
3. Confirmar e informar el resultado del despliegue en la respuesta.

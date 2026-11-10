// rules.test.mjs
// Pruebas automáticas de las reglas de seguridad (Firestore y Storage) de CheckInventory.
// Se ejecutan en GitHub Actions con el emulador de Firebase; no tocan tu base de datos real.
//
// - "ok":        comportamiento que DEBE cumplirse. Si falla, la ejecución sale en rojo.
// - "hallazgo":  comportamiento deseado que las reglas actuales quizá NO cumplen (agujero o fallo conocido).
//                No pone la ejecución en rojo; al final se listan los que siguen abiertos.
// Las pruebas de funciones nuevas (asignación, fotos por subcolección, historial de licencias)
// solo corren si esas reglas existen en firestore.rules.

import { describe, it, before, beforeEach, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const RULES_DIR = process.env.RULES_DIR || '.';
const firestoreRules = fs.readFileSync(path.join(RULES_DIR, 'firestore.rules'), 'utf8');
const storageRules = fs.readFileSync(path.join(RULES_DIR, 'storage.rules'), 'utf8');
const has = (text) => firestoreRules.includes(text);

const PROJECT_ID = 'demo-checkinventory';
const BUCKET = `gs://${PROJECT_ID}.appspot.com`;
const OWNER_EMAIL = 'djbtorreglosa@gmail.com';
const FUTURE = '2030-01-01T00:00:00.000Z';
const T0 = 1700000000000; // instante de firma de los inventarios de prueba

const EMAIL = {
  owner: OWNER_EMAIL,
  adminA: 'admin-a@test.com',
  depA1: 'dep-a1@test.com',
  depA2: 'dep-a2@test.com',
  depA3: 'dep-a3@test.com',
  adminB: 'admin-b@test.com',
  depB1: 'dep-b1@test.com',
  stranger: 'stranger@test.com',
  newbie: 'newbie@test.com',
};

// ------------------------------------------------------------------ registro de resultados
const results = [];
const ok = (name, fn) =>
  it(name, async () => {
    try {
      await fn();
      results.push({ kind: 'ok', name, passed: true });
    } catch (e) {
      results.push({ kind: 'ok', name, passed: false, error: String(e?.message || e).split('\n')[0] });
      throw e;
    }
  });
const hallazgo = (name, why, fn) =>
  it(name, { todo: why }, async () => {
    try {
      await fn();
      results.push({ kind: 'hallazgo', name, why, open: false });
    } catch (e) {
      results.push({ kind: 'hallazgo', name, why, open: true });
      throw e;
    }
  });

// ------------------------------------------------------------------ entorno y datos de prueba
let testEnv;
const ctxOf = (uid, claims = {}) =>
  testEnv.authenticatedContext(uid, { email: EMAIL[uid], email_verified: true, ...claims });
const anon = () => testEnv.unauthenticatedContext();
const db = (ctx) => ctx.firestore();
const store = (ctx) => ctx.storage(BUCKET);

const userDoc = (id, over = {}) => ({
  id,
  email: EMAIL[id],
  firstName: id,
  lastName: 'Prueba',
  role: 'dependent',
  isPremium: false,
  isActive: true,
  adminEmail: EMAIL.adminA,
  adminUid: 'adminA',
  ...over,
});
const adminDoc = (id, over = {}) =>
  userDoc(id, {
    role: 'admin',
    isPremium: true,
    expirationDate: FUTURE,
    licenseCode: `CHK-6M-${id.toUpperCase()}`,
    adminEmail: null,
    adminUid: null,
    ...over,
  });

const inv = (over = {}) => ({
  propertyName: 'Casa Prueba',
  address: 'Calle 1 # 2-3',
  date: '2026-10-01',
  status: 'draft',
  createdBy: 'depA1',
  adminEmail: EMAIL.adminA,
  createdAt: T0 - 100000,
  spaces: [{ id: 's1', title: 'Sala', items: [], photos: [] }],
  ...over,
});
const signed = (over = {}) =>
  inv({
    status: 'completed',
    ownerSignature: 'data:image/png;base64,AAAA',
    tenantSignature: 'data:image/png;base64,BBBB',
    completedAt: T0,
    ...over,
  });

const lic = (code, over = {}) => ({
  id: code,
  code,
  isUsed: false,
  durationMonths: 6,
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: 'owner',
  ...over,
});
const template = (createdBy, over = {}) => ({
  templateName: 'Apartamento tipo',
  propertyType: 'Casa',
  createdBy,
  createdAt: T0,
  structure: [],
  ...over,
});

const JPEG = (n = 1024) => new Uint8Array(n);
const put = (ctx, p, data = JPEG(), contentType = 'image/jpeg') => store(ctx).ref(p).put(data, { contentType });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = db(ctx);
    await d.doc('users/adminA').set(adminDoc('adminA'));
    await d.doc('users/depA1').set(userDoc('depA1'));
    await d.doc('users/depA2').set(userDoc('depA2'));
    await d.doc('users/depA3').set(userDoc('depA3', { isActive: false }));
    await d.doc('users/adminB').set(adminDoc('adminB'));
    await d.doc('users/depB1').set(userDoc('depB1', { adminEmail: EMAIL.adminB, adminUid: 'adminB' }));
    await d.doc('inventories/invDraftA').set(inv());
    await d.doc('inventories/invDoneA').set(signed());
    await d.doc('inventories/invDraftB').set(inv({ createdBy: 'depB1', adminEmail: EMAIL.adminB }));
    await d.doc('licenses/LIC-FREE').set(lic('LIC-FREE'));
    await d.doc('licenses/LIC-USED').set(lic('LIC-USED', { isUsed: true, assignedTo: 'adminA' }));
    await d.doc('templates/tplA1').set(template('depA1'));
  });
}

describe('Reglas de seguridad de CheckInventory', () => {
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: firestoreRules, host: '127.0.0.1', port: 8080 },
      storage: { rules: storageRules, host: '127.0.0.1', port: 9199 },
    });
  });
  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await seed();
  });
  after(async () => {
    if (testEnv) await testEnv.cleanup();
    // ---- resumen legible al final del registro
    const bad = results.filter((r) => r.kind === 'ok' && !r.passed);
    const goodCount = results.filter((r) => r.kind === 'ok' && r.passed).length;
    const open = results.filter((r) => r.kind === 'hallazgo' && r.open);
    const closed = results.filter((r) => r.kind === 'hallazgo' && !r.open);
    console.log('\n==================== RESUMEN DE SEGURIDAD ====================');
    console.log(`OK: ${goodCount} pruebas pasan | FALLAN: ${bad.length} | HALLAZGOS ABIERTOS: ${open.length} | RESUELTOS: ${closed.length}`);
    bad.forEach((r) => console.log(`  [FALLA] ${r.name}\n          ${r.error}`));
    open.forEach((r) => console.log(`  [HALLAZGO ABIERTO] ${r.name}\n          ${r.why}`));
    closed.forEach((r) => console.log(`  [resuelto] ${r.name}`));
    console.log('===============================================================\n');
  });

  // ================================================================ INVENTARIOS: lectura
  describe('Inventarios: lectura y aislamiento entre agencias', () => {
    ok('el administrador lee un inventario de su agencia', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('inventories/invDraftA').get());
    });
    ok('el creador lee su propio inventario', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA').get());
    });
    ok('otro dependiente de la misma agencia puede leerlo (diseño actual)', async () => {
      await assertSucceeds(db(ctxOf('depA2')).doc('inventories/invDraftA').get());
    });
    ok('el administrador de OTRA agencia NO puede leerlo', async () => {
      await assertFails(db(ctxOf('adminB')).doc('inventories/invDraftA').get());
    });
    ok('un dependiente de OTRA agencia NO puede leerlo', async () => {
      await assertFails(db(ctxOf('depB1')).doc('inventories/invDraftA').get());
    });
    ok('un usuario autenticado sin perfil NO puede leerlo', async () => {
      await assertFails(db(ctxOf('stranger')).doc('inventories/invDraftA').get());
    });
    ok('sin iniciar sesión NO se puede leer', async () => {
      await assertFails(db(anon()).doc('inventories/invDraftA').get());
    });
    ok('un dependiente desactivado NO puede leer', async () => {
      await assertFails(db(ctxOf('depA3')).doc('inventories/invDraftA').get());
    });
    ok('el administrador lista los inventarios de su agencia', async () => {
      await assertSucceeds(db(ctxOf('adminA')).collection('inventories').where('adminEmail', '==', EMAIL.adminA).get());
    });
    ok('el dependiente lista los que creó', async () => {
      await assertSucceeds(db(ctxOf('depA1')).collection('inventories').where('createdBy', '==', 'depA1').get());
    });
    ok('el administrador de otra agencia NO puede listar los de A', async () => {
      await assertFails(db(ctxOf('adminB')).collection('inventories').where('adminEmail', '==', EMAIL.adminA).get());
    });
    ok('nadie puede listar todos los inventarios sin filtro', async () => {
      await assertFails(db(ctxOf('adminA')).collection('inventories').get());
    });
    ok('el superadministrador lee cualquier inventario', async () => {
      await assertSucceeds(db(ctxOf('owner')).doc('inventories/invDraftB').get());
    });
  });

  // ================================================================ INVENTARIOS: creación
  describe('Inventarios: creación', () => {
    ok('un dependiente crea un inventario en su agencia', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/nuevo1').set(inv()));
    });
    ok('un administrador crea un inventario en su agencia', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('inventories/nuevo2').set(inv({ createdBy: 'adminA' })));
    });
    ok('un inventario sin campos obligatorios se rechaza', async () => {
      const { spaces, ...incompleto } = inv();
      await assertFails(db(ctxOf('depA1')).doc('inventories/malo1').set(incompleto));
    });
    ok('un estado inválido se rechaza', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/malo2').set(inv({ status: 'hackeado' })));
    });
    ok('un dependiente desactivado NO puede crear', async () => {
      await assertFails(db(ctxOf('depA3')).doc('inventories/malo3').set(inv({ createdBy: 'depA3' })));
    });
    hallazgo(
      'una agencia NO debe poder crear inventarios a nombre de OTRA agencia',
      'Hoy basta con poner createdBy = tu propio uid para escribir con adminEmail de otra agencia: el dato aparece en la lista de esa agencia.',
      async () => {
        await assertFails(db(ctxOf('adminB')).doc('inventories/inyectado').set(inv({ createdBy: 'adminB', adminEmail: EMAIL.adminA })));
      }
    );
    ok('un dependiente cuyo perfil guarda el correo de su agencia con MAYÚSCULAS sigue pudiendo crear inventarios', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await db(ctx).doc('users/depA2').set(userDoc('depA2', { adminEmail: 'ADMIN-A@Test.com' }));
      });
      await assertSucceeds(db(ctxOf('depA2')).doc('inventories/mayus1').set(inv({ createdBy: 'depA2' })));
    });
    ok('el superadministrador puede crear un inventario para cualquier agencia', async () => {
      await assertSucceeds(db(ctxOf('owner')).doc('inventories/deSuperadmin').set(inv({ createdBy: 'owner' })));
    });
  });

  // ================================================================ INVENTARIOS: edición, firma y borrado
  describe('Inventarios: edición, bloqueo tras la firma y borrado', () => {
    ok('el creador edita su borrador', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA').update({ propertyName: 'Casa editada' }));
    });
    ok('un administrador de otra agencia NO puede editarlo', async () => {
      await assertFails(db(ctxOf('adminB')).doc('inventories/invDraftA').update({ propertyName: 'Hackeada' }));
    });
    ok('firmado: NO se pueden modificar los espacios', async () => {
      await assertFails(
        db(ctxOf('depA1')).doc('inventories/invDoneA').update({ spaces: [{ id: 's1', title: 'Otra', items: [], photos: [] }] })
      );
    });
    ok('firmado: NO se puede cambiar la dirección', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA').update({ address: 'Otra dirección' }));
    });
    ok('firmado: NO se puede cambiar el nombre del inmueble', async () => {
      await assertFails(db(ctxOf('adminA')).doc('inventories/invDoneA').update({ propertyName: 'Otro nombre' }));
    });
    ok('firmado: NO se puede cambiar la agencia (adminEmail)', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA').update({ adminEmail: EMAIL.adminB }));
    });
    hallazgo(
      'borrador: NO se debe poder cambiar la agencia (adminEmail) de un inventario',
      'Hoy solo está congelado en inventarios firmados; en borradores se puede cambiar y mover el dato a otra agencia.',
      async () => {
        await assertFails(db(ctxOf('depA1')).doc('inventories/invDraftA').update({ adminEmail: EMAIL.adminB }));
      }
    );
    ok('firmado: NO se puede volver a borrador', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA').update({ status: 'draft' }));
    });
    ok('firmado: SÍ se pueden registrar las actas de recepción', async () => {
      await assertSucceeds(
        db(ctxOf('depA1')).doc('inventories/invDoneA').update({ tenantReceiveText: 'Recibido a satisfacción', tenantReceiveDate: '2026-10-20' })
      );
    });
    ok('el creador borra su borrador', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA').delete());
    });
    ok('el administrador borra un borrador de su agencia', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('inventories/invDraftA').delete());
    });
    ok('otro dependiente NO puede borrar un borrador ajeno', async () => {
      await assertFails(db(ctxOf('depA2')).doc('inventories/invDraftA').delete());
    });
    ok('un administrador de otra agencia NO puede borrarlo', async () => {
      await assertFails(db(ctxOf('adminB')).doc('inventories/invDraftA').delete());
    });
    ok('un inventario firmado NO se puede borrar (ni el administrador)', async () => {
      await assertFails(db(ctxOf('adminA')).doc('inventories/invDoneA').delete());
    });
    ok('solo el superadministrador puede borrar uno firmado', async () => {
      await assertSucceeds(db(ctxOf('owner')).doc('inventories/invDoneA').delete());
    });
  });

  // ================================================================ USUARIOS
  describe('Usuarios: lectura, listado y cambios', () => {
    ok('cada usuario lee su propio perfil', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('users/depA1').get());
    });
    ok('el administrador lee el perfil de su dependiente', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('users/depA1').get());
    });
    ok('el dependiente lee el perfil de su administrador (marca y logo)', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('users/adminA').get());
    });
    ok('un dependiente NO lee el perfil de otro dependiente', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/depA2').get());
    });
    ok('el administrador de otra agencia NO lee el perfil de A', async () => {
      await assertFails(db(ctxOf('adminB')).doc('users/depA1').get());
    });
    ok('un usuario ajeno NO lee el perfil de un administrador', async () => {
      await assertFails(db(ctxOf('stranger')).doc('users/adminA').get());
    });
    ok('el administrador lista a sus dependientes', async () => {
      await assertSucceeds(db(ctxOf('adminA')).collection('users').where('adminEmail', '==', EMAIL.adminA).get());
    });
    ok('un dependiente NO puede listar usuarios', async () => {
      await assertFails(db(ctxOf('depA1')).collection('users').where('adminEmail', '==', EMAIL.adminA).get());
    });
    ok('un administrador NO puede listar los dependientes de otra agencia', async () => {
      await assertFails(db(ctxOf('adminB')).collection('users').where('adminEmail', '==', EMAIL.adminA).get());
    });
    ok('nadie puede listar toda la colección de usuarios', async () => {
      await assertFails(db(ctxOf('adminA')).collection('users').get());
    });
    ok('un usuario edita datos normales de su perfil', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('users/depA1').update({ firstName: 'Nuevo nombre' }));
    });
    ok('un dependiente NO puede cambiarse el rol a administrador', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/depA1').update({ role: 'admin' }));
    });
    ok('un usuario NO puede activar premium por su cuenta', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/depA1').update({ isPremium: true }));
    });
    ok('un administrador NO puede cambiarse su fecha de vencimiento', async () => {
      await assertFails(db(ctxOf('adminA')).doc('users/adminA').update({ expirationDate: '2099-01-01T00:00:00.000Z' }));
    });
    ok('un administrador NO puede cambiarse su código de licencia', async () => {
      await assertFails(db(ctxOf('adminA')).doc('users/adminA').update({ licenseCode: 'CHK-12M-REGALADO' }));
    });
    ok('un usuario NO puede cambiarse de agencia', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/depA1').update({ adminEmail: EMAIL.adminB }));
    });
    ok('un usuario desactivado NO puede reactivarse solo', async () => {
      await assertFails(db(ctxOf('depA3')).doc('users/depA3').update({ isActive: true }));
    });
    ok('el administrador desactiva a su dependiente', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('users/depA1').update({ isActive: false }));
    });
    ok('un administrador de otra agencia NO puede desactivarlo', async () => {
      await assertFails(db(ctxOf('adminB')).doc('users/depA1').update({ isActive: false }));
    });
    ok('un usuario NO puede crear el perfil de otra persona', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/otraPersona').set({ email: 'otra@test.com', role: 'dependent', isActive: true }));
    });
    ok('el administrador elimina a su dependiente', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('users/depA1').delete());
    });
    ok('un dependiente NO puede eliminar su propio perfil', async () => {
      await assertFails(db(ctxOf('depA1')).doc('users/depA1').delete());
    });
    ok('un administrador de otra agencia NO puede eliminar a un dependiente ajeno', async () => {
      await assertFails(db(ctxOf('adminB')).doc('users/depA1').delete());
    });
    hallazgo(
      'registrar un administrador NUEVO con su código de licencia debe funcionar',
      'Las reglas rechazan crear un perfil con isPremium=true (solo lo permiten al superadmin), pero la app lo hace al registrar con código. Hay que mover la activación al servidor.',
      async () => {
        await assertSucceeds(
          db(ctxOf('newbie')).doc('users/newbie').set(
            adminDoc('newbie', { licenseCode: 'LIC-FREE', expirationDate: FUTURE })
          )
        );
      }
    );
    hallazgo(
      'nadie debe poder crearse como administrador SIN licencia',
      'Hoy cualquier cuenta puede crear su perfil con role=admin e isPremium=false: las reglas no exigen licencia vigente para operar.',
      async () => {
        await assertFails(
          db(ctxOf('newbie')).doc('users/newbie').set({ id: 'newbie', email: EMAIL.newbie, role: 'admin', isPremium: false, isActive: true })
        );
      }
    );
    hallazgo(
      'nadie debe poder unirse a una agencia ajena escribiendo su correo en su propio perfil',
      'Hoy un usuario nuevo puede crear su perfil con adminEmail = correo de otra agencia e isActive=true, y desde ese momento lee los inventarios de esa agencia. La aprobación del administrador solo existe en la pantalla.',
      async () => {
        await assertFails(
          db(ctxOf('newbie')).doc('users/newbie').set({
            id: 'newbie', email: EMAIL.newbie, role: 'dependent', isPremium: false, isActive: true,
            adminEmail: EMAIL.adminA, adminUid: 'adminA',
          })
        );
      }
    );
    hallazgo(
      'el superadministrador solo debe reconocerse con el correo VERIFICADO',
      'Las reglas dan permisos totales a quien tenga ese correo en su sesión, sin comprobar email_verified. Es un riesgo bajo, pero conviene exigirlo.',
      async () => {
        const sinVerificar = testEnv.authenticatedContext('falso', { email: OWNER_EMAIL, email_verified: false });
        await assertFails(db(sinVerificar).doc('inventories/invDraftB').get());
      }
    );
  });

  // ================================================================ LICENCIAS
  describe('Licencias', () => {
    ok('un usuario puede consultar un código sin usar', async () => {
      await assertSucceeds(db(ctxOf('stranger')).doc('licenses/LIC-FREE').get());
    });
    ok('un código ya usado por otra persona NO se puede consultar', async () => {
      await assertFails(db(ctxOf('stranger')).doc('licenses/LIC-USED').get());
    });
    ok('nadie (salvo el superadmin) puede listar los códigos', async () => {
      await assertFails(db(ctxOf('adminA')).collection('licenses').get());
      await assertSucceeds(db(ctxOf('owner')).collection('licenses').get());
    });
    ok('un usuario NO puede crear códigos de licencia', async () => {
      await assertFails(db(ctxOf('adminA')).doc('licenses/LIC-FALSO').set(lic('LIC-FALSO')));
    });
    ok('el superadministrador crea un código válido', async () => {
      await assertSucceeds(db(ctxOf('owner')).doc('licenses/LIC-NUEVO').set(lic('LIC-NUEVO', { durationMonths: 12 })));
    });
    ok('un usuario activa un código sin usar para sí mismo', async () => {
      await assertSucceeds(
        db(ctxOf('adminB')).doc('licenses/LIC-FREE').update({
          isUsed: true, assignedTo: 'adminB', assignedEmail: EMAIL.adminB, activatedAt: '2026-10-20T00:00:00.000Z', expiresAt: FUTURE,
        })
      );
    });
    ok('NO se puede activar un código a nombre de otra persona', async () => {
      await assertFails(db(ctxOf('adminB')).doc('licenses/LIC-FREE').update({ isUsed: true, assignedTo: 'adminA' }));
    });
    ok('NO se puede reutilizar un código ya usado', async () => {
      await assertFails(db(ctxOf('adminB')).doc('licenses/LIC-USED').update({ isUsed: true, assignedTo: 'adminB' }));
    });
    ok('NO se puede cambiar el texto del código al activarlo', async () => {
      await assertFails(db(ctxOf('adminB')).doc('licenses/LIC-FREE').update({ isUsed: true, assignedTo: 'adminB', code: 'OTRO-CODIGO' }));
    });
    ok('NO se puede liberar un código usado', async () => {
      await assertFails(db(ctxOf('adminA')).doc('licenses/LIC-USED').update({ isUsed: false }));
    });
    ok('un usuario NO puede borrar códigos', async () => {
      await assertFails(db(ctxOf('adminA')).doc('licenses/LIC-FREE').delete());
    });
  });

  // ================================================================ PLANTILLAS Y GENERAL
  describe('Plantillas y denegación general', () => {
    ok('el dueño lee su plantilla', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('templates/tplA1').get());
    });
    ok('otra persona NO lee la plantilla', async () => {
      await assertFails(db(ctxOf('depA2')).doc('templates/tplA1').get());
    });
    ok('un usuario crea su plantilla', async () => {
      await assertSucceeds(db(ctxOf('depA2')).doc('templates/tplA2').set(template('depA2')));
    });
    ok('NO se crea una plantilla a nombre de otro usuario', async () => {
      await assertFails(db(ctxOf('depA2')).doc('templates/tplX').set(template('depA1')));
    });
    ok('una plantilla con tipo de inmueble inválido se rechaza', async () => {
      await assertFails(db(ctxOf('depA2')).doc('templates/tplY').set(template('depA2', { propertyType: 'Castillo' })));
    });
    ok('una colección desconocida está cerrada para todos', async () => {
      await assertFails(db(ctxOf('adminA')).doc('secretos/x').get());
      await assertFails(db(ctxOf('adminA')).doc('secretos/x').set({ a: 1 }));
      await assertFails(db(ctxOf('owner')).doc('secretos/x').set({ a: 1 }));
      await assertFails(db(anon()).doc('secretos/x').get());
    });
    ok('el documento de prueba de conexión: lectura con sesión, nunca escritura', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('test/connection').get());
      await assertFails(db(ctxOf('adminA')).doc('test/connection').set({ a: 1 }));
      await assertFails(db(anon()).doc('test/connection').get());
    });
  });

  // ================================================================ ASIGNACIÓN (solo si existe en las reglas)
  describe('Asignación de inventarios', { skip: !has('assignedTo') }, () => {
    const assignPayload = (to, name) => ({
      assignedTo: to,
      assignedToName: name,
      assignedAt: T0 + 1,
      assignedBy: 'adminA',
      ...(has('isAssigned') ? { isAssigned: true } : {}),
    });
    const seedExtra = async () =>
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = db(ctx);
        await d.doc('inventories/invReceivedA').set(signed({ tenantReceiveSignature: 'data:image/png;base64,CCCC' }));
        await d.doc('inventories/invAssignedA').set(
          signed({ assignedTo: 'depA2', assignedToName: 'Dep A2', assignedAt: T0, assignedBy: 'adminA', ...(has('isAssigned') ? { isAssigned: true } : {}) })
        );
        await d.doc('inventories/invAssignedReceivedA').set(
          signed({
            assignedTo: 'depA2', assignedToName: 'Dep A2', assignedAt: T0, assignedBy: 'adminA',
            tenantReceiveSignature: 'data:image/png;base64,CCCC',
            ...(has('isAssigned') ? { isAssigned: true } : {}),
          })
        );
      });

    ok('el administrador asigna un inventario firmado a un dependiente de su agencia', async () => {
      await assertSucceeds(db(ctxOf('adminA')).doc('inventories/invDoneA').update(assignPayload('depA2', 'Dep A2')));
    });
    ok('un dependiente NO puede asignar inventarios', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA').update(assignPayload('depA2', 'Dep A2')));
    });
    ok('NO se puede asignar a un dependiente de OTRA agencia', async () => {
      await assertFails(db(ctxOf('adminA')).doc('inventories/invDoneA').update(assignPayload('depB1', 'Dep B1')));
    });
    ok('NO se puede asignar un borrador', async () => {
      await assertFails(db(ctxOf('adminA')).doc('inventories/invDraftA').update(assignPayload('depA2', 'Dep A2')));
    });
    ok('NO se puede asignar un inventario que ya tiene acta de recibido', async () => {
      await seedExtra();
      await assertFails(db(ctxOf('adminA')).doc('inventories/invReceivedA').update(assignPayload('depA2', 'Dep A2')));
    });
    ok('un dependiente NO puede reasignarse un inventario a otra persona', async () => {
      await seedExtra();
      await assertFails(db(ctxOf('depA2')).doc('inventories/invAssignedA').update({ assignedTo: 'depA1', assignedToName: 'Dep A1' }));
    });
    ok('el dependiente asignado SÍ puede registrar las actas', async () => {
      await seedExtra();
      await assertSucceeds(db(ctxOf('depA2')).doc('inventories/invAssignedA').update({ tenantReceiveText: 'Recibido' }));
    });
    ok('con acta firmada la asignación queda congelada', async () => {
      await seedExtra();
      await assertFails(db(ctxOf('adminA')).doc('inventories/invAssignedReceivedA').update(assignPayload('depA1', 'Dep A1')));
    });
  });

  // ================================================================ FOTOS POR SUBCOLECCIÓN (solo si existe)
  describe('Fotos por subcolección', { skip: !has('/photos/{photoId}') }, () => {
    const photo = (id, over = {}) => ({
      id,
      spaceId: 's1',
      storagePath: `tenants/adminA/photos/depA1/${id}.jpg`,
      url: `https://example.com/${id}.jpg`,
      timestamp: T0 - 500,
      createdBy: 'depA1',
      ...over,
    });
    const seedPhoto = async (invId, id) =>
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        await db(ctx).doc(`inventories/${invId}/photos/${id}`).set(photo(id));
      });

    ok('un miembro de la agencia sube una foto a un borrador', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA/photos/p1').set(photo('p1')));
    });
    ok('un miembro de otra agencia NO puede crear ni leer fotos', async () => {
      await seedPhoto('invDraftA', 'p2');
      await assertFails(db(ctxOf('depB1')).doc('inventories/invDraftA/photos/p3').set(photo('p3', { createdBy: 'depB1' })));
      await assertFails(db(ctxOf('depB1')).doc('inventories/invDraftA/photos/p2').get());
    });
    ok('los miembros de la agencia leen las fotos', async () => {
      await seedPhoto('invDraftA', 'p4');
      await assertSucceeds(db(ctxOf('adminA')).doc('inventories/invDraftA/photos/p4').get());
    });
    ok('NO se puede registrar una foto a nombre de otro usuario', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDraftA/photos/p5').set(photo('p5', { createdBy: 'depA2' })));
    });
    ok('inventario firmado: acepta una foto tomada ANTES de la firma', async () => {
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDoneA/photos/p6').set(photo('p6', { timestamp: T0 - 1000 })));
    });
    ok('inventario firmado: rechaza una foto tomada mucho DESPUÉS de la firma', async () => {
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA/photos/p7').set(photo('p7', { timestamp: T0 + 3600000 })));
    });
    ok('inventario firmado: acepta fotos de anexos en cualquier momento', async () => {
      const { spaceId, ...base } = photo('p8', { timestamp: T0 + 3600000 });
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDoneA/photos/p8').set({ ...base, annexId: 'anx1' }));
    });
    ok('en un borrador solo se puede editar la descripción', async () => {
      await seedPhoto('invDraftA', 'p9');
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA/photos/p9').update({ caption: 'Pared norte' }));
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDraftA/photos/p9').update({ url: 'https://malicioso.example/x.jpg' }));
    });
    ok('en un inventario firmado NO se editan ni se borran fotos', async () => {
      await seedPhoto('invDoneA', 'p10');
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA/photos/p10').update({ caption: 'cambio' }));
      await assertFails(db(ctxOf('depA1')).doc('inventories/invDoneA/photos/p10').delete());
    });
    ok('en un borrador se puede borrar una foto', async () => {
      await seedPhoto('invDraftA', 'p11');
      await assertSucceeds(db(ctxOf('depA1')).doc('inventories/invDraftA/photos/p11').delete());
    });
  });

  // ================================================================ HISTORIAL DE LICENCIAS (solo si existe)
  describe('Historial de licencias', { skip: !has('licenseEvents') }, () => {
    const evento = {
      agencyId: 'adminA', agencyEmail: EMAIL.adminA, action: 'extend', months: 3, reference: 'pago-001',
      previousExpiration: FUTURE, newExpiration: FUTURE, by: 'owner', at: T0,
    };
    ok('solo el superadministrador crea y lee eventos', async () => {
      await assertSucceeds(db(ctxOf('owner')).doc('licenseEvents/e1').set(evento));
      await assertSucceeds(db(ctxOf('owner')).doc('licenseEvents/e1').get());
    });
    ok('un administrador NO puede crear ni leer eventos', async () => {
      await assertFails(db(ctxOf('adminA')).doc('licenseEvents/e2').set(evento));
      await testEnv.withSecurityRulesDisabled(async (ctx) => db(ctx).doc('licenseEvents/e3').set(evento));
      await assertFails(db(ctxOf('adminA')).doc('licenseEvents/e3').get());
    });
    ok('el historial no se puede modificar ni borrar (ni el superadmin)', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => db(ctx).doc('licenseEvents/e4').set(evento));
      await assertFails(db(ctxOf('owner')).doc('licenseEvents/e4').update({ months: 99 }));
      await assertFails(db(ctxOf('owner')).doc('licenseEvents/e4').delete());
    });
  });

  // ================================================================ STORAGE
  describe('Storage: fotos y logos por agencia', () => {
    const seedFile = async (p, contentType = 'image/jpeg') =>
      testEnv.withSecurityRulesDisabled(async (ctx) => put(ctx, p, JPEG(), contentType));
    const depA1 = (claims = { adminUid: 'adminA' }) => ctxOf('depA1', claims);

    ok('el administrador sube una foto en su carpeta', async () => {
      await assertSucceeds(put(ctxOf('adminA'), 'tenants/adminA/photos/adminA/a1.jpg'));
    });
    ok('un dependiente con permiso de agencia sube una foto bajo su usuario', async () => {
      await assertSucceeds(put(depA1(), 'tenants/adminA/photos/depA1/a2.jpg'));
    });
    ok('un dependiente SIN el permiso de agencia (claim) NO puede subir', async () => {
      await assertFails(put(ctxOf('depA1'), 'tenants/adminA/photos/depA1/a3.jpg'));
    });
    ok('un dependiente NO puede subir en la carpeta de otro usuario', async () => {
      await assertFails(put(depA1(), 'tenants/adminA/photos/depA2/a4.jpg'));
    });
    ok('una persona de OTRA agencia NO puede subir a la carpeta de A', async () => {
      await assertFails(put(ctxOf('adminB'), 'tenants/adminA/photos/adminB/a5.jpg'));
      await assertFails(put(ctxOf('depB1', { adminUid: 'adminB' }), 'tenants/adminA/photos/depB1/a6.jpg'));
    });
    ok('NO se aceptan archivos que no sean imagen o PDF', async () => {
      await assertFails(put(ctxOf('adminA'), 'tenants/adminA/photos/adminA/a7.txt', JPEG(), 'text/plain'));
    });
    ok('un PDF sí se acepta', async () => {
      await assertSucceeds(put(ctxOf('adminA'), 'tenants/adminA/photos/adminA/doc.pdf', JPEG(), 'application/pdf'));
    });
    ok('NO se aceptan archivos de más de 15 MB', async () => {
      await assertFails(put(ctxOf('adminA'), 'tenants/adminA/photos/adminA/grande.jpg', new Uint8Array(15 * 1024 * 1024 + 1)));
    });
    ok('sin iniciar sesión NO se puede subir', async () => {
      await assertFails(put(anon(), 'tenants/adminA/photos/adminA/a8.jpg'));
    });
    ok('los miembros de la agencia leen sus fotos', async () => {
      await seedFile('tenants/adminA/photos/depA1/lee.jpg');
      await assertSucceeds(store(depA1()).ref('tenants/adminA/photos/depA1/lee.jpg').getMetadata());
      await assertSucceeds(store(ctxOf('adminA')).ref('tenants/adminA/photos/depA1/lee.jpg').getMetadata());
    });
    ok('otra agencia y los anónimos NO leen las fotos', async () => {
      await seedFile('tenants/adminA/photos/depA1/privada.jpg');
      await assertFails(store(ctxOf('adminB')).ref('tenants/adminA/photos/depA1/privada.jpg').getMetadata());
      await assertFails(store(ctxOf('depA1')).ref('tenants/adminA/photos/depA1/privada.jpg').getMetadata());
      await assertFails(store(anon()).ref('tenants/adminA/photos/depA1/privada.jpg').getMetadata());
    });
    ok('el administrador puede borrar la foto de un dependiente; otra agencia no', async () => {
      await seedFile('tenants/adminA/photos/depA1/borrar.jpg');
      await assertFails(store(ctxOf('adminB')).ref('tenants/adminA/photos/depA1/borrar.jpg').delete());
      await assertSucceeds(store(ctxOf('adminA')).ref('tenants/adminA/photos/depA1/borrar.jpg').delete());
    });
    ok('solo el administrador titular sube el logo; el dependiente no', async () => {
      await assertSucceeds(put(ctxOf('adminA'), 'tenants/adminA/logos/logo.png', JPEG(), 'image/png'));
      await assertFails(put(depA1(), 'tenants/adminA/logos/otro.png', JPEG(), 'image/png'));
    });
    ok('el dependiente puede ver el logo de su agencia', async () => {
      await seedFile('tenants/adminA/logos/ver.png', 'image/png');
      await assertSucceeds(store(depA1()).ref('tenants/adminA/logos/ver.png').getMetadata());
    });
    ok('la carpeta antigua (photos/) no admite subidas nuevas', async () => {
      await assertFails(put(ctxOf('depA1'), 'photos/depA1/viejo.jpg'));
    });
    ok('una ruta desconocida está cerrada', async () => {
      await assertFails(put(ctxOf('adminA'), 'otra/ruta/x.jpg'));
    });
  });
});

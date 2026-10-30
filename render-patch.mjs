// render-patch.mjs - Adapta server.ts (exportado de AI Studio) para correr fuera de Google Cloud (p. ej. Render).
//  - Credenciales de firebase-admin desde la variable FIREBASE_SERVICE_ACCOUNT (JSON o base64)
//  - Puerto desde la variable PORT
//  - trust proxy (el servicio esta detras de un balanceador)
//  - CORS para la app Android + ruta /api/health (para "despertar" el servidor)
// Es idempotente y tolera cambios de formato; si AI Studio cambia algo que no puede adaptar,
// falla con un mensaje claro que incluye el codigo actual.
import fs from 'node:fs';

const FILE = 'server.ts';
const MARK = '/* render-patched */';
let s = fs.readFileSync(FILE, 'utf8');

if (s.includes(MARK)) {
  console.log('= server.ts: ya estaba parchado');
  process.exit(0);
}

const errors = [];
const log = [];

function context(re, radius = 4) {
  const lines = s.split('\n');
  const idx = lines.findIndex((l) => re.test(l));
  if (idx < 0) return '      (no se encontro nada parecido)';
  const a = Math.max(0, idx - radius);
  const b = Math.min(lines.length, idx + radius + 1);
  return lines.slice(a, b).map((l, i) => `      ${a + i + 1}: ${l.slice(0, 140)}`).join('\n');
}

// 1) Credenciales de servicio
if (/FIREBASE_SERVICE_ACCOUNT/.test(s)) {
  log.push('= credenciales: ya soporta FIREBASE_SERVICE_ACCOUNT');
} else {
  const initRe = /admin\.initializeApp\(\s*\{\s*projectId:\s*firebaseConfig\.projectId\s*,?\s*\}\s*\)/;
  const adminAppRe = /^(\s*)const adminApp\b/m;
  if (!initRe.test(s) || !adminAppRe.test(s)) {
    errors.push(
      'no se encontro la inicializacion de firebase-admin (admin.initializeApp({ projectId: ... })). Codigo actual:\n' +
        context(/initializeApp/)
    );
  } else {
    s = s.replace(
      initRe,
      `admin.initializeApp({
      projectId: firebaseConfig.projectId,
      ...(serviceAccount ? { credential: admin.credential.cert(serviceAccount) } : {})
    })`
    );
    s = s.replace(
      adminAppRe,
      (m) => `// Credenciales de servicio: variable FIREBASE_SERVICE_ACCOUNT (JSON completo o JSON en base64)
function loadServiceAccount(): any | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}
const serviceAccount = loadServiceAccount();

${m}`
    );
    log.push('+ credenciales desde FIREBASE_SERVICE_ACCOUNT');
  }
}

// 2) Puerto
if (/process\.env\.PORT/.test(s)) {
  log.push('= puerto: ya usa process.env.PORT');
} else {
  const portRe = /const PORT\s*=\s*\d+\s*;/;
  if (!portRe.test(s)) {
    errors.push('no se encontro "const PORT = 3000;". Codigo actual:\n' + context(/PORT|\.listen\(/));
  } else {
    s = s.replace(portRe, 'const PORT = Number(process.env.PORT) || 3000;');
    log.push('+ puerto desde PORT');
  }
}

// 3) Detras de proxy
if (/trust proxy/.test(s)) {
  log.push('= trust proxy ya estaba');
} else {
  const appRe = /^(\s*)const app = express\(\);\s*$/m;
  if (!appRe.test(s)) {
    errors.push('no se encontro "const app = express();". Codigo actual:\n' + context(/express\(\)/));
  } else {
    s = s.replace(appRe, (m, ind) => `${m}\n${ind}app.set('trust proxy', 1);`);
    log.push('+ trust proxy');
  }
}

// 4) CORS para la app Android + health check
const hasCors = /NATIVE_ORIGINS|Access-Control-Allow-Origin|\bcors\(/.test(s);
const hasHealth = /['"]\/api\/health['"]/.test(s);
if (hasCors && hasHealth) {
  log.push('= CORS y /api/health ya estaban');
} else {
  const limiterRe = /^(\s*)app\.use\(\s*['"]\/api\/?['"]\s*,\s*globalApiLimiter\s*\)\s*;?\s*$/m;
  const fallbackRe = /^(\s*)app\.use\(\s*['"]\/api\/?['"]\s*,/m;
  const anchorRe = limiterRe.test(s) ? limiterRe : fallbackRe.test(s) ? fallbackRe : null;
  if (!anchorRe) {
    errors.push(
      'no se encontro donde se registra el limitador de /api (app.use(\'/api/\', globalApiLimiter)). Codigo actual:\n' +
        context(/globalApiLimiter|app\.use\(\s*['"]\/api/)
    );
  } else {
    const corsBlock = hasCors
      ? ''
      : `// CORS: permite que la app Android (WebView en https://localhost) llame a esta API
  const NATIVE_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];
  app.use('/api/', (req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    if (origin && NATIVE_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  `;
    const healthBlock = hasHealth
      ? ''
      : `// Health check: la app lo llama al abrirse para despertar el servidor gratuito
  app.get('/api/health', (_req: any, res: any) => res.json({ ok: true }));

  `;
    s = s.replace(anchorRe, (m, ind) => `${ind}${corsBlock}${healthBlock}${m.trimStart()}`);
    log.push('+ CORS y /api/health');
  }
}

if (errors.length) {
  console.error('\n*** NO SE PUDO ADAPTAR server.ts ***');
  console.error('AI Studio cambio partes del servidor que este script necesita. Envia este mensaje para actualizarlo:\n');
  errors.forEach((e) => console.error(' -', e, '\n'));
  process.exit(1);
}

fs.writeFileSync(FILE, MARK + '\n' + s);
log.forEach((l) => console.log(l));
console.log('+ server.ts: parchado\n\nOK: servidor adaptado');

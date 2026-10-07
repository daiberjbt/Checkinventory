import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Load Firebase Config
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

// Initialize Firebase Admin (for Auth verification & secure server operations)
const adminApp = !admin.apps.length 
  ? admin.initializeApp({
      projectId: firebaseConfig.projectId
    })
  : admin.app();

// Initialize Firestore Admin instance
const adminDb = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(adminApp, firebaseConfig.firestoreDatabaseId)
  : getFirestore(adminApp);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security: Payload size limits to prevent Denial of Service (DoS)
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // ===============================================================
  // Rate Limiting Guards
  // ===============================================================
  const globalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Por favor intente más tarde.' }
  });

  const emailActionsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 25, // Limit each IP to 25 email dispatches per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Límite de envíos de correo alcanzado. Intente nuevamente en unos minutos.' }
  });

  const remoteSignLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit remote sign interactions
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de firma remota. Intente más tarde.' }
  });

  app.use('/api/', globalApiLimiter);

  // ===============================================================
  // Strict Authentication Middleware (CRIT-04 fix)
  // ===============================================================
  const verifyStrictToken = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Acceso no autorizado. Debe proporcionar un token de autenticación Bearer.' });
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    if (!idToken) {
      return res.status(401).json({ error: 'Acceso no autorizado. Token de autenticación vacío.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      next();
    } catch (error: any) {
      console.warn('Verificación de token fallida:', error?.message || error);
      return res.status(401).json({ error: 'Sesión inválida o expirada. Por favor inicie sesión nuevamente.' });
    }
  };

  // Helper to send emails with Resend
  const smartSendEmail = async (options: {
    to: string;
    subject: string;
    html: string;
    attachments?: any[];
  }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const targetEmail = options.to.trim().toLowerCase();
    const senderEmail = process.env.RESEND_FROM_EMAIL || 'CheckInventory <onboarding@resend.dev>';

    if (!apiKey || apiKey.trim() === '') {
      return { status: 'simulated' as const, message: 'Modo simulación: correo registrado en servidor.' };
    }

    try {
      const resendInstance = new Resend(apiKey);

      const directResult = await resendInstance.emails.send({
        from: senderEmail,
        to: [targetEmail],
        subject: options.subject,
        html: options.html,
        attachments: options.attachments
      });

      if (!directResult.error) {
        return { 
          status: 'sent' as const, 
          recipient: targetEmail, 
          data: directResult.data 
        };
      }

      const errorMsg = directResult.error.message || '';
      const matchOwner = errorMsg.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const fallbackOwnerEmail = matchOwner ? matchOwner[1] : (process.env.ADMIN_FALLBACK_EMAIL || 'djbtorreglosa@gmail.com');

      if (fallbackOwnerEmail.toLowerCase() !== targetEmail) {
        const fallbackHtml = `
          <div style="background-color: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 14px 18px; border-radius: 12px; margin-bottom: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.5;">
            <div style="font-weight: bold; margin-bottom: 4px; font-size: 14px;">ℹ️ Notificación de Prueba CheckInventory (Resend)</div>
            Este correo fue generado para <strong>${targetEmail}</strong>.<br/>
            Al usar el dominio de pruebas gratuito (<em>onboarding@resend.dev</em>), Resend entrega las copias a su cuenta verificada (<strong>${fallbackOwnerEmail}</strong>).
          </div>
          ${options.html}
        `;

        const fallbackResult = await resendInstance.emails.send({
          from: senderEmail,
          to: [fallbackOwnerEmail],
          subject: `[Modo Prueba - Para: ${targetEmail}] ${options.subject}`,
          html: fallbackHtml,
          attachments: options.attachments
        });

        if (!fallbackResult.error) {
          return {
            status: 'test_redirected' as const,
            recipient: targetEmail,
            deliveredTo: fallbackOwnerEmail,
            data: fallbackResult.data,
            warning: `Entorno de prueba: Notificación entregada a ${fallbackOwnerEmail}.`
          };
        }
      }

      return {
        status: 'warning' as const,
        recipient: targetEmail,
        warning: errorMsg || 'Aviso en proveedor de correo.'
      };
    } catch (err: any) {
      console.error('Error general en smartSendEmail:', err?.message || err);
      return {
        status: 'warning' as const,
        recipient: targetEmail,
        warning: err.message || 'Excepción al procesar correo.'
      };
    }
  };

  // ===============================================================
  // API Routes: Authenticated & Protected Endpoints
  // ===============================================================

  // 1. Send verification email (Inventory deletion authorization)
  app.post('/api/send-verification', emailActionsLimiter, verifyStrictToken, async (req: any, res) => {
    const { email, code, propertyName } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Correo electrónico válido es obligatorio.' });
    }
    if (!code || typeof code !== 'string' || code.length > 20) {
      return res.status(400).json({ error: 'Código de verificación válido es obligatorio.' });
    }

    const safePropertyName = String(propertyName || 'Inmueble').slice(0, 200);

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #000;">CheckInventory</h2>
        <p>Se ha solicitado la eliminación del inventario para la propiedad: <strong>${safePropertyName}</strong>.</p>
        <p>Para confirmar esta acción, por favor proporcione el siguiente código de verificación al dependiente:</p>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px;">${code}</span>
        </div>
        <p style="color: #666; font-size: 12px;">Si usted no solicitó esta acción, por favor ignore este correo.</p>
        <p style="color: #999; font-size: 10px;">Nota: Este es un correo automático enviado desde el sistema de inventarios.</p>
      </div>
    `;

    const result = await smartSendEmail({
      to: email,
      subject: 'Código de Verificación - Eliminación de Inventario',
      html
    });

    res.json({
      success: true,
      ...result,
      message: result.status === 'sent' 
        ? `Código enviado con éxito a ${email}` 
        : `Código generado. (${result.warning || 'Aviso de entrega'})`
    });
  });

  // 2. Generate & Send Remote Signing Link (Strictly authorized per tenant)
  app.post('/api/send-remote-signing-link', emailActionsLimiter, verifyStrictToken, async (req: any, res) => {
    const { inventoryId, role, email, name, propertyName, address, agencyName, agencyLogo, origin } = req.body;

    if (!inventoryId || typeof inventoryId !== 'string') {
      return res.status(400).json({ error: 'ID de inventario inválido o ausente.' });
    }
    if (!role || !['reception_owner', 'reception_tenant', 'owner', 'tenant'].includes(role)) {
      return res.status(400).json({ error: 'Rol de firma remoto inválido.' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Correo de destinatario válido es requerido.' });
    }

    try {
      // Validate inventory existence and tenant membership
      const invRef = adminDb.collection('inventories').doc(inventoryId);
      const invDoc = await invRef.get();

      if (!invDoc.exists) {
        return res.status(404).json({ error: 'Inventario no encontrado.' });
      }

      const invData = invDoc.data() || {};
      const userUid = req.user.uid;
      const userEmail = (req.user.email || '').toLowerCase();
      const isSuperAdmin = userEmail === 'djbtorreglosa@gmail.com';

      // Tenant isolation verification: caller must be creator or agency admin
      const isCreator = invData.createdBy === userUid;
      const isAgencyAdmin = invData.adminEmail && invData.adminEmail.toLowerCase() === userEmail;

      if (!isSuperAdmin && !isCreator && !isAgencyAdmin) {
        // Also check if user is a dependent belonging to this agency
        const userDoc = await adminDb.collection('users').doc(userUid).get();
        const userData = userDoc.data() || {};
        const isDependent = userData.adminEmail && userData.adminEmail.toLowerCase() === (invData.adminEmail || '').toLowerCase();
        
        if (!isDependent) {
          return res.status(403).json({ error: 'Acceso denegado. No tiene permisos sobre este inventario.' });
        }
      }

      // Generate cryptographically strong random token (64 hex characters)
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days expiration

      // Update token securely in Firestore
      const existingTokens = invData.remoteSigningTokens || {};
      const updatedTokens = {
        ...existingTokens,
        [role]: {
          token,
          email: email.trim().toLowerCase(),
          name: (name || '').trim(),
          role,
          createdAt: now,
          expiresAt,
          signed: false
        }
      };

      await invRef.update({
        remoteSigningTokens: updatedTokens,
        updatedAt: now
      });

      const baseUrl = origin || 'http://localhost:3000';
      const signUrl = `${baseUrl}/?remoteSign=${token}&inv=${inventoryId}&role=${role}`;

      const roleTitles: Record<string, string> = {
        'reception_owner': 'Acta de Entrega de Inmueble (Propietario / Arrendador)',
        'reception_tenant': 'Acta de Recibido de Inmueble (Inquilino / Arrendatario)',
        'owner': 'Inventario Inicial de Inmueble (Propietario / Arrendador)',
        'tenant': 'Inventario Inicial de Inmueble (Inquilino / Arrendatario)'
      };

      const actTitle = roleTitles[role] || 'Documento de Inmueble';
      const safePropertyName = String(propertyName || invData.propertyName || 'Inmueble').slice(0, 200);
      const safeAddress = String(address || invData.address || 'N/A').slice(0, 300);
      const safeAgencyName = String(agencyName || 'CheckInventory').slice(0, 150);

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 16px; background-color: #ffffff; color: #111;">
          ${agencyLogo ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${agencyLogo}" alt="Logo" style="max-height: 50px; object-fit: contain;" /></div>` : ''}
          <div style="text-align: center; padding-bottom: 16px; border-bottom: 1px solid #f0f0f0;">
            <h1 style="font-size: 20px; font-weight: 800; margin: 0 0 6px 0; color: #000;">Solicitud de Firma Electrónica</h1>
            <p style="font-size: 13px; color: #666; margin: 0;">${safeAgencyName}</p>
          </div>
          
          <div style="padding: 24px 0;">
            <p style="font-size: 15px; line-height: 1.5; color: #222;">
              Hola <strong>${(name || '').trim() || 'Estimado(a)'}</strong>,
            </p>
            <p style="font-size: 14px; line-height: 1.6; color: #444;">
              Se ha generado el documento oficial <strong>"${actTitle}"</strong> para el inmueble ubicado en:
            </p>
            <div style="background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: bold; color: #111;">${safePropertyName}</p>
              <p style="margin: 0; font-size: 13px; color: #666;">Dirección: ${safeAddress}</p>
            </div>
            <p style="font-size: 14px; line-height: 1.6; color: #444;">
              Por favor revise las condiciones, observaciones y registre su firma digital de conformidad haciendo clic en el siguiente enlace seguro:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${signUrl}" target="_blank" style="background-color: #000000; color: #ffffff; padding: 14px 32px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                Revisar y Firmar Documento
              </a>
            </div>

            <p style="font-size: 12px; color: #777; line-height: 1.5;">
              Este enlace es personal e intransferible y expira en 7 días.<br/>
              Si el botón no abre, copie y pegue esta URL en su navegador:<br/>
              <a href="${signUrl}" style="color: #0066cc; word-break: break-all;">${signUrl}</a>
            </p>
          </div>

          <div style="border-top: 1px solid #f0f0f0; padding-top: 16px; text-align: center;">
            <p style="font-size: 11px; color: #999; margin: 0;">
              Una vez completada la firma, recibirá una copia del acta firmada en este correo electrónico.
            </p>
          </div>
        </div>
      `;

      const emailResult = await smartSendEmail({
        to: email,
        subject: `Firma Digital Requerida: ${safePropertyName} - ${actTitle}`,
        html: emailHtml
      });

      res.json({
        success: true,
        token,
        signUrl,
        emailStatus: emailResult.status,
        deliveredTo: (emailResult as any).deliveredTo || email,
        emailWarning: (emailResult as any).warning,
        message: emailResult.status === 'sent'
          ? `Enlace de firma enviado exitosamente a ${email}`
          : emailResult.status === 'test_redirected'
            ? `Enlace generado. En modo de prueba fue entregado a ${(emailResult as any).deliveredTo}.`
            : `Enlace de firma generado exitosamente.`
      });
    } catch (err: any) {
      console.error('Error en /api/send-remote-signing-link:', err?.message || err);
      res.status(500).json({ error: err.message || 'Error en el servidor al generar enlace de firma' });
    }
  });

  // 3. Send Signed Act Copy for Authenticated Users
  app.post('/api/send-signed-act-email', emailActionsLimiter, verifyStrictToken, async (req: any, res) => {
    const { email, name, propertyName, address, actTitle, pdfBase64, fileName, agencyName } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Correo de destinatario válido requerido.' });
    }

    try {
      const attachments: any[] = [];
      if (pdfBase64 && typeof pdfBase64 === 'string') {
        let cleanBase64 = pdfBase64.trim();
        if (cleanBase64.includes(',')) {
          cleanBase64 = cleanBase64.split(',')[1];
        }
        cleanBase64 = cleanBase64.trim();
        
        // Max 10MB PDF attachment guard
        if (cleanBase64.length > 14 * 1024 * 1024) {
          return res.status(400).json({ error: 'El archivo PDF excede el tamaño máximo permitido (10MB).' });
        }

        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        attachments.push({
          filename: fileName || `Acta_${(propertyName || 'Inmueble').replace(/\s+/g, '_')}.pdf`,
          content: pdfBuffer
        });
      }

      const safePropertyName = String(propertyName || 'Inmueble').slice(0, 200);
      const safeAddress = String(address || 'N/A').slice(0, 300);
      const safeAgencyName = String(agencyName || 'CheckInventory').slice(0, 150);

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 16px;">
          <h2 style="color: #000; margin-top: 0;">${safeAgencyName} - Copia de Acta Firmada</h2>
          <p>Estimado(a) <strong>${(name || 'Usuario').slice(0, 100)}</strong>,</p>
          <p>Se ha firmado y generado formalmente el documento <strong>${(actTitle || 'Acta de Inmueble').slice(0, 150)}</strong> correspondiente a la propiedad:</p>
          <div style="background: #f8f9fa; padding: 16px; border-radius: 12px; margin: 16px 0;">
            <p style="margin: 0 0 4px 0; font-weight: bold;">Inmueble: ${safePropertyName}</p>
            <p style="margin: 0; color: #666; font-size: 13px;">Dirección: ${safeAddress}</p>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Fecha: ${new Date().toLocaleString()}</p>
          </div>
          <p style="font-size: 13px; color: #555;">En el archivo adjunto encontrará el documento PDF oficial con las firmas de conformidad correspondientes.</p>
        </div>
      `;

      const emailResult = await smartSendEmail({
        to: email,
        subject: `Copia de Acta Firmada: ${safePropertyName} - ${actTitle || 'Acta Oficial'}`,
        html: emailHtml,
        attachments
      });

      res.json({
        success: true,
        emailSent: emailResult.status === 'sent' || emailResult.status === 'test_redirected',
        ...emailResult,
        message: 'Copia del acta procesada exitosamente.'
      });
    } catch (err: any) {
      console.warn('Server warning sending signed act email:', err?.message || err);
      res.json({ 
        success: true, 
        emailSent: false, 
        warning: err.message, 
        message: 'Acta guardada correctamente.' 
      });
    }
  });

  // ===============================================================
  // Public Remote Sign Endpoints (Secure Token Validation via Backend)
  // ===============================================================

  // GET data for Remote Signer (Validates cryptographic token and returns only necessary act fields)
  app.post('/api/public/remote-sign/get', remoteSignLimiter, async (req: any, res) => {
    const { invId, role, token } = req.body;

    if (!invId || typeof invId !== 'string' || !role || typeof role !== 'string' || !token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Parámetros de firma remota inválidos.' });
    }

    try {
      const invDoc = await adminDb.collection('inventories').doc(invId).get();
      if (!invDoc.exists) {
        return res.status(404).json({ error: 'El documento de inventario especificado no existe.' });
      }

      const data = invDoc.data() || {};
      const tokenRecord = data.remoteSigningTokens?.[role];

      if (!tokenRecord || typeof tokenRecord.token !== 'string' || tokenRecord.token !== token) {
        return res.status(403).json({ error: 'El enlace de firma es inválido o no corresponde a este documento.' });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < Date.now()) {
        return res.status(403).json({ error: 'El enlace de firma ha expirado. Por favor solicite un nuevo enlace al dependiente.' });
      }

      // Return sanitized subset for public signing interface
      const sanitizedDoc = {
        id: invId,
        propertyName: data.propertyName || '',
        address: data.address || '',
        date: data.date || '',
        status: data.status || 'draft',
        ownerName: data.ownerName || '',
        ownerEmail: data.ownerEmail || '',
        tenantName: data.tenantName || '',
        tenantEmail: data.tenantEmail || '',
        ownerDeliveryText: data.ownerDeliveryText || '',
        tenantReceiveText: data.tenantReceiveText || '',
        ownerDeliverySignature: data.ownerDeliverySignature || null,
        tenantReceiveSignature: data.tenantReceiveSignature || null,
        ownerSignature: data.ownerSignature || null,
        tenantSignature: data.tenantSignature || null,
        remoteSigningTokens: {
          [role]: tokenRecord
        }
      };

      res.json({
        success: true,
        inventory: sanitizedDoc,
        tokenData: tokenRecord
      });
    } catch (err: any) {
      console.error('Error in /api/public/remote-sign/get:', err?.message || err);
      res.status(500).json({ error: 'Error del servidor al recuperar datos del documento.' });
    }
  });

  // SUBMIT Remote Signature (Validates token and updates ONLY the authorized signature)
  app.post('/api/public/remote-sign/submit', remoteSignLimiter, async (req: any, res) => {
    const { invId, role, token, signature, signerName, signerEmail, pdfBase64 } = req.body;

    if (!invId || typeof invId !== 'string' || !role || typeof role !== 'string' || !token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Parámetros incompletos.' });
    }

    if (!signature || typeof signature !== 'string' || !signature.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Firma digital en formato de imagen válida requerida.' });
    }

    if (signature.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'La firma excede el tamaño máximo permitido.' });
    }

    if (!signerEmail || typeof signerEmail !== 'string' || !signerEmail.includes('@')) {
      return res.status(400).json({ error: 'Correo de confirmación válido requerido.' });
    }

    try {
      const invRef = adminDb.collection('inventories').doc(invId);
      const invDoc = await invRef.get();

      if (!invDoc.exists) {
        return res.status(404).json({ error: 'Inventario no encontrado.' });
      }

      const data = invDoc.data() || {};
      const tokenRecord = data.remoteSigningTokens?.[role];

      if (!tokenRecord || tokenRecord.token !== token) {
        return res.status(403).json({ error: 'Token de firma inválido.' });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < Date.now()) {
        return res.status(403).json({ error: 'El enlace de firma ha expirado.' });
      }

      if (tokenRecord.signed) {
        return res.status(400).json({ error: 'Este documento ya ha sido firmado previamente.' });
      }

      const nowIso = new Date().toISOString();
      const now = Date.now();

      const updatedTokens = {
        ...(data.remoteSigningTokens || {}),
        [role]: {
          ...tokenRecord,
          token,
          email: signerEmail.trim().toLowerCase(),
          name: (signerName || '').trim(),
          signed: true,
          signedAt: now
        }
      };

      const updatePayload: any = {
        updatedAt: now,
        remoteSigningTokens: updatedTokens
      };

      if (role === 'reception_owner') {
        updatePayload.ownerDeliverySignature = signature;
        updatePayload.ownerDeliveryDate = nowIso;
        updatePayload.ownerRemoteSigned = true;
        if (signerEmail) updatePayload.ownerEmail = signerEmail.trim().toLowerCase();
        if (signerName) updatePayload.ownerName = signerName.trim();
      } else if (role === 'reception_tenant') {
        updatePayload.tenantReceiveSignature = signature;
        updatePayload.tenantReceiveDate = nowIso;
        updatePayload.tenantRemoteSigned = true;
        if (signerEmail) updatePayload.tenantEmail = signerEmail.trim().toLowerCase();
        if (signerName) updatePayload.tenantName = signerName.trim();
      } else if (role === 'owner') {
        updatePayload.ownerSignature = signature;
        updatePayload.ownerRemoteSigned = true;
        if (signerEmail) updatePayload.ownerEmail = signerEmail.trim().toLowerCase();
        if (signerName) updatePayload.ownerName = signerName.trim();
        if (data.tenantSignature || data.remoteSigningTokens?.tenant?.signed) {
          updatePayload.status = 'completed';
        }
      } else if (role === 'tenant') {
        updatePayload.tenantSignature = signature;
        updatePayload.tenantRemoteSigned = true;
        if (signerEmail) updatePayload.tenantEmail = signerEmail.trim().toLowerCase();
        if (signerName) updatePayload.tenantName = signerName.trim();
        if (data.ownerSignature || data.remoteSigningTokens?.owner?.signed) {
          updatePayload.status = 'completed';
        }
      }

      // Execute atomic update in Firestore
      await invRef.update(updatePayload);

      // Send PDF copy if provided
      if (pdfBase64 && typeof pdfBase64 === 'string') {
        try {
          let cleanBase64 = pdfBase64.trim();
          if (cleanBase64.includes(',')) {
            cleanBase64 = cleanBase64.split(',')[1];
          }
          const pdfBuffer = Buffer.from(cleanBase64, 'base64');
          
          const roleTitles: Record<string, string> = {
            'reception_owner': 'Acta de Entrega de Inmueble (Propietario / Arrendador)',
            'reception_tenant': 'Acta de Recibido de Inmueble (Inquilino / Arrendatario)',
            'owner': 'Inventario Inicial de Inmueble (Propietario / Arrendador)',
            'tenant': 'Inventario Inicial de Inmueble (Inquilino / Arrendatario)'
          };

          const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 16px;">
              <h2 style="color: #000; margin-top: 0;">CheckInventory - Copia de Acta Firmada</h2>
              <p>Estimado(a) <strong>${(signerName || 'Usuario').slice(0, 100)}</strong>,</p>
              <p>Su firma electrónica ha sido registrada y certificada exitosamente para la propiedad:</p>
              <div style="background: #f8f9fa; padding: 16px; border-radius: 12px; margin: 16px 0;">
                <p style="margin: 0 0 4px 0; font-weight: bold;">Inmueble: ${data.propertyName || 'Inmueble'}</p>
                <p style="margin: 0; color: #666; font-size: 13px;">Dirección: ${data.address || 'N/A'}</p>
                <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Fecha de Firma: ${new Date().toLocaleString()}</p>
              </div>
              <p style="font-size: 13px; color: #555;">En el archivo adjunto encontrará su copia oficial en formato PDF.</p>
            </div>
          `;

          await smartSendEmail({
            to: signerEmail.trim().toLowerCase(),
            subject: `Copia de Firma Registrada: ${data.propertyName || 'Inmueble'}`,
            html: emailHtml,
            attachments: [{
              filename: `Acta_Firmada_${role}_${(data.propertyName || 'Inmueble').replace(/\s+/g, '_')}.pdf`,
              content: pdfBuffer
            }]
          });
        } catch (emailErr) {
          console.warn('Advertencia enviando copia de correo:', emailErr);
        }
      }

      res.json({
        success: true,
        message: 'Firma electrónica registrada exitosamente.'
      });
    } catch (err: any) {
      console.error('Error in /api/public/remote-sign/submit:', err?.message || err);
      res.status(500).json({ error: 'Error del servidor al registrar la firma electrónica.' });
    }
  });

  // ===============================================================
  // 4. Custom Claims Synchronization (Strict Multi-Tenant Security)
  // ===============================================================
  app.post('/api/auth/sync-claims', verifyStrictToken, async (req: any, res) => {
    try {
      const uid = req.user.uid;
      const email = (req.user.email || '').toLowerCase().trim();
      const isSuperAdmin = email === 'djbtorreglosa@gmail.com';

      const userDocRef = adminDb.collection('users').doc(uid);
      const userDoc = await userDocRef.get();

      let adminUid = uid;
      let role = 'admin';

      if (userDoc.exists) {
        const userData = userDoc.data() || {};
        role = userData.role || 'admin';

        // Check if user was deactivated or deleted
        if (userData.isActive === false || userData.isDeleted === true) {
          try {
            await admin.auth().revokeRefreshTokens(uid);
          } catch (revokeErr) {
            console.warn('Error al revocar refresh tokens para usuario inactivo:', revokeErr);
          }
          return res.status(403).json({ error: 'Usuario inactivo o eliminado del sistema.' });
        }

        if (role === 'dependent') {
          if (userData.adminUid) {
            adminUid = userData.adminUid;
          } else if (userData.adminEmail) {
            // Locate agency admin document by email
            const adminQuery = await adminDb.collection('users')
              .where('email', '==', userData.adminEmail.toLowerCase().trim())
              .where('role', '==', 'admin')
              .limit(1)
              .get();

            if (!adminQuery.empty) {
              adminUid = adminQuery.docs[0].id;
              // Persist adminUid in user document
              await userDocRef.update({ adminUid, updatedAt: Date.now() });
            }
          }
        } else {
          adminUid = uid;
        }
      } else {
        // User doc not yet synchronized
        adminUid = uid;
        role = 'admin';
      }

      const claims = {
        adminUid,
        role,
        isSuperAdmin
      };

      await admin.auth().setCustomUserClaims(uid, claims);

      res.json({
        success: true,
        claims
      });
    } catch (err: any) {
      console.error('Error en /api/auth/sync-claims:', err?.message || err);
      res.status(500).json({ error: 'Error del servidor al sincronizar credenciales de seguridad.' });
    }
  });

  // ===============================================================
  // 5. Dependent Status Update with Session Token Revocation
  // ===============================================================
  app.post('/api/users/update-status', verifyStrictToken, async (req: any, res) => {
    const { targetUid, isActive, isDeleted } = req.body;

    if (!targetUid || typeof targetUid !== 'string') {
      return res.status(400).json({ error: 'targetUid es obligatorio.' });
    }

    try {
      const callerUid = req.user.uid;
      const callerEmail = (req.user.email || '').toLowerCase().trim();
      const isSuperAdmin = callerEmail === 'djbtorreglosa@gmail.com';

      const targetDocRef = adminDb.collection('users').doc(targetUid);
      const targetDoc = await targetDocRef.get();

      if (!targetDoc.exists) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }

      const targetData = targetDoc.data() || {};

      // Security check: caller must be superadmin or the admin of this dependent
      const isAgencyAdminByEmail = targetData.adminEmail && targetData.adminEmail.toLowerCase() === callerEmail;
      const isAgencyAdminByUid = targetData.adminUid && targetData.adminUid === callerUid;

      if (!isSuperAdmin && !isAgencyAdminByEmail && !isAgencyAdminByUid) {
        return res.status(403).json({ error: 'Acceso denegado. No está autorizado para modificar este usuario.' });
      }

      const updateData: any = {
        updatedAt: Date.now()
      };

      if (typeof isActive === 'boolean') {
        updateData.isActive = isActive;
      }
      if (typeof isDeleted === 'boolean') {
        updateData.isDeleted = isDeleted;
      }

      await targetDocRef.update(updateData);

      // If deactivated or deleted, immediately revoke refresh tokens
      if (isActive === false || isDeleted === true) {
        try {
          await admin.auth().revokeRefreshTokens(targetUid);
        } catch (revokeErr) {
          console.warn('Error al revocar tokens del usuario dependiente:', revokeErr);
        }
      }

      res.json({
        success: true,
        message: 'Estado de usuario actualizado exitosamente.'
      });
    } catch (err: any) {
      console.error('Error en /api/users/update-status:', err?.message || err);
      res.status(500).json({ error: 'Error del servidor al actualizar estado.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

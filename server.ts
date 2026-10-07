import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // CORS: la app Android (origen https://localhost) llama a este servidor
  app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // API Route to send verification email
  app.post('/api/send-verification', async (req, res) => {
    const { email, code, propertyName } = req.body;
    const apiKey = process.env.RESEND_API_KEY;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    // If no API key is configured, we'll simulate the sending for development purposes
    // and log the code to the console so the user can still test the app.
    if (!apiKey || apiKey.trim() === '') {
      console.log('-------------------------------------------');
      console.log('SIMULACIÓN DE ENVÍO DE CORREO');
      console.log(`Para: ${email}`);
      console.log(`Propiedad: ${propertyName || 'N/A'}`);
      console.log(`Código: ${code}`);
      console.log('-------------------------------------------');
      
      return res.json({ 
        success: true, 
        simulated: true,
        message: 'Modo simulación: El código se ha impreso en los logs del servidor porque no hay una API Key de Resend configurada.' 
      });
    }

    try {
      const resendInstance = new Resend(apiKey);
      const { data, error } = await resendInstance.emails.send({
        from: 'CheckInventory <onboarding@resend.dev>',
        to: [email],
        subject: 'Código de Verificación - Eliminación de Inventario',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #000;">CheckInventory</h2>
            <p>Se ha solicitado la eliminación del inventario para la propiedad: <strong>${propertyName || 'N/A'}</strong>.</p>
            <p>Para confirmar esta acción, por favor proporcione el siguiente código de verificación al dependiente:</p>
            <div style="background: #f8f9fa; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px;">${code}</span>
            </div>
            <p style="color: #666; font-size: 12px;">Si usted no solicitó esta acción, por favor ignore este correo.</p>
            <p style="color: #999; font-size: 10px;">Nota: Este es un correo automático enviado desde el sistema de inventarios.</p>
          </div>
        `,
      });

      if (error) {
        console.error('Resend API Error:', error);
        return res.status(500).json({ error: error.message || 'Error desconocido en la API de Resend' });
      }

      res.json({ success: true, data });
    } catch (err: any) {
      console.error('Server Exception:', err);
      res.status(500).json({ error: err.message || 'Error interno del servidor al procesar el envío' });
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

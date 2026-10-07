import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import DOMPurify from 'dompurify';
import { SignaturePad } from './SignaturePad';
import { 
  Building2, 
  MapPin, 
  Calendar, 
  User, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Download, 
  Send, 
  Lock,
  ArrowRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { Inventory } from '../types';

interface PublicRemoteSignPageProps {
  token: string;
  invId: string;
  role: string;
}

export const PublicRemoteSignPage: React.FC<PublicRemoteSignPageProps> = ({ token, invId, role }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<Partial<Inventory> | null>(null);
  const [tokenData, setTokenData] = useState<any>(null);
  const [signature, setSignature] = useState<string>('');
  const [signerName, setSignerName] = useState<string>('');
  const [signerEmail, setSignerEmail] = useState<string>('');
  const [hasAgreed, setHasAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    fetchSignData();
  }, [invId, token, role]);

  const fetchSignData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Secure Backend Fetch with Cryptographic Token Validation
      const res = await fetch('/api/public/remote-sign/get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invId, role, token })
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'El enlace de firma es inválido o ha expirado.');
      }

      const data = result.inventory as Partial<Inventory>;
      const currentTokenRecord = result.tokenData;

      setInventory(data);
      setTokenData(currentTokenRecord);

      const defaultName = currentTokenRecord?.name || 
        (role.includes('owner') ? data.ownerName : data.tenantName) || '';
      const defaultEmail = currentTokenRecord?.email || 
        (role.includes('owner') ? data.ownerEmail : data.tenantEmail) || '';

      setSignerName(defaultName);
      setSignerEmail(defaultEmail);

      if (currentTokenRecord?.signed) {
        setIsSuccess(true);
        setSuccessMessage('Este documento ya ha sido firmado legalmente.');
        if (role === 'reception_owner' && data.ownerDeliverySignature) {
          setSignature(data.ownerDeliverySignature);
        } else if (role === 'reception_tenant' && data.tenantReceiveSignature) {
          setSignature(data.tenantReceiveSignature);
        } else if (role === 'owner' && data.ownerSignature) {
          setSignature(data.ownerSignature);
        } else if (role === 'tenant' && data.tenantSignature) {
          setSignature(data.tenantSignature);
        }
      }
    } catch (err: any) {
      console.warn('Error al cargar datos de firma remota:', err?.message || err);
      setError(err.message || 'Error al comunicarse con el sistema de verificación.');
    } finally {
      setLoading(false);
    }
  };

  const getRoleTitle = () => {
    switch (role) {
      case 'reception_owner':
        return 'Acta de Entrega de Inmueble (Propietario / Arrendador)';
      case 'reception_tenant':
        return 'Acta de Recibido de Inmueble (Inquilino / Arrendatario)';
      case 'owner':
        return 'Inventario Inicial de Inmueble (Firma de Propietario)';
      case 'tenant':
        return 'Inventario Inicial de Inmueble (Firma de Inquilino)';
      default:
        return 'Acta Legal de Inmueble';
    }
  };

  // Safe Sanitized HTML extraction (XSS Prevention: ALTO-02)
  const getActContentHtml = () => {
    if (!inventory) return '';
    let rawHtml = '';
    if (role === 'reception_owner') {
      rawHtml = inventory.ownerDeliveryText || `<p>Yo, como propietario, dejo constancia de haber recibido el inmueble ubicado en <b>${inventory.address}</b>, en las condiciones descritas en el inventario adjunto, junto con las llaves correspondientes.</p>`;
    } else if (role === 'reception_tenant') {
      rawHtml = inventory.tenantReceiveText || `<p>Yo, como inquilino, hago entrega del inmueble ubicado en <b>${inventory.address}</b>, en las condiciones pactadas, realizando la devolución de las llaves al propietario.</p>`;
    } else {
      rawHtml = `<p>Documento de inventario y entrega para el inmueble ubicado en <b>${inventory.address}</b>.</p>`;
    }

    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'u', 'span', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4'],
      ALLOWED_ATTR: ['style', 'class']
    });
  };

  const stripHtml = (html: string) => {
    const cleanHtml = DOMPurify.sanitize(html);
    const tmp = document.createElement('div');
    tmp.innerHTML = cleanHtml;
    return tmp.textContent || tmp.innerText || '';
  };

  const generatePDFBlob = () => {
    if (!inventory) return null;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(getRoleTitle(), 14, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(`Propiedad: ${inventory.propertyName || 'N/A'}`, 14, 28);
    doc.text(`Dirección: ${inventory.address || 'N/A'}`, 14, 34);
    doc.text(`Fecha del Documento: ${inventory.date || 'N/A'}`, 14, 40);
    doc.text(`Firmante: ${signerName} (${signerEmail})`, 14, 46);
    doc.text(`Fecha de Firma Digital: ${new Date().toLocaleString()}`, 14, 52);

    doc.setDrawColor(200);
    doc.line(14, 56, pageWidth - 14, 56);

    let currentY = 64;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Contenido y Declaración Legal', 14, currentY);
    currentY += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50);
    const plainText = stripHtml(getActContentHtml());
    const splitLines = doc.splitTextToSize(plainText, pageWidth - 28);
    doc.text(splitLines, 14, currentY);
    currentY += (splitLines.length * 6) + 15;

    // Signature
    if (signature) {
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Firma Digital Registrada:', 14, currentY);
      currentY += 6;
      try {
        doc.addImage(signature, 'PNG', 14, currentY, 60, 25);
        currentY += 28;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(`${signerName} - ${signerEmail}`, 14, currentY);
        doc.text(`Certificado de firma electrónica - CheckInventory`, 14, currentY + 5);
      } catch (err) {
        console.error('Error al estampar firma en PDF');
      }
    }

    return doc;
  };

  const handleDownloadPDF = () => {
    const doc = generatePDFBlob();
    if (!doc || !inventory) return;
    const fileName = `Acta_${role}_${(inventory.propertyName || 'Inmueble').replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
  };

  const handleSubmitSignature = async () => {
    if (!signature || signature.trim() === '') {
      alert('Por favor realice su firma en el recuadro antes de continuar.');
      return;
    }
    if (!signerName.trim()) {
      alert('Por favor ingrese su nombre completo.');
      return;
    }
    if (!signerEmail.trim() || !signerEmail.includes('@')) {
      alert('Por favor ingrese un correo electrónico válido para recibir su copia legal.');
      return;
    }
    if (!hasAgreed) {
      alert('Debe aceptar la declaración de conformidad para estampar la firma legal.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Generate PDF copy for server attachment
      const docPdf = generatePDFBlob();
      let pdfBase64 = '';
      if (docPdf) {
        pdfBase64 = docPdf.output('datauristring');
      }

      // Submit signature to hardened backend API endpoint
      const response = await fetch('/api/public/remote-sign/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          invId,
          role,
          token,
          signature,
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim().toLowerCase(),
          pdfBase64
        })
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Error al registrar la firma electrónica.');
      }

      setIsSuccess(true);
      setSuccessMessage('¡Firma registrada exitosamente! Su documento ha sido legalizado y guardado con éxito.');
    } catch (err: any) {
      console.error('Error al enviar firma remota:', err?.message || err);
      alert(err.message || 'Error al procesar la firma. Intente nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-black/10 border-t-black rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Cargando documento seguro...</h2>
        <p className="text-sm text-gray-500 mt-1">Validando credenciales criptográficas...</p>
      </div>
    );
  }

  if (error || !inventory) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-red-100 shadow-xl text-center space-y-4">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Enlace no disponible</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            {error || 'El documento solicitado no existe o el enlace de firma ya no es válido.'}
          </p>
          <div className="pt-2">
            <a 
              href="/"
              className="inline-block bg-black text-white px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-black/80 transition-all"
            >
              Ir a la página principal
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col items-center p-4 sm:p-6 lg:p-8 selection:bg-white selection:text-black font-sans">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        
        {/* Header Branding */}
        <header className="flex items-center justify-between py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-black font-black text-xl shadow-lg">
              CI
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">CheckInventory</h1>
              <p className="text-xs text-gray-400">Portal de Firma Electrónica Segura</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
            <Lock size={12} />
            <span>Encriptación SSL</span>
          </div>
        </header>

        {/* Title and Role Badge */}
        <div className="space-y-2">
          <div className="inline-block px-3 py-1 bg-white/10 rounded-full text-[11px] font-bold uppercase tracking-wider text-gray-300">
            {getRoleTitle()}
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {inventory.propertyName || 'Inmueble'}
          </h2>
          <p className="text-sm text-gray-400 flex items-center gap-1.5">
            <MapPin size={14} className="text-gray-400" />
            {inventory.address}
          </p>
        </div>

        {/* Main Card */}
        {isSuccess ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#141414] border border-white/10 rounded-3xl p-6 sm:p-8 text-center space-y-6 shadow-2xl"
          >
            <div className="w-20 h-20 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 size={40} />
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-white">¡Documento Legal Firmado!</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto leading-relaxed">
                {successMessage || 'Su firma digital ha sido estampada y verificada de conformidad con las normativas legales vigentes.'}
              </p>
            </div>

            {signature && (
              <div className="bg-[#181818] border border-white/5 rounded-2xl p-4 max-w-xs mx-auto text-left">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Firma Registrada</p>
                <div className="bg-white rounded-xl p-2 flex items-center justify-center">
                  <img src={signature} alt="Firma Registrada" className="max-h-20 object-contain" />
                </div>
                <div className="mt-3 text-xs text-gray-300">
                  <p className="font-semibold">{signerName}</p>
                  <p className="text-gray-400">{signerEmail}</p>
                </div>
              </div>
            )}

            <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleDownloadPDF}
                className="bg-white text-black px-6 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-gray-200 transition-all shadow-lg cursor-pointer"
              >
                <Download size={16} />
                <span>Descargar Copia PDF</span>
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#141414] border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl"
          >
            {/* Property Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-[#181818] rounded-2xl border border-white/5 text-xs">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white/5 rounded-xl text-gray-300">
                  <Building2 size={18} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Propiedad</p>
                  <p className="font-medium text-gray-200 truncate">{inventory.propertyName}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white/5 rounded-xl text-gray-300">
                  <Calendar size={18} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Fecha</p>
                  <p className="font-medium text-gray-200">{inventory.date}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 col-span-2 sm:col-span-1">
                <div className="p-2 bg-white/5 rounded-xl text-gray-300">
                  <User size={18} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Elaborado por</p>
                  <p className="font-medium text-gray-200">Administración</p>
                </div>
              </div>
            </div>

            {/* Document Content Box */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
                <FileText size={14} />
                <span>Declaración del Acta</span>
              </div>
              <div 
                className="bg-[#181818] p-6 rounded-2xl border border-white/5 text-gray-200 text-sm leading-relaxed max-h-60 overflow-y-auto space-y-2 prose-invert"
                dangerouslySetInnerHTML={{ __html: getActContentHtml() }}
              />
            </div>

            {/* Signer Identity Information */}
            <div className="space-y-4 pt-2">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">
                Datos del Firmante
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                    <User size={13} />
                    Nombre Completo *
                  </label>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    className="w-full bg-[#181818] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-white focus:outline-none transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                    <Mail size={13} />
                    Correo Electrónico (Para recibir copia legal) *
                  </label>
                  <input
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="ejemplo@correo.com"
                    className="w-full bg-[#181818] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-white focus:outline-none transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Signature Box */}
            <div className="space-y-3 pt-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Firma Digital Legal *
              </label>
              <div className="bg-white rounded-2xl p-4 text-black">
                <SignaturePad
                  key="remote-signature-pad"
                  label="Dibuje su firma con el dedo o mouse"
                  initialValue={signature}
                  onSave={(data) => setSignature(data)}
                />
              </div>
            </div>

            {/* Agreement Checkbox */}
            <label className="flex items-start gap-3 p-4 bg-[#181818] border border-white/5 rounded-2xl cursor-pointer hover:border-white/20 transition-all select-none">
              <input
                type="checkbox"
                checked={hasAgreed}
                onChange={(e) => setHasAgreed(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-gray-600 text-black focus:ring-black"
              />
              <span className="text-xs text-gray-300 leading-relaxed">
                Manifiesto bajo la gravedad de juramento que he leído el contenido de esta acta y certifico mi total conformidad estampando mi firma electrónica. Acepto recibir una copia legal en el correo electrónico indicado.
              </span>
            </label>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                onClick={handleSubmitSignature}
                disabled={isSubmitting || !signature || !signerName.trim() || !signerEmail.trim() || !hasAgreed}
                className="w-full bg-white text-black py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 hover:bg-gray-200 transition-all shadow-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                    <span>Registrando firma y enviando copia...</span>
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    <span>Confirmar y Firmar Documento</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        <footer className="text-center text-xs text-gray-500 pb-8">
          CheckInventory • Sistema Certificado de Entrega y Recepción de Inmuebles
        </footer>
      </div>
    </div>
  );
};

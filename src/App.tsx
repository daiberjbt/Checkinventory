/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Home, 
  ClipboardList, 
  Camera, 
  Trash2, 
  Download, 
  Archive,
  Copy,
  ChevronRight, 
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
  Save,
  X,
  LogIn,
  FileText,
  Mail,
  MapPin,
  Calendar,
  ArrowLeft,
  Mic,
  MicOff,
  Settings,
  Shield,
  User as UserIcon,
  Users,
  Image as ImageIcon,
  LayoutDashboard,
  CheckCircle2,
  Bath,
  ChefHat,
  Bed,
  Sun,
  Moon,
  Palette,
  Upload,
  UploadCloud,
  Sofa,
  Wind,
  Power,
  UserX,
  Key,
  PenTool,
  Building2,
  Briefcase,
  Store,
  Warehouse,
  WifiOff,
  Share2,
  Maximize2,
  Check,
  Search,
  ShoppingCart,
  Send,
  ExternalLink,
  Globe,
  Smartphone,
  Link2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Inventory, InventorySpace, InventoryItem, Photo, User, Annex, InventoryTemplate, TemplateSpace, PropertyType, License, OfflinePhotoRecord } from './types';
import { SignaturePad } from './components/SignaturePad';
import { Auth } from './components/Auth';
import { PublicRemoteSignPage } from './components/PublicRemoteSignPage';
import { PhotoThumb, getPhotoDisplayUrl } from './components/PhotoThumb';
import { PhotoSyncEngine, photoSyncEngine } from './lib/photoSyncEngine';
import { savePendingPhoto, deletePhotoRecord, markPhotoDeleted, getPhotoBlob } from './lib/offlinePhotoDb';
import { auth, db, storage } from './firebase';
import { onAuthStateChanged, signOut, sendEmailVerification } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  getDoc,
  getDocs,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query,
  where,
  orderBy,
  limit,
  setDoc,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

// Configure Quill
const Font = ReactQuill.Quill.import('formats/font') as any;
Font.whitelist = ['inter', 'serif', 'monospace', 'arial'];
ReactQuill.Quill.register(Font, true);

const quillModules = {
  toolbar: [
    [{ 'font': Font.whitelist }],
    [{ 'size': ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline'],
    [{ 'align': [] }],
    [{ 'indent': '-1' }, { 'indent': '+1' }],
    ['clean']
  ],
};

const quillFormats = [
  'font', 'size',
  'bold', 'italic', 'underline',
  'align', 'indent'
];

const DEFAULT_ITEMS = ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puertas'];

const INITIAL_SPACES_DATA = [
  { title: 'Sala / Comedor', description: 'Área social principal.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puerta Principal'] },
  { title: 'Cocina', description: 'Área de preparación de alimentos.', items: ['Mesones', 'Gabinetes', 'Estufa', 'Lavaplatos', 'Grifería', 'Tomacorrientes'] },
  { title: 'Habitación Principal', description: 'Dormitorio principal.', items: ['Paredes', 'Pisos', 'Closet', 'Ventanas', 'Puerta'] },
  { title: 'Baño Principal', description: 'Baño de la habitación principal.', items: ['Pisos', 'Tomacorrientes', 'Lavamanos', 'Espejo', 'Cabina de baño', 'Ducha', 'Sanitario'] },
  { title: 'Zona de Lavandería', description: 'Área de ropas.', items: ['Lavadero', 'Conexiones', 'Pisos', 'Paredes'] },
];

const PROPERTY_TEMPLATES: Record<string, { title: string, description: string, items: string[] }[]> = {
  'Apartamento': [
    { title: 'Alcobas (2)', description: 'Dormitorios del apartamento.', items: ['Paredes', 'Pisos', 'Closets', 'Ventanas', 'Puertas'] },
    { title: 'Baños (2)', description: 'Servicios sanitarios.', items: ['Pisos', 'Lavamanos', 'Espejos', 'Duchas', 'Sanitarios'] },
    { title: 'Sala / Comedor', description: 'Área social principal.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puerta Principal'] },
    { title: 'Balcón', description: 'Área exterior.', items: ['Pisos', 'Barandas', 'Puerta Vidriera', 'Iluminación'] },
  ],
  'Oficina': [
    { title: 'Área Libre', description: 'Espacio de trabajo principal.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puerta'] },
    { title: 'Baño', description: 'Servicio sanitario.', items: ['Pisos', 'Lavamanos', 'Espejo', 'Sanitario'] },
    { title: 'Cocineta', description: 'Área de café y snacks.', items: ['Mesón', 'Gabinetes', 'Lavaplatos', 'Grifería'] },
  ],
  'Local': [
    { title: 'Local Comercial', description: 'Área de atención al público.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Vitrina', 'Puerta Persiana'] },
    { title: 'Baño', description: 'Servicio sanitario.', items: ['Pisos', 'Lavamanos', 'Sanitario'] },
    { title: 'Depósito', description: 'Área de almacenamiento.', items: ['Pisos', 'Paredes', 'Iluminación'] },
  ],
  'Bodega': [
    { title: 'Área de Almacenamiento', description: 'Espacio principal de bodega.', items: ['Pisos de alta resistencia', 'Paredes', 'Techos', 'Iluminación Industrial'] },
    { title: 'Oficina', description: 'Área administrativa.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas'] },
    { title: 'Baño', description: 'Servicio sanitario.', items: ['Pisos', 'Lavamanos', 'Sanitario'] },
    { title: 'Muelle de Carga', description: 'Área de cargue y descargue.', items: ['Plataforma', 'Puerta Enrollable', 'Topes'] },
  ],
  'Casa': [
    { title: 'Sala', description: 'Área social principal.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puerta Principal'] },
    { title: 'Comedor', description: 'Área de comedor.', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas'] },
    { title: 'Cocina', description: 'Área de preparación de alimentos.', items: ['Mesones', 'Gabinetes', 'Estufa', 'Lavaplatos', 'Grifería', 'Tomacorrientes'] },
    { title: 'Alcobas (3)', description: 'Dormitorios de la casa.', items: ['Paredes', 'Pisos', 'Closets', 'Ventanas', 'Puertas'] },
    { title: 'Baños (2)', description: 'Servicios sanitarios.', items: ['Pisos', 'Lavamanos', 'Espejos', 'Duchas', 'Sanitarios'] },
    { title: 'Patio / Zona de Ropas', description: 'Área exterior y de lavado.', items: ['Pisos', 'Lavadero', 'Conexiones', 'Muros', 'Iluminación'] },
    { title: 'Garaje', description: 'Área de estacionamiento.', items: ['Pisos', 'Puerta de Garaje', 'Paredes', 'Iluminación'] },
  ],
};

const SPACE_TYPES_CONFIG: Record<string, { title: string, description: string, items: string[], icon: any }> = {
  'Baño': { 
    title: 'Baño', 
    description: 'Servicio sanitario y ducha.', 
    items: ['Inodoro', 'Lavamanos', 'Ducha', 'Espejo', 'Accesorios (toallero, papelera)', 'Paredes y Pisos', 'Puerta', 'Ventana/Extractor'],
    icon: Bath
  },
  'Cocina': { 
    title: 'Cocina', 
    description: 'Área de preparación de alimentos.', 
    items: ['Mesón', 'Lavaplatos', 'Estufa', 'Campana Extractora', 'Muebles Superiores', 'Muebles Inferiores', 'Paredes y Pisos', 'Grifería'],
    icon: ChefHat
  },
  'Alcoba': { 
    title: 'Alcoba', 
    description: 'Dormitorio o habitación.', 
    items: ['Puerta', 'Ventana', 'Paredes y Pisos', 'Closet', 'Interruptores y Tomas', 'Plafón/Lámpara'],
    icon: Bed
  },
  'Balcón': { 
    title: 'Balcón', 
    description: 'Área exterior o terraza.', 
    items: ['Baranda', 'Piso', 'Paredes', 'Puerta Vidriera', 'Luz'],
    icon: Sun
  },
  'Sala': { 
    title: 'Sala / Comedor', 
    description: 'Área social principal.', 
    items: ['Puerta Principal', 'Paredes y Pisos', 'Ventanas', 'Interruptores y Tomas', 'Plafón/Lámpara', 'Citófono'],
    icon: Sofa
  },
  'Patio': { 
    title: 'Patio / Zona de Ropas', 
    description: 'Área de servicios y lavandería.', 
    items: ['Lavadero', 'Piso', 'Paredes', 'Reja/Techo', 'Grifería'],
    icon: Wind
  }
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

type ViewType = 'list' | 'create' | 'detail' | 'dependents' | 'settings' | 'reception' | 'template-editor';

/**
 * Recursively cleans undefined values while preserving valid falsy values (false, 0, "", null)
 */
export const sanitizeData = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined)
      .map(item => sanitizeData(item));
  }
  const cleanObj: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      cleanObj[key] = sanitizeData(val);
    }
  }
  return cleanObj;
};

/**
 * Specifically validates and sanitizes an Inventory object for Firestore persistence.
 */
export const sanitizeInventory = (inventory: any): any => {
  if (!inventory || typeof inventory !== 'object') return inventory;
  const cleaned = sanitizeData(inventory);

  // Ensure spaces array is well-formed
  if (Array.isArray(cleaned.spaces)) {
    cleaned.spaces = cleaned.spaces.map((space: any) => ({
      id: space.id || uuidv4(),
      title: space.title || '',
      description: space.description || '',
      items: Array.isArray(space.items)
        ? space.items.map((item: any) => ({
            id: item.id || uuidv4(),
            name: item.name || '',
            condition: item.condition || 'Excelente',
            details: item.details || ''
          }))
        : [],
      photos: Array.isArray(space.photos)
        ? space.photos
            .filter((p: any) => p && typeof p === 'object' && (p.dataUrl !== undefined || p.url !== undefined || p.localBlobId !== undefined))
            .map((p: any) => {
              // Retrocompatibilidad: Solamente fotografías históricas LEGACY (sin localBlobId, sin storagePath, sin url, pero con dataUrl) pueden conservar dataUrl.
              // Para fotografías nuevas, dataUrl NUNCA se persiste en Firestore.
              const isLegacyPhoto = !p.localBlobId && !p.storagePath && (!p.url || p.url === '') && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:');
              return {
                id: p.id || uuidv4(),
                dataUrl: isLegacyPhoto ? p.dataUrl : '',
                url: p.url || '',
                ...(p.localBlobId ? { localBlobId: p.localBlobId } : {}),
                ...(p.syncStatus ? { syncStatus: p.syncStatus } : {}),
                ...(p.storagePath ? { storagePath: p.storagePath } : {}),
                timestamp: typeof p.timestamp === 'number' ? p.timestamp : Date.now()
              };
            })
        : [],
      ...(space.generalObservations !== undefined ? { generalObservations: space.generalObservations } : {})
    }));
  } else {
    cleaned.spaces = [];
  }

  // Ensure annexes array is well-formed if present
  if (Array.isArray(cleaned.annexes)) {
    cleaned.annexes = cleaned.annexes.map((annex: any) => ({
      id: annex.id || uuidv4(),
      text: annex.text || '',
      photos: Array.isArray(annex.photos)
        ? annex.photos
            .filter((p: any) => p && typeof p === 'object' && (p.dataUrl !== undefined || p.url !== undefined || p.localBlobId !== undefined))
            .map((p: any) => {
              const isLegacyPhoto = !p.localBlobId && !p.storagePath && (!p.url || p.url === '') && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:');
              return {
                id: p.id || uuidv4(),
                dataUrl: isLegacyPhoto ? p.dataUrl : '',
                url: p.url || '',
                ...(p.localBlobId ? { localBlobId: p.localBlobId } : {}),
                ...(p.syncStatus ? { syncStatus: p.syncStatus } : {}),
                ...(p.storagePath ? { storagePath: p.storagePath } : {}),
                timestamp: typeof p.timestamp === 'number' ? p.timestamp : Date.now()
              };
            })
        : [],
      createdAt: typeof annex.createdAt === 'number' ? annex.createdAt : Date.now(),
      createdBy: annex.createdBy || '',
      creatorName: annex.creatorName || ''
    }));
  }

  return cleaned;
};

/**
 * Resolves the real admin/agency email for a user
 */
export const resolveAdminEmail = (user: User | null): string | null => {
  if (!user) return null;
  if (user.role === 'admin') {
    if (user.email && user.email.trim() !== '') {
      return user.email.trim();
    }
  } else if (user.role === 'dependent') {
    if (user.adminEmail && user.adminEmail.trim() !== '') {
      return user.adminEmail.trim();
    }
  }
  // Fallback: if user.email exists, use it as adminEmail
  if (user.email && user.email.trim() !== '') {
    return user.email.trim();
  }
  return null;
};

export default function App() {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [dependents, setDependents] = useState<User[]>([]);
  const [view, setView] = useState<ViewType>('list');
  const [currentInventory, setCurrentInventory] = useState<Inventory | null>(null);
  const [receptionType, setReceptionType] = useState<'tenant' | 'owner' | null>(null);
  const [receptionText, setReceptionText] = useState('');
  const [receptionSignature, setReceptionSignature] = useState('');
  const [isSavingReception, setIsSavingReception] = useState(false);
  const [receptionSignMethod, setReceptionSignMethod] = useState<'presencial' | 'remoto'>('presencial');
  const [receptionEmail, setReceptionEmail] = useState('');
  const [receptionName, setReceptionName] = useState('');
  const [isSendingRemoteLink, setIsSendingRemoteLink] = useState(false);
  const [remoteLinkSentSuccess, setRemoteLinkSentSuccess] = useState<string | null>(null);
  const [isCopiedRemoteLink, setIsCopiedRemoteLink] = useState(false);
  const [remoteLinkStatusInfo, setRemoteLinkStatusInfo] = useState<{ status: 'sent' | 'simulated' | 'warning'; warning?: string } | null>(null);
  const [remoteSignParams, setRemoteSignParams] = useState<{ token: string; inv: string; role: string } | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('remoteSign') || params.get('token');
      const inv = params.get('inv');
      const role = params.get('role') || 'reception_tenant';
      if (token && inv) {
        return { token, inv, role };
      }
    } catch (e) {
      console.warn('Error reading url params:', e);
    }
    return null;
  });
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>({});
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'completed' | 'received' | 'archived'>('all');
  const [isListening, setIsListening] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportAccordion, setExportAccordion] = useState<'inventory' | 'reception' | null>('inventory');
  const [showDeleteCodeModal, setShowDeleteCodeModal] = useState(false);
  const [deleteCodeInput, setDeleteCodeInput] = useState('');
  const [generatedDeleteCode, setGeneratedDeleteCode] = useState('');
  const [inventoryIdToDelete, setInventoryIdToDelete] = useState<string | null>(null);
  const [selectedInventoryForExport, setSelectedInventoryForExport] = useState<Inventory | null>(null);
  const [showAnnexModal, setShowAnnexModal] = useState(false);
  const [showSpaceTypeModal, setShowSpaceTypeModal] = useState(false);
  const [annexText, setAnnexText] = useState('');
  const [annexPhotos, setAnnexPhotos] = useState<Photo[]>([]);
  const [isSavingAnnex, setIsSavingAnnex] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [selectedDependentForInventories, setSelectedDependentForInventories] = useState<User | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showEditTemplates, setShowEditTemplates] = useState(false);
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('checkinventory_theme');
      if (saved) return saved === 'dark';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  const [editAgencyName, setEditAgencyName] = useState('');
  const [editAgencyLogo, setEditAgencyLogo] = useState('');
  const [isSavingPersonalization, setIsSavingPersonalization] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [ownerTemplate, setOwnerTemplate] = useState('');
  const [tenantTemplate, setTenantTemplate] = useState('');
  const [isSavingTemplates, setIsSavingTemplates] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [signatures, setSignatures] = useState({ owner: '', tenant: '' });
  const [activeSignatureSide, setActiveSignatureSide] = useState<'owner' | 'tenant'>('owner');
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [isDownloadingPhotos, setIsDownloadingPhotos] = useState(false);
  const [showPhotosInDetail, setShowPhotosInDetail] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null);
  const [newLicenseCode, setNewLicenseCode] = useState('');
  const [licensesList, setLicensesList] = useState<License[]>([]);
  const [isGeneratingLicense, setIsGeneratingLicense] = useState(false);
  const [licenseFilter, setLicenseFilter] = useState<'all' | 'available' | 'used'>('all');
  const [licenseSearchQuery, setLicenseSearchQuery] = useState('');
  const [isActivatingCode, setIsActivatingCode] = useState(false);
  const [copiedLicenseCode, setCopiedLicenseCode] = useState<string | null>(null);
  const [userTemplates, setUserTemplates] = useState<InventoryTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<InventoryTemplate | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSpaceSelector, setShowSpaceSelector] = useState(false);
  const [showUserTemplates, setShowUserTemplates] = useState(false);

  // Mobile / Android Optimizations
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [photoSourceModal, setPhotoSourceModal] = useState<{ open: boolean; spaceId?: string; type: 'space' | 'annex' }>({ open: false, type: 'space' });
  const [fullscreenPhoto, setFullscreenPhoto] = useState<{ url: string; title: string; date?: string; spaceId?: string; photoId?: string; canDelete?: boolean; isAnnex?: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const annexCameraInputRef = useRef<HTMLInputElement>(null);
  const annexGalleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showNotify('🟢 Conexión reestablecida — Sincronizando datos con la nube', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showNotify('⚡ Modo Offline activo — Los cambios se guardan localmente', 'error');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        setView(event.state.view);
      } else {
        setView('list');
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    // Initialize history state if not present
    if (!window.history.state) {
      window.history.replaceState({ view: 'list' }, '');
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newView: ViewType) => {
    if (view === newView) return;
    setView(newView);
    window.history.pushState({ view: newView }, '');
  };

  const generateNew6MonthLicense = async () => {
    if (!currentUser || currentUser.email !== 'djbtorreglosa@gmail.com') {
      showNotify('Solo el administrador principal puede generar códigos.', 'error');
      return;
    }
    setIsGeneratingLicense(true);
    try {
      const rand1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const rand2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const generatedCode = `CHK-6M-${rand1}-${rand2}`;

      const licenseDocRef = doc(db, 'licenses', generatedCode);
      const newLicense: License = {
        code: generatedCode,
        isUsed: false,
        durationMonths: 6,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.email,
        assignedTo: null,
        assignedEmail: null,
        activatedAt: null,
        expiresAt: null
      };

      await setDoc(licenseDocRef, newLicense);
      showNotify(`Código generado: ${generatedCode}`, 'success');
    } catch (error) {
      console.error('Error generating license:', error);
      showNotify('Error al generar código de activación', 'error');
    } finally {
      setIsGeneratingLicense(false);
    }
  };

  const activateLicenseCode = async (codeToActivate: string) => {
    if (!currentUser) return;
    if (currentUser.role !== 'admin') {
      showNotify('Solo los administradores pueden activar o renovar licencias.', 'error');
      return;
    }

    const cleanedCode = codeToActivate.trim().toUpperCase();
    if (!cleanedCode) {
      showNotify('Por favor ingresa un código de activación.', 'error');
      return;
    }

    setIsActivatingCode(true);
    try {
      const licenseRef = doc(db, 'licenses', cleanedCode);
      const licenseSnap = await getDoc(licenseRef);

      if (!licenseSnap.exists()) {
        showNotify('El código de activación ingresado no existe.', 'error');
        return;
      }

      const licenseData = licenseSnap.data() as any;
      if (licenseData?.isUsed) {
        showNotify('Este código de activación ya ha sido utilizado.', 'error');
        return;
      }

      // Calculate 6 months (180 days)
      const now = new Date();
      const currentExp = currentUser.expirationDate ? new Date(currentUser.expirationDate) : now;
      const baseDate = currentExp > now ? currentExp : now;
      const newExpiration = new Date(baseDate.getTime() + 180 * 24 * 60 * 60 * 1000);
      const newExpirationIso = newExpiration.toISOString();

      const batch = writeBatch(db);

      batch.update(doc(db, 'users', currentUser.id), {
        expirationDate: newExpirationIso,
        isPremium: true,
        plan: 'license',
        licenseCode: cleanedCode,
        updatedAt: Date.now()
      });

      batch.update(licenseRef, {
        isUsed: true,
        assignedTo: currentUser.id,
        assignedEmail: currentUser.email,
        activatedAt: now.toISOString(),
        expiresAt: newExpirationIso
      });

      await batch.commit();

      setCurrentUser(prev => prev ? ({
        ...prev,
        expirationDate: newExpirationIso,
        isPremium: true,
        plan: 'license',
        licenseCode: cleanedCode
      }) : null);

      setNewLicenseCode('');
      showNotify(`¡Licencia de 6 meses activada con éxito! Válida hasta ${format(newExpiration, 'dd/MM/yyyy')}`, 'success');
    } catch (error) {
      console.error('Error activating license code:', error);
      showNotify('Error al activar el código de licencia', 'error');
    } finally {
      setIsActivatingCode(false);
    }
  };

  const toggleDependentStatus = async (dependent: User) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para gestionar dependientes.', 'error');
      navigateTo('settings');
      return;
    }
    const isSuperAdmin = currentUser?.email === 'djbtorreglosa@gmail.com';
    if (currentUser?.role !== 'admin' || (!isSuperAdmin && dependent.adminEmail !== currentUser.email)) return;
    
    const newStatus = !dependent.isActive;
    try {
      await updateDoc(doc(db, 'users', dependent.id), {
        isActive: newStatus,
        updatedAt: Date.now()
      });

      // Synchronize with server backend to revoke refresh tokens if deactivating
      try {
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          await fetch('/api/users/update-status', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              targetUid: dependent.id,
              isActive: newStatus
            })
          });
        }
      } catch (syncErr) {
        console.warn('Notice syncing dependent status with server:', syncErr);
      }

      showNotify(`Dependiente ${newStatus ? 'activado' : 'desactivado'} con éxito`);
    } catch (error) {
      console.error('Error toggling dependent status:', error);
      showNotify('Error al cambiar el estado del dependiente', 'error');
    }
  };

  const deleteDependent = async (dependent: User) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para gestionar dependientes.', 'error');
      navigateTo('settings');
      return;
    }
    const isSuperAdmin = currentUser?.email === 'djbtorreglosa@gmail.com';
    if (currentUser?.role !== 'admin' || (!isSuperAdmin && dependent.adminEmail !== currentUser.email)) return;
    
    setShowConfirm({
      show: true,
      title: 'Eliminar Dependiente',
      message: `¿Estás seguro de eliminar a ${dependent.firstName} ${dependent.lastName}? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'users', dependent.id), {
            isDeleted: true,
            isActive: false,
            updatedAt: Date.now()
          });

          // Synchronize with server backend to revoke session tokens
          try {
            if (auth.currentUser) {
              const token = await auth.currentUser.getIdToken();
              await fetch('/api/users/update-status', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  targetUid: dependent.id,
                  isDeleted: true,
                  isActive: false
                })
              });
            }
          } catch (syncErr) {
            console.warn('Notice syncing dependent deletion with server:', syncErr);
          }

          showNotify('Dependiente eliminado con éxito');
          setShowConfirm({ show: false, title: '', message: '', onConfirm: () => {} });
        } catch (error) {
          console.error('Error deleting dependent:', error);
          showNotify('Error al eliminar el dependiente', 'error');
        }
      }
    });
  };

  const saveUserTemplate = async (template: Partial<InventoryTemplate>) => {
    if (!currentUser) return;
    setIsSavingTemplate(true);
    try {
      const templateData = {
        ...template,
        createdBy: currentUser.id,
        createdAt: template.createdAt || Date.now(),
      };

      if (template.id) {
        await updateDoc(doc(db, 'templates', template.id), templateData);
        showNotify('Plantilla actualizada con éxito');
      } else {
        const newDoc = doc(collection(db, 'templates'));
        await setDoc(newDoc, { ...templateData, id: newDoc.id });
        showNotify('Plantilla creada con éxito');
      }
      setEditingTemplate(null);
      navigateTo('settings');
    } catch (error) {
      console.error('Error saving template:', error);
      showNotify('Error al guardar la plantilla', 'error');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const deleteUserTemplate = async (templateId: string) => {
    setShowConfirm({
      show: true,
      title: 'Eliminar Plantilla',
      message: '¿Estás seguro de eliminar esta plantilla? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'templates', templateId));
          showNotify('Plantilla eliminada con éxito');
          setShowConfirm({ ...showConfirm, show: false });
        } catch (error) {
          console.error('Error deleting template:', error);
          showNotify('Error al eliminar la plantilla', 'error');
        }
      }
    });
  };

  const duplicateUserTemplate = async (template: InventoryTemplate) => {
    try {
      const newDoc = doc(collection(db, 'templates'));
      const duplicatedData = {
        ...template,
        id: newDoc.id,
        templateName: `${template.templateName} (Copia)`,
        createdAt: Date.now()
      };
      await setDoc(newDoc, duplicatedData);
      showNotify('Plantilla duplicada con éxito');
    } catch (error) {
      console.error('Error duplicating template:', error);
      showNotify('Error al duplicar la plantilla', 'error');
    }
  };

  const applyTemplateToInventory = (template: InventoryTemplate | string) => {
    if (!currentInventory) return;
    if (currentInventory.status !== 'draft') {
      showNotify('No se puede aplicar una plantilla a un inventario firmado o archivado.', 'error');
      return;
    }

    let newSpaces: InventorySpace[] = [];

    if (typeof template === 'string') {
      // Default templates
      const defaultTemplate = PROPERTY_TEMPLATES[template as keyof typeof PROPERTY_TEMPLATES];
      if (defaultTemplate) {
        newSpaces = defaultTemplate.map(s => ({
          id: uuidv4(),
          title: s.title,
          description: s.description,
          photos: [],
          items: s.items.map(itemName => ({
            id: uuidv4(),
            name: itemName,
            condition: 'Excelente',
            details: ''
          }))
        }));
      }
    } else {
      // Custom user templates
      newSpaces = template.structure.map(s => ({
        id: uuidv4(),
        title: s.title,
        description: '',
        photos: [],
        items: s.elements.map(elName => ({
          id: uuidv4(),
          name: elName,
          condition: 'Excelente',
          details: ''
        }))
      }));
    }

    if (newSpaces.length > 0) {
      setCurrentInventory({
        ...currentInventory,
        propertyType: typeof template === 'string' ? (template as any) : template.propertyType,
        spaces: newSpaces
      });
      showNotify('Plantilla aplicada con éxito');
    }
    setShowTemplateSelector(false);
  };

  const handleAddPredefinedSpace = (spaceData: { title: string, items: string[] }) => {
    if (!editingTemplate) return;
    
    const newSpace: TemplateSpace = {
      id: uuidv4(),
      title: spaceData.title,
      elements: [...spaceData.items]
    };
    
    setEditingTemplate({
      ...editingTemplate,
      structure: [...editingTemplate.structure, newSpace]
    });
    setShowSpaceSelector(false);
    showNotify(`Espacio "${spaceData.title}" añadido`);
  };

  const getPropertyIcon = (type: string) => {
    switch (type) {
      case 'Apartamento': return <Building2 size={20} />;
      case 'Casa': return <Home size={20} />;
      case 'Oficina': return <Briefcase size={20} />;
      case 'Local': return <Store size={20} />;
      case 'Bodega': return <Warehouse size={20} />;
      default: return <ClipboardList size={20} />;
    }
  };

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for quota exceeded
    if (errorMessage.toLowerCase().includes('quota exceeded') || errorMessage.toLowerCase().includes('quota limit exceeded')) {
      showNotify('Límite de uso diario alcanzado (Quota Exceeded). El servicio se restablecerá mañana o puedes activar el plan Blaze en la consola de Firebase para eliminar este límite.', 'error');
    } else {
      showNotify(`Error en Firestore (${operationType} en ${path || 'recurso'}): ${errorMessage}`, 'error');
    }

    const errInfo = {
      error: errorMessage,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  };

  // Handle direct photo download from PDF link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const downloadId = params.get('downloadPhotos');
    
    if (downloadId && isAuthReady) {
      const triggerDownload = async () => {
        setIsDownloadingPhotos(true);
        try {
          const invDoc = await getDoc(doc(db, 'inventories', downloadId));
          if (invDoc.exists()) {
            const inventory = invDoc.data() as Inventory;
            // Clear the param from URL to avoid repeated downloads
            const newUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
            
            await downloadPhotosZip(inventory);
          } else {
            showNotify('Inventario no encontrado', 'error');
          }
        } catch (error) {
          console.error('Error downloading photos from link:', error);
          showNotify('Error al descargar las fotos', 'error');
        } finally {
          setIsDownloadingPhotos(false);
        }
      };
      triggerDownload();
    }
  }, [isAuthReady]);

  // Poll for email verification
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentUser && !isEmailVerified) {
      interval = setInterval(async () => {
        if (auth.currentUser) {
          try {
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
              setIsEmailVerified(true);
              // Update currentUser state to reflect verification if needed
              setCurrentUser(prev => prev ? { ...prev } : null);
            }
          } catch (error) {
            console.error('Error polling verification:', error);
          }
        }
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser?.id, isEmailVerified]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // If not verified, try one reload to see if they just verified in another tab
        if (!firebaseUser.emailVerified && firebaseUser.email !== 'djbtorreglosa@gmail.com') {
          try {
            await firebaseUser.reload();
          } catch (e) {
            console.error('Error reloading user in listener:', e);
          }
        }

        const updatedUser = auth.currentUser || firebaseUser;
        // Bypass verification for default admin
        setIsEmailVerified(updatedUser.emailVerified || updatedUser.email === 'djbtorreglosa@gmail.com');
        
        let userDoc = await getDoc(doc(db, 'users', updatedUser.uid));
        
        // Retry if doc not found (to handle race condition during registration)
        if (!userDoc.exists()) {
          console.log('User doc not found, retrying in 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          userDoc = await getDoc(doc(db, 'users', updatedUser.uid));
        }

        if (userDoc.exists()) {
          console.log('User document found in Firestore:', userDoc.data());
          const userData = userDoc.data();
          if (userData.isDeleted) {
            await signOut(auth);
            showNotify('Tu cuenta ha sido eliminada.', 'error');
            return;
          }

          let adminExpirationDate = undefined;
          let adminPlan = undefined;
          let adminUid = userData.adminUid;
          let adminName = undefined;
          let adminOwnerTemplate = undefined;
          let adminTenantTemplate = undefined;
          let adminAgencyLogo = undefined;
          let adminAgencyName = undefined;

          if (userData.role === 'dependent' && userData.adminEmail) {
            try {
              const q = query(collection(db, 'users'), where('email', '==', userData.adminEmail), where('role', '==', 'admin'));
              const querySnapshot = await getDocs(q);
              if (!querySnapshot.empty) {
                const adminDoc = querySnapshot.docs[0];
                const adminData = adminDoc.data();
                adminExpirationDate = adminData.expirationDate;
                adminPlan = adminData.plan;
                adminName = `${adminData.firstName} ${adminData.lastName}`.trim();
                adminOwnerTemplate = adminData.ownerTemplate;
                adminTenantTemplate = adminData.tenantTemplate;
                adminAgencyLogo = adminData.agencyLogo;
                adminAgencyName = adminData.agencyName;
                if (!adminUid) {
                  adminUid = adminDoc.id;
                  // Save it to the user document for future use
                  try {
                    await updateDoc(doc(db, 'users', updatedUser.uid), { adminUid });
                  } catch (updateErr) {
                    console.error('Error updating user with adminUid:', updateErr);
                  }
                }
              }
            } catch (err) {
              console.error('Error fetching admin subscription:', err);
            }
          }

          const resolvedDarkMode = userData.isDarkMode !== undefined 
            ? userData.isDarkMode 
            : (localStorage.getItem('checkinventory_theme') === 'dark');

          if (resolvedDarkMode) {
            document.documentElement.classList.add('dark');
            document.body.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
            document.body.classList.remove('dark');
          }
          setIsDarkMode(resolvedDarkMode);

          const newUser = {
            id: updatedUser.uid,
            email: updatedUser.email!,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            role: userData.role,
            adminEmail: userData.adminEmail,
            adminUid: adminUid,
            adminName: adminName,
            isPremium: userData.isPremium,
            plan: userData.plan,
            expirationDate: userData.expirationDate,
            adminExpirationDate,
            adminPlan,
            licenseCode: userData.licenseCode,
            isActive: userData.isActive !== false,
            isDeleted: userData.isDeleted || false,
            agencyLogo: userData.role === 'admin' ? userData.agencyLogo : (adminAgencyLogo || userData.agencyLogo),
            agencyName: userData.role === 'admin' ? userData.agencyName : (adminAgencyName || userData.agencyName),
            isDarkMode: resolvedDarkMode,
            ownerTemplate: userData.role === 'admin' ? userData.ownerTemplate : adminOwnerTemplate,
            tenantTemplate: userData.role === 'admin' ? userData.tenantTemplate : adminTenantTemplate
          } as User;

          setEditAgencyLogo(newUser.agencyLogo || '');
          setEditAgencyName(newUser.agencyName || '');

          setCurrentUser(prev => {
            if (JSON.stringify(prev) === JSON.stringify(newUser)) return prev;
            return newUser;
          });

          // Initialize template states
          const defaultOwnerHtml = `<p>Yo, como propietario, dejo constancia de haber recibido el inmueble ubicado en <b>{direccion}</b>, en las condiciones descritas en el inventario adjunto, junto con las llaves correspondientes.</p>`;
          const defaultTenantHtml = `<p>Yo, como inquilino, hago entrega del inmueble ubicado en <b>{direccion}</b>, en las condiciones pactadas, realizando la devolución de las llaves al propietario.</p>`;

          const finalOwnerTemplate = (userData.role === 'admin' ? userData.ownerTemplate : adminOwnerTemplate) || defaultOwnerHtml;
          const finalTenantTemplate = (userData.role === 'admin' ? userData.tenantTemplate : adminTenantTemplate) || defaultTenantHtml;
          
          setOwnerTemplate(finalOwnerTemplate);
          setTenantTemplate(finalTenantTemplate);
        } else {
          console.warn('User document NOT found in Firestore for UID:', updatedUser.uid, '- Auto-healing document in database...');
          const isSuper = updatedUser.email === 'djbtorreglosa@gmail.com';
          const expiration = new Date();
          if (isSuper) {
            expiration.setFullYear(expiration.getFullYear() + 10);
          } else {
            expiration.setDate(expiration.getDate() + 180);
          }

          const autoResolvedDarkMode = localStorage.getItem('checkinventory_theme') === 'dark';
          const defaultOwnerHtml = `<p>Yo, como propietario, dejo constancia de haber recibido el inmueble ubicado en <b>{direccion}</b>, en las condiciones descritas en el inventario adjunto, junto con las llaves correspondientes.</p>`;
          const defaultTenantHtml = `<p>Yo, como inquilino, hago entrega del inmueble ubicado en <b>{direccion}</b>, en las condiciones pactadas, realizando la devolución de las llaves al propietario.</p>`;

          const userData = {
            email: updatedUser.email || '',
            firstName: isSuper ? 'Admin' : (updatedUser.displayName ? updatedUser.displayName.split(' ')[0] : 'Usuario'),
            lastName: isSuper ? 'Principal' : (updatedUser.displayName ? updatedUser.displayName.split(' ').slice(1).join(' ') : ''),
            role: 'admin' as const,
            adminEmail: null,
            adminUid: null,
            adminName: null,
            hasSeenOnboarding: isSuper,
            createdAt: new Date().toISOString(),
            isPremium: true,
            plan: 'license',
            expirationDate: expiration.toISOString(),
            isActive: true,
            isDeleted: false,
          };

          try {
            await setDoc(doc(db, 'users', updatedUser.uid), userData, { merge: true });
            const newUser = {
              id: updatedUser.uid,
              ...userData,
              isDarkMode: autoResolvedDarkMode,
              ownerTemplate: defaultOwnerHtml,
              tenantTemplate: defaultTenantHtml
            } as User;

            setOwnerTemplate(defaultOwnerHtml);
            setTenantTemplate(defaultTenantHtml);
            setCurrentUser(newUser);
            console.log('User document auto-repaired and created successfully in Firestore');
          } catch (error) {
            console.error('Error auto-creating user document in Firestore:', error);
            setCurrentUser(null);
          }
        }

        // Synchronize Custom Claims for Multi-Tenant Storage and Firestore isolation
        try {
          const rawToken = await updatedUser.getIdToken();
          const syncRes = await fetch('/api/auth/sync-claims', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${rawToken}`
            }
          });
          if (syncRes.ok) {
            // Force refresh client token so custom claims are active immediately in SDK
            await updatedUser.getIdToken(true);
          }
        } catch (syncErr) {
          console.warn('Notice syncing security claims with server:', syncErr);
        }
      } else {
        setCurrentUser(null);
        setIsEmailVerified(true);
      }
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Photo Sync Engine Lifecycle: Multi-tenant and session-scoped
  useEffect(() => {
    if (!currentUser || !isAuthReady) {
      PhotoSyncEngine.getInstance().stop();
      return;
    }

    const tenantAdminUid = currentUser.role === 'admin'
      ? currentUser.id
      : (currentUser.adminUid || currentUser.id);

    if (tenantAdminUid) {
      PhotoSyncEngine.getInstance().start(tenantAdminUid, currentUser.id);
    }

    const unsubscribeSync = PhotoSyncEngine.getInstance().subscribe((event) => {
      if (event.type === 'photo_synced' && event.photoId && event.url) {
        // Optimistically update local current inventory state if matching photo exists
        setCurrentInventory(prev => {
          if (!prev) return null;
          let changed = false;
          const updatedSpaces = (prev.spaces || []).map(s => {
            const hasPhoto = (s.photos || []).some(p => p.id === event.photoId || p.localBlobId === event.photoId);
            if (!hasPhoto) return s;
            changed = true;
            return {
              ...s,
              photos: (s.photos || []).map(p => {
                if (p.id === event.photoId || p.localBlobId === event.photoId) {
                  return { ...p, url: event.url, dataUrl: '', syncStatus: 'synced' as const };
                }
                return p;
              })
            };
          });

          const updatedAnnexes = (prev.annexes || []).map(a => {
            const hasPhoto = (a.photos || []).some(p => p.id === event.photoId || p.localBlobId === event.photoId);
            if (!hasPhoto) return a;
            changed = true;
            return {
              ...a,
              photos: (a.photos || []).map(p => {
                if (p.id === event.photoId || p.localBlobId === event.photoId) {
                  return { ...p, url: event.url, dataUrl: '', syncStatus: 'synced' as const };
                }
                return p;
              })
            };
          });

          if (!changed) return prev;
          return { ...prev, spaces: updatedSpaces, annexes: updatedAnnexes };
        });

        // Actualización desacoplada de la lista de inventarios (evita nested setState en React 19)
        setInventories(invs => invs.map(inv => {
          if (inv.id !== event.inventoryId) return inv;
          let changed = false;
          const updatedSpaces = (inv.spaces || []).map(s => {
            const hasPhoto = (s.photos || []).some(p => p.id === event.photoId || p.localBlobId === event.photoId);
            if (!hasPhoto) return s;
            changed = true;
            return {
              ...s,
              photos: (s.photos || []).map(p => {
                if (p.id === event.photoId || p.localBlobId === event.photoId) {
                  return { ...p, url: event.url, dataUrl: '', syncStatus: 'synced' as const };
                }
                return p;
              })
            };
          });

          const updatedAnnexes = (inv.annexes || []).map(a => {
            const hasPhoto = (a.photos || []).some(p => p.id === event.photoId || p.localBlobId === event.photoId);
            if (!hasPhoto) return a;
            changed = true;
            return {
              ...a,
              photos: (a.photos || []).map(p => {
                if (p.id === event.photoId || p.localBlobId === event.photoId) {
                  return { ...p, url: event.url, dataUrl: '', syncStatus: 'synced' as const };
                }
                return p;
              })
            };
          });

          if (!changed) return inv;
          return { ...inv, spaces: updatedSpaces, annexes: updatedAnnexes };
        }));
      }
    });

    return () => {
      unsubscribeSync();
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.adminUid, isAuthReady]);

  useEffect(() => {
    if (view === 'settings' && currentUser) {
      setEditFirstName(currentUser.firstName || '');
      setEditLastName(currentUser.lastName || '');
      setEditAgencyName(currentUser.agencyName || '');
      setEditAgencyLogo(currentUser.agencyLogo || '');
    }
  }, [view, currentUser]);

  const toggleDarkMode = async (overrideMode?: boolean) => {
    const nextMode = overrideMode !== undefined ? overrideMode : !isDarkMode;
    setIsDarkMode(nextMode);
    try {
      localStorage.setItem('checkinventory_theme', nextMode ? 'dark' : 'light');
      if (nextMode) {
        document.documentElement.classList.add('dark');
        document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('dark');
      }
    } catch (e) {
      console.error('Error saving local theme:', e);
    }

    if (currentUser) {
      try {
        await updateDoc(doc(db, 'users', currentUser.id), {
          isDarkMode: nextMode,
          updatedAt: Date.now()
        });
        setCurrentUser(prev => prev ? { ...prev, isDarkMode: nextMode } : null);
      } catch (err) {
        console.error('Error syncing theme preference to Firestore:', err);
      }
    }
  };

  const compressAgencyLogo = (img: HTMLImageElement, initialMaxDim: number = 450): string => {
    let maxDim = initialMaxDim;
    const width = img.naturalWidth || img.width || 1;
    const height = img.naturalHeight || img.height || 1;
    const ratio = width / height;

    const canvas = document.createElement('canvas');
    let dataUrl = '';

    for (let attempt = 0; attempt < 4; attempt++) {
      let targetW = width;
      let targetH = height;

      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetW = maxDim;
          targetH = Math.round(maxDim / ratio);
        } else {
          targetH = maxDim;
          targetW = Math.round(maxDim * ratio);
        }
      }

      canvas.width = Math.max(1, targetW);
      canvas.height = Math.max(1, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) break;

      ctx.clearRect(0, 0, targetW, targetH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);

      dataUrl = canvas.toDataURL('image/png');
      // Under ~250KB base64 is completely safe for Firestore (1MB limit) and PDF rendering
      if (dataUrl.length < 250000 || maxDim <= 180) {
        break;
      }
      maxDim = Math.round(maxDim * 0.75);
    }

    return dataUrl;
  };

  const handleSavePersonalization = async () => {
    if (!currentUser) return;
    setIsSavingPersonalization(true);
    try {
      let logoToSave = editAgencyLogo;
      if (logoToSave && logoToSave.length > 250000) {
        try {
          const tempImg = new Image();
          tempImg.src = logoToSave;
          await new Promise<void>((resolve) => {
            tempImg.onload = () => resolve();
            tempImg.onerror = () => resolve();
          });
          logoToSave = compressAgencyLogo(tempImg, 400);
          setEditAgencyLogo(logoToSave);
        } catch (e) {
          console.warn('Error optimizing logo before saving:', e);
        }
      }

      const updatePayload: any = {
        agencyName: editAgencyName.trim(),
        agencyLogo: logoToSave,
        isDarkMode: isDarkMode,
        updatedAt: Date.now()
      };

      await updateDoc(doc(db, 'users', currentUser.id), updatePayload);
      setCurrentUser(prev => prev ? {
        ...prev,
        agencyName: editAgencyName.trim(),
        agencyLogo: logoToSave,
        isDarkMode: isDarkMode
      } : null);

      showNotify('Personalización guardada con éxito', 'success');
    } catch (err) {
      console.error('Error saving personalization:', err);
      showNotify('Error al guardar la personalización', 'error');
    } finally {
      setIsSavingPersonalization(false);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotify('Por favor seleccione un archivo de imagen válido (PNG, JPG, SVG, WebP).', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showNotify('La imagen no debe superar los 10MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const dataUrl = compressAgencyLogo(img, 450);
        setEditAgencyLogo(dataUrl);
        showNotify('Logo cargado y optimizado. Recuerda guardar los cambios para aplicarlo a los PDFs.', 'success');
      };
      img.onerror = () => {
        showNotify('No se pudo procesar la imagen seleccionada.', 'error');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const handleRemoveLogo = () => {
    setEditAgencyLogo('');
    showNotify('Logo eliminado. Guarda los cambios para actualizar los documentos.', 'info');
  };

  // Keep currentInventory in sync with inventories list in real-time
  useEffect(() => {
    if (currentInventory) {
      const updated = inventories.find(i => i.id === currentInventory.id);
      if (updated) {
        const isChanged = 
          updated.updatedAt !== currentInventory.updatedAt ||
          updated.ownerDeliverySignature !== currentInventory.ownerDeliverySignature ||
          updated.tenantReceiveSignature !== currentInventory.tenantReceiveSignature ||
          updated.ownerSignature !== currentInventory.ownerSignature ||
          updated.tenantSignature !== currentInventory.tenantSignature ||
          updated.status !== currentInventory.status ||
          updated.ownerRemoteSigned !== currentInventory.ownerRemoteSigned ||
          updated.tenantRemoteSigned !== currentInventory.tenantRemoteSigned ||
          JSON.stringify(updated.remoteSigningTokens) !== JSON.stringify(currentInventory.remoteSigningTokens);

        if (isChanged) {
          setCurrentInventory(updated);
        }
      }
    }
  }, [inventories, currentInventory]);

  // Keep selectedInventoryForExport in sync in real-time
  useEffect(() => {
    if (selectedInventoryForExport) {
      const updated = inventories.find(i => i.id === selectedInventoryForExport.id);
      if (updated && (
        updated.updatedAt !== selectedInventoryForExport.updatedAt ||
        updated.ownerDeliverySignature !== selectedInventoryForExport.ownerDeliverySignature ||
        updated.tenantReceiveSignature !== selectedInventoryForExport.tenantReceiveSignature ||
        updated.ownerSignature !== selectedInventoryForExport.ownerSignature ||
        updated.tenantSignature !== selectedInventoryForExport.tenantSignature
      )) {
        setSelectedInventoryForExport(updated);
      }
    }
  }, [inventories, selectedInventoryForExport]);

  // Firestore Listener for Dependents (Admin only)
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin' || !isAuthReady) {
      setDependents([]);
      return;
    }

    const q = query(
      collection(db, 'users'),
      where('role', '==', 'dependent'),
      where('adminEmail', '==', currentUser.email),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deps = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as User))
        .filter(d => !d.isDeleted);
      setDependents(deps);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return unsubscribe;
  }, [currentUser?.email, currentUser?.role, isAuthReady]);

  // Firestore Listener for Templates
  useEffect(() => {
    if (!currentUser || !isAuthReady) {
      setUserTemplates([]);
      return;
    }

    const q = query(
      collection(db, 'templates'),
      where('createdBy', '==', currentUser.id),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InventoryTemplate[];
      setUserTemplates(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'templates');
    });

    return unsubscribe;
  }, [currentUser?.id, isAuthReady]);

  // Firestore Listener for Licenses (Super Admin only)
  useEffect(() => {
    if (!currentUser || currentUser.email !== 'djbtorreglosa@gmail.com' || !isAuthReady) {
      setLicensesList([]);
      return;
    }

    const q = query(
      collection(db, 'licenses'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as License[];
      setLicensesList(data);
    }, (error) => {
      console.error('Error listening to licenses:', error);
    });

    return unsubscribe;
  }, [currentUser?.email, isAuthReady]);

  // Firestore Listener for Inventories
  useEffect(() => {
    if (!currentUser || !isAuthReady) {
      setInventories([]);
      return;
    }

    // Admin sees all inventories they created or where they are the adminEmail
    // Dependent sees only inventories they created
    // We limit to 100 most recent to save quota
    let q;
    if (currentUser.role === 'admin') {
      q = query(
        collection(db, 'inventories'), 
        where('adminEmail', '==', currentUser.email),
        orderBy('updatedAt', 'desc'),
        limit(100)
      );
    } else {
      q = query(
        collection(db, 'inventories'), 
        where('createdBy', '==', currentUser.id),
        orderBy('updatedAt', 'desc'),
        limit(100)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Inventory[];
      PhotoSyncEngine.getInstance().setPersistedInventories(data.map(d => d.id));
      setInventories(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventories');
    });

    return unsubscribe;
  }, [currentUser?.id, currentUser?.email, currentUser?.role, isAuthReady]);

  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showNotify = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success', duration: number = 3500) => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ show: true, message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimeoutRef.current = null;
    }, duration);
  };

  const getPhotoDataForZip = async (photo: Photo): Promise<{ type: 'blob', blob: Blob } | { type: 'base64', data: string } | null> => {
    if (photo.localBlobId) {
      try {
        const blob = await getPhotoBlob(photo.localBlobId);
        if (blob) return { type: 'blob', blob };
      } catch (e) {
        console.warn('Error reading blob from IndexedDB for ZIP:', e);
      }
    }
    const targetUrl = photo.url || (photo.dataUrl?.startsWith('http') ? photo.dataUrl : null);
    if (targetUrl) {
      try {
        const response = await fetch(targetUrl);
        if (response.ok) {
          const blob = await response.blob();
          return { type: 'blob', blob };
        }
      } catch (e) {
        console.warn('Error fetching photo URL for ZIP:', e);
      }
    }
    if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
      const base64Data = photo.dataUrl.split(',')[1];
      if (base64Data) {
        return { type: 'base64', data: base64Data };
      }
    }
    return null;
  };

  const downloadPhotosZip = async (inventory: Inventory) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para descargar las fotos.', 'error');
      navigateTo('settings');
      return;
    }
    const zip = new JSZip();
    const propertyFolder = zip.folder(`Fotos_${inventory.propertyName.replace(/\s+/g, '_')}`);
    
    if (!propertyFolder) return;

    for (const space of inventory.spaces) {
      if (space.photos.length > 0) {
        const spaceFolderName = space.title.replace(/[/\\?%*:|"<>]/g, '-');
        const spaceFolder = propertyFolder.folder(spaceFolderName);
        
        if (!spaceFolder) continue;

        for (let i = 0; i < space.photos.length; i++) {
          const photo = space.photos[i];
          const photoData = await getPhotoDataForZip(photo);
          const fileName = `foto_${i + 1}_${photo.id.substring(0, 5)}.jpg`;
          if (photoData?.type === 'blob') {
            spaceFolder.file(fileName, photoData.blob);
          } else if (photoData?.type === 'base64') {
            spaceFolder.file(fileName, photoData.data, { base64: true });
          }
        }
      }
    }

    // Add Annex photos if they exist
    if (inventory.annexes && inventory.annexes.length > 0) {
      const annexFolder = propertyFolder.folder('Anexos');
      if (annexFolder) {
        let photoCounter = 1;
        for (const annex of inventory.annexes) {
          for (const photo of annex.photos) {
            const photoData = await getPhotoDataForZip(photo);
            const fileName = `anexo_foto_${photoCounter}_${photo.id.substring(0, 5)}.jpg`;
            if (photoData?.type === 'blob') {
              annexFolder.file(fileName, photoData.blob);
            } else if (photoData?.type === 'base64') {
              annexFolder.file(fileName, photoData.data, { base64: true });
            }
            photoCounter++;
          }
        }
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `Fotos_Inventario_${inventory.propertyName.replace(/\s+/g, '_')}.zip`);
    showNotify('Fotos descargadas correctamente');
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    setShowConfirm({ show: true, title, message, onConfirm });
  };

  const startListening = (spaceIndex: number, itemIndex: number, itemId: string, isGeneralObservation: boolean = false) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      showNotify('Su navegador no soporta el dictado por voz.', 'error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(itemId);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (currentInventory) {
        const updated = [...currentInventory.spaces];
        if (isGeneralObservation) {
          const currentObs = updated[spaceIndex].generalObservations || '';
          updated[spaceIndex].generalObservations = currentObs ? `${currentObs} ${transcript}` : transcript;
        } else {
          const currentDetails = updated[spaceIndex].items[itemIndex].details;
          updated[spaceIndex].items[itemIndex].details = currentDetails ? `${currentDetails} ${transcript}` : transcript;
        }
        setCurrentInventory({...currentInventory, spaces: updated});
        showNotify('Texto dictado añadido');
      }
      setIsListening(null);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(null);
      if (event.error === 'not-allowed') {
        showNotify('Permiso de micrófono denegado', 'error');
      } else {
        showNotify('Error en el reconocimiento de voz', 'error');
      }
    };

    recognition.onend = () => {
      setIsListening(null);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
      setIsListening(null);
    }
  };

  const saveInventory = async (inventory: Inventory): Promise<boolean> => {
    if (!currentUser) {
      showNotify('Debe estar autenticado para guardar', 'error');
      return false;
    }

    const effectiveAdminEmail = resolveAdminEmail(currentUser);
    if (!effectiveAdminEmail) {
      showNotify('No se pudo identificar la agencia administradora. Verifique su perfil de usuario.', 'error');
      return false;
    }

    try {
      const cleanInventory = sanitizeInventory(inventory);
      const inventoryId = cleanInventory.id || uuidv4();
      const { id: _, ...data } = cleanInventory;
      
      // Check for internalCode uniqueness among non-archived inventories (only if provided and not empty)
      if (data.internalCode && typeof data.internalCode === 'string' && data.internalCode.trim() !== '') {
        const duplicate = inventories.find(i => 
          i.id !== inventoryId && 
          i.internalCode === data.internalCode.trim() && 
          i.status !== 'archived'
        );
        
        if (duplicate) {
          showNotify(`El código interno "${data.internalCode}" ya está en uso por un inventario activo (${duplicate.propertyName}). Archívelo o elimínelo para reutilizar el código.`, 'error');
          return false;
        }
      }

      const inventoryRef = doc(db, 'inventories', inventoryId);
      const existingInventory = inventories.find(i => i.id === inventoryId);
      
      if (!existingInventory) {
        const newDocData = sanitizeInventory({
          ...data,
          id: inventoryId,
          createdBy: currentUser.id,
          creatorName: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email || 'Usuario',
          adminEmail: effectiveAdminEmail,
          createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
          updatedAt: Date.now()
        });

        await setDoc(inventoryRef, newDocData);
      } else {
        const existingData = existingInventory;
        
        // Strict immutability check: Completed or archived documents cannot have core data altered
        if (existingData?.status === 'completed' || existingData?.status === 'archived') {
          if (data.status === 'draft') {
            showNotify('Un documento firmado no puede ser revertido a borrador ni modificado.', 'error');
            return false;
          }
          // Build safe payload for completed document updates (annexes, archiving, or reception act signatures)
          const safeUpdate: any = {
            updatedAt: Date.now()
          };
          if (data.annexes) safeUpdate.annexes = data.annexes;
          if (data.status === 'archived') safeUpdate.status = 'archived';
          if (data.tenantReceiveDate) safeUpdate.tenantReceiveDate = data.tenantReceiveDate;
          if (data.tenantReceiveText) safeUpdate.tenantReceiveText = data.tenantReceiveText;
          if (data.tenantReceiveSignature && !existingData.tenantReceiveSignature) {
            safeUpdate.tenantReceiveSignature = data.tenantReceiveSignature;
          }
          if (data.ownerDeliveryDate) safeUpdate.ownerDeliveryDate = data.ownerDeliveryDate;
          if (data.ownerDeliveryText) safeUpdate.ownerDeliveryText = data.ownerDeliveryText;
          if (data.ownerDeliverySignature && !existingData.ownerDeliverySignature) {
            safeUpdate.ownerDeliverySignature = data.ownerDeliverySignature;
          }
          
          await updateDoc(inventoryRef, sanitizeData(safeUpdate));
          PhotoSyncEngine.getInstance().markInventoryPersisted(inventoryId);
          // R1: Sincronización desacoplada en segundo plano sin bloquear UI
          photoSyncEngine.triggerSync().catch(err => {
            console.warn('[SyncEngine] Error en background triggerSync:', err);
          });
          showNotify('Actualización guardada correctamente', 'success');
          return true;
        }

        // Prepare update data, preserving immutable identifiers exactly as stored
        const { createdBy, adminEmail, createdAt, ...updateData } = data;
        
        const updateDocData = sanitizeInventory({
          ...updateData,
          id: inventoryId,
          createdBy: existingData?.createdBy || currentUser.id,
          creatorName: existingData?.creatorName || data.creatorName || `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email || 'Usuario',
          adminEmail: existingData?.adminEmail || effectiveAdminEmail,
          createdAt: typeof existingData?.createdAt === 'number' ? existingData.createdAt : (typeof createdAt === 'number' ? createdAt : Date.now()),
          updatedAt: Date.now()
        });

        await setDoc(inventoryRef, updateDocData, { merge: true });
      }

      // R1: Registrar inventario como persistido y disparar sincronización ordenada de fotos pendientes
      PhotoSyncEngine.getInstance().markInventoryPersisted(inventoryId);
      photoSyncEngine.triggerSync().catch(err => {
        console.warn('[SyncEngine] Error en background triggerSync:', err);
      });
      
      showNotify('Inventario guardado correctamente', 'success');
      return true;
    } catch (error) {
      console.error('Error in saveInventory:', error);
      showNotify('Error al guardar el inventario', 'error');
      handleFirestoreError(error, OperationType.WRITE, `inventories/${inventory.id || 'new'}`);
      return false;
    }
  };

  const handleGoHome = async () => {
    if (view === 'list') return;
    
    if (view === 'create' && currentInventory && currentInventory.status === 'draft') {
      const isBasicallyEmpty = !currentInventory.propertyName.trim() && 
                              !currentInventory.address.trim() && 
                              !currentInventory.ownerName?.trim() && 
                              !currentInventory.tenantName?.trim() &&
                              !currentInventory.internalCode?.trim();
      
      if (!isBasicallyEmpty && currentInventory.propertyName.trim() && currentInventory.address.trim()) {
        const saved = await saveInventory(currentInventory);
        if (!saved) {
          showNotify('No se pudo guardar el borrador. Revisa tu conexión.', 'error');
          return; // Stay on the page if save fails
        }
      }
    }

    setCurrentInventory(null);
    setSignatures({ owner: '', tenant: '' });
    navigateTo('list');
  };

  const handleBack = async () => {
    if (view === 'create' && currentInventory && currentInventory.status === 'draft') {
      // Check if it's essentially empty
      const isBasicallyEmpty = !currentInventory.propertyName.trim() && 
                              !currentInventory.address.trim() && 
                              !currentInventory.ownerName?.trim() && 
                              !currentInventory.tenantName?.trim() &&
                              !currentInventory.internalCode?.trim();
      
      // Only auto-save if it has the mandatory fields (property name and address)
      if (!isBasicallyEmpty && currentInventory.propertyName.trim() && currentInventory.address.trim()) {
        const saved = await saveInventory(currentInventory);
        if (!saved) {
          showNotify('No se pudo guardar el borrador. Revisa tu conexión.', 'error');
          return; // Stay on the page if save fails
        }
      }
    }

    if (window.history.state && window.history.state.view !== 'list') {
      window.history.back();
    } else {
      setView('list');
      setCurrentInventory(null);
      setSignatures({ owner: '', tenant: '' });
    }
  };

  const applyTemplate = (type: string) => {
    if (!currentInventory) return;
    if (currentInventory.status !== 'draft') {
      showNotify('No se puede aplicar una plantilla a un inventario firmado.', 'error');
      return;
    }
    
    const template = PROPERTY_TEMPLATES[type] || INITIAL_SPACES_DATA;
    const newSpaces = template.map(s => ({
      id: uuidv4(),
      title: s.title,
      description: s.description,
      photos: [],
      items: s.items.map(itemName => ({
        id: uuidv4(),
        name: itemName,
        condition: 'Excelente' as const,
        details: ''
      }))
    }));

    setCurrentInventory({
      ...currentInventory,
      propertyType: type as any,
      customPropertyType: type === 'Otro' ? currentInventory.customPropertyType : '',
      spaces: newSpaces
    });
    
    if (newSpaces.length > 0) {
      setExpandedSpaces({ [newSpaces[0].id]: true });
    }
    
    showNotify(`Plantilla de ${type} aplicada correctamente`);
  };

  const isSubscriptionActive = () => {
    if (!currentUser) return false;
    
    // Super admin bypass
    if (currentUser.email === 'djbtorreglosa@gmail.com') return true;

    // If admin, check their own 6-month license expirationDate
    if (currentUser.role === 'admin') {
      if (!currentUser.expirationDate) return false; 
      return new Date(currentUser.expirationDate) >= new Date();
    }
    
    // If dependent, check their admin's license expirationDate
    if (currentUser.role === 'dependent') {
      if (currentUser.adminEmail === 'djbtorreglosa@gmail.com') return true;
      if (!currentUser.adminExpirationDate) return false;
      return new Date(currentUser.adminExpirationDate) >= new Date();
    }
    
    return false;
  };

  const startNewInventory = () => {
    if (!isSubscriptionActive()) {
      showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para crear nuevos inventarios.', 'error');
      navigateTo('settings');
      return;
    }

    const effectiveAdminEmail = resolveAdminEmail(currentUser);
    if (!effectiveAdminEmail) {
      showNotify('No se pudo identificar la agencia administradora. Verifique su perfil de usuario.', 'error');
      return;
    }

    const newInventory: Inventory = {
      id: uuidv4(),
      propertyName: '',
      propertyType: 'Apartamento',
      address: '',
      neighborhood: '',
      rentValue: '',
      internalCode: '',
      ownerName: '',
      tenantName: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      createdAt: Date.now(),
      status: 'draft',
      createdBy: currentUser?.id || '',
      creatorName: `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() || currentUser?.email || 'Usuario',
      adminEmail: effectiveAdminEmail,
      spaces: PROPERTY_TEMPLATES['Apartamento'].map(s => ({
        id: uuidv4(),
        title: s.title,
        description: s.description,
        photos: [],
        items: s.items.map(itemName => ({
          id: uuidv4(),
          name: itemName,
          condition: 'Excelente',
          details: ''
        }))
      }))
    };
    setCurrentInventory(newInventory);
    setSignatures({ owner: '', tenant: '' });
    setExpandedSpaces({ [newInventory.spaces[0].id]: true });
    navigateTo('create');
  };

  const handleUpdateName = async () => {
    if (!currentUser) return;
    if (!editFirstName.trim() || !editLastName.trim()) {
      showNotify('Nombre y apellido son requeridos', 'error');
      return;
    }

    setIsSavingName(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim()
      });
      
      setCurrentUser({
        ...currentUser,
        firstName: editFirstName.trim(),
        lastName: editLastName.trim()
      });
      
      showNotify('Perfil actualizado correctamente');
    } catch (error) {
      console.error('Error updating profile name:', error);
      showNotify('Error al actualizar el perfil', 'error');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleUpdateTemplates = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;

    setIsSavingTemplates(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        ownerTemplate: ownerTemplate.trim(),
        tenantTemplate: tenantTemplate.trim()
      });
      
      setCurrentUser({
        ...currentUser,
        ownerTemplate: ownerTemplate.trim(),
        tenantTemplate: tenantTemplate.trim()
      });
      
      showNotify('Plantillas actualizadas correctamente');
      setShowEditTemplates(false);
    } catch (error) {
      console.error('Error updating templates:', error);
      showNotify('Error al actualizar las plantillas', 'error');
    } finally {
      setIsSavingTemplates(false);
    }
  };

  const handleSaveInventory = async (status: 'draft' | 'completed' = 'draft') => {
    if (!currentInventory) {
      console.warn('handleSaveInventory called with null currentInventory');
      return;
    }
    
    if (!currentInventory.propertyName.trim()) {
      showNotify('Por favor ingrese el nombre del inmueble', 'error');
      return;
    }

    if (!currentInventory.address.trim()) {
      showNotify('Por favor ingrese la dirección del inmueble', 'error');
      return;
    }

    if (status === 'completed') {
      if (!isSubscriptionActive()) {
        showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para finalizar inventarios.', 'error');
        navigateTo('settings');
        return;
      }
      console.log('Opening signature modal for completion');
      setSignatures({ 
        owner: currentInventory.ownerSignature || '', 
        tenant: currentInventory.tenantSignature || '' 
      });
      setActiveSignatureSide(currentInventory.ownerSignature ? 'tenant' : 'owner');
      setShowSignatureModal(true);
      return;
    }

    console.log('Saving inventory as draft...', {
      hasOwnerSignature: !!signatures.owner,
      hasTenantSignature: !!signatures.tenant
    });

    try {
      const inventoryToSave: Inventory = { 
        ...currentInventory, 
        status: 'draft',
        ownerSignature: signatures.owner,
        tenantSignature: signatures.tenant,
        annexes: [] // Annexes are only for completed inventories
      };
      
      const success = await saveInventory(inventoryToSave);
      if (success) {
        setShowSignatureModal(false);
        navigateTo('list');
        setCurrentInventory(null);
        setSignatures({ owner: '', tenant: '' });
        showNotify('Borrador guardado correctamente');
      }
    } catch (error) {
      console.error('Error in handleSaveInventory:', error);
      showNotify('Error al procesar el guardado', 'error');
    }
  };

  const confirmFinalSave = async () => {
    if (!currentInventory) return;
    
    console.log('Confirming final save with signatures:', {
      hasOwnerSignature: !!signatures.owner,
      hasTenantSignature: !!signatures.tenant
    });

    try {
      const isFullySigned = signatures.owner && signatures.tenant;
      
      if (!isFullySigned) {
        console.warn('Attempted to finalize without both signatures');
        showNotify('Se requieren ambas firmas para finalizar el inventario', 'error');
        return;
      }

      const inventoryToSave: Inventory = { 
        ...currentInventory, 
        status: 'completed',
        ownerSignature: signatures.owner,
        tenantSignature: signatures.tenant
      };
      
      const success = await saveInventory(inventoryToSave);
      if (success) {
        setShowSignatureModal(false);
        navigateTo('list');
        setCurrentInventory(null);
        setSignatures({ owner: '', tenant: '' });
        showNotify('Inventario firmado y finalizado correctamente');
      }
    } catch (error) {
      console.error('Error in confirmFinalSave:', error);
      showNotify('Error al finalizar el inventario', 'error');
    }
  };

  const deleteInventoryPhotos = async (inventory: Inventory) => {
    const allPhotos: Photo[] = [];
    inventory.spaces.forEach(s => allPhotos.push(...s.photos));
    if (inventory.annexes) {
      inventory.annexes.forEach(a => allPhotos.push(...a.photos));
    }

    for (const photo of allPhotos) {
      // Clean up local IndexedDB record if any
      const blobId = photo.localBlobId || photo.id;
      if (blobId) {
        try {
          await deletePhotoRecord(blobId);
        } catch (e) {
          console.warn('Could not delete photo record from IndexedDB:', blobId, e);
        }
      }

      const targetUrl = photo.url || photo.dataUrl;
      if (targetUrl && targetUrl.startsWith('http')) {
        try {
          const decodedUrl = decodeURIComponent(targetUrl);
          const pathPart = decodedUrl.split('/o/')[1].split('?')[0];
          const photoRef = ref(storage, pathPart);
          await deleteObject(photoRef);
        } catch (e) {
          console.warn('Could not delete photo from storage:', photo.id, e);
        }
      }
    }
  };

  const handleDeleteInventory = async (id: string) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu suscripción ha expirado. Renueva para gestionar inventarios.', 'error');
      navigateTo('settings');
      return;
    }
    const inventory = inventories.find(i => i.id === id);
    if (!inventory) return;

    // If admin, show simple confirmation
    if (currentUser?.role === 'admin') {
      setShowConfirm({
        show: true,
        title: '¿Eliminar Inventario?',
        message: 'Esta acción es permanente y no se puede deshacer.',
        onConfirm: async () => {
          try {
            await deleteInventoryPhotos(inventory);
            await deleteDoc(doc(db, 'inventories', id));
            showNotify('Inventario eliminado correctamente');
            if (currentInventory?.id === id) {
              setCurrentInventory(null);
              navigateTo('list');
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `inventories/${id}`);
          }
        }
      });
      return;
    }

    // If dependent, require verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedDeleteCode(code);
    setInventoryIdToDelete(id);
    setDeleteCodeInput('');
    setShowDeleteCodeModal(true);
    
    const targetEmail = inventory.adminEmail;
    
    if (targetEmail) {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/send-verification', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            email: targetEmail,
            code,
            propertyName: inventory.propertyName
          })
        });

        const data = await response.json();

        if (response.ok) {
          if (data.simulated) {
            showNotify('Modo simulación: Código enviado al administrador (ver logs)', 'success');
            console.log('CÓDIGO DE VERIFICACIÓN (SIMULADO):', code);
          } else {
            showNotify(`Código enviado al administrador: ${targetEmail}`);
          }
        } else {
          console.error('Email API Error:', data);
          showNotify(data.error || 'Error al enviar el código de verificación', 'error');
        }
      } catch (error) {
        console.error('Fetch Error:', error);
        showNotify('Error de conexión al enviar el código', 'error');
      }
    } else {
      showNotify('No se encontró el correo del administrador para enviar el código', 'error');
    }
  };

  const verifyAndDelete = async () => {
    if (deleteCodeInput === generatedDeleteCode && inventoryIdToDelete) {
      try {
        const inventory = inventories.find(i => i.id === inventoryIdToDelete);
        if (inventory) {
          await deleteInventoryPhotos(inventory);
        }
        await deleteDoc(doc(db, 'inventories', inventoryIdToDelete));
        showNotify('Inventario eliminado correctamente');
        setShowDeleteCodeModal(false);
        setInventoryIdToDelete(null);
        setDeleteCodeInput('');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `inventories/${inventoryIdToDelete}`);
      }
    } else {
      showNotify('Código de verificación incorrecto', 'error');
    }
  };

  const handleArchiveInventory = async (id: string) => {
    const inventoryToArchive = inventories.find(i => i.id === id);
    if (!inventoryToArchive) return;

    const internalCode = inventoryToArchive.internalCode;
    const existingArchivedList = internalCode 
      ? inventories.filter(i => i.status === 'archived' && i.internalCode === internalCode)
      : [];

    const title = 'Archivar Inventario';
    const message = existingArchivedList.length > 0
      ? `Ya existe un inventario archivado con el código "${internalCode}". Si archiva este nuevo registro, la versión anterior en el archivo será ELIMINADA permanentemente para mantener solo el registro más reciente. ¿Desea continuar?`
      : '¿Está seguro de archivar este inventario? Esto permitirá reutilizar el código interno para un nuevo contrato.';

    confirmAction(
      title,
      message,
      async () => {
        try {
          // Delete all existing archived versions with this code to ensure only 1 remains
          for (const oldInv of existingArchivedList) {
            await deleteInventoryPhotos(oldInv);
            await deleteDoc(doc(db, 'inventories', oldInv.id));
          }
          await updateDoc(doc(db, 'inventories', id), { status: 'archived' });
          showNotify(existingArchivedList.length > 0 ? 'Inventario archivado y versión anterior eliminada' : 'Inventario archivado correctamente');
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `inventories/${id}`);
        }
      }
    );
  };

  const addSpace = (typeKey: string) => {
    if (!currentInventory || currentInventory.status !== 'draft') return;
    const config = SPACE_TYPES_CONFIG[typeKey];
    if (!config) return;

    const newSpace: InventorySpace = {
      id: uuidv4(),
      title: config.title,
      description: config.description,
      photos: [],
      items: config.items.map(name => ({
        id: uuidv4(),
        name,
        condition: 'Excelente',
        details: ''
      }))
    };
    setCurrentInventory({
      ...currentInventory,
      spaces: [...currentInventory.spaces, newSpace]
    });
    setExpandedSpaces(prev => ({ ...prev, [newSpace.id]: true }));
    setShowSpaceTypeModal(false);
  };

  const removeSpace = (id: string) => {
    if (!currentInventory || currentInventory.status !== 'draft') return;
    if (currentInventory.spaces.length <= 1) {
      showNotify('El inventario debe tener al menos un espacio.', 'error');
      return;
    }
    confirmAction(
      'Eliminar Espacio',
      '¿Está seguro de eliminar este espacio del inventario?',
      () => {
        setCurrentInventory({
          ...currentInventory,
          spaces: currentInventory.spaces.filter(s => s.id !== id)
        });
        showNotify('Espacio eliminado');
      }
    );
  };

  const addItemToSpace = (spaceId: string) => {
    if (!currentInventory || currentInventory.status !== 'draft') return;
    const newItem: InventoryItem = {
      id: uuidv4(),
      name: 'Nuevo Elemento',
      condition: 'Excelente',
      details: ''
    };
    setCurrentInventory({
      ...currentInventory,
      spaces: currentInventory.spaces.map(s => {
        if (s.id === spaceId) {
          return { ...s, items: [newItem, ...s.items] };
        }
        return s;
      })
    });
  };

  const removeItemFromSpace = (spaceId: string, itemId: string) => {
    if (!currentInventory || currentInventory.status !== 'draft') return;
    setCurrentInventory({
      ...currentInventory,
      spaces: currentInventory.spaces.map(s => {
        if (s.id === spaceId) {
          return { ...s, items: s.items.filter(i => i.id !== itemId) };
        }
        return s;
      })
    });
  };

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const processImageToBlob = (file: File): Promise<{ blob: Blob; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIM = 900;

          if (width > height) {
            if (width > MAX_DIM) {
              height *= MAX_DIM / width;
              width = MAX_DIM;
            }
          } else {
            if (height > MAX_DIM) {
              width *= MAX_DIM / height;
              height = MAX_DIM;
            }
          }

          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            if (blob) {
              resolve({ blob, width: canvas.width, height: canvas.height });
            } else {
              reject(new Error('Canvas toBlob failed'));
            }
          }, 'image/jpeg', 0.55);
        };
        img.onerror = reject;
        img.src = event.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const uploadPhotoWithFallback = async (
    file: File, 
    userId: string, 
    inventoryId: string,
    spaceId?: string,
    isAnnex = false
  ): Promise<{ photo: Photo; usedStorage: boolean; storageRef?: any }> => {
    const { blob } = await processImageToBlob(file);
    const photoId = uuidv4();

    // Secure Tenant Identification strictly from session/claims
    const tenantAdminUid = currentUser?.role === 'admin'
      ? currentUser.id
      : (currentUser?.adminUid || currentUser?.id);

    const prefix = isAnnex ? 'annex_' : '';
    const storagePath = tenantAdminUid 
      ? `tenants/${tenantAdminUid}/photos/${userId}/${prefix}${photoId}.jpg`
      : `photos/${userId}/${prefix}${photoId}.jpg`;

    // 1. Save Blob into IndexedDB persistent queue
    const photoRecord: OfflinePhotoRecord = {
      id: photoId,
      photoId,
      inventoryId,
      spaceId: isAnnex ? undefined : spaceId,
      isAnnex: !!isAnnex,
      blob,
      storagePath,
      adminUid: tenantAdminUid || userId,
      uploadedBy: userId,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      storageUploaded: false,
      sizeBytes: blob.size,
      mimeType: 'image/jpeg'
    };

    try {
      await savePendingPhoto(photoRecord);
    } catch (idbErr) {
      console.warn('[OfflineDB] Could not save photo to IndexedDB:', idbErr);
    }

    // 2. Return lightweight Photo object without Base64
    const lightPhoto: Photo = {
      id: photoId,
      dataUrl: '', // NO Base64 string in Firestore
      url: '',
      localBlobId: photoId,
      syncStatus: 'pending',
      storagePath,
      timestamp: Date.now()
    };

    // Note: Background sync will be triggered in an orderly fashion after saveInventory() confirms Firestore
    return {
      photo: lightPhoto,
      usedStorage: false
    };
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu licencia temporal ha vencido. Activa un código de 6 meses para añadir fotos.', 'error');
      return;
    }
    if (!currentInventory || currentInventory.status !== 'draft') {
      showNotify('No se pueden añadir fotos a un documento firmado o archivado.', 'error');
      return;
    }
    const files = e.target.files;
    if (!files || !targetSpaceId || !currentUser) return;

    const effectiveAdminEmail = resolveAdminEmail(currentUser);
    if (!effectiveAdminEmail) {
      showNotify('No se pudo identificar la agencia administradora.', 'error');
      return;
    }

    const fileList: File[] = Array.from(files);
    if (e.target) e.target.value = '';
    if (fileList.length === 0) return;

    setIsUploadingPhotos(true);
    showNotify(`Procesando ${fileList.length} fotografía(s)...`, 'info', 4000);

    const newPhotos: Photo[] = [];
    const failedFiles: string[] = [];

    try {
      // Step A: Compress to Blob JPEG (MAX_DIM=900, quality=0.55), save to IndexedDB queue, return light Photo
      for (const file of fileList) {
        try {
          const result = await uploadPhotoWithFallback(file, currentUser.id, currentInventory.id, targetSpaceId, false);
          newPhotos.push(result.photo);
        } catch (err: any) {
          console.error(`Error processing photo ${file.name}:`, err);
          failedFiles.push(file.name);
        }
      }

      if (newPhotos.length === 0) {
        throw new Error(`No se pudo procesar ninguna imagen. ${failedFiles.join(', ')}`);
      }

      // Step B: Build final spaces state with newly added photos (safe arrays)
      const updatedSpaces = (currentInventory.spaces || []).map(s => {
        if (s.id === targetSpaceId) {
          const existingPhotos = Array.isArray(s.photos) ? s.photos : [];
          return { ...s, photos: [...existingPhotos, ...newPhotos] };
        }
        return s;
      });

      // Step C: Update React state immediately for instant UI display via PhotoThumb with badge "Local"
      setCurrentInventory(prev => {
        if (!prev) return null;
        return { ...prev, spaces: updatedSpaces };
      });
      setInventories(prev => prev.map(inv => 
        inv.id === currentInventory.id ? { ...inv, spaces: updatedSpaces } : inv
      ));

      // Note: Photos stay safely in IndexedDB with status 'pending' (showing "Local").
      // Sincronización ordenada a Firestore se iniciará una vez que saveInventory() confirme la persistencia.

      if (failedFiles.length > 0) {
        showNotify(`Se procesaron ${newPhotos.length} foto(s). Fallaron: ${failedFiles.join(', ')}`, 'warning');
      } else {
        showNotify(`${newPhotos.length} fotografía(s) guardada(s) localmente y listas para sincronización`, 'success');
      }
    } catch (err: any) {
      console.error('Error during photo upload process:', err);
      showNotify(`Error al procesar fotografías: ${err?.message || 'Error desconocido'}`, 'error');
    } finally {
      setIsUploadingPhotos(false);
      setTargetSpaceId(null);
    }
  };

  const removePhoto = async (spaceId: string, photoId: string) => {
    if (!currentInventory) return;
    if (currentInventory.status !== 'draft') {
      showNotify('No se pueden eliminar fotos de un inventario firmado.', 'error');
      return;
    }
    
    // Find the photo to delete from storage
    const targetSpace = currentInventory.spaces.find(s => s.id === spaceId);
    const photoToDelete = targetSpace?.photos.find(p => p.id === photoId);

    const updatedSpaces = currentInventory.spaces.map(s => {
      if (s.id === spaceId) {
        return { ...s, photos: s.photos.filter(p => p.id !== photoId) };
      }
      return s;
    });

    const sanitizedDoc = sanitizeInventory({ ...currentInventory, spaces: updatedSpaces });
    const sanitizedSpaces = sanitizedDoc.spaces;

    // Update local state immediately
    setCurrentInventory(prev => prev ? { ...prev, spaces: updatedSpaces } : null);
    setInventories(prev => prev.map(inv => 
      inv.id === currentInventory.id ? { ...inv, spaces: updatedSpaces } : inv
    ));

    // Remove from IndexedDB queue if pending
    try {
      await markPhotoDeleted(photoId);
      await deletePhotoRecord(photoId);
    } catch (e) {
      console.warn('Error deleting pending photo from IndexedDB:', e);
    }

    // Persist to Firestore if document exists
    try {
      const inventoryRef = doc(db, 'inventories', currentInventory.id);
      const isExistingInState = inventories.some(i => i.id === currentInventory.id);
      if (isExistingInState) {
        await updateDoc(inventoryRef, {
          spaces: sanitizedSpaces,
          updatedAt: Date.now()
        });
      }

      // If photo was in Storage, delete the file
      const targetUrl = photoToDelete?.url || photoToDelete?.dataUrl;
      if (targetUrl && targetUrl.startsWith('http')) {
        try {
          const decodedUrl = decodeURIComponent(targetUrl);
          const pathPart = decodedUrl.split('/o/')[1].split('?')[0];
          const photoRef = ref(storage, pathPart);
          await deleteObject(photoRef);
        } catch (e) {
          console.warn('Could not delete photo file from storage:', e);
        }
      }

      showNotify('Fotografía eliminada');
    } catch (error) {
      console.error('Error removing photo from Firestore:', error);
      showNotify('Error al eliminar la foto del servidor', 'error');
    }
  };

  const toggleSpace = (id: string) => {
    setExpandedSpaces(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddAnnex = async () => {
    if (!currentInventory || !currentUser || !annexText.trim()) return;
    
    setIsSavingAnnex(true);
    try {
      const newAnnex: Annex = {
        id: uuidv4(),
        text: annexText.trim(),
        photos: annexPhotos,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        creatorName: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email || 'Usuario'
      };

      const updatedAnnexes = [...(currentInventory.annexes || []), newAnnex];
      const sanitizedDoc = sanitizeInventory({ ...currentInventory, annexes: updatedAnnexes });
      const sanitizedAnnexes = sanitizedDoc.annexes;
      const inventoryRef = doc(db, 'inventories', currentInventory.id);
      
      await updateDoc(inventoryRef, {
        annexes: sanitizedAnnexes,
        updatedAt: Date.now()
      });

      const updatedInventory = {
        ...currentInventory,
        annexes: updatedAnnexes
      };

      setCurrentInventory(updatedInventory);
      setInventories(prev => prev.map(inv => 
        inv.id === currentInventory.id ? updatedInventory : inv
      ));

      setAnnexText('');
      setAnnexPhotos([]);
      setShowAnnexModal(false);
      showNotify('Anexo añadido correctamente', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventories/${currentInventory.id}`);
    } finally {
      setIsSavingAnnex(false);
    }
  };

  const handleAnnexPhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isSubscriptionActive()) {
      showNotify('Tu suscripción ha vencido. Renueva para añadir fotos.', 'error');
      return;
    }
    const files = e.target.files;
    if (!files || !currentUser || !currentInventory) return;

    const fileList: File[] = Array.from(files);
    if (e.target) e.target.value = '';
    if (fileList.length === 0) return;

    for (const file of fileList) {
      try {
        const result = await uploadPhotoWithFallback(file, currentUser.id, currentInventory.id, undefined, true);
        setAnnexPhotos(prev => [...prev, result.photo]);
      } catch (err: any) {
        console.error('Error processing annex image:', err);
        showNotify(`Error al procesar foto del anexo: ${err?.message || ''}`, 'error');
      }
    }
  };

  const removeAnnexPhoto = async (photoId: string) => {
    const photoToDelete = annexPhotos.find(p => p.id === photoId);
    setAnnexPhotos(prev => prev.filter(p => p.id !== photoId));

    try {
      await markPhotoDeleted(photoId);
      await deletePhotoRecord(photoId);
    } catch (e) {
      console.warn('Error deleting pending annex photo from IndexedDB:', e);
    }

    const targetUrl = photoToDelete?.url || photoToDelete?.dataUrl;
    if (targetUrl && targetUrl.startsWith('http')) {
      try {
        const decodedUrl = decodeURIComponent(targetUrl);
        const pathPart = decodedUrl.split('/o/')[1].split('?')[0];
        const photoRef = ref(storage, pathPart);
        await deleteObject(photoRef);
      } catch (e) {
        console.warn('Could not delete annex photo from storage:', e);
      }
    }
  };

  const handleSaveReception = async () => {
    if (!currentInventory || !receptionType || !receptionSignature) return;

    if (receptionType === 'tenant' && currentInventory.tenantReceiveSignature) {
      showNotify('El acta de recibido ya fue firmada previamente y no puede ser modificada.', 'error');
      return;
    }
    if (receptionType === 'owner' && currentInventory.ownerDeliverySignature) {
      showNotify('El acta de entrega ya fue firmada previamente y no puede ser modificada.', 'error');
      return;
    }

    if (!receptionEmail.trim() || !receptionEmail.includes('@')) {
      showNotify('Por favor ingrese un correo electrónico válido para enviar la copia del acta firmada.', 'error');
      return;
    }
    
    setIsSavingReception(true);
    try {
      const inventoryRef = doc(db, 'inventories', currentInventory.id);
      const now = new Date().toISOString();
      
      const updateData: any = {
        updatedAt: Date.now()
      };

      if (receptionType === 'tenant') {
        updateData.tenantReceiveDate = now;
        updateData.tenantReceiveText = receptionText;
        updateData.tenantReceiveSignature = receptionSignature;
        updateData.tenantEmail = receptionEmail.trim().toLowerCase();
        if (receptionName.trim()) updateData.tenantName = receptionName.trim();
      } else {
        updateData.ownerDeliveryDate = now;
        updateData.ownerDeliveryText = receptionText;
        updateData.ownerDeliverySignature = receptionSignature;
        updateData.ownerEmail = receptionEmail.trim().toLowerCase();
        if (receptionName.trim()) updateData.ownerName = receptionName.trim();
      }

      const sanitizedUpdate = sanitizeData(updateData);

      // Save reception act
      await updateDoc(inventoryRef, sanitizedUpdate);

      const finalInventory = { ...currentInventory, ...updateData };
      setCurrentInventory(finalInventory);
      setInventories(prev => prev.map(inv => 
        inv.id === currentInventory.id ? finalInventory : inv
      ));

      // Despachar copia legal en PDF por correo electrónico
      try {
        const docPdf = generatePDFDoc(finalInventory, receptionType === 'owner' ? 'reception_owner' : 'reception_tenant');
        const pdfBase64 = docPdf.output('datauristring');
        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        const actTitle = receptionType === 'owner' ? 'Acta de Entrega de Inmueble (Propietario)' : 'Acta de Recibido de Inmueble (Inquilino)';

        await fetch('/api/send-signed-act-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            email: receptionEmail.trim().toLowerCase(),
            name: receptionName.trim() || (receptionType === 'owner' ? finalInventory.ownerName : finalInventory.tenantName),
            role: receptionType === 'owner' ? 'reception_owner' : 'reception_tenant',
            propertyName: finalInventory.propertyName,
            address: finalInventory.address,
            actTitle,
            pdfBase64,
            fileName: `Acta_${receptionType}_${finalInventory.propertyName.replace(/\s+/g, '_')}.pdf`,
            agencyName: currentUser?.agencyName || 'CheckInventory'
          })
        });
        showNotify(`Acta de ${receptionType === 'tenant' ? 'recibido' : 'entrega'} guardada y copia enviada a ${receptionEmail}`, 'success');
      } catch (emailErr) {
        console.warn('Advertencia al enviar correo de copia:', emailErr);
        showNotify(`Acta guardada correctamente`, 'success');
      }

      setReceptionType(null);
      setReceptionText('');
      setReceptionSignature('');
      setReceptionEmail('');
      setReceptionName('');
      setRemoteLinkSentSuccess(null);
      setIsCopiedRemoteLink(false);
      navigateTo('detail');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventories/${currentInventory.id}`);
    } finally {
      setIsSavingReception(false);
    }
  };

  const handleSendRemoteSigningLink = async () => {
    if (!currentInventory || !receptionType) return;

    if (!receptionEmail.trim() || !receptionEmail.includes('@')) {
      showNotify('Por favor ingrese un correo electrónico válido para enviar el enlace de firma.', 'error');
      return;
    }

    setIsSendingRemoteLink(true);
    try {
      const roleKey = receptionType === 'owner' ? 'reception_owner' : 'reception_tenant';
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';

      // Persist updated reception text & recipient info to Firestore first
      const inventoryRef = doc(db, 'inventories', currentInventory.id);
      const textUpdate: any = {
        updatedAt: Date.now()
      };
      if (receptionType === 'owner') {
        textUpdate.ownerDeliveryText = receptionText;
        textUpdate.ownerEmail = receptionEmail.trim().toLowerCase();
        if (receptionName.trim()) textUpdate.ownerName = receptionName.trim();
      } else {
        textUpdate.tenantReceiveText = receptionText;
        textUpdate.tenantEmail = receptionEmail.trim().toLowerCase();
        if (receptionName.trim()) textUpdate.tenantName = receptionName.trim();
      }
      await setDoc(inventoryRef, sanitizeData(textUpdate), { merge: true });

      // Request secure token generation, persistence and email dispatch from backend (single source of truth)
      const response = await fetch('/api/send-remote-signing-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          inventoryId: currentInventory.id,
          role: roleKey,
          email: receptionEmail.trim().toLowerCase(),
          name: receptionName.trim() || (receptionType === 'owner' ? currentInventory.ownerName : currentInventory.tenantName),
          propertyName: currentInventory.propertyName,
          address: currentInventory.address,
          agencyName: currentUser?.agencyName || 'CheckInventory',
          agencyLogo: currentUser?.agencyLogo || '',
          origin: window.location.origin
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.signUrl || !data.token) {
        throw new Error(data.error || 'Error al generar el enlace de firma en el servidor');
      }

      // Authoritative URL directly from backend
      const authoritativeUrl = data.signUrl;
      setRemoteLinkSentSuccess(authoritativeUrl);

      // Synchronize local state with authoritative token metadata generated by server
      const updatedTokens = {
        ...(currentInventory.remoteSigningTokens || {}),
        [roleKey]: {
          token: data.token,
          email: receptionEmail.trim().toLowerCase(),
          name: receptionName.trim() || (receptionType === 'owner' ? currentInventory.ownerName : currentInventory.tenantName),
          role: roleKey as any,
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          signed: false
        }
      };

      const updatedInventory: Inventory = {
        ...currentInventory,
        ...textUpdate,
        remoteSigningTokens: updatedTokens
      };
      setCurrentInventory(updatedInventory);
      setInventories(prev => prev.map(inv => inv.id === currentInventory.id ? updatedInventory : inv));

      if (data.emailStatus === 'test_redirected') {
        setRemoteLinkStatusInfo({ 
          status: 'test_redirected', 
          deliveredTo: data.deliveredTo, 
          warning: data.emailWarning 
        });
        showNotify(`Enlace generado. Correo entregado a ${data.deliveredTo} (Modo prueba Resend). Enlace listo para WhatsApp.`, 'info');
      } else if (data.emailStatus === 'warning') {
        setRemoteLinkStatusInfo({ status: 'warning', warning: data.emailWarning });
        showNotify(`Enlace generado. Está listo para ser compartido por WhatsApp o enlace directo.`, 'info');
      } else {
        setRemoteLinkStatusInfo({ status: 'sent' });
        showNotify(`Enlace de firma remota enviado por correo a ${receptionEmail}`, 'success');
      }
    } catch (err: any) {
      console.error('Error sending remote signing link:', err);
      showNotify(err.message || 'Error al generar solicitud de firma', 'error');
    } finally {
      setIsSendingRemoteLink(false);
    }
  };

  // Helper to render basic HTML in jsPDF
  const addHtmlTextToPDF = (doc: any, html: string, x: number, y: number, width: number) => {
    // Create a temporary element to parse HTML
    const div = document.createElement('div');
    div.innerHTML = html;
    
    let currentY = y;
    const lineHeight = 5.5;
    
    // Recursive function to process nodes
    const processNode = (node: Node, margin: number = 0) => {
      if (currentY > 280) {
        doc.addPage();
        currentY = 20;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          const lines = doc.splitTextToSize(text, width - margin);
          lines.forEach((line: string) => {
            if (currentY > 280) {
              doc.addPage();
              currentY = 20;
            }
            // Basic alignment support
            const el = node.parentElement;
            const alignment = el?.style.textAlign || 
                             (el?.classList.contains('ql-align-center') ? 'center' : 
                              el?.classList.contains('ql-align-right') ? 'right' : 
                              el?.classList.contains('ql-align-justify') ? 'justify' : 'left');
            
            let printX = x + margin;
            if (alignment === 'center') {
              printX = x + (width / 2) - (doc.getTextWidth(line) / 2);
            } else if (alignment === 'right') {
              printX = x + width - doc.getTextWidth(line);
            }

            doc.text(line, printX, currentY);
            currentY += lineHeight;
          });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();
        
        // Save current styles
        const prevStyle = doc.getFont()?.fontStyle || 'normal';
        const prevSize = doc.getFontSize();
        
        // Apply basic styles
        if (tagName === 'b' || tagName === 'strong') doc.setFont('helvetica', 'bold');
        if (tagName === 'i' || tagName === 'em') doc.setFont('helvetica', 'italic');
        
        // Handle sizes (approximate)
        if (el.classList.contains('ql-size-small')) doc.setFontSize(8);
        if (el.classList.contains('ql-size-large')) doc.setFontSize(14);
        if (el.classList.contains('ql-size-huge')) doc.setFontSize(18);
        
        // Handle indentation from Quill
        const indentMatch = el.className.match(/ql-indent-(\d+)/);
        const currentMargin = margin + (indentMatch ? parseInt(indentMatch[1]) * 10 : 0);

        // Process children
        el.childNodes.forEach(child => processNode(child, currentMargin));

        // Restore styles
        doc.setFont('helvetica', prevStyle);
        doc.setFontSize(prevSize);
        
        // Spacing after block elements
        if (['p', 'h1', 'h2', 'h3', 'div', 'br'].includes(tagName)) {
          currentY += 2;
        }
      }
    };

    processNode(div);
    return currentY;
  };

  /**
   * Calculates proportional dimensions for agency logo within maximum bounding box (contain mode).
   * Strictly preserves original aspect ratio for horizontal, vertical, square, PNG, and JPG logos.
   */
  const calculateLogoPdfDimensions = (
    doc: jsPDF,
    imageSrc: string,
    maxWidth: number = 48,
    maxHeight: number = 20
  ): { width: number; height: number; format: string } => {
    try {
      const props = doc.getImageProperties(imageSrc);
      const origWidth = props.width || 1;
      const origHeight = props.height || 1;
      const format = (props.fileType || 'PNG').toUpperCase();
      
      const aspectRatio = origWidth / origHeight;
      
      let width = maxWidth;
      let height = maxWidth / aspectRatio;
      
      if (height > maxHeight) {
        height = maxHeight;
        width = maxHeight * aspectRatio;
      }
      
      return {
        width: Math.max(width, 4),
        height: Math.max(height, 4),
        format: format === 'JPEG' || format === 'JPG' ? 'JPEG' : 'PNG'
      };
    } catch (err) {
      console.warn('Unable to extract image properties for PDF logo, using safe defaults:', err);
      return { width: 35, height: 16, format: 'PNG' };
    }
  };

  const generatePDFDoc = (inventory: Inventory, recipient: 'owner' | 'tenant' | 'both' | 'reception' | 'reception_owner' | 'reception_tenant' = 'both') => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const effectiveAgencyLogo = currentUser?.agencyLogo;
    const effectiveAgencyName = currentUser?.agencyName;
    const isReceptionOnly = recipient === 'reception' || recipient === 'reception_owner' || recipient === 'reception_tenant';
    
    // Header Logo (Preserving original aspect ratio in contain mode)
    if (effectiveAgencyLogo) {
      try {
        const { width: logoWidth, height: logoHeight, format: logoFormat } = calculateLogoPdfDimensions(doc, effectiveAgencyLogo, 48, 20);
        const logoX = pageWidth - 14 - logoWidth;
        const logoY = 10;
        doc.addImage(effectiveAgencyLogo, logoFormat, logoX, logoY, logoWidth, logoHeight, undefined, 'FAST');
      } catch (err) {
        console.error('Error rendering agency logo in PDF header:', err);
      }
    }

    // Header Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30);
    doc.text(isReceptionOnly ? 'Actas de Recepción de Inmueble' : 'Reporte de Inventario de Inmueble', 14, 20);

    if (effectiveAgencyName) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(80);
      doc.text(effectiveAgencyName, 14, 26);
    }
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    
    // Header Info
    const startY = effectiveAgencyName ? 33 : 30;
    const typeDisplay = inventory.propertyType === 'Otro' ? inventory.customPropertyType : inventory.propertyType;
    doc.text(`Inmueble: ${inventory.propertyName}`, 14, startY);
    doc.text(`Dirección: ${inventory.address}`, 14, startY + 6);
    if (inventory.neighborhood) doc.text(`Barrio: ${inventory.neighborhood}`, 14, startY + 12);
    doc.text(`Fecha: ${inventory.date}`, 14, startY + 18);
    doc.text(`Realizado por: ${inventory.creatorName || 'N/A'}`, 14, startY + 24);
    
    const rightColX = effectiveAgencyLogo ? 100 : 105;
    if (inventory.rentValue) doc.text(`Valor Arrendamiento: ${inventory.rentValue}`, rightColX, startY);
    if (inventory.internalCode) doc.text(`Código Interno: ${inventory.internalCode}`, rightColX, startY + 6);
    
    if (recipient !== 'tenant' && recipient !== 'reception_tenant' && inventory.ownerName) {
      doc.text(`Propietario: ${inventory.ownerName}`, rightColX, startY + 12);
    }
    if (recipient !== 'owner' && recipient !== 'reception_owner' && inventory.tenantName) {
      doc.text(`Inquilino: ${inventory.tenantName}`, rightColX, startY + 18);
    }
    
    const lineY = startY + 28;
    doc.setDrawColor(200);
    doc.line(14, lineY, pageWidth - 14, lineY);

    let currentY = lineY + 6;

    if (!isReceptionOnly) {
      // Table of conditions
      const tableData: any[] = [];
      inventory.spaces.forEach(space => {
        tableData.push([{ content: space.title, colSpan: 3, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }]);
        if (space.description && space.description !== 'Describa el área.') {
          tableData.push([{ content: `Nota del área: ${space.description}`, colSpan: 3, styles: { fontSize: 8, fontStyle: 'italic', textColor: [100, 100, 100] } }]);
        }
        space.items.forEach(item => {
          tableData.push([`  ${item.name}`, item.condition, item.details]);
        });
        if (space.generalObservations) {
          tableData.push([{ 
            content: `Observaciones Generales: ${space.generalObservations}`, 
            colSpan: 3, 
            styles: { fontSize: 8, fontStyle: 'bold', textColor: [40, 40, 40], fillColor: [250, 250, 250] } 
          }]);
        }
      });

      autoTable(doc, {
        startY: currentY,
        head: [['Elemento', 'Estado', 'Detalles']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [60, 60, 60] },
        styles: { fontSize: 9 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // Photos Section (Link instead of images)
      if (currentY > 250) { doc.addPage(); currentY = 20; }
      
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Registro Fotográfico Digital', 14, currentY);
      currentY += 10;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60);
      const photoText = 'Para garantizar la calidad de las evidencias y reducir el tamaño del documento, las fotografías se encuentran almacenadas digitalmente. Haga clic en el siguiente enlace para descargar el archivo comprimido (ZIP) con todas las fotos organizadas por espacios:';
      const splitText = doc.splitTextToSize(photoText, pageWidth - 28);
      doc.text(splitText, 14, currentY);
      currentY += (splitText.length * 6) + 5;

      const downloadUrl = `${window.location.origin}/?downloadPhotos=${inventory.id}`;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 255); // Blue color for link
      doc.text('>>> CLIC AQUÍ PARA DESCARGAR TODAS LAS FOTOS (ZIP) <<<', 14, currentY);
      doc.link(14, currentY - 5, 150, 10, { url: downloadUrl });
      
      currentY += 15;

      // Signatures in PDF
      if (inventory.status === 'completed' && (inventory.ownerSignature || inventory.tenantSignature)) {
        if (currentY > 230) {
          doc.addPage();
          currentY = 20;
        } else {
          currentY += 10;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Firmas de Conformidad', 14, currentY);
        currentY += 15;

        const sigWidth = 80;
        const sigHeight = 30;

        if (recipient !== 'tenant' && inventory.ownerSignature) {
          try {
            doc.addImage(inventory.ownerSignature, 'PNG', 14, currentY, sigWidth, sigHeight);
            doc.setFontSize(10);
            doc.text('Propietario / Arrendador', 14, currentY + sigHeight + 5);
          } catch (e) {
            console.error('Error adding owner signature to PDF', e);
          }
        }

        if (recipient !== 'owner' && inventory.tenantSignature) {
          try {
            doc.addImage(inventory.tenantSignature, 'PNG', 100, currentY, sigWidth, sigHeight);
            doc.setFontSize(10);
            doc.text('Inquilino / Arrendatario', 100, currentY + sigHeight + 5);
          } catch (e) {
            console.error('Error adding tenant signature to PDF', e);
          }
        }
        currentY += sigHeight + 20;
      }

      // Annexes Section
      if (inventory.annexes && inventory.annexes.length > 0) {
        doc.addPage();
        currentY = 20;
        
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text('Anexos', 14, currentY);
        currentY += 10;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text('Información y modificaciones añadidas al inventario original.', 14, currentY);
        currentY += 15;

        inventory.annexes.forEach((annex, index) => {
          if (currentY > 240) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(40);
          const annexDate = annex.createdAt ? new Date(annex.createdAt).toLocaleDateString() : 'N/A';
          doc.text(`Anexo #${index + 1} - ${annexDate}`, 14, currentY);
          currentY += 7;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60);
          
          const annexTextLines = doc.splitTextToSize(annex.text, pageWidth - 28);
          annexTextLines.forEach((line: string) => {
            if (currentY > 280) {
              doc.addPage();
              currentY = 20;
            }
            doc.text(line, 14, currentY);
            currentY += 5;
          });
          currentY += 5;

          if (annex.photos && annex.photos.length > 0) {
            if (currentY > 280) {
              doc.addPage();
              currentY = 20;
            }
            doc.setFontSize(9);
            doc.setFont('helvetica', 'italic');
            doc.text(`(Este anexo incluye ${annex.photos.length} fotos adicionales en el registro digital)`, 14, currentY);
            currentY += 10;
          }
          
          doc.setDrawColor(230);
          doc.line(14, currentY, pageWidth - 14, currentY);
          currentY += 10;
        });
      }
    }

    // Property Reception Acts Section
    if (inventory.tenantReceiveSignature || inventory.ownerDeliverySignature) {
      if (!isReceptionOnly) {
        doc.addPage();
        currentY = 20;
      }
      
      if (effectiveAgencyLogo) {
        try {
          const { width: logoWidth, height: logoHeight, format: logoFormat } = calculateLogoPdfDimensions(doc, effectiveAgencyLogo, 45, 18);
          const logoX = pageWidth - 14 - logoWidth;
          const logoY = Math.max(8, currentY - 8);
          doc.addImage(effectiveAgencyLogo, logoFormat, logoX, logoY, logoWidth, logoHeight, undefined, 'FAST');
        } catch (e) {
          console.error('Error rendering agency logo on reception page:', e);
        }
      }

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Actas de Recepción de Inmueble', 14, currentY);
      currentY += 15;

      // Tenant Act
      if (recipient !== 'owner' && recipient !== 'reception_owner' && inventory.tenantReceiveSignature) {
        if (currentY > 240) { doc.addPage(); currentY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Acta de Recibido (Inquilino)', 14, currentY);
        currentY += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        doc.text(`Fecha: ${new Date(inventory.tenantReceiveDate!).toLocaleDateString()}`, 14, currentY);
        currentY += 7;

        currentY = addHtmlTextToPDF(doc, inventory.tenantReceiveText || '', 14, currentY, pageWidth - 28);
        currentY += 10;

        try {
          doc.addImage(inventory.tenantReceiveSignature, 'PNG', 14, currentY, 60, 25);
          currentY += 30;
          doc.setFontSize(9);
          doc.text('Firma del Inquilino / Arrendatario', 14, currentY);
          currentY += 15;
        } catch (e) { console.error(e); }
      }

      // Owner Act
      if (recipient !== 'tenant' && recipient !== 'reception_tenant' && inventory.ownerDeliverySignature) {
        if (currentY > 200) { doc.addPage(); currentY = 20; }
        else { currentY += 10; }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Acta de Entrega (Propietario)', 14, currentY);
        currentY += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        doc.text(`Fecha: ${new Date(inventory.ownerDeliveryDate!).toLocaleDateString()}`, 14, currentY);
        currentY += 7;

        currentY = addHtmlTextToPDF(doc, inventory.ownerDeliveryText || '', 14, currentY, pageWidth - 28);
        currentY += 10;

        try {
          doc.addImage(inventory.ownerDeliverySignature, 'PNG', 14, currentY, 60, 25);
          currentY += 30;
          doc.setFontSize(9);
          doc.text('Firma del Propietario / Arrendador', 14, currentY);
          currentY += 15;
        } catch (e) { console.error(e); }
      }
    }

    return doc;
  };

  const exportToPDF = (inventory: Inventory, recipient: 'owner' | 'tenant' | 'both' | 'reception' | 'reception_owner' | 'reception_tenant' = 'both') => {
    if (!isSubscriptionActive()) {
      showNotify('Tu suscripción ha expirado. Renueva para exportar inventarios.', 'error');
      return;
    }
    const doc = generatePDFDoc(inventory, recipient);
    const suffix = recipient === 'owner' ? '_Propietario' : 
                   recipient === 'tenant' ? '_Inquilino' : 
                   recipient === 'reception' ? '_Actas_Recepcion' : 
                   recipient === 'reception_owner' ? '_Acta_Entrega_Propietario' :
                   recipient === 'reception_tenant' ? '_Acta_Recibido_Inquilino' : '';
    doc.save(`Inventario_${inventory.propertyName.replace(/\s+/g, '_')}_${inventory.date}${suffix}.pdf`);
  };

  const sharePDF = async (inventory: Inventory, recipient: 'owner' | 'tenant' | 'both' | 'reception' | 'reception_owner' | 'reception_tenant' = 'both') => {
    if (!isSubscriptionActive()) {
      showNotify('Tu suscripción ha expirado. Renueva para compartir inventarios.', 'error');
      return;
    }
    try {
      const doc = generatePDFDoc(inventory, recipient);
      const pdfBlob = doc.output('blob');
      const suffix = recipient === 'owner' ? '_Propietario' : 
                     recipient === 'tenant' ? '_Inquilino' : 
                     recipient === 'reception' ? '_Actas_Recepcion' : 
                     recipient === 'reception_owner' ? '_Acta_Entrega_Propietario' :
                     recipient === 'reception_tenant' ? '_Acta_Recibido_Inquilino' : '';
      const fileName = `Inventario_${inventory.propertyName.replace(/\s+/g, '_')}_${inventory.date}${suffix}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Inventario: ${inventory.propertyName}`,
          text: `Reporte de inventario de ${inventory.propertyName}`,
          files: [file]
        });
        showNotify('Documento compartido con éxito');
      } else if (navigator.share) {
        // Direct download fallback
        doc.save(fileName);
        showNotify('PDF descargado en el dispositivo');
      } else {
        doc.save(fileName);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error sharing PDF:', error);
        exportToPDF(inventory, recipient);
      }
    }
  };

  const filteredInventories = React.useMemo(() => {
    return inventories
      .filter(inv => {
        const matchesSearch = inv.propertyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             inv.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             (inv.internalCode && inv.internalCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
                             (inv.ownerName && inv.ownerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
                             (inv.tenantName && inv.tenantName.toLowerCase().includes(searchTerm.toLowerCase()));
        
        let matchesStatus = true;
        if (statusFilter === 'all') {
          matchesStatus = true;
        } else if (statusFilter === 'received') {
          matchesStatus = !!(inv.tenantReceiveSignature || inv.ownerDeliverySignature);
        } else {
          matchesStatus = inv.status === statusFilter;
        }
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [inventories, searchTerm, statusFilter]);

  const handleLogout = async () => {
    confirmAction(
      'Cerrar Sesión',
      '¿Está seguro de que desea cerrar la sesión actual?',
      async () => {
        await signOut(auth);
        setCurrentUser(null);
        navigateTo('list');
      }
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isDownloadingPhotos && !currentUser) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center text-white mb-6 animate-bounce shadow-2xl shadow-black/20">
          <Download size={32} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">Preparando tus fotos</h2>
        <p className="text-muted text-sm max-w-xs">Estamos comprimiendo el registro fotográfico. La descarga comenzará en unos segundos...</p>
        <div className="mt-8 w-48 h-1 bg-black/5 rounded-full overflow-hidden">
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            className="w-full h-full bg-black"
          />
        </div>
      </div>
    );
  }

  if (remoteSignParams) {
    return (
      <PublicRemoteSignPage 
        token={remoteSignParams.token} 
        invId={remoteSignParams.inv} 
        role={remoteSignParams.role} 
      />
    );
  }

  if (!currentUser) {
    return <Auth />;
  }

  if (!isEmailVerified) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[3rem] p-10 shadow-xl border border-black/5 text-center"
        >
          <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <Mail size={40} />
          </div>
          <h2 className="text-2xl font-bold mb-4">Verifica tu correo</h2>
          <p className="text-muted text-sm mb-8 leading-relaxed">
            Hemos enviado un enlace de confirmación a <strong>{currentUser.email}</strong>. 
            Por favor, revisa tu bandeja de entrada (y la carpeta de spam) y haz clic en el enlace para activar tu cuenta.
          </p>
          <div className="space-y-4">
            <button 
              onClick={async () => {
                if (auth.currentUser) {
                  await auth.currentUser.reload();
                  setIsEmailVerified(auth.currentUser.emailVerified);
                  if (auth.currentUser.emailVerified) {
                    showNotify('¡Correo verificado correctamente!');
                  } else {
                    showNotify('El correo aún no ha sido verificado.', 'error');
                  }
                }
              }}
              className="w-full bg-black text-white py-4 rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/10"
            >
              Ya lo he verificado
            </button>
            <button 
              onClick={async () => {
                if (auth.currentUser) {
                  try {
                    await sendEmailVerification(auth.currentUser, {
                      url: window.location.origin,
                      handleCodeInApp: false,
                    });
                    showNotify('Enlace de verificación reenviado.');
                  } catch (err) {
                    showNotify('Error al reenviar el enlace.', 'error');
                  }
                }
              }}
              className="w-full py-4 text-xs font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
            >
              Reenviar enlace
            </button>
            <button 
              onClick={() => signOut(auth)}
              className="w-full py-4 text-xs font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors"
            >
              Cerrar Sesión
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#1a1a1a] font-sans pb-12">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification?.show && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 ${
              notification.type === 'error'
                ? 'bg-red-600 text-white'
                : notification.type === 'warning'
                ? 'bg-amber-600 text-white'
                : notification.type === 'info'
                ? 'bg-blue-600 text-white'
                : 'bg-black text-white'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${
              notification.type === 'error'
                ? 'bg-white'
                : notification.type === 'warning'
                ? 'bg-yellow-200'
                : notification.type === 'info'
                ? 'bg-blue-200'
                : 'bg-emerald-400'
            }`} />
            <span className="text-sm font-bold">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dependent Inventories Modal */}
      <AnimatePresence>
        {selectedDependentForInventories && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDependentForInventories(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#f8f9fa] w-full max-w-4xl max-h-[85vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-8 bg-white border-b border-black/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white font-bold text-xl">
                    {selectedDependentForInventories.firstName?.[0]}{selectedDependentForInventories.lastName?.[0]}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Inventarios de {selectedDependentForInventories.firstName}</h2>
                    <p className="text-muted text-sm font-medium">{selectedDependentForInventories.email}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedDependentForInventories(null)}
                  className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center hover:bg-black/10 transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-8">
                {(() => {
                  const dependentInventories = inventories.filter(inv => inv.createdBy === selectedDependentForInventories.id);
                  
                  if (dependentInventories.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center mb-6 text-black/20">
                          <ClipboardList size={40} />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Sin inventarios</h3>
                        <p className="text-muted max-w-xs mx-auto">Este dependiente aún no ha realizado ningún inventario.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {dependentInventories.map((inv) => (
                        <div 
                          key={inv.id}
                          className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm hover:shadow-xl hover:shadow-black/5 transition-all group cursor-pointer"
                          onClick={() => {
                            setCurrentInventory(inv);
                            navigateTo('detail');
                            setSelectedDependentForInventories(null);
                          }}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              inv.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                              inv.status === 'draft' ? 'bg-amber-100 text-amber-700' : 
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {inv.status === 'completed' ? 'Completado' : 
                               inv.status === 'draft' ? 'Borrador' : 'Archivado'}
                            </div>
                            <span className="text-[10px] font-bold text-muted uppercase tracking-widest">
                              {(() => {
                                try {
                                  return inv.updatedAt ? format(new Date(inv.updatedAt), 'dd MMM yyyy') : 'N/A';
                                } catch (e) {
                                  return 'N/A';
                                }
                              })()}
                            </span>
                          </div>
                          
                          <h3 className="text-lg font-bold mb-1 group-hover:text-black transition-colors line-clamp-1">
                            {inv.propertyName}
                          </h3>
                          <p className="text-xs text-muted font-medium mb-4 line-clamp-1">
                            {inv.propertyAddress}
                          </p>
                          
                          <div className="pt-4 border-t border-black/5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                                <Home size={16} />
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                                {inv.propertyType}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-black">
                              <span className="text-xs font-bold">Ver</span>
                              <ChevronRight size={14} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirm.show && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirm({ ...showConfirm, show: false })}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full relative z-10 shadow-2xl border border-black/5"
            >
              <h3 className="text-xl font-bold mb-2">{showConfirm.title}</h3>
              <p className="text-muted text-sm mb-8">{showConfirm.message}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowConfirm({ ...showConfirm, show: false })}
                  className="flex-1 py-3 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    showConfirm.onConfirm();
                    setShowConfirm({ ...showConfirm, show: false });
                  }}
                  className="flex-1 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Signature Modal */}
      <AnimatePresence>
        {showSignatureModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-[#f8f9fa] rounded-[3rem] p-8 max-w-lg w-full relative z-10 shadow-2xl border border-black/5 overflow-hidden"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">Firma Legal</h3>
                  <p className="text-muted text-xs font-medium mt-1">Este documento no podrá ser modificado una vez firmado.</p>
                </div>
                <button 
                  onClick={() => setShowSignatureModal(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex gap-2 mb-8 p-1 bg-black/5 rounded-2xl">
                <button 
                  onClick={() => setActiveSignatureSide('owner')}
                  disabled={view === 'reception' && receptionType === 'tenant'}
                  className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeSignatureSide === 'owner' ? 'bg-black text-white shadow-lg' : 'text-muted hover:bg-black/5'} disabled:opacity-30`}
                >
                  Propietario
                </button>
                <button 
                  onClick={() => setActiveSignatureSide('tenant')}
                  disabled={view === 'reception' && receptionType === 'owner'}
                  className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeSignatureSide === 'tenant' ? 'bg-black text-white shadow-lg' : 'text-muted hover:bg-black/5'} disabled:opacity-30`}
                >
                  Inquilino
                </button>
              </div>

              <div className="space-y-6">
                {activeSignatureSide === 'owner' ? (
                  <SignaturePad 
                    key="owner-signature"
                    label="Firma del Propietario / Arrendador" 
                    initialValue={view === 'reception' ? receptionSignature : signatures.owner}
                    onSave={(data) => {
                      if (view === 'reception') {
                        setReceptionSignature(data);
                      } else {
                        setSignatures(prev => ({ ...prev, owner: data }));
                      }
                    }}
                  />
                ) : (
                  <SignaturePad 
                    key="tenant-signature"
                    label="Firma del Inquilino / Arrendatario" 
                    initialValue={view === 'reception' ? receptionSignature : signatures.tenant}
                    onSave={(data) => {
                      if (view === 'reception') {
                        setReceptionSignature(data);
                      } else {
                        setSignatures(prev => ({ ...prev, tenant: data }));
                      }
                    }}
                  />
                )}
              </div>

              <div className="flex flex-col gap-3 mt-10">
                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowSignatureModal(false)}
                    className="flex-1 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                  >
                    {view === 'reception' ? 'Cerrar' : 'Cancelar'}
                  </button>
                  {view !== 'reception' && (
                    <button 
                      onClick={confirmFinalSave}
                      disabled={!(signatures.owner && signatures.tenant)}
                      className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/20 disabled:opacity-50 disabled:shadow-none"
                    >
                      Finalizar y Firmar
                    </button>
                  )}
                  {view === 'reception' && (
                    <button 
                      onClick={() => setShowSignatureModal(false)}
                      className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/20"
                    >
                      Aceptar
                    </button>
                  )}
                </div>
                
                <button 
                  onClick={() => handleSaveInventory('draft')}
                  className="w-full py-3 text-xs font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
                >
                  Guardar como Borrador
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Export Modal */}
      <AnimatePresence>
        {showExportModal && selectedInventoryForExport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setShowExportModal(false)}
            />
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-white rounded-[3rem] p-8 max-w-md w-full relative z-10 shadow-2xl border border-black/5"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">Exportar PDF</h3>
                  <p className="text-muted text-xs font-medium mt-1">Seleccione la versión del reporte que desea descargar.</p>
                </div>
                <button 
                  onClick={() => setShowExportModal(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Group 1: Inventario y Fotos */}
                <div className="border border-black/5 rounded-3xl overflow-hidden">
                  <button 
                    onClick={() => setExportAccordion(exportAccordion === 'inventory' ? null : 'inventory')}
                    className="w-full p-5 flex items-center justify-between bg-[#f8f9fa] hover:bg-black/5 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center">
                        <ImageIcon size={20} className="text-black" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">Inventario y Fotos</p>
                        <p className="text-[10px] text-muted">Reportes y archivos multimedia</p>
                      </div>
                    </div>
                    {exportAccordion === 'inventory' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  
                  <AnimatePresence>
                    {exportAccordion === 'inventory' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-white border-t border-black/5 p-4 space-y-2 overflow-hidden"
                      >
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              exportToPDF(selectedInventoryForExport, 'owner');
                              setShowExportModal(false);
                            }}
                            className="flex-1 p-4 rounded-2xl bg-[#f8f9fa] hover:bg-black hover:text-white transition-all flex items-center justify-between group"
                          >
                            <span className="font-bold text-sm">Copia Propietario</span>
                            <Download size={16} className="opacity-40 group-hover:opacity-100" />
                          </button>
                          {typeof navigator !== 'undefined' && 'share' in navigator && (
                            <button
                              onClick={() => {
                                sharePDF(selectedInventoryForExport, 'owner');
                                setShowExportModal(false);
                              }}
                              className="w-14 h-14 rounded-2xl bg-black/5 hover:bg-black hover:text-white transition-all flex items-center justify-center"
                              title="Compartir Copia Propietario"
                            >
                              <Share2 size={18} />
                            </button>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              exportToPDF(selectedInventoryForExport, 'tenant');
                              setShowExportModal(false);
                            }}
                            className="flex-1 p-4 rounded-2xl bg-[#f8f9fa] hover:bg-black hover:text-white transition-all flex items-center justify-between group"
                          >
                            <span className="font-bold text-sm">Copia Inquilino</span>
                            <Download size={16} className="opacity-40 group-hover:opacity-100" />
                          </button>
                          {typeof navigator !== 'undefined' && 'share' in navigator && (
                            <button
                              onClick={() => {
                                sharePDF(selectedInventoryForExport, 'tenant');
                                setShowExportModal(false);
                              }}
                              className="w-14 h-14 rounded-2xl bg-black/5 hover:bg-black hover:text-white transition-all flex items-center justify-center"
                              title="Compartir Copia Inquilino"
                            >
                              <Share2 size={18} />
                            </button>
                          )}
                        </div>

                        <button 
                          onClick={() => {
                            downloadPhotosZip(selectedInventoryForExport);
                            setShowExportModal(false);
                          }}
                          className="w-full p-4 rounded-2xl bg-black text-white hover:bg-black/80 transition-all flex items-center justify-between group"
                        >
                          <span className="font-bold text-sm">Descargar fotos de inventario (ZIP)</span>
                          <Download size={16} className="opacity-60 group-hover:opacity-100" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Group 2: Actas de Recepción */}
                <div className="border border-black/5 rounded-3xl overflow-hidden">
                  <button 
                    onClick={() => setExportAccordion(exportAccordion === 'reception' ? null : 'reception')}
                    className="w-full p-5 flex items-center justify-between bg-[#f8f9fa] hover:bg-black/5 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                        <FileText size={20} className="text-emerald-600" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">Actas de Recepción</p>
                        <p className="text-[10px] text-muted">Documentos de entrega y recibido</p>
                      </div>
                    </div>
                    {exportAccordion === 'reception' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  
                  <AnimatePresence>
                    {exportAccordion === 'reception' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-white border-t border-black/5 p-4 space-y-2 overflow-hidden"
                      >
                        {selectedInventoryForExport.ownerDeliverySignature ? (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                exportToPDF(selectedInventoryForExport, 'reception_owner');
                                setShowExportModal(false);
                              }}
                              className="flex-1 p-4 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-between group"
                            >
                              <span className="font-bold text-sm">Acta Propietario</span>
                              <FileText size={16} className="opacity-60 group-hover:opacity-100" />
                            </button>
                            {typeof navigator !== 'undefined' && 'share' in navigator && (
                              <button
                                onClick={() => {
                                  sharePDF(selectedInventoryForExport, 'reception_owner');
                                  setShowExportModal(false);
                                }}
                                className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center"
                                title="Compartir Acta Propietario"
                              >
                                <Share2 size={18} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-[10px] text-muted italic">Acta de propietario no firmada</div>
                        )}
                        
                        {selectedInventoryForExport.tenantReceiveSignature ? (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                exportToPDF(selectedInventoryForExport, 'reception_tenant');
                                setShowExportModal(false);
                              }}
                              className="flex-1 p-4 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-between group"
                            >
                              <span className="font-bold text-sm">Acta Inquilino</span>
                              <FileText size={16} className="opacity-60 group-hover:opacity-100" />
                            </button>
                            {typeof navigator !== 'undefined' && 'share' in navigator && (
                              <button
                                onClick={() => {
                                  sharePDF(selectedInventoryForExport, 'reception_tenant');
                                  setShowExportModal(false);
                                }}
                                className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center"
                                title="Compartir Acta Inquilino"
                              >
                                <Share2 size={18} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-[10px] text-muted italic">Acta de inquilino no firmada</div>
                        )}

                        {selectedInventoryForExport.tenantReceiveSignature && selectedInventoryForExport.ownerDeliverySignature && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                exportToPDF(selectedInventoryForExport, 'reception');
                                setShowExportModal(false);
                              }}
                              className="flex-1 p-4 rounded-2xl bg-emerald-100 text-emerald-800 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-between group"
                            >
                              <span className="font-bold text-sm">Ambas Actas</span>
                              <FileText size={16} className="opacity-60 group-hover:opacity-100" />
                            </button>
                            {typeof navigator !== 'undefined' && 'share' in navigator && (
                              <button
                                onClick={() => {
                                  sharePDF(selectedInventoryForExport, 'reception');
                                  setShowExportModal(false);
                                }}
                                className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center"
                                title="Compartir Ambas Actas"
                              >
                                <Share2 size={18} />
                              </button>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <button 
                onClick={() => setShowExportModal(false)}
                className="w-full mt-6 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
              >
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Annex Modal */}
      <AnimatePresence>
        {showAnnexModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => !isSavingAnnex && setShowAnnexModal(false)}
            />
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-white rounded-[3rem] p-8 max-w-lg w-full relative z-10 shadow-2xl border border-black/5 flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">Nuevo Anexo</h3>
                  <p className="text-muted text-xs font-medium mt-1">Registre daños omitidos o reparaciones realizadas.</p>
                </div>
                <button 
                  onClick={() => setShowAnnexModal(false)}
                  disabled={isSavingAnnex}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors disabled:opacity-50"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Descripción del Anexo</label>
                  <textarea 
                    value={annexText}
                    onChange={(e) => setAnnexText(e.target.value)}
                    placeholder="Describa el detalle que desea añadir al inventario..."
                    className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-black outline-none transition-all min-h-[120px] resize-none"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Evidencia Fotográfica</label>
                    <span className="text-[10px] font-bold text-black/40">{annexPhotos.length} fotos</span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {annexPhotos.map((photo) => (
                      <div key={photo.id} className="relative aspect-square group cursor-pointer rounded-xl overflow-hidden">
                        <PhotoThumb 
                          photo={photo} 
                          alt="Anexo" 
                          onClick={async () => {
                            const displayUrl = await getPhotoDisplayUrl(photo);
                            setFullscreenPhoto({
                              url: displayUrl,
                              title: 'Foto de Anexo',
                              photoId: photo.id,
                              canDelete: true,
                              isAnnex: true
                            });
                          }}
                          className="w-full h-full object-cover rounded-xl border border-black/5"
                          showSyncBadge={true}
                        />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAnnexPhoto(photo.id);
                          }}
                          className="absolute top-1 right-1 p-1 bg-white/90 rounded-md text-red-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
                          title="Eliminar foto"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button 
                      onClick={() => setPhotoSourceModal({ open: true, type: 'annex' })}
                      className="aspect-square border-2 border-dashed border-black/5 rounded-xl flex flex-col items-center justify-center text-muted hover:bg-black/[0.02] transition-all"
                    >
                      <Plus size={20} />
                      <span className="text-[8px] font-bold uppercase mt-1">Añadir</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-black/5 flex gap-4">
                <button 
                  onClick={() => setShowAnnexModal(false)}
                  disabled={isSavingAnnex}
                  className="flex-1 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleAddAnnex}
                  disabled={isSavingAnnex || !annexText.trim()}
                  className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingAnnex ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Guardar Anexo</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Verification Modal */}
      <AnimatePresence>
        {showDeleteCodeModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-white rounded-[3rem] p-8 max-w-md w-full relative z-10 shadow-2xl border border-black/5"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-red-600">Autorización Requerida</h3>
                  <p className="text-muted text-xs font-medium mt-1">Para eliminar este inventario, ingrese el código enviado al correo del administrador.</p>
                </div>
                <button 
                  onClick={() => setShowDeleteCodeModal(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Código de Verificación</label>
                  <input 
                    type="text"
                    maxLength={6}
                    value={deleteCodeInput}
                    onChange={(e) => setDeleteCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-6 py-4 text-center text-3xl font-mono tracking-[0.5em] focus:ring-2 focus:ring-red-500 outline-none transition-all"
                  />
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowDeleteCodeModal(false)}
                    className="flex-1 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={verifyAndDelete}
                    disabled={deleteCodeInput.length !== 6}
                    className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-xl shadow-red-600/20 disabled:opacity-50 disabled:shadow-none"
                  >
                    Confirmar Eliminación
                  </button>
                </div>

                <button 
                  onClick={() => handleDeleteInventory(inventoryIdToDelete!)}
                  className="w-full text-[10px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
                >
                  ¿No recibió el código? Reenviar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="sticky top-0 z-50">
        {/* Header */}
        <header className="bg-white border-b border-black/5 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 cursor-pointer shrink-0" onClick={handleGoHome}>
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-black rounded-lg sm:rounded-xl flex items-center justify-center text-white shadow-lg shadow-black/10">
              <Home size={18} className="sm:hidden" />
              <Home size={22} className="hidden sm:block" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-base sm:text-xl font-bold tracking-tight leading-tight">CheckInventory</h1>
              <p className="hidden sm:block text-[10px] text-muted font-bold uppercase tracking-[0.2em] opacity-40">Property Inventory</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              onClick={() => toggleDarkMode()}
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl bg-black/5 hover:bg-black/10 transition-all text-black shrink-0"
              title={isDarkMode ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
            >
              {isDarkMode ? <Sun size={17} className="text-amber-500" /> : <Moon size={17} className="text-neutral-700" />}
            </button>
            <button 
              onClick={() => navigateTo('settings')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl transition-all text-xs font-bold ${view === 'settings' ? 'bg-black text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}
              title="Ajustes"
            >
              <Settings size={14} />
              <span className="hidden sm:inline">Ajustes</span>
            </button>
            {view === 'create' && (
              <button 
                onClick={() => handleSaveInventory('draft')}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-black/5 hover:bg-black/10 text-black rounded-xl transition-all text-xs font-bold"
              >
                <Save size={14} />
                <span>Guardar Borrador</span>
              </button>
            )}
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-sm font-bold tracking-tight text-black">
                {currentUser.firstName} {currentUser.lastName}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-black/5 rounded text-muted">
                  {currentUser.role === 'admin' ? 'Administrador' : 'Dependiente'}
                </span>
                <span className="text-[10px] font-medium opacity-40">{currentUser.email}</span>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl hover:bg-red-50 text-muted hover:text-red-600 transition-colors shrink-0"
              title="Cerrar Sesión"
            >
              <LogIn size={18} className="rotate-180 sm:hidden" />
              <LogIn size={20} className="rotate-180 hidden sm:block" />
            </button>
          </div>
        </header>

        {/* Offline indicator banner */}
        {!isOnline && (
          <div className="bg-amber-500 text-white px-4 py-2 text-center text-xs font-bold flex items-center justify-center gap-2 shadow-inner">
            <WifiOff size={14} className="shrink-0" />
            <span>Modo Sin Conexión (Offline) — Los datos se guardan en el teléfono y se sincronizarán al reconectar</span>
          </div>
        )}

        {/* Sub-header for views other than list */}
        {view !== 'list' && (
          <div className="bg-[#f8f9fa] sticky top-[65px] sm:top-[73px] z-40 px-3 sm:px-6 py-2 sm:py-3 transition-colors">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <button 
                onClick={handleBack}
                className="flex items-center gap-2 text-muted hover:text-black font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-all group"
              >
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-black/5 group-hover:bg-black group-hover:text-white flex items-center justify-center transition-all">
                  <ChevronLeft size={16} />
                </div>
                <span className="hidden sm:inline">Volver a la lista</span>
                <span className="sm:hidden">Volver</span>
              </button>
              <button 
                onClick={handleBack}
                className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl hover:bg-red-50 text-muted hover:text-red-600 transition-all border border-transparent hover:border-red-100"
                title="Cerrar Vista"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      <main className="max-w-5xl mx-auto p-6">
        {currentUser && currentUser.isActive === false ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[3rem] p-16 text-center border border-black/5 shadow-2xl shadow-black/5 max-w-2xl mx-auto mt-20"
          >
            <div className="w-24 h-24 bg-red-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
              <Shield size={48} className="text-red-600" />
            </div>
            <h2 className="text-3xl font-bold mb-4 tracking-tight">Cuenta Desactivada</h2>
            <p className="text-muted mb-8 text-lg leading-relaxed">
              Tu acceso ha sido restringido por el administrador. Por favor, ponte en contacto con el responsable de la cuenta para reactivar tu acceso.
            </p>
            <button 
              onClick={() => signOut(auth)}
              className="bg-black text-white px-10 py-4 rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/10"
            >
              Cerrar Sesión
            </button>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div 
              key="list"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-white">Mis Inventarios</h2>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={startNewInventory}
                        className="bg-black text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-black/80 transition-all active:scale-95 shadow-xl shadow-black/10 font-bold text-sm"
                      >
                        <Plus size={20} />
                        <span>Crear nuevo</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-muted text-sm font-medium">Gestiona y revisa el estado de tus propiedades en renta.</p>
                </div>
                <div className="relative w-full md:w-auto">
                  <div className="flex bg-white p-1 rounded-2xl border border-black/5 mb-3 overflow-x-auto no-scrollbar shadow-sm gap-1">
                    {([
                      { key: 'all', label: 'Todos', count: inventories.length },
                      { key: 'draft', label: 'Borradores', count: inventories.filter(i => i.status === 'draft').length },
                      { key: 'completed', label: 'Listos', count: inventories.filter(i => i.status === 'completed').length },
                      { key: 'received', label: 'Recibidos', count: inventories.filter(i => !!(i.tenantReceiveSignature || i.ownerDeliverySignature)).length },
                      { key: 'archived', label: 'Archivados', count: inventories.filter(i => i.status === 'archived').length }
                    ] as const).map((tab) => {
                      const isActive = statusFilter === tab.key;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setStatusFilter(tab.key as any)}
                          className={`px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 ${
                            isActive 
                              ? 'bg-black text-white shadow-sm' 
                              : 'text-muted hover:bg-black/5 hover:text-black'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            isActive 
                              ? 'bg-white/20 text-white' 
                              : 'bg-black/5 text-muted'
                          }`}>
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="Buscar por nombre, dirección o código..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-white border border-black/5 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-black outline-none transition-all shadow-sm"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted opacity-40">
                      <ClipboardList size={18} />
                    </div>
                  </div>
                </div>
              </div>

              {inventories.length === 0 ? (
                <div className="bg-white rounded-[2rem] p-16 text-center border border-black/5 shadow-sm">
                  <div className="w-20 h-20 bg-[#f8f9fa] rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <ClipboardList size={40} className="text-black opacity-20" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Tu lista está vacía</h3>
                  <p className="text-muted max-w-md mx-auto mb-8">Comienza a documentar el estado de tus inmuebles para tener un registro fotográfico y escrito profesional.</p>
                  <button 
                    onClick={startNewInventory}
                    className="bg-black text-white px-8 py-4 rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/10"
                  >
                    Crear nuevo
                  </button>
                </div>
              ) : filteredInventories.length === 0 ? (
                <div className="bg-white rounded-[2rem] p-16 text-center border border-black/5 shadow-sm space-y-4">
                  <div className="w-20 h-20 bg-[#f8f9fa] rounded-3xl flex items-center justify-center mx-auto text-black/30">
                    {statusFilter === 'received' ? <Key size={40} className="text-emerald-600" /> : <ClipboardList size={40} />}
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">
                      {statusFilter === 'received' 
                        ? 'No hay inventarios recibidos' 
                        : statusFilter === 'draft' 
                          ? 'No hay borradores' 
                          : statusFilter === 'completed' 
                            ? 'No hay inventarios listos' 
                            : statusFilter === 'archived'
                              ? 'No hay inventarios archivados'
                              : 'No se encontraron inventarios'}
                    </h3>
                    <p className="text-muted text-sm max-w-md mx-auto mt-2 leading-relaxed">
                      {statusFilter === 'received' 
                        ? 'Los inventarios aparecerán en este apartado cuando se hayan firmado las actas de recibido (inquilino) o entrega (propietario) al finalizar el contrato.' 
                        : searchTerm 
                          ? `No hay resultados para la búsqueda "${searchTerm}".`
                          : 'No hay propiedades que coincidan con este filtro actualmente.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                    {searchTerm && (
                      <button 
                        onClick={() => setSearchTerm('')}
                        className="bg-black/5 text-black px-6 py-2.5 rounded-xl font-bold text-xs hover:bg-black/10 transition-all"
                      >
                        Limpiar búsqueda
                      </button>
                    )}
                    {statusFilter !== 'all' && (
                      <button 
                        onClick={() => setStatusFilter('all')}
                        className="bg-black text-white px-6 py-2.5 rounded-xl font-bold text-xs hover:bg-black/80 transition-all shadow-sm"
                      >
                        Ver todos los inventarios
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredInventories.map((inv, index) => (
                    <motion.div 
                      key={inv.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ 
                        y: -8, 
                        transition: { duration: 0.2, ease: "easeOut" } 
                      }}
                      whileTap={{ scale: 0.98 }}
                      className="bg-white rounded-[2rem] border border-black/5 shadow-sm hover:shadow-2xl hover:shadow-black/5 transition-shadow group overflow-hidden flex flex-col cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        setCurrentInventory(inv);
                        setExpandedSpaces({});
                        setExpandedStatus(null);
                        navigateTo('detail');
                      }}
                    >
                      <div className="p-8 flex-1">
                        <div className="flex justify-between items-start mb-6">
                          <div className="flex flex-wrap gap-2">
                            <div className="bg-black/5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-black/60">
                              {inv.spaces.reduce((acc, s) => acc + s.photos.length, 0)} Fotos
                            </div>
                            <div className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              inv.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                              inv.status === 'archived' ? 'bg-gray-100 text-gray-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {inv.status === 'completed' ? 'Listo' : inv.status === 'archived' ? 'Archivado' : 'Borrador'}
                            </div>
                            {(inv.tenantReceiveSignature || inv.ownerDeliverySignature) && (
                              <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm ${
                                inv.tenantReceiveSignature && inv.ownerDeliverySignature 
                                  ? 'bg-emerald-600 text-white' 
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                <Key size={11} />
                                <span>{inv.tenantReceiveSignature && inv.ownerDeliverySignature ? 'Recibido Completo' : 'Acta Firmada'}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] font-bold text-muted uppercase tracking-wider opacity-60">{inv.date}</span>
                        </div>
                        
                        <h3 className="text-2xl font-bold mb-1 group-hover:text-black transition-colors line-clamp-1 tracking-tight">{inv.propertyName || 'Sin nombre'}</h3>
                        
                        {inv.internalCode && (
                          <p className="text-[10px] font-mono font-bold text-black/40 mb-3 uppercase tracking-widest">
                            Código: {inv.internalCode}
                          </p>
                        )}
                        
                        {inv.propertyType && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3 flex items-center gap-2">
                            <Home size={12} className="opacity-40" />
                            {inv.propertyType === 'Otro' ? inv.customPropertyType : inv.propertyType}
                          </p>
                        )}
                        
                        <p className="text-muted text-sm flex items-center gap-2 mb-3 line-clamp-1 font-medium">
                          <MapPin size={16} className="shrink-0 opacity-40" />
                          {inv.address || 'Sin dirección registrada'}
                        </p>

                        {(inv.tenantReceiveDate || inv.ownerDeliveryDate) && (
                          <div className="mb-4 p-2.5 bg-emerald-50/70 rounded-xl border border-emerald-100 space-y-1">
                            {inv.tenantReceiveDate && (
                              <div className="flex items-center gap-1.5 text-[10px] text-emerald-800 font-semibold">
                                <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                                <span className="truncate">Acta Inquilino: {format(new Date(inv.tenantReceiveDate), 'dd/MM/yyyy')}</span>
                              </div>
                            )}
                            {inv.ownerDeliveryDate && (
                              <div className="flex items-center gap-1.5 text-[10px] text-emerald-800 font-semibold">
                                <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                                <span className="truncate">Acta Propietario: {format(new Date(inv.ownerDeliveryDate), 'dd/MM/yyyy')}</span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {currentUser?.role === 'admin' && inv.creatorName && (
                          <div className="flex items-center gap-2 mb-8 p-3 bg-black/5 rounded-2xl">
                            <div className="w-6 h-6 bg-black rounded-lg flex items-center justify-center text-white text-[10px] font-bold">
                              {inv.creatorName[0]}
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                              <span className="text-muted">Por: </span>
                              <span className="text-black">{inv.creatorName}</span>
                            </p>
                          </div>
                        )}
                        
                        <div className="flex items-center gap-3 pt-6 border-t border-black/5">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentInventory(inv);
                              setExpandedSpaces({});
                              setExpandedStatus(null);
                              navigateTo('detail');
                            }}
                            className="flex-1 bg-black text-white py-3 rounded-2xl text-xs font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/5 active:scale-95"
                          >
                            Ver Resumen
                          </button>
                          
                          {inv.status !== 'draft' && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedInventoryForExport(inv);
                                setShowExportModal(true);
                              }}
                              className="w-12 h-12 flex items-center justify-center bg-black/5 text-black rounded-2xl hover:bg-black hover:text-white transition-all active:scale-95"
                              title="Descargar PDF"
                            >
                              <Download size={20} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="bg-[#fcfcfc] px-8 py-5 flex items-center justify-between border-t border-black/5">
                        <div className="flex flex-wrap items-center gap-3">
                          {inv.status === 'completed' ? (
                            <>
                              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                Firmado
                              </div>
                              {(inv.tenantReceiveSignature || inv.ownerDeliverySignature) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentInventory(inv);
                                    setReceptionType(null);
                                    navigateTo('reception');
                                  }}
                                  className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-800 transition-colors flex items-center gap-1.5 py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200"
                                  title="Ver Actas de Recepción"
                                >
                                  <Key size={12} />
                                  Actas
                                </button>
                              )}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleArchiveInventory(inv.id);
                                }}
                                className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors flex items-center gap-2 py-1.5 px-3 bg-black/5 rounded-lg hover:bg-black/10"
                                title="Archivar para nuevo contrato"
                              >
                                <Archive size={14} />
                                Archivar
                              </button>
                            </>
                          ) : inv.status === 'archived' ? (
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50 py-1.5 px-3 rounded-lg">
                              <Archive size={12} />
                              Archivado
                            </div>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentInventory(inv);
                                setSignatures({ 
                                  owner: inv.ownerSignature || '', 
                                  tenant: inv.tenantSignature || '' 
                                });
                                navigateTo('create');
                              }}
                              className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors flex items-center gap-2 py-1.5 px-3 bg-black/5 rounded-lg hover:bg-black/10"
                            >
                              <FileText size={14} />
                              Editar
                            </button>
                          )}
                        </div>

                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteInventory(inv.id);
                          }}
                          className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-600 transition-colors flex items-center gap-2 py-1.5 px-3 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={14} />
                          Eliminar
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'settings' && currentUser && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-4xl font-bold tracking-tight">Ajustes y Cuenta</h2>
                  <p className="text-muted text-sm font-medium mt-1">Gestiona tu perfil y suscripción.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-black rounded-3xl flex items-center justify-center text-white font-bold text-2xl shadow-xl shadow-black/10">
                      {(currentUser.firstName?.[0] || '')}{(currentUser.lastName?.[0] || '')}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">{currentUser.firstName} {currentUser.lastName}</h3>
                      <p className="text-sm text-muted">{currentUser.email}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 bg-black/5 rounded text-[10px] font-bold uppercase tracking-widest text-muted">
                        {currentUser.role === 'admin' ? 'Administrador' : 'Dependiente'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-black/5 space-y-4">
                    <button 
                      onClick={() => {
                        const nextState = !showEditProfile;
                        setShowEditProfile(nextState);
                        if (nextState) {
                          setShowUserTemplates(false);
                          setShowEditTemplates(false);
                        }
                      }}
                      className="w-full flex items-center justify-between group"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted group-hover:text-black transition-colors">Editar Perfil</p>
                      <div className={`transition-transform duration-300 ${showEditProfile ? 'rotate-180' : ''}`}>
                        <ChevronDown size={14} className="text-muted group-hover:text-black" />
                      </div>
                    </button>
                    
                    <AnimatePresence>
                      {showEditProfile && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-4"
                        >
                          <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Nombre</label>
                              <input 
                                type="text"
                                value={editFirstName}
                                onChange={(e) => setEditFirstName(e.target.value)}
                                className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all text-sm"
                                placeholder="Nombre"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Apellido</label>
                              <input 
                                type="text"
                                value={editLastName}
                                onChange={(e) => setEditLastName(e.target.value)}
                                className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all text-sm"
                                placeholder="Apellido"
                              />
                            </div>
                          </div>
                          <button 
                            onClick={handleUpdateName}
                            disabled={isSavingName || (editFirstName === currentUser.firstName && editLastName === currentUser.lastName)}
                            className="w-full py-3 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            {isSavingName ? 'Guardando...' : 'Guardar Cambios'}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="pt-6 border-t border-black/5 space-y-4">
                    <button 
                      onClick={handleLogout}
                      className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                    >
                      <LogIn size={18} className="rotate-180" />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                </div>



                {currentUser.role === 'admin' && (
                  <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-black/5 text-black rounded-xl flex items-center justify-center">
                        <Users size={20} />
                      </div>
                      <h3 className="text-xl font-bold">Gestión de Equipo</h3>
                    </div>
                    <p className="text-sm text-muted">Administra los dependientes vinculados a tu cuenta y supervisa sus inventarios.</p>
                    <button 
                      onClick={() => navigateTo('dependents')}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                    >
                      <Users size={18} />
                      <span>Ver Dependientes</span>
                      {dependents.length > 0 && (
                        <span className="ml-2 px-2 py-0.5 bg-white text-black rounded-md text-[10px]">
                          {dependents.length}
                        </span>
                      )}
                    </button>
                  </div>
                )}

                <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-black/5 text-black rounded-xl flex items-center justify-center shrink-0">
                        <ClipboardList size={20} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Plantillas de Inventarios</h3>
                        <p className="text-xs text-muted font-medium">Estructuras personalizadas para tus inmuebles.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingTemplate({
                          id: '',
                          templateName: '',
                          propertyType: 'Apartamento',
                          createdBy: currentUser.id,
                          createdAt: Date.now(),
                          structure: []
                        });
                        navigateTo('template-editor');
                      }}
                      className="w-10 h-10 flex items-center justify-center bg-black text-white rounded-xl font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/10 active:scale-95 shrink-0"
                      title="Nueva Plantilla"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <button 
                      onClick={() => {
                        const nextState = !showUserTemplates;
                        setShowUserTemplates(nextState);
                        if (nextState) {
                          setShowEditTemplates(false);
                          setShowEditProfile(false);
                        }
                      }}
                      className="w-full flex items-center justify-between group"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted group-hover:text-black transition-colors">Gestionar Plantillas</p>
                      <div className={`transition-transform duration-300 ${showUserTemplates ? 'rotate-180' : ''}`}>
                        <ChevronDown size={14} className="text-muted group-hover:text-black" />
                      </div>
                    </button>

                    <AnimatePresence>
                      {showUserTemplates && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-4 pt-2">
                            {userTemplates.length > 0 ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {userTemplates.map(template => (
                                  <div key={template.id} className="group bg-[#fcfcfc] rounded-[2rem] border border-black/5 p-6 hover:border-black hover:shadow-xl hover:shadow-black/5 transition-all flex flex-col justify-between">
                                    <div className="space-y-4">
                                      <div className="flex items-start justify-between">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                                          template.propertyType === 'Apartamento' ? 'bg-blue-50 text-blue-600' :
                                          template.propertyType === 'Casa' ? 'bg-emerald-50 text-emerald-600' :
                                          template.propertyType === 'Oficina' ? 'bg-amber-50 text-amber-600' :
                                          template.propertyType === 'Local' ? 'bg-purple-50 text-purple-600' :
                                          template.propertyType === 'Bodega' ? 'bg-orange-50 text-orange-600' :
                                          'bg-gray-50 text-gray-600'
                                        }`}>
                                          {getPropertyIcon(template.propertyType)}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <button 
                                            onClick={() => duplicateUserTemplate(template)}
                                            className="p-2 text-muted hover:text-black hover:bg-black/5 rounded-lg transition-all"
                                            title="Duplicar"
                                          >
                                            <Copy size={16} />
                                          </button>
                                          <button 
                                            onClick={() => {
                                              setEditingTemplate(template);
                                              navigateTo('template-editor');
                                            }}
                                            className="p-2 text-muted hover:text-black hover:bg-black/5 rounded-lg transition-all"
                                            title="Editar"
                                          >
                                            <FileText size={16} />
                                          </button>
                                          <button 
                                            onClick={() => deleteUserTemplate(template.id)}
                                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                            title="Eliminar"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </div>
                                      </div>
                                      
                                      <div>
                                        <h4 className="font-bold text-lg leading-tight group-hover:text-black transition-colors">{template.templateName}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{template.propertyType}</span>
                                          <span className="w-1 h-1 bg-black/10 rounded-full" />
                                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{template.structure.length} Espacios</span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="mt-6 pt-4 border-t border-black/5 flex items-center justify-between">
                                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted/60">
                                        Creada el {format(new Date(template.createdAt), 'dd/MM/yyyy')}
                                      </p>
                                      <button 
                                        onClick={() => {
                                          setEditingTemplate(template);
                                          navigateTo('template-editor');
                                        }}
                                        className="text-[10px] font-bold uppercase tracking-widest text-black flex items-center gap-1 hover:gap-2 transition-all"
                                      >
                                        Gestionar <ChevronRight size={12} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-12 text-center bg-[#f8f9fa] rounded-[2rem] border border-dashed border-black/10 flex flex-col items-center justify-center space-y-4">
                                <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center text-black/20">
                                  <ClipboardList size={32} />
                                </div>
                                <div className="max-w-xs">
                                  <h4 className="font-bold text-black">Sin plantillas personalizadas</h4>
                                  <p className="text-xs text-muted mt-1">Crea tu primera plantilla para estandarizar tus inventarios de forma rápida.</p>
                                </div>
                                <button 
                                  onClick={() => {
                                    setEditingTemplate({
                                      id: '',
                                      templateName: '',
                                      propertyType: 'Apartamento',
                                      createdBy: currentUser.id,
                                      createdAt: Date.now(),
                                      structure: []
                                    });
                                    navigateTo('template-editor');
                                  }}
                                  className="px-6 py-3 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/80 transition-all"
                                >
                                  Crear mi primera plantilla
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {currentUser.role === 'admin' && (
                  <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-black/5 text-black rounded-xl flex items-center justify-center">
                        <FileText size={20} />
                      </div>
                      <h3 className="text-xl font-bold">Plantillas de Actas</h3>
                    </div>

                    <div className="space-y-4">
                      <button 
                        onClick={() => {
                          const nextState = !showEditTemplates;
                          setShowEditTemplates(nextState);
                          if (nextState) {
                            setShowUserTemplates(false);
                            setShowEditProfile(false);
                          }
                        }}
                        className="w-full flex items-center justify-between group"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted group-hover:text-black transition-colors">Personalizar Textos</p>
                        <div className={`transition-transform duration-300 ${showEditTemplates ? 'rotate-180' : ''}`}>
                          <ChevronDown size={14} className="text-muted group-hover:text-black" />
                        </div>
                      </button>

                      <AnimatePresence>
                        {showEditTemplates && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden space-y-6"
                          >
                            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                              <p className="text-[10px] text-blue-700 font-medium leading-relaxed">
                                Usa <span className="font-bold">{'{direccion}'}</span> donde quieras que aparezca automáticamente la dirección del inmueble.
                              </p>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Plantilla Propietario (Entrega)</label>
                              <div className="bg-white rounded-2xl overflow-hidden border border-black/5">
                                <ReactQuill 
                                  theme="snow"
                                  value={ownerTemplate}
                                  onChange={setOwnerTemplate}
                                  modules={quillModules}
                                  formats={quillFormats}
                                  placeholder="Texto para el acta del propietario..."
                                />
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Plantilla Inquilino (Recibido)</label>
                              <div className="bg-white rounded-2xl overflow-hidden border border-black/5">
                                <ReactQuill 
                                  theme="snow"
                                  value={tenantTemplate}
                                  onChange={setTenantTemplate}
                                  modules={quillModules}
                                  formats={quillFormats}
                                  placeholder="Texto para el acta del inquilino..."
                                />
                              </div>
                            </div>

                            <button 
                              onClick={handleUpdateTemplates}
                              disabled={isSavingTemplates}
                              className="w-full py-3 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isSavingTemplates ? 'Guardando...' : 'Guardar Plantillas'}
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* Personalización: Modo Oscuro & Marca de la Agencia */}
                <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6 md:col-span-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-black/5">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                        <Palette size={22} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Personalización y Marca</h3>
                        <p className="text-xs text-muted">Ajusta el tema visual (Modo Oscuro/Claro) y la imagen de tu agencia para las actas y reportes PDF.</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${isDarkMode ? 'bg-neutral-900 text-amber-300 border border-neutral-700' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                        {isDarkMode ? '🌙 Modo Oscuro Activo' : '☀️ Modo Claro Activo'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Dark Mode Configuration */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-black flex items-center gap-2">
                          <Moon size={16} className="text-indigo-600" />
                          <span>Tema de la Aplicación (Modo Oscuro)</span>
                        </h4>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          Activa o desactiva el modo oscuro para personalizar tu experiencia visual y trabajar cómodamente en cualquier entorno.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => toggleDarkMode(false)}
                          className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center text-center gap-2.5 cursor-pointer ${!isDarkMode ? 'border-black bg-neutral-50 shadow-sm' : 'border-black/5 bg-white hover:bg-neutral-50'}`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-inner">
                            <Sun size={20} />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-black">Modo Claro</p>
                            <p className="text-[10px] text-muted">Luminoso y clásico</p>
                          </div>
                          {!isDarkMode && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-black bg-black/10 px-2 py-0.5 rounded-full">
                              Activo
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleDarkMode(true)}
                          className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center text-center gap-2.5 cursor-pointer ${isDarkMode ? 'border-indigo-600 bg-neutral-900 text-white shadow-sm' : 'border-black/5 bg-white hover:bg-neutral-50'}`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-indigo-950 text-indigo-400 flex items-center justify-center shadow-inner">
                            <Moon size={20} />
                          </div>
                          <div>
                            <p className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>Modo Oscuro</p>
                            <p className={`text-[10px] ${isDarkMode ? 'text-neutral-400' : 'text-muted'}`}>Elegante y descansado</p>
                          </div>
                          {isDarkMode && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-full">
                              Activo
                            </span>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Agency Brand & PDF Logo Configuration */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-black flex items-center gap-2">
                          <Building2 size={16} className="text-indigo-600" />
                          <span>Marca y Logo de la Agencia (Encabezado PDF)</span>
                        </h4>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          El logotipo y nombre configurados se imprimirán en el encabezado superior de los inventarios y actas de entrega/recibido descargadas en PDF.
                        </p>
                      </div>

                      {currentUser.role === 'admin' ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">
                              Nombre o Razón Social de la Agencia
                            </label>
                            <input
                              type="text"
                              value={editAgencyName}
                              onChange={(e) => setEditAgencyName(e.target.value)}
                              placeholder="Ej: Inmobiliaria Santander & Asociados"
                              className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">
                              Imagen o Logo de la Agencia
                            </label>
                            
                            <input
                              ref={logoInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleLogoFileChange}
                            />

                            {editAgencyLogo ? (
                              <div className="p-4 bg-[#f8f9fa] border border-black/5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                  <div className="w-20 h-16 bg-white rounded-xl border border-black/10 p-1 flex items-center justify-center overflow-hidden shadow-sm">
                                    <img
                                      src={editAgencyLogo}
                                      alt="Logo de la Agencia"
                                      className="max-w-full max-h-full object-contain"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-black">Logo cargado</p>
                                    <p className="text-[10px] text-muted">Listo para integrarse en las actas y PDFs</p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                  <button
                                    type="button"
                                    onClick={() => logoInputRef.current?.click()}
                                    className="flex-1 sm:flex-initial px-3.5 py-2 bg-white hover:bg-neutral-100 text-black border border-black/10 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                                  >
                                    Cambiar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleRemoveLogo}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                                    title="Eliminar logo"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={() => logoInputRef.current?.click()}
                                className="p-6 bg-[#f8f9fa] hover:bg-neutral-100/80 border-2 border-dashed border-black/10 hover:border-black/30 rounded-2xl cursor-pointer flex flex-col items-center justify-center text-center gap-2 transition-all group"
                              >
                                <div className="w-10 h-10 rounded-xl bg-white text-muted group-hover:text-black flex items-center justify-center shadow-sm transition-colors">
                                  <UploadCloud size={20} />
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-black">Haz clic para subir el logo</p>
                                  <p className="text-[10px] text-muted">Formatos compatibles: PNG, JPG, SVG o WebP (hasta 5MB)</p>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* PDF Header Mockup Preview */}
                          <div className="p-4 bg-gradient-to-r from-neutral-50 to-neutral-100 rounded-2xl border border-black/5 space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Vista Previa Encabezado PDF</p>
                            <div className="bg-white p-3.5 rounded-xl border border-black/10 shadow-sm flex items-center justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-[11px] font-bold text-neutral-800">Reporte de Inventario de Inmueble</p>
                                <p className="text-[9px] font-bold text-neutral-600">{editAgencyName || 'Nombre de la Agencia'}</p>
                                <p className="text-[8px] text-neutral-400">Inmueble: Apto 302 · Cra 15 #10-20</p>
                              </div>
                              {editAgencyLogo ? (
                                <div className="w-16 h-10 bg-neutral-50 rounded border border-neutral-200 p-0.5 flex items-center justify-center shrink-0">
                                  <img
                                    src={editAgencyLogo}
                                    alt="Mockup"
                                    className="max-w-full max-h-full object-contain"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : (
                                <div className="w-16 h-10 bg-neutral-100 rounded border border-dashed border-neutral-300 flex items-center justify-center text-[8px] text-neutral-400 font-bold uppercase shrink-0">
                                  Logo
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleSavePersonalization}
                            disabled={isSavingPersonalization}
                            className="w-full py-3.5 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md active:scale-95 cursor-pointer"
                          >
                            <Save size={16} />
                            <span>{isSavingPersonalization ? 'Guardando...' : 'Guardar Personalización'}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="p-5 bg-[#f8f9fa] rounded-2xl border border-black/5 space-y-3">
                          <p className="text-xs text-muted leading-relaxed">
                            Como usuario dependiente, los PDFs que generes llevarán automáticamente la marca y el logotipo configurados por tu administrador ({currentUser.adminName || 'Supervisor'}).
                          </p>
                          {currentUser.agencyLogo && (
                            <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-black/5">
                              <div className="w-14 h-10 bg-neutral-50 rounded border border-black/10 p-0.5 flex items-center justify-center shrink-0">
                                <img
                                  src={currentUser.agencyLogo}
                                  alt="Logo Administrador"
                                  className="max-w-full max-h-full object-contain"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-black">{currentUser.agencyName || 'Agencia Vinculada'}</p>
                                <p className="text-[10px] text-muted">Logo activo para tus actas e inventarios</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6 md:col-span-2">
                  {/* Unified Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-black/5">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                        <Key size={22} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Licencia de Uso</h3>
                        <p className="text-xs text-muted">Gestión unificada de vigencia y activación (6 meses)</p>
                      </div>
                    </div>

                    {/* Status Pill in Header */}
                    <div>
                      {currentUser.role === 'admin' ? (
                        (() => {
                          if (currentUser.email === 'djbtorreglosa@gmail.com') {
                            return (
                              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
                                Admin Principal (Ilimitado)
                              </span>
                            );
                          }
                          const isExpired = !currentUser.expirationDate || new Date(currentUser.expirationDate) < new Date();
                          if (isExpired) {
                            return (
                              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                                <span className="w-2 h-2 rounded-full bg-red-600" />
                                Licencia Vencida
                              </span>
                            );
                          }
                          const date = new Date(currentUser.expirationDate);
                          const now = new Date();
                          const diffTime = Math.abs(date.getTime() - now.getTime());
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                          return (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <span className="w-2 h-2 rounded-full bg-emerald-600" />
                              Activa · {diffDays} {diffDays === 1 ? 'día restante' : 'días restantes'}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                          Dependiente Vinculado
                        </span>
                      )}
                    </div>
                  </div>

                  {currentUser.role === 'admin' ? (
                    <div className="space-y-6">
                      {/* Summary Cards Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-5 bg-[#f8f9fa] rounded-2xl border border-black/5 space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Tipo de Plan</p>
                          <p className="text-base font-bold text-black">
                            {currentUser.email === 'djbtorreglosa@gmail.com' ? 'Super Admin Maestro' : 'Licencia Semestral'}
                          </p>
                          <p className="text-xs text-muted">180 días de acceso total</p>
                        </div>

                        <div className="p-5 bg-[#f8f9fa] rounded-2xl border border-black/5 space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Fecha de Vencimiento</p>
                          <p className="text-base font-bold text-black">
                            {(() => {
                              if (currentUser.email === 'djbtorreglosa@gmail.com') return 'Permanente';
                              if (!currentUser.expirationDate) return 'Sin activar';
                              try {
                                const date = new Date(currentUser.expirationDate);
                                return isNaN(date.getTime()) ? 'N/A' : format(date, 'dd/MM/yyyy');
                              } catch {
                                return 'N/A';
                              }
                            })()}
                          </p>
                          <p className="text-xs text-muted">
                            {(() => {
                              if (currentUser.email === 'djbtorreglosa@gmail.com') return 'Sin caducidad';
                              if (!currentUser.expirationDate) return 'Requiere código';
                              const date = new Date(currentUser.expirationDate);
                              return date >= new Date() ? 'En periodo activo' : 'Acceso caducado';
                            })()}
                          </p>
                        </div>

                        <div className="p-5 bg-[#f8f9fa] rounded-2xl border border-black/5 space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Código en Uso</p>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-mono font-bold text-black truncate max-w-[140px]">
                              {currentUser.licenseCode || (currentUser.email === 'djbtorreglosa@gmail.com' ? 'MASTER-ACCOUNT' : 'Ninguno')}
                            </span>
                            {currentUser.licenseCode && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(currentUser.licenseCode || '');
                                  showNotify('Código copiado');
                                }}
                                className="p-1 text-muted hover:text-black transition-colors"
                                title="Copiar código"
                              >
                                <Copy size={13} />
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-muted">Licencia asociada</p>
                        </div>
                      </div>

                      {/* Unified Activation & Purchase Section */}
                      <div className="p-6 bg-gradient-to-br from-[#fcfcfc] to-[#f8f9fa] rounded-2xl border border-black/5 space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-black flex items-center gap-2">
                            <Key size={15} className="text-amber-600" />
                            <span>Activar o Renovar Licencia de 6 Meses</span>
                          </h4>
                          <p className="text-xs text-muted mt-1 leading-relaxed">
                            Ingresa un código de 6 meses para activar tu cuenta o agregar 180 días adicionales a tu fecha de vencimiento actual.
                          </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                          <div className="relative flex-1">
                            <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted opacity-40" size={16} />
                            <input
                              type="text"
                              value={newLicenseCode}
                              onChange={(e) => setNewLicenseCode(e.target.value.toUpperCase())}
                              placeholder="Ej: CHK-6M-XXXX-XXXX"
                              className="w-full pl-10 pr-4 py-3 bg-white border border-black/10 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-black outline-none uppercase shadow-inner"
                            />
                          </div>
                          <button
                            onClick={() => activateLicenseCode(newLicenseCode)}
                            disabled={isActivatingCode || !newLicenseCode.trim()}
                            className="px-6 py-3 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-40 whitespace-nowrap shadow-sm active:scale-95"
                          >
                            <Check size={14} />
                            <span>{isActivatingCode ? 'Activando...' : 'Aplicar Código'}</span>
                          </button>
                        </div>

                        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs border-t border-black/5">
                          <span className="text-muted text-[11px]">¿No tienes un código de activación o necesitas renovar?</span>
                          <a
                            href="https://wa.me/573177694857?text=Hola,%20deseo%20adquirir%20un%20c%C3%B3digo%20de%20licencia%20temporal%20de%206%20meses%20para%20CheckIn%20App"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-1.5 rounded-lg font-bold border border-emerald-200 transition-colors"
                          >
                            <ShoppingCart size={13} />
                            <span>Adquirir Licencia por WhatsApp</span>
                          </a>
                        </div>
                      </div>

                      {/* Super Admin Unified Code Management Suite */}
                      {currentUser.email === 'djbtorreglosa@gmail.com' && (
                        <div className="pt-6 border-t border-black/10 space-y-5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                Panel Maestro Super Admin
                              </span>
                              <h4 className="text-base font-bold mt-1">Generador y Control de Códigos Semestrales</h4>
                            </div>
                            <button
                              onClick={generateNew6MonthLicense}
                              disabled={isGeneratingLicense}
                              className="px-4 py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 active:scale-95"
                            >
                              <Plus size={14} />
                              <span>{isGeneratingLicense ? 'Generando...' : 'Generar Nuevo Código (6 Meses)'}</span>
                            </button>
                          </div>

                          {/* Filters and Search */}
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="flex items-center gap-1.5 w-full sm:w-auto">
                              <button
                                onClick={() => setLicenseFilter('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${licenseFilter === 'all' ? 'bg-black text-white' : 'bg-[#f8f9fa] text-muted hover:bg-black/5'}`}
                              >
                                Todos ({licensesList.length})
                              </button>
                              <button
                                onClick={() => setLicenseFilter('available')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${licenseFilter === 'available' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                              >
                                Disponibles ({licensesList.filter(l => !l.isUsed).length})
                              </button>
                              <button
                                onClick={() => setLicenseFilter('used')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${licenseFilter === 'used' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                              >
                                Usados ({licensesList.filter(l => l.isUsed).length})
                              </button>
                            </div>

                            <div className="relative w-full sm:w-64">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted opacity-40" size={14} />
                              <input
                                type="text"
                                value={licenseSearchQuery}
                                onChange={(e) => setLicenseSearchQuery(e.target.value)}
                                placeholder="Buscar código o email..."
                                className="w-full pl-9 pr-3 py-1.5 bg-[#f8f9fa] border border-black/5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-black"
                              />
                            </div>
                          </div>

                          {/* List of Codes */}
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {(() => {
                              const q = licenseSearchQuery.trim().toLowerCase();
                              const filtered = licensesList.filter(l => {
                                if (licenseFilter === 'available' && l.isUsed) return false;
                                if (licenseFilter === 'used' && !l.isUsed) return false;
                                if (q) {
                                  const matchCode = l.code?.toLowerCase().includes(q);
                                  const matchEmail = l.assignedEmail?.toLowerCase().includes(q);
                                  return matchCode || matchEmail;
                                }
                                return true;
                              });

                              if (filtered.length === 0) {
                                return (
                                  <div className="p-8 text-center bg-[#f8f9fa] rounded-2xl border border-dashed border-black/10">
                                    <p className="text-xs text-muted">No se encontraron códigos con los criterios seleccionados.</p>
                                  </div>
                                );
                              }

                              return filtered.map((lic) => (
                                <div
                                  key={lic.code}
                                  className="p-3.5 bg-[#f8f9fa] hover:bg-[#f3f4f6] rounded-xl border border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-bold tracking-wider text-black">{lic.code}</span>
                                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${lic.isUsed ? 'bg-neutral-200 text-neutral-700' : 'bg-emerald-100 text-emerald-800'}`}>
                                        {lic.isUsed ? 'Usado' : 'Disponible'}
                                      </span>
                                      <span className="text-[10px] text-muted bg-white px-2 py-0.5 rounded border border-black/5 font-medium">6 Meses</span>
                                    </div>
                                    <p className="text-[11px] text-muted">
                                      {lic.isUsed && lic.assignedEmail ? (
                                        <>Activado por: <span className="font-semibold text-black">{lic.assignedEmail}</span></>
                                      ) : (
                                        <>Creado: {lic.createdAt ? format(new Date(lic.createdAt), 'dd/MM/yyyy HH:mm') : 'N/A'}</>
                                      )}
                                      {lic.expiresAt && ` · Vence: ${format(new Date(lic.expiresAt), 'dd/MM/yyyy')}`}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(lic.code);
                                        setCopiedLicenseCode(lic.code);
                                        setTimeout(() => setCopiedLicenseCode(null), 2000);
                                        showNotify('Código copiado al portapapeles');
                                      }}
                                      className="px-3 py-1.5 bg-white hover:bg-black hover:text-white text-black border border-black/10 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                                      title="Copiar Código"
                                    >
                                      <Copy size={12} />
                                      <span>{copiedLicenseCode === lic.code ? '¡Copiado!' : 'Copiar'}</span>
                                    </button>
                                  </div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-6 bg-[#f8f9fa] rounded-2xl border border-black/5 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted">Administrador Responsable</p>
                      <p className="text-lg font-bold text-black">{currentUser.adminName || 'Administrador Asignado'}</p>
                      <p className="text-xs text-muted leading-relaxed">
                        Tu cuenta está vinculada a una cuenta administradora ({currentUser.adminEmail || 'supervisor'}). Tu vigencia y acceso a las funciones operativas se encuentran cubiertos bajo su licencia temporal.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'template-editor' && editingTemplate && (
            <motion.div
              key="template-editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <h2 className="text-4xl font-bold tracking-tight">
                      {editingTemplate.id ? 'Editar Plantilla' : 'Nueva Plantilla'}
                    </h2>
                    <p className="text-muted text-sm font-medium mt-1">Define la estructura base para tus inventarios.</p>
                  </div>
                </div>
                <button 
                  onClick={() => saveUserTemplate(editingTemplate)}
                  disabled={isSavingTemplate || !editingTemplate.templateName}
                  className="px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center gap-2 shadow-xl shadow-black/10 disabled:opacity-50"
                >
                  <Save size={18} />
                  <span>{isSavingTemplate ? 'Guardando...' : 'Guardar Plantilla'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1 space-y-6">
                  <div className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Nombre de la Plantilla</label>
                      <input 
                        type="text"
                        value={editingTemplate.templateName}
                        onChange={(e) => setEditingTemplate({...editingTemplate, templateName: e.target.value})}
                        className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all text-sm font-bold"
                        placeholder="Ej: Apartamento Estándar"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Tipo de Inmueble</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Apartamento', 'Casa', 'Oficina', 'Local', 'Bodega', 'Otro'].map((type) => (
                          <button
                            key={type}
                            onClick={() => setEditingTemplate({...editingTemplate, propertyType: type as any})}
                            className={`py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
                              editingTemplate.propertyType === type 
                                ? 'bg-black text-white border-black' 
                                : 'bg-white text-muted border-black/5 hover:border-black/20'
                            }`}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-black text-white rounded-[2rem] p-8 shadow-xl shadow-black/10">
                    <h4 className="font-bold mb-2">Consejo</h4>
                    <p className="text-xs text-white/60 leading-relaxed">
                      Las plantillas te permiten ahorrar tiempo. Define los espacios y elementos comunes que sueles encontrar en este tipo de inmuebles.
                    </p>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold">Estructura de Espacios</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setShowSpaceSelector(true)}
                        className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-2xl text-sm font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/10 active:scale-95"
                      >
                        <Plus size={18} />
                        Añadir espacio
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {editingTemplate.structure.map((space, spaceIndex) => (
                      <div key={space.id} className="bg-white rounded-[2rem] border border-black/5 shadow-sm overflow-hidden">
                        <div className="p-6 flex items-center justify-between bg-[#fcfcfc] border-b border-black/5">
                          <div className="flex-1 mr-4">
                            <input 
                              type="text"
                              value={space.title}
                              onChange={(e) => {
                                const newStructure = [...editingTemplate.structure];
                                newStructure[spaceIndex].title = e.target.value;
                                setEditingTemplate({...editingTemplate, structure: newStructure});
                              }}
                              className="w-full bg-transparent border-none p-0 focus:ring-0 outline-none text-lg font-bold"
                              placeholder="Nombre del espacio (ej: Sala, Cocina...)"
                            />
                          </div>
                          <button 
                            onClick={() => {
                              const newStructure = editingTemplate.structure.filter(s => s.id !== space.id);
                              setEditingTemplate({...editingTemplate, structure: newStructure});
                            }}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Elementos</label>
                            <button 
                              onClick={() => {
                                const newStructure = [...editingTemplate.structure];
                                newStructure[spaceIndex].elements = [...newStructure[spaceIndex].elements, ''];
                                setEditingTemplate({...editingTemplate, structure: newStructure});
                              }}
                              className="text-[10px] font-bold uppercase tracking-widest text-black hover:opacity-70 flex items-center gap-1"
                            >
                              <Plus size={12} />
                              Añadir Elemento
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {space.elements.map((element, elementIndex) => (
                              <div key={elementIndex} className="flex items-center gap-2 bg-[#f8f9fa] p-2 rounded-xl border border-black/5">
                                <input 
                                  type="text"
                                  value={element}
                                  onChange={(e) => {
                                    const newStructure = [...editingTemplate.structure];
                                    newStructure[spaceIndex].elements[elementIndex] = e.target.value;
                                    setEditingTemplate({...editingTemplate, structure: newStructure});
                                  }}
                                  className="flex-1 bg-transparent border-none p-1 focus:ring-0 outline-none text-xs font-medium"
                                  placeholder="Ej: Paredes, Piso..."
                                />
                                <button 
                                  onClick={() => {
                                    const newStructure = [...editingTemplate.structure];
                                    newStructure[spaceIndex].elements = newStructure[spaceIndex].elements.filter((_, i) => i !== elementIndex);
                                    setEditingTemplate({...editingTemplate, structure: newStructure});
                                  }}
                                  className="p-1.5 text-muted hover:text-red-600 transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                          
                          {space.elements.length === 0 && (
                            <p className="text-center py-4 text-[10px] text-muted italic">No hay elementos definidos para este espacio.</p>
                          )}
                        </div>
                      </div>
                    ))}

                    {editingTemplate.structure.length === 0 && (
                      <div className="py-20 text-center bg-white rounded-[2rem] border border-dashed border-black/10">
                        <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Plus size={32} className="text-black/20" />
                        </div>
                        <h4 className="font-bold text-lg">Empieza a diseñar tu plantilla</h4>
                        <p className="text-sm text-muted max-w-xs mx-auto mt-2">Añade espacios como "Sala", "Cocina" o "Baños" y define qué elementos quieres calificar en cada uno.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'dependents' && currentUser?.role === 'admin' && (
            <motion.div 
              key="dependents"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-4xl font-bold tracking-tight">Mis Dependientes</h2>
                  <p className="text-muted text-sm font-medium mt-1">Dependientes vinculados a tu cuenta de administrador.</p>
                </div>
              </div>

              {dependents.length === 0 ? (
                <div className="bg-white rounded-[2rem] p-16 text-center border border-black/5 shadow-sm">
                  <div className="w-20 h-20 bg-[#f8f9fa] rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Users size={40} className="text-black opacity-20" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">No tienes dependientes</h3>
                  <p className="text-muted max-w-md mx-auto">Cuando un dependiente se registre usando tu correo (<strong>{currentUser?.email}</strong>), aparecerá aquí.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {dependents.map((dep) => (
                    <motion.div 
                      key={dep.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm hover:shadow-xl hover:shadow-black/5 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white font-bold text-xl">
                            {(dep.firstName?.[0] || '')}{(dep.lastName?.[0] || '')}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">{dep.firstName || 'Sin nombre'} {dep.lastName || ''}</h3>
                            <p className="text-xs text-muted font-medium">{dep.email}</p>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest ${dep.isActive !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {dep.isActive !== false ? 'Activo' : 'Desactivado'}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="pt-6 border-t border-black/5 flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Inventarios creados</span>
                            <span className="text-xl font-bold">{inventories.filter(i => i.createdBy === dep.id).length}</span>
                          </div>
                          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                            <ClipboardList size={20} />
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted">
                          <span>Miembro desde</span>
                          <span>{(() => {
                            try {
                              const createdAt = (dep as any).createdAt;
                              if (!createdAt) return 'N/A';
                              const date = new Date(createdAt);
                              return isNaN(date.getTime()) ? 'N/A' : format(date, 'dd/MM/yyyy');
                            } catch (e) {
                              return 'N/A';
                            }
                          })()}</span>
                        </div>

                        <div className="flex items-center gap-2 pt-6 border-t border-black/5">
                          <button 
                            onClick={() => setSelectedDependentForInventories(dep)}
                            className="flex-1 py-3 bg-black text-white rounded-2xl flex items-center justify-center gap-2 text-xs font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/5"
                          >
                            <ClipboardList size={14} />
                            <span>Ver Inventarios</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2 pt-2">
                          <button 
                            onClick={() => toggleDependentStatus(dep)}
                            className={`flex-1 py-3 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${dep.isActive !== false ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                          >
                            {dep.isActive !== false ? <Power size={14} /> : <CheckCircle2 size={14} />}
                            <span>{dep.isActive !== false ? 'Desactivar' : 'Activar'}</span>
                          </button>
                          <button 
                            onClick={() => deleteDependent(dep)}
                            className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center hover:bg-red-100 transition-all"
                            title="Eliminar"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'detail' && currentInventory && (
            <motion.div 
              key="detail"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-end gap-3">
                {currentInventory.status !== 'draft' && (
                  <button 
                    onClick={() => {
                      setSelectedInventoryForExport(currentInventory);
                      setShowExportModal(true);
                    }}
                    className="bg-black text-white px-5 py-2.5 rounded-xl flex items-center gap-2 hover:bg-black/80 transition-all font-medium text-sm"
                  >
                    <Download size={18} />
                    Exportar PDF
                  </button>
                )}
                <button 
                  onClick={() => handleDeleteInventory(currentInventory.id)}
                  className="w-10 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition-all"
                  title="Eliminar Inventario"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="bg-white rounded-[2.5rem] p-10 border border-black/5 shadow-sm space-y-10">
                <div className="border-b border-black/5 pb-8">
                  <h2 className="text-4xl font-bold tracking-tight mb-4">{currentInventory.propertyName}</h2>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 text-muted font-medium">
                    <div className="flex items-center gap-2">
                      <MapPin size={18} className="text-black/20" />
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Dirección</p>
                        <p className="text-sm text-black">{currentInventory.address}</p>
                      </div>
                    </div>
                    {currentInventory.neighborhood && (
                      <div className="flex items-center gap-2">
                        <Home size={18} className="text-black/20" />
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Barrio</p>
                          <p className="text-sm text-black">{currentInventory.neighborhood}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar size={18} className="text-black/20" />
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Fecha</p>
                        <p className="text-sm text-black">{currentInventory.date}</p>
                      </div>
                    </div>
                    {currentInventory.propertyType && (
                      <div className="flex items-center gap-2">
                        <Home size={18} className="text-black/20" />
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Tipo de Inmueble</p>
                          <p className="text-sm text-black">
                            {currentInventory.propertyType === 'Otro' ? currentInventory.customPropertyType : currentInventory.propertyType}
                          </p>
                        </div>
                      </div>
                    )}
                    {currentInventory.rentValue && (
                      <div className="flex items-center gap-2">
                        <FileText size={18} className="text-black/20" />
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Arrendamiento</p>
                          <p className="text-sm text-black">{currentInventory.rentValue}</p>
                        </div>
                      </div>
                    )}
                    {currentInventory.internalCode && (
                      <div className="flex items-center gap-2">
                        <ClipboardList size={18} className="text-black/20" />
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Código Interno</p>
                          <p className="text-sm text-black">{currentInventory.internalCode}</p>
                        </div>
                      </div>
                    )}
                    {currentUser?.role === 'admin' && currentInventory.creatorName && (
                      <div className="flex items-center gap-2">
                        <UserIcon size={18} className="text-black/20" />
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-50">Responsable</p>
                          <p className="text-sm text-black">{currentInventory.creatorName}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {(currentInventory.ownerName || currentInventory.tenantName) && (
                    <div className="grid sm:grid-cols-2 gap-6 mt-8 pt-8 border-t border-black/5">
                      {currentInventory.ownerName && (
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1">Propietario</p>
                          <p className="font-bold">{currentInventory.ownerName}</p>
                        </div>
                      )}
                      {currentInventory.tenantName && (
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1">Inquilino</p>
                          <p className="font-bold">{currentInventory.tenantName}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* General Summary Section */}
                <div className="bg-[#f8f9fa] rounded-[2.5rem] p-8 border border-black/5">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center shadow-lg shadow-black/10">
                      <LayoutDashboard size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold tracking-tight">Resumen del Estado</h3>
                      <p className="text-muted text-xs font-medium">Análisis consolidado de las condiciones del inmueble.</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Excelente', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: <CheckCircle2 size={14} /> },
                      { label: 'Bueno', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: <CheckCircle2 size={14} /> },
                      { label: 'Regular', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', icon: <ClipboardList size={14} /> },
                      { label: 'Malo', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100', icon: <ClipboardList size={14} /> },
                    ].map((stat) => {
                      const count = currentInventory.spaces.reduce((acc, s) => acc + s.items.filter(i => i.condition === stat.label).length, 0);

                      return (
                        <div 
                          key={stat.label} 
                          onClick={() => count > 0 && setExpandedStatus(stat.label)}
                          className={`${stat.bg} rounded-3xl p-5 border ${stat.border} flex flex-col group relative overflow-hidden transition-all duration-300 ${count > 0 ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-95' : 'opacity-80'}`}
                        >
                          <p className={`text-[10px] uppercase tracking-widest font-black ${stat.color} mb-1 flex items-center gap-1.5`}>
                            {stat.icon}
                            {stat.label}
                          </p>
                          <div className="flex items-end justify-between">
                            <p className="text-3xl font-black tracking-tighter">{count}</p>
                            {count > 0 && (
                              <div className="w-6 h-6 bg-black/5 rounded-full flex items-center justify-center text-muted group-hover:bg-black group-hover:text-white transition-all">
                                <ChevronRight size={12} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Status Details Modal */}
                  <AnimatePresence>
                    {expandedStatus && (
                      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setExpandedStatus(null)}
                          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: 20 }}
                          className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                        >
                          {/* Modal Header */}
                          <div className="p-8 border-b border-black/5 flex items-center justify-between bg-[#f8f9fa]">
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${
                                expandedStatus === 'Excelente' ? 'bg-emerald-100 text-emerald-600' :
                                expandedStatus === 'Bueno' ? 'bg-blue-100 text-blue-600' :
                                expandedStatus === 'Regular' ? 'bg-amber-100 text-amber-600' :
                                'bg-red-100 text-red-600'
                              }`}>
                                {expandedStatus === 'Excelente' || expandedStatus === 'Bueno' ? <CheckCircle2 size={24} /> : <ClipboardList size={24} />}
                              </div>
                              <div>
                                <h4 className="text-xl font-black tracking-tight">Ítems en estado {expandedStatus}</h4>
                                <p className="text-muted text-xs font-medium">Listado detallado por áreas del inmueble.</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => setExpandedStatus(null)}
                              className="w-10 h-10 bg-black/5 rounded-full flex items-center justify-center hover:bg-black hover:text-white transition-all"
                            >
                              <X size={20} />
                            </button>
                          </div>

                          {/* Modal Content */}
                          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            <div className="space-y-4">
                              {currentInventory.spaces.flatMap(s => 
                                s.items.filter(i => i.condition === expandedStatus).map(i => ({ ...i, spaceName: s.title }))
                              ).map((item, idx) => (
                                <div key={idx} className="bg-[#f8f9fa] rounded-3xl p-5 border border-black/5 flex flex-col gap-2 hover:border-black/10 transition-colors">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-black/5 rounded-md text-[9px] font-black uppercase tracking-wider text-muted">
                                          {item.spaceName}
                                        </span>
                                        <span className="text-sm font-bold text-black/80">{item.name}</span>
                                      </div>
                                      {item.details && (
                                        <p className="text-xs text-muted/70 italic leading-relaxed pl-2 border-l-2 border-black/10">
                                          {item.details}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Modal Footer */}
                          <div className="p-6 border-t border-black/5 bg-[#f8f9fa] flex justify-center">
                            <button 
                              onClick={() => setExpandedStatus(null)}
                              className="px-8 py-3 bg-black text-white rounded-2xl text-xs font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/10 active:scale-95"
                            >
                              Entendido
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold">Áreas del Inmueble</h3>
                    <button 
                      onClick={() => {
                        const allExpanded = currentInventory.spaces.every(s => expandedSpaces[s.id]);
                        const newState: Record<string, boolean> = {};
                        if (!allExpanded) {
                          currentInventory.spaces.forEach(s => newState[s.id] = true);
                        }
                        setExpandedSpaces(newState);
                      }}
                      className="text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black transition-colors"
                    >
                      {currentInventory.spaces.every(s => expandedSpaces[s.id]) ? 'Contraer todo' : 'Expandir todo'}
                    </button>
                  </div>

                  {currentInventory.spaces.map((space) => {
                    const isExpanded = expandedSpaces[space.id];
                    return (
                      <div key={space.id} className="bg-white border border-black/5 rounded-[2rem] overflow-hidden shadow-sm">
                        <button 
                          onClick={() => toggleSpace(space.id)}
                          className="w-full flex items-center justify-between p-6 hover:bg-black/5 transition-all text-left"
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isExpanded ? 'bg-black text-white' : 'bg-[#f8f9fa] text-black/40'}`}>
                              <Home size={20} />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold">{space.title}</h3>
                              <p className="text-muted text-xs line-clamp-1">{space.description}</p>
                            </div>
                          </div>
                          <div className={`w-8 h-8 rounded-full bg-[#f8f9fa] flex items-center justify-center transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                            <ChevronDown size={16} />
                          </div>
                        </button>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-6 pt-0 space-y-4">
                                {space.items.map((item) => (
                                  <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#f8f9fa] border border-black/5">
                                    <div>
                                      <h4 className="font-bold text-sm">{item.name}</h4>
                                      {item.details && <p className="text-xs text-muted mt-1">{item.details}</p>}
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest self-start sm:self-center ${
                                      item.condition === 'Excelente' ? 'bg-emerald-50 text-emerald-700' :
                                      item.condition === 'Bueno' ? 'bg-blue-50 text-blue-700' :
                                      item.condition === 'Regular' ? 'bg-amber-50 text-amber-700' :
                                      'bg-red-50 text-red-700'
                                    }`}>
                                      {item.condition}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                {/* Collapsible Photo Evidence Section */}
                <div className="pt-10 border-t border-black/5">
                  <button 
                    onClick={() => setShowPhotosInDetail(!showPhotosInDetail)}
                    className="w-full flex items-center justify-between p-8 bg-[#f8f9fa] border border-black/5 rounded-[2.5rem] hover:bg-black/5 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:bg-black group-hover:text-white transition-all">
                        <ImageIcon size={24} />
                      </div>
                      <div className="text-left">
                        <h3 className="text-xl font-bold">Evidencia Fotográfica</h3>
                        <p className="text-xs text-muted font-medium">Ver todas las fotos organizadas por sección</p>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                      {showPhotosInDetail ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </button>
                  
                  <AnimatePresence>
                    {showPhotosInDetail && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-10 space-y-12">
                          {currentInventory.spaces.map((space) => space.photos.length > 0 && (
                            <div key={space.id} className="space-y-6">
                              <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-black/5" />
                                <h4 className="text-xs font-bold uppercase tracking-widest text-muted">{space.title}</h4>
                                <div className="h-px flex-1 bg-black/5" />
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {space.photos.map((photo) => (
                                  <div 
                                    key={photo.id} 
                                    onClick={async () => {
                                      const displayUrl = await getPhotoDisplayUrl(photo);
                                      setFullscreenPhoto({
                                        url: displayUrl,
                                        title: space.title,
                                        date: format(photo.timestamp, 'dd/MM/yyyy HH:mm'),
                                        canDelete: false
                                      });
                                    }}
                                    className="aspect-square rounded-2xl overflow-hidden border border-black/5 group/photo relative cursor-pointer"
                                  >
                                    <PhotoThumb 
                                      photo={photo} 
                                      alt="Evidencia" 
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover/photo:scale-110"
                                      showSyncBadge={true}
                                    />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center text-white">
                                      <Maximize2 size={24} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {(currentInventory.status === 'completed' || currentInventory.ownerSignature || currentInventory.tenantSignature) && (
                  <div className="pt-10 border-t border-black/5">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-xl font-bold">Firmas de Conformidad</h3>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-10">
                      <div className="space-y-4">
                        <div className="aspect-[3/1] bg-[#f8f9fa] rounded-2xl border border-black/5 flex items-center justify-center overflow-hidden">
                          {currentInventory.ownerSignature ? (
                            <img src={currentInventory.ownerSignature} alt="Firma Propietario" className="max-h-full" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-xs text-muted italic">Sin firma</span>
                          )}
                        </div>
                        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-muted">Propietario / Arrendador</p>
                      </div>
                      <div className="space-y-4">
                        <div className="aspect-[3/1] bg-[#f8f9fa] rounded-2xl border border-black/5 flex items-center justify-center overflow-hidden">
                          {currentInventory.tenantSignature ? (
                            <img src={currentInventory.tenantSignature} alt="Firma Inquilino" className="max-h-full" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-xs text-muted italic">Sin firma</span>
                          )}
                        </div>
                        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-muted">Inquilino / Arrendatario</p>
                      </div>
                    </div>

                    {/* Annexes Section */}
                    {currentInventory.status === 'completed' && (
                      <div className="mt-16 pt-10 border-t border-black/5">
                        <div className="flex items-center justify-between mb-8">
                          <div>
                            <h3 className="text-xl font-bold">Anexos y Modificaciones</h3>
                            <p className="text-muted text-xs font-medium mt-1">Registros adicionales realizados después de la firma.</p>
                          </div>
                          <button 
                            onClick={() => setShowAnnexModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl hover:bg-black/80 transition-all text-xs font-bold shadow-lg shadow-black/10"
                          >
                            <Plus size={14} />
                            <span>Añadir Anexo</span>
                          </button>
                        </div>

                        {currentInventory.annexes && currentInventory.annexes.length > 0 ? (
                          <div className="space-y-6">
                            {currentInventory.annexes.map((annex) => (
                              <div key={annex.id} className="p-6 rounded-[2rem] bg-[#f8f9fa] border border-black/5 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                                      <FileText size={16} />
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold">{annex.creatorName}</p>
                                      <p className="text-[10px] text-muted">
                                        {annex.createdAt ? new Date(annex.createdAt).toLocaleString() : 'N/A'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <p className="text-sm text-black/80 leading-relaxed">{annex.text}</p>
                                {annex.photos && annex.photos.length > 0 && (
                                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 pt-2">
                                    {annex.photos.map((photo) => (
                                      <div 
                                        key={photo.id} 
                                        onClick={async () => {
                                          const displayUrl = await getPhotoDisplayUrl(photo);
                                          setFullscreenPhoto({
                                            url: displayUrl,
                                            title: 'Foto de Anexo',
                                            date: annex.createdAt ? new Date(annex.createdAt).toLocaleString() : undefined,
                                            canDelete: false
                                          });
                                        }}
                                        className="aspect-square rounded-xl overflow-hidden border border-black/5 cursor-pointer group/annex relative"
                                      >
                                        <PhotoThumb 
                                          photo={photo} 
                                          alt="Anexo" 
                                          className="w-full h-full object-cover group-hover/annex:scale-110 transition-transform"
                                          showSyncBadge={true}
                                        />
                                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/annex:opacity-100 transition-opacity flex items-center justify-center text-white">
                                          <Maximize2 size={16} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 bg-[#f8f9fa] rounded-[2rem] border border-dashed border-black/5">
                            <p className="text-muted text-sm italic">No hay anexos registrados para este inventario.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {currentInventory.status === 'completed' && currentInventory.ownerSignature && currentInventory.tenantSignature && (
                  <div className="pt-16 border-t border-black/5 flex justify-center">
                    <button 
                      onClick={() => {
                        setReceptionType(null);
                        navigateTo('reception');
                      }}
                      className="bg-emerald-600 text-white px-12 py-5 rounded-[2.5rem] flex items-center gap-4 hover:bg-emerald-700 transition-all font-bold text-xl shadow-2xl shadow-emerald-100 w-full sm:w-auto justify-center group"
                    >
                      <Key size={28} className="group-hover:rotate-12 transition-transform" />
                      <span>{currentInventory.tenantReceiveSignature && currentInventory.ownerDeliverySignature ? 'Inmueble Recibido' : 'Recibir Inmueble'}</span>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'reception' && currentInventory && (
            <motion.div 
              key="reception"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="flex items-center gap-4">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Recepción de Inmueble</h2>
                  <p className="text-muted font-medium">Finalización del contrato y entrega de llaves.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {/* Top buttons removed as per request */}
              </div>

              {!receptionType ? (
                <div className="space-y-8">
                  <div className="grid sm:grid-cols-2 gap-8">
                    {/* Owner Card */}
                    <div className="bg-white dark:bg-[#121212] p-10 rounded-[2.5rem] border border-black/5 dark:border-white/10 shadow-sm hover:shadow-xl transition-all text-center space-y-6 flex flex-col items-center">
                      <div className="w-20 h-20 bg-black/5 dark:bg-white/5 rounded-3xl flex items-center justify-center text-black dark:text-white">
                        <UserIcon size={40} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold mb-2 text-black dark:text-white">Acta Propietario</h3>
                        <p className="text-muted dark:text-gray-400 text-sm font-medium">Documento de entrega y recepción de llaves por parte del dueño.</p>
                      </div>
                      
                      <div className="w-full space-y-3">
                        {currentInventory.ownerDeliverySignature ? (
                          <>
                            <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 py-2 px-4 rounded-full text-xs font-bold inline-block mb-2">
                              ✓ Completado y Firmado
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                              <button 
                                onClick={() => exportToPDF(currentInventory, 'reception_owner')}
                                className="w-full bg-black dark:bg-white text-white dark:text-black py-3 px-6 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg"
                              >
                                <Download size={16} />
                                Descargar Acta Propietario
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-3">
                            {currentInventory.remoteSigningTokens?.reception_owner?.token && !currentInventory.remoteSigningTokens?.reception_owner?.signed && (
                              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300 py-2 px-3 rounded-2xl text-xs font-medium flex items-center justify-center gap-2">
                                <Mail size={14} />
                                <span>Enlace remoto enviado ({currentInventory.remoteSigningTokens.reception_owner.email})</span>
                              </div>
                            )}
                            <button 
                              onClick={() => {
                                setReceptionType('owner');
                                setReceptionSignMethod('presencial');
                                setReceptionName(currentInventory.ownerName || '');
                                setReceptionEmail(currentInventory.ownerEmail || '');
                                setRemoteLinkSentSuccess(null);
                                const template = ownerTemplate || `<p>Yo, como propietario, dejo constancia de haber recibido el inmueble ubicado en <b>{direccion}</b>, en las condiciones descritas en el inventario adjunto, junto con las llaves correspondientes.</p>`;
                                const finalText = template.replace(/{direccion}/g, currentInventory.address);
                                setReceptionText(currentInventory.ownerDeliveryText || finalText);
                                setReceptionSignature(currentInventory.ownerDeliverySignature || '');
                              }}
                              className="w-full bg-black dark:bg-white text-white dark:text-black py-3 px-8 rounded-2xl text-sm font-bold hover:scale-105 transition-transform"
                            >
                              Comenzar Acta
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Tenant Card */}
                    <div className="bg-white dark:bg-[#121212] p-10 rounded-[2.5rem] border border-black/5 dark:border-white/10 shadow-sm hover:shadow-xl transition-all text-center space-y-6 flex flex-col items-center">
                      <div className="w-20 h-20 bg-black/5 dark:bg-white/5 rounded-3xl flex items-center justify-center text-black dark:text-white">
                        <UserIcon size={40} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold mb-2 text-black dark:text-white">Acta Inquilino</h3>
                        <p className="text-muted dark:text-gray-400 text-sm font-medium">Documento de recibido y entrega de llaves por parte del arrendatario.</p>
                      </div>
                      
                      <div className="w-full space-y-3">
                        {currentInventory.tenantReceiveSignature ? (
                          <>
                            <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 py-2 px-4 rounded-full text-xs font-bold inline-block mb-2">
                              ✓ Completado y Firmado
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                              <button 
                                onClick={() => exportToPDF(currentInventory, 'reception_tenant')}
                                className="w-full bg-black dark:bg-white text-white dark:text-black py-3 px-6 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg"
                              >
                                <Download size={16} />
                                Descargar Acta Inquilino
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-3">
                            {currentInventory.remoteSigningTokens?.reception_tenant?.token && !currentInventory.remoteSigningTokens?.reception_tenant?.signed && (
                              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300 py-2 px-3 rounded-2xl text-xs font-medium flex items-center justify-center gap-2">
                                <Mail size={14} />
                                <span>Enlace remoto enviado ({currentInventory.remoteSigningTokens.reception_tenant.email})</span>
                              </div>
                            )}
                            <button 
                              onClick={() => {
                                setReceptionType('tenant');
                                setReceptionSignMethod('presencial');
                                setReceptionName(currentInventory.tenantName || '');
                                setReceptionEmail(currentInventory.tenantEmail || '');
                                setRemoteLinkSentSuccess(null);
                                const template = tenantTemplate || `<p>Yo, como inquilino, hago entrega del inmueble ubicado en <b>{direccion}</b>, en las condiciones pactadas, realizando la devolución de las llaves al propietario.</p>`;
                                const finalText = template.replace(/{direccion}/g, currentInventory.address);
                                setReceptionText(currentInventory.tenantReceiveText || finalText);
                                setReceptionSignature(currentInventory.tenantReceiveSignature || '');
                              }}
                              className="w-full bg-black dark:bg-white text-white dark:text-black py-3 px-8 rounded-2xl text-sm font-bold hover:scale-105 transition-transform"
                            >
                              Comenzar Acta
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Both Acts Button at the bottom */}
                  {(currentInventory.tenantReceiveSignature && currentInventory.ownerDeliverySignature) && (
                    <div className="flex justify-center pt-4">
                      <button 
                        onClick={() => exportToPDF(currentInventory, 'reception')}
                        className="bg-emerald-600 text-white px-10 py-4 rounded-[2rem] flex items-center gap-3 hover:bg-emerald-700 transition-all font-bold text-lg shadow-xl shadow-emerald-900/20"
                      >
                        <Download size={24} />
                        Descargar Ambas Actas (PDF Completo)
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-[#121212] rounded-[2.5rem] p-8 sm:p-10 border border-black/5 dark:border-white/10 shadow-sm space-y-8">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-6">
                    <div>
                      <h3 className="text-2xl font-bold text-black dark:text-white">
                        Acta de {receptionType === 'owner' ? 'Entrega (Propietario)' : 'Recibido (Inquilino)'}
                      </h3>
                      <p className="text-xs text-muted dark:text-gray-400 mt-1">
                        Selecciona si la firma se realizará de forma presencial o enviando un enlace remoto al correo electrónico.
                      </p>
                    </div>
                    <button 
                      onClick={() => setReceptionType(null)}
                      className="text-sm font-bold text-muted hover:text-black dark:hover:text-white transition-colors"
                    >
                      Volver
                    </button>
                  </div>

                  {/* Signing Method Selector Tabs */}
                  <div className="grid grid-cols-2 gap-3 p-1.5 bg-[#f8f9fa] dark:bg-[#1e1e1e] rounded-2xl border border-black/5 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => setReceptionSignMethod('presencial')}
                      className={`py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        receptionSignMethod === 'presencial'
                          ? 'bg-black text-white dark:bg-white dark:text-black shadow-md'
                          : 'text-muted dark:text-gray-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      <PenTool size={18} />
                      <span>1. Firma Presencial</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceptionSignMethod('remoto')}
                      className={`py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        receptionSignMethod === 'remoto'
                          ? 'bg-black text-white dark:bg-white dark:text-black shadow-md'
                          : 'text-muted dark:text-gray-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      <Mail size={18} />
                      <span>2. Firma Remota (por Correo)</span>
                    </button>
                  </div>

                  {/* Property Summary */}
                  <div className="p-5 bg-[#f8f9fa] dark:bg-[#1a1a1a] rounded-2xl border border-black/5 dark:border-white/10 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-gray-400 mb-1">Inmueble Vinculado</p>
                      <p className="font-bold text-black dark:text-white">{currentInventory.propertyName}</p>
                      <p className="text-xs text-muted dark:text-gray-400">{currentInventory.address}</p>
                    </div>
                    <div className="px-3 py-1 bg-black/5 dark:bg-white/10 rounded-xl text-xs font-semibold text-black dark:text-white">
                      Rol: {receptionType === 'owner' ? 'Propietario' : 'Inquilino'}
                    </div>
                  </div>

                  {/* Signer Contact Inputs */}
                  <div className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400 mb-2">
                          Nombre del {receptionType === 'owner' ? 'Propietario' : 'Inquilino'}
                        </label>
                        <input
                          type="text"
                          value={receptionName}
                          onChange={(e) => setReceptionName(e.target.value)}
                          placeholder={`Ej: ${receptionType === 'owner' ? 'Carlos Mendoza' : 'María Gómez'}`}
                          className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-2xl px-5 py-3.5 text-sm font-medium text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400 mb-2">
                          Correo Electrónico * <span className="text-red-500 font-normal">(Requerido para copia legal)</span>
                        </label>
                        <input
                          type="email"
                          value={receptionEmail}
                          onChange={(e) => setReceptionEmail(e.target.value)}
                          placeholder="usuario@ejemplo.com"
                          className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-2xl px-5 py-3.5 text-sm font-medium text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition-all"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted dark:text-gray-400 italic">
                      {receptionSignMethod === 'presencial' 
                        ? 'Al completar y guardar la firma presencial, se enviará de inmediato una copia en PDF del acta con su firma a este correo.'
                        : 'Se enviará un correo con un enlace seguro y único para que el titular revise y firme el acta desde su móvil o computadora.'}
                    </p>
                  </div>

                  {/* Act Content Editor */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Contenido del Acta</label>
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl overflow-hidden border border-black/5 dark:border-white/10">
                      <ReactQuill 
                        theme="snow"
                        value={receptionText}
                        onChange={setReceptionText}
                        modules={quillModules}
                        formats={quillFormats}
                        placeholder="Escriba el contenido del acta..."
                      />
                    </div>
                  </div>

                  {/* Mode 1: Presencial Signature Pad */}
                  {receptionSignMethod === 'presencial' && (
                    <div className="space-y-4 pt-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Firma Presencial de Conformidad</label>
                      <div className="aspect-[3/1] bg-[#f8f9fa] dark:bg-[#1a1a1a] rounded-2xl border border-black/5 dark:border-white/10 relative overflow-hidden group">
                        {receptionSignature ? (
                          <div className="relative w-full h-full flex items-center justify-center p-4">
                            <img src={receptionSignature} alt="Firma" className="max-h-full object-contain filter dark:invert" referrerPolicy="no-referrer" />
                            <button 
                              onClick={() => setReceptionSignature('')}
                              className="absolute top-4 right-4 w-10 h-10 bg-white dark:bg-black rounded-full shadow-lg flex items-center justify-center text-red-600 hover:bg-red-600 hover:text-white transition-all"
                              title="Borrar y firmar de nuevo"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                            <div className="w-16 h-16 bg-white dark:bg-[#252525] rounded-2xl flex items-center justify-center shadow-sm text-black/40 dark:text-white/40">
                              <PenTool size={32} />
                            </div>
                            <button 
                              onClick={() => {
                                setActiveSignatureSide(receptionType === 'owner' ? 'owner' : 'tenant');
                                setShowSignatureModal(true);
                              }}
                              className="bg-black dark:bg-white text-white dark:text-black px-8 py-3 rounded-2xl font-bold text-xs hover:opacity-90 transition-all shadow-lg"
                            >
                              Capturar Firma en Pantalla
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-4 pt-6">
                        <button 
                          onClick={() => setReceptionType(null)}
                          className="flex-1 py-4 rounded-2xl font-bold text-muted dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                          Cancelar
                        </button>
                        <button 
                          onClick={handleSaveReception}
                          disabled={isSavingReception || !receptionSignature || !receptionText.trim() || !receptionEmail.trim()}
                          className="flex-[2] bg-black dark:bg-white text-white dark:text-black py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSavingReception ? (
                            <div className="w-5 h-5 border-2 border-white/30 dark:border-black/30 border-t-white dark:border-t-black rounded-full animate-spin" />
                          ) : (
                            <Save size={18} />
                          )}
                          <span>Guardar Acta y Enviar Copia</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Remote Signing Flow */}
                  {receptionSignMethod === 'remoto' && (
                    <div className="space-y-6 pt-2">
                      {((receptionType === 'owner' && currentInventory.ownerDeliverySignature) || (receptionType === 'tenant' && currentInventory.tenantReceiveSignature)) ? (
                        <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 rounded-3xl space-y-4">
                          <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 font-bold">
                            <CheckCircle2 size={24} />
                            <span>¡Acta ya firmada remotamente con éxito!</span>
                          </div>
                          <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                            El {receptionType === 'owner' ? 'propietario' : 'inquilino'} ha registrado y legalizado su firma electrónica de conformidad.
                          </p>
                          <div className="p-4 bg-white dark:bg-[#1a1a1a] rounded-2xl border border-emerald-200 dark:border-emerald-800/40 flex flex-col items-center justify-center gap-2">
                            <img 
                              src={(receptionType === 'owner' ? currentInventory.ownerDeliverySignature : currentInventory.tenantReceiveSignature) || ''} 
                              alt="Firma Remota" 
                              className="max-h-24 object-contain filter dark:invert" 
                              referrerPolicy="no-referrer" 
                            />
                            <span className="text-[10px] text-muted dark:text-gray-400 font-medium">
                              Firma Digital Certificada
                            </span>
                          </div>
                          <div className="flex items-center gap-3 pt-2">
                            <button 
                              onClick={() => exportToPDF(currentInventory, receptionType === 'owner' ? 'reception_owner' : 'reception_tenant')}
                              className="w-full bg-black dark:bg-white text-white dark:text-black py-3 px-6 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-md"
                            >
                              <Download size={14} />
                              <span>Descargar Acta Firmada (PDF)</span>
                            </button>
                          </div>
                        </div>
                      ) : remoteLinkSentSuccess ? (
                        <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 rounded-3xl space-y-4 shadow-sm">
                          <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 font-bold">
                            <CheckCircle2 size={24} className="shrink-0" />
                            <span className="text-sm sm:text-base">¡Enlace de firma remota generado con éxito!</span>
                          </div>
                          
                          <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                            {remoteLinkStatusInfo?.status === 'test_redirected' ? (
                              <span>
                                <strong>Modo de prueba Resend activo:</strong> La notificación fue enviada a su cuenta <strong>{remoteLinkStatusInfo.deliveredTo || 'djbtorreglosa@gmail.com'}</strong>. Puede compartir el enlace directamente al cliente por WhatsApp o copiarlo a continuación:
                              </span>
                            ) : remoteLinkStatusInfo?.status === 'warning' ? (
                              <span>El enlace de firma está <strong>activo y listo</strong> para ser completado por <strong>{receptionName || receptionEmail}</strong>. Puede compartirlo directamente por WhatsApp o copiar el enlace:</span>
                            ) : (
                              <span>Se ha generado la solicitud y enviado correo de notificación a <strong>{receptionEmail}</strong>. También puedes compartir el enlace directo por WhatsApp o copiarlo a continuación:</span>
                            )}
                          </p>

                          {/* URL Box with integrated quick-copy */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-900 dark:text-emerald-300">
                              <span>Enlace único de acceso</span>
                              <span className="text-[10px] text-emerald-700/80 dark:text-emerald-400 font-normal">Válido por 7 días</span>
                            </div>
                            <div 
                              onClick={() => {
                                if (remoteLinkSentSuccess) {
                                  navigator.clipboard.writeText(remoteLinkSentSuccess);
                                  setIsCopiedRemoteLink(true);
                                  showNotify('Enlace copiado al portapapeles', 'success');
                                  setTimeout(() => setIsCopiedRemoteLink(false), 2500);
                                }
                              }}
                              className="group flex items-center bg-white dark:bg-[#121212] rounded-2xl border border-emerald-200 dark:border-emerald-800/50 p-1.5 pl-3.5 shadow-sm hover:border-emerald-400 dark:hover:border-emerald-600 transition-all cursor-pointer"
                              title="Haga clic para copiar el enlace"
                            >
                              <Link2 size={16} className="text-emerald-600 dark:text-emerald-400 mr-2.5 shrink-0" />
                              <input 
                                type="text" 
                                readOnly 
                                value={remoteLinkSentSuccess} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  (e.target as HTMLInputElement).select();
                                }}
                                className="flex-1 bg-transparent text-xs text-slate-700 dark:text-gray-300 font-mono outline-none truncate select-all cursor-pointer"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (remoteLinkSentSuccess) {
                                    navigator.clipboard.writeText(remoteLinkSentSuccess);
                                    setIsCopiedRemoteLink(true);
                                    showNotify('Enlace copiado al portapapeles', 'success');
                                    setTimeout(() => setIsCopiedRemoteLink(false), 2500);
                                  }
                                }}
                                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 ml-1 ${
                                  isCopiedRemoteLink 
                                    ? 'bg-emerald-600 text-white shadow-sm' 
                                    : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:hover:bg-emerald-800 dark:text-emerald-200'
                                }`}
                                title="Copiar enlace al portapapeles"
                              >
                                {isCopiedRemoteLink ? <Check size={14} /> : <Copy size={14} />}
                                <span>{isCopiedRemoteLink ? '¡Copiado!' : 'Copiar'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Primary Action Buttons Row */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (remoteLinkSentSuccess) {
                                  navigator.clipboard.writeText(remoteLinkSentSuccess);
                                  setIsCopiedRemoteLink(true);
                                  showNotify('Enlace copiado al portapapeles', 'success');
                                  setTimeout(() => setIsCopiedRemoteLink(false), 2500);
                                }
                              }}
                              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
                                isCopiedRemoteLink
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-black dark:bg-white text-white dark:text-black hover:opacity-90'
                              }`}
                            >
                              {isCopiedRemoteLink ? <Check size={14} /> : <Copy size={14} />}
                              <span>{isCopiedRemoteLink ? '¡Enlace Copiado!' : 'Copiar Enlace'}</span>
                            </button>

                            <a 
                              href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Hola ${receptionName || ''}, te comparto el enlace para la firma digital del ${receptionType === 'owner' ? 'Acta de Entrega de Inmueble (Propietario)' : 'Acta de Recibido de Inmueble (Inquilino)'} del inmueble "${currentInventory.propertyName}" (${currentInventory.address}):\n\n${remoteLinkSentSuccess}\n\nPuedes abrirlo y firmar desde tu celular o computadora.`)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="w-full bg-[#25D366] text-white py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#20bd5a] transition-all shadow-sm"
                            >
                              <Share2 size={14} />
                              <span>Compartir WhatsApp</span>
                            </a>

                            <a 
                              href={remoteLinkSentSuccess}
                              target="_blank"
                              rel="noreferrer"
                              className="w-full bg-white dark:bg-white/10 text-emerald-950 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-700/60 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-emerald-100/60 dark:hover:bg-white/20 transition-all shadow-sm"
                            >
                              <ExternalLink size={14} />
                              <span>Abrir y Firmar</span>
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-3xl flex items-start gap-4">
                          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                            <Send size={20} />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm text-blue-900 dark:text-blue-200 mb-1">Envío de Enlace Remoto</h4>
                            <p className="text-xs text-blue-800/80 dark:text-blue-300 leading-relaxed">
                              El {receptionType === 'owner' ? 'propietario' : 'inquilino'} recibirá un correo con un enlace de un solo uso. Podrá leer el acta completa, realizar su firma táctil o con el ratón en cualquier dispositivo y recibirá una copia en PDF al instante.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-4 pt-4">
                        <button 
                          onClick={() => setReceptionType(null)}
                          className="flex-1 py-4 rounded-2xl font-bold text-muted dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                          Cerrar
                        </button>
                        <button 
                          onClick={handleSendRemoteSigningLink}
                          disabled={isSendingRemoteLink || !receptionEmail.trim() || !receptionText.trim()}
                          className="flex-[2] bg-black dark:bg-white text-white dark:text-black py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSendingRemoteLink ? (
                            <div className="w-5 h-5 border-2 border-white/30 dark:border-black/30 border-t-white dark:border-t-black rounded-full animate-spin" />
                          ) : (
                            <Send size={18} />
                          )}
                          <span>{remoteLinkSentSuccess ? 'Reenviar Enlace' : 'Enviar Enlace de Firma por Correo'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {view === 'create' && currentInventory && (
            (currentInventory.status !== 'draft' || (currentInventory.ownerSignature && currentInventory.tenantSignature)) ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[3rem] border border-black/5 shadow-sm px-6 text-center max-w-xl mx-auto">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
                  <Shield size={32} />
                </div>
                <h3 className="text-2xl font-bold">Documento Bloqueado por Seguridad</h3>
                <p className="text-muted text-sm mt-2 mb-8 leading-relaxed">
                  Este inventario ya ha sido firmado y finalizado formalmente. Para preservar la validez jurídica e integridad del acta, la estructura del inmueble, sus fotos y sus firmas no pueden ser modificadas.
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center">
                  <button 
                    onClick={() => {
                      navigateTo('detail');
                    }}
                    className="w-full sm:w-auto bg-black text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-black/80 transition-all text-sm"
                  >
                    Ver Detalle y Actas
                  </button>
                  <button 
                    onClick={handleBack}
                    className="w-full sm:w-auto bg-[#f8f9fa] border border-black/5 text-muted hover:text-black px-8 py-3.5 rounded-2xl font-bold hover:bg-black/5 transition-all text-sm"
                  >
                    Volver a la Lista
                  </button>
                </div>
              </div>
            ) : (
              <motion.div 
                key="create"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8 pb-32"
              >
              {/* Photo Uploading Banner */}
              {isUploadingPhotos && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between gap-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <div>
                      <p className="text-sm font-bold text-blue-900">Subiendo fotografías...</p>
                      <p className="text-xs text-blue-700">Por favor espere mientras se procesan y sincronizan las imágenes con el servidor.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Property Info Card */}
              <div className="bg-white rounded-3xl p-8 border border-black/5 shadow-sm space-y-8 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Información del Inmueble</h2>
                    <p className="text-muted text-xs font-medium mt-1">Completa los datos básicos de la propiedad.</p>
                  </div>
                  <button 
                    onClick={() => setShowTemplateSelector(true)}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-black text-white rounded-2xl text-xs font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/10 active:scale-95 shrink-0"
                  >
                    <ClipboardList size={16} />
                    <span>Usar Plantilla Personalizada</span>
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Nombre del Inmueble</label>
                    <input 
                      type="text"
                      value={currentInventory.propertyName}
                      onChange={(e) => setCurrentInventory({...currentInventory, propertyName: e.target.value})}
                      placeholder="Ej: Apartamento 402 - Edificio Sol"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Tipo de Inmueble (Plantilla Base)</label>
                    <select 
                      value={currentInventory.propertyType || 'Apartamento'}
                      onChange={(e) => {
                        const newType = e.target.value;
                        setShowConfirm({
                          show: true,
                          title: 'Cambiar Plantilla',
                          message: `¿Deseas aplicar la plantilla predeterminada para ${newType}? Esto reemplazará los espacios actuales.`,
                          onConfirm: () => applyTemplate(newType)
                        });
                      }}
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all font-bold"
                    >
                      <option value="Apartamento">Apartamento</option>
                      <option value="Casa">Casa</option>
                      <option value="Oficina">Oficina</option>
                      <option value="Local">Local Comercial</option>
                      <option value="Bodega">Bodega</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  {currentInventory.propertyType === 'Otro' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted">Nombre del Tipo de Inmueble</label>
                      <input 
                        type="text"
                        value={currentInventory.customPropertyType || ''}
                        onChange={(e) => setCurrentInventory({...currentInventory, customPropertyType: e.target.value})}
                        placeholder="Ej: Finca, Consultorio, etc."
                        className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Fecha de Inspección</label>
                    <input 
                      type="date"
                      value={currentInventory.date}
                      onChange={(e) => setCurrentInventory({...currentInventory, date: e.target.value})}
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Dirección</label>
                    <input 
                      type="text"
                      value={currentInventory.address}
                      onChange={(e) => setCurrentInventory({...currentInventory, address: e.target.value})}
                      placeholder="Calle 123 # 45 - 67"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Barrio</label>
                    <input 
                      type="text"
                      value={currentInventory.neighborhood || ''}
                      onChange={(e) => setCurrentInventory({...currentInventory, neighborhood: e.target.value})}
                      placeholder="Ej: El Poblado"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Valor del Arrendamiento</label>
                    <input 
                      type="text"
                      value={currentInventory.rentValue || ''}
                      onChange={(e) => setCurrentInventory({...currentInventory, rentValue: e.target.value})}
                      placeholder="Ej: $2.500.000"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Código Interno</label>
                    <input 
                      type="text"
                      value={currentInventory.internalCode || ''}
                      onChange={(e) => setCurrentInventory({...currentInventory, internalCode: e.target.value})}
                      placeholder="Ej: INV-001"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Parties Info Card */}
              <div className="bg-white dark:bg-[#121212] rounded-3xl p-8 border border-black/5 dark:border-white/10 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-black dark:text-white">Partes Interesadas</h2>
                    <p className="text-xs text-muted dark:text-gray-400 mt-1">Registra los nombres y correos de las partes para envíos de firmas y actas legales.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Nombre del Propietario</label>
                      <input 
                        type="text"
                        value={currentInventory.ownerName || ''}
                        onChange={(e) => setCurrentInventory({...currentInventory, ownerName: e.target.value})}
                        placeholder="Nombre completo del propietario"
                        className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 text-black dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Correo Electrónico Propietario</label>
                      <input 
                        type="email"
                        value={currentInventory.ownerEmail || ''}
                        onChange={(e) => setCurrentInventory({...currentInventory, ownerEmail: e.target.value})}
                        placeholder="propietario@ejemplo.com"
                        className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 text-black dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Nombre del Inquilino</label>
                      <input 
                        type="text"
                        value={currentInventory.tenantName || ''}
                        onChange={(e) => setCurrentInventory({...currentInventory, tenantName: e.target.value})}
                        placeholder="Nombre completo del inquilino"
                        className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 text-black dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted dark:text-gray-400">Correo Electrónico Inquilino</label>
                      <input 
                        type="email"
                        value={currentInventory.tenantEmail || ''}
                        onChange={(e) => setCurrentInventory({...currentInventory, tenantEmail: e.target.value})}
                        placeholder="inquilino@ejemplo.com"
                        className="w-full bg-[#f8f9fa] dark:bg-[#1e1e1e] border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 text-black dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Sections Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={handleBack}
                    className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center text-black hover:bg-black hover:text-white transition-all"
                    title="Volver al listado"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h3 className="text-2xl font-bold tracking-tight">Espacios del Inmueble</h3>
                    <p className="text-sm text-muted">Documente el estado de cada área de la propiedad.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSpaceTypeModal(true)}
                  className="bg-black text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-black/80 transition-all text-sm font-bold shadow-lg shadow-black/10"
                >
                  <Plus size={18} />
                  Añadir Espacio
                </button>
              </div>

              {/* Space Type Selection Modal */}
              <AnimatePresence>
                {showSpaceTypeModal && (
                  <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/60 backdrop-blur-md"
                      onClick={() => setShowSpaceTypeModal(false)}
                    />
                    <motion.div 
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 50, opacity: 0 }}
                      className="bg-white rounded-[3rem] p-8 max-w-2xl w-full relative z-10 shadow-2xl border border-black/5"
                    >
                      <div className="flex justify-between items-start mb-8">
                        <div>
                          <h3 className="text-2xl font-bold tracking-tight">Seleccionar Tipo de Espacio</h3>
                          <p className="text-muted text-xs font-medium mt-1">Elija el tipo de área que desea añadir al inventario.</p>
                        </div>
                        <button 
                          onClick={() => setShowSpaceTypeModal(false)}
                          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {Object.entries(SPACE_TYPES_CONFIG).map(([typeKey, config]) => {
                          const Icon = config.icon;
                          return (
                            <button
                              key={typeKey}
                              onClick={() => addSpace(typeKey)}
                              className="flex flex-col items-center gap-4 p-6 rounded-[2rem] bg-[#f8f9fa] border border-black/5 hover:border-black hover:bg-black hover:text-white transition-all group"
                            >
                              <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm group-hover:bg-white/10 transition-colors">
                                <Icon size={24} className="group-hover:text-white transition-colors" />
                              </div>
                              <span className="font-bold text-sm">{typeKey}</span>
                            </button>
                          );
                        })}
                      </div>

                      <button 
                        onClick={() => setShowSpaceTypeModal(false)}
                        className="w-full mt-8 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                      >
                        Cancelar
                      </button>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Spaces List */}
              <div className="space-y-6">
                {currentInventory.spaces.map((space, spaceIndex) => (
                  <div key={space.id} className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
                    {/* Space Header (Collapsible Trigger) */}
                    <div 
                      className="p-6 flex items-center justify-between cursor-pointer hover:bg-black/[0.01] transition-colors"
                      onClick={() => toggleSpace(space.id)}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${expandedSpaces[space.id] ? 'bg-black text-white' : 'bg-black/5 text-black'}`}>
                          {expandedSpaces[space.id] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                        <div className="flex-1">
                          <input 
                            type="text"
                            value={space.title}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const updated = [...currentInventory.spaces];
                              updated[spaceIndex].title = e.target.value;
                              setCurrentInventory({...currentInventory, spaces: updated});
                            }}
                            className="text-xl font-bold bg-transparent border-none p-0 focus:ring-0 outline-none w-full"
                            placeholder="Nombre del espacio"
                          />
                          <input 
                            type="text"
                            value={space.description}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const updated = [...currentInventory.spaces];
                              updated[spaceIndex].description = e.target.value;
                              setCurrentInventory({...currentInventory, spaces: updated});
                            }}
                            className="text-muted text-xs bg-transparent border-none p-0 focus:ring-0 outline-none w-full font-medium"
                            placeholder="Descripción breve"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-black/5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-black/40">
                          {space.items.length} Elementos
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSpace(space.id);
                          }}
                          className="p-2 text-muted hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Space Content (Collapsible) */}
                    <AnimatePresence>
                      {expandedSpaces[space.id] && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                        >
                          <div className="p-8 pt-0 border-t border-black/5 space-y-8">
                            {/* Items Section */}
                            <div className="space-y-4 mt-8">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-widest text-muted">Elementos a Calificar</label>
                                <button 
                                  onClick={() => addItemToSpace(space.id)}
                                  className="text-xs font-bold flex items-center gap-1.5 text-black hover:opacity-70 transition-all"
                                >
                                  <Plus size={14} />
                                  Añadir Elemento
                                </button>
                              </div>
                              
                              <div className="space-y-3">
                                {space.items.map((item, itemIndex) => (
                                  <div key={item.id} className="p-5 rounded-2xl bg-[#f8f9fa] border border-black/5 space-y-4 group/item">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1">
                                        <input 
                                          type="text"
                                          value={item.name}
                                          onChange={(e) => {
                                            const updated = [...currentInventory.spaces];
                                            updated[spaceIndex].items[itemIndex].name = e.target.value;
                                            setCurrentInventory({...currentInventory, spaces: updated});
                                          }}
                                          className="font-bold text-sm bg-transparent border-none p-0 focus:ring-0 outline-none w-full"
                                          placeholder="Nombre del elemento (ej: Pisos, Ducha...)"
                                        />
                                      </div>
                                      <button 
                                        onClick={() => removeItemFromSpace(space.id, item.id)}
                                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                        title="Eliminar elemento"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>

                                    <div className="flex flex-col md:flex-row gap-4">
                                      <div className="flex-1 grid grid-cols-4 gap-1.5">
                                        {(['Excelente', 'Bueno', 'Regular', 'Malo'] as const).map((cond) => (
                                          <button
                                            key={cond}
                                            onClick={() => {
                                              const updated = [...currentInventory.spaces];
                                              updated[spaceIndex].items[itemIndex].condition = cond;
                                              setCurrentInventory({...currentInventory, spaces: updated});
                                            }}
                                            className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                              item.condition === cond
                                                ? 'bg-black text-white border-black'
                                                : 'bg-white text-muted border-black/5 hover:border-black/20'
                                            }`}
                                          >
                                            {cond}
                                          </button>
                                        ))}
                                      </div>
                                      <div className="flex-[1.5] flex items-center gap-2">
                                        <div className="relative flex-1">
                                          <input 
                                            type="text"
                                            value={item.details}
                                            onChange={(e) => {
                                              const updated = [...currentInventory.spaces];
                                              updated[spaceIndex].items[itemIndex].details = e.target.value;
                                              setCurrentInventory({...currentInventory, spaces: updated});
                                            }}
                                            placeholder="Observaciones específicas..."
                                            className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-black outline-none transition-all pr-10"
                                          />
                                          <button
                                            onClick={() => startListening(spaceIndex, itemIndex, item.id)}
                                            className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                              isListening === item.id 
                                                ? 'bg-red-100 text-red-600 animate-pulse' 
                                                : 'text-muted hover:bg-black/5'
                                            }`}
                                            title="Dictar descripción"
                                          >
                                            {isListening === item.id ? <MicOff size={14} /> : <Mic size={14} />}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* General Observations Section */}
                            <div className="space-y-4 pt-8 border-t border-black/5">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-widest text-muted">Observaciones Generales del Espacio</label>
                                <button
                                  onClick={() => startListening(spaceIndex, -1, `obs-${space.id}`, true)}
                                  className={`flex items-center gap-1.5 text-xs font-bold transition-all ${
                                    isListening === `obs-${space.id}` ? 'text-red-600 animate-pulse' : 'text-black hover:opacity-70'
                                  }`}
                                >
                                  {isListening === `obs-${space.id}` ? <MicOff size={14} /> : <Mic size={14} />}
                                  <span>Dictar</span>
                                </button>
                              </div>
                              <textarea
                                value={space.generalObservations || ''}
                                onChange={(e) => {
                                  const updated = [...currentInventory.spaces];
                                  updated[spaceIndex].generalObservations = e.target.value;
                                  setCurrentInventory({...currentInventory, spaces: updated});
                                }}
                                placeholder="Añada observaciones generales sobre el estado de este espacio en su totalidad..."
                                className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-black outline-none transition-all min-h-[100px] resize-none"
                              />
                            </div>

                            {/* Photos Section */}
                            <div className="space-y-4 pt-8 border-t border-black/5">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-widest text-muted">Registro Fotográfico del Espacio</label>
                                <button 
                                  onClick={() => {
                                    setTargetSpaceId(space.id);
                                    setPhotoSourceModal({ open: true, spaceId: space.id, type: 'space' });
                                  }}
                                  className="text-xs font-bold flex items-center gap-2 text-black hover:opacity-70 transition-all bg-black/5 px-3 py-1.5 rounded-xl"
                                >
                                  <Camera size={16} />
                                  Añadir Fotos
                                </button>
                              </div>

                              {space.photos.length === 0 ? (
                                <div 
                                  onClick={() => {
                                    setTargetSpaceId(space.id);
                                    setPhotoSourceModal({ open: true, spaceId: space.id, type: 'space' });
                                  }}
                                  className="border-2 border-dashed border-black/5 rounded-2xl p-10 text-center cursor-pointer hover:bg-black/[0.02] transition-all"
                                >
                                  <Camera size={24} className="mx-auto mb-2 opacity-20" />
                                  <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Añadir fotos (Cámara o Galería)</p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                                  {space.photos.map((photo) => (
                                    <div 
                                      key={photo.id} 
                                      onClick={async () => {
                                        const displayUrl = await getPhotoDisplayUrl(photo);
                                        setFullscreenPhoto({
                                          url: displayUrl,
                                          title: space.title,
                                          date: format(photo.timestamp, 'dd/MM/yyyy HH:mm'),
                                          spaceId: space.id,
                                          photoId: photo.id,
                                          canDelete: currentInventory.status === 'draft'
                                        });
                                      }}
                                      className="relative group aspect-square rounded-xl overflow-hidden border border-black/5 shadow-sm cursor-pointer"
                                    >
                                      <PhotoThumb 
                                        photo={photo} 
                                        alt="Evidencia" 
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                                        showSyncBadge={true}
                                      />
                                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                        <Maximize2 size={16} />
                                      </div>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removePhoto(space.id, photo.id);
                                        }}
                                        className="absolute top-1 right-1 p-1 bg-white/90 rounded-md text-red-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
                                        title="Eliminar foto"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                  <button 
                                    onClick={() => {
                                      setTargetSpaceId(space.id);
                                      setPhotoSourceModal({ open: true, spaceId: space.id, type: 'space' });
                                    }}
                                    className="aspect-square border-2 border-dashed border-black/5 rounded-xl flex flex-col items-center justify-center text-muted hover:bg-black/[0.02] transition-all"
                                  >
                                    <Plus size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
                
                <button 
                  onClick={() => setShowSpaceTypeModal(true)}
                  className="w-full py-10 border-2 border-dashed border-black/5 rounded-[2rem] flex flex-col items-center justify-center text-muted hover:bg-black/[0.02] hover:border-black/10 transition-all group"
                >
                  <div className="w-14 h-14 bg-black/5 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-black group-hover:text-white transition-colors">
                    <Plus size={28} />
                  </div>
                  <span className="font-bold text-sm">Añadir otro espacio al inmueble</span>
                  <p className="text-[10px] uppercase tracking-widest mt-1 opacity-50">Ej: Patio, Garaje, Balcón...</p>
                </button>
              </div>

              <input 
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoCapture}
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
              />

              {/* Bottom Actions */}
              <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-black/5 p-4 z-40">
                <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleSaveInventory('draft')}
                      disabled={isUploadingPhotos}
                      className="px-6 py-3 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      <FileText size={18} />
                      <span className="hidden sm:inline">Guardar Borrador</span>
                      <span className="sm:hidden">Borrador</span>
                    </button>
                  </div>
                  <button 
                    onClick={() => handleSaveInventory('completed')}
                    disabled={isUploadingPhotos}
                    className="bg-black text-white px-10 py-3 rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center gap-2 shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50"
                  >
                    <Save size={18} />
                    <span>{isUploadingPhotos ? 'Subiendo fotos...' : 'Finalizar y Guardar'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
        )}
      </main>

      {/* Footer info for desktop */}
      <footer className="max-w-4xl mx-auto p-12 text-center text-muted text-xs opacity-40">
        <p>© 2026 CheckInventory • Inventario Digital de Bienes Raíces</p>
      </footer>

      {/* Template Selector Modal */}
      <AnimatePresence>
        {showTemplateSelector && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTemplateSelector(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-black/5 flex items-center justify-between bg-[#fcfcfc]">
                <div>
                  <h3 className="text-2xl font-bold">Seleccionar Plantilla</h3>
                  <p className="text-muted text-sm font-medium mt-1">Elige una estructura para tu inventario.</p>
                </div>
                <button 
                  onClick={() => setShowTemplateSelector(false)}
                  className="w-12 h-12 flex items-center justify-center bg-black/5 rounded-2xl hover:bg-black hover:text-white transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Custom Templates */}
                {userTemplates.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Mis Plantillas Personalizadas</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {userTemplates.map(template => (
                        <button
                          key={template.id}
                          onClick={() => applyTemplateToInventory(template)}
                          className="p-6 bg-white border border-black/5 rounded-[2rem] text-left hover:border-black hover:shadow-xl hover:shadow-black/5 transition-all group flex flex-col justify-between h-full"
                        >
                          <div>
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${
                              template.propertyType === 'Apartamento' ? 'bg-blue-50 text-blue-600' :
                              template.propertyType === 'Casa' ? 'bg-emerald-50 text-emerald-600' :
                              template.propertyType === 'Oficina' ? 'bg-amber-50 text-amber-600' :
                              template.propertyType === 'Local' ? 'bg-purple-50 text-purple-600' :
                              template.propertyType === 'Bodega' ? 'bg-orange-50 text-orange-600' :
                              'bg-gray-50 text-gray-600'
                            }`}>
                              {getPropertyIcon(template.propertyType)}
                            </div>
                            <p className="font-bold text-lg leading-tight mb-1">{template.templateName}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{template.propertyType}</span>
                              <span className="w-1 h-1 bg-black/10 rounded-full" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{template.structure.length} Espacios</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="py-20 text-center flex flex-col items-center justify-center space-y-6">
                    <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center text-black/20">
                      <ClipboardList size={40} />
                    </div>
                    <div className="max-w-xs">
                      <h4 className="font-bold text-xl text-black">Sin plantillas personalizadas</h4>
                      <p className="text-sm text-muted mt-2">No has creado ninguna plantilla personalizada aún. Puedes crearlas en la sección de Ajustes.</p>
                    </div>
                    <button 
                      onClick={() => {
                        setShowTemplateSelector(false);
                        navigateTo('settings');
                      }}
                      className="px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all shadow-lg shadow-black/10"
                    >
                      Ir a Ajustes
                    </button>
                  </div>
                )}
              </div>
              
              <div className="p-8 bg-[#fcfcfc] border-t border-black/5 flex justify-end">
                <button 
                  onClick={() => setShowTemplateSelector(false)}
                  className="px-8 py-3 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Space Selector Modal */}
      <AnimatePresence>
        {showSpaceSelector && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSpaceSelector(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-8 border-b border-black/5 flex items-center justify-between bg-[#fcfcfc]">
                <div>
                  <h3 className="text-2xl font-bold">Añadir Espacio</h3>
                  <p className="text-muted text-sm font-medium mt-1">Selecciona un espacio predefinido.</p>
                </div>
                <button 
                  onClick={() => setShowSpaceSelector(false)}
                  className="w-12 h-12 flex items-center justify-center bg-black/5 rounded-2xl hover:bg-black hover:text-white transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-3">
                {[
                  { title: 'Sala / Comedor', items: ['Paredes', 'Pisos', 'Techos', 'Iluminación', 'Ventanas', 'Puerta Principal'] },
                  { title: 'Cocina', items: ['Mesones', 'Gabinetes', 'Estufa', 'Lavaplatos', 'Grifería', 'Tomacorrientes'] },
                  { title: 'Alcoba', items: ['Paredes', 'Pisos', 'Closet', 'Ventanas', 'Puerta', 'Iluminación'] },
                  { title: 'Baño', items: ['Pisos', 'Paredes', 'Lavamanos', 'Espejo', 'Cabina de baño', 'Ducha', 'Sanitario', 'Grifería'] },
                  { title: 'Balcón', items: ['Pisos', 'Barandas', 'Puerta Vidriera', 'Iluminación', 'Paredes'] },
                  { title: 'Patio', items: ['Pisos', 'Paredes', 'Lavadero', 'Grifería', 'Iluminación', 'Rejas'] },
                  { title: 'Garaje', items: ['Pisos', 'Paredes', 'Puerta Vehicular', 'Iluminación', 'Tomacorrientes'] },
                  { title: 'Zona de Lavandería', items: ['Lavadero', 'Conexiones', 'Pisos', 'Paredes', 'Iluminación'] }
                ].map((space, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAddPredefinedSpace(space)}
                    className="w-full p-5 bg-[#f8f9fa] border border-black/5 rounded-2xl text-left hover:border-black hover:bg-white hover:shadow-lg transition-all group flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-lg">{space.title}</p>
                      <p className="text-[10px] text-muted uppercase tracking-widest font-bold mt-1">
                        {space.items.length} Elementos predefinidos
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:bg-black group-hover:text-white transition-all">
                      <Plus size={20} />
                    </div>
                  </button>
                ))}
              </div>
              
              <div className="p-8 bg-[#fcfcfc] border-t border-black/5 flex justify-end">
                <button 
                  onClick={() => setShowSpaceSelector(false)}
                  className="px-8 py-3 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden inputs for Android native camera & gallery picker */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handlePhotoCapture} 
        accept="image/*" 
        multiple 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        onChange={handlePhotoCapture} 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={galleryInputRef} 
        onChange={handlePhotoCapture} 
        accept="image/*" 
        multiple 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={annexCameraInputRef} 
        onChange={handleAnnexPhotoCapture} 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={annexGalleryInputRef} 
        onChange={handleAnnexPhotoCapture} 
        accept="image/*" 
        multiple 
        className="hidden" 
      />

      {/* Photo Source Modal: Cámara vs Galería */}
      <AnimatePresence>
        {photoSourceModal.open && (
          <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setPhotoSourceModal({ open: false, type: 'space' })}
            />
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 max-w-md w-full relative z-10 shadow-2xl border border-black/5 pb-safe"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Añadir Fotografías</h3>
                  <p className="text-muted text-xs font-medium mt-0.5">Selecciona el origen de las fotos</p>
                </div>
                <button 
                  onClick={() => setPhotoSourceModal({ open: false, type: 'space' })}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <button
                  onClick={() => {
                    const type = photoSourceModal.type;
                    setPhotoSourceModal({ open: false, type: 'space' });
                    setTimeout(() => {
                      if (type === 'space') {
                        cameraInputRef.current?.click();
                      } else {
                        annexCameraInputRef.current?.click();
                      }
                    }, 50);
                  }}
                  className="flex flex-col items-center justify-center p-6 rounded-3xl bg-black text-white hover:bg-black/90 active:scale-95 transition-all shadow-xl shadow-black/10 gap-3 group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera size={28} />
                  </div>
                  <div className="text-center">
                    <span className="font-bold text-sm block">Cámara</span>
                    <span className="text-[10px] text-white/60">Tomar foto ahora</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    const type = photoSourceModal.type;
                    setPhotoSourceModal({ open: false, type: 'space' });
                    setTimeout(() => {
                      if (type === 'space') {
                        galleryInputRef.current?.click();
                      } else {
                        annexGalleryInputRef.current?.click();
                      }
                    }, 50);
                  }}
                  className="flex flex-col items-center justify-center p-6 rounded-3xl bg-[#f8f9fa] border border-black/5 hover:bg-black/5 active:scale-95 transition-all gap-3 group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-black/5 flex items-center justify-center text-black group-hover:scale-110 transition-transform">
                    <ImageIcon size={28} />
                  </div>
                  <div className="text-center">
                    <span className="font-bold text-sm block text-black">Galería</span>
                    <span className="text-[10px] text-muted">Seleccionar fotos</span>
                  </div>
                </button>
              </div>

              <button 
                onClick={() => setPhotoSourceModal({ open: false, type: 'space' })}
                className="w-full py-3.5 rounded-2xl font-bold text-xs text-muted hover:bg-black/5 transition-all"
              >
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fullscreen Photo Lightbox Modal */}
      <AnimatePresence>
        {fullscreenPhoto && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/95 backdrop-blur-lg p-2 sm:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative max-w-4xl w-full h-full max-h-[90vh] flex flex-col justify-between"
            >
              {/* Top bar */}
              <div className="flex items-center justify-between p-4 text-white z-10 bg-gradient-to-b from-black/80 to-transparent rounded-t-2xl">
                <div>
                  <h4 className="font-bold text-sm sm:text-base">{fullscreenPhoto.title}</h4>
                  {fullscreenPhoto.date && (
                    <p className="text-[11px] text-white/60 font-medium">{fullscreenPhoto.date}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <button
                      onClick={async () => {
                        try {
                          const response = await fetch(fullscreenPhoto.url);
                          const blob = await response.blob();
                          const file = new File([blob], `foto_${fullscreenPhoto.title.replace(/\s+/g, '_')}.jpg`, { type: 'image/jpeg' });
                          if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                              title: fullscreenPhoto.title,
                              files: [file]
                            });
                          }
                        } catch (e) {
                          console.error('Error sharing photo:', e);
                        }
                      }}
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
                      title="Compartir foto"
                    >
                      <Share2 size={18} />
                    </button>
                  )}
                  {fullscreenPhoto.canDelete && (
                    <button
                      onClick={() => {
                        if (fullscreenPhoto.isAnnex && fullscreenPhoto.photoId) {
                          removeAnnexPhoto(fullscreenPhoto.photoId);
                        } else if (fullscreenPhoto.spaceId && fullscreenPhoto.photoId) {
                          removePhoto(fullscreenPhoto.spaceId, fullscreenPhoto.photoId);
                        }
                        setFullscreenPhoto(null);
                        showNotify('Fotografía eliminada');
                      }}
                      className="w-10 h-10 rounded-full bg-red-600/80 hover:bg-red-600 flex items-center justify-center text-white transition-all"
                      title="Eliminar foto"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => setFullscreenPhoto(null)}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
                    title="Cerrar"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Image center */}
              <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                <img 
                  src={fullscreenPhoto.url} 
                  alt={fullscreenPhoto.title}
                  className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl"
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

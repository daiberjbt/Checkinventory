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
  User as UserIcon,
  Users,
  Image as ImageIcon,
  LayoutDashboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Inventory, InventorySpace, InventoryItem, Photo, User, Annex } from './types';
import { SignaturePad } from './components/SignaturePad';
import { Auth } from './components/Auth';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, sendEmailVerification } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDoc,
  query,
  where,
  setDoc,
  getDocFromServer
} from 'firebase/firestore';

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
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export default function App() {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [dependents, setDependents] = useState<User[]>([]);
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'dependents'>('list');
  const [currentInventory, setCurrentInventory] = useState<Inventory | null>(null);
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>({});
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'completed'>('all');
  const [isListening, setIsListening] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeleteCodeModal, setShowDeleteCodeModal] = useState(false);
  const [deleteCodeInput, setDeleteCodeInput] = useState('');
  const [generatedDeleteCode, setGeneratedDeleteCode] = useState('');
  const [inventoryIdToDelete, setInventoryIdToDelete] = useState<string | null>(null);
  const [selectedInventoryForExport, setSelectedInventoryForExport] = useState<Inventory | null>(null);
  const [showAnnexModal, setShowAnnexModal] = useState(false);
  const [annexText, setAnnexText] = useState('');
  const [annexPhotos, setAnnexPhotos] = useState<Photo[]>([]);
  const [isSavingAnnex, setIsSavingAnnex] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [signatures, setSignatures] = useState({ owner: '', tenant: '' });
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' } | null>(null);
  const [isDownloadingPhotos, setIsDownloadingPhotos] = useState(false);
  const [showPhotosInDetail, setShowPhotosInDetail] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  // Test connection to Firestore
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

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

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setIsEmailVerified(firebaseUser.emailVerified);
        
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setCurrentUser({
            id: firebaseUser.uid,
            email: firebaseUser.email!,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            role: userData.role,
            adminEmail: userData.adminEmail
          } as User);
        }
      } else {
        setCurrentUser(null);
        setIsEmailVerified(true);
      }
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Firestore Listener for Dependents (Admin only)
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin' || !isAuthReady) return;

    const q = query(
      collection(db, 'users'),
      where('role', '==', 'dependent'),
      where('adminEmail', '==', currentUser.email)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      setDependents(deps);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return unsubscribe;
  }, [currentUser, isAuthReady]);

  // Firestore Listener for Inventories
  useEffect(() => {
    if (!currentUser || !isAuthReady) return;

    // Admin sees all inventories they created or where they are the adminEmail
    // Dependent sees only inventories they created
    let q;
    if (currentUser.role === 'admin') {
      q = query(
        collection(db, 'inventories'), 
        where('adminEmail', '==', currentUser.email)
      );
    } else {
      q = query(
        collection(db, 'inventories'), 
        where('createdBy', '==', currentUser.id)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Inventory[];
      setInventories(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventories');
    });

    return unsubscribe;
  }, [currentUser, isAuthReady]);

  const showNotify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const downloadPhotosZip = async (inventory: Inventory) => {
    const zip = new JSZip();
    const propertyFolder = zip.folder(`Fotos_${inventory.propertyName.replace(/\s+/g, '_')}`);
    
    if (!propertyFolder) return;

    for (const space of inventory.spaces) {
      if (space.photos.length > 0) {
        // Remove invalid characters for folder names
        const spaceFolderName = space.title.replace(/[/\\?%*:|"<>]/g, '-');
        const spaceFolder = propertyFolder.folder(spaceFolderName);
        
        if (!spaceFolder) continue;

        for (let i = 0; i < space.photos.length; i++) {
          const photo = space.photos[i];
          // Extract base64 data
          const base64Data = photo.dataUrl.split(',')[1];
          const fileName = `foto_${i + 1}_${photo.id.substring(0, 5)}.jpg`;
          spaceFolder.file(fileName, base64Data, { base64: true });
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
            const base64Data = photo.dataUrl.split(',')[1];
            const fileName = `anexo_foto_${photoCounter}_${photo.id.substring(0, 5)}.jpg`;
            annexFolder.file(fileName, base64Data, { base64: true });
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

  const startListening = (spaceIndex: number, itemIndex: number, itemId: string) => {
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
        const currentDetails = updated[spaceIndex].items[itemIndex].details;
        updated[spaceIndex].items[itemIndex].details = currentDetails ? `${currentDetails} ${transcript}` : transcript;
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

  const saveInventory = async (inventory: Inventory) => {
    try {
      const { id, ...data } = inventory;
      const exists = inventories.find(i => i.id === id);
      
      if (!exists) {
        await setDoc(doc(db, 'inventories', id), {
          ...data,
          createdBy: currentUser?.id,
          creatorName: `${currentUser?.firstName} ${currentUser?.lastName}`.trim(),
          adminEmail: currentUser?.role === 'admin' ? currentUser.email : currentUser?.adminEmail
        });
      } else {
        await updateDoc(doc(db, 'inventories', id), data);
      }
      showNotify('Inventario guardado correctamente');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `inventories/${inventory.id}`);
    }
  };

  const applyTemplate = (type: string) => {
    if (!currentInventory) return;
    
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
      spaces: newSpaces
    });
    
    if (newSpaces.length > 0) {
      setExpandedSpaces({ [newSpaces[0].id]: true });
    }
    
    showNotify(`Plantilla de ${type} aplicada correctamente`);
  };

  const startNewInventory = () => {
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
      creatorName: `${currentUser?.firstName} ${currentUser?.lastName}`.trim(),
      adminEmail: currentUser?.role === 'admin' ? currentUser.email : (currentUser?.adminEmail || ''),
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
    setExpandedSpaces({ [newInventory.spaces[0].id]: true });
    setView('create');
  };

  const handleSaveInventory = async (status: 'draft' | 'completed' = 'draft') => {
    if (!currentInventory) return;
    if (!currentInventory.propertyName.trim()) {
      showNotify('Por favor ingrese el nombre del inmueble', 'error');
      return;
    }

    if (status === 'completed') {
      setSignatures({ 
        owner: currentInventory.ownerSignature || '', 
        tenant: currentInventory.tenantSignature || '' 
      });
      setShowSignatureModal(true);
      return;
    }

    const inventoryToSave = { ...currentInventory, status };
    await saveInventory(inventoryToSave);
    setView('list');
    setCurrentInventory(null);
  };

  const confirmFinalSave = async () => {
    if (!currentInventory) return;
    
    const isFullySigned = signatures.owner && signatures.tenant;
    const status: 'draft' | 'completed' = isFullySigned ? 'completed' : 'draft';

    const inventoryToSave: Inventory = { 
      ...currentInventory, 
      status,
      ownerSignature: signatures.owner || currentInventory.ownerSignature,
      tenantSignature: signatures.tenant || currentInventory.tenantSignature
    };

    await saveInventory(inventoryToSave);
    setShowSignatureModal(false);
    setView('list');
    setCurrentInventory(null);
    
    if (isFullySigned) {
      showNotify('Inventario firmado y finalizado correctamente');
    } else {
      showNotify('Firmas guardadas. El inventario sigue en borradores hasta completarse.');
    }
  };

  const handleDeleteInventory = async (id: string) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedDeleteCode(code);
    setInventoryIdToDelete(id);
    setDeleteCodeInput('');
    setShowDeleteCodeModal(true);
    
    const inventory = inventories.find(i => i.id === id);
    const targetEmail = inventory?.adminEmail;
    
    if (targetEmail) {
      try {
        const response = await fetch('/api/send-verification', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: targetEmail,
            code,
            propertyName: inventory?.propertyName
          })
        });

        const data = await response.json();

        if (response.ok) {
          if (data.simulated) {
            showNotify('Modo simulación: Código generado (ver logs del servidor)', 'success');
            console.log('CÓDIGO DE VERIFICACIÓN (SIMULADO):', code);
          } else {
            showNotify(`Código enviado a: ${targetEmail}`);
          }
        } else {
          console.error('Email API Error:', data);
          showNotify(data.error || 'Error al enviar el código de verificación', 'error');
        }
      } catch (error) {
        console.error('Fetch Error:', error);
        showNotify('Error de conexión al enviar el código', 'error');
      }
    }
  };

  const verifyAndDelete = async () => {
    if (deleteCodeInput === generatedDeleteCode && inventoryIdToDelete) {
      try {
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

  const addSpace = () => {
    if (!currentInventory) return;
    const newSpace: InventorySpace = {
      id: uuidv4(),
      title: 'Nuevo Espacio',
      description: 'Describa el área.',
      photos: [],
      items: DEFAULT_ITEMS.map(name => ({
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
  };

  const removeSpace = (id: string) => {
    if (!currentInventory) return;
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
    if (!currentInventory) return;
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
          return { ...s, items: [...s.items, newItem] };
        }
        return s;
      })
    });
  };

  const removeItemFromSpace = (spaceId: string, itemId: string) => {
    if (!currentInventory) return;
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

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !currentInventory || !targetSpaceId) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Max dimension 1200px
          const MAX_DIM = 1200;
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

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG with 0.7 quality
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);

          const newPhoto: Photo = {
            id: uuidv4(),
            dataUrl: compressedDataUrl,
            timestamp: Date.now()
          };

          setCurrentInventory(prev => {
            if (!prev) return null;
            return {
              ...prev,
              spaces: prev.spaces.map(s => {
                if (s.id === targetSpaceId) {
                  return { ...s, photos: [...s.photos, newPhoto] };
                }
                return s;
              })
            };
          });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
    setTargetSpaceId(null);
    if (e.target) e.target.value = '';
  };

  const removePhoto = (spaceId: string, photoId: string) => {
    if (!currentInventory) return;
    const updatedSpaces = currentInventory.spaces.map(s => {
      if (s.id === spaceId) {
        return { ...s, photos: s.photos.filter(p => p.id !== photoId) };
      }
      return s;
    });
    setCurrentInventory({ ...currentInventory, spaces: updatedSpaces });
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
        text: annexText,
        photos: annexPhotos,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        creatorName: `${currentUser.firstName} ${currentUser.lastName}`
      };

      const updatedAnnexes = [...(currentInventory.annexes || []), newAnnex];
      const inventoryRef = doc(db, 'inventories', currentInventory.id);
      
      await updateDoc(inventoryRef, {
        annexes: updatedAnnexes
      });

      setCurrentInventory({
        ...currentInventory,
        annexes: updatedAnnexes
      });

      setInventories(prev => prev.map(inv => 
        inv.id === currentInventory.id ? { ...inv, annexes: updatedAnnexes } : inv
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

  const handleAnnexPhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const MAX_DIM = 1200;
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

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);

          const newPhoto: Photo = {
            id: uuidv4(),
            dataUrl: compressedDataUrl,
            timestamp: Date.now()
          };
          setAnnexPhotos(prev => [...prev, newPhoto]);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
    if (e.target) e.target.value = '';
  };

  const removeAnnexPhoto = (photoId: string) => {
    setAnnexPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const exportToPDF = (inventory: Inventory, recipient: 'owner' | 'tenant' | 'both' = 'both') => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(40);
    doc.text('Reporte de Inventario de Inmueble', 14, 22);
    
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Inmueble: ${inventory.propertyName}`, 14, 32);
    doc.text(`Dirección: ${inventory.address}`, 14, 38);
    if (inventory.neighborhood) doc.text(`Barrio: ${inventory.neighborhood}`, 14, 44);
    doc.text(`Fecha: ${inventory.date}`, 14, 50);
    doc.text(`Realizado por: ${inventory.creatorName || 'N/A'}`, 14, 56);
    
    if (inventory.rentValue) doc.text(`Valor Arrendamiento: ${inventory.rentValue}`, 100, 32);
    if (inventory.internalCode) doc.text(`Código Interno: ${inventory.internalCode}`, 100, 38);
    
    if (recipient !== 'tenant' && inventory.ownerName) {
      doc.text(`Propietario: ${inventory.ownerName}`, 100, 44);
    }
    if (recipient !== 'owner' && inventory.tenantName) {
      doc.text(`Inquilino: ${inventory.tenantName}`, 100, 50);
    }
    
    doc.setDrawColor(200);
    doc.line(14, 60, pageWidth - 14, 60);

    // Table of conditions
    const tableData: any[] = [];
    inventory.spaces.forEach(space => {
      tableData.push([{ content: space.title, colSpan: 3, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }]);
      space.items.forEach(item => {
        tableData.push([`  ${item.name}`, item.condition, item.details]);
      });
    });

    autoTable(doc, {
      startY: 65,
      head: [['Elemento', 'Estado', 'Detalles']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [60, 60, 60] },
      styles: { fontSize: 9 }
    });

    // Photos Section (Link instead of images)
    let currentY = (doc as any).lastAutoTable.finalY + 15;
    
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
    }

      const suffix = recipient === 'owner' ? '_Propietario' : recipient === 'tenant' ? '_Inquilino' : '';
      
      // Annexes Section
      if (inventory.annexes && inventory.annexes.length > 0) {
        doc.addPage();
        currentY = 20;
        
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text('Anexos y Modificaciones Posteriores', 14, currentY);
        currentY += 10;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text('Información añadida después de la firma del inventario original.', 14, currentY);
        currentY += 15;

        inventory.annexes.forEach((annex, index) => {
          if (currentY > 250) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(40);
          doc.text(`Anexo #${index + 1} - ${new Date(annex.createdAt).toLocaleDateString()}`, 14, currentY);
          currentY += 7;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60);
          const annexText = doc.splitTextToSize(annex.text, pageWidth - 28);
          doc.text(annexText, 14, currentY);
          currentY += (annexText.length * 5) + 5;

          if (annex.photos && annex.photos.length > 0) {
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

      doc.save(`Inventario_${inventory.propertyName.replace(/\s+/g, '_')}_${inventory.date}${suffix}.pdf`);
  };

  const filteredInventories = inventories.filter(inv => {
    const matchesSearch = inv.propertyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         inv.address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setView('list');
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
              notification.type === 'error' ? 'bg-red-600 text-white' : 'bg-black text-white'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${notification.type === 'error' ? 'bg-white' : 'bg-emerald-400'}`} />
            <span className="text-sm font-bold">{notification.message}</span>
          </motion.div>
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

              <div className="space-y-6">
                <SignaturePad 
                  label="Firma del Propietario / Arrendador" 
                  initialValue={signatures.owner}
                  onSave={(data) => setSignatures(prev => ({ ...prev, owner: data }))}
                />
                
                <SignaturePad 
                  label="Firma del Inquilino / Arrendatario" 
                  initialValue={signatures.tenant}
                  onSave={(data) => setSignatures(prev => ({ ...prev, tenant: data }))}
                />
              </div>

              <div className="flex flex-col gap-3 mt-10">
                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowSignatureModal(false)}
                    className="flex-1 py-4 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmFinalSave}
                    className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/80 transition-all shadow-xl shadow-black/20"
                  >
                    {signatures.owner && signatures.tenant ? 'Finalizar y Firmar' : 'Guardar Firmas'}
                  </button>
                </div>
                
                {!(signatures.owner && signatures.tenant) && (
                  <button 
                    onClick={() => confirmFinalSave()}
                    className="w-full py-3 text-xs font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
                  >
                    Guardar como borrador sin firmas
                  </button>
                )}
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

              <div className="space-y-3">
                <button 
                  onClick={() => {
                    downloadPhotosZip(selectedInventoryForExport);
                    setShowExportModal(false);
                  }}
                  className="w-full p-4 rounded-2xl border border-black/5 bg-black text-white hover:bg-black/80 transition-all flex items-center justify-between group shadow-lg shadow-black/10"
                >
                  <div className="text-left">
                    <p className="font-bold text-sm">Descargar fotos de inventario</p>
                    <p className="text-[10px] opacity-60">Archivo ZIP organizado por espacios</p>
                  </div>
                  <Download size={18} className="opacity-60 group-hover:opacity-100" />
                </button>

                <div className="h-px bg-black/5 my-2" />

                <button 
                  onClick={() => {
                    exportToPDF(selectedInventoryForExport, 'owner');
                    setShowExportModal(false);
                  }}
                  className="w-full p-4 rounded-2xl border border-black/5 bg-[#f8f9fa] hover:bg-black hover:text-white transition-all flex items-center justify-between group"
                >
                  <div className="text-left">
                    <p className="font-bold text-sm">Copia para Propietario</p>
                    <p className="text-[10px] opacity-60">Oculta información del inquilino</p>
                  </div>
                  <ChevronRight size={18} className="opacity-40 group-hover:opacity-100" />
                </button>

                <button 
                  onClick={() => {
                    exportToPDF(selectedInventoryForExport, 'tenant');
                    setShowExportModal(false);
                  }}
                  className="w-full p-4 rounded-2xl border border-black/5 bg-[#f8f9fa] hover:bg-black hover:text-white transition-all flex items-center justify-between group"
                >
                  <div className="text-left">
                    <p className="font-bold text-sm">Copia para Inquilino</p>
                    <p className="text-[10px] opacity-60">Oculta información del propietario</p>
                  </div>
                  <ChevronRight size={18} className="opacity-40 group-hover:opacity-100" />
                </button>
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
                      <div key={photo.id} className="relative aspect-square group">
                        <img 
                          src={photo.dataUrl} 
                          alt="Anexo" 
                          className="w-full h-full object-cover rounded-xl border border-black/5"
                          referrerPolicy="no-referrer"
                        />
                        <button 
                          onClick={() => removeAnnexPhoto(photo.id)}
                          className="absolute top-1 right-1 p-1 bg-white/90 rounded-md text-red-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button 
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.multiple = true;
                        input.onchange = (e: any) => handleAnnexPhotoCapture(e);
                        input.click();
                      }}
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

      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('list')}>
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white shadow-lg shadow-black/10">
            <Home size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">CheckInventory</h1>
            <p className="text-[10px] text-muted font-bold uppercase tracking-[0.2em] opacity-40">Property Inventory</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {currentUser?.role === 'admin' && (
            <button 
              onClick={() => setView('dependents')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-xs font-bold ${view === 'dependents' ? 'bg-black text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}
            >
              <Users size={14} />
              <span>Dependientes</span>
              {dependents.length > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[10px] ${view === 'dependents' ? 'bg-white text-black' : 'bg-black text-white'}`}>
                  {dependents.length}
                </span>
              )}
            </button>
          )}
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
            className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-50 text-red-600 transition-all font-bold text-xs"
            title="Cerrar Sesión"
          >
            <LogIn size={18} className="rotate-180" />
            <span className="hidden sm:inline">Salir</span>
          </button>
          {view !== 'list' && (
            <button 
              onClick={() => setView('list')}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 text-muted transition-colors"
            >
              <X size={24} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
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
                    <h2 className="text-4xl font-bold tracking-tight">Mis Inventarios</h2>
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
                <div className="relative w-full md:w-72">
                  <div className="flex bg-white p-1 rounded-xl border border-black/5 mb-3">
                    {(['all', 'draft', 'completed'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                          statusFilter === f ? 'bg-black text-white shadow-sm' : 'text-muted hover:bg-black/5'
                        }`}
                      >
                        {f === 'all' ? 'Todos' : f === 'draft' ? 'Borradores' : 'Listos'}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="Buscar por nombre o dirección..."
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
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredInventories.map((inv) => (
                    <motion.div 
                      layoutId={inv.id}
                      key={inv.id}
                      className="bg-white rounded-3xl border border-black/5 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group overflow-hidden flex flex-col"
                    >
                      <div className="p-6 flex-1">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-2">
                            <div className="bg-black/5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-black/60">
                              {inv.spaces.reduce((acc, s) => acc + s.photos.length, 0)} Fotos
                            </div>
                            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              inv.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {inv.status === 'completed' ? 'Listo' : 'Borrador'}
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-muted uppercase tracking-wider">{inv.date}</span>
                        </div>
                        <h3 className="text-xl font-bold mb-2 group-hover:text-black transition-colors line-clamp-1">{inv.propertyName}</h3>
                        <p className="text-muted text-sm flex items-center gap-1.5 mb-2 line-clamp-1">
                          <MapPin size={14} className="shrink-0" />
                          {inv.address || 'Sin dirección registrada'}
                        </p>
                        
                        {currentUser?.role === 'admin' && inv.creatorName && (
                          <p className="text-muted text-[10px] flex items-center gap-1.5 mb-6 font-bold uppercase tracking-widest opacity-70">
                            <UserIcon size={12} className="shrink-0" />
                            <span>Responsable: <span className="text-black">{inv.creatorName}</span></span>
                          </p>
                        )}
                        
                        <div className="flex items-center gap-2 pt-4 border-t border-black/5">
                          <button 
                            onClick={() => {
                              setCurrentInventory(inv);
                              setExpandedSpaces({});
                              setView('detail');
                            }}
                            className="flex-1 bg-[#f8f9fa] text-black py-2.5 rounded-xl text-sm font-bold hover:bg-black hover:text-white transition-all"
                          >
                            Ver Resumen
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedInventoryForExport(inv);
                              setShowExportModal(true);
                            }}
                            className="w-11 h-11 flex items-center justify-center bg-black/5 text-black rounded-xl hover:bg-black hover:text-white transition-all"
                            title="Descargar PDF"
                          >
                            <Download size={18} />
                          </button>
                        </div>
                      </div>
                      <div className="bg-[#f8f9fa] px-6 py-3 flex items-center justify-between border-t border-black/5">
                        {inv.status === 'completed' ? (
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                            <Save size={12} />
                            Firmado y Bloqueado
                          </div>
                        ) : (
                          <button 
                            onClick={() => {
                              setCurrentInventory(inv);
                              setView('create');
                            }}
                            className="text-[11px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
                          >
                            Editar
                          </button>
                        )}
                        <button 
                          onClick={() => handleDeleteInventory(inv.id)}
                          className="text-[11px] font-bold uppercase tracking-widest text-muted hover:text-red-600 transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
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
                <button 
                  onClick={() => setView('list')}
                  className="flex items-center gap-2 text-muted hover:text-black font-bold text-sm transition-colors"
                >
                  <ChevronLeft size={20} />
                  Volver a inventarios
                </button>
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
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setView('list')}
                  className="flex items-center gap-2 text-muted hover:text-black font-bold text-sm transition-colors"
                >
                  <ChevronLeft size={20} />
                  Volver a la lista
                </button>
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
                      { label: 'Excelente', color: 'text-emerald-600', bg: 'bg-emerald-50', count: currentInventory.spaces.reduce((acc, s) => acc + s.items.filter(i => i.condition === 'Excelente').length, 0) },
                      { label: 'Bueno', color: 'text-blue-600', bg: 'bg-blue-50', count: currentInventory.spaces.reduce((acc, s) => acc + s.items.filter(i => i.condition === 'Bueno').length, 0) },
                      { label: 'Regular', color: 'text-amber-600', bg: 'bg-amber-50', count: currentInventory.spaces.reduce((acc, s) => acc + s.items.filter(i => i.condition === 'Regular').length, 0) },
                      { label: 'Malo', color: 'text-red-600', bg: 'bg-red-50', count: currentInventory.spaces.reduce((acc, s) => acc + s.items.filter(i => i.condition === 'Malo').length, 0) },
                    ].map((stat) => (
                      <div key={stat.label} className={`${stat.bg} rounded-2xl p-4 border border-black/5`}>
                        <p className={`text-[10px] uppercase tracking-widest font-bold ${stat.color} mb-1`}>{stat.label}</p>
                        <p className="text-2xl font-bold">{stat.count}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 p-6 bg-white rounded-2xl border border-black/5">
                    <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
                      <ClipboardList size={16} className="text-muted" />
                      Hallazgos Principales
                    </h4>
                    <div className="space-y-3">
                      {currentInventory.spaces.flatMap(s => s.items.filter(i => i.condition === 'Regular' || i.condition === 'Malo')).length > 0 ? (
                        currentInventory.spaces.flatMap(s => s.items.filter(i => i.condition === 'Regular' || i.condition === 'Malo')).slice(0, 5).map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-muted font-medium">{item.name}</span>
                            <span className={`font-bold ${item.condition === 'Regular' ? 'text-amber-600' : 'text-red-600'}`}>{item.condition}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-emerald-600 font-medium italic">No se encontraron ítems en estado regular o malo. El inmueble está en óptimas condiciones.</p>
                      )}
                      {currentInventory.spaces.flatMap(s => s.items.filter(i => i.condition === 'Regular' || i.condition === 'Malo')).length > 5 && (
                        <p className="text-[10px] text-muted text-center pt-2 italic">Y {currentInventory.spaces.flatMap(s => s.items.filter(i => i.condition === 'Regular' || i.condition === 'Malo')).length - 5} hallazgos más...</p>
                      )}
                    </div>
                  </div>
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
                                  <div key={photo.id} className="aspect-square rounded-2xl overflow-hidden border border-black/5 group/photo relative">
                                    <img 
                                      src={photo.dataUrl} 
                                      alt="Evidencia" 
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover/photo:scale-110"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/photo:opacity-100 transition-opacity" />
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

                {currentInventory.status === 'completed' && (
                  <div className="pt-10 border-t border-black/5">
                    <h3 className="text-xl font-bold mb-8">Firmas de Conformidad</h3>
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
                                    <p className="text-[10px] text-muted">{new Date(annex.createdAt).toLocaleString()}</p>
                                  </div>
                                </div>
                              </div>
                              <p className="text-sm text-black/80 leading-relaxed">{annex.text}</p>
                              {annex.photos && annex.photos.length > 0 && (
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 pt-2">
                                  {annex.photos.map((photo) => (
                                    <div key={photo.id} className="aspect-square rounded-xl overflow-hidden border border-black/5">
                                      <img 
                                        src={photo.dataUrl} 
                                        alt="Anexo" 
                                        className="w-full h-full object-cover"
                                        referrerPolicy="no-referrer"
                                      />
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
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'create' && currentInventory && (
            currentInventory.status === 'completed' ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[3rem] border border-black/5 shadow-sm">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
                  <Save size={32} />
                </div>
                <h3 className="text-xl font-bold">Inventario Bloqueado</h3>
                <p className="text-muted text-sm mt-2 mb-6">Este documento ya ha sido firmado y no permite más ediciones.</p>
                <button 
                  onClick={() => setView('list')}
                  className="bg-black text-white px-8 py-3 rounded-2xl font-bold hover:bg-black/80 transition-all"
                >
                  Volver a la lista
                </button>
              </div>
            ) : (
              <motion.div 
                key="create"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8 pb-32"
              >
              {/* Property Info Card */}
              <div className="bg-white rounded-3xl p-8 border border-black/5 shadow-sm space-y-6">
                <h2 className="text-2xl font-bold tracking-tight">Información del Inmueble</h2>
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
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Tipo de Inmueble</label>
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
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    >
                      <option value="Apartamento">Apartamento</option>
                      <option value="Oficina">Oficina</option>
                      <option value="Local">Local Comercial</option>
                      <option value="Bodega">Bodega</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
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
              <div className="bg-white rounded-3xl p-8 border border-black/5 shadow-sm space-y-6">
                <h2 className="text-2xl font-bold tracking-tight">Partes Interesadas</h2>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Nombre del Propietario</label>
                    <input 
                      type="text"
                      value={currentInventory.ownerName || ''}
                      onChange={(e) => setCurrentInventory({...currentInventory, ownerName: e.target.value})}
                      placeholder="Nombre completo del propietario"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted">Nombre del Inquilino</label>
                    <input 
                      type="text"
                      value={currentInventory.tenantName || ''}
                      onChange={(e) => setCurrentInventory({...currentInventory, tenantName: e.target.value})}
                      placeholder="Nombre completo del inquilino"
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-3 focus:ring-2 focus:ring-black outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Sections Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setView('list')}
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
                  onClick={addSpace}
                  className="bg-black text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-black/80 transition-all text-sm font-bold shadow-lg shadow-black/10"
                >
                  <Plus size={18} />
                  Añadir Espacio
                </button>
              </div>

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

                            {/* Photos Section */}
                            <div className="space-y-4 pt-8 border-t border-black/5">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-widest text-muted">Registro Fotográfico del Espacio</label>
                                <button 
                                  onClick={() => {
                                    setTargetSpaceId(space.id);
                                    fileInputRef.current?.click();
                                  }}
                                  className="text-xs font-bold flex items-center gap-2 text-black hover:opacity-70 transition-all"
                                >
                                  <Camera size={16} />
                                  Tomar Fotos
                                </button>
                              </div>

                              {space.photos.length === 0 ? (
                                <div 
                                  onClick={() => {
                                    setTargetSpaceId(space.id);
                                    fileInputRef.current?.click();
                                  }}
                                  className="border-2 border-dashed border-black/5 rounded-2xl p-10 text-center cursor-pointer hover:bg-black/[0.02] transition-all"
                                >
                                  <Camera size={24} className="mx-auto mb-2 opacity-20" />
                                  <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Añadir fotos de evidencia</p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                                  {space.photos.map((photo) => (
                                    <div key={photo.id} className="relative group aspect-square rounded-xl overflow-hidden border border-black/5 shadow-sm">
                                      <img 
                                        src={photo.dataUrl} 
                                        alt="Evidencia" 
                                        className="w-full h-full object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                      <button 
                                        onClick={() => removePhoto(space.id, photo.id)}
                                        className="absolute top-1 right-1 p-1 bg-white/90 rounded-md text-red-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                  <button 
                                    onClick={() => {
                                      setTargetSpaceId(space.id);
                                      fileInputRef.current?.click();
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
                  onClick={addSpace}
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
                      className="px-6 py-3 rounded-2xl font-bold text-muted hover:bg-black/5 transition-all flex items-center gap-2"
                    >
                      <FileText size={18} />
                      <span className="hidden sm:inline">Guardar Borrador</span>
                      <span className="sm:hidden">Borrador</span>
                    </button>
                  </div>
                  <button 
                    onClick={() => handleSaveInventory('completed')}
                    className="bg-black text-white px-10 py-3 rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center gap-2 shadow-xl shadow-black/10 active:scale-95"
                  >
                    <Save size={18} />
                    <span>Finalizar y Guardar</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
      </main>

      {/* Footer info for desktop */}
      <footer className="max-w-4xl mx-auto p-12 text-center text-muted text-xs opacity-40">
        <p>© 2026 CheckInventory • Inventario Digital de Bienes Raíces</p>
      </footer>
    </div>
  );
}

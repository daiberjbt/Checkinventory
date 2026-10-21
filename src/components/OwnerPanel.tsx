import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, Key, Users, FileText, CheckCircle2, AlertTriangle, 
  Clock, ShieldCheck, Mail, MessageSquare, Copy, Search, RefreshCw, 
  Plus, Check, ChevronDown, ChevronUp, ExternalLink, Calendar,
  WifiOff, ArrowUpRight, DollarSign
} from 'lucide-react';
import { db } from '../firebase';
import { 
  collection, query, where, getDocs, limit, orderBy, 
  getCountFromServer, doc, updateDoc, addDoc, writeBatch, onSnapshot 
} from 'firebase/firestore';
import { format, addMonths } from 'date-fns';
import { User, License, SUPER_ADMIN_EMAIL } from '../types';

interface OwnerPanelProps {
  currentUser: User;
  isOnline: boolean;
  onBack: () => void;
  showNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface AgencyStats {
  loading: boolean;
  dependentsCount?: number;
  draftCount?: number;
  completedCount?: number;
  archivedCount?: number;
  lastActivity?: number | null;
}

type LicenseStatusKey = 'active' | 'expiring' | 'expired' | 'no_license';

// Generate cryptographically secure license code
const generateSecureLicenseCode = (months: number): string => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  let rand1 = '';
  let rand2 = '';
  for (let i = 0; i < 4; i++) {
    rand1 += chars[randomBytes[i] % chars.length];
    rand2 += chars[randomBytes[i + 4] % chars.length];
  }
  return `CHK-${months}M-${rand1}-${rand2}`;
};

export const OwnerPanel: React.FC<OwnerPanelProps> = ({
  currentUser,
  isOnline,
  onBack,
  showNotify
}) => {
  const [activeTab, setActiveTab] = useState<'agencies' | 'licenses'>('agencies');
  
  // Agencies state
  const [agencies, setAgencies] = useState<User[]>([]);
  const [loadingAgencies, setLoadingAgencies] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseStatusKey>('all');
  const [expandedAgencyId, setExpandedAgencyId] = useState<string | null>(null);
  const [agencyStats, setAgencyStats] = useState<Record<string, AgencyStats>>({});

  // Extend license modal state
  const [extendingAgency, setExtendingAgency] = useState<User | null>(null);
  const [extendMonths, setExtendMonths] = useState<3 | 6 | 12>(6);
  const [paymentReference, setPaymentReference] = useState('');
  const [isSubmittingExtension, setIsSubmittingExtension] = useState(false);

  // License codes state
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loadingLicenses, setLoadingLicenses] = useState(true);
  const [licenseDuration, setLicenseDuration] = useState<3 | 6 | 12>(6);
  const [licenseCount, setLicenseCount] = useState<number>(1);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);
  const [licenseFilter, setLicenseFilter] = useState<'all' | 'available' | 'used'>('all');
  const [licenseSearch, setLicenseSearch] = useState('');

  // Fetch agencies (users where role == 'admin', limit 500)
  const fetchAgencies = async () => {
    if (!isOnline) {
      setLoadingAgencies(false);
      return;
    }
    setLoadingAgencies(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'admin'),
        limit(500)
      );
      const snapshot = await getDocs(q);
      const fetched: User[] = [];
      snapshot.forEach(docSnap => {
        fetched.push({ id: docSnap.id, ...docSnap.data() } as User);
      });
      setAgencies(fetched);
    } catch (err) {
      console.error('Error fetching agencies for owner panel:', err);
      showNotify('Error al cargar agencias del panel', 'error');
    } finally {
      setLoadingAgencies(false);
    }
  };

  useEffect(() => {
    fetchAgencies();
  }, [isOnline]);

  // Real-time listener for licenses
  useEffect(() => {
    if (!isOnline) {
      setLoadingLicenses(false);
      return;
    }
    setLoadingLicenses(true);
    const q = query(
      collection(db, 'licenses'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: License[] = [];
        snapshot.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as License);
        });
        setLicenses(list);
        setLoadingLicenses(false);
      },
      (err) => {
        console.error('Error listening to licenses:', err);
        setLoadingLicenses(false);
      }
    );
    return () => unsubscribe();
  }, [isOnline]);

  // Compute status for an agency
  const getLicenseStatus = (agency: User): {
    key: LicenseStatusKey;
    label: string;
    badgeClass: string;
    daysRemaining: number;
    formattedDate: string;
  } => {
    if (!agency.expirationDate) {
      return {
        key: 'no_license',
        label: 'Sin Licencia',
        badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200',
        daysRemaining: 0,
        formattedDate: 'No asignada'
      };
    }
    const expDate = new Date(agency.expirationDate);
    if (isNaN(expDate.getTime())) {
      return {
        key: 'no_license',
        label: 'Sin Licencia',
        badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200',
        daysRemaining: 0,
        formattedDate: 'Fecha inválida'
      };
    }
    const now = new Date();
    const diffMs = expDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const formattedDate = format(expDate, 'dd/MM/yyyy');

    if (daysRemaining < 0) {
      return {
        key: 'expired',
        label: 'Vencida',
        badgeClass: 'bg-red-50 text-red-700 border-red-200',
        daysRemaining,
        formattedDate
      };
    }
    if (daysRemaining <= 15) {
      return {
        key: 'expiring',
        label: 'Por vencer',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
        daysRemaining,
        formattedDate
      };
    }
    return {
      key: 'active',
      label: 'Vigente',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      daysRemaining,
      formattedDate
    };
  };

  // Lazy load stats for an expanded agency
  const loadAgencyStats = async (agency: User) => {
    if (agencyStats[agency.id]?.loading || agencyStats[agency.id]?.dependentsCount !== undefined) {
      return;
    }
    setAgencyStats(prev => ({
      ...prev,
      [agency.id]: { loading: true }
    }));

    try {
      // 1. Dependents count
      const depQ = query(
        collection(db, 'users'),
        where('adminEmail', '==', agency.email),
        where('role', '==', 'dependent'),
        where('isActive', '==', true)
      );
      const depCountSnap = await getCountFromServer(depQ);

      // 2. Draft inventories count
      const draftQ = query(
        collection(db, 'inventories'),
        where('adminEmail', '==', agency.email),
        where('status', '==', 'draft')
      );
      const draftSnap = await getCountFromServer(draftQ);

      // 3. Completed inventories count (firmados)
      const compQ = query(
        collection(db, 'inventories'),
        where('adminEmail', '==', agency.email),
        where('status', '==', 'completed')
      );
      const compSnap = await getCountFromServer(compQ);

      // 4. Archived inventories count
      const archQ = query(
        collection(db, 'inventories'),
        where('adminEmail', '==', agency.email),
        where('status', '==', 'archived')
      );
      const archSnap = await getCountFromServer(archQ);

      // 5. Last activity (most recently updated inventory)
      const lastQ = query(
        collection(db, 'inventories'),
        where('adminEmail', '==', agency.email),
        orderBy('updatedAt', 'desc'),
        limit(1)
      );
      const lastSnap = await getDocs(lastQ);
      let lastActivity: number | null = null;
      if (!lastSnap.empty) {
        const lastDoc = lastSnap.docs[0].data();
        lastActivity = lastDoc.updatedAt || (lastDoc.createdAt ? new Date(lastDoc.createdAt).getTime() : null);
      }

      setAgencyStats(prev => ({
        ...prev,
        [agency.id]: {
          loading: false,
          dependentsCount: depCountSnap.data().count,
          draftCount: draftSnap.data().count,
          completedCount: compSnap.data().count,
          archivedCount: archSnap.data().count,
          lastActivity
        }
      }));
    } catch (err) {
      console.error('Error loading agency statistics:', err);
      setAgencyStats(prev => ({
        ...prev,
        [agency.id]: { loading: false }
      }));
    }
  };

  const handleToggleExpand = (agency: User) => {
    if (expandedAgencyId === agency.id) {
      setExpandedAgencyId(null);
    } else {
      setExpandedAgencyId(agency.id);
      loadAgencyStats(agency);
    }
  };

  // Memory metrics
  const summaryMetrics = useMemo(() => {
    let active = 0;
    let expiring = 0;
    let expired = 0;
    let noLicense = 0;

    agencies.forEach(agency => {
      const st = getLicenseStatus(agency);
      if (st.key === 'active') active++;
      else if (st.key === 'expiring') expiring++;
      else if (st.key === 'expired') expired++;
      else noLicense++;
    });

    return {
      total: agencies.length,
      active,
      expiring,
      expired,
      noLicense
    };
  }, [agencies]);

  // Filtered and sorted agencies
  const filteredAgencies = useMemo(() => {
    return agencies
      .filter(agency => {
        const queryNorm = searchQuery.trim().toLowerCase();
        const agencyName = (agency.agencyName || `${agency.firstName} ${agency.lastName}`).toLowerCase();
        const email = agency.email.toLowerCase();
        const matchesSearch = !queryNorm || agencyName.includes(queryNorm) || email.includes(queryNorm);

        if (!matchesSearch) return false;

        if (statusFilter !== 'all') {
          const st = getLicenseStatus(agency);
          if (st.key !== statusFilter) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Orden por vencimiento (más próximo primero)
        const stA = getLicenseStatus(a);
        const stB = getLicenseStatus(b);
        return stA.daysRemaining - stB.daysRemaining;
      });
  }, [agencies, searchQuery, statusFilter]);

  // Handle Extend License
  const handleConfirmExtension = async () => {
    if (!extendingAgency) return;
    setIsSubmittingExtension(true);
    try {
      const now = new Date();
      const currentExp = extendingAgency.expirationDate ? new Date(extendingAgency.expirationDate) : now;
      const baseDate = currentExp > now ? currentExp : now;
      const newExpiration = addMonths(baseDate, extendMonths);
      const newExpirationIso = newExpiration.toISOString();

      // 1. Update user doc
      const userRef = doc(db, 'users', extendingAgency.id);
      await updateDoc(userRef, {
        expirationDate: newExpirationIso,
        isPremium: true,
        plan: 'license',
        updatedAt: Date.now()
      });

      // 2. Create licenseEvent record
      await addDoc(collection(db, 'licenseEvents'), {
        agencyId: extendingAgency.id,
        agencyEmail: extendingAgency.email,
        action: 'extend',
        months: extendMonths,
        reference: paymentReference.trim() || null,
        previousExpiration: extendingAgency.expirationDate || null,
        newExpiration: newExpirationIso,
        by: currentUser.id,
        at: Date.now()
      });

      // Update local state
      setAgencies(prev => prev.map(a => a.id === extendingAgency.id ? {
        ...a,
        expirationDate: newExpirationIso,
        isPremium: true,
        plan: 'license'
      } : a));

      showNotify(`Licencia extendida por ${extendMonths} meses con éxito hasta ${format(newExpiration, 'dd/MM/yyyy')}`, 'success');
      setExtendingAgency(null);
      setPaymentReference('');
    } catch (err) {
      console.error('Error extending license:', err);
      showNotify('Error al extender la licencia', 'error');
    } finally {
      setIsSubmittingExtension(false);
    }
  };

  // Generate batch of crypto licenses
  const handleGenerateLicenses = async () => {
    if (currentUser.email !== SUPER_ADMIN_EMAIL) {
      showNotify('Solo el superadministrador puede generar códigos.', 'error');
      return;
    }
    setIsGeneratingCodes(true);
    try {
      const batch = writeBatch(db);
      const generatedCodes: string[] = [];

      for (let i = 0; i < licenseCount; i++) {
        const code = generateSecureLicenseCode(licenseDuration);
        generatedCodes.push(code);
        const licenseRef = doc(db, 'licenses', code);
        // Only fields allowed by isValidLicense:
        // { code, isUsed: false, durationMonths, createdAt, createdBy, id }
        batch.set(licenseRef, {
          code,
          isUsed: false,
          durationMonths: licenseDuration,
          createdAt: new Date().toISOString(),
          createdBy: currentUser.email,
          id: code
        });
      }

      await batch.commit();
      showNotify(`¡${licenseCount} código(s) de ${licenseDuration} meses generado(s) con éxito!`, 'success');
    } catch (err) {
      console.error('Error generating licenses batch:', err);
      showNotify('Error al generar los códigos de licencia', 'error');
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  const copyToClipboard = (text: string, label: string = 'Código') => {
    navigator.clipboard.writeText(text);
    showNotify(`${label} copiado al portapapeles`, 'info');
  };

  // Filtered license codes
  const filteredLicenses = useMemo(() => {
    return licenses.filter(lic => {
      if (licenseFilter === 'available' && lic.isUsed) return false;
      if (licenseFilter === 'used' && !lic.isUsed) return false;
      if (licenseSearch.trim()) {
        const q = licenseSearch.trim().toLowerCase();
        return lic.code.toLowerCase().includes(q) || (lic.assignedEmail && lic.assignedEmail.toLowerCase().includes(q));
      }
      return true;
    });
  }, [licenses, licenseFilter, licenseSearch]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-black">
      {/* Top Banner / Privacy Guarantee */}
      <div className="bg-neutral-900 text-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-purple-400 shrink-0" />
            <span className="font-bold tracking-tight">Panel del Propietario · Super Administrador</span>
          </div>
          <span className="text-neutral-400 text-[11px] text-center sm:text-right">
            Sesión exclusiva para {SUPER_ADMIN_EMAIL}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Offline Warning */}
        {!isOnline && (
          <div className="bg-amber-500 text-white p-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-sm shadow-md">
            <WifiOff size={20} />
            <span>El panel requiere internet para consultar y gestionar el estado de las agencias.</span>
          </div>
        )}

        {/* Title Header with Mandatory Privacy Notice */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-black/5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                Plataforma CheckInventory
              </span>
              <span className="text-xs text-muted font-mono">{agencies.length} agencias registradas</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Panel del Propietario</h1>
            <p className="text-xs text-muted leading-relaxed max-w-3xl">
              Este panel muestra solo estado de licencia, cantidad de usuarios e inventarios y fecha de última actividad; no muestra el contenido de los inventarios.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                fetchAgencies();
                showNotify('Actualizando lista de agencias...', 'info');
              }}
              disabled={loadingAgencies || !isOnline}
              className="px-3.5 py-2.5 bg-white border border-black/10 hover:bg-black/5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
              title="Recargar datos"
            >
              <RefreshCw size={14} className={loadingAgencies ? 'animate-spin' : ''} />
              <span>Actualizar</span>
            </button>
            <button
              onClick={onBack}
              className="px-4 py-2.5 bg-black text-white hover:bg-black/80 rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              Volver a la App
            </button>
          </div>
        </div>

        {/* Main Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-black/5 pb-2">
          <button
            onClick={() => setActiveTab('agencies')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'agencies' 
                ? 'bg-black text-white shadow-sm' 
                : 'bg-white text-muted hover:text-black border border-black/5'
            }`}
          >
            <Building2 size={15} />
            <span>Agencias Registradas ({agencies.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('licenses')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'licenses' 
                ? 'bg-black text-white shadow-sm' 
                : 'bg-white text-muted hover:text-black border border-black/5'
            }`}
          >
            <Key size={15} />
            <span>Generador de Códigos ({licenses.length})</span>
          </button>
        </div>

        {activeTab === 'agencies' && (
          <div className="space-y-6">
            {/* 1. Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Total Agencias</p>
                <p className="text-2xl font-black text-black">{summaryMetrics.total}</p>
                <p className="text-[10px] text-muted">Cuentas admin</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Vigentes</p>
                <p className="text-2xl font-black text-emerald-600">{summaryMetrics.active}</p>
                <p className="text-[10px] text-emerald-600/70">&gt; 15 días restantes</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Por Vencer</p>
                <p className="text-2xl font-black text-amber-600">{summaryMetrics.expiring}</p>
                <p className="text-[10px] text-amber-700/70">≤ 15 días restantes</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-red-100 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">Vencidas</p>
                <p className="text-2xl font-black text-red-600">{summaryMetrics.expired}</p>
                <p className="text-[10px] text-red-600/70">Requieren renovación</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm space-y-1 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Sin Licencia</p>
                <p className="text-2xl font-black text-neutral-700">{summaryMetrics.noLicense}</p>
                <p className="text-[10px] text-muted">Sin activación previa</p>
              </div>
            </div>

            {/* 2. Controls: Search, Status Filter & Sorting */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-black/5 shadow-sm">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted opacity-50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre de agencia o correo electrónico..."
                  className="w-full pl-10 pr-4 py-2 bg-[#f8f9fa] border border-black/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-black transition-all"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    statusFilter === 'all' ? 'bg-black text-white' : 'bg-[#f8f9fa] text-muted hover:bg-black/5'
                  }`}
                >
                  Todas ({agencies.length})
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    statusFilter === 'active' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Vigentes ({summaryMetrics.active})
                </button>
                <button
                  onClick={() => setStatusFilter('expiring')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    statusFilter === 'expiring' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  Por Vencer ({summaryMetrics.expiring})
                </button>
                <button
                  onClick={() => setStatusFilter('expired')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    statusFilter === 'expired' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  Vencidas ({summaryMetrics.expired})
                </button>
                <button
                  onClick={() => setStatusFilter('no_license')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    statusFilter === 'no_license' ? 'bg-neutral-700 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  Sin Licencia ({summaryMetrics.noLicense})
                </button>
              </div>
            </div>

            {/* 3. Agency List */}
            {loadingAgencies ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-black/5 space-y-3">
                <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-muted font-bold">Cargando agencias administradoras...</p>
              </div>
            ) : filteredAgencies.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-black/5 space-y-2">
                <Building2 size={36} className="mx-auto text-muted opacity-30" />
                <h3 className="text-base font-bold text-neutral-800">No se encontraron agencias</h3>
                <p className="text-xs text-muted max-w-md mx-auto">
                  {searchQuery ? 'Prueba con otros términos de búsqueda.' : 'No hay agencias con el filtro de licencia seleccionado.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAgencies.map(agency => {
                  const status = getLicenseStatus(agency);
                  const isExpanded = expandedAgencyId === agency.id;
                  const stats = agencyStats[agency.id];
                  const agencyDisplayName = agency.agencyName || `${agency.firstName} ${agency.lastName}`.trim() || 'Agencia';
                  const adminFullName = `${agency.firstName} ${agency.lastName}`.trim();

                  // Pre-fill mailto
                  const mailSubject = encodeURIComponent(`Renovación de Licencia CheckInventory - ${agencyDisplayName}`);
                  const mailBody = encodeURIComponent(
                    `Estimado/a ${adminFullName || agencyDisplayName},\n\nLe escribimos desde CheckInventory para recordarle que la licencia de su agencia vence el ${status.formattedDate}.\n\nPara garantizar la continuidad operativa de su equipo y el acceso a la creación de inventarios y actas digitales, puede realizar la renovación comunicándose con nosotros o adquiriendo su nuevo código de activación.\n\nSaludos cordiales,\nEquipo CheckInventory`
                  );
                  const mailtoUrl = `mailto:${agency.email}?subject=${mailSubject}&body=${mailBody}`;

                  // Pre-fill WhatsApp
                  const rawPhone = agency.phone || '';
                  const cleanPhone = rawPhone.replace(/\D/g, '');
                  const waText = encodeURIComponent(
                    `Hola ${adminFullName || agencyDisplayName}, te saludamos desde CheckInventory. Te recordamos que la licencia de tu agencia vence el ${status.formattedDate}. ¿Deseas renovar tu licencia ahora para continuar sin interrupciones?`
                  );
                  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waText}` : null;

                  return (
                    <div 
                      key={agency.id} 
                      className="bg-white rounded-2xl border border-black/5 hover:border-black/20 transition-all shadow-sm overflow-hidden"
                    >
                      {/* Main Agency Header Row */}
                      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-[#f8f9fa] border border-black/5 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                            {agency.agencyLogo ? (
                              <img 
                                src={agency.agencyLogo} 
                                alt={agencyDisplayName}
                                className="max-w-full max-h-full object-contain"
                              />
                            ) : (
                              <Building2 size={22} className="text-muted" />
                            )}
                          </div>

                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-bold tracking-tight text-neutral-900 truncate">
                                {agencyDisplayName}
                              </h3>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${status.badgeClass}`}>
                                {status.label}
                              </span>
                              {agency.email === SUPER_ADMIN_EMAIL && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                  Super Admin
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-muted font-medium flex items-center gap-1.5">
                              <span>{agency.email}</span>
                              {agency.phone && (
                                <>
                                  <span className="opacity-40">·</span>
                                  <span className="font-mono text-[11px] text-neutral-600">WA: {agency.phone}</span>
                                </>
                              )}
                            </p>

                            <p className="text-[11px] text-neutral-600 pt-0.5">
                              {status.key === 'no_license' ? (
                                <span className="text-muted font-medium">Sin fecha de vencimiento configurada</span>
                              ) : status.daysRemaining < 0 ? (
                                <span className="text-red-600 font-bold">
                                  Venció el {status.formattedDate} (hace {Math.abs(status.daysRemaining)} días)
                                </span>
                              ) : (
                                <span>
                                  Vence el <strong>{status.formattedDate}</strong> ({status.daysRemaining} {status.daysRemaining === 1 ? 'día restante' : 'días restantes'})
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Top Action Buttons */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => {
                              setExtendingAgency(agency);
                              setExtendMonths(6);
                              setPaymentReference('');
                            }}
                            className="px-3.5 py-2 bg-black text-white hover:bg-neutral-800 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                          >
                            <Calendar size={13} />
                            <span>Extender</span>
                          </button>

                          <a
                            href={mailtoUrl}
                            className="p-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl transition-all"
                            title="Recordar por correo electrónico"
                          >
                            <Mail size={16} />
                          </a>

                          {waUrl ? (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl transition-all"
                              title="Recordar por WhatsApp"
                            >
                              <MessageSquare size={16} />
                            </a>
                          ) : (
                            <span 
                              className="p-2 bg-neutral-50 text-neutral-300 rounded-xl cursor-not-allowed"
                              title="La agencia no tiene WhatsApp registrado en su perfil"
                            >
                              <MessageSquare size={16} />
                            </span>
                          )}

                          <button
                            onClick={() => handleToggleExpand(agency)}
                            className="p-2 bg-[#f8f9fa] hover:bg-neutral-200 text-neutral-700 rounded-xl transition-all ml-1"
                            title={isExpanded ? 'Contraer detalles' : 'Expandir estadísticas de uso'}
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>

                      {/* Expandable Statistics Section (Lazy Loaded) */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-black/5 bg-[#fafafa] px-5 py-4 overflow-hidden"
                          >
                            {stats?.loading ? (
                              <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted font-bold">
                                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                                <span>Consultando métricas de la agencia...</span>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div className="bg-white p-3 rounded-xl border border-black/5">
                                    <div className="flex items-center gap-2 text-muted text-[10px] font-bold uppercase tracking-wider">
                                      <Users size={12} />
                                      <span>Dependientes Activos</span>
                                    </div>
                                    <p className="text-xl font-bold mt-1 text-black">
                                      {stats?.dependentsCount ?? 0}
                                    </p>
                                  </div>

                                  <div className="bg-white p-3 rounded-xl border border-black/5">
                                    <div className="flex items-center gap-2 text-muted text-[10px] font-bold uppercase tracking-wider">
                                      <FileText size={12} />
                                      <span>Borradores</span>
                                    </div>
                                    <p className="text-xl font-bold mt-1 text-neutral-600">
                                      {stats?.draftCount ?? 0}
                                    </p>
                                  </div>

                                  <div className="bg-white p-3 rounded-xl border border-black/5">
                                    <div className="flex items-center gap-2 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                                      <CheckCircle2 size={12} />
                                      <span>Firmados (Completados)</span>
                                    </div>
                                    <p className="text-xl font-bold mt-1 text-emerald-600">
                                      {stats?.completedCount ?? 0}
                                    </p>
                                  </div>

                                  <div className="bg-white p-3 rounded-xl border border-black/5">
                                    <div className="flex items-center gap-2 text-neutral-500 text-[10px] font-bold uppercase tracking-wider">
                                      <Clock size={12} />
                                      <span>Archivados</span>
                                    </div>
                                    <p className="text-xl font-bold mt-1 text-neutral-700">
                                      {stats?.archivedCount ?? 0}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 text-xs text-muted">
                                  <div className="flex items-center gap-1.5">
                                    <Clock size={13} className="text-neutral-500" />
                                    <span>
                                      Última actividad registrada:{' '}
                                      <strong className="text-neutral-800">
                                        {stats?.lastActivity 
                                          ? format(new Date(stats.lastActivity), 'dd/MM/yyyy HH:mm') 
                                          : 'Sin inventarios aún'}
                                      </strong>
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-neutral-400">
                                    ID de Usuario: <code className="font-mono text-[10px]">{agency.id}</code>
                                  </span>
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: License Code Generator and Management Suite */}
        {activeTab === 'licenses' && (
          <div className="space-y-6">
            {/* Generator Box */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-black/5 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-black/5">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                    Generación Criptográfica Segura
                  </span>
                  <h3 className="text-lg font-bold mt-1">Generador de Códigos de Activación</h3>
                  <p className="text-xs text-muted">
                    Genera códigos en formato <code className="font-mono bg-neutral-100 px-1 py-0.5 rounded font-bold">CHK-&lt;3|6|12&gt;M-XXXX-XXXX</code> con entropía aleatoria estricta.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Duración de la Licencia
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[3, 6, 12].map((dur) => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => setLicenseDuration(dur as 3 | 6 | 12)}
                        className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          licenseDuration === dur
                            ? 'bg-black text-white border-black shadow-sm'
                            : 'bg-[#f8f9fa] text-neutral-700 border-black/5 hover:bg-neutral-100'
                        }`}
                      >
                        {dur} Meses
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Cantidad a Generar (1 - 10)
                  </label>
                  <select
                    value={licenseCount}
                    onChange={(e) => setLicenseCount(Number(e.target.value))}
                    className="w-full bg-[#f8f9fa] border border-black/5 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-black"
                  >
                    {[1, 2, 3, 5, 10].map((num) => (
                      <option key={num} value={num}>
                        {num} {num === 1 ? 'código' : 'códigos'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleGenerateLicenses}
                    disabled={isGeneratingCodes || !isOnline}
                    className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 cursor-pointer"
                  >
                    <Plus size={15} />
                    <span>{isGeneratingCodes ? 'Generando...' : `Generar ${licenseCount} Código(s)`}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* License Codes List */}
            <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted opacity-50" />
                  <input
                    type="text"
                    value={licenseSearch}
                    onChange={(e) => setLicenseSearch(e.target.value)}
                    placeholder="Buscar código o correo asignado..."
                    className="w-full pl-10 pr-4 py-2 bg-[#f8f9fa] border border-black/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-black"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setLicenseFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      licenseFilter === 'all' ? 'bg-black text-white' : 'bg-[#f8f9fa] text-muted hover:bg-black/5'
                    }`}
                  >
                    Todos ({licenses.length})
                  </button>
                  <button
                    onClick={() => setLicenseFilter('available')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      licenseFilter === 'available' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    Disponibles ({licenses.filter(l => !l.isUsed).length})
                  </button>
                  <button
                    onClick={() => setLicenseFilter('used')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      licenseFilter === 'used' ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    Usados ({licenses.filter(l => l.isUsed).length})
                  </button>
                </div>
              </div>

              {loadingLicenses ? (
                <div className="py-12 text-center text-xs text-muted font-bold">
                  <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Cargando códigos de licencia...
                </div>
              ) : filteredLicenses.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted">
                  No hay códigos que coincidan con la búsqueda o filtro.
                </div>
              ) : (
                <div className="divide-y divide-black/5 max-h-[500px] overflow-y-auto">
                  {filteredLicenses.map((lic) => {
                    const durationMonths = lic.durationMonths || 6;
                    const waShareText = encodeURIComponent(
                      `¡Hola! Aquí tienes tu código de activación para CheckInventory válido por ${durationMonths} meses:\n\n${lic.code}\n\nIngresa este código al registrarte como Administrador o en la sección Ajustes > Licencia.`
                    );
                    const waShareUrl = `https://wa.me/?text=${waShareText}`;

                    return (
                      <div 
                        key={lic.id || lic.code} 
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-black tracking-wider text-black">
                              {lic.code}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                              {durationMonths} Meses
                            </span>
                            {lic.isUsed ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-200 text-neutral-600">
                                Utilizado
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Disponible
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted">
                            <span>Creado: {lic.createdAt ? format(new Date(lic.createdAt), 'dd/MM/yyyy HH:mm') : 'N/A'}</span>
                            {lic.assignedEmail && (
                              <>
                                <span>·</span>
                                <span className="font-bold text-neutral-700">Activado por: {lic.assignedEmail}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            onClick={() => copyToClipboard(lic.code, 'Código de licencia')}
                            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                            title="Copiar código"
                          >
                            <Copy size={13} />
                            <span>Copiar</span>
                          </button>

                          <a
                            href={waShareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                            title="Enviar código por WhatsApp"
                          >
                            <MessageSquare size={13} />
                            <span>Enviar por WhatsApp</span>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Extender Licencia */}
      <AnimatePresence>
        {extendingAgency && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] max-w-md w-full p-6 sm:p-7 shadow-2xl border border-black/10 space-y-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                    Extensión Manual
                  </span>
                  <h3 className="text-xl font-bold text-neutral-900">Extender Licencia</h3>
                  <p className="text-xs text-muted">
                    {extendingAgency.agencyName || `${extendingAgency.firstName} ${extendingAgency.lastName}`} ({extendingAgency.email})
                  </p>
                </div>
                <button
                  onClick={() => setExtendingAgency(null)}
                  className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center text-muted"
                >
                  ✕
                </button>
              </div>

              {/* Current expiration info */}
              <div className="bg-[#f8f9fa] p-4 rounded-2xl border border-black/5 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted font-medium">Vencimiento actual:</span>
                  <span className="font-bold text-neutral-800">
                    {extendingAgency.expirationDate 
                      ? format(new Date(extendingAgency.expirationDate), 'dd/MM/yyyy') 
                      : 'Sin licencia previa'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted font-medium">Nuevo vencimiento:</span>
                  <span className="font-bold text-purple-700">
                    {(() => {
                      const now = new Date();
                      const currentExp = extendingAgency.expirationDate ? new Date(extendingAgency.expirationDate) : now;
                      const baseDate = currentExp > now ? currentExp : now;
                      return format(addMonths(baseDate, extendMonths), 'dd/MM/yyyy');
                    })()}
                  </span>
                </div>
              </div>

              {/* Selector of duration */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  Selecciona la duración
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 6, 12].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExtendMonths(m as 3 | 6 | 12)}
                      className={`py-3 rounded-2xl text-xs font-bold border transition-all ${
                        extendMonths === m
                          ? 'bg-black text-white border-black shadow-sm'
                          : 'bg-[#f8f9fa] text-neutral-700 border-black/5 hover:bg-neutral-100'
                      }`}
                    >
                      +{m} Meses
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional Payment Reference */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  Referencia de Pago o Factura (Opcional)
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted opacity-40" />
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Ej: Transf. Nequi #98234, Factura 104"
                    className="w-full pl-9 pr-4 py-3 bg-[#f8f9fa] border border-black/5 rounded-2xl text-xs outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExtendingAgency(null)}
                  disabled={isSubmittingExtension}
                  className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmExtension}
                  disabled={isSubmittingExtension}
                  className="flex-1 py-3 bg-purple-700 hover:bg-purple-800 text-white rounded-2xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
                >
                  <Check size={14} />
                  <span>{isSubmittingExtension ? 'Guardando...' : 'Confirmar Extensión'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

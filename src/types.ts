export type UserRole = 'admin' | 'dependent';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string; // Only for local simulation
  role: UserRole;
  adminEmail?: string; // Required if role is 'dependent'
  adminUid?: string; // UID of the admin for dependents
  adminName?: string; // Name of the admin for dependents
  agencyName?: string; // Brand or agency name
  agencyLogo?: string; // Logo image dataUrl / downloadURL
  themePreference?: 'light' | 'dark' | 'system';
  isDarkMode?: boolean;
  hasSeenOnboarding?: boolean;
  isPremium?: boolean;
  plan?: 'monthly' | 'yearly' | 'license';
  expirationDate?: string;
  licenseCode?: string;
  isActive?: boolean;
  isDeleted?: boolean;
  adminExpirationDate?: string;
  adminPlan?: 'monthly' | 'yearly' | 'license';
  ownerTemplate?: string;
  tenantTemplate?: string;
}

export interface License {
  id?: string;
  code: string;
  isUsed: boolean;
  durationMonths?: number;
  createdAt: string;
  createdBy?: string;
  assignedTo?: string | null;
  assignedEmail?: string | null;
  activatedAt?: string | null;
  expiresAt?: string | null;
}

export interface Photo {
  id: string;
  dataUrl?: string; // Legacy support; empty for new photos
  url?: string; // Firebase Storage download URL
  storagePath?: string;
  localBlobId?: string; // Pointer to IndexedDB Blob record while offline
  syncStatus?: 'synced' | 'pending' | 'uploading' | 'failed';
  caption?: string;
  timestamp: number;
}

export interface OfflinePhotoRecord {
  id: string;
  photoId?: string;
  inventoryId: string;
  spaceId?: string;
  isAnnex?: boolean;
  annexIndex?: number;
  blob: Blob;
  storagePath: string;
  fileName?: string;
  contentType?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: number;
  updatedAt?: number;
  status: 'pending' | 'uploading' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string;
  lastAttemptAt?: number;
  adminUid: string;
  userUid?: string;
  uploadedBy?: string;
  adminEmail?: string;
  storageUploaded?: boolean;
  downloadUrl?: string;
  isDeleted?: boolean;
  caption?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  condition: 'Excelente' | 'Bueno' | 'Regular' | 'Malo';
  details: string;
}

export interface InventorySpace {
  id: string;
  title: string;
  description: string;
  items: InventoryItem[];
  photos: Photo[];
  generalObservations?: string;
}

export interface Annex {
  id: string;
  text: string;
  photos: Photo[];
  createdAt: number;
  createdBy: string;
  creatorName: string;
}

export type PropertyType = 'Apartamento' | 'Oficina' | 'Local' | 'Bodega' | 'Casa' | 'Otro';

export interface TemplateSpace {
  id: string;
  title: string;
  elements: string[];
}

export interface InventoryTemplate {
  id: string;
  templateName: string;
  propertyType: PropertyType;
  createdBy: string;
  createdAt: number;
  structure: TemplateSpace[];
}

export interface RemoteSigningToken {
  token: string;
  email: string;
  name?: string;
  role: 'owner' | 'tenant' | 'reception_owner' | 'reception_tenant';
  createdAt: number;
  expiresAt: number;
  signed: boolean;
  signedAt?: number;
}

export interface Inventory {
  id: string;
  propertyName: string;
  propertyType?: PropertyType;
  customPropertyType?: string;
  address: string;
  neighborhood?: string;
  rentValue?: string;
  internalCode?: string;
  ownerName?: string;
  ownerEmail?: string;
  tenantName?: string;
  tenantEmail?: string;
  date: string;
  spaces: InventorySpace[];
  annexes?: Annex[];
  createdAt: number;
  status: 'draft' | 'completed' | 'archived';
  ownerSignature?: string;
  tenantSignature?: string;
  // Acta inquilino (Recibido)
  tenantReceiveDate?: string;
  tenantReceiveText?: string;
  tenantReceiveSignature?: string;
  // Acta propietario (Entrega)
  ownerDeliveryDate?: string;
  ownerDeliveryText?: string;
  ownerDeliverySignature?: string;
  // Remote Signing & Email tracking
  remoteSigningTokens?: { [key: string]: RemoteSigningToken };
  ownerRemoteSigned?: boolean;
  tenantRemoteSigned?: boolean;
  ownerSignedActSent?: boolean;
  tenantSignedActSent?: boolean;
  createdBy: string;
  creatorName: string;
  adminEmail: string;
  updatedAt?: number;
}

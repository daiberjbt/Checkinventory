export type UserRole = 'admin' | 'dependent';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string; // Only for local simulation
  role: UserRole;
  adminEmail?: string; // Required if role is 'dependent'
}

export interface Photo {
  id: string;
  dataUrl: string;
  timestamp: number;
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
}

export interface Annex {
  id: string;
  text: string;
  photos: Photo[];
  createdAt: number;
  createdBy: string;
  creatorName: string;
}

export type PropertyType = 'Apartamento' | 'Oficina' | 'Local' | 'Bodega' | 'Otro';

export interface Inventory {
  id: string;
  propertyName: string;
  propertyType?: PropertyType;
  address: string;
  neighborhood?: string;
  rentValue?: string;
  internalCode?: string;
  ownerName?: string;
  tenantName?: string;
  date: string;
  spaces: InventorySpace[];
  annexes?: Annex[];
  createdAt: number;
  status: 'draft' | 'completed';
  ownerSignature?: string;
  tenantSignature?: string;
  createdBy: string;
  creatorName: string;
  adminEmail: string;
}

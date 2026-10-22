import { Inventory } from '../types';

/**
 * Normalizes text: lowercase, removes diacritics/accents, replaces non-alphanumeric chars with spaces.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

/**
 * Builds search tokens from propertyName, address, internalCode, ownerName, and tenantName.
 * Splits into words of 2+ characters, generates prefixes of length 2 to 12 chars,
 * includes full normalized internalCode, deduplicated, capped at 300 tokens.
 */
export function buildSearchTokens(
  inv: Partial<Pick<Inventory, 'propertyName' | 'address' | 'internalCode' | 'ownerName' | 'tenantName'>>
): string[] {
  const tokenSet = new Set<string>();

  const fields = [
    inv.propertyName,
    inv.address,
    inv.internalCode,
    inv.ownerName,
    inv.tenantName,
  ];

  for (const field of fields) {
    if (!field) continue;
    const normalized = normalizeText(field);
    if (!normalized) continue;

    const words = normalized.split(/\s+/).filter(w => w.length >= 2);
    for (const word of words) {
      const maxPrefixLen = Math.min(word.length, 12);
      for (let len = 2; len <= maxPrefixLen; len++) {
        tokenSet.add(word.slice(0, len));
      }
    }
  }

  // Include full internalCode normalized (both with words and stripped of whitespace)
  if (inv.internalCode) {
    const rawClean = inv.internalCode
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (rawClean.length >= 2) {
      tokenSet.add(rawClean);
      // Also generate prefixes for clean internal code if up to 12 chars
      const maxLen = Math.min(rawClean.length, 12);
      for (let len = 2; len <= maxLen; len++) {
        tokenSet.add(rawClean.slice(0, len));
      }
    }
  }

  return Array.from(tokenSet).slice(0, 300);
}

/**
 * Computes isReceived flag from reception and delivery signatures
 */
export function computeIsReceived(
  inv: Partial<Pick<Inventory, 'tenantReceiveSignature' | 'ownerDeliverySignature'>>
): boolean {
  return !!(inv.tenantReceiveSignature || inv.ownerDeliverySignature);
}

/**
 * Computes isAssigned flag from assignedTo
 */
export function computeIsAssigned(
  inv: Partial<Pick<Inventory, 'assignedTo'>>
): boolean {
  return !!inv.assignedTo;
}

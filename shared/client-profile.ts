/**
 * Legal profile of a client (customer). Shared by the API and the web client so
 * the form, the validation and the generated client code never disagree.
 *
 * Local constraints: a Tahiti business is identified by its N° TAHITI (ISPF),
 * companies registered at the TPI of Papeete also carry an RCS number, and the
 * official verification documents depend on the legal category.
 */

import { localised } from './labels-locale';

export const ENTITY_CATEGORIES = [
  'PRIVATE_INDIVIDUAL',
  'PRIVATE_COMPANY',
  'SOLE_PROPRIETORSHIP_PATENTE',
  'PUBLIC_ADMINISTRATION',
  'ASSOCIATION',
] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export const ENTITY_CATEGORY_LABELS: Record<EntityCategory, string> = localised({
  PRIVATE_INDIVIDUAL: 'Particulier',
  PRIVATE_COMPANY: 'Société commerciale',
  SOLE_PROPRIETORSHIP_PATENTE: 'Entreprise individuelle / Patenté',
  PUBLIC_ADMINISTRATION: 'Administration publique / Collectivité',
  ASSOCIATION: 'Association',
}, {
  PRIVATE_INDIVIDUAL: 'Individual',
  PRIVATE_COMPANY: 'Company',
  SOLE_PROPRIETORSHIP_PATENTE: 'Licensed business (patente)',
  PUBLIC_ADMINISTRATION: 'Public administration / municipality',
  ASSOCIATION: 'Association',
});

export const ENTITY_CATEGORY_HINTS: Record<EntityCategory, string> = {
  PRIVATE_INDIVIDUAL: 'Personne physique : aucun justificatif d’entreprise n’est demandé.',
  PRIVATE_COMPANY: 'SARL, SAS, SA… immatriculée au TPI de Papeete.',
  SOLE_PROPRIETORSHIP_PATENTE: 'EI, EURL ou patenté exerçant en nom propre.',
  PUBLIC_ADMINISTRATION: 'Service public, collectivité, établissement public.',
  ASSOCIATION: 'Association déclarée loi 1901 locale.',
};

/**
 * Client-code prefix per category. The code is what the user asks for when
 * creating a client: PAR-0001, SOC-0001, PAT-0001, ADM-0001, ASC-0001.
 */
export const ENTITY_CATEGORY_PREFIX: Record<EntityCategory, string> = {
  PRIVATE_INDIVIDUAL: 'PAR',
  PRIVATE_COMPANY: 'SOC',
  SOLE_PROPRIETORSHIP_PATENTE: 'PAT',
  PUBLIC_ADMINISTRATION: 'ADM',
  ASSOCIATION: 'ASC',
};

export const LEGAL_FORMS = ['SARL', 'SAS', 'SA', 'EI', 'EURL', 'COLLECTIVITE', 'ETABLISSEMENT_PUBLIC', 'AUTRE'] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const LEGAL_FORM_LABELS: Record<LegalForm, string> = localised({
  SARL: 'SARL',
  SAS: 'SAS',
  SA: 'SA',
  EI: 'Entreprise individuelle (EI)',
  EURL: 'EURL',
  COLLECTIVITE: 'Collectivité',
  ETABLISSEMENT_PUBLIC: 'Établissement public',
  AUTRE: 'Autre',
}, {
  EI: 'Sole proprietorship (EI)',
  COLLECTIVITE: 'Local authority',
  ETABLISSEMENT_PUBLIC: 'Public institution',
  AUTRE: 'Other',
});

export const CLIENT_VAT_REGIMES = ['REAL', 'SIMPLIFIE', 'EXONERE', 'FRANCHISE', 'TPS_ONLY'] as const;
export type ClientVatRegime = (typeof CLIENT_VAT_REGIMES)[number];

export const CLIENT_VAT_REGIME_LABELS: Record<ClientVatRegime, string> = localised({
  REAL: 'Réel',
  SIMPLIFIE: 'Simplifié',
  EXONERE: 'Exonéré de TVA',
  FRANCHISE: 'Franchise en base',
  TPS_ONLY: 'TPS uniquement',
}, {
  REAL: 'Actual',
  SIMPLIFIE: 'Simplified',
  EXONERE: 'VAT exempt',
  FRANCHISE: 'Basic exemption',
  TPS_ONLY: 'TPS only',
});

export const CLIENT_PAYMENT_METHODS = ['BANK_TRANSFER', 'CHECK', 'CARD', 'CASH'] as const;
export type ClientPaymentMethod = (typeof CLIENT_PAYMENT_METHODS)[number];

export const CLIENT_PAYMENT_METHOD_LABELS: Record<ClientPaymentMethod, string> = localised({
  BANK_TRANSFER: 'Virement bancaire',
  CHECK: 'Chèque',
  CARD: 'Carte bancaire',
  CASH: 'Espèces',
}, {
  BANK_TRANSFER: 'Bank transfer',
  CHECK: 'Cheque',
  CARD: 'Card',
  CASH: 'Cash',
});

export const CLIENT_PAYMENT_TERMS = ['IMMEDIATE', 'NET_30_DAYS', 'NET_60_DAYS', 'UPFRONT_DEPOSIT'] as const;
export type ClientPaymentTerms = (typeof CLIENT_PAYMENT_TERMS)[number];

export const CLIENT_PAYMENT_TERM_LABELS: Record<ClientPaymentTerms, string> = localised({
  IMMEDIATE: 'Comptant',
  NET_30_DAYS: '30 jours net',
  NET_60_DAYS: '60 jours net',
  UPFRONT_DEPOSIT: 'Acompte à la commande',
}, {
  IMMEDIATE: 'Due immediately',
  NET_30_DAYS: 'Net 30 days',
  NET_60_DAYS: 'Net 60 days',
  UPFRONT_DEPOSIT: 'Deposit on order',
});

/** Days used by the invoice due-date computation for each term. */
export const CLIENT_PAYMENT_TERM_DAYS: Record<ClientPaymentTerms, number> = {
  IMMEDIATE: 0,
  NET_30_DAYS: 30,
  NET_60_DAYS: 60,
  UPFRONT_DEPOSIT: 0,
};

/**
 * The company row keeps a legacy two-value regime (drives the franchise note on
 * documents); the detailed regime is the one shown in the forms.
 */
export function legacyVatRegimeFor(detail: ClientVatRegime): 'standard' | 'franchise' {
  return detail === 'REAL' || detail === 'SIMPLIFIE' ? 'standard' : 'franchise';
}

export function vatRegimeDetailFromLegacy(value: string | null | undefined): ClientVatRegime {
  return value === 'franchise' ? 'FRANCHISE' : 'REAL';
}

/** Invoices and PDFs read address1/city: feed them from the profile address. */
export function mailingAddressLine(input: {
  street_building_zone?: string | null;
  po_box_number?: string | null;
  address1?: string | null;
}): string | null {
  if (input.street_building_zone) return input.street_building_zone;
  if (input.po_box_number) return `B.P. ${input.po_box_number}`;
  return input.address1 ?? null;
}

export function mailingCity(input: {
  physical_municipality?: string | null;
  po_box_municipality?: string | null;
  city?: string | null;
}): string | null {
  return input.physical_municipality ?? input.po_box_municipality ?? input.city ?? null;
}

export const CLIENT_BANKS = ['BANQUE_DE_POLYNESIE', 'BANQUE_DE_TAHITI', 'SOCREDO', 'CCP', 'TRESOR_PUBLIC', 'OTHER'] as const;
export type ClientBank = (typeof CLIENT_BANKS)[number];

export const CLIENT_BANK_LABELS: Record<ClientBank, string> = localised({
  BANQUE_DE_POLYNESIE: 'Banque de Polynésie',
  BANQUE_DE_TAHITI: 'Banque de Tahiti',
  SOCREDO: 'SOCREDO',
  CCP: 'CCP',
  TRESOR_PUBLIC: 'Trésor public',
  OTHER: 'Autre',
}, {
  TRESOR_PUBLIC: 'Public Treasury',
  OTHER: 'Other',
});

export const CLIENT_ACCOUNT_STATUSES = ['PENDING_DOCUMENTS', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];

export const CLIENT_ACCOUNT_STATUS_LABELS: Record<ClientAccountStatus, string> = localised({
  PENDING_DOCUMENTS: 'Documents manquants',
  UNDER_REVIEW: 'En vérification',
  APPROVED: 'Validé',
  REJECTED: 'Refusé',
}, {
  PENDING_DOCUMENTS: 'Missing documents',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
});

export const CLIENT_DOCUMENT_TYPES = [
  'doc_kbis',
  'doc_tahiti',
  'doc_rib',
  'doc_id_manager',
  'doc_delegation_power',
  'doc_tax_clearance',
  'doc_patente_card',
  'doc_id_owner',
  'doc_official_po',
  'doc_public_rib',
  'doc_signature_delegation',
] as const;
export type ClientDocumentType = (typeof CLIENT_DOCUMENT_TYPES)[number];

export const CLIENT_DOCUMENT_LABELS: Record<ClientDocumentType, string> = localised({
  doc_kbis: 'Extrait Kbis (TPI Papeete)',
  doc_tahiti: 'Certificat N° TAHITI (ISPF)',
  doc_rib: 'RIB bancaire professionnel',
  doc_id_manager: 'Pièce d’identité du gérant / représentant',
  doc_delegation_power: 'Pouvoir de délégation de signature',
  doc_tax_clearance: 'Attestation de régularité fiscale (DICP)',
  doc_patente_card: 'Carte de patente de l’année en cours',
  doc_id_owner: 'Pièce d’identité du titulaire',
  doc_official_po: 'Engagement juridique / bon de commande officiel',
  doc_public_rib: 'RIB Trésor public / paierie',
  doc_signature_delegation: 'Acte de nomination / délégation de signature',
}, {
  doc_kbis: 'Kbis extract (TPI Papeete)',
  doc_tahiti: 'TAHITI certificate (ISPF)',
  doc_rib: 'Business bank account details',
  doc_id_manager: 'Manager / representative ID',
  doc_delegation_power: 'Signing delegation power',
  doc_tax_clearance: 'Tax compliance certificate (DICP)',
  doc_patente_card: 'Current year business licence card',
  doc_id_owner: 'Owner ID',
  doc_official_po: 'Legal commitment / official purchase order',
  doc_public_rib: 'Public Treasury bank details',
  doc_signature_delegation: 'Appointment / signing delegation deed',
});

export interface RequiredClientDocument {
  type: ClientDocumentType;
  required: boolean;
  /** Some documents are only needed when the signatory is not the legal manager. */
  conditional?: string;
}

/** Checklist of Section 5, per legal category. */
export const CLIENT_DOCUMENT_CHECKLIST: Record<EntityCategory, RequiredClientDocument[]> = {
  PRIVATE_COMPANY: [
    { type: 'doc_kbis', required: true },
    { type: 'doc_tahiti', required: true },
    { type: 'doc_rib', required: true },
    { type: 'doc_id_manager', required: true },
    { type: 'doc_delegation_power', required: false, conditional: 'Si le contact n’est pas le gérant' },
    { type: 'doc_tax_clearance', required: false },
  ],
  SOLE_PROPRIETORSHIP_PATENTE: [
    { type: 'doc_patente_card', required: true },
    { type: 'doc_tahiti', required: true },
    { type: 'doc_rib', required: true },
    { type: 'doc_id_owner', required: true },
  ],
  PUBLIC_ADMINISTRATION: [
    { type: 'doc_official_po', required: true },
    { type: 'doc_tahiti', required: true },
    { type: 'doc_public_rib', required: true },
    { type: 'doc_signature_delegation', required: true },
  ],
  ASSOCIATION: [
    { type: 'doc_tahiti', required: true },
    { type: 'doc_rib', required: true },
    { type: 'doc_id_manager', required: true },
    { type: 'doc_delegation_power', required: false, conditional: 'Si le contact n’est pas le président' },
  ],
  PRIVATE_INDIVIDUAL: [{ type: 'doc_id_owner', required: true }],
};

export function checklistFor(category: EntityCategory): RequiredClientDocument[] {
  return CLIENT_DOCUMENT_CHECKLIST[category] ?? CLIENT_DOCUMENT_CHECKLIST.PRIVATE_INDIVIDUAL;
}

export function requiredDocumentTypes(category: EntityCategory): ClientDocumentType[] {
  return checklistFor(category).filter((entry) => entry.required).map((entry) => entry.type);
}

export function missingDocuments(category: EntityCategory, uploaded: readonly string[]): ClientDocumentType[] {
  const present = new Set(uploaded);
  return requiredDocumentTypes(category).filter((type) => !present.has(type));
}

/** A private individual is not a legal entity: the company fields do not apply. */
export function isLegalEntity(category: EntityCategory): boolean {
  return category !== 'PRIVATE_INDIVIDUAL';
}

export type ClientProfileErrorCode = 'required' | 'invalid_email' | 'invalid_tahiti_number' | 'consent_required';

/**
 * The server repeats these checks; this copy exists so the form can point at the
 * offending field before a round trip.
 */
export function validateClientProfile(input: {
  entity_category: EntityCategory;
  display_name?: string;
  legal_name?: string | null;
  legal_form?: string | null;
  tax_id?: string | null;
  vat_regime?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  has_delegation_authority?: boolean;
  contact_role?: string | null;
  po_box_number?: string | null;
  po_box_municipality?: string | null;
  postal_code?: string | null;
  payment_method?: string | null;
  payment_terms_code?: string | null;
  data_consent_accepted?: boolean;
  price_tier?: 'public' | 'pro' | 'member';
}): Record<string, ClientProfileErrorCode> {
  const errors: Record<string, ClientProfileErrorCode> = {};
  const legalEntity = isLegalEntity(input.entity_category);
  const present = (value: string | null | undefined) => Boolean(value && value.trim());
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // README: one letter + five digits (T12345); the DICP also issues 7-digit ids.
  const tahitiPattern = /^([A-Z]\d{5}|\d{7})$/;

  if (!present(input.display_name)) errors.display_name = 'required';

  if (legalEntity) {
    if (!present(input.legal_name)) errors.legal_name = 'required';
    if (!present(input.legal_form)) errors.legal_form = 'required';
    if (!present(input.vat_regime)) errors.vat_regime = 'required';
    if (!present(input.tax_id)) errors.tax_id = 'required';
    if (!present(input.po_box_number)) errors.po_box_number = 'required';
  }
  if (present(input.tax_id) && !tahitiPattern.test(String(input.tax_id).toUpperCase())) {
    errors.tax_id = 'invalid_tahiti_number';
  }

  if (!present(input.last_name)) errors.last_name = 'required';
  if (legalEntity || present(input.email)) {
    if (!present(input.email)) errors.email = 'required';
    else if (!emailPattern.test(String(input.email))) errors.email = 'invalid_email';
  }
  if (legalEntity && !present(input.phone)) errors.phone = 'required';
  if (!present(input.po_box_municipality)) errors.po_box_municipality = 'required';
  if (!present(input.postal_code)) errors.postal_code = 'required';
  if (!present(input.payment_method)) errors.payment_method = 'required';
  if (!present(input.payment_terms_code)) errors.payment_terms_code = 'required';
  if (!input.data_consent_accepted) errors.data_consent_accepted = 'consent_required';

  return errors;
}

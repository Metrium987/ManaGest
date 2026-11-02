/**
 * Default texts and legal mentions written on documents. They are only seeds:
 * the company can rewrite every one of them in Paramètres (conditions de
 * paiement, pied de page, mentions légales), and the stored value always wins.
 *
 * They are shared so the setup screen and the setup route cannot drift apart —
 * a screen that promises a late-fee penalty the application never computes is a
 * defect, not a default.
 */

export const DEFAULT_INVOICE_TERMS =
  "Paiement à réception de facture. Les factures en retard font l'objet d'un rappel manuel; tout intérêt de retard éventuel est calculé et mentionné par l'application avant émission.";

export const DEFAULT_INVOICE_FOOTER = 'Merci de votre confiance.';

export const FRANCHISE_LEGAL_NOTE = 'TVA non applicable, franchise en base.';

/** Fallback payment term (days) before the company settings have loaded. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/** Session limits, editable in Paramètres → Facturation (sessions & sécurité). */
export const DEFAULT_SESSION_IDLE_MINUTES = 30;
export const DEFAULT_SESSION_ABSOLUTE_HOURS = 12;

/** How far ahead the contract-notice list looks when no range is asked for. */
export const DEFAULT_NOTICE_LEAD_DAYS = 30;

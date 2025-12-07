import { useState, useEffect, useCallback, useMemo } from 'react';
import { Invoice, InvoiceFormData } from '@/types/invoice';

const STORAGE_KEY = 'invoices';
const DRAFT_STORAGE_KEY = 'invoice_draft';

// Creative session name generators
const adjectives = ['Cosmic', 'Swift', 'Golden', 'Stellar', 'Bright', 'Noble', 'Grand', 'Prime', 'Royal', 'Epic'];
const nouns = ['Phoenix', 'Dragon', 'Thunder', 'Aurora', 'Nexus', 'Zenith', 'Summit', 'Pulse', 'Wave', 'Spark'];

function generateCreativeSessionName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj} ${noun} ${num}`;
}

function loadInvoices(): Invoice[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse invoices from localStorage', e);
    }
  }
  return [];
}

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => loadInvoices());
  const [isLoading, setIsLoading] = useState(false);

  const saveInvoice = useCallback((formData: InvoiceFormData, id?: string): Invoice => {
    const invoiceName = formData.invoiceName || generateCreativeSessionName();

    const newInvoice: Invoice = {
      ...formData,
      invoiceName,
      id: id || crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    setInvoices((prev) => {
      // Check if we're updating an existing invoice
      const existingIndex = prev.findIndex(inv => inv.id === newInvoice.id);
      let updated: Invoice[];
      if (existingIndex >= 0) {
        updated = [...prev];
        updated[existingIndex] = newInvoice;
      } else {
        updated = [newInvoice, ...prev];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });

    return newInvoice;
  }, []);

  const deleteInvoice = useCallback((id: string) => {
    setInvoices((prev) => {
      const updated = prev.filter((inv) => inv.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getInvoice = useCallback((id: string): Invoice | undefined => {
    return invoices.find((inv) => inv.id === id);
  }, [invoices]);

  const getNextInvoiceNumber = useMemo((): string => {
    const maxNum = invoices.reduce((max, inv) => {
      const num = parseInt(inv.invoiceNumber.replace(/\D/g, ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `INV-${String(maxNum + 1).padStart(4, '0')}`;
  }, [invoices]);

  // Draft management - per-invoice ID
  const saveDraft = useCallback((id: string, formData: InvoiceFormData) => {
    localStorage.setItem(`invoice_draft_${id}`, JSON.stringify(formData));
  }, []);

  const loadDraft = useCallback((id: string): InvoiceFormData | null => {
    const stored = localStorage.getItem(`invoice_draft_${id}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse draft from localStorage', e);
      }
    }
    return null;
  }, []);

  const clearDraft = useCallback((id: string) => {
    localStorage.removeItem(`invoice_draft_${id}`);
  }, []);

  const refreshInvoices = useCallback(() => {
    setInvoices(loadInvoices());
  }, []);

  return {
    invoices,
    isLoading,
    saveInvoice,
    deleteInvoice,
    getInvoice,
    getNextInvoiceNumber,
    saveDraft,
    loadDraft,
    clearDraft,
    refreshInvoices,
  };
}
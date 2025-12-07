import { useState, useEffect, useCallback, useMemo } from 'react';
import { Invoice, InvoiceFormData } from '@/types/invoice';

const STORAGE_KEY = 'invoices';

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

  const saveInvoice = useCallback((formData: InvoiceFormData): Invoice => {
    const newInvoice: Invoice = {
      ...formData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    setInvoices((prev) => {
      const updated = [newInvoice, ...prev];
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

  return {
    invoices,
    isLoading,
    saveInvoice,
    deleteInvoice,
    getInvoice,
    getNextInvoiceNumber,
  };
}

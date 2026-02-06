
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useInvoiceStore } from "@/stores/useInvoiceStore";
import { useMutation, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { toast } from "sonner";

export function MigrationModal() {
  const { isAuthenticated } = useConvexAuth();
  const { invoices, reset: clearLocalInvoices } = useInvoiceStore();
  const batchCreate = useMutation(api.invoices.batchCreate);
  const [isOpen, setIsOpen] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    // Show modal if authenticated and has local invoices
    if (isAuthenticated && invoices.length > 0) {
      setIsOpen(true);
    }
  }, [isAuthenticated, invoices.length]);

  const handleMigration = async () => {
    setIsMigrating(true);
    try {
      // Massage data to match schema
      const invoicesToSync = invoices.map(inv => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, createdAt, toName, toEmail, toAddress, ...rest } = inv;
        return {
          ...rest,
          invoiceNumber: inv.invoiceNumber || `INV-MIG-${Date.now()}`,
          issueDate: inv.issueDate || new Date().toISOString(),
          status: inv.status || 'draft',
          fromName: inv.fromName || '',
          fromEmail: inv.fromEmail || '',
          fromAddress: inv.fromAddress || '',
          currency: inv.currency || 'USD',
          taxRate: inv.taxRate || 0,
          notes: inv.notes || '',
          paymentDetails: inv.paymentDetails || '',
          lineItems: inv.lineItems || [],
          clientSnapshot: {
            name: toName || '',
            email: toEmail || '',
            address: toAddress || '',
          }
        };
      });

      await batchCreate({ invoices: invoicesToSync });
      
      clearLocalInvoices();
      setIsOpen(false);
      toast.success("Invoices successfully synced to cloud!");
    } catch (error) {
      console.error("Migration failed:", error);
      toast.error("Failed to sync invoices. Please try again.");
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSkip = () => {
     // User chose to skip - we clear local invoices to prevent double-entry / confusion?
     // OR we leave them alone?
     // Per plan: "Skip & Delete Local" -> Clear local store
     clearLocalInvoices();
     setIsOpen(false);
     toast.info("Local invoices cleared.");
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sync Invoices to Cloud</AlertDialogTitle>
          <AlertDialogDescription>
            We found {invoices.length} invoice{invoices.length !== 1 && 's'} on this device. 
            Would you like to sync them to your account?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleSkip} disabled={isMigrating}>
            Skip & Clear Local
          </AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); handleMigration(); }} disabled={isMigrating}>
            {isMigrating ? "Syncing..." : "Sync Invoices"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

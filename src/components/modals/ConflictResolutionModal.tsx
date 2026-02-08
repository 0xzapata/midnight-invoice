import { useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Invoice } from '@/types/invoice';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  localInvoice: Invoice;
  cloudInvoice?: Invoice;
  onResolve: (keep: 'local' | 'cloud' | 'merge') => void;
}

export function ConflictResolutionModal({ isOpen, onClose, localInvoice, cloudInvoice, onResolve }: ConflictResolutionModalProps) {
  const [selectedOption, setSelectedOption] = useState<'local' | 'cloud' | 'merge' | null>(null);
  
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg shadow-lg max-w-lg w-full mx-4 p-6">
        <div className="mb-4">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
        </div>
        
        <h2 className="text-2xl font-semibold mb-4">Resolve Conflict</h2>
        
        <p className="text-muted-foreground mb-6">
          We found conflicting versions of invoice <strong className="text-foreground">{localInvoice.invoiceNumber || localInvoice.invoiceName || 'Unknown'}</strong>.
        </p>
        
        <div className="space-y-6">
          <div className="border rounded-lg p-4 bg-muted/20">
            <h3 className="font-medium mb-2">Your Local Version</h3>
            <p className="text-sm text-muted-foreground mb-2">Created: {formatDate(localInvoice.createdAt || '')}</p>
            <p className="text-sm text-muted-foreground">Status: Draft</p>
            {localInvoice.toName && (
              <p className="text-sm">
                <span className="text-muted-foreground">Client:</span> {localInvoice.toName}
              </p>
            )}
            {localInvoice.lineItems && localInvoice.lineItems.length > 0 && (
              <div className="text-sm mt-2">
                <p className="text-muted-foreground font-medium mb-2">Line Items:</p>
                {localInvoice.lineItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
                    <span className="text-foreground">{item.description}</span>
                    <span className="text-muted-foreground">{localInvoice.currency || '$'}{item.price} x {item.quantity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cloudInvoice && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <h3 className="font-medium mb-2">Cloud Version</h3>
              <p className="text-sm text-muted-foreground mb-2">Created: {formatDate(cloudInvoice.createdAt || '')}</p>
              <p className="text-sm text-muted-foreground">Status: {cloudInvoice.status || 'draft'}</p>
              {cloudInvoice.toName && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Client:</span> {cloudInvoice.toName}
                </p>
              )}
              {cloudInvoice.lineItems && cloudInvoice.lineItems.length > 0 && (
                <div className="text-sm mt-2">
                  <p className="text-muted-foreground font-medium mb-2">Line Items:</p>
                  {cloudInvoice.lineItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
                      <span className="text-foreground">{item.description}</span>
                    <span className="text-muted-foreground">{localInvoice.currency || '$'}{item.price} x {item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border border-border hover:bg-muted">
              <input
                type="radio"
                name="resolveOption"
                value="local"
                checked={selectedOption === 'local'}
                onChange={() => setSelectedOption('local')}
                className="sr-only"
              />
              <div className="flex items-center gap-3">
                {selectedOption === 'local' ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-muted" />
                )}
                <span className="font-medium">Keep Local Version</span>
                <p className="text-xs text-muted-foreground mt-1">
                  Overwrites cloud version with your local copy
                </p>
              </div>
            </label>
          </div>
          
          {cloudInvoice && (
            <div className="flex-1">
              <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border border-border hover:bg-muted">
                <input
                  type="radio"
                  name="resolveOption"
                  value="cloud"
                  checked={selectedOption === 'cloud'}
                  onChange={() => setSelectedOption('cloud')}
                  className="sr-only"
                />
                <div className="flex items-center gap-3">
                  {selectedOption === 'cloud' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted" />
                  )}
                  <span className="font-medium">Keep Cloud Version</span>
                  <p className="text-xs text-muted-foreground mt-1">
                    Overwrites local version with cloud copy
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>
        
        <div className="flex gap-3 mt-6 pt-4 border-t border-border">
          <div className="flex-1">
            {cloudInvoice && (
              <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border border-border hover:bg-muted">
                <input
                  type="radio"
                  name="resolveOption"
                  value="merge"
                  checked={selectedOption === 'merge'}
                  onChange={() => setSelectedOption('merge')}
                  className="sr-only"
                />
                <div className="flex items-center gap-3">
                  {selectedOption === 'merge' ? (
                    <CheckCircle2 className="w-5 h-5 text-blue-500" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted" />
                  )}
                  <span className="font-medium">Merge Both</span>
                  <p className="text-xs text-muted-foreground mt-1">
                    Combines local and cloud versions
                  </p>
                </div>
              </label>
            )}
          </div>
          
          <Button
            onClick={() => selectedOption && onResolve(selectedOption)}
            disabled={!selectedOption}
            variant="default"
            className="w-full"
          >
            {selectedOption === 'local' ? 'Keep Local' : selectedOption === 'cloud' ? 'Keep Cloud' : 'Merge Both'}
          </Button>
          
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet';
import { useSettingsStore, DefaultSettings } from '@/stores/useSettingsStore';
import { CurrencySelector } from '@/components/ui/CurrencySelector';
import { Field, FieldLabel } from '@/components/ui/field';
import { toast } from 'sonner';

interface SettingsDrawerProps {
  trigger?: React.ReactNode;
}

export function SettingsDrawer({ trigger }: SettingsDrawerProps) {
  const { settings, updateSettings } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<DefaultSettings>(settings);

  // Sync local state when drawer opens
  useEffect(() => {
    if (open) {
      setLocalSettings(settings);
    }
  }, [open, settings]);

  const handleSave = () => {
    updateSettings(localSettings);
    setOpen(false);
    toast.success('Settings saved successfully');
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      <Settings className="w-4 h-4 mr-2" />
      Open settings
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configure default values for new invoices.
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label htmlFor="drawerFromName" className="text-xs text-muted-foreground">
              Default Name / Company
            </Label>
            <Input
              id="drawerFromName"
              placeholder="Your name or company"
              value={localSettings.fromName}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, fromName: e.target.value }))}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="drawerFromEmail" className="text-xs text-muted-foreground">
              Default Email
            </Label>
            <Input
              id="drawerFromEmail"
              type="email"
              placeholder="your@email.com"
              value={localSettings.fromEmail}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, fromEmail: e.target.value }))}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="drawerFromAddress" className="text-xs text-muted-foreground">
              Default Address
            </Label>
            <Textarea
              id="drawerFromAddress"
              placeholder="Street, City, Country"
              rows={2}
              value={localSettings.fromAddress}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, fromAddress: e.target.value }))}
              className="bg-secondary border-border resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="drawerPaymentDetails" className="text-xs text-muted-foreground">
              Default Payment Details
            </Label>
            <Textarea
              id="drawerPaymentDetails"
              placeholder="Bank name, account number, etc."
              rows={3}
              value={localSettings.paymentDetails}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, paymentDetails: e.target.value }))}
              className="bg-secondary border-border resize-none text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="drawerTaxRate" className="text-xs text-muted-foreground">
                Default Tax Rate (%)
              </Label>
              <Input
                id="drawerTaxRate"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={localSettings.taxRate || ''}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, taxRate: parseFloat(e.target.value) || 0 }))}
                className="bg-secondary border-border"
              />
            </div>
            
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                Default Currency
              </FieldLabel>
              <CurrencySelector
                value={localSettings.currency}
                onChange={(value) => setLocalSettings(prev => ({ ...prev, currency: value }))}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <Label htmlFor="drawerNotes" className="text-xs text-muted-foreground">
              Default Notes
            </Label>
            <Textarea
              id="drawerNotes"
              placeholder="Thank you for your business!"
              rows={3}
              value={localSettings.notes}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, notes: e.target.value }))}
              className="bg-secondary border-border resize-none text-sm"
            />
          </div>
        </div>

        <SheetFooter className="mt-8">
          <Button onClick={handleSave} className="w-full sm:w-auto">
            <Save className="w-4 h-4 mr-2" />
            Save Settings
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

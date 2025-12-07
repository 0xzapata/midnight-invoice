import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { InvoiceFormData, LineItem } from '@/types/invoice';

interface InvoiceFormProps {
  initialData?: Partial<InvoiceFormData>;
  onFormChange: (data: InvoiceFormData) => void;
  invoiceNumber: string;
}

export function InvoiceForm({ initialData, onFormChange, invoiceNumber }: InvoiceFormProps) {
  const { register, control, watch, setValue } = useForm<InvoiceFormData>({
    defaultValues: {
      invoiceNumber,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      fromName: '',
      fromAddress: '',
      fromEmail: '',
      toName: '',
      toAddress: '',
      toEmail: '',
      lineItems: [{ id: crypto.randomUUID(), description: '', quantity: 1, price: 0 }],
      taxRate: 0,
      notes: '',
      paymentDetails: '',
      currency: 'USD',
      ...initialData,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'lineItems',
  });

  const watchedData = watch();

  useEffect(() => {
    onFormChange(watchedData);
  }, [watchedData, onFormChange]);

  useEffect(() => {
    setValue('invoiceNumber', invoiceNumber);
  }, [invoiceNumber, setValue]);

  const addLineItem = () => {
    append({ id: crypto.randomUUID(), description: '', quantity: 1, price: 0 });
  };

  return (
    <div className="space-y-6">
      {/* Invoice Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Invoice Details</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="invoiceNumber" className="text-xs text-muted-foreground">
              Invoice Number
            </Label>
            <Input
              id="invoiceNumber"
              {...register('invoiceNumber')}
              className="font-mono bg-secondary border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issueDate" className="text-xs text-muted-foreground">
              Issue Date
            </Label>
            <Input
              id="issueDate"
              type="date"
              {...register('issueDate')}
              className="font-mono bg-secondary border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dueDate" className="text-xs text-muted-foreground">
              Due Date
            </Label>
            <Input
              id="dueDate"
              type="date"
              {...register('dueDate')}
              className="font-mono bg-secondary border-border"
            />
          </div>
        </div>
      </div>

      {/* From */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">From</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fromName" className="text-xs text-muted-foreground">
              Name / Company
            </Label>
            <Input
              id="fromName"
              placeholder="Your name or company"
              {...register('fromName')}
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fromEmail" className="text-xs text-muted-foreground">
              Email
            </Label>
            <Input
              id="fromEmail"
              type="email"
              placeholder="your@email.com"
              {...register('fromEmail')}
              className="bg-secondary border-border"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="fromAddress" className="text-xs text-muted-foreground">
              Address
            </Label>
            <Textarea
              id="fromAddress"
              placeholder="Street, City, Country"
              rows={2}
              {...register('fromAddress')}
              className="bg-secondary border-border resize-none"
            />
          </div>
        </div>
      </div>

      {/* To */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Bill To</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="toName" className="text-xs text-muted-foreground">
              Client Name / Company
            </Label>
            <Input
              id="toName"
              placeholder="Client name"
              {...register('toName')}
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="toEmail" className="text-xs text-muted-foreground">
              Client Email
            </Label>
            <Input
              id="toEmail"
              type="email"
              placeholder="client@email.com"
              {...register('toEmail')}
              className="bg-secondary border-border"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="toAddress" className="text-xs text-muted-foreground">
              Client Address
            </Label>
            <Textarea
              id="toAddress"
              placeholder="Street, City, Country"
              rows={2}
              {...register('toAddress')}
              className="bg-secondary border-border resize-none"
            />
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Line Items</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLineItem}
            className="h-8 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Item
          </Button>
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-6 space-y-1">
                {index === 0 && (
                  <Label className="text-[10px] text-muted-foreground">Description</Label>
                )}
                <Input
                  placeholder="Item description"
                  {...register(`lineItems.${index}.description`)}
                  className="bg-secondary border-border text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1">
                {index === 0 && (
                  <Label className="text-[10px] text-muted-foreground">Qty</Label>
                )}
                <Input
                  type="number"
                  min="1"
                  {...register(`lineItems.${index}.quantity`, { valueAsNumber: true })}
                  className="bg-secondary border-border text-sm font-mono text-right"
                />
              </div>
              <div className="col-span-3 space-y-1">
                {index === 0 && (
                  <Label className="text-[10px] text-muted-foreground">Price</Label>
                )}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  {...register(`lineItems.${index}.price`, { valueAsNumber: true })}
                  className="bg-secondary border-border text-sm font-mono text-right"
                />
              </div>
              <div className="col-span-1 flex items-end justify-end">
                {index === 0 && <div className="h-[22px]" />}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => fields.length > 1 && remove(index)}
                  disabled={fields.length === 1}
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tax & Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="currency" className="text-xs text-muted-foreground">
            Currency
          </Label>
          <select
            id="currency"
            {...register('currency')}
            className="flex h-10 w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CAD">CAD ($)</option>
            <option value="AUD">AUD ($)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="taxRate" className="text-xs text-muted-foreground">
            Tax Rate (%)
          </Label>
          <Input
            id="taxRate"
            type="number"
            min="0"
            max="100"
            step="0.1"
            {...register('taxRate', { valueAsNumber: true })}
            className="bg-secondary border-border font-mono"
          />
        </div>
      </div>

      {/* Payment & Notes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="paymentDetails" className="text-xs text-muted-foreground">
            Payment Details
          </Label>
          <Textarea
            id="paymentDetails"
            placeholder="Bank name, account number, etc."
            rows={3}
            {...register('paymentDetails')}
            className="bg-secondary border-border resize-none text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes" className="text-xs text-muted-foreground">
            Notes
          </Label>
          <Textarea
            id="notes"
            placeholder="Thank you for your business!"
            rows={3}
            {...register('notes')}
            className="bg-secondary border-border resize-none text-sm"
          />
        </div>
      </div>
    </div>
  );
}

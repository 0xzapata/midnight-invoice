import { useEffect, useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import { Plus, Trash2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Field, 
  FieldLabel, 
  FieldError, 
  FieldGroup 
} from '@/components/ui/field';
import { CurrencySelector } from '@/components/ui/CurrencySelector';
import { InvoiceFormData } from '@/types/invoice';
import { invoiceFormSchema } from '@/lib/validation';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { toast } from 'sonner';

interface InvoiceFormProps {
  initialData?: Partial<InvoiceFormData>;
  onFormChange: (data: InvoiceFormData) => void;
  invoiceNumber: string;
}

export function InvoiceForm({ initialData, onFormChange, invoiceNumber }: InvoiceFormProps) {
  const prevDataRef = useRef<string>('');
  
  const form = useForm<InvoiceFormData>({
    defaultValues: {
      invoiceNumber,
      invoiceName: '',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: '',
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
    validators: {
      onBlur: invoiceFormSchema,
    },
    onSubmit: async () => {
      // Form is controlled, no submit handler needed
    },
  });

  // Watch for form changes and notify parent
  const formState = form.useStore((state) => state.values);
  
  useEffect(() => {
    const serialized = JSON.stringify(formState);
    if (serialized !== prevDataRef.current) {
      prevDataRef.current = serialized;
      onFormChange(formState);
    }
  }, [formState, onFormChange]);

  // Reset form when initialData changes
  useEffect(() => {
    if (initialData) {
      form.reset();
      form.setFieldValue('invoiceNumber', invoiceNumber);
      Object.entries(initialData).forEach(([key, value]) => {
        if (value !== undefined) {
          form.setFieldValue(key as keyof InvoiceFormData, value);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  const settings = useSettingsStore((state) => state.settings);
  const hasDefaults = settings.fromName || settings.fromEmail || settings.fromAddress || settings.paymentDetails || settings.notes || settings.taxRate || settings.currency;

  const applyDefaults = () => {
    if (!hasDefaults) {
      toast.info('No defaults saved. Go to Settings to configure your defaults.');
      return;
    }
    if (settings.fromName) form.setFieldValue('fromName', settings.fromName);
    if (settings.fromEmail) form.setFieldValue('fromEmail', settings.fromEmail);
    if (settings.fromAddress) form.setFieldValue('fromAddress', settings.fromAddress);
    if (settings.paymentDetails) form.setFieldValue('paymentDetails', settings.paymentDetails);
    if (settings.notes) form.setFieldValue('notes', settings.notes);
    if (settings.taxRate) form.setFieldValue('taxRate', settings.taxRate);
    if (settings.currency) form.setFieldValue('currency', settings.currency);
    toast.success('Defaults applied');
  };

  const addLineItem = () => {
    const currentItems = form.getFieldValue('lineItems');
    form.setFieldValue('lineItems', [
      ...currentItems,
      { id: crypto.randomUUID(), description: '', quantity: 1, price: 0 }
    ]);
  };

  const removeLineItem = (index: number) => {
    const currentItems = form.getFieldValue('lineItems');
    if (currentItems.length > 1) {
      form.setFieldValue('lineItems', currentItems.filter((_, i) => i !== index));
    }
  };

  return (
    <div className="space-y-6">
      {/* Invoice Name */}
      <form.Field name="invoiceName">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
              Invoice Name (optional - auto-generated if empty)
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value || ''}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="e.g. Project Alpha Invoice"
              className="bg-secondary border-border"
            />
          </Field>
        )}
      </form.Field>

      {/* Invoice Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Invoice Details</h3>
        <div className="grid grid-cols-3 gap-4">
          <form.Field name="invoiceNumber">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Invoice Number
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <form.Field name="issueDate">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Issue Date
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="date"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <form.Field name="dueDate">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                  Due Date (optional)
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="date"
                  value={field.state.value || ''}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="bg-secondary border-border"
                />
              </Field>
            )}
          </form.Field>
        </div>
      </div>

      {/* From */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">From</h3>
          {hasDefaults && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyDefaults}
              className="h-8 text-xs"
            >
              <Settings2 className="w-3 h-3 mr-1" />
              Use Defaults
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="fromName">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Name / Company
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Your name or company"
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <form.Field name="fromEmail">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Email
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="your@email.com"
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <div className="col-span-2">
            <form.Field name="fromAddress">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Address
                  </FieldLabel>
                  <Textarea
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Street, City, Country"
                    rows={2}
                    className="bg-secondary border-border resize-none"
                  />
                </Field>
              )}
            </form.Field>
          </div>
        </div>
      </div>

      {/* To */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Bill To</h3>
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="toName">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Client Name / Company
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Client name"
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <form.Field name="toEmail">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Client Email
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="client@email.com"
                    className="bg-secondary border-border"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
                </Field>
              );
            }}
          </form.Field>
          
          <div className="col-span-2">
            <form.Field name="toAddress">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                    Client Address
                  </FieldLabel>
                  <Textarea
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Street, City, Country"
                    rows={2}
                    className="bg-secondary border-border resize-none"
                  />
                </Field>
              )}
            </form.Field>
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
          <form.Field name="lineItems" mode="array">
            {(field) => (
              <>
                {field.state.value.map((item, index) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6 space-y-1">
                      {index === 0 && (
                        <span className="text-[10px] text-muted-foreground">Description</span>
                      )}
                      <form.Field name={`lineItems[${index}].description`}>
                        {(subField) => (
                          <Input
                            placeholder="Item description"
                            value={subField.state.value as string}
                            onBlur={subField.handleBlur}
                            onChange={(e) => subField.handleChange(e.target.value)}
                            className="bg-secondary border-border text-sm"
                          />
                        )}
                      </form.Field>
                    </div>
                    <div className="col-span-2 space-y-1">
                      {index === 0 && (
                        <span className="text-[10px] text-muted-foreground">Qty</span>
                      )}
                      <form.Field name={`lineItems[${index}].quantity`}>
                        {(subField) => (
                          <Input
                            type="number"
                            min="1"
                            value={subField.state.value as number}
                            onBlur={subField.handleBlur}
                            onChange={(e) => subField.handleChange(Number(e.target.value))}
                            className="bg-secondary border-border text-sm text-right"
                          />
                        )}
                      </form.Field>
                    </div>
                    <div className="col-span-3 space-y-1">
                      {index === 0 && (
                        <span className="text-[10px] text-muted-foreground">Price</span>
                      )}
                      <form.Field name={`lineItems[${index}].price`}>
                        {(subField) => (
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={subField.state.value as number}
                            onBlur={subField.handleBlur}
                            onChange={(e) => subField.handleChange(Number(e.target.value))}
                            className="bg-secondary border-border text-sm text-right"
                          />
                        )}
                      </form.Field>
                    </div>
                    <div className="col-span-1 flex items-center justify-end">
                      {index === 0 && <div className="h-[22px]" />}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLineItem(index)}
                        disabled={field.state.value.length === 1}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </form.Field>
        </div>
      </div>

      {/* Tax & Currency */}
      <div className="grid grid-cols-2 gap-4">
        <form.Field name="currency">
          {(field) => (
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                Currency
              </FieldLabel>
              <CurrencySelector
                value={field.state.value}
                onChange={(value) => field.handleChange(value)}
              />
            </Field>
          )}
        </form.Field>
        
        <form.Field name="taxRate">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                  Tax Rate (%)
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  className="bg-secondary border-border"
                  aria-invalid={isInvalid}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors as Array<{ message?: string }>} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      {/* Payment & Notes */}
      <div className="grid grid-cols-2 gap-4">
        <form.Field name="paymentDetails">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                Payment Details
              </FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Bank name, account number, etc."
                rows={3}
                className="bg-secondary border-border resize-none text-sm"
              />
            </Field>
          )}
        </form.Field>
        
        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                Notes
              </FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Thank you for your business!"
                rows={3}
                className="bg-secondary border-border resize-none text-sm"
              />
            </Field>
          )}
        </form.Field>
      </div>
    </div>
  );
}
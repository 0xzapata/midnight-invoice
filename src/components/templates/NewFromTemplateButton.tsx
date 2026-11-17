import { ChevronDown, FileStack } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { TemplatePicker } from './TemplateControls';
import { useNewInvoiceFromTemplate } from './useNewInvoiceFromTemplate';

/** Dashboard entry: "New from template" (pick a template → a new invoice draft opens). Hidden until a template exists. */
export function NewFromTemplateButton() {
  const hasTemplates = useTemplateStore((s) => s.templates.some((t) => !t.archivedAt));
  const newInvoiceFrom = useNewInvoiceFromTemplate();
  if (!hasTemplates) return null;
  return (
    <TemplatePicker
      onPick={newInvoiceFrom}
      align="end"
      trigger={
        <Button type="button" variant="outline" size="sm" aria-haspopup="listbox" className="gap-1.5">
          <FileStack className="h-4 w-4" aria-hidden="true" />
          New from template
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      }
    />
  );
}

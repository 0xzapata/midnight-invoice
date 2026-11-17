import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronsUpDown, Link2, Link2Off, UserPlus, UserRoundCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { activeClientsSorted, useClientStore } from '@/stores/useClientStore';
import type { InvoiceFormData } from '@/types/invoice';
import { cn } from '@/lib/utils';
import type { Client } from '../../../shared/types/client';
import { billToState } from './clientFill';

type BillTo = Pick<InvoiceFormData, 'clientId' | 'toName' | 'toEmail' | 'toAddress'>;

/**
 * Combobox on the Bill To section: pick a saved client (fills the Bill To
 * fields and the client's defaults), or unlink the current one.
 */
export function ClientPicker({ values, onPick }: { values: BillTo; onPick: (client: Client | null) => void }) {
  const [open, setOpen] = useState(false);
  const clients = useClientStore((s) => s.clients);
  const active = activeClientsSorted(clients);
  const linked = values.clientId ? clients.find((c) => c.id === values.clientId) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={linked ? `Saved client: ${linked.name}. Change client` : 'Choose a saved client'}
          className="h-8 min-w-0 max-w-[calc(100%-6rem)] justify-between gap-1 text-xs sm:max-w-[16rem]"
        >
          <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{linked ? linked.name : 'Choose client'}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search clients…" />
          <CommandList>
            <CommandEmpty>
              {clients.length === 0 ? 'No saved clients yet.' : 'No client found.'}
            </CommandEmpty>
            {active.length > 0 && (
              <CommandGroup heading="Saved clients">
                {active.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`${client.name} ${client.email} ${client.id}`}
                    onSelect={() => {
                      onPick(client);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4 shrink-0', values.clientId === client.id ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate">{client.name}</span>
                      {client.email && <span className="block truncate font-code text-[11px] text-muted-foreground">{client.email}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {linked && (
              <CommandGroup>
                <CommandItem
                  value="__unlink__"
                  onSelect={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                >
                  <Link2Off className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  Don’t link to a saved client
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t border-border p-1">
            <Link
              to="/clients"
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Manage clients
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Below the Bill To fields: "Save as client" when the details are new,
 * "Update client" when a linked client's details were edited here, or a
 * link to an existing client with the same name and email.
 */
export function ClientLinkStatus({ values, onLink }: { values: BillTo; onLink: (client: Client) => void }) {
  const clients = useClientStore((s) => s.clients);
  const state = billToState(values, clients);

  const saveNew = () => {
    const client = useClientStore.getState().saveClient({ name: values.toName, email: values.toEmail ?? '', address: values.toAddress ?? '' });
    onLink(client);
    toast.success(`Saved “${client.name}” as a client`);
  };
  const updateLinked = (client: Client) => {
    const saved = useClientStore.getState().saveClient(
      {
        name: values.toName,
        email: values.toEmail ?? '',
        address: values.toAddress ?? '',
        defaultCurrency: client.defaultCurrency,
        defaultTaxRate: client.defaultTaxRate,
        paymentTermsDays: client.paymentTermsDays,
        notes: client.notes,
      },
      client.id,
    );
    toast.success(`Updated the client “${saved.name}”`, { description: 'Existing invoices keep the details they were issued with.' });
  };

  const row = 'flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground';
  switch (state.kind) {
    case 'empty':
      return null;
    case 'linked':
      return (
        <p className={row} role="status">
          <span className="inline-flex items-center gap-1.5">
            <UserRoundCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Billed to your saved client “{state.client.name}”
          </span>
        </p>
      );
    case 'changed':
      return (
        <div className={row}>
          <span>These details differ from the saved client “{state.client.name}”.</span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => updateLinked(state.client)}>
            <UserRoundCheck className="h-3 w-3" aria-hidden="true" />
            Update client
          </Button>
        </div>
      );
    case 'matches':
      return (
        <div className={row}>
          <span>Matches your saved client “{state.client.name}”.</span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onLink(state.client)}>
            <Link2 className="h-3 w-3" aria-hidden="true" />
            Link client
          </Button>
        </div>
      );
    case 'new':
      return (
        <div className={row}>
          <span>New client? Save these details to reuse them.</span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={saveNew}>
            <UserPlus className="h-3 w-3" aria-hidden="true" />
            Save as client
          </Button>
        </div>
      );
  }
}

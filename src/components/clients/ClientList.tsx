
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Client } from "@/types/client";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Mail, MapPin, Building2 } from "lucide-react";
import { ClientModal } from "./ClientModal";
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
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { useTeamContext } from "@/stores/useTeamContext";
import { useTeam } from "@/hooks/useTeams";

export function ClientList() {
  const { currentTeamId } = useTeamContext();
  const { team: currentTeam } = useTeam(currentTeamId ?? undefined);
  const clients = useQuery(api.clients.list, currentTeamId ? { teamId: currentTeamId as Id<"teams"> } : {});
  const removeClient = useMutation(api.clients.remove);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingClient(undefined);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await removeClient({ id: deleteId as Id<"clients"> });
      toast.success("Client deleted");
    } catch (error) {
      toast.error("Failed to delete client");
    } finally {
      setDeleteId(null);
    }
  };

  if (clients === undefined) {
    return <div className="flex justify-center p-8"><Spinner size="lg" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Clients</h2>
            {currentTeam && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                <Building2 className="w-3 h-3" />
                {currentTeam.name}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {currentTeam 
              ? `Manage clients for ${currentTeam.name}.` 
              : "Manage your personal client details for quick invoicing."}
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-2" />
          Add Client
        </Button>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-card/50 border-dashed">
          <p className="text-muted-foreground mb-4">
            {currentTeam 
              ? `No clients in ${currentTeam.name} yet.` 
              : "No personal clients found."}
          </p>
          <Button variant="outline" onClick={handleAdd}>
            {currentTeam ? `Add client to ${currentTeam.name}` : "Create your first client"}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
                <div key={client._id} className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="font-medium text-lg truncate pr-2">{client.name}</h3>
                        <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(client)}>
                                <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(client._id)}>
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2 text-sm text-muted-foreground">
                        {client.email && (
                            <div className="flex items-center gap-2">
                                <Mail className="w-3 h-3" />
                                <span className="truncate">{client.email}</span>
                            </div>
                        )}
                        {client.address && (
                            <div className="flex items-start gap-2">
                                <MapPin className="w-3 h-3 mt-0.5" />
                                <span className="line-clamp-2">{client.address}</span>
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
      )}

      <ClientModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        client={editingClient}
        teamId={currentTeamId}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

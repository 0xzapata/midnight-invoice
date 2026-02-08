
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Client } from "@/types/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: Client;
  teamId?: string;
}

export function ClientModal({ isOpen, onClose, client, teamId }: ClientModalProps) {
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset, setValue } = useForm<Client>({
    defaultValues: {
      name: "",
      email: "",
      address: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (client) {
      setValue("name", client.name);
      setValue("email", client.email || "");
      setValue("address", client.address || "");
      setValue("notes", client.notes || "");
    } else {
      reset({
        name: "",
        email: "",
        address: "",
        notes: "",
      });
    }
  }, [client, setValue, reset, isOpen]);

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      if (client) {
        await updateClient({
            id: client._id,
            name: data.name,
            email: data.email || undefined,
            address: data.address || undefined,
            notes: data.notes || undefined,
        });
        toast.success("Client updated successfully");
      } else {
        await createClient({
            name: data.name,
            email: data.email || undefined,
            address: data.address || undefined,
            notes: data.notes || undefined,
            teamId: teamId ? teamId as Id<"teams"> : undefined,
        });
        toast.success(teamId ? "Client added to team" : "Client created successfully");
      }
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save client");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? "Edit Client" : "Add New Client"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Client Name *</Label>
            <Input id="name" {...register("name", { required: true })} placeholder="Acme Corp" />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" {...register("email")} type="email" placeholder="contact@acme.com" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" {...register("address")} placeholder="123 Business St..." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...register("notes")} placeholder="Internal notes..." />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

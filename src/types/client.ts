
import { Id } from "../../convex/_generated/dataModel";

export interface Client {
    _id: Id<"clients">;
    _creationTime: number;
    userId: string;
    name: string;
    email?: string;
    address?: string;
    notes?: string;
}

export type ClientFormData = Omit<Client, "_id" | "_creationTime" | "userId">;

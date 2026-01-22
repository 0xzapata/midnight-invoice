import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    plan: v.string(),
  }).index("by_token", ["tokenIdentifier"]),

  invoices: defineTable({
    userId: v.string(),
    invoiceNumber: v.string(),
    invoiceName: v.optional(v.string()),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    status: v.string(),
    
    fromName: v.string(),
    fromEmail: v.string(),
    fromAddress: v.string(),
    currency: v.string(),
    taxRate: v.number(),
    
    notes: v.string(),
    paymentDetails: v.string(),

    lineItems: v.array(v.object({
      id: v.string(),
      description: v.string(),
      quantity: v.number(),
      price: v.number(),
    })),
    
    clientSnapshot: v.object({
      name: v.string(),
      email: v.string(),
      address: v.string(),
    }),
    
    clientId: v.optional(v.id("clients")),
  })
  .index("by_user", ["userId"])
  .index("by_invoice_number", ["userId", "invoiceNumber"]),

  clients: defineTable({
    userId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});

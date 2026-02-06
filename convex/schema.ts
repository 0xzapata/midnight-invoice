import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    plan: v.string(),
    defaultTeamId: v.optional(v.id("teams")),
  }).index("by_token", ["tokenIdentifier"]),

  teams: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index("by_slug", ["slug"])
  .index("by_owner", ["ownerId"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    joinedAt: v.number(),
    invitedBy: v.optional(v.string()),
  })
  .index("by_team", ["teamId"])
  .index("by_user", ["userId"])
  .index("by_team_user", ["teamId", "userId"]),

  teamInvitations: defineTable({
    teamId: v.id("teams"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    invitedBy: v.string(),
    invitedAt: v.number(),
    expiresAt: v.number(),
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired")
    ),
  })
  .index("by_team", ["teamId"])
  .index("by_email", ["email"])
  .index("by_token", ["token"]),

  invoices: defineTable({
    userId: v.string(),
    teamId: v.optional(v.id("teams")),
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
  .index("by_team", ["teamId"])
  .index("by_invoice_number", ["userId", "invoiceNumber"]),

  clients: defineTable({
    userId: v.string(),
    teamId: v.optional(v.id("teams")),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
  .index("by_user", ["userId"])
  .index("by_team", ["teamId"]),
});

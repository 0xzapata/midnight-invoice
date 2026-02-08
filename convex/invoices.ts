import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function getUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated");
  }
  return identity;
}

async function verifyTeamMembership(ctx: any, teamId: string, userId: string) {
  const membership = await ctx.db
    .query("teamMembers")
    .withIndex("by_team_user", (q: any) =>
      q.eq("teamId", teamId).eq("userId", userId)
    )
    .first();
  return membership;
}

export const list = query({
  args: {
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);

    if (args.teamId) {
      // Verify user is a member of the team
      const membership = await verifyTeamMembership(ctx, args.teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to view this team's invoices");
      }

      return await ctx.db
        .query("invoices")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect();
    } else {
      return await ctx.db
        .query("invoices")
        .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
        .filter((q) => q.eq(q.field("teamId"), undefined))
        .collect();
    }
  },
});

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("cancelled")
);

export const create = mutation({
  args: {
    teamId: v.optional(v.id("teams")),
    invoiceNumber: v.string(),
    invoiceName: v.optional(v.string()),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    status: statusValidator,
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
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);
    const { teamId, ...invoiceData } = args;

    // If teamId is provided, verify user is a member and not a viewer
    if (teamId) {
      const membership = await verifyTeamMembership(ctx, teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to create invoices for this team");
      }
      if (membership.role === "viewer") {
        throw new Error("Viewers cannot create invoices");
      }
    }

    const invoiceId = await ctx.db.insert("invoices", {
      ...invoiceData,
      userId: identity.tokenIdentifier,
      teamId,
    });
    return invoiceId;
  },
});

export const update = mutation({
  args: {
    id: v.id("invoices"),
    invoiceNumber: v.optional(v.string()),
    invoiceName: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    status: v.optional(statusValidator),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    fromAddress: v.optional(v.string()),
    currency: v.optional(v.string()),
    taxRate: v.optional(v.number()),
    notes: v.optional(v.string()),
    paymentDetails: v.optional(v.string()),
    lineItems: v.optional(v.array(v.object({
      id: v.string(),
      description: v.string(),
      quantity: v.number(),
      price: v.number(),
    }))),
    clientSnapshot: v.optional(v.object({
      name: v.string(),
      email: v.string(),
      address: v.string(),
    })),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);
    const { id, ...updates } = args;

    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Invoice not found");
    }

    // Check authorization based on whether it's a team invoice or personal
    if (existing.teamId) {
      const membership = await verifyTeamMembership(ctx, existing.teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to update this invoice");
      }
      // Viewers cannot update invoices
      if (membership.role === "viewer") {
        throw new Error("Viewers cannot update invoices");
      }
    } else {
      // Personal invoice - must be owner
      if (existing.userId !== identity.tokenIdentifier) {
        throw new Error("Unauthorized");
      }
    }

    await ctx.db.patch(id, updates);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);
    const existing = await ctx.db.get(args.id);

    if (!existing) {
      throw new Error("Invoice not found");
    }

    // Check authorization based on whether it's a team invoice or personal
    if (existing.teamId) {
      const membership = await verifyTeamMembership(ctx, existing.teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to delete this invoice");
      }
      // Only admins and owners can delete team invoices
      if (!["owner", "admin"].includes(membership.role)) {
        throw new Error("Only admins and owners can delete team invoices");
      }
    } else {
      // Personal invoice - must be owner
      if (existing.userId !== identity.tokenIdentifier) {
        throw new Error("Unauthorized");
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const batchCreate = mutation({
  args: {
    invoices: v.array(v.object({
      teamId: v.optional(v.id("teams")),
      invoiceNumber: v.string(),
      invoiceName: v.optional(v.string()),
      issueDate: v.string(),
      dueDate: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("paid"),
      v.literal("overdue"),
      v.literal("cancelled")
    ),
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
    }))
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);

    // Get unique team IDs from invoices
    const teamIds = new Set<string>();
    args.invoices.forEach(inv => {
      if (inv.teamId) teamIds.add(inv.teamId);
    });

    // Verify membership for all teams
    for (const teamId of teamIds) {
      const membership = await verifyTeamMembership(ctx, teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to create invoices for this team");
      }
      if (membership.role === "viewer") {
        throw new Error("Viewers cannot create invoices");
      }
    }

    const promises = args.invoices.map(invoice => {
      const { teamId, ...invoiceData } = invoice;
      return ctx.db.insert("invoices", {
        ...invoiceData,
        userId: identity.tokenIdentifier,
        teamId,
      });
    });

    await Promise.all(promises);
    return promises.length;
  },
});

export const getNextInvoiceNumber = mutation({
  args: {
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);

    let invoices;
    if (args.teamId) {
      // Verify user is a member of the team
      const membership = await verifyTeamMembership(ctx, args.teamId, identity.tokenIdentifier);
      if (!membership) {
        throw new Error("Not authorized to access this team's invoices");
      }

      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect();
    } else {
      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
        .filter((q) => q.eq(q.field("teamId"), undefined))
        .collect();
    }

    const maxNum = invoices.reduce((max, inv) => {
      const num = parseInt(inv.invoiceNumber.replace(/\D/g, ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);

    return `INV-${String(maxNum + 1).padStart(4, '0')}`;
  },
});

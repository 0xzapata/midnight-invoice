import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function getUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated");
  }
  return identity;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await getUser(ctx);
    return await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
      .collect();
  },
});

export const create = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);
    const invoiceId = await ctx.db.insert("invoices", {
      ...args,
      userId: identity.tokenIdentifier,
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
    status: v.optional(v.string()),
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

    if (existing.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
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

    if (existing.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }

    await ctx.db.delete(args.id);
  },
});

export const batchCreate = mutation({
  args: {
    invoices: v.array(v.object({
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
    }))
  },
  handler: async (ctx, args) => {
    const identity = await getUser(ctx);

    // Process all insertions in parallel
    const promises = args.invoices.map(invoice =>
      ctx.db.insert("invoices", {
        ...invoice,
        userId: identity.tokenIdentifier,
      })
    );

    await Promise.all(promises);
    return promises.length;
  },
});

export const getNextInvoiceNumber = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await getUser(ctx);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
      .collect();

    const maxNum = invoices.reduce((max, inv) => {
      const num = parseInt(inv.invoiceNumber.replace(/\D/g, ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);

    return `INV-${String(maxNum + 1).padStart(4, '0')}`;
  },
});

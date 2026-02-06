
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

async function getUser(ctx: any) {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        throw new Error("Unauthenticated");
    }
    const user = await ctx.db.get(userId);
    if (!user) {
        throw new Error("User not found");
    }
    return user;
}

export const list = query({
    args: {},
    handler: async (ctx) => {
        const identity = await getUser(ctx);
        return await ctx.db
            .query("clients")
            .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
            .collect();
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await getUser(ctx);
        return await ctx.db.insert("clients", {
            ...args,
            userId: identity.tokenIdentifier,
        });
    },
});

export const update = mutation({
    args: {
        id: v.id("clients"),
        name: v.string(),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...fields } = args;
        const identity = await getUser(ctx);
        const client = await ctx.db.get(id);

        if (!client || client.userId !== identity.tokenIdentifier) {
            throw new Error("Not authorized");
        }

        await ctx.db.patch(id, fields);
    },
});

export const remove = mutation({
    args: { id: v.id("clients") },
    handler: async (ctx, args) => {
        const identity = await getUser(ctx);
        const client = await ctx.db.get(args.id);

        if (!client || client.userId !== identity.tokenIdentifier) {
            throw new Error("Not authorized");
        }

        await ctx.db.delete(args.id);
    },
});

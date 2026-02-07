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
    args: {
        teamId: v.optional(v.id("teams")),
    },
    handler: async (ctx, args) => {
        const identity = await getUser(ctx);
        
        if (args.teamId) {
            const teamId = args.teamId;
            const membership = await ctx.db
                .query("teamMembers")
                .withIndex("by_team_user", (q) =>
                    q.eq("teamId", teamId).eq("userId", identity.tokenIdentifier)
                )
                .first();
            
            if (!membership) {
                throw new Error("Not authorized to view this team's clients");
            }
            
            return await ctx.db
                .query("clients")
                .withIndex("by_team", (q) => q.eq("teamId", teamId))
                .collect();
        }
        
        return await ctx.db
            .query("clients")
            .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
            .filter((q) => q.eq(q.field("teamId"), undefined))
            .collect();
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        notes: v.optional(v.string()),
        teamId: v.optional(v.id("teams")),
    },
    handler: async (ctx, args) => {
        const identity = await getUser(ctx);
        
        // If teamId is provided, verify membership and permissions
        if (args.teamId) {
            const teamId = args.teamId;
            const membership = await ctx.db
                .query("teamMembers")
                .withIndex("by_team_user", (q) =>
                    q.eq("teamId", teamId).eq("userId", identity.tokenIdentifier)
                )
                .first();
            
            if (!membership) {
                throw new Error("Not authorized to add clients to this team");
            }
            
            // Viewers cannot create clients
            if (membership.role === "viewer") {
                throw new Error("Viewers cannot create clients");
            }
        }
        
        return await ctx.db.insert("clients", {
            name: args.name,
            email: args.email,
            address: args.address,
            notes: args.notes,
            userId: identity.tokenIdentifier,
            teamId: args.teamId,
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

        if (!client) {
            throw new Error("Client not found");
        }

        // Check authorization
        const clientTeamId = client.teamId;
        if (clientTeamId) {
            const membership = await ctx.db
                .query("teamMembers")
                .withIndex("by_team_user", (q) =>
                    q.eq("teamId", clientTeamId).eq("userId", identity.tokenIdentifier)
                )
                .first();

            if (!membership) {
                throw new Error("Not authorized to update this client");
            }

            if (membership.role === "viewer") {
                throw new Error("Viewers cannot update clients");
            }
        } else {
            // Personal client - must be owner
            if (client.userId !== identity.tokenIdentifier) {
                throw new Error("Not authorized");
            }
        }

        await ctx.db.patch(id, fields);
    },
});

export const remove = mutation({
    args: { id: v.id("clients") },
    handler: async (ctx, args) => {
        const identity = await getUser(ctx);
        const client = await ctx.db.get(args.id);

        if (!client) {
            throw new Error("Client not found");
        }

        // Check authorization
        const clientTeamId = client.teamId;
        if (clientTeamId) {
            const membership = await ctx.db
                .query("teamMembers")
                .withIndex("by_team_user", (q) =>
                    q.eq("teamId", clientTeamId).eq("userId", identity.tokenIdentifier)
                )
                .first();

            if (!membership) {
                throw new Error("Not authorized to delete this client");
            }

            if (membership.role === "viewer" || membership.role === "member") {
                throw new Error("Only admins and owners can delete clients");
            }
        } else {
            // Personal client - must be owner
            if (client.userId !== identity.tokenIdentifier) {
                throw new Error("Not authorized");
            }
        }

        await ctx.db.delete(args.id);
    },
});

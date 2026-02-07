import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { generateSlug } from "@/lib/utils";

async function getUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthenticated");
  }
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return { ...user, _id: userId };
}

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const now = Date.now();
    const slug = generateSlug(args.name);

    const teamId = await ctx.db.insert("teams", {
      name: args.name,
      slug,
      ownerId: user.tokenIdentifier,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("teamMembers", {
      teamId,
      userId: user.tokenIdentifier,
      role: "owner",
      joinedAt: now,
    });

    await ctx.db.patch(user._id, { defaultTeamId: teamId });

    return teamId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user.tokenIdentifier))
      .collect();

    const teams = await Promise.all(
      memberships.map(async (membership) => {
        const team = await ctx.db.get(membership.teamId);
        if (!team) return null;
        return {
          ...team,
          _id: membership.teamId,
          role: membership.role,
        };
      })
    );

    return teams.filter(Boolean);
  },
});

export const get = query({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const team = await ctx.db.get(args.teamId);

    if (!team) {
      throw new Error("Team not found");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this team");
    }

    return {
      ...team,
      _id: args.teamId,
      role: membership.role,
    };
  },
});

export const update = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Not authorized to update team");
    }

    await ctx.db.patch(args.teamId, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const team = await ctx.db.get(args.teamId);

    if (!team) {
      throw new Error("Team not found");
    }

    if (team.ownerId !== user.tokenIdentifier) {
      throw new Error("Only team owner can delete team");
    }

    await ctx.db.delete(args.teamId);
  },
});

export const getMembers = query({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this team");
    }

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    return Promise.all(
      members.map(async (member) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", member.userId))
          .first();
        
        return {
          ...member,
          user: user ? { email: user.email, name: user.name } : null,
        };
      })
    );
  },
});

export const updateMemberRole = mutation({
  args: {
    teamId: v.id("teams"),
    memberId: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    
    const userMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!userMembership || !["owner", "admin"].includes(userMembership.role)) {
      throw new Error("Not authorized to update member roles");
    }

    if (args.role === "owner" && userMembership.role !== "owner") {
      throw new Error("Only owner can assign owner role");
    }

    const member = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.memberId)
      )
      .first();

    if (!member) {
      throw new Error("Member not found");
    }

    await ctx.db.patch(member._id, { role: args.role });
  },
});

export const removeMember = mutation({
  args: {
    teamId: v.id("teams"),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const team = await ctx.db.get(args.teamId);

    if (!team) {
      throw new Error("Team not found");
    }

    if (team.ownerId === args.memberId) {
      throw new Error("Cannot remove team owner");
    }

    const userMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    const isSelfRemoval = user.tokenIdentifier === args.memberId;
    const canRemoveOthers = userMembership && ["owner", "admin"].includes(userMembership.role);

    if (!isSelfRemoval && !canRemoveOthers) {
      throw new Error("Not authorized to remove members");
    }

    const member = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.memberId)
      )
      .first();

    if (!member) {
      throw new Error("Member not found");
    }

    await ctx.db.delete(member._id);
  },
});

export const leaveTeam = mutation({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const team = await ctx.db.get(args.teamId);

    if (!team) {
      throw new Error("Team not found");
    }

    if (team.ownerId === user.tokenIdentifier) {
      throw new Error("Owner must transfer ownership or delete team");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this team");
    }

    await ctx.db.delete(membership._id);
  },
});

export const updateLogo = mutation({
  args: {
    teamId: v.id("teams"),
    logoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Not authorized to update team logo");
    }

    await ctx.db.patch(args.teamId, {
      logoUrl: args.logoUrl,
      updatedAt: Date.now(),
    });
  },
});

export const removeLogo = mutation({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Not authorized to remove team logo");
    }

    await ctx.db.patch(args.teamId, {
      logoUrl: undefined,
      updatedAt: Date.now(),
    });
  },
});

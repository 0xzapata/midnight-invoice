import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { randomBytes } from "crypto";

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

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export const invite = mutation({
  args: {
    teamId: v.id("teams"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const now = Date.now();
    
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Not authorized to invite members");
    }

    const invitedUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (invitedUser) {
      const existingMember = await ctx.db
        .query("teamMembers")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", args.teamId).eq("userId", invitedUser.tokenIdentifier)
        )
        .first();

      if (existingMember) {
        throw new Error("User is already a member");
      }
    }

    const existingInvitation = await ctx.db
      .query("teamInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .filter((q) => q.and(q.eq(q.field("teamId"), args.teamId), q.eq(q.field("status"), "pending")))
      .first();

    if (existingInvitation) {
      throw new Error("Invitation already pending");
    }

    const token = generateToken();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

    const invitationId = await ctx.db.insert("teamInvitations", {
      teamId: args.teamId,
      email: args.email,
      role: args.role,
      invitedBy: user.tokenIdentifier,
      invitedAt: now,
      expiresAt,
      token,
      status: "pending",
    });

    return { invitationId, token };
  },
});

export const listInvitations = query({
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

    const invitations = await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    return invitations;
  },
});

export const accept = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const now = Date.now();

    const invitation = await ctx.db
      .query("teamInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invitation) {
      throw new Error("Invalid invitation");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation already processed");
    }

    if (invitation.expiresAt < now) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new Error("Invitation expired");
    }

    if (invitation.email !== user.email) {
      throw new Error("Invitation is for a different email");
    }

    const existingMember = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invitation.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (existingMember) {
      throw new Error("Already a member of this team");
    }

    await ctx.db.insert("teamMembers", {
      teamId: invitation.teamId,
      userId: user.tokenIdentifier,
      role: invitation.role,
      joinedAt: now,
      invitedBy: invitation.invitedBy,
    });

    await ctx.db.patch(invitation._id, { status: "accepted" });

    return invitation.teamId;
  },
});

export const cancel = mutation({
  args: {
    invitationId: v.id("teamInvitations"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invitation.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      if (invitation.invitedBy !== user.tokenIdentifier) {
        throw new Error("Not authorized to cancel this invitation");
      }
    }

    await ctx.db.delete(args.invitationId);
  },
});

export const getByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("teamInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invitation) {
      return null;
    }

    if (invitation.status !== "pending") {
      return null;
    }

    if (invitation.expiresAt < Date.now()) {
      return null;
    }

    const team = await ctx.db.get(invitation.teamId);
    if (!team) {
      return null;
    }

    return {
      ...invitation,
      teamName: team.name,
    };
  },
});

export const resend = mutation({
  args: {
    invitationId: v.id("teamInvitations"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const now = Date.now();

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invitation.teamId).eq("userId", user.tokenIdentifier)
      )
      .first();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Not authorized to resend invitations");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only resend pending invitations");
    }

    const newToken = generateToken();
    const newExpiresAt = now + 7 * 24 * 60 * 60 * 1000;

    await ctx.db.patch(args.invitationId, {
      token: newToken,
      invitedAt: now,
      expiresAt: newExpiresAt,
    });

    return newToken;
  },
});

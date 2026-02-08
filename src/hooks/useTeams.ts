import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useCallback } from "react";

export function useTeams() {
  const teams = useQuery(api.teams.list);
  const createTeam = useMutation(api.teams.create);
  const updateTeam = useMutation(api.teams.update);
  const deleteTeam = useMutation(api.teams.remove);
  const leaveTeam = useMutation(api.teams.leaveTeam);

  return {
    teams: teams ?? [],
    isLoading: teams === undefined,
    createTeam,
    updateTeam,
    deleteTeam,
    leaveTeam,
  };
}

export function useTeam(teamId: string | undefined) {
  const team = useQuery(api.teams.get, teamId ? { teamId: teamId as Id<"teams"> } : "skip");
  const members = useQuery(api.teams.getMembers, teamId ? { teamId: teamId as Id<"teams"> } : "skip");
  
  const updateMemberRole = useMutation(api.teams.updateMemberRole);
  const removeMember = useMutation(api.teams.removeMember);

  const handleUpdateRole = useCallback(
    async (memberId: string, role: "owner" | "admin" | "member" | "viewer") => {
      if (!teamId) return;
      await updateMemberRole({ teamId: teamId as Id<"teams">, memberId, role });
    },
    [teamId, updateMemberRole]
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!teamId) return;
      await removeMember({ teamId: teamId as Id<"teams">, memberId });
    },
    [teamId, removeMember]
  );

  return {
    team,
    members: members ?? [],
    isLoading: team === undefined || members === undefined,
    updateRole: handleUpdateRole,
    removeMember: handleRemoveMember,
  };
}

export function useTeamInvitations(teamId: string | undefined) {
  const invitations = useQuery(
    api.teamInvitations.listInvitations, 
    teamId ? { teamId: teamId as Id<"teams"> } : "skip"
  );
  
  const invite = useMutation(api.teamInvitations.invite);
  const cancel = useMutation(api.teamInvitations.cancel);
  const resend = useMutation(api.teamInvitations.resend);

  const handleInvite = useCallback(
    async (email: string, role: "admin" | "member" | "viewer") => {
      if (!teamId) return;
      return await invite({ teamId: teamId as Id<"teams">, email, role });
    },
    [teamId, invite]
  );

  const handleCancel = useCallback(
    async (invitationId: string) => {
      await cancel({ invitationId: invitationId as Id<"teamInvitations"> });
    },
    [cancel]
  );

  const handleResend = useCallback(
    async (invitationId: string) => {
      return await resend({ invitationId: invitationId as Id<"teamInvitations"> });
    },
    [resend]
  );

  return {
    invitations: invitations ?? [],
    isLoading: invitations === undefined,
    invite: handleInvite,
    cancel: handleCancel,
    resend: handleResend,
  };
}

export function useAcceptInvitation() {
  const accept = useMutation(api.teamInvitations.accept);
  
  return {
    acceptInvitation: async (token: string) => {
      return await accept({ token });
    },
  };
}

import { useState } from "react";
import { Check, ChevronDown, Plus, UserPlus, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTeams, useTeam } from "@/hooks/useTeams";
import { useTeamContext } from "@/stores/useTeamContext";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { canInviteMembers, TeamRole } from "@/types/team";
import { TeamAvatar, PersonalAvatar } from "./TeamAvatar";

export function TeamSwitcher() {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const { teams, isLoading } = useTeams();
  const { currentTeamId, setCurrentTeam } = useTeamContext();
  const [open, setOpen] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className="h-8 gap-1">
        <Spinner size="sm" />
      </Button>
    );
  }

  const currentTeam = teams.find((t) => t._id === currentTeamId);
  const hasTeams = teams.length > 0;
  const userRole = currentTeam?.role as TeamRole | undefined;
  const canInvite = userRole ? canInviteMembers(userRole) : false;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-2 px-2 text-xs",
            !hasTeams && !currentTeamId && "text-muted-foreground"
          )}
        >
          {currentTeam ? (
            <TeamAvatar
              name={currentTeam.name}
              logoUrl={currentTeam.logoUrl}
              size="xs"
            />
          ) : (
            <PersonalAvatar size="xs" />
          )}
          <span className="max-w-[100px] truncate hidden sm:inline">
            {currentTeam?.name || "Personal"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Select Team</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setCurrentTeam(null);
            setOpen(false);
          }}
          className="text-xs cursor-pointer gap-2"
        >
          <PersonalAvatar size="xs" />
          <span className="flex-1">Personal</span>
          {!currentTeamId && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>

        {teams.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {teams.map((team) => (
              <DropdownMenuItem
                key={team._id}
                onClick={() => {
                  setCurrentTeam(team._id);
                  setOpen(false);
                }}
                className="text-xs cursor-pointer gap-2"
              >
                <TeamAvatar
                  name={team.name}
                  logoUrl={team.logoUrl}
                  size="xs"
                />
                <span className="flex-1 truncate">{team.name}</span>
                {currentTeamId === team._id && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {currentTeamId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {canInvite && (
                <DropdownMenuItem
                  onClick={() => {
                    navigate(`/teams/${currentTeamId}?tab=invitations`);
                    setOpen(false);
                  }}
                  className="text-xs cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5 mr-2" />
                  Invite Members
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  navigate(`/teams/${currentTeamId}`);
                  setOpen(false);
                }}
                className="text-xs cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5 mr-2" />
                Team Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            navigate("/teams/new");
            setOpen(false);
          }}
          className="text-xs cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 mr-2" />
          Create New Team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

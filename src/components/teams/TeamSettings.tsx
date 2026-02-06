import { useState } from 'react';
import { useTeams, useTeam, useTeamInvitations } from '@/hooks/useTeams';
import { TeamRole, canManageMembers, canEditTeam, canInviteMembers } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Settings, Mail, Crown, Shield, User, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface TeamSettingsProps {
  teamId: string;
}

const ROLE_ICONS = {
  owner: Crown,
  admin: Shield,
  member: User,
  viewer: Eye,
};

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function TeamSettings({ teamId }: TeamSettingsProps) {
  const { team, members, isLoading, updateRole, removeMember } = useTeam(teamId);
  const { invitations, invite, cancel } = useTeamInvitations(teamId);
  const { updateTeam, leaveTeam, deleteTeam } = useTeams();
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('member');
  const [teamName, setTeamName] = useState(team?.name ?? '');
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !team) {
    return <div>Loading team settings...</div>;
  }

  const userRole = team.role as TeamRole;
  const canEdit = canEditTeam(userRole);
  const canManage = canManageMembers(userRole);
  const canInvite = canInviteMembers(userRole);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    
    try {
      await invite(inviteEmail, inviteRole as Exclude<TeamRole, 'owner'>);
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
    } catch (error) {
      toast.error('Failed to send invitation');
    }
  };

  const handleUpdateTeam = async () => {
    try {
      await updateTeam({ teamId: teamId as any, name: teamName });
      setIsEditing(false);
      toast.success('Team name updated');
    } catch (error) {
      toast.error('Failed to update team');
    }
  };

  const handleLeaveTeam = async () => {
    try {
      await leaveTeam({ teamId: teamId as any });
      toast.success('You have left the team');
    } catch (error) {
      toast.error('Failed to leave team');
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="members" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="invitations" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Invitations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Information</CardTitle>
              <CardDescription>
                Manage your team name and settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Team Name</Label>
                <div className="flex gap-2">
                  <Input
                    id="team-name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    disabled={!isEditing || !canEdit}
                  />
                  {canEdit && (
                    isEditing ? (
                      <>
                        <Button onClick={handleUpdateTeam}>Save</Button>
                        <Button variant="outline" onClick={() => {
                          setTeamName(team.name);
                          setIsEditing(false);
                        }}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" onClick={() => setIsEditing(true)}>
                        Edit
                      </Button>
                    )
                  )}
                </div>
              </div>

              <div className="pt-4 border-t">
                <Label>Danger Zone</Label>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" onClick={handleLeaveTeam}>
                    Leave Team
                  </Button>
                  {userRole === 'owner' && (
                    <Button variant="destructive" onClick={() => deleteTeam({ teamId: teamId as any })}>
                      Delete Team
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage team members and their roles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {members.map((member) => {
                  const Icon = ROLE_ICONS[member.role as TeamRole];
                  return (
                    <div key={member._id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium">{member.user?.name || member.user?.email}</p>
                          <p className="text-sm text-muted-foreground">{ROLE_LABELS[member.role as TeamRole]}</p>
                        </div>
                      </div>
                      
                      {canManage && member.userId !== team.ownerId && (
                        <div className="flex gap-2">
                          <Select
                            value={member.role}
                            onValueChange={(value) => updateRole(member.userId, value as TeamRole)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMember(member.userId)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
              <CardDescription>
                Manage pending team invitations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canInvite && (
                <div className="flex gap-2 p-4 border rounded-lg">
                  <Input
                    placeholder="Enter email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TeamRole)}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button onClick={handleInvite}>Invite</Button>
                </div>
              )}

              <div className="space-y-2">
                {invitations.map((invitation) => (
                  <div key={invitation._id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {ROLE_LABELS[invitation.role as TeamRole]} • Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => cancel(invitation._id)}>
                      Cancel
                    </Button>
                  </div>
                ))}
                
                {invitations.length === 0 && (
                  <p className="text-muted-foreground text-center py-8">No pending invitations</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

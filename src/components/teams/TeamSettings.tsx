import { useState, useRef, useEffect } from 'react';
import { useTeams, useTeam, useTeamInvitations } from '@/hooks/useTeams';
import { TeamRole, canManageMembers, canEditTeam, canInviteMembers } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Settings, Mail, Crown, Shield, User, Eye, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { TeamAvatar } from './TeamAvatar';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

import { Id } from '../../../convex/_generated/dataModel';

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
  // Using explicit type assertion to Id<"teams"> where needed because the generated API types
  // might not fully align with the generic Id string in some contexts
  const updateLogo = useMutation(api.teams.updateLogo);
  const removeLogo = useMutation(api.teams.removeLogo);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('member');
  const [teamName, setTeamName] = useState(team?.name ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (team?.name) {
      setTeamName(team.name);
      setIsEditing(false);
    }
  }, [team?.name]);

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
      await updateTeam({ teamId: teamId as Id<"teams">, name: teamName });
      setIsEditing(false);
      toast.success('Team name updated');
    } catch (error) {
      toast.error('Failed to update team');
    }
  };

  const handleLeaveTeam = async () => {
    try {
      await leaveTeam({ teamId: teamId as Id<"teams"> });
      toast.success('You have left the team');
    } catch (error) {
      toast.error('Failed to leave team');
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be less than 2MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('File must be an image');
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        await updateLogo({ teamId: teamId as Id<"teams">, logoUrl: base64 });
        toast.success('Logo updated successfully');
      } catch (error) {
        toast.error('Failed to upload logo');
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = async () => {
    try {
      await removeLogo({ teamId: teamId as Id<"teams"> });
      toast.success('Logo removed');
    } catch (error) {
      toast.error('Failed to remove logo');
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
              <div className="flex items-start gap-6">
                <div className="flex flex-col items-center gap-2">
                  <TeamAvatar
                    name={team.name}
                    logoUrl={team.logoUrl}
                    size="xl"
                  />
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <Camera className="w-4 h-4 mr-1" />
                        {isUploading ? 'Uploading...' : 'Change'}
                      </Button>
                      {team.logoUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          onClick={handleRemoveLogo}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                </div>

                <div className="flex-1 space-y-2">
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
                  <p className="text-xs text-muted-foreground">
                    Logo will be displayed in the team switcher and on invoices. Max 2MB.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t">
                <Label>Danger Zone</Label>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" onClick={handleLeaveTeam}>
                    Leave Team
                  </Button>
                  {userRole === 'owner' && (
                      <Button
                      variant="destructive"
                      onClick={async () => {
                        try {
                          await deleteTeam({ teamId: teamId as Id<"teams"> });
                          toast.success('Team deleted');
                        } catch (error) {
                          toast.error('Failed to delete team');
                        }
                      }}
                    >
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

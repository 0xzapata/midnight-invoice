import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Header } from '@/components/layout/Header';
import { useTeams } from '@/hooks/useTeams';
import { useTeamContext } from '@/stores/useTeamContext';
import { generateSlug } from '@/lib/utils';

export function CreateTeamPage() {
  const navigate = useNavigate();
  const { createTeam } = useTeams();
  const { setCurrentTeam } = useTeamContext();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Please enter a team name');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const trimmedName = name.trim();
      const slug = generateSlug(trimmedName);
      const teamId = await createTeam({
        name: trimmedName,
        slug,
      });
      
      setCurrentTeam(teamId);
      toast.success('Team created successfully');
      navigate('/');
    } catch (error) {
      console.error('Failed to create team:', error);
      toast.error('Failed to create team');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container py-8">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Create a Team
            </h1>
            <p className="text-sm text-muted-foreground">
              Teams let you collaborate on invoices with others
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Team Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Acme Corp"
                className="bg-secondary border-border"
                disabled={isSubmitting}
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? 'Creating...' : 'Create Team'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

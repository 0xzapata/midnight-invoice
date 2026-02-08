import { useState } from "react";
import { Building2, Users, ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTeams } from "@/hooks/useTeams";

interface TeamOnboardingProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TeamOnboarding({ isOpen, onClose }: TeamOnboardingProps) {
  const navigate = useNavigate();
  const { teams, isLoading } = useTeams();
  const [step, setStep] = useState(1);

  const handleCreateTeam = () => {
    onClose();
    navigate("/teams/new");
  };

  const handleSkip = () => {
    onClose();
  };

  if (isLoading || teams.length > 0) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 1 && (
              <>
                <Building2 className="h-5 w-5 text-primary" />
                Welcome to Teams
              </>
            )}
            {step === 2 && (
              <>
                <Users className="h-5 w-5 text-primary" />
                Collaborate Together
              </>
            )}
            {step === 3 && (
              <>
                <Sparkles className="h-5 w-5 text-primary" />
                Get Started
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Teams help you organize invoices and collaborate with others."}
            {step === 2 && "Invite team members to work on invoices together with role-based permissions."}
            {step === 3 && "Create your first team to start collaborating."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <h4 className="font-medium text-sm">Organize by Team</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Keep personal and work invoices separate with dedicated workspaces.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <h4 className="font-medium text-sm">Shared Clients</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Team members can access shared client lists for faster invoicing.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <h4 className="font-medium text-sm">Role-Based Access</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Owner, Admin, Member, and Viewer roles with different permissions.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <h4 className="font-medium text-sm">Real-Time Collaboration</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  See team invoices and activity with instant cloud sync.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Ready to create your first team?
              </p>
            </div>
          )}

          <div className="flex justify-between pt-4">
            {step > 1 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                Skip for now
              </Button>
            )}

            {step < 3 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleCreateTeam}>
                Create Team
              </Button>
            )}
          </div>

          <div className="flex justify-center gap-1 pt-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

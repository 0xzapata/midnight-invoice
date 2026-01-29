
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { UserMenu } from "@/components/auth/UserMenu";

interface HeaderProps {
  onSettingsClick?: () => void;
}

export function Header({ onSettingsClick }: HeaderProps) {
  const navigate = useNavigate();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
            <img
              src="/favicon.svg"
              alt={`${env.VITE_APP_NAME} Logo`}
              className="w-4 h-4 text-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-foreground">
              {env.VITE_APP_NAME}
            </h1>
            {env.VITE_APP_ENV === "DEVELOPMENT" && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium border border-red-500/20">
                Development
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate("/create", { viewTransition: true })}
          >
            <Plus className="w-4 h-4 mr-2" />
            New Invoice
          </Button>
          
          {isAuthenticated ? (
            <UserMenu onSettingsClick={onSettingsClick} />
          ) : (
            <Button 
                variant="outline" 
                size="sm" 
                onClick={() => void signIn("workos")}
            >
                Sign In
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

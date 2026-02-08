import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TeamContextState {
  currentTeamId: string | null;
  setCurrentTeam: (teamId: string | null) => void;
  clearCurrentTeam: () => void;
}

export const useTeamContext = create<TeamContextState>()(
  persist(
    (set) => ({
      currentTeamId: null,
      setCurrentTeam: (teamId) => set({ currentTeamId: teamId }),
      clearCurrentTeam: () => set({ currentTeamId: null }),
    }),
    {
      name: 'team-context-storage',
    }
  )
);

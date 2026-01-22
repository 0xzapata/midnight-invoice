import { ReactNode } from 'react';

export function MockConvexProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const mockConvexAuth = {
  isAuthenticated: false,
  isLoading: false,
};

export const mockUseQuery = () => undefined;
export const mockUseMutation = () => async () => {};

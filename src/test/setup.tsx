import { vi } from 'vitest';

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
  }),
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

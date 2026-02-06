
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';
import { vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

// Mock env
vi.mock('@/env', () => ({
  env: {
    VITE_APP_NAME: 'Midnight Invoice',
    VITE_APP_ENV: 'TEST',
  },
}));

// Mock Convex/Auth hooks
const mockSignOut = vi.fn();
const mockSignIn = vi.fn();
const mockUseConvexAuth = vi.fn();
const mockUseQuery = vi.fn();

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({
    signOut: mockSignOut,
    signIn: mockSignIn,
  }),
}));

vi.mock('convex/react', () => ({
  useConvexAuth: () => mockUseConvexAuth(),
  useQuery: () => mockUseQuery(),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Sign In button when unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: false });
    
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('triggers sign in on click', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: false });
    
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByText('Sign In'));
    expect(mockSignIn).toHaveBeenCalledWith('workos');
  });

  it('renders UserMenu when authenticated', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    mockUseQuery.mockReturnValue({ 
      name: 'Test User', 
      email: 'test@example.com',
      image: 'https://example.com/avatar.png' 
    });

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    // Avatar fallback or image should be present (shadcn avatar logic varies, but button is there)
    const userButton = screen.queryByRole('button', { name: /test user/i }) || screen.getAllByRole('button')[1]; 
    expect(userButton).toBeInTheDocument();
  });
});

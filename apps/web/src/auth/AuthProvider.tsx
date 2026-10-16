import {
  can,
  type AuthResponse,
  type LoginInput,
  type Permission,
  type UserDto,
} from '@ims/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  apiFetch,
  refreshSession,
  SESSION_EXPIRED,
  sessionEvents,
  setAccessToken,
} from '@/lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: UserDto | null;
  login(input: LoginInput): Promise<UserDto>;
  logout(): Promise<void>;
  /** Replace the cached user, e.g. after editing your own profile. */
  setUser(user: UserDto): void;
  can(permission: Permission): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserDto | null>(null);

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        setUser(session.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      signOutLocally();
      toast.error('Your session has ended. Please sign in again.');
    };
    sessionEvents.addEventListener(SESSION_EXPIRED, onExpired);
    return () => sessionEvents.removeEventListener(SESSION_EXPIRED, onExpired);
  }, [signOutLocally]);

  const login = useCallback(async (input: LoginInput) => {
    const session = await apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: input });
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      signOutLocally();
    }
  }, [signOutLocally]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, setUser, can: (p) => can(user?.role, p) }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

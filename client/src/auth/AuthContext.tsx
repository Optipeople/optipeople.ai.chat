import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { login as apiLogin } from "./authApi";
import { getAccounts, type Account } from "./accountsApi";
import {
  clearCurrentAccount,
  clearSession,
  getAccessToken,
  getCurrentAccount,
  getUserName,
  saveCurrentAccount,
  type StoredAccount,
} from "./storage";

export type User = { email: string };

export type AuthContextValue = {
  user: User | null;
  accounts: Account[];
  currentAccount: StoredAccount | null;
  isInitializing: boolean;
  isLoggingIn: boolean;
  isLoadingAccounts: boolean;
  loginError: string | null;
  accountsError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  selectAccount: (accountId: string) => void;
  clearSelectedAccount: () => void;
  reloadAccounts: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<StoredAccount | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setAccounts([]);
    setCurrentAccount(null);
    setLoginError(null);
    setAccountsError(null);
  }, []);

  const reloadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    setAccountsError(null);
    try {
      const list = await getAccounts();
      setAccounts(list);

      if (list.length === 1) {
        const only: StoredAccount = { id: list[0].id, name: list[0].name };
        saveCurrentAccount(only);
        setCurrentAccount(only);
        return;
      }

      if (list.length === 0) {
        clearCurrentAccount();
        setCurrentAccount(null);
        return;
      }

      const stored = getCurrentAccount();
      if (stored && list.some((a) => a.id === stored.id)) {
        setCurrentAccount(stored);
      } else {
        clearCurrentAccount();
        setCurrentAccount(null);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Kunne ikke hente konti";
      // Treat an expired/invalid session as a logout so the user lands back
      // on the login screen instead of being stuck on the picker.
      if (message === "Session expired") {
        logout();
        return;
      }
      setAccountsError(message);
      setAccounts([]);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [logout]);

  useEffect(() => {
    const token = getAccessToken();
    const email = getUserName();
    if (token && email) {
      setUser({ email });
      const stored = getCurrentAccount();
      if (stored) setCurrentAccount(stored);
      void reloadAccounts();
    }
    setIsInitializing(false);
  }, [reloadAccounts]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoggingIn(true);
      setLoginError(null);
      try {
        const res = await apiLogin(email, password);
        setUser({ email: res.user_name ?? email });
        await reloadAccounts();
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : "Login failed");
        throw err;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [reloadAccounts],
  );

  const selectAccount = useCallback(
    (accountId: string) => {
      const found = accounts.find((a) => a.id === accountId);
      if (!found) return;
      const sel: StoredAccount = { id: found.id, name: found.name };
      saveCurrentAccount(sel);
      setCurrentAccount(sel);
    },
    [accounts],
  );

  const clearSelectedAccount = useCallback(() => {
    clearCurrentAccount();
    setCurrentAccount(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accounts,
      currentAccount,
      isInitializing,
      isLoggingIn,
      isLoadingAccounts,
      loginError,
      accountsError,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
    }),
    [
      user,
      accounts,
      currentAccount,
      isInitializing,
      isLoggingIn,
      isLoadingAccounts,
      loginError,
      accountsError,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

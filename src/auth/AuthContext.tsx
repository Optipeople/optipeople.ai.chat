"use client";

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
import { getCurrentUser } from "./currentUserApi";
import {
  AccountsForbiddenError,
  getAccounts,
  type Account,
} from "./accountsApi";
import {
  MachinesForbiddenError,
  getMachinesForAccount,
  type Machine,
} from "./machinesApi";
import { getRegisteredSets } from "./registeredApi";
import {
  clearCurrentAccount,
  clearCurrentMachine,
  clearSession,
  getAccessToken,
  getCurrentAccount,
  getCurrentMachine,
  getUserName,
  saveCurrentAccount,
  saveCurrentMachine,
  type StoredAccount,
  type StoredMachine,
} from "./storage";

export type User = {
  email: string;
  // Human-readable Optipeople role (e.g. "Super Administrator"). Shown in
  // the user menu. Populated asynchronously after login from
  // /api/User/GetCurrentUser; null until that fetch completes.
  roleName: string | null;
  // Stable code-style identifier (e.g. "SuperAdministrator"). Use this
  // for gating, not roleName.
  permissionName: string | null;
};

export function isSuperAdmin(user: User | null): boolean {
  return user?.permissionName === "SuperAdministrator";
}

export type AuthContextValue = {
  user: User | null;
  accounts: Account[];
  currentAccount: StoredAccount | null;
  // True when the backend refused to list accounts for this user (operator
  // role). Such users skip the picker and go straight to chat.
  accountsForbidden: boolean;
  machines: Machine[];
  currentMachine: StoredMachine | null;
  machinesForbidden: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  isLoadingAccounts: boolean;
  isLoadingMachines: boolean;
  loginError: string | null;
  accountsError: string | null;
  machinesError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  selectAccount: (accountId: string) => void;
  clearSelectedAccount: () => void;
  reloadAccounts: () => Promise<void>;
  selectMachine: (machineId: string) => void;
  clearSelectedMachine: () => void;
  reloadMachines: () => Promise<void>;
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
  const [machines, setMachines] = useState<Machine[]>([]);
  const [currentMachine, setCurrentMachine] = useState<StoredMachine | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isLoadingMachines, setIsLoadingMachines] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [machinesError, setMachinesError] = useState<string | null>(null);
  const [accountsForbidden, setAccountsForbidden] = useState(false);
  const [machinesForbidden, setMachinesForbidden] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setAccounts([]);
    setCurrentAccount(null);
    setMachines([]);
    setCurrentMachine(null);
    setAccountsForbidden(false);
    setMachinesForbidden(false);
    setLoginError(null);
    setAccountsError(null);
    setMachinesError(null);
  }, []);

  const reloadMachines = useCallback(async () => {
    const account = getCurrentAccount();
    if (!account) {
      setMachines([]);
      setCurrentMachine(null);
      setMachinesForbidden(false);
      return;
    }

    setIsLoadingMachines(true);
    setMachinesError(null);
    try {
      // Operators should only see machines onboarded into Opti Assist.
      // Intersect Optipeople's full machine list with machine_kb so the
      // picker hides anything we can't serve answers for.
      const [rawList, registered] = await Promise.all([
        getMachinesForAccount(account.id),
        getRegisteredSets(),
      ]);
      const list = rawList.filter((m) => registered.machineIds.has(m.id));
      setMachines(list);
      setMachinesForbidden(false);

      if (list.length === 1) {
        const only: StoredMachine = { id: list[0].id, name: list[0].name };
        saveCurrentMachine(only);
        setCurrentMachine(only);
        return;
      }

      if (list.length === 0) {
        clearCurrentMachine();
        setCurrentMachine(null);
        return;
      }

      const stored = getCurrentMachine();
      if (stored && list.some((m) => m.id === stored.id)) {
        setCurrentMachine(stored);
      } else {
        clearCurrentMachine();
        setCurrentMachine(null);
      }
    } catch (err) {
      if (err instanceof MachinesForbiddenError) {
        setMachinesForbidden(true);
        setMachines([]);
        clearCurrentMachine();
        setCurrentMachine(null);
        return;
      }
      const message =
        err instanceof Error ? err.message : "Kunne ikke hente maskiner";
      if (message === "Session expired") {
        logout();
        return;
      }
      setMachinesError(message);
      setMachines([]);
    } finally {
      setIsLoadingMachines(false);
    }
  }, [logout]);

  const reloadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    setAccountsError(null);
    try {
      // Same filter as machines: only show accounts that have at least one
      // machine onboarded into this Opti Assist instance. Keeps the picker
      // focused on what the operator can actually use.
      const [rawList, registered] = await Promise.all([
        getAccounts(),
        getRegisteredSets(),
      ]);
      const list = rawList.filter((a) => registered.accountIds.has(a.id));
      setAccounts(list);
      setAccountsForbidden(false);

      if (list.length === 1) {
        const only: StoredAccount = { id: list[0].id, name: list[0].name };
        saveCurrentAccount(only);
        setCurrentAccount(only);
        await reloadMachines();
        return;
      }

      if (list.length === 0) {
        clearCurrentAccount();
        setCurrentAccount(null);
        setMachines([]);
        setCurrentMachine(null);
        return;
      }

      const stored = getCurrentAccount();
      if (stored && list.some((a) => a.id === stored.id)) {
        setCurrentAccount(stored);
        await reloadMachines();
      } else {
        clearCurrentAccount();
        setCurrentAccount(null);
        setMachines([]);
        setCurrentMachine(null);
      }
    } catch (err) {
      if (err instanceof AccountsForbiddenError) {
        setAccountsForbidden(true);
        setAccounts([]);
        clearCurrentAccount();
        setCurrentAccount(null);
        setMachines([]);
        setCurrentMachine(null);
        return;
      }
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
  }, [logout, reloadMachines]);

  // Resolves role from /api/User/GetCurrentUser and merges it onto the
  // existing user. Best-effort — a failure here just leaves role: null,
  // it shouldn't block the rest of the auth flow.
  const refreshRole = useCallback(async () => {
    try {
      const me = await getCurrentUser();
      if (me) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                email: me.email,
                roleName: me.roleName,
                permissionName: me.permissionName,
              }
            : prev,
        );
      }
    } catch {
      // ignore — UI shows "—" rolle until the next refresh
    }
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    const email = getUserName();
    if (token && email) {
      setUser({ email, roleName: null, permissionName: null });
      const storedAccount = getCurrentAccount();
      if (storedAccount) setCurrentAccount(storedAccount);
      const storedMachine = getCurrentMachine();
      if (storedMachine) setCurrentMachine(storedMachine);
      void reloadAccounts();
      void refreshRole();
    }
    setIsInitializing(false);
  }, [reloadAccounts, refreshRole]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoggingIn(true);
      setLoginError(null);
      try {
        const res = await apiLogin(email, password);
        setUser({
          email: res.user_name ?? email,
          roleName: null,
          permissionName: null,
        });
        await Promise.all([reloadAccounts(), refreshRole()]);
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : "Login failed");
        throw err;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [reloadAccounts, refreshRole],
  );

  const selectAccount = useCallback(
    (accountId: string) => {
      const found = accounts.find((a) => a.id === accountId);
      if (!found) return;
      const sel: StoredAccount = { id: found.id, name: found.name };
      saveCurrentAccount(sel);
      setCurrentAccount(sel);
      setMachines([]);
      setCurrentMachine(null);
      setMachinesForbidden(false);
      setMachinesError(null);
      void reloadMachines();
    },
    [accounts, reloadMachines],
  );

  const clearSelectedAccount = useCallback(() => {
    clearCurrentAccount();
    setCurrentAccount(null);
    setMachines([]);
    setCurrentMachine(null);
    setMachinesForbidden(false);
    setMachinesError(null);
  }, []);

  const selectMachine = useCallback(
    (machineId: string) => {
      const found = machines.find((m) => m.id === machineId);
      if (!found) return;
      const sel: StoredMachine = { id: found.id, name: found.name };
      saveCurrentMachine(sel);
      setCurrentMachine(sel);
    },
    [machines],
  );

  const clearSelectedMachine = useCallback(() => {
    clearCurrentMachine();
    setCurrentMachine(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accounts,
      currentAccount,
      accountsForbidden,
      machines,
      currentMachine,
      machinesForbidden,
      isInitializing,
      isLoggingIn,
      isLoadingAccounts,
      isLoadingMachines,
      loginError,
      accountsError,
      machinesError,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
      selectMachine,
      clearSelectedMachine,
      reloadMachines,
    }),
    [
      user,
      accounts,
      currentAccount,
      accountsForbidden,
      machines,
      currentMachine,
      machinesForbidden,
      isInitializing,
      isLoggingIn,
      isLoadingAccounts,
      isLoadingMachines,
      loginError,
      accountsError,
      machinesError,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
      selectMachine,
      clearSelectedMachine,
      reloadMachines,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

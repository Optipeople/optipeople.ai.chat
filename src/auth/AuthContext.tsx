"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { login as apiLogin } from "./authApi";
import { fetchConsentStatus, postConsent } from "./consentApi";
import type { ConsentStatus } from "@/lib/consent";
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
import { fetchStoredLocale, persistLocale } from "@/i18n/localeApi";
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
  // Display name from /api/User/GetCurrentUser. Null until that fetch
  // completes; callers should fall back to the email-local-part.
  name: string | null;
  // Human-readable Optipeople role (e.g. "Super Administrator"). Shown in
  // the user menu. Populated asynchronously after login from
  // /api/User/GetCurrentUser; null until that fetch completes.
  roleName: string | null;
  // Stable code-style identifier (e.g. "SuperAdministrator"). Use this
  // for gating, not roleName.
  permissionName: string | null;
  // Optipeople account this user belongs to. Required for account
  // admins (they're scoped to this account); super admins can have it
  // null. Populated by /api/User/GetCurrentUser.
  accountId: string | null;
};

// Permissions that grant unscoped, cross-account admin rights. Partners
// deliberately get exactly the same surface as super admins. Keep in
// sync with FULL_ACCESS_PERMISSIONS in src/lib/auth.ts — the server is
// the real gate, this only decides what the UI offers.
const FULL_ACCESS_PERMISSIONS: readonly string[] = [
  "SuperAdministrator",
  "Partner",
];

// Every permission that reaches the admin surface. Account admins are
// in here too — the server scopes them per-resource.
const ADMIN_PERMISSIONS: readonly string[] = [
  ...FULL_ACCESS_PERMISSIONS,
  "AccountAdministrator",
];

function isAdminPermission(permissionName: string | null): boolean {
  return permissionName ? ADMIN_PERMISSIONS.includes(permissionName) : false;
}

export function isSuperAdmin(user: User | null): boolean {
  return user?.permissionName
    ? FULL_ACCESS_PERMISSIONS.includes(user.permissionName)
    : false;
}

// Account administrator scoped to their own Optipeople account. They
// get the same admin UI surface as a super admin but every server
// route enforces the account scope (see requireAdmin in src/lib/auth.ts).
export function isAccountAdmin(user: User | null): boolean {
  return user?.permissionName === "AccountAdministrator";
}

// Any flavour of admin. Used by AdminGate and UserMenu to decide
// whether to show the admin entries.
export function isAdmin(user: User | null): boolean {
  return isAdminPermission(user?.permissionName ?? null);
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
  consentStatus: ConsentStatus | null;
  acceptConsent: (acceptAnalytics: boolean) => Promise<void>;
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

async function applyStoredLocale(email: string): Promise<void> {
  try {
    const stored = await fetchStoredLocale(email);
    if (!stored) return;
    await persistLocale(stored, email);
    // Re-render with the new cookie. Done at the document level since
    // AuthContext doesn't have access to next/navigation router here
    // without becoming server-coupled, and a full reload is fine
    // immediately after a fresh login.
    if (typeof window !== "undefined") window.location.reload();
  } catch {
    // ignore — user keeps the default locale
  }
}

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
  const [consentStatus, setConsentStatus] = useState<ConsentStatus | null>(
    null,
  );
  // Mirror of user.permissionName that reloadAccounts can read without
  // waiting for a re-render. The role fetch is awaited before the
  // account fetch (see login / the hydrate effect), so by the time
  // accounts load this is populated.
  const permissionRef = useRef<string | null>(null);

  const logout = useCallback(() => {
    clearSession();
    permissionRef.current = null;
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
    setConsentStatus(null);
  }, []);

  // Best-effort load of the consent status. A failure here leaves the
  // status null, which the gate treats as "still loading" and shows
  // the spinner rather than letting the user past unilaterally.
  const refreshConsent = useCallback(async () => {
    try {
      const status = await fetchConsentStatus();
      if (status) setConsentStatus(status);
    } catch {
      // ignore — the gate will keep showing the spinner until next try
    }
  }, []);

  const acceptConsent = useCallback(async (acceptAnalytics: boolean) => {
    const status = await postConsent({
      acceptTerms: true,
      acceptPrivacy: true,
      acceptAnalytics,
    });
    setConsentStatus(status);
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
      // Operators only see accounts that have at least one machine
      // onboarded into this Opti Assist instance — anything else is a
      // dead end for them. Admins see every account they can reach in
      // Optipeople, since onboarding an account's first machine starts
      // by picking that account.
      const adminView = isAdminPermission(permissionRef.current);
      const [rawList, registered] = await Promise.all([
        getAccounts(),
        adminView ? null : getRegisteredSets(),
      ]);
      const list = registered
        ? rawList.filter((a) => registered.accountIds.has(a.id))
        : rawList;
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
        permissionRef.current = me.permissionName;
        setUser((prev) =>
          prev
            ? {
                ...prev,
                email: me.email,
                name: me.name,
                roleName: me.roleName,
                permissionName: me.permissionName,
                accountId: me.accountId,
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
      // Hydrating from localStorage — only available after mount, so the
      // initial render starts unauthenticated and this effect promotes
      // it once the cached session is read.
      /* eslint-disable react-hooks/set-state-in-effect */
      setUser({
        email,
        name: null,
        roleName: null,
        permissionName: null,
        accountId: null,
      });
      const storedAccount = getCurrentAccount();
      if (storedAccount) setCurrentAccount(storedAccount);
      const storedMachine = getCurrentMachine();
      if (storedMachine) setCurrentMachine(storedMachine);
      /* eslint-enable react-hooks/set-state-in-effect */
      // Role first — reloadAccounts needs it to decide whether to
      // narrow the list to onboarded accounts.
      void refreshRole().then(() => reloadAccounts());
      void refreshConsent();
    }
    setIsInitializing(false);
  }, [reloadAccounts, refreshRole, refreshConsent]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoggingIn(true);
      setLoginError(null);
      try {
        const res = await apiLogin(email, password);
        const resolvedEmail = res.user_name ?? email;
        setUser({
          email: resolvedEmail,
          name: null,
          roleName: null,
          permissionName: null,
          accountId: null,
        });
        // Apply the user's stored language preference before the rest of
        // the app re-renders. Best-effort: if the lookup fails we leave
        // the existing cookie alone.
        void applyStoredLocale(resolvedEmail);
        // Role first — see the hydrate effect above.
        await refreshRole();
        await Promise.all([reloadAccounts(), refreshConsent()]);
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : "Login failed");
        throw err;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [reloadAccounts, refreshRole, refreshConsent],
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
      consentStatus,
      acceptConsent,
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
      consentStatus,
      acceptConsent,
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

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
import { useTranslations } from "next-intl";
import { LoginError, SessionExpiredError, login as apiLogin } from "./authApi";
import { clearQrSession } from "./qrStorage";
import { fetchConsentStatus, postConsent } from "./consentApi";
import type { ConsentStatus } from "@/lib/consent";
import { getCurrentUser } from "./currentUserApi";
import {
  AccountsForbiddenError,
  getAccounts,
  searchAccounts,
  type Account,
} from "./accountsApi";
import {
  MachinesForbiddenError,
  getMachinesForAccount,
  type Machine,
} from "./machinesApi";
import { getLocalMachinesForAccount } from "./localMachinesApi";
import { getRegisteredSets } from "./registeredApi";
import { fetchStoredLocale, persistLocale } from "@/i18n/localeApi";
import {
  clearCurrentAccount,
  clearCurrentMachine,
  clearFleetSelected,
  clearSession,
  getAccessToken,
  getCurrentAccount,
  getCurrentMachine,
  getFleetSelected,
  getUserName,
  saveCurrentAccount,
  saveCurrentMachine,
  saveFleetSelected,
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

function isFullAccessPermission(permissionName: string | null): boolean {
  return permissionName
    ? FULL_ACCESS_PERMISSIONS.includes(permissionName)
    : false;
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
  // True while the role fetch after login/hydration is still in flight.
  // AdminGate keeps its spinner up during this window instead of
  // flashing "not authorized" at admins on every hard refresh.
  isRoleLoading: boolean;
  isLoggingIn: boolean;
  isLoadingAccounts: boolean;
  isLoadingMachines: boolean;
  loginError: string | null;
  accountsError: string | null;
  machinesError: string | null;
  consentStatus: ConsentStatus | null;
  consentError: boolean;
  reloadConsent: () => Promise<void>;
  acceptConsent: (acceptAnalytics: boolean) => Promise<void>;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  selectAccount: (accountId: string) => void;
  clearSelectedAccount: () => void;
  reloadAccounts: () => Promise<void>;
  selectMachine: (machineId: string) => void;
  clearSelectedMachine: () => void;
  reloadMachines: () => Promise<void>;
  // Fleet scope ("all machines"): mutually exclusive with a selected
  // machine. selectFleet enters it, selectMachine / clearSelectedMachine
  // leave it. Only meaningful when the account has 2+ machines.
  fleetSelected: boolean;
  selectFleet: () => void;
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
  const t = useTranslations();
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<StoredAccount | null>(
    null,
  );
  const [machines, setMachines] = useState<Machine[]>([]);
  const [currentMachine, setCurrentMachine] = useState<StoredMachine | null>(
    null,
  );
  const [fleetSelected, setFleetSelected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isRoleLoading, setIsRoleLoading] = useState(false);
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
  const [consentError, setConsentError] = useState(false);
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
    setFleetSelected(false);
    setAccountsForbidden(false);
    setMachinesForbidden(false);
    setLoginError(null);
    setAccountsError(null);
    setMachinesError(null);
    setConsentStatus(null);
  }, []);

  // Load of the consent status. A failure keeps the status null so the
  // gate never lets the user past unilaterally — but it also sets
  // consentError so the gate can offer a retry instead of spinning
  // forever on flaky Wi-Fi.
  const refreshConsent = useCallback(async () => {
    setConsentError(false);
    try {
      const status = await fetchConsentStatus();
      if (status) {
        setConsentStatus(status);
      } else {
        setConsentError(true);
      }
    } catch (err) {
      console.error("Consent status fetch failed", err);
      setConsentError(true);
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
      // picker hides anything we can't serve answers for. Machines
      // created by the New account wizard don't exist in the portal yet,
      // so they're fetched separately and appended — best-effort, the
      // portal-backed list must not break if that call fails.
      const [rawList, registered, localList] = await Promise.all([
        getMachinesForAccount(account.id),
        getRegisteredSets(),
        getLocalMachinesForAccount(account.id).catch(() => [] as Machine[]),
      ]);
      const list = [
        ...rawList.filter((m) => registered.machineIds.has(m.id)),
        ...localList,
      ];
      setMachines(list);
      setMachinesForbidden(false);

      if (list.length === 1) {
        // A one-machine account has no fleet to speak of — a stale
        // fleet selection (machine removed since last visit) collapses
        // to the lone machine.
        const only: StoredMachine = { id: list[0].id, name: list[0].name };
        saveCurrentMachine(only);
        setCurrentMachine(only);
        clearFleetSelected();
        setFleetSelected(false);
        return;
      }

      if (list.length === 0) {
        clearCurrentMachine();
        setCurrentMachine(null);
        clearFleetSelected();
        setFleetSelected(false);
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
      if (err instanceof SessionExpiredError) {
        logout();
        return;
      }
      console.error("Machine list fetch failed", err);
      setMachinesError(t("machineSelect.loadFailed"));
      setMachines([]);
    } finally {
      setIsLoadingMachines(false);
    }
  }, [logout, t]);

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
      // A partner's Account/GetAll can omit an account they just
      // registered even though the portal backoffice lists it (via the
      // paged search route). For full-access users, merge that route in
      // — best-effort — so the picker matches what the portal shows.
      const fullAccess = isFullAccessPermission(permissionRef.current);
      const [rawList, registered, supplemental] = await Promise.all([
        getAccounts(),
        adminView ? null : getRegisteredSets(),
        fullAccess ? searchAccounts("").catch(() => []) : [],
      ]);
      let list = registered
        ? rawList.filter((a) => registered.accountIds.has(a.id))
        : rawList;
      const known = new Set(list.map((a) => a.id));
      const extras = supplemental.filter((a) => !known.has(a.id));
      if (extras.length > 0) list = [...list, ...extras];
      setAccounts(list);
      setAccountsForbidden(false);

      // Auto-select a lone account — except for super admins/partners,
      // who must always pass the picker: it's where they create new
      // accounts, and skipping it would strand a one-account admin with
      // no way to reach that button.
      if (list.length === 1 && !isFullAccessPermission(permissionRef.current)) {
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
      // Treat an expired/invalid session as a logout so the user lands back
      // on the login screen instead of being stuck on the picker.
      if (err instanceof SessionExpiredError) {
        logout();
        return;
      }
      console.error("Account list fetch failed", err);
      setAccountsError(t("accountSelect.loadFailed"));
      setAccounts([]);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [logout, reloadMachines, t]);

  // Resolves role from /api/User/GetCurrentUser and merges it onto the
  // existing user. Best-effort — a failure here just leaves role: null,
  // it shouldn't block the rest of the auth flow.
  const refreshRole = useCallback(async () => {
    setIsRoleLoading(true);
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
    } finally {
      setIsRoleLoading(false);
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
      // Machine and fleet are mutually exclusive; a stored machine wins
      // if both somehow survived in storage.
      else if (getFleetSelected()) setFleetSelected(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      // Role first — reloadAccounts needs it to decide whether to
      // narrow the list to onboarded accounts.
      void refreshRole().then(() => reloadAccounts());
      void refreshConsent();
    }
    setIsInitializing(false);
  }, [reloadAccounts, refreshRole, refreshConsent]);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      setIsLoggingIn(true);
      setLoginError(null);
      try {
        const res = await apiLogin(email, password, remember);
        // A leftover QR session from an earlier scan in this tab must not
        // outrank the fresh login — it would silently degrade every call
        // to QR scope.
        clearQrSession();
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
        if (err instanceof LoginError) {
          setLoginError(
            t(`login.errors.${err.code}`, { status: err.status ?? 0 }),
          );
        } else {
          console.error("Login failed", err);
          setLoginError(t("login.errors.generic"));
        }
        throw err;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [reloadAccounts, refreshRole, refreshConsent, t],
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
    setFleetSelected(false);
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
      clearFleetSelected();
      setFleetSelected(false);
    },
    [machines],
  );

  const selectFleet = useCallback(() => {
    saveFleetSelected();
    setFleetSelected(true);
    clearCurrentMachine();
    setCurrentMachine(null);
  }, []);

  // "Back to the picker" — leaves machine AND fleet scope, since the
  // picker is where both get chosen.
  const clearSelectedMachine = useCallback(() => {
    clearCurrentMachine();
    setCurrentMachine(null);
    clearFleetSelected();
    setFleetSelected(false);
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
      isRoleLoading,
      isLoggingIn,
      isLoadingAccounts,
      isLoadingMachines,
      loginError,
      accountsError,
      machinesError,
      consentStatus,
      consentError,
      reloadConsent: refreshConsent,
      acceptConsent,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
      selectMachine,
      clearSelectedMachine,
      reloadMachines,
      fleetSelected,
      selectFleet,
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
      isRoleLoading,
      isLoggingIn,
      isLoadingAccounts,
      isLoadingMachines,
      loginError,
      accountsError,
      machinesError,
      consentStatus,
      consentError,
      refreshConsent,
      acceptConsent,
      login,
      logout,
      selectAccount,
      clearSelectedAccount,
      reloadAccounts,
      selectMachine,
      clearSelectedMachine,
      reloadMachines,
      fleetSelected,
      selectFleet,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

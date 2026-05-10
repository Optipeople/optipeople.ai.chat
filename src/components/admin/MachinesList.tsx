"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdminMachines, type AdminMachine } from "@/admin/adminApi";

export function MachinesList() {
  const router = useRouter();
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminMachines()
      .then((rows) => {
        if (cancelled) return;
        setMachines(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ukendt fejl");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => {
      const name = (m.displayName ?? "").toLowerCase();
      return name.includes(q) || m.machineId.toLowerCase().includes(q);
    });
  }, [machines, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]">
            Maskiner
          </h1>
          <p className="mt-1 text-[14px] text-[var(--color-muted-foreground)]">
            {loading
              ? "Henter maskiner…"
              : `${machines.length} maskiner med vidensbase`}
          </p>
        </div>
        <label className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søg navn eller ID…"
            className={cn(
              "h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-surface)] pl-9 pr-3 text-[14px]",
              "text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-red-600">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {machines.length === 0
            ? "Ingen maskiner endnu. Brug ingest-CLI'en eller upload-formularen (kommer)."
            : "Ingen maskiner matcher din søgning."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <table className="w-full text-[14px]">
            <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Machine ID</th>
                <th className="px-4 py-3 font-medium">Konto ID</th>
                <th className="px-4 py-3 text-right font-medium">Dokumenter</th>
                <th className="w-10 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.machineId}
                  onClick={() => router.push(`/admin/machines/${m.machineId}`)}
                  className={cn(
                    "group cursor-pointer border-t border-[var(--color-hairline)]",
                    "transition-colors hover:bg-[var(--color-muted)]/60",
                  )}
                >
                  <td className="px-4 py-3 font-medium text-[var(--color-foreground)] group-hover:underline">
                    {m.displayName ?? "(uden navn)"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted-foreground)]">
                    {m.machineId}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted-foreground)]">
                    {m.accountId}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                    {m.documentCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-foreground)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

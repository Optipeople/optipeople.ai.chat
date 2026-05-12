"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, MessageSquare, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { getAdminMachines, type AdminMachine } from "@/admin/adminApi";
import { AddMachineDialog } from "@/components/admin/AddMachineDialog";

export function MachinesList() {
  const router = useRouter();
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    const rows = await getAdminMachines();
    setMachines(rows);
  }, []);

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
        <div className="flex items-center gap-2">
          <SearchField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Søg navn eller ID…"
            className="w-72"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Tilføj maskine
          </Button>
        </div>
      </div>

      {addOpen && (
        <AddMachineDialog
          existingMachineIds={new Set(machines.map((m) => m.machineId))}
          onClose={() => setAddOpen(false)}
          onCreated={reload}
        />
      )}

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {machines.length === 0
            ? 'Tryk "Tilføj maskine" for at tilføje din første maskine.'
            : "Ingen maskiner matcher din søgning."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <table className="w-full text-[14px]">
            <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Machine ID</th>
                <th className="px-4 py-3 font-medium">Konto ID</th>
                <th className="px-4 py-3 text-right font-medium">Dokumenter</th>
                <th className="w-10 px-4 py-3"></th>
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
                    <a
                      href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Åbn chat i ny fane"
                      aria-label="Åbn chat"
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </a>
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

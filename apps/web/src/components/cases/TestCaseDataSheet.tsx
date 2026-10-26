import React, { useState, useMemo, useEffect } from "react";
import {
  Table as TableIcon,
  Plus,
  Trash2,
  Copy,
  Save,
  Check,
  Edit2,
  Eye,
  EyeOff,
  Info,
  Star,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { VariableBadge } from "@/components/shared/VariableBadge";
import { useUpdateTestCase, useReplaceSteps } from "@/hooks/use-test-cases";
import type { components } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type CaseDetail = components["schemas"]["TestCaseDetail"];

export interface TestCaseDataSheetProps {
  testCase: CaseDetail;
  steps?: Array<{ action?: string; code?: string | null }>;
  canWrite?: boolean;
  className?: string;
}

interface DatasetRow {
  id: string;
  name: string;
  enabled: boolean;
  is_default?: boolean;
  values: Record<string, string>;
}

export function TestCaseDataSheet({
  testCase,
  steps = [],
  canWrite = true,
  className,
}: TestCaseDataSheetProps) {
  const updateTestCase = useUpdateTestCase(testCase.id);
  const replaceSteps = useReplaceSteps(testCase.id);

  // 1. Detect variables from steps
  const detectedKeys = useMemo(() => {
    const keys = new Set<string>();
    const regex = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;
    for (const step of steps) {
      if (step.action) {
        let match;
        while ((match = regex.exec(step.action)) !== null) {
          if (match[1]) keys.add(match[1]);
        }
      }
      if (step.code) {
        let match;
        while ((match = regex.exec(step.code)) !== null) {
          if (match[1]) keys.add(match[1]);
        }
      }
    }
    return Array.from(keys);
  }, [steps]);
  const detectedKeysSignature = useMemo(
    () => detectedKeys.slice().sort().join(","),
    [detectedKeys]
  );

  // Combined columns (schema from DB + newly detected + user added)
  const [columns, setColumns] = useState<string[]>([]);
  const unmappedDetectedKeys = useMemo(
    () => detectedKeys.filter((k) => !columns.includes(k)),
    [detectedKeys, columns]
  );
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [newColumnName, setNewColumnName] = useState("");
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const removedColumnsRef = React.useRef(new Set<string>());
  const [revealedCells, setRevealedCells] = useState<Record<string, boolean>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [orientation, setOrientation] = useState<"compact" | "classic">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("suitest_ddt_orientation");
        if (saved === "classic" || saved === "compact") return saved;
      } catch {
        // ignore storage security errors
      }
    }
    return "compact";
  });

  const toggleOrientation = () => {
    setOrientation((prev) => {
      const next = prev === "compact" ? "classic" : "compact";
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("suitest_ddt_orientation", next);
        } catch {
          // ignore storage security errors
        }
      }
      return next;
    });
  };
  const currentCaseIdRef = React.useRef(testCase.id);

  const carrier = testCase as unknown as {
    dataset_schema?: string[] | null;
    datasetSchema?: string[] | null;
    dataset_rows?: Array<Record<string, unknown>> | null;
    datasetRows?: Array<Record<string, unknown>> | null;
  };
  const rawSchemaSignature = JSON.stringify(carrier.dataset_schema || carrier.datasetSchema || []);
  const rawRowsSignature = JSON.stringify(carrier.dataset_rows || carrier.datasetRows || []);
  // Initialize columns and rows from testCase
  useEffect(() => {
    const isNewCase = currentCaseIdRef.current !== testCase.id;
    currentCaseIdRef.current = testCase.id;

    const rawSchema = (carrier.dataset_schema || carrier.datasetSchema) as string[] | undefined;
    const hasDbSchema = rawSchema != null && Array.isArray(rawSchema);
    const initialCols = hasDbSchema ? rawSchema : Array.from(detectedKeys);
    if (isNewCase) {
      setColumns(initialCols);
    } else if (!hasUnsavedChanges && hasDbSchema) {
      setColumns(rawSchema);
    }
    const rawRows = carrier.dataset_rows || carrier.datasetRows || [];

    if (isNewCase || (!hasUnsavedChanges && rawRows.length > 0) || rows.length === 0) {
      const initialRows: DatasetRow[] = [];
      if (Array.isArray(rawRows) && rawRows.length > 0) {
        const hasExplicitDefault = rawRows.some(
          (x) =>
            Boolean((x as { is_default?: boolean; isDefault?: boolean }).is_default) ||
            Boolean((x as { is_default?: boolean; isDefault?: boolean }).isDefault),
        );
        for (let i = 0; i < rawRows.length; i++) {
          const r = rawRows[i] as {
            id?: string;
            name?: string;
            enabled?: boolean;
            is_default?: boolean;
            isDefault?: boolean;
            values?: Record<string, string>;
          };
          const isRowDef = hasExplicitDefault
            ? Boolean(r.is_default || r.isDefault)
            : i === 0;
          initialRows.push({
            id: r.id || `row-${i + 1}`,
            name: r.name || (i === 0 ? "Default" : `Row ${i + 1}`),
            enabled: r.enabled !== false,
            is_default: isRowDef,
            values: r.values || {},
          });
        }
      } else {
        initialRows.push({
          id: "row-1",
          name: "Default (Single Run)",
          enabled: true,
          is_default: true,
          values: {},
        });
      }
      setRows(initialRows);
      setHasUnsavedChanges(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCase.id, rawSchemaSignature, rawRowsSignature, detectedKeysSignature]);

  const toggleCellReveal = (cellKey: string) => {
    setRevealedCells((prev) => ({ ...prev, [cellKey]: !prev[cellKey] }));
  };

  const handleCellValueChange = (rowId: string, col: string, val: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, values: { ...r.values, [col]: val } }
          : r
      )
    );
    setHasUnsavedChanges(true);
  };

  const handleRowNameChange = (rowId: string, name: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, name } : r))
    );
    setHasUnsavedChanges(true);
  };

  const handleRowToggle = (rowId: string) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === rowId ? { ...r, enabled: !r.enabled } : r));
      // If the default row was disabled, switch default to the first enabled row
      if (next.some((r) => r.id === rowId && !r.enabled && r.is_default)) {
        const firstEnabled = next.find((r) => r.enabled);
        if (firstEnabled) {
          return next.map((r) => ({ ...r, is_default: r.id === firstEnabled.id }));
        }
      }
      return next;
    });
    setHasUnsavedChanges(true);
  };

  const handleSetDefaultRow = (rowId: string) => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        is_default: r.id === rowId,
      }))
    );
    setHasUnsavedChanges(true);
  };

  const handleAddRow = () => {
    const nextIdx = rows.length + 1;
    const newRow: DatasetRow = {
      id: `row-${Date.now()}`,
      name: `Dataset Matrix #${nextIdx}`,
      enabled: true,
      is_default: rows.length === 0,
      values: {},
    };
    setRows((prev) => [...prev, newRow]);
    setHasUnsavedChanges(true);
  };

  const handleDuplicateRow = (row: DatasetRow) => {
    const duplicated: DatasetRow = {
      id: `row-${Date.now()}`,
      name: `${row.name} (Copy)`,
      enabled: true,
      is_default: false,
      values: { ...row.values },
    };
    setRows((prev) => [...prev, duplicated]);
    setHasUnsavedChanges(true);
  };

  const handleDeleteRow = (rowId: string) => {
    if (rows.length <= 1) {
      toast.error("At least one test data row must remain.");
      return;
    }
    setRows((prev) => {
      const filtered = prev.filter((r) => r.id !== rowId);
      const wasDefault = prev.find((r) => r.id === rowId)?.is_default;
      if (wasDefault && filtered.length > 0) {
        const first = filtered[0];
        if (first) {
          filtered[0] = { ...first, is_default: true };
        }
      }
      return filtered;
    });
    setHasUnsavedChanges(true);
  };

  const handleAddColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      toast.error("Variable key may only contain letters, numbers, underscores, and hyphens.");
      return;
    }
    if (columns.includes(trimmed)) {
      toast.error(`Column "${trimmed}" already exists.`);
      return;
    }
    removedColumnsRef.current.delete(trimmed);
    setColumns((prev) => [...prev, trimmed]);
    setNewColumnName("");
    setIsAddingColumn(false);
    setHasUnsavedChanges(true);
  };

  const handleRemoveColumn = (colToRemove: string) => {
    removedColumnsRef.current.add(colToRemove);
    setColumns((prev) => prev.filter((c) => c !== colToRemove));
    setRows((prev) =>
      prev.map((r) => {
        const nextVals = { ...r.values };
        delete nextVals[colToRemove];
        return { ...r, values: nextVals };
      })
    );
    setHasUnsavedChanges(true);
  };

  const handleStartRenameColumn = (col: string) => {
    setEditingColumn(col);
    setRenameValue(col);
  };

  const handleCommitRenameColumn = async (oldName: string) => {
    const trimmed = renameValue.trim();
    setEditingColumn(null);
    if (!trimmed || trimmed === oldName) return;
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      toast.error("Variable key may only contain letters, numbers, underscores, and hyphens.");
      return;
    }
    if (columns.includes(trimmed)) {
      toast.error(`Column "${trimmed}" already exists.`);
      return;
    }
    setColumns((prev) => prev.map((c) => (c === oldName ? trimmed : c)));
    setRows((prev) =>
      prev.map((r) => {
        const nextVals = { ...r.values };
        if (oldName in nextVals) {
          nextVals[trimmed] = nextVals[oldName] ?? "";
          delete nextVals[oldName];
        }
        return { ...r, values: nextVals };
      })
    );
    setHasUnsavedChanges(true);

    // Auto-update steps referencing {{oldName}}
    const oldTag = `{{${oldName}}}`;
    const newTag = `{{${trimmed}}}`;
    const rawSteps = (testCase.steps || []) as Array<{
      action: string;
      expected?: string | null;
      code?: string | null;
      mcp_provider?: string | null;
      mcpProvider?: string | null;
      target_kind?: components["schemas"]["TargetKind"] | null;
      targetKind?: components["schemas"]["TargetKind"] | null;
      order?: number;
    }>;

    let updatedStepCount = 0;
    const updatedSteps = rawSteps.map((st, idx) => {
      let changed = false;
      let newAction = st.action || "";
      let newExpected = st.expected || "";
      let newCode = st.code || null;
      if (newAction.includes(oldTag)) {
        newAction = newAction.replaceAll(oldTag, newTag);
        changed = true;
      }
      if (newExpected.includes(oldTag)) {
        newExpected = newExpected.replaceAll(oldTag, newTag);
        changed = true;
      }
      if (newCode && newCode.includes(oldTag)) {
        newCode = newCode.replaceAll(oldTag, newTag);
        changed = true;
      }

      if (changed) updatedStepCount++;

      return {
        action: newAction,
        expected: newExpected,
        code: newCode,
        mcpProvider: st.mcpProvider || st.mcp_provider || "playwright-mcp",
        targetKind: (st.targetKind || st.target_kind || "FE_WEB") as components["schemas"]["TargetKind"],
        order: st.order ?? idx + 1,
      };
    });

    if (updatedStepCount > 0) {
      try {
        await replaceSteps.mutateAsync({ steps: updatedSteps });
        toast.info(
          `Auto-updated ${updatedStepCount} step(s) referencing {{${oldName}}} to {{${trimmed}}}`
        );
      } catch (err: unknown) {
        console.error("Failed to auto-update steps on variable rename:", err);
      }
    }

    toast.success(`Renamed column "${oldName}" to "${trimmed}"`);
  };

  const handleSave = async () => {
    try {
      await updateTestCase.mutateAsync({
        datasetSchema: columns,
        datasetRows: rows.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          is_default: Boolean(r.is_default),
          isDefault: Boolean(r.is_default),
          values: r.values,
        })),
      });
      setHasUnsavedChanges(false);
      toast.success("Test dataset sheet saved successfully.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save test data sheet.");
    }
  };

  const isSecretKey = (key: string) => {
    const lower = key.toLowerCase();
    return (
      lower.includes("pass") ||
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("apikey") ||
      lower.includes("key")
    );
  };

  return (
    <div className={cn("space-y-4", className)} data-testid="test-case-data-sheet">
      {/* Header toolbar */}
      <div className="bg-card p-3.5 rounded-lg border border-border/60 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                In-Case Test Data Matrix (DDT)
              </h3>
              {rows.length > 1 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  Multi-Role Matrix ({rows.filter((r) => r.enabled).length}/{rows.length} Active)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure test data rows to execute this test case across multiple roles (e.g. Admin vs Manager) or boundary inputs.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleOrientation}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title={
                orientation === "compact"
                  ? "Switch to classic horizontal table"
                  : "Switch to compact transposed matrix"
              }
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>{orientation === "compact" ? "Compact Matrix" : "Classic Table"}</span>
            </Button>

            {canWrite && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddRow}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Scenario
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || updateTestCase.isPending}
                  className={cn(
                    "h-8 gap-1.5 text-xs font-medium transition-all",
                    hasUnsavedChanges && "ring-2 ring-primary/40 shadow-sm"
                  )}
                >
                  {updateTestCase.isPending ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>{hasUnsavedChanges ? "Save Changes" : "Saved"}</span>
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>

        {unmappedDetectedKeys.length > 0 && canWrite && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40 text-xs">
            <div className="flex items-center gap-1.5 text-fg-4 text-[11px] font-medium shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Available from steps:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {unmappedDetectedKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setColumns((prev) => [...prev, k]);
                    setHasUnsavedChanges(true);
                    toast.info(`Added {{${k}}} to test data columns`);
                  }}
                  className="group/pill inline-flex items-center gap-1 rounded-full bg-purple-500/10 hover:bg-purple-500/20 px-2.5 py-0.5 text-[11px] font-mono text-purple-300 border border-purple-500/25 hover:border-purple-500/40 transition-all cursor-pointer shadow-xs"
                  title={`Click to add {{${k}}} column to this dataset`}
                >
                  <Plus className="w-3 h-3 text-purple-400 group-hover/pill:scale-110 transition-transform" />
                  <span>{`{{${k}}}`}</span>
                  <span className="text-[9.5px] text-purple-400/80 font-sans opacity-0 group-hover/pill:opacity-100 transition-opacity">
                    + Add to sheet
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sheet Content */}
      <div className="rounded-lg border border-border/80 bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto max-h-[600px]">
          {orientation === "compact" ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-bg-elev-1 sticky top-0 z-10 border-b border-border shadow-sm text-fg-3 text-[11px] font-medium select-none">
                <tr>
                  <th className="px-3 py-2.5 w-60 border-r border-border/60 bg-bg-elev-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-fg-3 uppercase text-[10px] tracking-wider">
                        Parameters & Variables
                      </span>
                      {canWrite && !isAddingColumn && (
                        <button
                          type="button"
                          onClick={() => setIsAddingColumn(true)}
                          className="text-[10.5px] text-primary hover:underline font-mono inline-flex items-center gap-0.5"
                        >
                          <Plus className="w-3 h-3" />
                          Add Variable
                        </button>
                      )}
                    </div>
                    {isAddingColumn && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <Input
                          placeholder="variable_name"
                          value={newColumnName}
                          onChange={(e) => setNewColumnName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddColumn();
                            if (e.key === "Escape") setIsAddingColumn(false);
                          }}
                          autoFocus
                          className="h-7 w-32 text-xs font-mono px-2 bg-bg-elev-2 border border-primary text-fg-1 rounded focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-accent hover:text-accent/80 hover:bg-accent/10"
                          onClick={handleAddColumn}
                          title="Save variable"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </th>
                  {rows.map((row, idx) => (
                    <th
                      key={row.id}
                      className="px-3.5 py-2.5 min-w-[210px] border-r border-border/60 bg-bg-elev-1"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <Input
                            value={row.name}
                            onChange={(e) => handleRowNameChange(row.id, e.target.value)}
                            disabled={!canWrite}
                            className="h-6 text-xs font-sans font-medium bg-transparent border-transparent hover:border-border focus:border-primary focus:bg-background transition-colors px-1"
                            placeholder={`Scenario #${idx + 1}`}
                          />
                          {canWrite && (
                            <div className="flex items-center gap-0.5 shrink-0 opacity-70 hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => handleDuplicateRow(row)}
                                className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                                title="Duplicate scenario"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              {rows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRow(row.id)}
                                  className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                                  title="Delete scenario"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-fg-4 pt-0.5">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="default-scenario-transposed"
                              checked={Boolean(row.is_default)}
                              onChange={() => canWrite && handleSetDefaultRow(row.id)}
                              disabled={!canWrite || !row.enabled}
                              className="accent-primary cursor-pointer w-3 h-3"
                            />
                            <span
                              className={cn(
                                row.is_default ? "text-primary font-semibold" : "text-fg-4"
                              )}
                            >
                              Default Run
                            </span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={row.enabled}
                              onCheckedChange={() => canWrite && handleRowToggle(row.id)}
                              disabled={!canWrite}
                              className="h-3 w-3"
                            />
                            <span>Active</span>
                          </label>
                        </div>
                      </div>
                    </th>
                  ))}
                  {canWrite && (
                    <th className="px-3 py-2.5 w-36 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleAddRow}
                        className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Scenario
                      </Button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-mono">
                {columns.map((col) => {
                  const isSecret = isSecretKey(col);
                  return (
                    <tr key={col} className="hover:bg-bg-elev-2/30 transition-colors">
                      {/* Variable Row Header */}
                      <td className="px-3 py-2 border-r border-border/60 bg-bg-elev-1/40">
                        {editingColumn === col ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCommitRenameColumn(col);
                                if (e.key === "Escape") {
                                  setRenameValue(col);
                                  setEditingColumn(null);
                                }
                              }}
                              onBlur={() => handleCommitRenameColumn(col)}
                              autoFocus
                              className="h-7 w-32 text-xs font-mono px-2 bg-bg-elev-2 border border-primary text-fg-1 rounded focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-accent hover:text-accent/80 hover:bg-accent/10"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleCommitRenameColumn(col)}
                              title="Save column name"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-1 group">
                            <div className="flex items-center gap-1.5">
                              <VariableBadge variableKey={col} scope="dataset" />
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => handleStartRenameColumn(col)}
                                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-0.5 rounded transition-opacity"
                                  title={`Rename ${col} variable`}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => handleRemoveColumn(col)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 rounded transition-opacity"
                                title={`Remove ${col} column`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Scenario Column Cells */}
                      {rows.map((row) => {
                        const cellId = `${row.id}-${col}`;
                        const isRevealed = Boolean(revealedCells[cellId]);
                        const cellVal = row.values[col] || "";

                        return (
                          <td
                            key={cellId}
                            className={cn(
                              "px-3 py-1.5 border-r border-border/40",
                              !row.enabled && "opacity-50"
                            )}
                          >
                            <div className="relative flex items-center">
                              <Input
                                type={isSecret && !isRevealed ? "password" : "text"}
                                value={cellVal}
                                onChange={(e) =>
                                  handleCellValueChange(row.id, col, e.target.value)
                                }
                                disabled={!canWrite}
                                placeholder="— (optional)"
                                className={cn(
                                  "h-7 text-xs font-mono pr-7 bg-bg-elev-2/30 border border-border/50 hover:border-border focus:border-primary focus:bg-background transition-colors",
                                  !cellVal && "text-fg-4 italic",
                                  isSecret && !isRevealed && "tracking-widest"
                                )}
                              />
                              {isSecret && (
                                <button
                                  type="button"
                                  onClick={() => toggleCellReveal(cellId)}
                                  className="absolute right-2 text-muted-foreground hover:text-foreground"
                                >
                                  {isRevealed ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {canWrite && <td className="px-3 py-2" />}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* Classic horizontal table */
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-bg-elev-1 sticky top-0 z-10 border-b border-border shadow-sm text-fg-3 text-[11px] font-medium select-none">
                <tr>
                  <th className="px-2 py-2.5 w-9 text-center text-fg-4 border-r border-border/60">
                    #
                  </th>
                  <th
                    className="px-2 py-2.5 w-16 text-center border-r border-border/60"
                    title="Primary scenario executed during single test runs"
                  >
                    Default
                  </th>
                  <th
                    className="px-2 py-2.5 w-14 text-center border-r border-border/60"
                    title="Include in multi-scenario Data-Driven Testing runs"
                  >
                    Active
                  </th>
                  <th className="px-3 py-2.5 min-w-[190px] border-r border-border/60">
                    Scenario / Role Name
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 min-w-[210px] border-r border-border/60 bg-bg-elev-1"
                    >
                      {editingColumn === col ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCommitRenameColumn(col);
                              if (e.key === "Escape") {
                                setRenameValue(col);
                                setEditingColumn(null);
                              }
                            }}
                            onBlur={() => handleCommitRenameColumn(col)}
                            autoFocus
                            className="h-7 w-32 text-xs font-mono px-2 bg-bg-elev-2 border border-primary text-fg-1 rounded focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-accent hover:text-accent/80 hover:bg-accent/10"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleCommitRenameColumn(col)}
                            title="Save column name"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-1 group">
                          <div className="flex items-center gap-1.5">
                            <VariableBadge variableKey={col} scope="dataset" />
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => handleStartRenameColumn(col)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-0.5 rounded transition-opacity"
                                title={`Rename ${col} variable`}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => handleRemoveColumn(col)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 rounded transition-opacity"
                              title={`Remove ${col} column`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                  {canWrite && (
                    <th className="px-3 py-2.5 min-w-[160px] border-r border-border/60">
                      {isAddingColumn ? (
                        <div className="flex items-center gap-1">
                          <Input
                            placeholder="variable_name"
                            value={newColumnName}
                            onChange={(e) => setNewColumnName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddColumn();
                              if (e.key === "Escape") setIsAddingColumn(false);
                            }}
                            autoFocus
                            className="h-7 w-32 text-xs font-mono px-2 bg-bg-elev-2 border border-primary text-fg-1 rounded focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-accent hover:text-accent/80 hover:bg-accent/10"
                            onClick={handleAddColumn}
                            title="Save variable column"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsAddingColumn(true)}
                          className="h-6 px-1.5 text-[11px] gap-1 text-primary hover:text-primary"
                        >
                          <Plus className="w-3 h-3" />
                          Add Variable
                        </Button>
                      )}
                    </th>
                  )}
                  {canWrite && <th className="px-3 py-2.5 w-24 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-mono">
                {rows.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "hover:bg-bg-elev-2/40 transition-colors group",
                      !row.enabled && "opacity-50 bg-muted/10",
                      row.is_default && "bg-primary/[0.02]"
                    )}
                  >
                    {/* Row Number */}
                    <td className="px-2 py-2 text-center text-[10.5px] font-mono text-fg-4 border-r border-border/40 select-none">
                      {idx + 1}
                    </td>

                    {/* Default Scenario Radio */}
                    <td className="px-2 py-2 text-center border-r border-border/40">
                      <input
                        type="radio"
                        name="default-scenario-row"
                        checked={Boolean(row.is_default)}
                        onChange={() => canWrite && handleSetDefaultRow(row.id)}
                        disabled={!canWrite || !row.enabled}
                        title={
                          row.enabled
                            ? "Set as default scenario for single run"
                            : "Disabled scenario cannot be default"
                        }
                        className="accent-primary cursor-pointer w-3.5 h-3.5"
                      />
                    </td>

                    {/* Active / Enable Checkbox */}
                    <td className="px-2 py-2 text-center border-r border-border/40">
                      <Checkbox
                        checked={row.enabled}
                        onCheckedChange={() => canWrite && handleRowToggle(row.id)}
                        disabled={!canWrite}
                        title={row.enabled ? "Active in test runs" : "Excluded from runs"}
                      />
                    </td>

                    {/* Row Name */}
                    <td className="px-3 py-2 border-r border-border/40">
                      <Input
                        value={row.name}
                        onChange={(e) => handleRowNameChange(row.id, e.target.value)}
                        disabled={!canWrite}
                        className="h-7 text-xs font-sans font-medium bg-transparent border-transparent hover:border-border focus:border-primary focus:bg-background transition-colors"
                        placeholder="e.g. Admin User"
                      />
                    </td>

                    {/* Variable Column Inputs */}
                    {columns.map((col) => {
                      const isSecret = isSecretKey(col);
                      const cellId = `${row.id}-${col}`;
                      const isRevealed = Boolean(revealedCells[cellId]);
                      const cellVal = row.values[col] || "";

                      return (
                        <td key={col} className="px-3 py-1.5 border-r border-border/40">
                          <div className="relative flex items-center">
                            <Input
                              type={isSecret && !isRevealed ? "password" : "text"}
                              value={cellVal}
                              onChange={(e) =>
                                handleCellValueChange(row.id, col, e.target.value)
                              }
                              disabled={!canWrite}
                              placeholder={`{{${col}}}`}
                              className={cn(
                                "h-7 text-xs font-mono pr-7 bg-bg-elev-2/30 border border-border/50 hover:border-border focus:border-primary focus:bg-background transition-colors",
                                isSecret && !isRevealed && "tracking-widest"
                              )}
                            />
                            {isSecret && (
                              <button
                                type="button"
                                onClick={() => toggleCellReveal(cellId)}
                                className="absolute right-2 text-muted-foreground hover:text-foreground"
                              >
                                {isRevealed ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    {canWrite && <td className="px-3 py-2" />}

                    {/* Row Actions */}
                    {canWrite && (
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-6 w-6",
                              row.is_default
                                ? "text-amber-400 hover:text-amber-300"
                                : "text-muted-foreground hover:text-amber-400"
                            )}
                            onClick={() => handleSetDefaultRow(row.id)}
                            title="Set as default run scenario"
                            disabled={!row.enabled}
                          >
                            <Star
                              className={cn(
                                "w-3.5 h-3.5",
                                row.is_default && "fill-amber-400 text-amber-400"
                              )}
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => handleDuplicateRow(row)}
                            title="Duplicate scenario"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {rows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteRow(row.id)}
                              title="Delete scenario"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {columns.length === 0 && (
        <div className="p-4 rounded-lg bg-secondary/30 border border-border flex items-start gap-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-foreground">Tip: Reference variables in steps</span>
            <p className="mt-0.5">
              Type <code className="text-primary font-mono">{`{{username}}`}</code> or{" "}
              <code className="text-primary font-mono">{`{{password}}`}</code> in any step action or code input.
              Suitest will automatically detect them and add them as columns to this data sheet!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

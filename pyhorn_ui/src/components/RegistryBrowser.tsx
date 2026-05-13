import { useState, useEffect, useRef } from "react";

interface RegistryEntry {
  name: string;
  kind: "driver" | "project";
  description: string;
  tags: string[];
  created: string;
  modified: string;
}

interface RegistryBrowserProps {
  driverYaml: string;
  hornYaml: string;
  onLoadDriver: (yaml: string) => void;
  onLoadHorn: (yaml: string) => void;
}

function SaveDialog({
  kind,
  onSave,
  onClose,
}: {
  kind: "driver" | "project";
  onSave: (name: string, description: string, tags: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  const commit = () => {
    if (!name.trim()) return;
    onSave(name.trim(), description.trim(), tags);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "var(--bg2)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "20px 24px",
          width: "320px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "14px", color: "var(--accent)" }}>
          Save to Registry — {kind === "driver" ? "Driver" : "Project"}
        </div>

        <label style={{ display: "block", fontSize: "11px", color: "var(--text2)", marginBottom: "4px" }}>
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onClose(); }}
          placeholder={kind === "driver" ? "e.g. Fostex FE166NV2" : "e.g. BK16 1m scale"}
          autoFocus
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text)",
            padding: "7px 10px",
            fontSize: "12px",
            marginBottom: "10px",
            outline: "none",
          }}
        />

        <label style={{ display: "block", fontSize: "11px", color: "var(--text2)", marginBottom: "4px" }}>
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short note or tag line"
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text)",
            padding: "7px 10px",
            fontSize: "12px",
            marginBottom: "10px",
            outline: "none",
          }}
        />

        <label style={{ display: "block", fontSize: "11px", color: "var(--text2)", marginBottom: "4px" }}>
          Tags (optional)
        </label>
        <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); }}}
            placeholder="Add tag…"
            style={{
              flex: 1,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text)",
              padding: "5px 8px",
              fontSize: "11px",
              outline: "none",
            }}
          />
          <button
            onClick={addTag}
            style={{
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text2)",
              padding: "5px 10px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
            {tags.map((t) => (
              <span
                key={t}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  padding: "2px 7px",
                  fontSize: "10px",
                  color: "var(--text2)",
                }}
              >
                {t}
                <button
                  onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  style={{ background: "none", border: "none", color: "var(--text2)", cursor: "pointer", padding: "0", fontSize: "10px", lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text2)",
              padding: "7px 14px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={!name.trim()}
            style={{
              background: name.trim() ? "var(--accent)" : "var(--bg3)",
              border: "none",
              borderRadius: "6px",
              color: name.trim() ? "#000" : "var(--text2)",
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: name.trim() ? "pointer" : "not-allowed",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RegistryBrowser({
  driverYaml,
  hornYaml,
  onLoadDriver,
  onLoadHorn,
}: RegistryBrowserProps) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "driver" | "project">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saveDialog, setSaveDialog] = useState<"driver" | "project" | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const kind = filter === "all" ? "" : filter;
      const url = kind
        ? `http://localhost:8765/registry/?kind=${kind}`
        : "http://localhost:8765/registry/";
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data: RegistryEntry[] = await res.json();
      setEntries(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load registry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) fetchEntries();
  }, [expanded, filter]);

  const loadEntry = async (name: string, kind: "driver" | "project") => {
    try {
      const res = await fetch(`http://localhost:8765/registry/${name}/file`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (kind === "driver") {
        onLoadDriver(data.yaml);
      } else {
        onLoadHorn(data.yaml);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to load");
    }
  };

  const deleteEntry = async (name: string, deleteFile: boolean) => {
    if (!confirm(`Remove '${name}' from registry${deleteFile ? " (delete file)" : ""}?`)) return;
    try {
      const res = await fetch(`http://localhost:8765/registry/${name}?delete_file=${deleteFile}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      fetchEntries();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleSave = async (name: string, description: string, tags: string[]) => {
    try {
      const yamlContent = saveDialog === "driver" ? driverYaml : hornYaml;
      const res = await fetch("http://localhost:8765/registry/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          kind: saveDialog,
          yaml_content: yamlContent,
          description,
          tags,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setSaveDialog(null);
      fetchEntries();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save to registry");
    }
  };

  return (
    <>
      {saveDialog && (
        <SaveDialog
          kind={saveDialog}
          onSave={handleSave}
          onClose={() => setSaveDialog(null)}
        />
      )}
      <details
        className="panel yaml-panel"
        open={expanded}
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="yaml-summary">
          <span>📦 Registry ({entries.length})</span>
          <span className="yaml-summary-badge">{expanded ? "↑ collapse" : "↓ expand"}</span>
        </summary>
        <div className="yaml-body" style={{ marginTop: "10px" }}>
          {error && (
            <div style={{ color: "var(--red)", fontSize: "11px", marginBottom: "6px" }}>
              ⚠ {error}
            </div>
          )}

          {/* Save buttons */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <button
              onClick={() => setSaveDialog("driver")}
              title="Save current driver to registry"
              style={{
                flex: 1,
                background: "rgba(0, 212, 255, 0.08)",
                border: "1px solid var(--accent)",
                borderRadius: "6px",
                color: "var(--accent)",
                padding: "5px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              💾 Save Driver
            </button>
            <button
              onClick={() => setSaveDialog("project")}
              title="Save current horn/project to registry"
              style={{
                flex: 1,
                background: "rgba(168, 85, 247, 0.08)",
                border: "1px solid var(--purple)",
                borderRadius: "6px",
                color: "var(--purple)",
                padding: "5px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              💾 Save Horn
            </button>
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            {(["all", "driver", "project"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  flex: 1,
                  background: filter === f ? "var(--accent)" : "transparent",
                  color: filter === f ? "#000" : "var(--text2)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: filter === f ? "600" : "400",
                }}
              >
                {f === "all" ? "All" : f === "driver" ? "Drivers" : "Projects"}
              </button>
            ))}
            <button
              onClick={fetchEntries}
              title="Refresh"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text2)",
                padding: "4px 8px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              ↺
            </button>
          </div>

          {loading ? (
            <div style={{ color: "var(--text2)", fontSize: "12px" }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ color: "var(--text2)", fontSize: "12px" }}>No entries</div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                maxHeight: "240px",
                overflowY: "auto",
              }}
            >
              {entries.map((e) => (
                <div
                  key={e.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 8px",
                    background: "var(--bg3)",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "3px",
                      background: e.kind === "driver" ? "#1a4d2e" : "#1a2d4d",
                      color: e.kind === "driver" ? "#4ade80" : "#60a5fa",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {e.kind === "driver" ? "DRV" : "PRJ"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.name}
                    </div>
                    {e.description && (
                      <div
                        style={{
                          fontSize: "10px",
                          color: "var(--text2)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.description}
                      </div>
                    )}
                    {e.tags.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: "3px",
                          flexWrap: "nowrap",
                          overflow: "hidden",
                        }}
                      >
                        {e.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: "9px",
                              padding: "0 4px",
                              borderRadius: "2px",
                              background: "var(--bg)",
                              color: "var(--text2)",
                              border: "1px solid var(--border)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                        {e.tags.length > 3 && (
                          <span style={{ fontSize: "9px", color: "var(--text2)" }}>
                            +{e.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                    <button
                      onClick={() => loadEntry(e.name, e.kind)}
                      title="Load into app"
                      style={{
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: "4px",
                        color: "#000",
                        padding: "3px 7px",
                        fontSize: "10px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteEntry(e.name, false)}
                      title="Remove from registry"
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        color: "var(--text2)",
                        padding: "3px 6px",
                        fontSize: "10px",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </>
  );
}

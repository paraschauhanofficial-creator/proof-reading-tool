"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import Navbar from "@/components/Navbar";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [manuscripts, setManuscripts] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [incomingDate, setIncomingDate] = useState("");
  const [notes, setNotes] = useState("");
  const [wordCount, setWordCount] = useState<string>("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/auth/login");
      else setUser(user);
    };
    getUser();
    fetchManuscripts();
  }, []);

  const fetchManuscripts = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setManuscripts(data);
  };

  const handleFilePicked = async (file: File) => {
  if (!file.name.endsWith(".docx")) {
    alert("Please upload a .docx file");
    return;
  }
  setWordCount("");
  setIncomingDate("");
  setDeliveryDate("");
  setNotes("");
  setPendingFile(file);
  setShowModal(true);
};

  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setShowModal(false);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const sanitizedName = pendingFile.name
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[()]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    const filePath = `${user.id}/${Date.now()}_${sanitizedName || "manuscript.docx"}`;

    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(filePath, pendingFile);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: manuscript } = await supabase
      .from("manuscripts")
      .insert({
        user_id: user.id,
        title: pendingFile.name.replace(".docx", ""),
        original_file_url: filePath,
        status: "pending",
        delivery_date: deliveryDate || null,
        incoming_date: incomingDate || null,
        word_count: parseInt(wordCount) || 0,
        notes: notes || null,
      })
      .select()
      .single();

    setUploading(false);
    setPendingFile(null);
    setDeliveryDate("");
    setIncomingDate("");
    setNotes("");
    setWordCount("");
    fetchManuscripts();
    if (manuscript) router.push(`/manuscript/${manuscript.id}`);
  };

  const handleDelete = async (id: string, fileUrl: string) => {
    try {
      console.log("Deleting file path:", fileUrl);

      const { error: storageError } = await supabase.storage
        .from("manuscripts")
        .remove([fileUrl]);

      if (storageError) console.error("Storage error:", storageError.message);

      const { error: dbError } = await supabase
        .from("manuscripts")
        .delete()
        .eq("id", id);

      if (dbError) {
        alert("Delete failed: " + dbError.message);
        return;
      }

      sessionStorage.removeItem(`result_${id}`);
      sessionStorage.removeItem(`text_${id}`);
      setDeleteConfirm(null);
      setManuscripts((prev) => prev.filter((m) => m.id !== id));
    } catch (error: any) {
      alert("Delete failed: " + error.message);
    }
  };

  const statusConfig: any = {
    pending: { label: "Pending", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
    processing: { label: "Editing", color: "var(--accent)", bg: "var(--accent-light)", border: "var(--accent-border)" },
    rechecking: { label: "Rechecking", color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.2)" },
    completed: { label: "Completed", color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.2)" },
    error: { label: "Error", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.2)" },
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      {/* Upload Details Modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "16px", padding: "28px", width: "100%", maxWidth: "440px",
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              Document details
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "24px" }}>
              {pendingFile?.name}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>

              {/* Word count */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Word count
                </label>
                <input
                  type="number"
                  value={wordCount}
                  onChange={(e) => setWordCount(e.target.value)}
                  placeholder="Auto-detected — edit if needed"
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "13px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              {/* Incoming date */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Incoming date
                </label>
                <input
                  type="date"
                  value={incomingDate}
                  onChange={(e) => setIncomingDate(e.target.value)}
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "13px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              {/* Delivery date */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Delivery date
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "13px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Target journal, special instructions..."
                  rows={3}
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "13px",
                    color: "var(--text-primary)", outline: "none",
                    resize: "none", fontFamily: "inherit",
                  }}
                />
              </div>

            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => { setShowModal(false); setPendingFile(null); }}
                style={{
                  flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                  borderRadius: "8px", border: "1px solid var(--border)",
                  backgroundColor: "var(--bg)", color: "var(--text-secondary)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                style={{
                  flex: 2, fontSize: "13px", fontWeight: 500, padding: "10px",
                  borderRadius: "8px", border: "none",
                  backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer",
                }}
              >
                Upload and start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "16px", padding: "28px", width: "100%", maxWidth: "380px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
              Delete this document?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>
              This will permanently delete the document and all associated data. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                  borderRadius: "8px", border: "1px solid var(--border)",
                  backgroundColor: "var(--bg)", color: "var(--text-secondary)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const m = manuscripts.find(m => m.id === deleteConfirm);
                  if (m) handleDelete(m.id, m.original_file_url);
                }}
                style={{
                  flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                  borderRadius: "8px", border: "none",
                  backgroundColor: "#ef4444", color: "#fff", cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
            Dashboard
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{user?.email}</p>
        </div>

        {/* Upload Area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFilePicked(file);
          }}
          style={{
            border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "16px", padding: "48px 24px", textAlign: "center",
            backgroundColor: dragOver ? "var(--accent-light)" : "var(--bg-card)",
            transition: "all 0.2s ease", marginBottom: "40px",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>📄</div>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
            Upload your document
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>
            Drag and drop a .docx file or click to browse
          </p>
          <label style={{ cursor: "pointer" }}>
            <span style={{
              backgroundColor: uploading ? "var(--border)" : "var(--accent)",
              color: "#fff", fontSize: "13px", fontWeight: 500,
              padding: "10px 22px", borderRadius: "8px", display: "inline-block",
            }}>
              {uploading ? "Uploading..." : "Choose file"}
            </span>
            <input
              type="file" accept=".docx" style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFilePicked(file);
              }}
            />
          </label>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "12px" }}>
            Supports .docx files only
          </p>
        </div>

        {/* Manuscripts List */}
        {manuscripts.length > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Your documents
              </h2>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {manuscripts.length} document{manuscripts.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {manuscripts.map((m) => {
                const s = statusConfig[m.status] || statusConfig.pending;
                return (
                  <div key={m.id} style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
                    borderRadius: "12px", padding: "14px 18px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: "12px",
                  }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    {/* Left — clickable */}
                    <div
                      onClick={() => router.push(`/manuscript/${m.id}`)}
                      style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0, cursor: "pointer" }}
                    >
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "8px",
                        backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", flexShrink: 0,
                      }}>📄</div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          fontSize: "13px", fontWeight: 500, color: "var(--text-primary)",
                          marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{m.title}</p>
                        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                          {m.incoming_date && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              In: {new Date(m.incoming_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          )}
                          {m.delivery_date && (
                            <span style={{ fontSize: "11px", color: "#f59e0b" }}>
                              Due: {new Date(m.delivery_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          )}
                          {m.word_count > 0 && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {m.word_count.toLocaleString()} words
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right — status + delete */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <span style={{
                        fontSize: "11px", fontWeight: 500, padding: "3px 10px",
                        borderRadius: "20px", backgroundColor: s.bg,
                        color: s.color, border: `1px solid ${s.border}`,
                      }}>{s.label}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(m.id); }}
                        style={{
                          background: "transparent", border: "1px solid var(--border)",
                          borderRadius: "6px", padding: "4px 8px", cursor: "pointer",
                          fontSize: "14px", color: "var(--text-muted)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#ef4444"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                        title="Delete document"
                      >
                        🗑
                      </button>
                      <span
                        onClick={() => router.push(`/manuscript/${m.id}`)}
                        style={{ fontSize: "16px", color: "var(--text-muted)", cursor: "pointer" }}
                      >→</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {manuscripts.length === 0 && !uploading && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "13px" }}>No documents yet. Upload your first document above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
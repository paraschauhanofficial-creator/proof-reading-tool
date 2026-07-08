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

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith(".docx")) {
      alert("Please upload a .docx file");
      return;
    }
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const sanitizedName = file.name
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[()]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    const filePath = `${user.id}/${Date.now()}_${sanitizedName || "manuscript.docx"}`;

    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(filePath, file);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: manuscript } = await supabase
      .from("manuscripts")
      .insert({
        user_id: user.id,
        title: file.name.replace(".docx", ""),
        original_file_url: filePath,
        status: "pending",
      })
      .select()
      .single();

    setUploading(false);
    fetchManuscripts();
    if (manuscript) router.push(`/manuscript/${manuscript.id}`);
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

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
            Dashboard
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {user?.email}
          </p>
        </div>

        {/* Upload Area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFileUpload(file);
          }}
          style={{
            border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "16px",
            padding: "48px 24px",
            textAlign: "center",
            backgroundColor: dragOver ? "var(--accent-light)" : "var(--bg-card)",
            transition: "all 0.2s ease",
            marginBottom: "40px",
            cursor: "pointer",
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
              transition: "background 0.2s",
            }}>
              {uploading ? "Uploading..." : "Choose file"}
            </span>
            <input
              type="file"
              accept=".docx"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
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
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: "16px",
            }}>
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
                  <div
                    key={m.id}
                    onClick={() => router.push(`/manuscript/${m.id}`)}
                    style={{
                      backgroundColor: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "14px 18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                      gap: "12px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "8px",
                        backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", flexShrink: 0,
                      }}>
                        📄
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          fontSize: "13px", fontWeight: 500, color: "var(--text-primary)",
                          marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {m.title}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {new Date(m.created_at).toLocaleDateString("en-GB", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      <span style={{
                        fontSize: "11px", fontWeight: 500, padding: "3px 10px",
                        borderRadius: "20px", backgroundColor: s.bg,
                        color: s.color, border: `1px solid ${s.border}`,
                      }}>
                        {s.label}
                      </span>
                      <span style={{ fontSize: "16px", color: "var(--text-muted)" }}>→</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {manuscripts.length === 0 && !uploading && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "13px" }}>No documents yet. Upload your first document above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
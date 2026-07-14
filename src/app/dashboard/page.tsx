"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import Navbar from "@/components/Navbar";

const DEFAULT_RATE = 570;

function getMonthName(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function calcPayout(words: number, rate: number) {
  return ((words / 1000) * rate).toFixed(2);
}

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
  const [rate, setRate] = useState<number>(DEFAULT_RATE);
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState<string>(DEFAULT_RATE.toString());
  const [showCalculator, setShowCalculator] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/auth/login");
      else setUser(user);
    };
    getUser();
    fetchManuscripts();
    const savedRate = localStorage.getItem("aipr_rate");
    if (savedRate) { setRate(parseFloat(savedRate)); setRateInput(savedRate); }
  }, []);

  const fetchManuscripts = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setManuscripts(data);
  };

  const handleFilePicked = async (file: File) => {
    if (!file.name.endsWith(".docx")) { alert("Please upload a .docx file"); return; }
    setWordCount(""); setIncomingDate(""); setDeliveryDate(""); setNotes("");
    setPendingFile(file); setShowModal(true);
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploading(true); setShowModal(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Storage key must be ASCII-safe (Supabase rejects Chinese/special chars in keys)
    const asciiSafeName = pendingFile.name
      .replace(/[^\x00-\x7F]/g, "")        // remove non-ASCII (Chinese)
      .replace(/[（）()]/g, "")             // remove full-width and normal parens
      .replace(/[：:]/g, "")                // remove colons
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const safeFileName = asciiSafeName || "manuscript.docx";
    const filePath = `${user.id}/${Date.now()}_${safeFileName}`;

    const { error: uploadError } = await supabase.storage.from("manuscripts").upload(filePath, pendingFile);
    if (uploadError) { alert("Upload failed: " + uploadError.message); setUploading(false); return; }

    const { data: manuscript } = await supabase.from("manuscripts").insert({
      user_id: user.id,
      title: pendingFile.name.replace(".docx", ""),
      original_file_url: filePath,
      status: "pending",
      delivery_date: deliveryDate || null,
      incoming_date: incomingDate || null,
      word_count: parseInt(wordCount) || 0,
      notes: notes || null,
    }).select().single();

    setUploading(false); setPendingFile(null);
    setDeliveryDate(""); setIncomingDate(""); setNotes(""); setWordCount("");
    fetchManuscripts();
    if (manuscript) router.push(`/manuscript-v2/${manuscript.id}`);
  };

  const handleDelete = async (id: string, fileUrl: string) => {
    try {
      await supabase.storage.from("manuscripts").remove([fileUrl]);
      const { error: dbError } = await supabase.from("manuscripts").delete().eq("id", id);
      if (dbError) { alert("Delete failed: " + dbError.message); return; }
      sessionStorage.removeItem(`result_${id}`);
      sessionStorage.removeItem(`text_${id}`);
      setDeleteConfirm(null);
      setManuscripts((prev) => prev.filter((m) => m.id !== id));
    } catch (error: any) { alert("Delete failed: " + error.message); }
  };

  const saveRate = () => {
    const val = parseFloat(rateInput);
    if (!isNaN(val) && val > 0) { setRate(val); localStorage.setItem("aipr_rate", val.toString()); }
    setEditingRate(false);
  };

  const getMonthlyData = () => {
    const months: Record<string, { words: number; docs: number }> = {};
    manuscripts.forEach((m) => {
      if (!m.delivery_date || !m.word_count) return;
      const d = new Date(m.delivery_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!months[key]) months[key] = { words: 0, docs: 0 };
      months[key].words += m.word_count;
      months[key].docs += 1;
    });
    return months;
  };

  const monthlyData = getMonthlyData();
  const monthsToShow = [-1, 0].map((offset) => {
    let month = currentMonth + offset;
    let year = currentYear;
    if (month < 0) { month += 12; year -= 1; }
    const key = `${year}-${month}`;
    const data = monthlyData[key] || { words: 0, docs: 0 };
    const isCurrent = month === currentMonth && year === currentYear;
    return { month, year, key, data, isCurrent };
  });

  const statusConfig: any = {
    pending: { label: "Pending", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
    processing: { label: "Editing", color: "var(--accent)", bg: "var(--accent-light)", border: "var(--accent-border)" },
    rechecking: { label: "Editing", color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.2)" },
    completed: { label: "Completed", color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.2)" },
    error: { label: "Error", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.2)" },
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", backgroundColor: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: "8px", padding: "10px 14px", fontSize: "13px",
    color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      {/* Upload Modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: "16px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "16px", padding: "clamp(20px, 4vw, 28px)",
            width: "100%", maxWidth: "440px", maxHeight: "90vh", overflowY: "auto",
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              Document details
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px", wordBreak: "break-word" }}>
              {pendingFile?.name}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  English word count
                </label>
                <input type="number" value={wordCount} onChange={(e) => setWordCount(e.target.value)}
                  placeholder="Enter word count" style={inputStyle} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                    Receiving date
                  </label>
                  <input type="date" value={incomingDate} onChange={(e) => setIncomingDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                    Delivery date
                  </label>
                  <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Remarks / Contents / Project
                </label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 7-10 booked trans 4 docs - Doc 3" rows={3}
                  style={{ ...inputStyle, resize: "none", fontFamily: "inherit" }} />
              </div>

              {wordCount && (
                <div style={{
                  backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                  borderRadius: "8px", padding: "10px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Estimated payout</span>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--accent)" }}>
                    ₹{calcPayout(parseInt(wordCount) || 0, rate)}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setShowModal(false); setPendingFile(null); }} style={{
                flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                borderRadius: "8px", border: "1px solid var(--border)",
                backgroundColor: "var(--bg)", color: "var(--text-secondary)", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleUpload} style={{
                flex: 2, fontSize: "13px", fontWeight: 500, padding: "10px",
                borderRadius: "8px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer",
              }}>Upload and start</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: "16px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "16px", padding: "clamp(20px, 4vw, 28px)",
            width: "100%", maxWidth: "380px", textAlign: "center",
          }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
              Delete this document?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>
              This will permanently delete the document and all associated data.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                borderRadius: "8px", border: "1px solid var(--border)",
                backgroundColor: "var(--bg)", color: "var(--text-secondary)", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={() => {
                const m = manuscripts.find(m => m.id === deleteConfirm);
                if (m) handleDelete(m.id, m.original_file_url);
              }} style={{
                flex: 1, fontSize: "13px", fontWeight: 500, padding: "10px",
                borderRadius: "8px", border: "none",
                backgroundColor: "#ef4444", color: "#fff", cursor: "pointer",
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "clamp(20px, 5vw, 40px) clamp(16px, 4vw, 24px)" }}>

        {/* Header */}
        <div style={{ marginBottom: "clamp(20px, 4vw, 32px)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "clamp(18px, 3vw, 22px)", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              Dashboard
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</p>
          </div>
          <button
            onClick={() => setShowCalculator(!showCalculator)}
            className="aipr-calc-toggle"
            style={{
              display: "none", fontSize: "12px", fontWeight: 500,
              padding: "8px 14px", borderRadius: "8px",
              border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
              color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0,
            }}
          >
            {showCalculator ? "Hide earnings" : "💰 Earnings"}
          </button>
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start" }} className="aipr-dashboard-grid">

          {/* LEFT — Upload + Documents */}
          <div style={{ minWidth: 0 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFilePicked(file);
              }}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "16px", padding: "clamp(24px, 4vw, 36px) 24px",
                textAlign: "center", backgroundColor: dragOver ? "var(--accent-light)" : "var(--bg-card)",
                transition: "all 0.2s ease", marginBottom: "clamp(20px, 4vw, 32px)",
              }}
            >
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>📄</div>
              <h2 style={{ fontSize: "clamp(14px, 2vw, 15px)", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
                Upload your document
              </h2>
              <p style={{ fontSize: "clamp(12px, 1.5vw, 13px)", color: "var(--text-muted)", marginBottom: "16px" }}>
                Drag and drop a .docx file or click to browse
              </p>
              <label style={{ cursor: "pointer" }}>
                <span style={{
                  backgroundColor: uploading ? "var(--border)" : "var(--accent)",
                  color: "#fff", fontSize: "13px", fontWeight: 500,
                  padding: "9px 20px", borderRadius: "8px", display: "inline-block",
                }}>
                  {uploading ? "Uploading..." : "Choose file"}
                </span>
                <input type="file" accept=".docx" style={{ display: "none" }}
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFilePicked(file); }} />
              </label>
            </div>

            {manuscripts.length > 0 ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <h2 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Your documents</h2>
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
                        borderRadius: "12px", padding: "clamp(10px, 2vw, 12px) clamp(12px, 2vw, 16px)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: "10px", transition: "border-color 0.2s ease",
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                      >
                        <div
                          onClick={() => router.push(`/manuscript-v2/${m.id}`)}
                          style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0, cursor: "pointer" }}
                        >
                          <div style={{
                            width: "32px", height: "32px", borderRadius: "8px",
                            backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "16px", flexShrink: 0,
                          }}>📄</div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{
                              fontSize: "clamp(12px, 1.5vw, 13px)", fontWeight: 500,
                              color: "var(--text-primary)", marginBottom: "3px",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{m.title}</p>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              {m.incoming_date && (
                                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                  In: {new Date(m.incoming_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                </span>
                              )}
                              {m.delivery_date && (
                                <span style={{ fontSize: "11px", color: "#f59e0b" }}>
                                  Due: {new Date(m.delivery_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                </span>
                              )}
                              {m.word_count > 0 && (
                                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                  {m.word_count.toLocaleString()} words
                                </span>
                              )}
                              {m.word_count > 0 && (
                                <span style={{ fontSize: "11px", color: "#4ade80" }}>
                                  ₹{calcPayout(m.word_count, rate)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                          <span style={{
                            fontSize: "11px", fontWeight: 500, padding: "3px 8px", borderRadius: "20px",
                            backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap",
                          }}>{s.label}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(m.id); }}
                            style={{
                              background: "transparent", border: "1px solid var(--border)",
                              borderRadius: "6px", padding: "4px 7px", cursor: "pointer",
                              fontSize: "13px", color: "var(--text-muted)", transition: "all 0.2s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#ef4444"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                          >🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              !uploading && (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  <p style={{ fontSize: "13px" }}>No documents yet. Upload your first document above.</p>
                </div>
              )
            )}
          </div>

          {/* RIGHT — Calculator */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} className={`aipr-calculator ${showCalculator ? "visible" : ""}`}>
            <div style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px" }}>Current rate</p>
                <button onClick={() => setEditingRate(!editingRate)} style={{
                  background: "transparent", border: "1px solid var(--border)", borderRadius: "6px",
                  padding: "2px 8px", cursor: "pointer", fontSize: "11px", color: "var(--text-muted)",
                }}>{editingRate ? "Cancel" : "✏️ Edit"}</button>
              </div>
              {editingRate ? (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>₹</span>
                  <input type="number" value={rateInput} onChange={(e) => setRateInput(e.target.value)} style={{
                    flex: 1, minWidth: "70px", backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: "6px", padding: "6px 10px", fontSize: "13px", color: "var(--text-primary)", outline: "none",
                  }} />
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>/ 1K</span>
                  <button onClick={saveRate} style={{
                    backgroundColor: "var(--accent)", color: "#fff", border: "none",
                    borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "12px",
                  }}>Save</button>
                </div>
              ) : (
                <p style={{ fontSize: "clamp(18px, 3vw, 22px)", fontWeight: 700, color: "var(--text-primary)" }}>
                  ₹{rate} <span style={{ fontSize: "12px", fontWeight: 400, color: "var(--text-muted)" }}>per 1,000 words</span>
                </p>
              )}
            </div>

            <div style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px" }}>
              <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "14px" }}>Monthly earnings</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {monthsToShow.map(({ month, year, data, isCurrent }) => (
                  <div key={`${year}-${month}`} style={{
                    backgroundColor: isCurrent ? "var(--accent-light)" : "var(--bg)",
                    border: `1px solid ${isCurrent ? "var(--accent-border)" : "var(--border)"}`,
                    borderRadius: "10px", padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: "12px", fontWeight: 500, color: isCurrent ? "var(--accent)" : "var(--text-secondary)", marginBottom: "2px" }}>
                          {getMonthName(year, month)} {isCurrent && <span style={{ fontSize: "10px" }}>— till date</span>}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {data.docs} doc{data.docs !== 1 ? "s" : ""} · {data.words.toLocaleString()} words
                        </p>
                      </div>
                      <p style={{ fontSize: "clamp(16px, 2.5vw, 18px)", fontWeight: 700, color: isCurrent ? "var(--accent)" : "var(--text-primary)", flexShrink: 0 }}>
                        ₹{calcPayout(data.words, rate)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "12px", borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Total (2 months)</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                  ₹{monthsToShow.reduce((sum, { data }) => sum + (data.words / 1000) * rate, 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .aipr-dashboard-grid { grid-template-columns: 1fr !important; }
          .aipr-calculator { display: none !important; }
          .aipr-calculator.visible { display: flex !important; }
          .aipr-calc-toggle { display: block !important; }
        }
      `}</style>
    </div>
  );
}
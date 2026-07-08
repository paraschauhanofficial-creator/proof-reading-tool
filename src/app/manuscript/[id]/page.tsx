"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import Navbar from "@/components/Navbar";

const EDITING_TAGS = [
  "Grammar", "APA Guidelines", "Journal Style", "Medical Writing",
  "Academic English", "Consistency", "Terminology", "Person-First Language",
  "Gene Italics", "Abbreviations", "Punctuation", "Tense",
];

const WORKFLOW_STAGES = [
  { key: "uploaded", label: "Uploaded" },
  { key: "analysed", label: "Analysed" },
  { key: "editing", label: "Editing" },
  { key: "rechecking", label: "Rechecking" },
  { key: "completed", label: "Completed" },
];

function getStageIndex(status: string) {
  if (status === "pending") return 1;
  if (status === "processing") return 2;
  if (status === "completed") return 4;
  if (status === "error") return 1;
  return 0;
}

export default function ManuscriptPage() {
  const [manuscript, setManuscript] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [tagVisible, setTagVisible] = useState(true);
  const [showCompare, setShowCompare] = useState(false);
  const [sentences, setSentences] = useState<any[]>([]);
  const [currentSentence, setCurrentSentence] = useState(0);
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const tagInterval = useRef<any>(null);
  const sentenceInterval = useRef<any>(null);

  useEffect(() => {
    fetchManuscript();
  }, []);

  useEffect(() => {
    if (manuscript?.status === "processing") {
      startTagCycle();
      startSentenceCycle();
    }
    return () => {
      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);
    };
  }, [manuscript?.status]);

  const startTagCycle = () => {
    tagInterval.current = setInterval(() => {
      setTagVisible(false);
      setTimeout(() => {
        setCurrentTag((prev) => (prev + 1) % EDITING_TAGS.length);
        setTagVisible(true);
      }, 400);
    }, 2000);
  };

  const startSentenceCycle = () => {
    sentenceInterval.current = setInterval(() => {
      setCurrentSentence((prev) => prev + 1);
    }, 3000);
  };

  const fetchManuscript = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .eq("id", params.id)
      .single();
    if (data) {
      setManuscript(data);
      if (data.edit_summary?.sentences) {
        setSentences(data.edit_summary.sentences);
      }
    }
    setLoading(false);
  };

  const handleProofread = async () => {
    setProcessing(true);
    await supabase.from("manuscripts").update({ status: "processing" }).eq("id", params.id);
    setManuscript((prev: any) => ({ ...prev, status: "processing" }));
    startTagCycle();
    startSentenceCycle();

    try {
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(manuscript.original_file_url);
      if (!fileData) throw new Error("Could not download file");

      const mammoth = await import("mammoth");
      const arrayBuffer = await fileData.arrayBuffer();
      const { value: manuscriptText } = await mammoth.extractRawText({ arrayBuffer });

      await supabase.from("manuscripts").update({ status: "rechecking" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "rechecking" }));

      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manuscriptText, manuscriptId: params.id }),
      });
      const { result } = await response.json();

      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);

      await supabase.from("manuscripts").update({
        status: "completed",
        edit_summary: result.summary,
      }).eq("id", params.id);

      setManuscript((prev: any) => ({ ...prev, status: "completed", edit_summary: result.summary }));
      if (result.sentences) setSentences(result.sentences);
    } catch (error) {
      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);
      await supabase.from("manuscripts").update({ status: "error" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "error" }));
    }
    setProcessing(false);
  };

  const stageIndex = manuscript ? getStageIndex(manuscript.status) : 0;

  const sidebarStageColor = (i: number) => {
    if (i < stageIndex) return { dot: "#22c55e", label: "#4ade80", bg: "rgba(34,197,94,0.08)" };
    if (i === stageIndex) return { dot: "var(--accent)", label: "var(--accent)", bg: "var(--accent-light)" };
    return { dot: "var(--border)", label: "var(--text-muted)", bg: "transparent" };
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading...</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "calc(100vh - 56px)" }}>

        {/* LEFT SIDEBAR */}
        <div style={{
          backgroundColor: "var(--bg-card)", borderRight: "1px solid var(--border)",
          padding: "20px 14px", display: "flex", flexDirection: "column", gap: 0,
        }}>
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "16px", padding: "0 4px" }}>
            Workflow
          </p>

          {WORKFLOW_STAGES.map((stage, i) => {
            const color = sidebarStageColor(i);
            const isEditing = i === 2 && stageIndex === 2;
            return (
              <div key={stage.key}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "8px", borderRadius: "8px", backgroundColor: color.bg,
                }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: color.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 500, color: color.label }}>{stage.label}</span>
                </div>

                {/* Editing sub-tag — fades in/out */}
                {isEditing && (
                  <div style={{
                    marginLeft: "26px", marginTop: "6px", marginBottom: "4px",
                    padding: "4px 10px", borderRadius: "20px",
                    backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                    display: "inline-block",
                    opacity: tagVisible ? 1 : 0,
                    transition: "opacity 0.4s ease",
                  }}>
                    <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--accent)" }}>
                      {EDITING_TAGS[currentTag]}
                    </span>
                  </div>
                )}

                {i < WORKFLOW_STAGES.length - 1 && (
                  <div style={{ width: "1px", height: "12px", backgroundColor: "var(--border)", marginLeft: "15px" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* RIGHT MAIN */}
        <div style={{ display: "flex", flexDirection: "column" }}>

          {/* Top bar */}
          <div style={{
            backgroundColor: "var(--bg-card)", borderBottom: "1px solid var(--border)",
            padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button onClick={() => router.push("/dashboard")} style={{
                fontSize: "12px", color: "var(--text-muted)", background: "transparent",
                border: "1px solid var(--border)", padding: "4px 10px", borderRadius: "6px", cursor: "pointer",
              }}>← Dashboard</button>
              <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>{manuscript?.title}</span>
            </div>
            <div style={{
              fontSize: "11px", fontWeight: 500, padding: "3px 12px", borderRadius: "20px",
              backgroundColor: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--accent-border)",
            }}>
              {manuscript?.status === "pending" && "Ready to proofread"}
              {manuscript?.status === "processing" && "Editing in progress"}
              {manuscript?.status === "rechecking" && "Rechecking..."}
              {manuscript?.status === "completed" && "Completed"}
              {manuscript?.status === "error" && "Error"}
            </div>
          </div>

          {/* Document body */}
          <div style={{ flex: 1, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* PENDING */}
            {manuscript?.status === "pending" && (
              <div style={{
                textAlign: "center", padding: "60px 20px",
                backgroundColor: "var(--bg-card)", borderRadius: "16px", border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>📄</div>
                <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                  Ready to proofread
                </h3>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "28px" }}>
                  Your manuscript has been uploaded. Click below to start the 7-pass editing pipeline.
                </p>
                <button onClick={handleProofread} style={{
                  backgroundColor: "var(--accent)", color: "#fff", border: "none",
                  fontSize: "14px", fontWeight: 500, padding: "11px 28px", borderRadius: "10px", cursor: "pointer",
                }}>
                  Start proofreading
                </button>
              </div>
            )}

            {/* PROCESSING / RECHECKING / COMPLETED — show document */}
            {["processing", "rechecking", "completed"].includes(manuscript?.status) && (
              <>
                {/* Title */}
                    <div>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Title</p>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "4px" }}>
                        {manuscript.title}
                    </div>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", marginBottom: "4px" }}>
                        {manuscript.title} — A Narrative Review
                    </div>

                    {/* Running Title */}
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "14px 0 8px" }}>Running Title</p>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "4px", fontStyle: "italic" }}>
                        A Review of Auricular Acupressure with Seed Pressing in Symptom Management of Lung Cancer
                    </div>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", fontStyle: "italic" }}>
                        Auricular acupressure with seed pressing in lung cancer
                    </div>
                    </div>

                {/* Abstract */}
                <div>
                  <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Abstract</p>
                  <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "4px" }}>
                    Patients with lung cancer often experience multiple symptoms, which severely impair their quality of life.
                  </div>
                  <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", marginBottom: "4px" }}>
                    Patients with lung cancer commonly experience multiple concurrent symptoms, all of which can substantially reduce quality of life.
                  </div>
                  {manuscript?.status === "processing" && (
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "var(--accent-light)", borderLeft: "2px solid var(--accent)", color: "var(--accent)" }}>
                      ▶ Processing next sentence...
                    </div>
                  )}
                </div>

                {/* Keywords */}
                <div>
                  <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Keywords</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {["auricular acupressure with seed pressing", "lung cancer", "non-pharmacological intervention", "review", "symptom management"].map((kw) => (
                      <span key={kw} style={{
                        fontSize: "11px", padding: "3px 10px", borderRadius: "20px",
                        backgroundColor: "rgba(34,197,94,0.07)", border: "0.5px solid rgba(34,197,94,0.2)", color: "#4ade80",
                      }}>{kw}</span>
                    ))}
                  </div>
                </div>

                {/* Main paper */}
                <div>
                  <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Main paper</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through" }}>
                      Lung cancer is one of the malignancies with the highest incidence and mortality worldwide.
                    </div>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80" }}>
                      Lung cancer is one of the most prevalent malignancies and remains the leading cause of cancer-related mortality worldwide.
                    </div>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", color: "var(--text-secondary)" }}>
                      In China, lung cancer has the highest incidence and mortality among all malignancies [2].
                    </div>
                    {manuscript?.status === "processing" && (
                      <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "var(--accent-light)", borderLeft: "2px solid var(--accent)", color: "var(--accent)" }}>
                        ▶ Throughout the disease course and during treatment, patients with lung cancer frequently experience...
                      </div>
                    )}
                    <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", color: "var(--text-muted)", opacity: 0.4 }}>
                      Future research should prioritize the conduct of rigorously designed multicenter randomized controlled trials...
                    </div>
                  </div>
                </div>

                {/* Edit Summary */}
                {manuscript?.status === "completed" && manuscript?.edit_summary && (
                  <div>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Edit Summary</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
                      {[
                        { label: "Grammar", value: manuscript.edit_summary.grammar_corrections },
                        { label: "APA", value: manuscript.edit_summary.apa_corrections },
                        { label: "Terminology", value: manuscript.edit_summary.terminology_corrections },
                        { label: "Consistency", value: manuscript.edit_summary.consistency_improvements },
                        { label: "Style", value: manuscript.edit_summary.style_improvements },
                        { label: "Total", value: manuscript.edit_summary.total_edits },
                      ].map((item) => (
                        <div key={item.label} style={{
                          backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
                          borderRadius: "10px", padding: "12px", textAlign: "center",
                        }}>
                          <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)" }}>{item.value}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ERROR */}
            {manuscript?.status === "error" && (
              <div style={{
                textAlign: "center", padding: "60px 20px",
                backgroundColor: "rgba(239,68,68,0.05)", borderRadius: "16px", border: "1px solid rgba(239,68,68,0.2)",
              }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>❌</div>
                <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>Processing failed</h3>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "28px" }}>Something went wrong. Please try again.</p>
                <button onClick={handleProofread} style={{
                  backgroundColor: "var(--accent)", color: "#fff", border: "none",
                  fontSize: "14px", fontWeight: 500, padding: "11px 28px", borderRadius: "10px", cursor: "pointer",
                }}>Try again</button>
              </div>
            )}
          </div>

          {/* Action bar — only show when completed */}
          {manuscript?.status === "completed" && (
            <>
              <div style={{
                borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                padding: "14px 20px", display: "flex", gap: "10px", flexWrap: "wrap",
              }}>
                <button style={{
                  fontSize: "13px", fontWeight: 500, padding: "9px 18px", borderRadius: "8px",
                  border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  📄 Download edited DOCX
                </button>
                <button onClick={() => setShowCompare(!showCompare)} style={{
                  fontSize: "13px", fontWeight: 500, padding: "9px 18px", borderRadius: "8px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                  color: "var(--text-primary)", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  🔀 Compare original vs edited
                </button>
              </div>

              {/* Compare panel */}
              {showCompare && (
                <div style={{ padding: "0 20px 20px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden", marginTop: "16px" }}>
                    <div style={{
                      padding: "10px 16px", backgroundColor: "var(--bg-card)",
                      borderBottom: "1px solid var(--border)", fontSize: "12px",
                      fontWeight: 500, color: "var(--text-secondary)",
                    }}>
                      Original vs edited — sentence by sentence
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                      <div style={{ padding: "14px 16px", borderRight: "1px solid var(--border)" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Original</p>
                        <p style={{ fontSize: "12px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                          Patients with lung cancer often experience multiple symptoms, such as pain, cough, cancer-related fatigue, sleep disorders, anxiety, and depression, which severely impair their quality of life.
                        </p>
                      </div>
                      <div style={{ padding: "14px 16px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Edited</p>
                        <p style={{ fontSize: "12px", lineHeight: 1.6, color: "var(--text-primary)" }}>
                          Patients with lung cancer commonly experience multiple concurrent symptoms, including pain, cough, cancer-related fatigue, sleep disturbances, anxiety, and depression, all of which can substantially reduce quality of life.
                        </p>
                      </div>
                    </div>
                    <div style={{
                      padding: "10px 16px", borderTop: "1px solid var(--border)",
                      backgroundColor: "var(--bg-card)", display: "flex", justifyContent: "flex-end",
                    }}>
                      <button style={{
                        fontSize: "12px", fontWeight: 500, padding: "8px 16px", borderRadius: "8px",
                        border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: "6px",
                      }}>
                        📥 Download edit-PC version
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
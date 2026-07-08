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
  if (status === "rechecking") return 3;
  if (status === "completed") return 4;
  if (status === "error") return 1;
  return 0;
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

export default function ManuscriptPage() {
  const [manuscript, setManuscript] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [tagVisible, setTagVisible] = useState(true);
  const [showCompare, setShowCompare] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(0);
  const [visibleSentences, setVisibleSentences] = useState<number>(0);

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

  // Load result from sessionStorage on mount
  useEffect(() => {
    const cached = sessionStorage.getItem(`result_${params.id}`);
    if (cached) setResult(JSON.parse(cached));
  }, [params.id]);

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
    setVisibleSentences(0);
    sentenceInterval.current = setInterval(() => {
      setVisibleSentences((prev) => prev + 1);
      setActiveSentenceIndex((prev) => prev + 1);
    }, 1500);
  };

  const fetchManuscript = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .eq("id", params.id)
      .single();
    if (data) setManuscript(data);
    setLoading(false);
  };

  const handleProofread = async () => {
    setProcessing(true);

    // Update to processing — minimal Supabase write
    await supabase.from("manuscripts").update({ status: "processing" }).eq("id", params.id);
    setManuscript((prev: any) => ({ ...prev, status: "processing" }));
    startTagCycle();
    startSentenceCycle();

    try {
      // Download file once from Supabase
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(manuscript.original_file_url);
      if (!fileData) throw new Error("Could not download file");

      // Extract text in browser
      const mammoth = await import("mammoth");
      const arrayBuffer = await fileData.arrayBuffer();
      const { value: manuscriptText } = await mammoth.extractRawText({ arrayBuffer });

      // Store raw text in sessionStorage
      sessionStorage.setItem(`text_${params.id}`, manuscriptText);

      // Update to rechecking
      await supabase.from("manuscripts").update({ status: "rechecking" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "rechecking" }));

      // Call AI API
      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manuscriptText }),
      });

      const { result: aiResult } = await response.json();

      // Store result in sessionStorage — no Supabase needed
      sessionStorage.setItem(`result_${params.id}`, JSON.stringify(aiResult));
      setResult(aiResult);

      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);

      // Only write summary to Supabase — no full text
      await supabase.from("manuscripts").update({
        status: "completed",
        edit_summary: aiResult.summary,
      }).eq("id", params.id);

      setManuscript((prev: any) => ({ ...prev, status: "completed", edit_summary: aiResult.summary }));

    } catch (error: any) {
      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);
      await supabase.from("manuscripts").update({ status: "error" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "error" }));
    }

    setProcessing(false);
  };

  const handleDownloadEdited = () => {
    if (!result?.edited_text) return;
    const blob = new Blob([result.edited_text], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${manuscript.title}-edited.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stageIndex = manuscript ? getStageIndex(manuscript.status) : 0;

  const sidebarStageColor = (i: number) => {
    if (i < stageIndex) return { dot: "#22c55e", label: "#4ade80", bg: "rgba(34,197,94,0.08)" };
    if (i === stageIndex) return { dot: "var(--accent)", label: "var(--accent)", bg: "var(--accent-light)" };
    return { dot: "var(--border)", label: "var(--text-muted)", bg: "transparent" };
  };

  const sentences = result?.sentences || [];
  const changedSentences = sentences.filter((s: any) => s.changed);

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

          {/* Edit stats in sidebar when completed */}
          {manuscript?.status === "completed" && manuscript?.edit_summary && (
            <div style={{ marginTop: "24px", borderTop: "1px solid var(--border)", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px" }}>Edit stats</p>
              {[
                { label: "Grammar", value: manuscript.edit_summary.grammar_corrections },
                { label: "APA", value: manuscript.edit_summary.apa_corrections },
                { label: "Terminology", value: manuscript.edit_summary.terminology_corrections },
                { label: "Style", value: manuscript.edit_summary.style_improvements },
                { label: "Total edits", value: manuscript.edit_summary.total_edits },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{item.label}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{item.value}</span>
                </div>
              ))}
            </div>
          )}
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
              <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "400px" }}>{manuscript?.title}</span>
            </div>
            <div style={{
              fontSize: "11px", fontWeight: 500, padding: "3px 12px", borderRadius: "20px",
              backgroundColor: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--accent-border)",
              flexShrink: 0,
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

            {/* PROCESSING */}
            {manuscript?.status === "processing" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ textAlign: "center", padding: "20px", backgroundColor: "var(--accent-light)", borderRadius: "12px", border: "1px solid var(--accent-border)" }}>
                  <p style={{ fontSize: "13px", color: "var(--accent)", fontWeight: 500 }}>
                    ⚙️ Running 7-pass editorial pipeline...
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {Array.from({ length: Math.min(visibleSentences, 6) }).map((_, i) => (
                    <div key={i} style={{
                      fontSize: "13px", lineHeight: 1.6, padding: "8px 12px",
                      borderRadius: "6px",
                      backgroundColor: i === visibleSentences - 1 ? "var(--accent-light)" : "rgba(34,197,94,0.07)",
                      borderLeft: i === visibleSentences - 1 ? "2px solid var(--accent)" : "2px solid #22c55e",
                      color: i === visibleSentences - 1 ? "var(--accent)" : "#4ade80",
                      transition: "all 0.3s ease",
                    }}>
                      {i === visibleSentences - 1 ? "▶ Processing..." : "✓ Sentence edited"}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RECHECKING */}
            {manuscript?.status === "rechecking" && (
              <div style={{ textAlign: "center", padding: "60px 20px", backgroundColor: "var(--bg-card)", borderRadius: "16px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>🔍</div>
                <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Rechecking edits for consistency and quality...</p>
              </div>
            )}

            {/* COMPLETED */}
            {manuscript?.status === "completed" && result && (
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
                  <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "14px 0 8px" }}>Running Title</p>
                  <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", fontStyle: "italic" }}>
                    {manuscript.title.substring(0, 60)}...
                  </div>
                </div>

                {/* Sentences */}
                {changedSentences.length > 0 && (
                  <div>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>
                      Edited sentences ({changedSentences.length} changes)
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {changedSentences.slice(0, 20).map((s: any, i: number) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through" }}>
                            {s.original}
                          </div>
                          <div style={{ fontSize: "13px", lineHeight: 1.6, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80" }}>
                            {s.edited}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key changes */}
                {result.summary?.key_changes?.length > 0 && (
                  <div>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Key changes</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {result.summary.key_changes.map((change: string, i: number) => (
                        <div key={i} style={{ fontSize: "13px", color: "var(--text-secondary)", padding: "6px 12px", borderRadius: "6px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", display: "flex", gap: "8px" }}>
                          <span style={{ color: "var(--accent)", flexShrink: 0 }}>→</span> {change}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ERROR */}
            {manuscript?.status === "error" && (
              <div style={{ textAlign: "center", padding: "60px 20px", backgroundColor: "rgba(239,68,68,0.05)", borderRadius: "16px", border: "1px solid rgba(239,68,68,0.2)" }}>
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

          {/* Action bar */}
          {manuscript?.status === "completed" && (
            <>
              <div style={{
                borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                padding: "14px 20px", display: "flex", gap: "10px", flexWrap: "wrap",
              }}>
                <button onClick={handleDownloadEdited} style={{
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
              {showCompare && result?.sentences && (
                <div style={{ padding: "16px 20px 20px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                    <div style={{ padding: "10px 16px", backgroundColor: "var(--bg-card)", borderBottom: "1px solid var(--border)", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)" }}>
                      Original vs edited — sentence by sentence
                    </div>
                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      {result.sentences.filter((s: any) => s.changed).map((s: any, i: number) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ padding: "12px 14px", borderRight: "1px solid var(--border)", fontSize: "12px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                            {s.original}
                          </div>
                          <div style={{ padding: "12px 14px", fontSize: "12px", lineHeight: 1.6, color: "var(--text-primary)" }}>
                            {s.edited}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-card)", display: "flex", justifyContent: "flex-end" }}>
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
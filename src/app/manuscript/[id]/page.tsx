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
  { key: "analysed", label: "Extracting text" },
  { key: "editing", label: "Editing manuscript" },
  { key: "rechecking", label: "Saving results" },
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

function sortKeywords(str: string): string {
  if (!str) return "";
  return str
    .split(";")
    .map(k => k.trim())
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .join("; ");
}

// Strip markdown bold markers and section labels from AI output
function stripLabel(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*[^*]+\*\*\s*/g, "")
    .replace(/^(abstract|keywords|running\s*title|title)[:\s]*/i, "")
    .trim();
}

function parseDocumentSections(text: string) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let title = "";
  let runningTitle = "";
  let abstract = "";
  let keywords = "";
  let body = "";
  let references = "";
  let i = 0;

  // First line = title
  if (lines.length > 0) { title = lines[0]; i = 1; }

  // Running title
  for (let j = i; j < Math.min(i + 6, lines.length); j++) {
    if (/^running\s*title[:\s]/i.test(lines[j])) {
      runningTitle = lines[j].replace(/^running\s*title[:\s]*/i, "").trim();
      i = j + 1;
      break;
    }
  }

  // Abstract — "[Abstract]" header OR "Abstract: text..." inline
  for (let j = i; j < Math.min(i + 8, lines.length); j++) {
    if (/^\[?abstract\]?$/i.test(lines[j])) {
      i = j + 1;
      const abstractLines: string[] = [];
      while (i < lines.length) {
        const line = lines[i];
        if (
          /^\[?keywords?\]?[:\s]/i.test(line) ||
          /^keywords?:/i.test(line) ||
          /^1[\.\s]/.test(line) ||
          /^introduction/i.test(line)
        ) break;
        abstractLines.push(line);
        i++;
      }
      abstract = abstractLines.join(" ");
      break;
    } else if (/^abstract[:\s]/i.test(lines[j])) {
      abstract = lines[j].replace(/^abstract[:\s]*/i, "").trim();
      i = j + 1;
      while (i < lines.length) {
        const line = lines[i];
        if (
          /^\[?keywords?\]?[:\s]/i.test(line) ||
          /^keywords?:/i.test(line) ||
          /^1[\.\s]/.test(line) ||
          /^introduction/i.test(line) ||
          /^objective[:\s]/i.test(line)
        ) break;
        abstract += " " + line;
        i++;
      }
      break;
    }
  }

  // Keywords
  const kwIndex = lines.findIndex((l, idx) =>
    idx >= i && /^\[?keywords?\]?[:\s]/i.test(l)
  );
  if (kwIndex !== -1) {
    keywords = lines[kwIndex].replace(/^\[?keywords?\]?[:\s]*/i, "").trim();
    i = kwIndex + 1;
  }

  // References — stop body here
  const refIndex = lines.findIndex((l, idx) =>
    idx >= i && /^references?$/i.test(l)
  );
  if (refIndex !== -1) {
    body = lines.slice(i, refIndex).join("\n");
    references = lines.slice(refIndex).join("\n");
  } else {
    body = lines.slice(i).join("\n");
  }

  return { title, runningTitle, abstract, keywords, body, references };
}

function extractSectionFromSentences(sentences: any[], section: string) {
  return sentences.filter((s: any) => s.section === section);
}

export default function ManuscriptPage() {
  const [manuscript, setManuscript] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [tagVisible, setTagVisible] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [rawSections, setRawSections] = useState<any>(null);
  const [visibleSentences, setVisibleSentences] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const tagInterval = useRef<any>(null);
  const sentenceInterval = useRef<any>(null);

  useEffect(() => { fetchManuscript(); }, []);

  useEffect(() => {
    if (manuscript?.status === "rechecking") {
      startTagCycle();
      startSentenceCycle();
    }
    return () => {
      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);
    };
  }, [manuscript?.status]);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(`result_${params.id}`);
      if (cached) setResult(JSON.parse(cached));
      const rawText = sessionStorage.getItem(`text_${params.id}`);
      if (rawText) setRawSections(parseDocumentSections(rawText));
    } catch {
      sessionStorage.removeItem(`result_${params.id}`);
    }
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
    }, 1200);
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
    await supabase.from("manuscripts").update({ status: "processing" }).eq("id", params.id);
    setManuscript((prev: any) => ({ ...prev, status: "processing" }));

    try {
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(manuscript.original_file_url);
      if (!fileData) throw new Error("Could not download file");

      const mammoth = await import("mammoth");
      const arrayBuffer = await fileData.arrayBuffer();
      const { value: manuscriptText } = await mammoth.extractRawText({ arrayBuffer });

      sessionStorage.setItem(`text_${params.id}`, manuscriptText);
      const sections = parseDocumentSections(manuscriptText);
      setRawSections(sections);

      await supabase.from("manuscripts").update({ status: "rechecking" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "rechecking" }));

      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manuscriptText }),
      });

      const { result: aiResult } = await response.json();

      // Sort keywords in code as backup
      const kwSentence = aiResult?.sentences?.find((s: any) => s.section === "keywords");
      if (kwSentence?.edited) kwSentence.edited = sortKeywords(stripLabel(kwSentence.edited));
      if (kwSentence?.original) kwSentence.original = stripLabel(kwSentence.original);

      // Strip labels from abstract sentences
      const abstractSents = aiResult?.sentences?.filter((s: any) => s.section === "abstract") || [];
      abstractSents.forEach((s: any) => {
        s.original = stripLabel(s.original);
        s.edited = stripLabel(s.edited);
      });

      // Strip labels from title and running title
      const titleSent = aiResult?.sentences?.find((s: any) => s.section === "title");
      if (titleSent) {
        titleSent.original = stripLabel(titleSent.original);
        titleSent.edited = stripLabel(titleSent.edited);
      }
      const rtSent = aiResult?.sentences?.find((s: any) => s.section === "running_title");
      if (rtSent) {
        rtSent.original = stripLabel(rtSent.original);
        rtSent.edited = stripLabel(rtSent.edited);
      }

      sessionStorage.setItem(`result_${params.id}`, JSON.stringify(aiResult));
      setResult(aiResult);

      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);

      await supabase.from("manuscripts").update({
        status: "completed",
        edit_summary: aiResult.summary,
      }).eq("id", params.id);

      setManuscript((prev: any) => ({
        ...prev,
        status: "completed",
        edit_summary: aiResult.summary,
      }));

    } catch (error: any) {
      clearInterval(tagInterval.current);
      clearInterval(sentenceInterval.current);
      await supabase.from("manuscripts").update({ status: "error" }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "error" }));
    }
    setProcessing(false);
  };

  const handleDownload = async (type: "edited" | "editpc") => {
    if (!result?.sentences || !manuscript?.original_file_url) return;
    try {
      const { data: { user } } = await createClient().auth.getUser();
      const response = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl: manuscript.original_file_url,
          sentences: result.sentences,
          title: manuscript.title,
          type,
          manuscriptId: params.id,
          userId: user?.id,
        }),
      });
      const { file } = await response.json();
      if (!file) return;

      const parts = manuscript.original_file_url.split("/");
      let filename = parts[parts.length - 1].replace(/^\d+_/, "");
      const base = filename.replace(/\.docx$/i, "");
      const downloadName = type === "edited"
        ? `${base.replace(/-org$/i, "")}.docx`
        : `${base.replace(/-org$/i, "")}-edit-PC.docx`;

      const blob = new Blob(
        [Uint8Array.from(atob(file), c => c.charCodeAt(0))],
        { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
    }
  };

  const stageIndex = manuscript ? getStageIndex(manuscript.status) : 0;

  const sidebarStageColor = (i: number) => {
    if (i < stageIndex) return { dot: "#22c55e", label: "#4ade80", bg: "rgba(34,197,94,0.08)" };
    if (i === stageIndex) return { dot: "var(--accent)", label: "var(--accent)", bg: "var(--accent-light)" };
    return { dot: "var(--border)", label: "var(--text-muted)", bg: "transparent" };
  };

  // Extract all sentences by section
  const allSentences = result?.sentences || [];
  const titleSentences = extractSectionFromSentences(allSentences, "title");
  const runningTitleSentences = extractSectionFromSentences(allSentences, "running_title");
  const abstractSentences = extractSectionFromSentences(allSentences, "abstract");
  const keywordsSentences = extractSectionFromSentences(allSentences, "keywords");
  const bodySentences = allSentences.filter(
    (s: any) => s.section === "body" || !s.section
  );

  // Title
  const titleOriginal = stripLabel(titleSentences[0]?.original || rawSections?.title || manuscript?.title || "");
  const titleEdited = stripLabel(titleSentences[0]?.edited || "");
  const titleChanged = titleSentences[0]?.changed || false;

  // Running title
  const runningTitleOriginal = stripLabel(runningTitleSentences[0]?.original || rawSections?.runningTitle || "");
  const runningTitleEdited = stripLabel(runningTitleSentences[0]?.edited || "");
  const runningTitleChanged = runningTitleSentences[0]?.changed || false;

  // Abstract — combine ALL abstract sentences
  const abstractOriginal = abstractSentences.length > 0
    ? abstractSentences.map((s: any) => stripLabel(s.original)).join(" ")
    : rawSections?.abstract || "";
  const abstractEdited = abstractSentences.length > 0
    ? abstractSentences.map((s: any) => stripLabel(s.edited)).join(" ")
    : "";
  const abstractChanged = abstractSentences.some((s: any) => s.changed);

  // Keywords
  const keywordsOriginal = stripLabel(keywordsSentences[0]?.original || rawSections?.keywords || "");
  const keywordsEdited = sortKeywords(stripLabel(keywordsSentences[0]?.edited || keywordsOriginal));
  const keywordsChanged = keywordsSentences[0]?.changed ||
    keywordsOriginal.trim() !== keywordsEdited.trim();

  const changedCount = allSentences.filter((s: any) => s.changed).length;
  const isShowingDocument = ["processing", "rechecking", "completed"].includes(manuscript?.status);
  const displayTitle = titleEdited || titleOriginal || manuscript?.title;

  // Styles
  const SECTION_LABEL: React.CSSProperties = {
    fontSize: "10px", fontWeight: 600, color: "var(--text-muted)",
    textTransform: "uppercase", letterSpacing: "0.6px",
    marginBottom: "6px", marginTop: "24px", padding: "0 2px",
  };
  const ORIGINAL: React.CSSProperties = {
    fontSize: "clamp(12px, 1.5vw, 13px)", lineHeight: 1.7,
    padding: "8px 12px", borderRadius: "6px",
    backgroundColor: "rgba(239,68,68,0.07)",
    borderLeft: "2px solid #ef4444",
    color: "#f87171", textDecoration: "line-through",
    marginBottom: "3px", wordBreak: "break-word",
  };
  const EDITED: React.CSSProperties = {
    fontSize: "clamp(12px, 1.5vw, 13px)", lineHeight: 1.7,
    padding: "8px 12px", borderRadius: "6px",
    backgroundColor: "rgba(34,197,94,0.07)",
    borderLeft: "2px solid #22c55e",
    color: "#4ade80", marginBottom: "3px", wordBreak: "break-word",
  };
  const UNCHANGED: React.CSSProperties = {
    fontSize: "clamp(12px, 1.5vw, 13px)", lineHeight: 1.7,
    padding: "8px 12px", borderRadius: "6px",
    backgroundColor: "var(--bg-card)",
    borderLeft: "2px solid var(--border)",
    color: "var(--text-primary)", marginBottom: "3px", wordBreak: "break-word",
  };
  const PREVIEW: React.CSSProperties = {
    fontSize: "clamp(12px, 1.5vw, 13px)", lineHeight: 1.7,
    padding: "8px 12px", borderRadius: "6px",
    backgroundColor: "var(--bg-card)",
    borderLeft: "2px solid var(--border)",
    color: "var(--text-secondary)", marginBottom: "3px", wordBreak: "break-word",
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading...</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 40,
        }} />
      )}

      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)" }}>

        {/* SIDEBAR */}
        <div style={{
          backgroundColor: "var(--bg-card)",
          borderRight: "1px solid var(--border)",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          width: "220px",
          flexShrink: 0,
          position: "sticky",
          top: "56px",
          height: "calc(100vh - 56px)",
          overflowY: "auto",
        }} className="aipr-sidebar">
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "16px", padding: "0 4px" }}>
            Workflow
          </p>

          {WORKFLOW_STAGES.map((stage, i) => {
            const color = sidebarStageColor(i);
            const isActiveEditing = stageIndex === 3 && i === 2;
            return (
              <div key={stage.key}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "8px", borderRadius: "8px", backgroundColor: color.bg,
                }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: color.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 500, color: color.label }}>{stage.label}</span>
                </div>
                {isActiveEditing && (
                  <div style={{
                    marginLeft: "26px", marginTop: "6px", marginBottom: "4px",
                    padding: "4px 10px", borderRadius: "20px",
                    backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                    display: "inline-block", opacity: tagVisible ? 1 : 0, transition: "opacity 0.4s ease",
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

          {/* Edit stats */}
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
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{item.value ?? 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* Key changes */}
          {manuscript?.status === "completed" && result?.summary?.key_changes?.length > 0 && (
            <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Key changes</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {result.summary.key_changes.map((change: string, i: number) => (
                  <div key={i} style={{ fontSize: "11px", color: "var(--text-secondary)", padding: "5px 8px", borderRadius: "6px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", display: "flex", gap: "6px" }}>
                    <span style={{ color: "var(--accent)", flexShrink: 0 }}>→</span> {change}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* MAIN */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Top bar */}
          <div style={{
            backgroundColor: "var(--bg-card)", borderBottom: "1px solid var(--border)",
            padding: "12px clamp(12px, 2vw, 20px)",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
            position: "sticky", top: "56px", zIndex: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="aipr-sidebar-toggle"
                style={{
                  display: "none", fontSize: "16px", background: "transparent",
                  border: "1px solid var(--border)", borderRadius: "6px",
                  padding: "4px 8px", cursor: "pointer", color: "var(--text-primary)", flexShrink: 0,
                }}
              >☰</button>
              <button onClick={() => router.push("/dashboard")} style={{
                fontSize: "12px", color: "var(--text-muted)", background: "transparent",
                border: "1px solid var(--border)", padding: "4px 10px",
                borderRadius: "6px", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
              }}>← Dashboard</button>
              <span style={{
                fontSize: "clamp(12px, 1.5vw, 14px)", fontWeight: 500,
                color: "var(--text-primary)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {displayTitle}
              </span>
            </div>
            <div style={{
              fontSize: "11px", fontWeight: 500, padding: "3px 10px", borderRadius: "20px",
              backgroundColor: "var(--accent-light)", color: "var(--accent)",
              border: "1px solid var(--accent-border)", flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {manuscript?.status === "pending" && "Ready"}
              {manuscript?.status === "processing" && "Extracting..."}
              {manuscript?.status === "rechecking" && "Editing..."}
              {manuscript?.status === "completed" && `✓ ${changedCount} edits`}
              {manuscript?.status === "error" && "Error"}
            </div>
          </div>

          {/* Document body */}
          <div style={{
            flex: 1, padding: "clamp(16px, 3vw, 28px) clamp(16px, 4vw, 32px)",
            overflowY: "auto", display: "flex", flexDirection: "column",
          }}>

            {/* PENDING */}
            {manuscript?.status === "pending" && (
              <div style={{
                textAlign: "center", padding: "clamp(32px, 6vw, 60px) 20px",
                backgroundColor: "var(--bg-card)", borderRadius: "16px", border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>📄</div>
                <h3 style={{ fontSize: "clamp(16px, 2vw, 18px)", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                  Ready to proofread
                </h3>
                <p style={{ fontSize: "clamp(13px, 1.5vw, 14px)", color: "var(--text-muted)", marginBottom: "28px", maxWidth: "400px", margin: "0 auto 28px" }}>
                  Your manuscript has been uploaded. Click below to start the 7-pass editing pipeline.
                </p>
                <button onClick={handleProofread} style={{
                  backgroundColor: "var(--accent)", color: "#fff", border: "none",
                  fontSize: "14px", fontWeight: 500, padding: "11px 28px",
                  borderRadius: "10px", cursor: "pointer",
                }}>Start proofreading</button>
              </div>
            )}

            {/* DOCUMENT PREVIEW — processing and rechecking */}
            {isShowingDocument && rawSections && manuscript?.status !== "completed" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{
                  padding: "12px 16px", borderRadius: "10px", marginBottom: "8px",
                  backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                  display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px",
                }}>
                  <span style={{ fontSize: "13px", color: "var(--accent)", fontWeight: 500 }}>
                    {manuscript?.status === "processing" ? "⚙️ Extracting manuscript text..." : "✏️ Running 7-pass editorial pipeline..."}
                  </span>
                  {manuscript?.status === "rechecking" && (
                    <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--accent)", opacity: tagVisible ? 1 : 0, transition: "opacity 0.4s ease" }}>
                      {EDITING_TAGS[currentTag]}
                    </span>
                  )}
                </div>

                {rawSections.title && (<><p style={SECTION_LABEL}>Title</p><div style={{ ...PREVIEW, fontWeight: 600 }}>{rawSections.title}</div></>)}
                {rawSections.runningTitle && (<><p style={SECTION_LABEL}>Running title</p><div style={PREVIEW}>{rawSections.runningTitle}</div></>)}
                {rawSections.abstract && (<><p style={SECTION_LABEL}>Abstract</p><div style={PREVIEW}>{rawSections.abstract}</div></>)}
                {rawSections.keywords && (<><p style={SECTION_LABEL}>Keywords</p><div style={PREVIEW}>{rawSections.keywords}</div></>)}

                {rawSections.body && (
                  <>
                    <p style={SECTION_LABEL}>Document body</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      {rawSections.body.split("\n").filter(Boolean).map((line: string, i: number) => (
                        <div key={i} style={{
                          ...PREVIEW,
                          backgroundColor: manuscript?.status === "rechecking" && i < visibleSentences
                            ? "rgba(34,197,94,0.04)" : "var(--bg-card)",
                          borderLeft: manuscript?.status === "rechecking" && i < visibleSentences
                            ? "2px solid rgba(34,197,94,0.4)" : "2px solid var(--border)",
                          transition: "all 0.5s ease",
                        }}>
                          {manuscript?.status === "rechecking" && i === visibleSentences
                            ? <span style={{ color: "var(--accent)" }}>▶ Editing...</span>
                            : manuscript?.status === "rechecking" && i < visibleSentences
                              ? <span style={{ color: "#4ade80", opacity: 0.8 }}>✓ {line}</span>
                              : <span>{line}</span>
                          }
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* COMPLETED */}
            {manuscript?.status === "completed" && result && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>

                {/* TITLE */}
                <p style={SECTION_LABEL}>Title</p>
                {titleChanged ? (
                  <><div style={ORIGINAL}>{titleOriginal}</div><div style={EDITED}>{titleEdited}</div></>
                ) : (
                  <div style={{ ...UNCHANGED, fontWeight: 600 }}>{titleOriginal}</div>
                )}

                {/* RUNNING TITLE */}
                {runningTitleOriginal && (<>
                  <p style={SECTION_LABEL}>Running title</p>
                  {runningTitleChanged ? (
                    <><div style={ORIGINAL}>{runningTitleOriginal}</div><div style={EDITED}>{runningTitleEdited}</div></>
                  ) : (
                    <div style={UNCHANGED}>{runningTitleOriginal}</div>
                  )}
                </>)}

                {/* ABSTRACT */}
                {abstractOriginal && (<>
                  <p style={SECTION_LABEL}>Abstract</p>
                  {abstractChanged ? (
                    <><div style={ORIGINAL}>{abstractOriginal}</div><div style={EDITED}>{abstractEdited}</div></>
                  ) : (
                    <div style={UNCHANGED}>{abstractOriginal}</div>
                  )}
                </>)}

                {/* KEYWORDS */}
                {keywordsOriginal && (<>
                  <p style={SECTION_LABEL}>Keywords</p>
                  {keywordsChanged ? (
                    <><div style={ORIGINAL}>{keywordsOriginal}</div><div style={EDITED}>{keywordsEdited}</div></>
                  ) : (
                    <div style={UNCHANGED}>{keywordsEdited}</div>
                  )}
                </>)}

                {/* BODY */}
                {bodySentences.length > 0 && (<>
                  <p style={SECTION_LABEL}>Document body — {changedCount} edits</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {bodySentences.map((s: any, i: number) => (
                      s.changed ? (
                        <div key={i}>
                          <div style={ORIGINAL}>{s.original}</div>
                          <div style={EDITED}>{s.edited}</div>
                        </div>
                      ) : (
                        <div key={i} style={UNCHANGED}>{s.original}</div>
                      )
                    ))}
                  </div>
                </>)}

                {/* REFERENCES */}
                {rawSections?.references && (<>
                  <p style={SECTION_LABEL}>References (preserved)</p>
                  <div style={{
                    fontSize: "12px", lineHeight: 1.8, padding: "12px 16px",
                    borderRadius: "6px", backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border)", color: "var(--text-muted)",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {rawSections.references}
                  </div>
                </>)}
              </div>
            )}

            {/* ERROR */}
            {manuscript?.status === "error" && (
              <div style={{
                textAlign: "center", padding: "clamp(32px, 6vw, 60px) 20px",
                backgroundColor: "rgba(239,68,68,0.05)", borderRadius: "16px",
                border: "1px solid rgba(239,68,68,0.2)",
              }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>❌</div>
                <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>Processing failed</h3>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "28px" }}>Something went wrong. Please try again.</p>
                <button onClick={handleProofread} style={{
                  backgroundColor: "var(--accent)", color: "#fff", border: "none",
                  fontSize: "14px", fontWeight: 500, padding: "11px 28px",
                  borderRadius: "10px", cursor: "pointer",
                }}>Try again</button>
              </div>
            )}
          </div>

          {/* Action bar */}
          {manuscript?.status === "completed" && (
            <div style={{
              borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
              padding: "12px clamp(12px, 2vw, 20px)",
              display: "flex", gap: "10px", flexWrap: "wrap",
              position: "sticky", bottom: 0,
            }}>
              <button onClick={() => handleDownload("edited")} style={{
                fontSize: "clamp(12px, 1.5vw, 13px)", fontWeight: 500,
                padding: "9px clamp(12px, 2vw, 18px)", borderRadius: "8px",
                border: "none", backgroundColor: "var(--accent)", color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                flex: "1 1 auto",
              }}>📄 Download edited DOCX</button>
              <button onClick={() => handleDownload("editpc")} style={{
                fontSize: "clamp(12px, 1.5vw, 13px)", fontWeight: 500,
                padding: "9px clamp(12px, 2vw, 18px)", borderRadius: "8px",
                border: "none", backgroundColor: "var(--accent)", color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                flex: "1 1 auto",
              }}>📥 Download edit-PC version</button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .aipr-sidebar {
            position: fixed !important;
            top: 56px !important;
            left: ${sidebarOpen ? "0" : "-220px"} !important;
            height: 100vh !important;
            z-index: 50 !important;
            transition: left 0.3s ease !important;
          }
          .aipr-sidebar-toggle {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
}
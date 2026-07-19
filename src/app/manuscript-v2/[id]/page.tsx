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

// Word-level diff for Compare View (mimics edit-PC / Word Compare output)
function wordDiff(original: string, edited: string): { type: "same" | "del" | "ins"; text: string }[] {
  const o = original.split(/(\s+)/);
  const e = edited.split(/(\s+)/);
  // Simple LCS-based diff
  const m = o.length, n = e.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (o[i] === e[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: { type: "same" | "del" | "ins"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (o[i] === e[j]) { result.push({ type: "same", text: o[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { result.push({ type: "del", text: o[i] }); i++; }
    else { result.push({ type: "ins", text: e[j] }); j++; }
  }
  while (i < m) { result.push({ type: "del", text: o[i] }); i++; }
  while (j < n) { result.push({ type: "ins", text: e[j] }); j++; }
  return result;
}

// Detect content issues in edited text (flags for manual review)
const ISSUE_PATTERNS: { label: string; category: string; test: RegExp }[] = [
  { label: '"suggest" \u2192 should be "indicate"', category: "term", test: /\bsuggest(s|ed|ing)?\b/i },
  { label: '"subject(s)" \u2192 use patient/individual/participant', category: "term", test: /\bsubjects?\b/i },
  { label: '"show/showed" \u2192 demonstrate/present', category: "term", test: /\bshow(s|ed|n)?\b/i },
  { label: '"death(s)" \u2192 mortality/fatality', category: "term", test: /\bdeaths?\b/i },
  { label: '"elderly" \u2192 older adults', category: "term", test: /\belderly\b/i },
  { label: '"robust" \u2192 reliable', category: "term", test: /\brobust\b/i },
  { label: 'first-person (we/our/us/I)', category: "person", test: /\b(we|our|us)\b/i },
  { label: '"males/females" \u2192 men/women', category: "term", test: /\b(males|females)\b/i },
  { label: 'P= without italic/spacing', category: "apa", test: /\bP\s*=\s*0/i },
  { label: '95%CI without space', category: "apa", test: /95%CI/i },
  { label: 'citation after period (.[n])', category: "cite", test: /\.\s*\[\d/i },
  { label: 'comma-space in citation [n, n]', category: "cite", test: /\[\d+,\s+\d/i },
  { label: 'temperature without space (36\u00b0C)', category: "apa", test: /\d\u00b0C/i },
];

function detectIssues(sentences: any[]): { section: string; index: number; text: string; issues: string[] }[] {
  const flags: { section: string; index: number; text: string; issues: string[] }[] = [];
  const counters: Record<string, number> = {};
  sentences.forEach((s: any) => {
    const section = s.section || "body";
    if (counters[section] === undefined) counters[section] = -1;
    counters[section]++;
    const text = s.edited || "";
    if (!text || !s.changed) return;
    const found: string[] = [];
    for (const p of ISSUE_PATTERNS) {
      if (p.test.test(text)) found.push(p.label);
    }
    if (found.length > 0) {
      flags.push({ section, index: counters[section], text, issues: found });
    }
  });
  return flags;
}

// Group body sentences into their original paragraphs by matching text
function groupSentencesByParagraph(sentences: any[], rawBody: string): any[][] {
  if (!rawBody) return sentences.map((s: any) => [s]); // fallback: one per group
  // Split on double-newlines (real paragraph breaks). Fall back to single if none found.
  let paragraphs = rawBody.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  if (paragraphs.length <= 1) {
    paragraphs = rawBody.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
  }
  if (paragraphs.length === 0) return sentences.map((s: any) => [s]);

  const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const paraNorms = paragraphs.map(normalize);

  // Assign each sentence to the paragraph that contains its original text
  const groups: any[][] = paragraphs.map(() => []);
  const unassigned: any[] = [];

  sentences.forEach((s: any) => {
    const orig = normalize(s.original || "");
    if (!orig || orig.length < 8) { unassigned.push(s); return; }
    // try progressively shorter keys until we find a match
    let found = -1;
    for (const keyLen of [80, 60, 40, 20]) {
      if (orig.length < keyLen) continue;
      const key = orig.substring(0, keyLen);
      for (let p = 0; p < paraNorms.length; p++) {
        if (paraNorms[p].includes(key)) { found = p; break; }
      }
      if (found >= 0) break;
    }
    if (found < 0) {
      // last resort: try any 20-char substring of orig against each para
      for (let p = 0; p < paraNorms.length && found < 0; p++) {
        if (orig.length >= 20 && paraNorms[p].includes(orig.substring(0, 20))) found = p;
      }
    }
    if (found >= 0) groups[found].push(s);
    else unassigned.push(s);
  });

  // Build result: only non-empty groups, in order; append unassigned as their own groups
  const result: any[][] = [];
  groups.forEach(g => { if (g.length > 0) result.push(g); });
  unassigned.forEach(s => result.push([s]));
  return result.length > 0 ? result : sentences.map((s: any) => [s]);
}

function extractSectionFromSentences(sentences: any[], section: string) {
  return sentences.filter((s: any) => s.section === section);
}

// ===== V2 SEGREGATION (deterministic, browser-side, BEFORE any AI) =====
function segregateTree(rawText: string): any {
  const cleaned = (rawText || "").replace(/\*\*/g, "");
  const rawLines = cleaned.split(/\n/);
  const lines = rawLines.map((l, i) => ({ i, text: l.trim() })).filter(l => l.text.length > 0);
  const reRunning = /^running\s*title[:\s]/i, reAbstract = /^\[?abstract\]?[:\s]?/i,
    reKeywords = /^\[?keywords?\]?[:\s]?/i, reReferences = /^references?\s*$/i,
    reHeading = /^(\d+)\.?\s+\S/, reSub = /^(\d+\.\d+)\.?\s+\S/, reSubSub = /^(\d+\.\d+\.\d+)\.?\s+\S/;
  const typeFor = (name: string) => {
    const n = name.toLowerCase();
    if (n === "introduction") return "introduction";
    if (/method|patients|material/.test(n)) return "methods";
    if (/result/.test(n)) return "results";
    if (/discuss/.test(n)) return "discussion";
    if (/conclusion/.test(n)) return "conclusion";
    return "other";
  };
  const front: any[] = [], body: any[] = []; let references: any = null;
  const N = lines.length; let idx = 0;
  if (idx < N) { front.push({ id: `n${lines[idx].i}`, kind: "title", text: lines[idx].text }); idx++; }
  while (idx < N) {
    const t = lines[idx].text;
    if (reReferences.test(t) || reHeading.test(t)) break;
    if (reRunning.test(t)) { front.push({ id: `n${lines[idx].i}`, kind: "running_title", text: t }); idx++; continue; }
    if (reAbstract.test(t)) { front.push({ id: `n${lines[idx].i}`, kind: "abstract", text: t }); idx++; continue; }
    if (reKeywords.test(t)) { front.push({ id: `n${lines[idx].i}`, kind: "keywords", text: t }); idx++; continue; }
    break;
  }
  const intro: any[] = [];
  while (idx < N) {
    const t = lines[idx].text;
    if (reHeading.test(t) || reReferences.test(t)) break;
    intro.push({ id: `n${lines[idx].i}`, kind: "paragraph", text: t }); idx++;
  }
  if (intro.length) body.push({ id: intro[0].id, kind: "section", name: "Introduction", type: "introduction", children: intro });
  let cur: any = null, sub: any = null;
  const pushP = (n: any) => { if (sub) sub.children.push(n); else if (cur) cur.children.push(n); else body.push({ id: n.id, kind: "section", name: "(text)", type: "other", children: [n] }); };
  while (idx < N) {
    const ln = lines[idx], t = ln.text;
    if (reReferences.test(t)) { references = { id: `n${ln.i}`, kind: "references", text: rawLines.slice(ln.i).join("\n").trim() }; break; }
    if (reSubSub.test(t)) { sub = { id: `n${ln.i}`, kind: "subheading", level: 3, name: t, type: "sub", children: [] }; (cur ? cur.children : body).push(sub); idx++; continue; }
    if (reSub.test(t)) { sub = { id: `n${ln.i}`, kind: "subheading", level: 2, name: t, type: "sub", children: [] }; (cur ? cur.children : body).push(sub); idx++; continue; }
    if (reHeading.test(t)) { cur = { id: `n${ln.i}`, kind: "section", name: t, type: typeFor(t), children: [] }; sub = null; body.push(cur); idx++; continue; }
    pushP({ id: `n${ln.i}`, kind: "paragraph", text: t }); idx++;
  }
  return { front, body, references };
}
function v2CollectLeafTexts(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.kind === "paragraph") { out.push(n.text); return; }
    if (n.kind === "subheading") { out.push(n.name); (n.children || []).forEach(walk); return; }
    if (n.kind === "section") {
      if (n.name && n.name !== "Introduction" && n.name !== "(text)") out.push(n.name);
      (n.children || []).forEach(walk);
    }
  };
  walk(node);
  return out;
}
function v2DescendantIds(node: any): string[] {
  const ids = [node.id];
  (node.children || []).forEach((c: any) => ids.push(...v2DescendantIds(c)));
  return ids;
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
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [viewMode, setViewMode] = useState<"edited" | "compare">("edited");
  const [showFlags, setShowFlags] = useState(true);
  const [reeditKey, setReeditKey] = useState<string | null>(null);
  const [reeditInstruction, setReeditInstruction] = useState<string>("");
  const [reeditLoading, setReeditLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<"paragraph" | "sentence">("paragraph");
  const [rawBodyText, setRawBodyText] = useState<string>("");

  // ===== V2 state: phase (segregate grouped-send  |  review = existing completed view) =====
  const [v2Phase, setV2Phase] = useState<"idle" | "label" | "segregate" | "review">("idle");
  const [v2RawBlocks, setV2RawBlocks] = useState<string[]>([]); // raw paragraphs for labeling
  const [v2Labels, setV2Labels] = useState<Record<number, string>>({}); // blockIndex -> label
  const [v2Tree, setV2Tree] = useState<any>(null);
  const [v2Selected, setV2Selected] = useState<Set<string>>(new Set());
  const [v2Sending, setV2Sending] = useState<Set<string>>(new Set());

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
      if (rawText) {
        setRawSections(parseDocumentSections(rawText));
        setRawBodyText(rawText);
        // restore raw blocks for labeling
        const blocks = rawText.split(/\n\s*\n/).map((b: string) => b.trim()).filter((b: string) => b.length > 0);
        setV2RawBlocks(blocks);
      }
    } catch {
      sessionStorage.removeItem(`result_${params.id}`);
    }
  }, [params.id]);

  // if the manuscript is already completed (reopened), go straight to the review view
  useEffect(() => {
    if (manuscript?.status === "completed" && v2Phase === "idle") setV2Phase("review");
  }, [manuscript?.status]);

  // Rehydrate from Supabase when sessionStorage is empty (e.g. reopened / new tab)
  useEffect(() => {
    if (!manuscript || result) return;
    if (manuscript.status !== "completed" || !manuscript.result_file_url) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from("manuscripts")
          .download(manuscript.result_file_url);
        if (error || !data || cancelled) return;

        const parsed = JSON.parse(await data.text());
        if (cancelled) return;

        const { rawText, ...aiResult } = parsed;
        setResult(aiResult);
        sessionStorage.setItem(`result_${params.id}`, JSON.stringify(aiResult));

        if (rawText) {
          setRawSections(parseDocumentSections(rawText));
          setRawBodyText(rawText);
          sessionStorage.setItem(`text_${params.id}`, rawText);
        }
      } catch (e) {
        console.error("Rehydrate failed:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [manuscript, result, params.id]);

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

  // V2: "Start segregation" — extract text, split into sections. NO AI CALL.
  const handleProofread = async () => {
    setProcessing(true);
    try {
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(manuscript.original_file_url);
      if (!fileData) throw new Error("Could not download file");

      const mammoth = await import("mammoth");
      const arrayBuffer = await fileData.arrayBuffer();
      const { value: manuscriptText } = await mammoth.extractRawText({ arrayBuffer });

      sessionStorage.setItem(`text_${params.id}`, manuscriptText);
      setRawSections(parseDocumentSections(manuscriptText));
      setRawBodyText(manuscriptText);
      if (!result) setResult({ sentences: [], summary: null });

      // Split into raw blocks for manual labeling (paragraph-wise)
      const blocks = manuscriptText
        .split(/\n\s*\n/)
        .map((b: string) => b.trim())
        .filter((b: string) => b.length > 0);
      setV2RawBlocks(blocks);
      setV2Labels({});
      setV2Phase("label"); // go to manual labeling, NOT auto-segregate
    } catch (error: any) {
      console.error("Segregation failed:", error);
    }
    setProcessing(false);
  };

  function v2MergeSummaries(a: any, b: any) {
    const base = a || { grammar_corrections: 0, apa_corrections: 0, terminology_corrections: 0, consistency_improvements: 0, style_improvements: 0, total_edits: 0, key_changes: [] };
    if (!b) return base;
    return {
      grammar_corrections: (base.grammar_corrections || 0) + (b.grammar_corrections || 0),
      apa_corrections: (base.apa_corrections || 0) + (b.apa_corrections || 0),
      terminology_corrections: (base.terminology_corrections || 0) + (b.terminology_corrections || 0),
      consistency_improvements: (base.consistency_improvements || 0) + (b.consistency_improvements || 0),
      style_improvements: (base.style_improvements || 0) + (b.style_improvements || 0),
      total_edits: (base.total_edits || 0) + (b.total_edits || 0),
      key_changes: [...new Set([...(base.key_changes || []), ...(b.key_changes || [])])].slice(0, 12),
    };
  }

  const v2Norm = (t: string) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();

  const v2Persist = async (merged: any) => {
    try { sessionStorage.setItem(`result_${params.id}`, JSON.stringify(merged)); } catch {}
    try {
      const resultBlob = JSON.stringify({ ...merged, rawText: rawBodyText });
      const resultPath = `${manuscript.user_id}/${params.id}/result.json`;
      await supabase.storage.from("manuscripts").upload(resultPath, new Blob([resultBlob], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      await supabase.from("manuscripts").update({ status: "completed", edit_summary: merged.summary || {}, result_file_url: resultPath }).eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "completed", edit_summary: merged.summary || {}, result_file_url: resultPath }));
    } catch (e) { console.error("Persist failed:", e); }
  };

  // V2: send a node (front-matter group or body section/subsection) to AI, merge into result.sentences
  const v2SendNode = async (node: any) => {
    const ids = v2DescendantIds(node);
    setV2Sending(prev => new Set([...prev, ...ids]));
    try {
      let kind = "body", sectionName = node.name || "Section", sectionType = node.type || "other";
      let leafTexts: string[] = [];
      if (["title", "running_title", "abstract", "keywords", "frontgroup"].includes(node.kind)) {
        kind = node.kind; sectionName = node.kind;
        leafTexts = node.kind === "frontgroup" ? node.texts : [node.text];
      } else {
        leafTexts = v2CollectLeafTexts(node);
      }
      if (!leafTexts.length) { setV2Sending(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; }); return; }

      const chunk = leafTexts.join("\n");
      const res = await fetch("/api/proofread", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "editChunk", kind, chunk, sectionName, sectionType, context: rawBodyText.slice(0, 1500) }),
      });
      const data = await res.json();
      let newSents: any[] = data?.result?.sentences || [];
      newSents = newSents.map((s: any) => {
        let e = stripLabel(s.edited || "");
        if (s.section === "keywords") e = sortKeywords(e);
        return { ...s, original: stripLabel(s.original || ""), edited: e };
      });

      const origKeys = new Set(leafTexts.map(v2Norm));
      setResult((prev: any) => {
        const prevSents = prev?.sentences || [];
        const kept = prevSents.filter((s: any) => {
          if (["title", "running_title", "abstract", "keywords"].includes(s.section)) {
            if (kind === "frontgroup") return !["title", "running_title", "abstract"].includes(s.section);
            return s.section !== kind;
          }
          return !origKeys.has(v2Norm(s.original));
        });
        const merged = { sentences: [...kept, ...newSents], summary: v2MergeSummaries(prev?.summary, data?.result?.summary) };
        v2Persist(merged);
        return merged;
      });
    } catch (e) { console.error("v2 send failed:", e); }
    setV2Sending(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    setV2Selected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
  };

  const v2SendSelectedBody = () => {
    if (!v2Tree) return;
    const nodes: any[] = [];
    const collect = (list: any[]) => list.forEach((n: any) => { if (v2Selected.has(n.id)) nodes.push(n); else if (n.children) collect(n.children); });
    collect(v2Tree.body);
    nodes.forEach(n => v2SendNode(n));
  };

  const v2Toggle = (node: any) => {
    const ids = v2DescendantIds(node);
    setV2Selected(prev => {
      const n = new Set(prev);
      const allOn = ids.every(id => n.has(id));
      if (allOn) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  };

  const v2StripPrefix = (t: string) => (t || "")
    .replace(/^running\s*title[:\s]*/i, "")
    .replace(/^\[?abstract\]?[:\s]*/i, "")
    .replace(/^\[?keywords?\]?[:\s]*/i, "")
    .trim();

  const v2FindEdits = (originalText: string, section?: string) => {
    const k = v2Norm(v2StripPrefix(originalText));
    if (!k || k.length < 5) return [];
    return (result?.sentences || []).filter((s: any) => {
      const so = v2Norm(v2StripPrefix(s.original || ""));
      if (!so || so.length < 3) return false;
      // section-filtered match for front matter
      if (section) {
        if (s.section !== section) return false;
        if (["title","running_title","abstract","keywords"].includes(section)) {
          return so === k || so.includes(k.substring(0, Math.min(k.length, 60))) || k.includes(so.substring(0, Math.min(so.length, 60)));
        }
      }
      // for body: the node text is a whole paragraph; sentences are subsets of it
      // match if the sentence original is contained in the paragraph, OR paragraph contains the sentence
      if (s.section === "body") {
        return k.includes(so.substring(0, Math.min(so.length, 80))) || so.includes(k.substring(0, Math.min(k.length, 80)));
      }
      return so === k;
    });
  };
  const v2NodeDone = (node: any): boolean => {
    const leaves = ["title", "running_title", "abstract", "keywords"].includes(node.kind) ? [node.text] : v2CollectLeafTexts(node);
    return leaves.some(t => v2FindEdits(t).length > 0);
  };

  // enter the existing completed review view
  // Build the v2Tree from manually assigned labels
  const buildTreeFromLabels = () => {
    // collect all blocks per label, concatenate when multiple blocks share same label
    const frontMap: Record<string, string[]> = {};
    const bodyTexts: string[] = [];
    let referencesText = "";

    v2RawBlocks.forEach((block, idx) => {
      const label = v2Labels[idx];
      if (!label || label === "skip") return;
      if (label === "references") { referencesText += (referencesText ? "\n\n" : "") + block; return; }
      if (label === "body") { bodyTexts.push(block); return; }
      // front matter — collect multiple blocks per kind
      if (!frontMap[label]) frontMap[label] = [];
      // skip pure heading words (single word or very short lines like "Abstract", "Introduction")
      const isHeadingWord = block.split(/\s+/).length <= 2 && block.length < 20;
      if (!isHeadingWord) frontMap[label].push(block);
      else if (frontMap[label].length === 0) frontMap[label].push(block); // keep if it's the only one
    });

    // build front array from map, joining multiple blocks
    const kindOrder = ["title", "running_title", "abstract", "keywords"];
    const front: any[] = [];
    kindOrder.forEach((kind, i) => {
      const blocks = frontMap[kind];
      if (!blocks || blocks.length === 0) return;
      const text = blocks.join(" ").trim();
      front.push({ id: `n${kind}`, kind, text });
    });

    // Auto-detect body sections from body text
    // Supports BOTH numbered headings (1., 1.1) AND plain text headings (Methods, Introduction, etc.)
    const bodyFull = bodyTexts.join("\n\n");
    const rawLines = bodyFull.split(/\n/);
    const lines = rawLines.map((l, i) => ({ i, text: l.replace(/\*\*/g,"").trim() })).filter(l => l.text.length > 0);
    const reHeading = /^(\d+)\.?\s+\S/, reSub = /^(\d+\.\d+)\.?\s+\S/, reSubSub = /^(\d+\.\d+\.\d+)\.?\s+\S/;
    // Plain-text heading: ≤5 words, no sentence-ending punctuation, matches known section names
    const knownHeadings = /^(introduction|background|methods?|materials?|patients?|results?|discussion|conclusions?|limitations?|data\s+source|patient\s+population|data\s+extraction|outcome\s+data|statistical\s+analysis|study\s+design|study\s+population|ethics|acknowledgements?|funding|conflicts?\s+of\s+interest|abbreviations?|supplementary|appendix)/i;
    const isPlainHeading = (t: string) => {
      const words = t.split(/\s+/).length;
      const noEndPunct = !/[.!?;]$/.test(t);
      const short = words <= 5;
      return short && noEndPunct && (knownHeadings.test(t) || (words <= 3 && /^[A-Z]/.test(t)));
    };
    const typeFor = (name: string) => {
      const n = name.toLowerCase();
      if (/method|patients|material|data\s+source|data\s+extract|statistical|study\s+design|study\s+pop|patient\s+pop|outcome/.test(n)) return "methods";
      if (/result/.test(n)) return "results";
      if (/discuss/.test(n)) return "discussion";
      if (/conclusion|limitation/.test(n)) return "conclusion";
      if (/introduction|background/.test(n)) return "introduction";
      return "other";
    };
    const body: any[] = [];
    let cur: any = null, sub: any = null;
    const pushP = (n: any) => {
      if (sub) sub.children.push(n);
      else if (cur) cur.children.push(n);
      else {
        // no current section — create intro
        const intro = body.find((s:any) => s.name === "Introduction");
        if (intro) intro.children.push(n);
        else body.push({ id: `nb_intro_${n.id}`, kind: "section", name: "Introduction", type: "introduction", children: [n] });
      }
    };
    lines.forEach((ln) => {
      const t = ln.text;
      if (reSubSub.test(t)) { sub = { id: `nb${ln.i}`, kind: "subheading", level: 3, name: t, type: typeFor(t), children: [] }; (cur ? cur.children : body).push(sub); return; }
      if (reSub.test(t)) { sub = { id: `nb${ln.i}`, kind: "subheading", level: 2, name: t, type: typeFor(t), children: [] }; (cur ? cur.children : body).push(sub); return; }
      if (reHeading.test(t)) { cur = { id: `nb${ln.i}`, kind: "section", name: t, type: typeFor(t), children: [] }; sub = null; body.push(cur); return; }
      // plain text heading detection
      if (isPlainHeading(t)) {
        // top-level known section → new section; otherwise subheading under current
        const isTopLevel = /^(introduction|background|methods?|materials?|results?|discussion|conclusions?|limitations?)$/i.test(t.trim());
        if (isTopLevel || !cur) {
          cur = { id: `nb${ln.i}`, kind: "section", name: t, type: typeFor(t), children: [] };
          sub = null; body.push(cur);
        } else {
          sub = { id: `nb${ln.i}`, kind: "subheading", level: 2, name: t, type: typeFor(t), children: [] };
          cur.children.push(sub);
        }
        return;
      }
      pushP({ id: `nb${ln.i}`, kind: "paragraph", text: t });
    });

    // If no sections found, treat all body blocks as flat paragraphs under Introduction
    if (body.length === 0 && bodyTexts.length > 0) {
      const children = bodyTexts.map((t, i) => ({ id: `nb${i}`, kind: "paragraph", text: t }));
      body.push({ id: "nb_intro", kind: "section", name: "Introduction", type: "introduction", children });
    }

    const references = referencesText
      ? { id: "nref", kind: "references", text: referencesText }
      : null;

    return { front, body, references };
  };

  const confirmLabeling = () => {
    const tree = buildTreeFromLabels();
    setV2Tree(tree);
    setV2Phase("segregate");
  };

  const v2OpenReview = () => {
    setManuscript((prev: any) => ({ ...prev, status: "completed" }));
    setV2Phase("review");
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

  // ---- Inline QA editing: update a sentence's edited text ----
  const saveEdit = (section: string, index: number, newText: string) => {
    setResult((prev: any) => {
      if (!prev?.sentences) return prev;
      const updated = { ...prev, sentences: prev.sentences.map((s: any) => ({ ...s })) };
      // Find the Nth sentence of this section
      let counter = -1;
      for (let i = 0; i < updated.sentences.length; i++) {
        const s = updated.sentences[i];
        const sSection = s.section || "body";
        if (sSection === section) {
          counter++;
          if (counter === index) {
            updated.sentences[i].edited = newText;
            updated.sentences[i].changed =
              (updated.sentences[i].original || "").trim() !== newText.trim();
            updated.sentences[i].qaEdited = true;
            break;
          }
        }
      }
      try {
        sessionStorage.setItem(`result_${params.id}`, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setEditingKey(null);
    setEditDraft("");
  };

  const beginEdit = (key: string, currentText: string) => {
    setEditingKey(key);
    setEditDraft(currentText);
  };

  // Paragraph-aware save: replace all sentences of a paragraph (identified by their originals) with one edited block
  const saveParaEdit = (firstIdx: number, paraSentenceOriginals: string[], newText: string) => {
    setResult((prev: any) => {
      if (!prev?.sentences) return prev;
      const origSet = new Set(paraSentenceOriginals.map((o: string) => (o || "").trim()));
      const newSentences: any[] = [];
      let inserted = false;
      let bodyCounter = -1;
      for (const s of prev.sentences) {
        const sSection = s.section || "body";
        if (sSection === "body") {
          bodyCounter++;
          if (origSet.has((s.original || "").trim())) {
            // Replace the whole paragraph with a single combined sentence on first hit
            if (!inserted) {
              newSentences.push({
                ...s,
                original: paraSentenceOriginals.join(" ").trim(),
                edited: newText,
                changed: paraSentenceOriginals.join(" ").trim() !== newText.trim(),
                qaEdited: true,
              });
              inserted = true;
            }
            // skip the other sentences of this paragraph
            continue;
          }
        }
        newSentences.push(s);
      }
      const updated = { ...prev, sentences: newSentences };
      try { sessionStorage.setItem(`result_${params.id}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
    setEditingKey(null);
    setEditDraft("");
  };

  // Re-edit a single sentence via AI (with optional custom instruction)
  const reeditSentence = async (section: string, index: number, original: string, currentEdit: string) => {
    setReeditLoading(true);
    try {
      const response = await fetch("/api/reedit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original,
          currentEdit,
          instruction: reeditInstruction,
          section,
        }),
      });
      const data = await response.json();
      if (data?.edited) {
        saveEdit(section, index, data.edited);
      }
    } catch (e) {
      console.error("Re-edit failed:", e);
    }
    setReeditLoading(false);
    setReeditKey(null);
    setReeditInstruction("");
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
  const bodyParagraphs = groupSentencesByParagraph(bodySentences, rawBodyText);

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
    ? abstractSentences.filter((s: any) => s.original && s.original.trim()).map((s: any) => stripLabel(s.original)).join(" ")
    : rawSections?.abstract || "";
  // For abstract edited: preserve **Label:** markers so Objective/Methods/Results/Conclusion show
  const abstractEdited = abstractSentences.length > 0
    ? abstractSentences.map((s: any) => {
        const e = (s.edited || s.original || "").replace(/\*\*/g, "").trim();
        // if this sentence has a label prefix (e.g. "Objective: ..."), keep it
        return e;
      }).filter(Boolean).join(" ")
    : "";
  const abstractChanged = abstractSentences.some((s: any) => s.changed);

  // Keywords
  const keywordsOriginal = stripLabel(keywordsSentences[0]?.original || rawSections?.keywords || "");
  const keywordsEdited = sortKeywords(stripLabel(keywordsSentences[0]?.edited || keywordsOriginal));
  const keywordsChanged = keywordsSentences[0]?.changed ||
    keywordsOriginal.trim() !== keywordsEdited.trim();

  const changedCount = allSentences.filter((s: any) => s.changed).length;
  const reviewFlags = manuscript?.status === "completed" ? detectIssues(allSentences) : [];
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

  // Compare View renderer — word-level diff like edit-PC
  const renderCompare = (original: string, edited: string) => {
    const parts = wordDiff(original, stripLabel(edited));
    return (
      <div style={{
        fontSize: "clamp(12px, 1.5vw, 13px)", lineHeight: 1.9,
        padding: "10px 14px", borderRadius: "6px",
        backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
        marginBottom: "6px", wordBreak: "break-word",
      }}>
        {parts.map((p, i) => {
          if (p.type === "same") return <span key={i} style={{ color: "var(--text-primary)" }}>{p.text}</span>;
          if (p.type === "del") return <span key={i} style={{ color: "#f87171", textDecoration: "line-through" }}>{p.text}</span>;
          return <span key={i} style={{ color: "#4ade80", textDecoration: "underline" }}>{p.text}</span>;
        })}
      </div>
    );
  };

  // Paragraph editable box — edits the whole paragraph, saves via saveParaEdit
  const renderEditablePara = (firstIdx: number, paraOriginals: string[], text: string) => {
    const key = `para-${firstIdx}`;
    const isEditing = editingKey === key;
    if (isEditing) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "3px" }}>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", minHeight: "120px", fontSize: "clamp(12px, 1.5vw, 13px)",
              lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px",
              backgroundColor: "rgba(34,197,94,0.06)", border: "1px solid #22c55e",
              color: "var(--text-primary)", outline: "none", resize: "vertical",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => saveParaEdit(firstIdx, paraOriginals, editDraft)} style={{
              fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
              border: "none", backgroundColor: "#22c55e", color: "#fff", cursor: "pointer",
            }}>Save</button>
            <button onClick={() => { setEditingKey(null); setEditDraft(""); }} style={{
              fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
              border: "1px solid var(--border)", backgroundColor: "var(--bg)",
              color: "var(--text-secondary)", cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      );
    }
    const isReediting = reeditKey === key;
    return (
      <div style={{ marginBottom: "3px" }}>
        <div style={{ ...EDITED, position: "relative", display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <div onClick={() => beginEdit(key, text)} title="Click to edit paragraph" style={{ flex: 1, cursor: "text" }}>{text}</div>
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            <button onClick={() => beginEdit(key, text)} title="Edit manually" style={{
              background: "transparent", border: "none", cursor: "pointer", fontSize: "12px", color: "var(--text-muted)", padding: "0 2px",
            }}>✎</button>
            <button onClick={() => { setReeditKey(isReediting ? null : key); setReeditInstruction(""); }} title="Re-edit with AI" style={{
              background: "transparent", border: "none", cursor: "pointer", fontSize: "12px",
              color: isReediting ? "var(--accent)" : "var(--text-muted)", padding: "0 2px",
            }}>↻</button>
          </div>
        </div>
        {isReediting && (
          <div style={{
            marginTop: "4px", padding: "10px 12px", borderRadius: "8px",
            backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
            display: "flex", flexDirection: "column", gap: "8px",
          }}>
            <input type="text" value={reeditInstruction} onChange={(e) => setReeditInstruction(e.target.value)}
              placeholder="Optional instruction (e.g. 'make more concise')"
              style={{
                width: "100%", fontSize: "12px", padding: "6px 10px", borderRadius: "6px",
                backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
              }} />
            <div style={{ display: "flex", gap: "6px" }}>
              <button disabled={reeditLoading}
                onClick={async () => {
                  setReeditLoading(true);
                  try {
                    const response = await fetch("/api/reedit", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ original: paraOriginals.join(" "), currentEdit: text, instruction: reeditInstruction, section: "paragraph" }),
                    });
                    const data = await response.json();
                    if (data?.edited) saveParaEdit(firstIdx, paraOriginals, data.edited);
                  } catch (e) { console.error(e); }
                  setReeditLoading(false); setReeditKey(null); setReeditInstruction("");
                }}
                style={{
                  fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                  border: "none", backgroundColor: "var(--accent)", color: "#fff",
                  cursor: reeditLoading ? "wait" : "pointer", opacity: reeditLoading ? 0.6 : 1,
                }}>{reeditLoading ? "Re-editing..." : "↻ Re-edit with AI"}</button>
              <button onClick={() => { setReeditKey(null); setReeditInstruction(""); }} style={{
                fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg)",
                color: "var(--text-secondary)", cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Editable green box — click to edit the AI's edited text for QA
  const renderEditableGreen = (
    section: string,
    index: number,
    text: string,
    extraStyle: React.CSSProperties = {},
    originalText: string = ""
  ) => {
    const key = `${section}-${index}`;
    const isEditing = editingKey === key;
    if (isEditing) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "3px" }}>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", minHeight: "80px", fontSize: "clamp(12px, 1.5vw, 13px)",
              lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px",
              backgroundColor: "rgba(34,197,94,0.06)", border: "1px solid #22c55e",
              color: "var(--text-primary)", outline: "none", resize: "vertical",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => saveEdit(section, index, editDraft)}
              style={{
                fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                border: "none", backgroundColor: "#22c55e", color: "#fff", cursor: "pointer",
              }}
            >Save</button>
            <button
              onClick={() => { setEditingKey(null); setEditDraft(""); }}
              style={{
                fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg)",
                color: "var(--text-secondary)", cursor: "pointer",
              }}
            >Cancel</button>
          </div>
        </div>
      );
    }
    // Re-edit panel open for this sentence
    const isReediting = reeditKey === key;

    return (
      <div style={{ marginBottom: "3px" }}>
        <div style={{ ...EDITED, ...extraStyle, position: "relative", display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <div
            onClick={() => beginEdit(key, text)}
            title="Click to edit"
            style={{ flex: 1, cursor: "text" }}
          >
            {text}
          </div>
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            <button
              onClick={() => beginEdit(key, text)}
              title="Edit manually"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: "12px", color: "var(--text-muted)", padding: "0 2px",
              }}
            >✎</button>
            <button
              onClick={() => { setReeditKey(isReediting ? null : key); setReeditInstruction(""); }}
              title="Re-edit with AI"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: "12px", color: isReediting ? "var(--accent)" : "var(--text-muted)", padding: "0 2px",
              }}
            >↻</button>
          </div>
        </div>

        {isReediting && (
          <div style={{
            marginTop: "4px", padding: "10px 12px", borderRadius: "8px",
            backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
            display: "flex", flexDirection: "column", gap: "8px",
          }}>
            <input
              type="text"
              value={reeditInstruction}
              onChange={(e) => setReeditInstruction(e.target.value)}
              placeholder="Optional instruction (e.g. 'make more concise', 'simplify')"
              style={{
                width: "100%", fontSize: "12px", padding: "6px 10px", borderRadius: "6px",
                backgroundColor: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                disabled={reeditLoading}
                onClick={() => reeditSentence(section, index, originalText || text, text)}
                style={{
                  fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                  border: "none", backgroundColor: "var(--accent)", color: "#fff",
                  cursor: reeditLoading ? "wait" : "pointer", opacity: reeditLoading ? 0.6 : 1,
                }}
              >{reeditLoading ? "Re-editing..." : "↻ Re-edit with AI"}</button>
              <button
                onClick={() => { setReeditKey(null); setReeditInstruction(""); }}
                style={{
                  fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg)",
                  color: "var(--text-secondary)", cursor: "pointer",
                }}
              >Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
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

          {/* Review Flags */}
          {manuscript?.status === "completed" && reviewFlags.length > 0 && (
            <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <p style={{ fontSize: "10px", fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  \u26a0 Review flags ({reviewFlags.length})
                </p>
                <button onClick={() => setShowFlags(!showFlags)} style={{
                  background: "transparent", border: "1px solid var(--border)", borderRadius: "6px",
                  padding: "1px 6px", cursor: "pointer", fontSize: "10px", color: "var(--text-muted)",
                }}>{showFlags ? "hide" : "show"}</button>
              </div>
              {showFlags && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {reviewFlags.map((f, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        const el = document.getElementById(`sent-${f.section}-${f.index}`);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      style={{
                        fontSize: "10px", padding: "6px 8px", borderRadius: "6px",
                        backgroundColor: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ color: "#f59e0b", fontWeight: 500, marginBottom: "2px", textTransform: "capitalize" }}>
                        {f.section} #{f.index + 1}
                      </div>
                      {f.issues.map((iss, k) => (
                        <div key={k} style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>\u2022 {iss}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
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
            {v2Phase === "idle" && manuscript?.status !== "completed" && manuscript?.status !== "error" && (
              <div style={{
                textAlign: "center", padding: "clamp(32px, 6vw, 60px) 20px",
                backgroundColor: "var(--bg-card)", borderRadius: "16px", border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>📄</div>
                <h3 style={{ fontSize: "clamp(16px, 2vw, 18px)", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                  Ready to proofread
                </h3>
                <p style={{ fontSize: "clamp(13px, 1.5vw, 14px)", color: "var(--text-muted)", marginBottom: "28px", maxWidth: "400px", margin: "0 auto 28px" }}>
                  Segregate the manuscript into sections, then send each part for editing when you choose.
                </p>
                <button onClick={handleProofread} disabled={processing} style={{
                  backgroundColor: "var(--accent)", color: "#fff", border: "none",
                  fontSize: "14px", fontWeight: 500, padding: "11px 28px",
                  borderRadius: "10px", cursor: processing ? "wait" : "pointer", opacity: processing ? 0.6 : 1,
                }}>{processing ? "Segregating…" : "Start segregation"}</button>
              </div>
            )}

            {/* ===== V2 PHASE 1: grouped send ===== */}
            {/* ===== STEP 2: MANUAL LABELING ===== */}
            {v2Phase === "label" && v2RawBlocks.length > 0 && (() => {
              const LABELS = [
                { key: "title", label: "Title", color: "#6366f1" },
                { key: "running_title", label: "Running Title", color: "#8b5cf6" },
                { key: "abstract", label: "Abstract", color: "#06b6d4" },
                { key: "keywords", label: "Keywords", color: "#10b981" },
                { key: "body", label: "Body", color: "var(--accent)" },
                { key: "references", label: "References", color: "#f59e0b" },
                { key: "skip", label: "Skip", color: "#6b7280" },
              ];
              const assigned = Object.keys(v2Labels).length;
              const hasTitle = Object.values(v2Labels).includes("title");
              const hasAbstract = Object.values(v2Labels).includes("abstract");
              const hasBody = Object.values(v2Labels).includes("body");
              const canConfirm = hasTitle && hasAbstract && hasBody;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "12px", backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)", fontSize: "12px", color: "var(--accent)", fontWeight: 500 }}>
                    Label each block below: what part of the document is it? Once Title, Abstract and Body are labeled, click <b>Confirm</b>.
                  </div>

                  {v2RawBlocks.map((block, idx) => {
                    const assigned = v2Labels[idx];
                    const labelInfo = LABELS.find(l => l.key === assigned);
                    return (
                      <div key={idx} style={{ marginBottom: "10px", padding: "10px 12px", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: `1px solid ${labelInfo ? labelInfo.color : "var(--border)"}`, transition: "border-color 0.2s" }}>
                        {/* label buttons */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                          {LABELS.map(l => (
                            <button key={l.key} onClick={() => setV2Labels(prev => ({ ...prev, [idx]: l.key }))}
                              style={{ fontSize: "11px", fontWeight: 500, padding: "3px 10px", borderRadius: "6px", border: `1px solid ${l.color}`, backgroundColor: assigned === l.key ? l.color : "transparent", color: assigned === l.key ? "#fff" : l.color, cursor: "pointer", transition: "all 0.15s" }}>
                              {l.label}
                            </button>
                          ))}
                          {assigned && (
                            <button onClick={() => setV2Labels(prev => { const n = { ...prev }; delete n[idx]; return n; })}
                              style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
                          )}
                        </div>
                        {/* block text preview */}
                        <div style={{ fontSize: "12px", lineHeight: 1.6, color: labelInfo ? "var(--text-primary)" : "var(--text-muted)", wordBreak: "break-word", maxHeight: "120px", overflowY: "auto", whiteSpace: "pre-wrap" }}>
                          {block.length > 400 ? block.slice(0, 400) + "…" : block}
                        </div>
                        {assigned && (
                          <div style={{ marginTop: "6px", fontSize: "10px", fontWeight: 600, color: labelInfo?.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            ✓ {labelInfo?.label}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ position: "sticky", bottom: 0, padding: "12px 0", backgroundColor: "var(--bg)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
                    <button onClick={confirmLabeling} disabled={!canConfirm}
                      style={{ fontSize: "13px", fontWeight: 600, padding: "10px 28px", borderRadius: "8px", border: "none", backgroundColor: canConfirm ? "#22c55e" : "var(--border)", color: "#fff", cursor: canConfirm ? "pointer" : "not-allowed" }}>
                      ✓ Confirm labeling
                    </button>
                    {!canConfirm && (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        Need: {!hasTitle ? "Title " : ""}{!hasAbstract ? "Abstract " : ""}{!hasBody ? "Body" : ""}
                      </span>
                    )}
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "auto" }}>
                      {Object.keys(v2Labels).length}/{v2RawBlocks.length} blocks labeled
                    </span>
                  </div>
                </div>
              );
            })()}

            {v2Phase === "segregate" && v2Tree && (() => {
              const fm = (k: string) => v2Tree.front.find((f: any) => f.kind === k);
              const titleN = fm("title"), rtN = fm("running_title"), absN = fm("abstract"), kwN = fm("keywords");
              const frontTexts = [titleN, rtN, absN].filter(Boolean).map((n: any) => n.text);
              const frontGroupNode = { id: "frontgroup", kind: "frontgroup", texts: frontTexts };
              const frontDone = [titleN, rtN, absN].filter(Boolean).some((n: any) => v2FindEdits(n.text).length > 0);
              const kwDone = kwN ? v2FindEdits(kwN.text).length > 0 : false;
              const frontSending = v2Sending.has("frontgroup");
              const kwSending = kwN ? v2Sending.has(kwN.id) : false;
              const redGreen = (orig: string, section?: string) => {
                const edits = v2FindEdits(orig, section);
                if (!edits.length) return null;
                // For abstract: collect all labeled parts and show original once at top + all edited parts
                if (section === "abstract") {
                  const firstOrig = edits.find((s: any) => s.original && s.original.trim().length > 0);
                  // Render each labeled part separately so Objective/Methods/Results/Conclusion show
                  const labeledParts = edits.filter((s: any) => s.isLabeledPart || s.edited);
                  const hasLabels = labeledParts.some((s: any) => /^(Objective|Methods?|Results?|Conclusions?|Background|Aims?|Purpose)[:\s]/i.test((s.edited || "").replace(/\*\*/g, "")));
                  return (
                    <div style={{ marginBottom: "3px" }}>
                      {firstOrig && <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "3px", wordBreak: "break-word" }}>{firstOrig.original}</div>}
                      <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", wordBreak: "break-word" }}>
                        {hasLabels
                          ? labeledParts.map((s: any, i: number) => {
                              const text = (s.edited || "").replace(/\*\*/g, "").trim();
                              return <div key={i} style={{ marginBottom: i < labeledParts.length - 1 ? "6px" : 0 }}>{text}</div>;
                            })
                          : <span>{edits.map((s: any) => (s.edited || "").replace(/\*\*/g, "").trim()).filter(Boolean).join(" ")}</span>
                        }
                      </div>
                    </div>
                  );
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {edits.filter((s: any) => s.original || s.edited).map((s: any, i: number) => (
                      <div key={i} style={{ marginBottom: "3px" }}>
                        {s.changed && s.original && s.original.trim() && <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "3px", wordBreak: "break-word" }}>{s.original}</div>}
                        <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", wordBreak: "break-word" }}>{stripLabel(s.edited || s.original)}</div>
                      </div>
                    ))}
                  </div>
                );
              };
              const rawBox = (t: string, bold = false) => <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "var(--bg-card)", borderLeft: "2px solid var(--border)", color: "var(--text-secondary)", marginBottom: "3px", wordBreak: "break-word", fontWeight: bold ? 600 : 400 }}>{t}</div>;
              const renderBodyNode = (node: any, depth: number): any => {
                const indent = depth * 16;
                const isSel = v2Selected.has(node.id);
                const isSending = v2Sending.has(node.id);
                const done = v2NodeDone(node);
                if (node.kind === "paragraph") {
                  const nodeEdits = done ? v2FindEdits(node.text) : [];
                  return (
                    <div key={node.id} style={{ marginLeft: indent, marginBottom: "6px", display: "flex", gap: "8px" }}>
                      {!done && <input type="checkbox" checked={isSel} onChange={() => v2Toggle(node)} style={{ marginTop: "9px", flexShrink: 0 }} />}
                      <div style={{ flex: 1 }}>
                        {isSending ? rawBox("▶ editing…") : done && nodeEdits.length ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                            {nodeEdits.filter((s: any) => s.original || s.edited).map((s: any, si: number) => (
                              <div key={si}>
                                {s.changed && s.original && s.original.trim() && <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239,68,68,0.07)", borderLeft: "2px solid #ef4444", color: "#f87171", textDecoration: "line-through", marginBottom: "3px", wordBreak: "break-word" }}>{s.original}</div>}
                                <div style={{ fontSize: "13px", lineHeight: 1.7, padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(34,197,94,0.07)", borderLeft: "2px solid #22c55e", color: "#4ade80", wordBreak: "break-word" }}>{stripLabel(s.edited || s.original)}</div>
                              </div>
                            ))}
                          </div>
                        ) : rawBox(node.text)}
                      </div>
                    </div>
                  );
                }
                const isSection = node.kind === "section";
                return (
                  <div key={node.id} style={{ marginLeft: indent, marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <input type="checkbox" checked={isSel} onChange={() => v2Toggle(node)} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: isSection ? "14px" : "13px", fontWeight: 600, color: isSection ? "var(--text-primary)" : "var(--text-secondary)" }}>{node.name}{done ? " ✓" : ""}</span>
                      <button onClick={() => v2SendNode(node)} disabled={isSending} style={{ fontSize: "11px", fontWeight: 500, padding: "3px 10px", borderRadius: "6px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: isSending ? "wait" : "pointer", opacity: isSending ? 0.6 : 1 }}>{isSending ? "Editing…" : done ? "↻ Re-send" : "↳ Send for edit"}</button>
                    </div>
                    {node.kind === "subheading" && node.name && (v2FindEdits(node.name).length ? redGreen(node.name) : rawBox(node.name, true))}
                    <div>{(node.children || []).map((c: any) => renderBodyNode(c, depth + 1))}</div>
                  </div>
                );
              };
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "12px", backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)", fontSize: "12px", color: "var(--accent)", fontWeight: 500 }}>
                    ☑ Segregated (no AI used yet). Send Title/Abstract together, Keywords for ordering, and pick Body chunks. Sent parts turn red→green. When done, click <b>Open full review</b>.
                  </div>

                  {/* SECTION 1: title + running title + abstract */}
                  <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Title · Running Title · Abstract{frontDone ? " ✓" : ""}</span>
                      <button onClick={() => v2SendNode(frontGroupNode)} disabled={frontSending} style={{ fontSize: "11px", fontWeight: 500, padding: "3px 12px", borderRadius: "6px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: frontSending ? "wait" : "pointer", opacity: frontSending ? 0.6 : 1 }}>{frontSending ? "Editing…" : frontDone ? "↻ Re-send" : "↳ Send all three"}</button>
                    </div>
                    <div style={{ marginBottom: "4px" }}>
                      <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "6px 0 3px" }}>Title</p>
                      {titleN && (v2FindEdits(titleN.text, "title").length ? redGreen(titleN.text, "title") : rawBox(titleN.text, true))}
                    </div>
                    <div style={{ marginBottom: "4px" }}>
                      <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "6px 0 3px" }}>Running Title</p>
                      {rtN && (v2FindEdits(rtN.text, "running_title").length ? redGreen(rtN.text, "running_title") : rawBox(rtN.text))}
                    </div>
                    <div>
                      <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "6px 0 3px" }}>Abstract</p>
                      {absN && (v2FindEdits(absN.text, "abstract").length ? redGreen(absN.text, "abstract") : rawBox(absN.text))}
                    </div>
                  </div>

                  {/* SECTION 2: keywords */}
                  {kwN && (
                    <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Keywords{kwDone ? " ✓" : ""}</span>
                        <button onClick={() => v2SendNode(kwN)} disabled={kwSending} style={{ fontSize: "11px", fontWeight: 500, padding: "3px 12px", borderRadius: "6px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: kwSending ? "wait" : "pointer", opacity: kwSending ? 0.6 : 1 }}>{kwSending ? "Editing…" : kwDone ? "↻ Re-send" : "↳ Send (alphabetize)"}</button>
                      </div>
                      <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "6px 0 3px" }}>Keywords</p>
                      {v2FindEdits(kwN.text, "keywords").length ? redGreen(kwN.text, "keywords") : rawBox(kwN.text)}
                    </div>
                  )}

                  {/* SECTION 3: body chunks */}
                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Body</span>
                      {v2Selected.size > 0 && (
                        <>
                          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{v2Selected.size} selected</span>
                          <button onClick={v2SendSelectedBody} style={{ fontSize: "11px", fontWeight: 500, padding: "3px 12px", borderRadius: "6px", border: "none", backgroundColor: "var(--accent)", color: "#fff", cursor: "pointer" }}>↳ Send selected</button>
                          <button onClick={() => setV2Selected(new Set())} style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>Clear</button>
                        </>
                      )}
                    </div>
                    {v2Tree.body.map((s: any) => renderBodyNode(s, 0))}
                  </div>

                  {v2Tree.references && (
                    <div style={{ marginTop: "12px" }}>
                      <p style={SECTION_LABEL}>References (preserved — not edited)</p>
                      <div style={{ fontSize: "12px", lineHeight: 1.8, padding: "12px 16px", borderRadius: "6px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "220px", overflowY: "auto" }}>{v2Tree.references.text}</div>
                    </div>
                  )}

                  {/* Open full review */}
                  <div style={{ marginTop: "20px", display: "flex", justifyContent: "center" }}>
                    <button onClick={v2OpenReview} disabled={(result?.sentences || []).length === 0} style={{ fontSize: "14px", fontWeight: 600, padding: "11px 28px", borderRadius: "10px", border: "none", backgroundColor: (result?.sentences || []).length ? "#22c55e" : "var(--border)", color: "#fff", cursor: (result?.sentences || []).length ? "pointer" : "not-allowed" }}>✓ Done — open full review</button>
                  </div>
                </div>
              );
            })()}

            {/* DOCUMENT PREVIEW — processing and rechecking (unused in v2, kept harmless) */}
            {v2Phase === "review" && isShowingDocument && rawSections && manuscript?.status !== "completed" && (
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
            {v2Phase === "review" && manuscript?.status === "completed" && result && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>

                {/* QA hint */}
                <div style={{
                  padding: "10px 14px", borderRadius: "8px", marginBottom: "8px",
                  backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                  fontSize: "12px", color: "var(--accent)", fontWeight: 500,
                }}>
                  ✎ Click any green (edited) text to adjust it before exporting. Your changes are saved automatically.
                </div>

                {/* TITLE */}
                <p style={SECTION_LABEL}>Title</p>
                {titleChanged ? (
                  viewMode === "compare" ? renderCompare(titleOriginal, titleEdited) : (
                    <><div style={ORIGINAL}>{titleOriginal}</div>{renderEditableGreen("title", 0, titleEdited, {}, titleOriginal)}</>
                  )
                ) : (
                  <div style={{ ...UNCHANGED, fontWeight: 600 }}>{titleOriginal}</div>
                )}

                {/* RUNNING TITLE */}
                {runningTitleOriginal && (<>
                  <p style={SECTION_LABEL}>Running title</p>
                  {runningTitleChanged ? (
                    viewMode === "compare" ? renderCompare(runningTitleOriginal, runningTitleEdited) : (
                      <><div style={ORIGINAL}>{runningTitleOriginal}</div>{renderEditableGreen("running_title", 0, runningTitleEdited, {}, runningTitleOriginal)}</>
                    )
                  ) : (
                    <div style={UNCHANGED}>{runningTitleOriginal}</div>
                  )}
                </>)}

                {/* ABSTRACT */}
                {abstractOriginal && (<>
                  <p style={SECTION_LABEL}>Abstract</p>
                  {abstractChanged ? (
                    viewMode === "compare" ? renderCompare(abstractOriginal, abstractEdited) : (
                      <>
                        <div style={ORIGINAL}>{abstractOriginal}</div>
                        {abstractSentences.some((s: any) => s.isLabeledPart) ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {abstractSentences.filter((s: any) => s.edited).map((s: any, i: number) => (
                              <div key={i} style={{ ...EDITED as any }}>
                                {(s.edited || "").replace(/\*\*/g, "").trim()}
                              </div>
                            ))}
                          </div>
                        ) : (
                          renderEditableGreen("abstract", 0, abstractEdited, {}, abstractOriginal)
                        )}
                      </>
                    )
                  ) : (
                    <div style={UNCHANGED}>{abstractOriginal}</div>
                  )}
                </>)}

                {/* KEYWORDS */}
                {keywordsOriginal && (<>
                  <p style={SECTION_LABEL}>Keywords</p>
                  {keywordsChanged ? (
                    viewMode === "compare" ? renderCompare(keywordsOriginal, keywordsEdited) : (
                      <><div style={ORIGINAL}>{keywordsOriginal}</div>{renderEditableGreen("keywords", 0, keywordsEdited, {}, keywordsOriginal)}</>
                    )
                  ) : (
                    <div style={UNCHANGED}>{keywordsEdited}</div>
                  )}
                </>)}

                {/* BODY */}
                {bodySentences.length > 0 && (<>
                  <p style={SECTION_LABEL}>Document body — {changedCount} edits</p>

                  {groupMode === "sentence" ? (
                    /* SENTENCE MODE — one box per sentence */
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      {bodySentences.map((s: any, i: number) => (
                        s.changed ? (
                          <div key={i} id={`sent-body-${i}`}>
                            {viewMode === "compare" ? (
                              renderCompare(s.original, s.edited)
                            ) : (
                              <>
                                <div style={ORIGINAL}>{s.original}</div>
                                {renderEditableGreen("body", i, s.edited, {}, s.original)}
                              </>
                            )}
                          </div>
                        ) : (
                          <div key={i} id={`sent-body-${i}`} style={UNCHANGED}>{s.original}</div>
                        )
                      ))}
                    </div>
                  ) : (
                    /* PARAGRAPH MODE — group sentences into original paragraphs */
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {bodyParagraphs.map((para: any[], pi: number) => {
                        const paraOriginal = para.map((s: any) => s.original || "").join(" ").trim();
                        const paraEdited = para.map((s: any) => s.edited || s.original || "").join(" ").trim();
                        const paraChanged = para.some((s: any) => s.changed);
                        // global index of first sentence in this paragraph (for edit key)
                        const firstIdx = bodySentences.indexOf(para[0]);
                        const paraOriginals = para.map((s: any) => s.original || "");
                        return (
                          <div key={pi} id={`sent-body-${firstIdx}`}>
                            {!paraChanged ? (
                              <div style={UNCHANGED}>{paraOriginal}</div>
                            ) : viewMode === "compare" ? (
                              renderCompare(paraOriginal, paraEdited)
                            ) : (
                              <>
                                <div style={ORIGINAL}>{paraOriginal}</div>
                                {renderEditablePara(firstIdx, paraOriginals, paraEdited)}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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
              display: "flex", flexDirection: "column", gap: "10px",
              position: "sticky", bottom: 0,
            }}>
              {/* View + grouping toggles */}
              <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>View:</span>
                  <button onClick={() => setViewMode("edited")} style={{
                    fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                    border: `1px solid ${viewMode === "edited" ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: viewMode === "edited" ? "var(--accent-light)" : "transparent",
                    color: viewMode === "edited" ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}>Edited view</button>
                  <button onClick={() => setViewMode("compare")} style={{
                    fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                    border: `1px solid ${viewMode === "compare" ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: viewMode === "compare" ? "var(--accent-light)" : "transparent",
                    color: viewMode === "compare" ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}>Compare view</button>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>Group:</span>
                  <button onClick={() => setGroupMode("paragraph")} style={{
                    fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                    border: `1px solid ${groupMode === "paragraph" ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: groupMode === "paragraph" ? "var(--accent-light)" : "transparent",
                    color: groupMode === "paragraph" ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}>Paragraph</button>
                  <button onClick={() => setGroupMode("sentence")} style={{
                    fontSize: "12px", fontWeight: 500, padding: "5px 14px", borderRadius: "6px",
                    border: `1px solid ${groupMode === "sentence" ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: groupMode === "sentence" ? "var(--accent-light)" : "transparent",
                    color: groupMode === "sentence" ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}>Sentence</button>
                </div>
              </div>

              {/* Download buttons */}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
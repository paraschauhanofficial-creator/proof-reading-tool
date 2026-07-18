import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  PROOFREAD_SYSTEM_PROMPT,
  buildProofreadPrompt,
  STRUCTURE_DETECTION_PROMPT,
  buildStructurePrompt,
} from "@/lib/proofread-prompt";

export const dynamic = "force-dynamic";

const MODEL = "gpt-5.6-luna";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ---------- helpers ----------

function separateReferences(text: string): { mainText: string; references: string } {
  const refPatterns = [
    /\n\s*references\s*\n/i,
    /\n\s*bibliography\s*\n/i,
    /\n\s*works cited\s*\n/i,
    /\n\s*reference\s*\n/i,
  ];
  for (const pattern of refPatterns) {
    const match = text.search(pattern);
    if (match !== -1) {
      return { mainText: text.slice(0, match).trim(), references: text.slice(match).trim() };
    }
  }
  return { mainText: text, references: "" };
}

function wordChunk(text: string, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }
  return chunks.length ? chunks : [text];
}

function condenseForStructure(mainText: string): string {
  const paras = mainText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return paras
    .map(p => {
      const words = p.split(/\s+/);
      return words.slice(0, 25).join(" ");
    })
    .join("\n");
}

function extractFrontMatter(mainText: string) {
  const lines = mainText.split("\n").map(l => l.trim()).filter(Boolean);
  let title = lines[0] || "";
  let runningTitle = "";
  let bodyStartIdx = 1;

  for (let k = 1; k < Math.min(8, lines.length); k++) {
    if (/^running\s*title[:\s]/i.test(lines[k])) {
      runningTitle = lines[k].replace(/^running\s*title[:\s]*/i, "").trim();
      bodyStartIdx = k + 1;
      break;
    }
  }

  let abstract = "";
  let keywords = "";
  const abstractIdx = lines.findIndex((l, i) => i >= bodyStartIdx && /^\[?abstract\]?[:\s]?/i.test(l));
  let afterAbstractIdx = bodyStartIdx;

  if (abstractIdx !== -1) {
    const abstractLines: string[] = [];
    const firstLine = lines[abstractIdx].replace(/^\[?abstract\]?[:\s]*/i, "").trim();
    if (firstLine) abstractLines.push(firstLine);
    let i = abstractIdx + 1;
    while (i < lines.length) {
      if (/^\[?keywords?\]?[:\s]/i.test(lines[i]) || /^keywords?:/i.test(lines[i])) break;
      abstractLines.push(lines[i]);
      i++;
    }
    abstract = abstractLines.join(" ").trim();
    afterAbstractIdx = i;
  }

  const kwIdx = lines.findIndex((l, i) => i >= afterAbstractIdx && /^\[?keywords?\]?[:\s]/i.test(l));
  let bodyFromIdx = afterAbstractIdx;
  if (kwIdx !== -1) {
    keywords = lines[kwIdx].replace(/^\[?keywords?\]?[:\s]*/i, "").trim();
    bodyFromIdx = kwIdx + 1;
  }

  const body = lines.slice(bodyFromIdx).join("\n");
  return { title, runningTitle, abstract, keywords, body };
}

// ---------- abstract label helpers ----------

// Detect & separate abstract into labeled sections (when labels ARE present with colons)
function separateAbstractLabels(abstractText: string): { label: string; text: string }[] | null {
  const clean = abstractText.replace(/^\[?abstract\]?[:\s]*/i, "").trim();
  const labels = ["Background", "Objective", "Objectives", "Aim", "Aims", "Purpose", "Methods", "Method", "Materials and Methods", "Results", "Conclusion", "Conclusions"];
  const labelPattern = new RegExp(`(?:^|[.\\s])(${labels.join("|")})\\s*[:：]`, "gi");
  const matches = [...clean.matchAll(labelPattern)];
  if (matches.length < 2) return null;
  const sections: { label: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const matchStart = matches[i].index!;
    const labelEnd = matchStart + matches[i][0].length;
    const end = i < matches.length - 1 ? matches[i + 1].index! : clean.length;
    const text = clean.slice(labelEnd, end).trim();
    sections.push({
      label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
      text,
    });
  }
  return sections;
}

// Detect labels present in the original abstract, in order
function detectAbstractLabelsInOrder(abstractText: string): string[] {
  const clean = abstractText.replace(/^\[?abstract\]?[:\s]*/i, "").trim();
  const labels = ["Background", "Objective", "Objectives", "Aim", "Aims", "Purpose", "Methods", "Method", "Materials and Methods", "Results", "Conclusion", "Conclusions"];
  const labelPattern = new RegExp(`(?:^|[.\\s])(${labels.join("|")})\\s*[:：]`, "gi");
  const matches = [...clean.matchAll(labelPattern)];
  return matches.map(m => m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase());
}

// Re-attach labels to edited text by splitting into N parts by sentence boundaries
function reattachLabels(editedText: string, labels: string[]): { label: string; text: string }[] {
  const sentences = editedText.match(/[^.!?]+[.!?]+/g) || [editedText];
  const n = labels.length;
  const perLabel = Math.ceil(sentences.length / n);
  const sections: { label: string; text: string }[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * perLabel;
    const end = i === n - 1 ? sentences.length : (i + 1) * perLabel;
    const text = sentences.slice(start, end).join(" ").trim();
    if (text) sections.push({ label: labels[i], text });
  }
  return sections.length >= 2 ? sections : [];
}

// Slice body into sections using AI-detected anchors
function sliceBodyIntoSections(body: string, sections: any[]): { name: string; type: string; text: string }[] {
  if (!sections.length) {
    return [{ name: "Body", type: "other", text: body }];
  }
  const bodyNorm = body.toLowerCase();
  const positioned = sections.map((sec) => {
    const anchor = (sec.startText || "").toLowerCase().trim().replace(/\s+/g, " ");
    let idx = -1;
    if (anchor.length > 10) {
      idx = bodyNorm.indexOf(anchor.substring(0, 40));
    }
    return { ...sec, idx };
  }).filter(s => s.idx !== -1).sort((a, b) => a.idx - b.idx);

  if (!positioned.length) {
    return [{ name: "Body", type: "other", text: body }];
  }

  const result: { name: string; type: string; text: string }[] = [];
  for (let i = 0; i < positioned.length; i++) {
    const start = positioned[i].idx;
    const end = i < positioned.length - 1 ? positioned[i + 1].idx : body.length;
    result.push({
      name: positioned[i].name || `Section ${i + 1}`,
      type: positioned[i].type || "other",
      text: body.slice(start, end).trim(),
    });
  }
  if (positioned[0].idx > 30) {
    result.unshift({ name: "Introduction", type: "introduction", text: body.slice(0, positioned[0].idx).trim() });
  }
  return result;
}


// ---------- DETERMINISTIC SEGREGATION (no AI) — for v2 picker ----------
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

// ---------- AI calls ----------

async function detectStructure(condensed: string): Promise<any[]> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: STRUCTURE_DETECTION_PROMPT },
        { role: "user", content: buildStructurePrompt(condensed) },
      ],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return Array.isArray(parsed.sections) ? parsed.sections : [];
  } catch (e) {
    console.error("Structure detection error:", e);
    return [];
  }
}

async function editSection(
  content: string,
  sectionName: string,
  sectionType: string
): Promise<{ sentences: any[]; summary: any }> {
  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: PROOFREAD_SYSTEM_PROMPT },
      { role: "user", content: buildProofreadPrompt(content, sectionName, sectionType) },
    ],
    max_completion_tokens: 16000,
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  return {
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
    summary: parsed.summary || {},
  };
}

async function editTitleAndRunningTitle(
  titleText: string,
  runningTitleText: string,
  contextText: string
): Promise<{ title: any; runningTitle: any }> {
  const titlePrompt = `You are an expert medical journal editor. Rewrite the manuscript TITLE and RUNNING TITLE to publication quality. You MUST make a substantive, meaningful rewrite — returning a near-identical title is a failure.

CONTEXT (first part of the paper, to understand the core comparison/intervention):
${contextText.slice(0, 1500)}

TITLE RULES:
- Identify the CORE contrast/intervention/finding and build the title around it (e.g., "Effects of Underbody Versus Upper-Body Forced-Air Warming on...")
- State intervention/comparison + outcome + population + study design
- Replace vague words ("different sites", "the value of") with the specific comparison
- "The Value of X in Y" -> "Association of X with Y"; "reveals" -> "identifies"
- Add population explicitly; add design where evident (": A Randomized Controlled Trial")
- Person-first: "Lung Cancer Patients" -> "Patients with Lung Cancer"; Title case
- The edited title MUST differ substantially from the original

RUNNING TITLE RULES:
- Concise, sentence case, capture the core comparison; use accepted abbreviations; under ~70 characters

Return ONLY valid JSON:
{ "title": { "original": "...", "edited": "...", "changed": true },
  "running_title": { "original": "...", "edited": "...", "changed": true } }

ORIGINAL TITLE: ${titleText}
ORIGINAL RUNNING TITLE: ${runningTitleText}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: titlePrompt }],
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return { title: parsed.title || null, runningTitle: parsed.running_title || null };
  } catch (e) {
    console.error("Title edit error:", e);
    return { title: null, runningTitle: null };
  }
}

async function editKeywords(keywordsText: string): Promise<any> {
  if (!keywordsText) return null;
  const kwPrompt = `Reorder and format these medical manuscript keywords per APA style:
- Alphabetical order (case-insensitive)
- Lowercase except proper nouns and established abbreviations (HBV, EEG, DALYs, HAMA)
- Semicolon separated with a space after each semicolon

Return ONLY valid JSON:
{ "original": "...", "edited": "...", "changed": true }

KEYWORDS: ${keywordsText}`;
  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: kwPrompt }],
      max_completion_tokens: 800,
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (e) {
    console.error("Keywords edit error:", e);
    return null;
  }
}

// ---------- main handler ----------

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const mode: string = reqBody.mode || "";

    // ===== MODE: SEGREGATE (deterministic, no AI) =====
    if (mode === "segregate") {
      const text: string = reqBody.manuscriptText || "";
      if (!text) return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
      return NextResponse.json({ success: true, tree: segregateTree(text) });
    }

    // ===== MODE: EDIT ONE CHUNK (v2 grouped/section send) =====
    if (mode === "editChunk") {
      const chunk: string = reqBody.chunk || "";
      const kind: string = reqBody.kind || "body"; // title | running_title | abstract | keywords | frontgroup | body
      const sectionName: string = reqBody.sectionName || "Section";
      const sectionType: string = reqBody.sectionType || "other";
      if (!chunk.trim()) return NextResponse.json({ error: "No chunk text" }, { status: 400 });

      // frontgroup = title + running title + abstract sent together
      if (kind === "frontgroup") {
        const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
        const titleText = lines[0] || "";
        const rtLine = lines.find(l => /^running\s*title[:\s]/i.test(l)) || "";
        const runningTitleText = rtLine.replace(/^running\s*title[:\s]*/i, "").trim();
        // Find abstract: first try [Abstract] prefix, then fall back to content after running title
        const absLine = lines.find(l => /^\[?abstract\]?[:\s]?/i.test(l));
        let abstractText = "";
        if (absLine) {
          const absIdx = lines.indexOf(absLine);
          abstractText = lines.slice(absIdx).join(" ").replace(/^\[?abstract\]?[:\s]*/i, "").trim();
        } else {
          // No [Abstract] prefix - find where abstract content starts (after title and running title)
          const rtIdx = rtLine ? lines.indexOf(rtLine) : 0;
          const afterHeader = lines.slice(rtIdx + 1);
          // Skip any single-word heading like "Abstract"
          const contentStart = afterHeader.findIndex(l => l.split(/\s+/).length > 5);
          abstractText = contentStart >= 0 ? afterHeader.slice(contentStart).join(" ").trim() : afterHeader.join(" ").trim();
        }

        const out: any[] = [];
        const t = await editTitleAndRunningTitle(titleText, runningTitleText, chunk);
        if (t.title) out.push({ original: t.title.original || titleText, edited: t.title.edited || titleText, changed: t.title.changed ?? true, section: "title" });
        if (t.runningTitle) out.push({ original: t.runningTitle.original || runningTitleText, edited: t.runningTitle.edited || runningTitleText, changed: t.runningTitle.changed ?? true, section: "running_title" });
        if (abstractText) {
          const abs = await editSection(abstractText, "Abstract", "abstract");
          const editedParts = abs.sentences.map((s: any) => (s.edited || s.original || "").replace(/\*\*/g, "").trim()).filter(Boolean);
          const deduped: string[] = [];
          for (const p of editedParts) if (!deduped.includes(p)) deduped.push(p);
          const combined = deduped.join(" ");
          const origLabels = detectAbstractLabelsInOrder(abstractText);
          let labeled: { label: string; text: string }[] | null = separateAbstractLabels(combined);
          if ((!labeled || labeled.length < 2) && origLabels.length >= 2) labeled = reattachLabels(combined, origLabels);
          if (labeled && labeled.length >= 2) {
            labeled.forEach((sec, i) => out.push({ original: i === 0 ? abstractText : "", edited: `**${sec.label}:** ${sec.text}`, changed: true, section: "abstract", isLabeledPart: true }));
          } else {
            out.push({ original: abstractText, edited: combined || abstractText, changed: combined !== abstractText, section: "abstract" });
          }
        }
        return NextResponse.json({ success: true, result: { sentences: out, summary: {} } });
      }

      if (kind === "title" || kind === "running_title") {
        const t = await editTitleAndRunningTitle(kind === "title" ? chunk : "", kind === "running_title" ? chunk : "", reqBody.context || chunk);
        const out: any[] = [];
        if (kind === "title" && t.title) out.push({ original: t.title.original || chunk, edited: t.title.edited || chunk, changed: t.title.changed ?? true, section: "title" });
        if (kind === "running_title" && t.runningTitle) out.push({ original: t.runningTitle.original || chunk, edited: t.runningTitle.edited || chunk, changed: t.runningTitle.changed ?? true, section: "running_title" });
        return NextResponse.json({ success: true, result: { sentences: out, summary: {} } });
      }

      if (kind === "keywords") {
        const kw = await editKeywords(chunk);
        const out = kw ? [{ original: kw.original || chunk, edited: kw.edited || chunk, changed: kw.changed ?? true, section: "keywords" }] : [];
        return NextResponse.json({ success: true, result: { sentences: out, summary: {} } });
      }

      if (kind === "abstract") {
        const abs = await editSection(chunk, "Abstract", "abstract");
        const editedParts = abs.sentences.map((s: any) => (s.edited || s.original || "").replace(/\*\*/g, "").trim()).filter(Boolean);
        const deduped: string[] = [];
        for (const p of editedParts) if (!deduped.includes(p)) deduped.push(p);
        const combined = deduped.join(" ");
        const origLabels = detectAbstractLabelsInOrder(chunk);
        let labeled: { label: string; text: string }[] | null = separateAbstractLabels(combined);
        if ((!labeled || labeled.length < 2) && origLabels.length >= 2) labeled = reattachLabels(combined, origLabels);
        const out: any[] = [];
        if (labeled && labeled.length >= 2) labeled.forEach((sec, i) => out.push({ original: i === 0 ? chunk : "", edited: `**${sec.label}:** ${sec.text}`, changed: true, section: "abstract", isLabeledPart: true }));
        else out.push({ original: chunk, edited: combined || chunk, changed: combined !== chunk, section: "abstract" });
        return NextResponse.json({ success: true, result: { sentences: out, summary: abs.summary } });
      }

      // body chunk
      const subChunks = wordChunk(chunk, 1000);
      const out: any[] = [];
      const sum: any = { grammar_corrections: 0, apa_corrections: 0, terminology_corrections: 0, consistency_improvements: 0, style_improvements: 0, total_edits: 0, key_changes: [] };
      for (let c = 0; c < subChunks.length; c++) {
        const edited = await editSection(subChunks[c], sectionName, sectionType);
        edited.sentences.forEach((s: any) => { s.section = "body"; });
        out.push(...edited.sentences);
        const s = edited.summary || {};
        sum.grammar_corrections += s.grammar_corrections || 0; sum.apa_corrections += s.apa_corrections || 0;
        sum.terminology_corrections += s.terminology_corrections || 0; sum.consistency_improvements += s.consistency_improvements || 0;
        sum.style_improvements += s.style_improvements || 0; sum.total_edits += s.total_edits || 0;
        if (s.key_changes) sum.key_changes.push(...s.key_changes);
        if (subChunks.length > 1 && c < subChunks.length - 1) await new Promise(r => setTimeout(r, 400));
      }
      sum.key_changes = [...new Set(sum.key_changes)].slice(0, 10);
      return NextResponse.json({ success: true, result: { sentences: out, summary: sum } });
    }

    // ===== LEGACY: FULL ONE-SHOT PIPELINE (original page) =====
    const { manuscriptText } = reqBody;
    if (!manuscriptText) {
      return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
    }

    const { mainText, references } = separateReferences(manuscriptText);
    const front = extractFrontMatter(mainText);

    const allSentences: any[] = [];
    const summaryTotals = {
      grammar_corrections: 0, apa_corrections: 0, terminology_corrections: 0,
      consistency_improvements: 0, style_improvements: 0, total_edits: 0,
      key_changes: [] as string[],
    };

    function mergeSummary(s: any) {
      if (!s) return;
      summaryTotals.grammar_corrections += s.grammar_corrections || 0;
      summaryTotals.apa_corrections += s.apa_corrections || 0;
      summaryTotals.terminology_corrections += s.terminology_corrections || 0;
      summaryTotals.consistency_improvements += s.consistency_improvements || 0;
      summaryTotals.style_improvements += s.style_improvements || 0;
      summaryTotals.total_edits += s.total_edits || 0;
      if (s.key_changes) summaryTotals.key_changes.push(...s.key_changes);
    }

    // 1. Structure detection
    console.log("Detecting structure...");
    const condensed = condenseForStructure(front.body);
    const sections = await detectStructure(condensed);
    console.log(`Detected ${sections.length} sections`);

    // 2. Title + running title
    if (front.title) {
      const t = await editTitleAndRunningTitle(front.title, front.runningTitle, front.body);
      if (t.title) {
        allSentences.push({
          original: t.title.original || front.title,
          edited: t.title.edited || front.title,
          changed: t.title.changed ?? true,
          section: "title",
        });
      }
      if (t.runningTitle) {
        allSentences.push({
          original: t.runningTitle.original || front.runningTitle,
          edited: t.runningTitle.edited || front.runningTitle,
          changed: t.runningTitle.changed ?? true,
          section: "running_title",
        });
      }
    }

    // 3. Abstract (edit, then re-attach labels from original if AI dropped them)
    if (front.abstract) {
      const abs = await editSection(front.abstract, "Abstract", "abstract");
      mergeSummary(abs.summary);

      const editedParts = abs.sentences
        .map((s: any) => (s.edited || s.original || "").replace(/\*\*/g, "").trim())
        .filter(Boolean);
      const deduped: string[] = [];
      for (const part of editedParts) {
        if (!deduped.includes(part)) deduped.push(part);
      }
      const combinedEdited = deduped.join(" ");

      const origLabels = detectAbstractLabelsInOrder(front.abstract);
      let labeledSections: { label: string; text: string }[] | null = separateAbstractLabels(combinedEdited);

      if ((!labeledSections || labeledSections.length < 2) && origLabels.length >= 2) {
        labeledSections = reattachLabels(combinedEdited, origLabels);
      }

      if (labeledSections && labeledSections.length >= 2) {
        labeledSections.forEach((sec, idx) => {
          allSentences.push({
            original: idx === 0 ? front.abstract : "",
            edited: `**${sec.label}:** ${sec.text}`,
            changed: true, section: "abstract", isLabeledPart: true,
          });
        });
      } else {
        allSentences.push({
          original: front.abstract,
          edited: combinedEdited || front.abstract,
          changed: combinedEdited !== front.abstract,
          section: "abstract",
        });
      }
    }

    // 4. Keywords
    if (front.keywords) {
      const kw = await editKeywords(front.keywords);
      if (kw) {
        allSentences.push({
          original: kw.original || front.keywords,
          edited: kw.edited || front.keywords,
          changed: kw.changed ?? true,
          section: "keywords",
        });
      }
    }

    // 5. Body sections (sliced, sub-chunked at 1000 words)
    const bodySections = sliceBodyIntoSections(front.body, sections);
    for (const sec of bodySections) {
      const subChunks = wordChunk(sec.text, 1000);
      for (let c = 0; c < subChunks.length; c++) {
        console.log(`Editing "${sec.name}" chunk ${c + 1}/${subChunks.length}`);
        const edited = await editSection(subChunks[c], sec.name, sec.type);
        edited.sentences.forEach((s: any) => { s.section = "body"; });
        allSentences.push(...edited.sentences);
        mergeSummary(edited.summary);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    summaryTotals.key_changes = [...new Set(summaryTotals.key_changes)].slice(0, 10);

    const result = {
      edited_text: "",
      sentences: allSentences,
      summary: summaryTotals,
    };

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
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

// Split into words and chunk at a max size
function wordChunk(text: string, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }
  return chunks.length ? chunks : [text];
}

// Build condensed view: each paragraph's first ~2 lines (for structure detection)
function condenseForStructure(mainText: string): string {
  const paras = mainText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return paras
    .map(p => {
      const words = p.split(/\s+/);
      // first ~25 words of each paragraph
      return words.slice(0, 25).join(" ");
    })
    .join("\n");
}

// Extract title / running title / abstract / keywords / body from raw text
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

  // Abstract
  let abstract = "";
  let keywords = "";
  const abstractIdx = lines.findIndex((l, i) => i >= bodyStartIdx && /^\[?abstract\]?[:\s]?/i.test(l));
  let afterAbstractIdx = bodyStartIdx;

  if (abstractIdx !== -1) {
    const abstractLines: string[] = [];
    // Handle inline "Abstract: ..." on the same line
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

  // Keywords
  const kwIdx = lines.findIndex((l, i) => i >= afterAbstractIdx && /^\[?keywords?\]?[:\s]/i.test(l));
  let bodyFromIdx = afterAbstractIdx;
  if (kwIdx !== -1) {
    keywords = lines[kwIdx].replace(/^\[?keywords?\]?[:\s]*/i, "").trim();
    bodyFromIdx = kwIdx + 1;
  }

  const body = lines.slice(bodyFromIdx).join("\n");
  return { title, runningTitle, abstract, keywords, body };
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
- "The Value of X in Y" → "Association of X with Y"; "reveals" → "identifies"
- Add population explicitly; add design where evident (": A Randomized Controlled Trial")
- Person-first: "Lung Cancer Patients" → "Patients with Lung Cancer"; Title case
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

// Detect & separate abstract into labeled sections
function separateAbstractLabels(abstractText: string): { label: string; text: string }[] | null {
  const clean = abstractText.replace(/^\[?abstract\]?[:\s]*/i, "").trim();
  const labels = ["Background", "Objective", "Objectives", "Aim", "Aims", "Purpose", "Methods", "Method", "Materials and Methods", "Results", "Conclusion", "Conclusions"];
  // Match label followed by colon (handles both : and ：, with or without preceding period/space)
  const labelPattern = new RegExp(`(?:^|[.\\s])(${labels.join("|")})\\s*[:：]`, "gi");
  const matches = [...clean.matchAll(labelPattern)];
  if (matches.length < 2) return null;

  const sections: { label: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    // Start after the full matched label+colon
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

// Slice body into sections using AI-detected anchors
function sliceBodyIntoSections(body: string, sections: any[]): { name: string; type: string; text: string }[] {
  if (!sections.length) {
    return [{ name: "Body", type: "other", text: body }];
  }
  const bodyNorm = body.toLowerCase();
  // Find each section's start index by its anchor
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
  // Prepend any text before the first anchor (unlabeled intro)
  if (positioned[0].idx > 30) {
    result.unshift({ name: "Introduction", type: "introduction", text: body.slice(0, positioned[0].idx).trim() });
  }
  return result;
}

// ---------- main handler ----------

export async function POST(request: NextRequest) {
  try {
    const { manuscriptText } = await request.json();
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

    // 3. Abstract (edit as one section, then separate labels)
    if (front.abstract) {
      const abs = await editSection(front.abstract, "Abstract", "abstract");
      mergeSummary(abs.summary);

      // Combine all edited sentences, dedupe consecutive repeats
      const editedParts = abs.sentences
        .map((s: any) => (s.edited || s.original || "").replace(/\*\*/g, "").trim())
        .filter(Boolean);
      // Remove duplicate consecutive sentences (AI sometimes repeats)
      const deduped: string[] = [];
      for (const part of editedParts) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== part) {
          // also skip if this part already appears earlier
          if (!deduped.includes(part)) deduped.push(part);
        }
      }
      const combinedEdited = deduped.join(" ");

      const labeledSections = separateAbstractLabels(combinedEdited);
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
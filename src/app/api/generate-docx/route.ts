import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { createClient } from "@supabase/supabase-js";
import { diff_match_patch } from "diff-match-patch";

export const dynamic = "force-dynamic";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractTextFromXml(xml: string): string {
  const matches = xml.match(/<w:t[^>]*>(.*?)<\/w:t>/gs) || [];
  return matches
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripLabel(text: string): string {
  if (!text) return "";
  return text.replace(/\*\*/g, "").trim();
}

function sortKeywords(str: string): string {
  if (!str) return "";
  const labelMatch = str.match(/^(\[?keywords?\]?[:\s]*)/i);
  const label = labelMatch ? labelMatch[1] : "";
  const rest = label ? str.slice(label.length) : str;
  const sorted = rest
    .split(";")
    .map(k => k.trim())
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .join("; ");
  return label + sorted;
}

function getFirstRunProps(paragraphXml: string): string {
  const rMatch = paragraphXml.match(/<w:r\b[^>]*>(.*?)<\/w:r>/s);
  if (!rMatch) return "";
  const rPrMatch = rMatch[1].match(/<w:rPr>.*?<\/w:rPr>/s);
  return rPrMatch ? rPrMatch[0] : "";
}

function getParagraphProps(paragraphXml: string): string {
  const pPrMatch = paragraphXml.match(/<w:pPr>.*?<\/w:pPr>/s);
  return pPrMatch ? pPrMatch[0] : "";
}

function stripBoldFromRPr(rPr: string): string {
  return rPr
    .replace(/<w:b\/>/g, "")
    .replace(/<w:b\s*\/>/g, "")
    .replace(/<w:b><\/w:b>/g, "")
    .replace(/<w:bCs\/>/g, "")
    .replace(/<w:bCs\s*\/>/g, "");
}

function addBoldToRPr(rPr: string): string {
  const stripped = stripBoldFromRPr(rPr);
  if (stripped.includes("<w:rPr>")) {
    return stripped.replace("<w:rPr>", "<w:rPr><w:b/><w:bCs/>");
  }
  return "<w:rPr><w:b/><w:bCs/></w:rPr>";
}

function addItalicToRPr(rPr: string): string {
  // remove existing italic then add
  let base = rPr
    .replace(/<w:i\/>/g, "")
    .replace(/<w:i\s*\/>/g, "")
    .replace(/<w:iCs\/>/g, "")
    .replace(/<w:iCs\s*\/>/g, "");
  if (base.includes("<w:rPr>")) {
    return base.replace("<w:rPr>", "<w:rPr><w:i/><w:iCs/>");
  }
  return "<w:rPr><w:i/><w:iCs/></w:rPr>";
}

// ---- FORMATTING ANALYSIS ----
// Determine if a paragraph is predominantly bold (heading/subheading)
function isParagraphBold(paragraphXml: string): boolean {
  const runs = paragraphXml.match(/<w:r\b[^>]*>.*?<\/w:r>/gs) || [];
  if (runs.length === 0) return false;
  let boldRuns = 0;
  let textRuns = 0;
  for (const r of runs) {
    if (!/<w:t[^>]*>/.test(r)) continue;
    textRuns++;
    if (/<w:b\/>|<w:b\s*\/>|<w:b>/.test(r)) boldRuns++;
  }
  if (textRuns === 0) return false;
  return boldRuns / textRuns >= 0.6; // 60%+ of text runs bold => treat as bold paragraph
}

function isHeadingParagraph(paragraphXml: string): boolean {
  return (
    /<w:pStyle w:val="[^"]*[Hh]eading[^"]*"/.test(paragraphXml) ||
    /<w:pStyle w:val="[^"]*[Tt]itle[^"]*"/.test(paragraphXml)
  );
}

// A short bold paragraph is very likely a subheading (e.g., "2.1 Study patients")
function looksLikeSubheading(paragraphXml: string, text: string): boolean {
  if (!text) return false;
  const wordCount = text.split(/\s+/).length;
  return wordCount <= 12 && (isParagraphBold(paragraphXml) || isHeadingParagraph(paragraphXml));
}

const CHANGE_DATE = new Date().toISOString().split(".")[0] + "Z";
let changeIdCounter = 1000;
function nextId() { return changeIdCounter++; }

function makeRun(text: string, rPr: string): string {
  if (!text) return "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function makeInsRun(text: string, rPr: string, author: string): string {
  if (!text) return "";
  return `<w:ins w:id="${nextId()}" w:author="${author}" w:date="${CHANGE_DATE}"><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:ins>`;
}

function makeDelRun(text: string, rPr: string, author: string): string {
  if (!text) return "";
  return `<w:del w:id="${nextId()}" w:author="${author}" w:date="${CHANGE_DATE}"><w:r>${rPr}<w:delText xml:space="preserve">${escapeXml(text)}</w:delText></w:r></w:del>`;
}

// Split text into styled segments based on markers:
//   **bold**  -> bold
//   *italic*  -> italic (genes, species, stat symbols)
// Returns array of { text, bold, italic }
function parseStyledSegments(text: string): { text: string; bold: boolean; italic: boolean }[] {
  const segments: { text: string; bold: boolean; italic: boolean }[] = [];
  // First split on bold (**...**), then within non-bold parts split on italic (*...*)
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const bp of boldParts) {
    if (!bp) continue;
    if (/^\*\*[^*]+\*\*$/.test(bp)) {
      segments.push({ text: bp.replace(/\*\*/g, ""), bold: true, italic: false });
    } else {
      // split on single-asterisk italic
      const italParts = bp.split(/(\*[^*]+\*)/g);
      for (const ip of italParts) {
        if (!ip) continue;
        if (/^\*[^*]+\*$/.test(ip)) {
          segments.push({ text: ip.replace(/\*/g, ""), bold: false, italic: true });
        } else {
          segments.push({ text: ip, bold: false, italic: false });
        }
      }
    }
  }
  return segments;
}

// Build inserted runs applying bold/italic from markers, on top of a base rPr
function makeStyledInsRuns(text: string, baseRPr: string, author: string): string {
  const segments = parseStyledSegments(text);
  let runs = "";
  for (const seg of segments) {
    if (!seg.text) continue;
    let rPr = baseRPr;
    if (seg.bold) rPr = addBoldToRPr(rPr);
    if (seg.italic) rPr = addItalicToRPr(rPr);
    runs += makeInsRun(seg.text, rPr, author);
  }
  return runs || makeInsRun(text.replace(/\*/g, ""), baseRPr, author);
}

// Build clean (non-tracked) runs applying bold/italic from markers
function makeStyledRuns(text: string, baseRPr: string): string {
  const segments = parseStyledSegments(text);
  let runs = "";
  for (const seg of segments) {
    if (!seg.text) continue;
    let rPr = baseRPr;
    if (seg.bold) rPr = addBoldToRPr(rPr);
    if (seg.italic) rPr = addItalicToRPr(rPr);
    runs += makeRun(seg.text, rPr);
  }
  return runs || makeRun(text.replace(/\*/g, ""), baseRPr);
}

// BLOCK-LEVEL tracked: insert whole edited (styled) FIRST, then strike whole original.
// Order matches manual paste-over-selection (new text first, deleted original after, no gap).
function generateBlockTracked(
  original: string,
  edited: string,
  rPr: string,
  author: string = "AIPR",
  hasMarkers: boolean = false
): string {
  const insRuns = hasMarkers
    ? makeStyledInsRuns(edited, rPr, author)
    : makeInsRun(edited, rPr, author);
  return insRuns + makeDelRun(original, rPr, author);
}

// WORD-LEVEL tracked: granular diff (edit-PC style)
function generateWordTracked(
  original: string,
  edited: string,
  rPr: string,
  author: string = "AIPR"
): string {
  const dmp = new diff_match_patch();
  const cleanEdited = edited.replace(/\*/g, "");
  const diffs = dmp.diff_main(original, cleanEdited);
  dmp.diff_cleanupSemantic(diffs);
  let runs = "";
  for (const [op, data] of diffs) {
    if (!data) continue;
    if (op === 0) runs += makeRun(data, rPr);
    else if (op === -1) runs += makeDelRun(data, rPr, author);
    else if (op === 1) runs += makeInsRun(data, rPr, author);
  }
  return runs;
}

function deriveOutputFilename(originalFileUrl: string, type: "edited" | "editpc"): string {
  const parts = originalFileUrl.split("/");
  let filename = parts[parts.length - 1];
  filename = filename.replace(/^\d+_/, "");
  const base = filename.replace(/\.docx$/i, "");
  if (type === "edited") {
    return `${base.replace(/-org$/i, "")}.docx`;
  } else {
    return `${base.replace(/-org$/i, "")}-edit-PC.docx`;
  }
}

// Distinctive signature for a sentence's original text.
// Uses the FULL normalized string (not a short prefix) so that two sentences which
// merely share an opening phrase — e.g. section 1.1 and 2.1 both starting
// "A total of 276 patients who underwent laparoscopic CRC surgery..." — do NOT collide.
function sentenceKey(normOrig: string): string {
  // Full string is most distinctive. Cap very long strings to keep indexOf cheap,
  // but keep enough tail that near-duplicate openings still diverge.
  if (normOrig.length <= 200) return normOrig;
  // For very long sentences, combine head + tail so the ending (which differs) is included.
  return normOrig.substring(0, 140) + "|" + normOrig.substring(normOrig.length - 60);
}

function buildParagraphEdits(
  paragraphs: string[],
  sentences: any[]
): Map<string, { original: string; edited: string; section: string }> {
  const map = new Map<string, { original: string; edited: string; section: string }>();

  const bySection: Record<string, any[]> = {};
  sentences.forEach((s: any) => {
    const sec = s.section || "body";
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(s);
  });

  // ---- BODY matching (position-anchored, collision-safe) ----
  // Give each body sentence a stable index so it can be consumed exactly ONCE across
  // all paragraphs. This is the core fix: previously a sentence could match multiple
  // paragraphs (or the wrong paragraph) when two sentences shared a 50-char opening,
  // which duplicated content and dropped data (e.g. "179 males" vanished from 2.1).
  const bodyIndexed = sentences
    .map((s: any, idx: number) => ({ s, idx }))
    .filter(({ s }: any) => (s.section || "body") === "body");

  const usedSentenceIdx = new Set<number>();

  // Process paragraphs in document order so the earliest paragraph claims a shared
  // sentence first, and later near-duplicate paragraphs match only their own sentence.
  paragraphs.forEach((para) => {
    const paraText = extractTextFromXml(para).trim();
    if (!paraText || paraText.length < 5) return;
    const paraNorm = normalizeText(paraText);

    // Collect every not-yet-used body sentence whose distinctive signature appears
    // in THIS paragraph, recording character position for ordering.
    const hits: { s: any; idx: number; pos: number }[] = [];
    for (const { s, idx } of bodyIndexed) {
      if (usedSentenceIdx.has(idx)) continue;
      const orig = (s.original || "").trim();
      if (!orig || orig.length < 12) continue;
      const normOrig = normalizeText(orig);

      // Try full/near-full match first (most reliable, disambiguates duplicates).
      let pos = paraNorm.indexOf(sentenceKey(normOrig));
      // Fallback: if the AI's stored original differs slightly from the DOCX text
      // (punctuation/whitespace), try a shorter but still distinctive slice.
      if (pos === -1 && normOrig.length >= 60) {
        pos = paraNorm.indexOf(normOrig.substring(0, 60));
      }
      if (pos !== -1) {
        hits.push({ s, idx, pos });
      }
    }

    if (hits.length === 0) return;

    // Order matched sentences by their position within the paragraph, then consume.
    hits.sort((a, b) => a.pos - b.pos);
    hits.forEach(h => usedSentenceIdx.add(h.idx));

    const editedText = hits
      .map(h => (h.s.edited || h.s.original || "").trim())
      .filter(Boolean)
      .join(" ");

    if (!editedText) return;
    map.set(para, { original: paraText, edited: editedText, section: "body" });
  });

  // Title — match the FIRST paragraph that contains the title text
  const titleSents = bySection["title"] || [];
  if (titleSents.length > 0 && titleSents[0].changed) {
    const tOrig = stripLabel(titleSents[0].original || "");
    const tEdit = stripLabel(titleSents[0].edited || "");
    const tKey = normalizeText(tOrig).substring(0, 40);
    for (const para of paragraphs) {
      const paraText = extractTextFromXml(para).trim();
      if (!paraText) continue;
      const paraNorm = normalizeText(paraText);
      if (tKey && (paraNorm.includes(tKey) || tKey.includes(paraNorm.substring(0, 40)))) {
        map.set(para, { original: paraText, edited: tEdit, section: "title" });
        break;
      }
    }
  }

  // Running title
  const rtSents = bySection["running_title"] || [];
  if (rtSents.length > 0 && rtSents[0].changed) {
    const rtEdit = stripLabel(rtSents[0].edited || "");
    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      if (/running\s*title/i.test(paraText)) {
        const labelMatch = paraText.match(/^(running\s*title[:\s]*)/i);
        const label = labelMatch ? labelMatch[1] : "Running Title: ";
        map.set(para, { original: paraText, edited: `${label}${rtEdit}`, section: "running_title" });
      }
    });
  }

  // Keywords
  const kwSents = bySection["keywords"] || [];
  if (kwSents.length > 0 && kwSents[0].changed) {
    const kwEdit = sortKeywords(stripLabel(kwSents[0].edited || ""));
    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      if (/^\[?keywords?\]?[:\s]/i.test(paraText)) {
        const labelMatch = paraText.match(/^(\[?keywords?\]?[:\s]*)/i);
        const label = labelMatch ? labelMatch[1] : "Keywords: ";
        const cleanEdit = kwEdit.replace(/^\[?keywords?\]?[:\s]*/i, "");
        map.set(para, { original: paraText, edited: `${label}${cleanEdit}`, section: "keywords" });
      }
    });
  }

  // Abstract — supports labeled sections
  const abstractSents = bySection["abstract"] || [];
  if (abstractSents.length > 0) {
    const originalEntry = abstractSents.find((s: any) => (s.original || "").trim().length > 40);
    const firstKey = originalEntry
      ? normalizeText(stripLabel(originalEntry.original || "")).substring(0, 50)
      : normalizeText(stripLabel(abstractSents[0].original || "")).substring(0, 50);

    const isLabeled = abstractSents.some((s: any) => s.isLabeledPart);
    let editedCombined: string;
    if (isLabeled) {
      editedCombined = abstractSents
        .map((s: any) => (s.edited || "").trim())
        .filter(Boolean)
        .join("\n");
    } else {
      editedCombined = abstractSents
        .map((s: any) => stripLabel(s.edited || s.original || ""))
        .join(" ")
        .trim();
    }

    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      if (firstKey && normalizeText(paraText).includes(firstKey) && paraText.length > 80) {
        const labelMatch = paraText.match(/^(\[?abstract\]?[:\s]*)/i);
        const label = labelMatch ? labelMatch[1] : "";
        map.set(para, {
          original: paraText,
          edited: `${label}${editedCombined}`,
          section: "abstract",
        });
      }
    });
  }

  return map;
}

async function generateDocxBuffer(
  originalBuffer: Buffer,
  sentences: any[],
  type: "edited" | "editpc"
): Promise<Buffer> {
  const zip = new AdmZip(originalBuffer);
  const docEntry = zip.getEntry("word/document.xml");
  if (!docEntry) throw new Error("Invalid DOCX file");

  let docXml = docEntry.getData().toString("utf8");
  const paragraphs = docXml.match(/<w:p\b[^>]*>.*?<\/w:p>/gs) || [];

  const editsMap = buildParagraphEdits(paragraphs, sentences);
  let newDocXml = docXml;

  editsMap.forEach(({ original, edited, section }, para) => {
    if (!edited || original === edited) return;

    // ---- FORMATTING PRESERVATION ----
    let rPr = getFirstRunProps(para);
    const paraIsBold = isParagraphBold(para);
    const isHeading = isHeadingParagraph(para);
    const isSubheading = looksLikeSubheading(para, original);
    const isTitleOrHeadingSection =
      section === "title" || section === "running_title";

    // Keep bold for: title, headings, subheadings. Strip bold for normal body/abstract/keywords.
    // Preserve bold: keep it if original para was bold OR it looks like a heading
    // NEVER strip bold from originally-bold paragraphs (preserves heading formatting)
    const keepBold = isTitleOrHeadingSection || isHeading || isSubheading || paraIsBold || isParagraphBold(para);
    if (keepBold) {
      rPr = addBoldToRPr(rPr);
    } else {
      rPr = stripBoldFromRPr(rPr);
    }

    const pPr = getParagraphProps(para);
    const openTag = para.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
    const hasMarkers = /\*/.test(edited); // contains bold/italic markers

    let innerRuns: string;
    if (type === "editpc") {
      innerRuns = generateWordTracked(original, edited, rPr, "AIPR");
    } else {
      innerRuns = generateBlockTracked(original, edited, rPr, "AIPR", hasMarkers);
    }

    const newPara = `${openTag}${pPr}${innerRuns}</w:p>`;
    newDocXml = newDocXml.replace(para, newPara);
  });

  zip.updateFile("word/document.xml", Buffer.from(newDocXml, "utf8"));
  return zip.toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { fileUrl, sentences, type, manuscriptId, userId } = await request.json();

    if (!fileUrl || !sentences || !manuscriptId || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const columnName = type === "edited" ? "edited_file_url" : "tracked_file_url";
    const { data: existing } = await supabase
      .from("manuscripts")
      .select(columnName)
      .eq("id", manuscriptId)
      .single();

    const existingUrl = existing?.[columnName];

    if (existingUrl) {
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(existingUrl);
      if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return NextResponse.json({ success: true, file: base64, cached: true });
      }
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("manuscripts")
      .download(fileUrl);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Could not download file" }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    const outputBuffer = await generateDocxBuffer(originalBuffer, sentences, type);

    const outputFilename = deriveOutputFilename(fileUrl, type);
    const outputPath = `${userId}/${manuscriptId}/${outputFilename}`;

    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(outputPath, outputBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
    } else {
      await supabase
        .from("manuscripts")
        .update({ [columnName]: outputPath })
        .eq("id", manuscriptId);
    }

    const base64 = outputBuffer.toString("base64");
    return NextResponse.json({ success: true, file: base64, cached: false });
  } catch (error: any) {
    console.error("DOCX generation error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
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

function makeInsRunsWithBold(text: string, rPr: string, author: string): string {
  if (!text) return "";
  const boldRPr = addBoldToRPr(rPr);
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  let runs = "";
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      runs += makeInsRun(part.replace(/\*\*/g, ""), boldRPr, author);
    } else {
      runs += makeInsRun(part, rPr, author);
    }
  }
  return runs;
}

function generateBlockTracked(
  original: string,
  edited: string,
  rPr: string,
  author: string = "AIPR",
  hasBoldMarkers: boolean = false
): string {
  const insRuns = hasBoldMarkers
    ? makeInsRunsWithBold(edited, rPr, author)
    : makeInsRun(edited, rPr, author);
  return makeDelRun(original, rPr, author) + insRuns;
}

function generateWordTracked(
  original: string,
  edited: string,
  rPr: string,
  author: string = "AIPR"
): string {
  const dmp = new diff_match_patch();
  const cleanEdited = edited.replace(/\*\*/g, "");
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

function isHeadingParagraph(paragraphXml: string): boolean {
  return (
    /<w:pStyle w:val="[^"]*[Hh]eading[^"]*"/.test(paragraphXml) ||
    /<w:pStyle w:val="[^"]*[Tt]itle[^"]*"/.test(paragraphXml)
  );
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

  // Body — match each paragraph to the sentences it contains
  paragraphs.forEach((para) => {
    const paraText = extractTextFromXml(para).trim();
    if (!paraText || paraText.length < 5) return;
    const paraNorm = normalizeText(paraText);

    const matched: any[] = [];
    const seen = new Set<string>();
    sentences.forEach((s: any) => {
      if ((s.section || "body") !== "body") return;
      const orig = (s.original || "").trim();
      if (!orig || orig.length < 12) return;
      const key = normalizeText(orig).substring(0, 50);
      if (paraNorm.includes(key) && !seen.has(key)) {
        seen.add(key);
        matched.push(s);
      }
    });

    if (matched.length === 0) return;

    matched.sort((a, b) => {
      const aPos = paraNorm.indexOf(normalizeText(a.original).substring(0, 30));
      const bPos = paraNorm.indexOf(normalizeText(b.original).substring(0, 30));
      return aPos - bPos;
    });

    const editedText = matched
      .map((s: any) => (s.edited || s.original || "").trim())
      .filter(Boolean)
      .join(" ");

    map.set(para, { original: paraText, edited: editedText, section: "body" });
  });

  // Title — match the FIRST paragraph that contains the title text
  // (title paragraphs often have NO heading style, so do not require it)
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
        break; // only the first match (the real title)
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

    let rPr = getFirstRunProps(para);
    const shouldStripBold =
      ["abstract", "keywords", "body"].includes(section) && !isHeadingParagraph(para);
    if (shouldStripBold) rPr = stripBoldFromRPr(rPr);

    const pPr = getParagraphProps(para);
    const openTag = para.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
    const hasBoldMarkers = edited.includes("**");

    let innerRuns: string;
    if (type === "editpc") {
      innerRuns = generateWordTracked(original, edited, rPr, "AIPR");
    } else {
      innerRuns = generateBlockTracked(original, edited, rPr, "AIPR", hasBoldMarkers);
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
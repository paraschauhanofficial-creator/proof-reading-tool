import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractTextFromXml(xml: string): string {
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripLabel(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*[^*]+\*\*\s*/g, "")
    .replace(/^(abstract|keywords|running\s*title|title)[:\s]*/i, "")
    .trim();
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

function removeBoldFromParagraph(paragraphXml: string): string {
  return paragraphXml
    .replace(/<w:b\/>/g, "")
    .replace(/<w:b\s*\/>/g, "")
    .replace(/<w:b><\/w:b>/g, "")
    .replace(/<w:bCs\/>/g, "")
    .replace(/<w:bCs\s*\/>/g, "");
}

function replaceTextInRuns(
  paragraphXml: string,
  newText: string,
  removeBold: boolean = false
): string {
  let replaced = false;
  let result = paragraphXml.replace(
    /<w:t([^>]*)>(.*?)<\/w:t>/gs,
    (match, attrs, content) => {
      if (!replaced) {
        replaced = true;
        return `<w:t xml:space="preserve">${escapeXml(newText)}</w:t>`;
      }
      return `<w:t></w:t>`;
    }
  );
  if (removeBold) result = removeBoldFromParagraph(result);
  return result;
}

function wrapWithDeletion(paragraphXml: string, author: string = "AIPR"): string {
  const date = new Date().toISOString().split(".")[0] + "Z";
  return paragraphXml.replace(
    /(<w:r[ >])(.*?)(<\/w:r>)/gs,
    (match, open, content, close) => {
      const delContent = content.replace(
        /<w:t([^>]*)>(.*?)<\/w:t>/gs,
        (m: string, attrs: string, text: string) =>
          `<w:delText xml:space="preserve">${text}</w:delText>`
      );
      return `<w:del w:id="${Math.floor(Math.random() * 9000) + 1000}" w:author="${author}" w:date="${date}">${open}${delContent}${close}</w:del>`;
    }
  );
}

function wrapWithInsertion(
  paragraphXml: string,
  newText: string,
  author: string = "AIPR",
  removeBold: boolean = false
): string {
  const date = new Date().toISOString().split(".")[0] + "Z";
  const id = Math.floor(Math.random() * 9000) + 1000;
  const rPrMatch = paragraphXml.match(/<w:rPr>(.*?)<\/w:rPr>/s);
  let rPrContent = rPrMatch ? rPrMatch[1] : "";
  if (removeBold) {
    rPrContent = rPrContent
      .replace(/<w:b\/>/g, "")
      .replace(/<w:b\s*\/>/g, "")
      .replace(/<w:bCs\/>/g, "")
      .replace(/<w:bCs\s*\/>/g, "");
  }
  const rPr = rPrContent ? `<w:rPr>${rPrContent}</w:rPr>` : "";
  return `<w:ins w:id="${id}" w:author="${author}" w:date="${date}"><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r></w:ins>`;
}

function isHeadingParagraph(paragraphXml: string): boolean {
  return (
    /w:styleId="[^"]*[Hh]eading[^"]*"/.test(paragraphXml) ||
    /<w:pStyle w:val="[^"]*[Hh]eading[^"]*"/.test(paragraphXml) ||
    /<w:pStyle w:val="[^"]*[Tt]itle[^"]*"/.test(paragraphXml)
  );
}

function deriveOutputFilename(
  originalFileUrl: string,
  type: "clean" | "tracked"
): string {
  const parts = originalFileUrl.split("/");
  // Keep original filename with ALL characters including Chinese/Unicode
  // Only remove timestamp prefix (digits_)
  let filename = parts[parts.length - 1];
  filename = filename.replace(/^\d+_/, "");
  const base = filename.replace(/\.docx$/i, "");
  if (type === "clean") {
    return `${base.replace(/-org$/i, "")}.docx`;
  } else {
    return `${base.replace(/-org$/i, "")}-edit-PC.docx`;
  }
}

// Core logic: map each XML paragraph to its combined edited text
// Strategy: for each paragraph in the DOCX, find ALL sentences that
// belong to it (by checking if any sentence's original text is contained
// in the paragraph), then combine all their edited versions
function buildParagraphMap(
  paragraphs: string[],
  sentences: any[]
): Map<string, { editedText: string; hasChange: boolean; section: string }> {
  const result = new Map<string, { editedText: string; hasChange: boolean; section: string }>();

  // Group sentences by section
  const bySection: Record<string, any[]> = {};
  sentences.forEach((s: any) => {
    const sec = s.section || "body";
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(s);
  });

  // For each paragraph, find which sentences belong to it
  paragraphs.forEach((para) => {
    const paraText = extractTextFromXml(para).trim();
    if (!paraText || paraText.length < 5) return;
    const paraNorm = normalizeText(paraText);

    // Collect all sentences whose original text is found in this paragraph
    const matchedSentences: any[] = [];

    sentences.forEach((s: any) => {
      const orig = stripLabel(s.original || "").trim();
      if (!orig || orig.length < 10) return;
      const origNorm = normalizeText(orig);

      // Check if this sentence's original text appears in the paragraph
      // Use first 60 chars for matching to handle minor variations
      const matchKey = origNorm.substring(0, 60);
      if (paraNorm.includes(matchKey)) {
        matchedSentences.push(s);
      }
    });

    if (matchedSentences.length === 0) return;

    // Determine section from matched sentences
    const section = matchedSentences[0]?.section || "body";
    const hasChange = matchedSentences.some((s: any) => s.changed);

    // Build edited text by combining all matched sentences in order
    // Sort them by their position in the paragraph
    matchedSentences.sort((a, b) => {
      const aOrig = normalizeText(stripLabel(a.original || ""));
      const bOrig = normalizeText(stripLabel(b.original || ""));
      const aPos = paraNorm.indexOf(aOrig.substring(0, 40));
      const bPos = paraNorm.indexOf(bOrig.substring(0, 40));
      return aPos - bPos;
    });

    const editedText = matchedSentences
      .map((s: any) => stripLabel(s.edited || s.original || "").trim())
      .filter(Boolean)
      .join(" ");

    result.set(para, { editedText, hasChange, section });
  });

  // Handle special sections that may span multiple paragraphs
  // Abstract: combine all abstract sentences as one block
  const abstractSents = bySection["abstract"] || [];
  if (abstractSents.length > 0) {
    const abstractOrigCombined = abstractSents
      .map((s: any) => stripLabel(s.original || ""))
      .join(" ")
      .trim();
    const abstractEditCombined = abstractSents
      .map((s: any) => stripLabel(s.edited || s.original || ""))
      .join(" ")
      .trim();
    const abstractHasChange = abstractSents.some((s: any) => s.changed);

    // Find the paragraph that contains the abstract
    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      const paraNorm = normalizeText(paraText);
      const firstAbstractSent = normalizeText(
        stripLabel(abstractSents[0]?.original || "")
      ).substring(0, 60);

      if (paraNorm.includes(firstAbstractSent) && paraText.length > 100) {
        result.set(para, {
          editedText: abstractEditCombined,
          hasChange: abstractHasChange,
          section: "abstract",
        });
      }
    });
  }

  // Keywords: find keyword paragraph
  const kwSents = bySection["keywords"] || [];
  if (kwSents.length > 0 && kwSents[0].changed) {
    const kwOrig = stripLabel(kwSents[0].original || "").trim();
    const kwEdit = sortKeywords(stripLabel(kwSents[0].edited || kwOrig));

    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      const paraNorm = normalizeText(paraText);
      const kwNorm = normalizeText(kwOrig).substring(0, 40);

      if (paraNorm.includes(kwNorm)) {
        result.set(para, {
          editedText: kwEdit,
          hasChange: true,
          section: "keywords",
        });
      }
    });
  }

  // Title
  const titleSents = bySection["title"] || [];
  if (titleSents.length > 0 && titleSents[0].changed) {
    const titleOrig = stripLabel(titleSents[0].original || "").trim();
    const titleEdit = stripLabel(titleSents[0].edited || titleOrig);

    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      const paraNorm = normalizeText(paraText);
      const titleNorm = normalizeText(titleOrig).substring(0, 50);

      if (paraNorm.includes(titleNorm) && isHeadingParagraph(para)) {
        result.set(para, {
          editedText: titleEdit,
          hasChange: true,
          section: "title",
        });
      }
    });
  }

  // Running title — look for paragraph containing "Running title:" or similar
  const rtSents = bySection["running_title"] || [];
  if (rtSents.length > 0 && rtSents[0].changed) {
    const rtOrig = stripLabel(rtSents[0].original || "").trim();
    const rtEdit = stripLabel(rtSents[0].edited || rtOrig);

    paragraphs.forEach((para) => {
      const paraText = extractTextFromXml(para).trim();
      const paraTextLower = paraText.toLowerCase();

      // Running title paragraph contains "running title:" or "running title"
      if (
        paraTextLower.includes("running title") ||
        paraTextLower.includes("running title:")
      ) {
        // Preserve the "Running title:" label prefix
        const labelMatch = paraText.match(/^(running\s*title[:\s]*)/i);
        const label = labelMatch ? labelMatch[1] : "Running title: ";
        result.set(para, {
          editedText: `${label}${rtEdit}`,
          hasChange: true,
          section: "running_title",
        });
      }
    });
  }

  return result;
}

async function generateDocxBuffer(
  originalBuffer: Buffer,
  sentences: any[],
  type: "clean" | "tracked"
): Promise<Buffer> {
  const zip = new AdmZip(originalBuffer);
  const docEntry = zip.getEntry("word/document.xml");
  if (!docEntry) throw new Error("Invalid DOCX file");

  let docXml = docEntry.getData().toString("utf8");
  const paragraphs = docXml.match(/<w:p[ >].*?<\/w:p>/gs) || [];

  // Build paragraph → edited text map
  const paragraphMap = buildParagraphMap(paragraphs, sentences);

  let newDocXml = docXml;

  paragraphMap.forEach(({ editedText, hasChange, section }, para) => {
    if (!editedText) return;

    // Determine if we should remove bold formatting
    const shouldRemoveBold =
      ["abstract", "keywords", "body"].includes(section) &&
      !isHeadingParagraph(para);

    if (type === "clean") {
      const newPara = replaceTextInRuns(para, editedText, shouldRemoveBold);
      newDocXml = newDocXml.replace(para, newPara);
    } else {
      if (hasChange) {
        const deletedPart = wrapWithDeletion(para, "AIPR");
        const insertedPart = wrapWithInsertion(
          para,
          editedText,
          "AIPR",
          shouldRemoveBold
        );
        const pPropsMatch = para.match(/(<w:pPr>.*?<\/w:pPr>)/s);
        const pProps = pPropsMatch ? pPropsMatch[1] : "";
        const openTag = para.match(/^<w:p[^>]*>/)?.[0] || "<w:p>";
        const newPara = `${openTag}${pProps}${deletedPart
          .replace(/^<w:p[^>]*>/, "")
          .replace(/<\/w:p>$/, "")}${insertedPart}</w:p>`;
        newDocXml = newDocXml.replace(para, newPara);
      } else {
        // Unchanged — just clean bold if needed
        if (shouldRemoveBold) {
          const newPara = removeBoldFromParagraph(para);
          newDocXml = newDocXml.replace(para, newPara);
        }
      }
    }
  });

  zip.updateFile("word/document.xml", Buffer.from(newDocXml, "utf8"));
  return zip.toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const { fileUrl, sentences, title, type, manuscriptId, userId } =
      await request.json();

    if (!fileUrl || !sentences || !manuscriptId || !userId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const columnName =
      type === "clean" ? "edited_file_url" : "tracked_file_url";
    const { data: existing } = await supabase
      .from("manuscripts")
      .select(columnName)
      .eq("id", manuscriptId)
      .single();

    const existingUrl = existing?.[columnName as keyof typeof existing];

    if (existingUrl) {
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(existingUrl as string);
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
      return NextResponse.json(
        { error: "Could not download file" },
        { status: 500 }
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    const outputBuffer = await generateDocxBuffer(
      originalBuffer,
      sentences,
      type
    );

    // Use original filename preserving ALL characters including Chinese
    const outputFilename = deriveOutputFilename(fileUrl, type);
    const outputPath = `${userId}/${manuscriptId}/${outputFilename}`;

    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(outputPath, outputBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
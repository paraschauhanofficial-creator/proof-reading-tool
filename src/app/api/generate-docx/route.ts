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

function replaceTextInRuns(paragraphXml: string, newText: string): string {
  // Keep all XML structure, just replace the text content inside <w:t> tags
  const runs = paragraphXml.match(/<w:r[ >].*?<\/w:r>/gs) || [];
  if (runs.length === 0) return paragraphXml;

  // Put all new text in the first run, empty out the rest
  let replaced = false;
  let result = paragraphXml;

  result = result.replace(/<w:t([^>]*)>(.*?)<\/w:t>/gs, (match, attrs, content) => {
    if (!replaced) {
      replaced = true;
      return `<w:t xml:space="preserve">${escapeXml(newText)}</w:t>`;
    }
    return `<w:t></w:t>`;
  });

  return result;
}

function wrapWithDeletion(paragraphXml: string, author: string = "AIPR"): string {
  const date = new Date().toISOString().split(".")[0] + "Z";
  // Wrap all runs in w:del
  const result = paragraphXml.replace(
    /(<w:r[ >])(.*?)(<\/w:r>)/gs,
    (match, open, content, close) => {
      // Replace w:t with w:delText inside deletion
      const delContent = content.replace(/<w:t([^>]*)>(.*?)<\/w:t>/gs,
        (m: string, attrs: string, text: string) => `<w:delText xml:space="preserve">${text}</w:delText>`
      );
      return `<w:del w:id="${Math.floor(Math.random() * 9000) + 1000}" w:author="${author}" w:date="${date}">${open}${delContent}${close}</w:del>`;
    }
  );
  return result;
}

function wrapWithInsertion(paragraphXml: string, newText: string, author: string = "AIPR"): string {
  const date = new Date().toISOString().split(".")[0] + "Z";
  const id = Math.floor(Math.random() * 9000) + 1000;

  // Get first run's properties
  const rPrMatch = paragraphXml.match(/<w:rPr>(.*?)<\/w:rPr>/s);
  const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : "";

  return `<w:ins w:id="${id}" w:author="${author}" w:date="${date}"><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r></w:ins>`;
}

export async function POST(request: NextRequest) {
  try {
    const { fileUrl, sentences, title, type } = await request.json();
    // type: "clean" or "tracked"

    if (!fileUrl || !sentences) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Download original file from Supabase
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("manuscripts")
      .download(fileUrl);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Could not download file" }, { status: 500 });
    }

    // Load into AdmZip
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const zip = new AdmZip(buffer);

    // Get document.xml
    const docEntry = zip.getEntry("word/document.xml");
    if (!docEntry) {
      return NextResponse.json({ error: "Invalid DOCX file" }, { status: 400 });
    }

    let docXml = docEntry.getData().toString("utf8");

    // Extract all paragraphs
    const paragraphRegex = /<w:p[ >].*?<\/w:p>/gs;
    const paragraphs = docXml.match(paragraphRegex) || [];

    // Build a map of original text → edited text
    const changeMap = new Map<string, string>();
    sentences.forEach((s: any) => {
      if (s.changed && s.original && s.edited) {
        changeMap.set(s.original.trim(), s.edited.trim());
      }
    });

    if (type === "clean") {
      // Replace text in paragraphs — keep all formatting
      let newDocXml = docXml;
      paragraphs.forEach((para) => {
        const paraText = extractTextFromXml(para).trim();
        if (!paraText) return;

        // Find matching sentence
        for (const [original, edited] of changeMap.entries()) {
          if (paraText.includes(original.substring(0, 40))) {
            const newPara = replaceTextInRuns(para, edited);
            newDocXml = newDocXml.replace(para, newPara);
            break;
          }
        }
      });

      zip.updateFile("word/document.xml", Buffer.from(newDocXml, "utf8"));

    } else if (type === "tracked") {
      // Add tracked changes markup
      let newDocXml = docXml;

      paragraphs.forEach((para) => {
        const paraText = extractTextFromXml(para).trim();
        if (!paraText) return;

        for (const [original, edited] of changeMap.entries()) {
          if (paraText.includes(original.substring(0, 40))) {
            // Create deletion of original + insertion of edited
            const deletedPart = wrapWithDeletion(para, "AIPR");
            const insertedPart = wrapWithInsertion(para, edited, "AIPR");

            // Replace paragraph with del+ins version
            const pPropsMatch = para.match(/(<w:pPr>.*?<\/w:pPr>)/s);
            const pProps = pPropsMatch ? pPropsMatch[1] : "";

            const openTag = para.match(/^<w:p[^>]*>/)?.[0] || "<w:p>";
            const newPara = `${openTag}${pProps}${deletedPart.replace(/^<w:p[^>]*>/, "").replace(/<\/w:p>$/, "")}${insertedPart}</w:p>`;

            newDocXml = newDocXml.replace(para, newPara);
            break;
          }
        }
      });

      zip.updateFile("word/document.xml", Buffer.from(newDocXml, "utf8"));
    }

    // Return as base64
    const outputBuffer = zip.toBuffer();
    const base64 = outputBuffer.toString("base64");

    return NextResponse.json({ success: true, file: base64 });

  } catch (error: any) {
    console.error("DOCX generation error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
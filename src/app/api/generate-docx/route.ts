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
  let replaced = false;
  return paragraphXml.replace(/<w:t([^>]*)>(.*?)<\/w:t>/gs, (match, attrs, content) => {
    if (!replaced) {
      replaced = true;
      return `<w:t xml:space="preserve">${escapeXml(newText)}</w:t>`;
    }
    return `<w:t></w:t>`;
  });
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

function wrapWithInsertion(paragraphXml: string, newText: string, author: string = "AIPR"): string {
  const date = new Date().toISOString().split(".")[0] + "Z";
  const id = Math.floor(Math.random() * 9000) + 1000;
  const rPrMatch = paragraphXml.match(/<w:rPr>(.*?)<\/w:rPr>/s);
  const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : "";
  return `<w:ins w:id="${id}" w:author="${author}" w:date="${date}"><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r></w:ins>`;
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

  const changeMap = new Map<string, string>();
  sentences.forEach((s: any) => {
    if (s.changed && s.original && s.edited) {
      changeMap.set(s.original.trim(), s.edited.trim());
    }
  });

  let newDocXml = docXml;

  paragraphs.forEach((para) => {
    const paraText = extractTextFromXml(para).trim();
    if (!paraText) return;

    for (const [original, edited] of changeMap.entries()) {
      if (paraText.includes(original.substring(0, 40))) {
        if (type === "clean") {
          const newPara = replaceTextInRuns(para, edited);
          newDocXml = newDocXml.replace(para, newPara);
        } else {
          const deletedPart = wrapWithDeletion(para, "AIPR");
          const insertedPart = wrapWithInsertion(para, edited, "AIPR");
          const pPropsMatch = para.match(/(<w:pPr>.*?<\/w:pPr>)/s);
          const pProps = pPropsMatch ? pPropsMatch[1] : "";
          const openTag = para.match(/^<w:p[^>]*>/)?.[0] || "<w:p>";
          const newPara = `${openTag}${pProps}${deletedPart
            .replace(/^<w:p[^>]*>/, "")
            .replace(/<\/w:p>$/, "")}${insertedPart}</w:p>`;
          newDocXml = newDocXml.replace(para, newPara);
        }
        break;
      }
    }
  });

  zip.updateFile("word/document.xml", Buffer.from(newDocXml, "utf8"));
  return zip.toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const { fileUrl, sentences, title, type, manuscriptId, userId } = await request.json();

    if (!fileUrl || !sentences || !manuscriptId || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if file already exists in Supabase
    const columnName = type === "clean" ? "edited_file_url" : "tracked_file_url";
    const { data: existing } = await supabase
      .from("manuscripts")
      .select(columnName)
      .eq("id", manuscriptId)
      .single();

    const existingUrl = existing?.[columnName as keyof typeof existing];

    if (existingUrl) {
      // File already generated — serve directly from Supabase
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(existingUrl);

      if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return NextResponse.json({ success: true, file: base64, cached: true });
      }
    }

    // Download original file from Supabase
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("manuscripts")
      .download(fileUrl);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Could not download file" }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Generate the DOCX
    const outputBuffer = await generateDocxBuffer(originalBuffer, sentences, type);

    // Save to Supabase Storage
    const suffix = type === "clean" ? "" : "-edit-PC";
    const sanitizedTitle = title
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[()]/g, "")
      .slice(0, 50);

    const outputPath = `${userId}/${manuscriptId}/${sanitizedTitle}${suffix}.docx`;

    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(outputPath, outputBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
    } else {
      // Save file URL to manuscripts table
      await supabase
        .from("manuscripts")
        .update({ [columnName]: outputPath })
        .eq("id", manuscriptId);
    }

    // Return file as base64
    const base64 = outputBuffer.toString("base64");
    return NextResponse.json({ success: true, file: base64, cached: false });

  } catch (error: any) {
    console.error("DOCX generation error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
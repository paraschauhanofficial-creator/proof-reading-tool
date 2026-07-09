import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export async function generateEditedDocx(
  title: string,
  editedText: string,
  sentences: { original: string; edited: string; changed: boolean }[]
): Promise<Blob> {
  const paragraphs: Paragraph[] = [];

  // Title
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 28 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // All edited sentences as plain paragraphs
  const lines = editedText.split(/\n+/).filter(Boolean);
  lines.forEach((line) => {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line, size: 24 })],
        spacing: { after: 120 },
      })
    );
  });

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const buffer = await Packer.toBlob(doc);
  return buffer;
}

export async function generateTrackedDocx(
  title: string,
  sentences: { original: string; edited: string; changed: boolean }[]
): Promise<Blob> {
  const paragraphs: Paragraph[] = [];

  // Title
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 28 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // Each sentence — changed ones show original (red strikethrough) + edited (inserted)
  sentences.forEach((s) => {
    if (s.changed) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: s.original + " ",
              strike: true,
              color: "CC0000",
              size: 24,
            }),
            new TextRun({
              text: s.edited,
              color: "007700",
              size: 24,
              underline: {},
            }),
          ],
          spacing: { after: 120 },
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: s.edited, size: 24 })],
          spacing: { after: 120 },
        })
      );
    }
  });

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const buffer = await Packer.toBlob(doc);
  return buffer;
}
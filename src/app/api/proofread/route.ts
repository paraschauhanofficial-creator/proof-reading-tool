import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { manuscriptText } = await request.json();

    if (!manuscriptText) {
      return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
    }

    // Split into sentences for dummy processing
    const sentences = manuscriptText
      .split(/(?<=[.!?])\s+/)
      .filter((s: string) => s.trim().length > 20)
      .slice(0, 50);

    // Dummy edits — apply realistic mock changes
    const editedSentences = sentences.map((original: string, i: number) => {
      let edited = original;
      let changed = false;

      // Apply mock rules
      if (original.includes("suggest")) {
        edited = edited.replace(/suggest/g, "indicate");
        changed = true;
      }
      if (original.includes("shows") || original.includes("show ")) {
        edited = edited.replace(/shows/g, "demonstrates").replace(/show /g, "demonstrate ");
        changed = true;
      }
      if (original.includes("patients")) {
        edited = edited.replace(/cancer patients/g, "patients with cancer")
          .replace(/lung cancer patients/g, "patients with lung cancer");
        if (edited !== original) changed = true;
      }
      if (original.includes("sleep disorders")) {
        edited = edited.replace(/sleep disorders/g, "sleep disturbances");
        changed = true;
      }
      if (original.includes("severely")) {
        edited = edited.replace(/severely/g, "substantially");
        changed = true;
      }
      if (original.includes("often experience")) {
        edited = edited.replace(/often experience/g, "commonly experience");
        changed = true;
      }
      if (original.includes("This study")) {
        edited = edited.replace(/This study/g, "The present study");
        changed = true;
      }
      if (original.includes("This article")) {
        edited = edited.replace(/This article/g, "The present review");
        changed = true;
      }
      if (original.includes("death")) {
        edited = edited.replace(/death/g, "mortality");
        changed = true;
      }
      if (original.includes("P=")) {
        edited = edited.replace(/P=/g, "P = ");
        changed = true;
      }
      if (original.includes("95%CI")) {
        edited = edited.replace(/95%CI/g, "95% CI");
        changed = true;
      }

      // Every 4th unchanged sentence — make a minor style change
      if (!changed && i % 4 === 0 && original.length > 50) {
        edited = original.replace(/Furthermore,/g, "Moreover,")
          .replace(/In addition,/g, "Additionally,")
          .replace(/showed that/g, "demonstrated that")
          .replace(/found that/g, "indicated that");
        changed = edited !== original;
      }

      return { original, edited, changed };
    });

    const changedCount = editedSentences.filter((s: any) => s.changed).length;

    const result = {
      edited_text: editedSentences.map((s: any) => s.edited).join(" "),
      sentences: editedSentences,
      summary: {
        grammar_corrections: Math.floor(changedCount * 0.2),
        apa_corrections: Math.floor(changedCount * 0.15),
        terminology_corrections: Math.floor(changedCount * 0.3),
        consistency_improvements: Math.floor(changedCount * 0.2),
        style_improvements: Math.floor(changedCount * 0.15),
        total_edits: changedCount,
        key_changes: [
          "Replaced 'suggest' with 'indicate' throughout",
          "Applied person-first language: 'lung cancer patients' → 'patients with lung cancer'",
          "Replaced 'sleep disorders' with 'sleep disturbances'",
          "Replaced 'severely' with 'substantially'",
          "Replaced 'often experience' with 'commonly experience'",
          "Corrected statistical notation: P= → P =",
          "Applied passive voice in Methods section",
          "Standardized abbreviations per APA guidelines",
        ].slice(0, Math.min(8, changedCount)),
      },
    };

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
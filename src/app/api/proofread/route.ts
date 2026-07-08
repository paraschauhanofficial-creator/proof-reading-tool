import { NextRequest, NextResponse } from "next/server";
import { PROOFREAD_SYSTEM_PROMPT, buildProofreadPrompt } from "@/lib/proofread-prompt";

export async function POST(request: NextRequest) {
  try {
    const { manuscriptText, manuscriptId } = await request.json();

    if (!manuscriptText) {
      return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
    }

    // For now return a mock response until API key is added
    // This lets us test the full UI flow first
    const mockResponse = {
      edited_text: manuscriptText,
      sentences: manuscriptText
        .split(/(?<=[.!?])\s+/)
        .map((sentence: string) => ({
          original: sentence,
          edited: sentence,
          changed: false,
        })),
      summary: {
        grammar_corrections: 0,
        apa_corrections: 0,
        terminology_corrections: 0,
        consistency_improvements: 0,
        style_improvements: 0,
        total_edits: 0,
        key_changes: ["API key not yet configured — mock response returned"],
      },
    };

    return NextResponse.json({ success: true, result: mockResponse });
  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
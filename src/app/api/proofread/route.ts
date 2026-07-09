import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { PROOFREAD_SYSTEM_PROMPT, buildProofreadPrompt } from "@/lib/proofread-prompt";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

function chunkText(text: string, chunkSize: number = 1500): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= chunkSize) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

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
      return {
        mainText: text.slice(0, match).trim(),
        references: text.slice(match).trim(),
      };
    }
  }
  return { mainText: text, references: "" };
}


export const dynamic = "force-dynamic";


export async function POST(request: NextRequest) {
  try {
    const { manuscriptText } = await request.json();

    if (!manuscriptText) {
      return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
    }

    const { mainText, references } = separateReferences(manuscriptText);

    const chunks = chunkText(mainText, 1500);
    console.log(`Processing ${chunks.length} chunk(s)`);

    const allSentences: any[] = [];
    const allEditedParts: string[] = [];
    const summaryTotals = {
      grammar_corrections: 0,
      apa_corrections: 0,
      terminology_corrections: 0,
      consistency_improvements: 0,
      style_improvements: 0,
      total_edits: 0,
      key_changes: [] as string[],
    };

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1} of ${chunks.length}`);

      const prompt = buildProofreadPrompt(chunks[i]);

      const response = await getOpenAI().chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: PROOFREAD_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_completion_tokens: 16000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content || "{}";

      try {
        const parsed = JSON.parse(content);

        if (parsed.edited_text) allEditedParts.push(parsed.edited_text);
        if (parsed.sentences) allSentences.push(...parsed.sentences);

        if (parsed.summary) {
          summaryTotals.grammar_corrections += parsed.summary.grammar_corrections || 0;
          summaryTotals.apa_corrections += parsed.summary.apa_corrections || 0;
          summaryTotals.terminology_corrections += parsed.summary.terminology_corrections || 0;
          summaryTotals.consistency_improvements += parsed.summary.consistency_improvements || 0;
          summaryTotals.style_improvements += parsed.summary.style_improvements || 0;
          summaryTotals.total_edits += parsed.summary.total_edits || 0;
          if (parsed.summary.key_changes) {
            summaryTotals.key_changes.push(...parsed.summary.key_changes);
          }
        }
      } catch (parseError) {
        console.error(`Chunk ${i + 1} parse error:`, parseError);
      }

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const fullEditedText = allEditedParts.join("\n\n") +
      (references ? "\n\n" + references : "");

    summaryTotals.key_changes = [...new Set(summaryTotals.key_changes)].slice(0, 10);

    const result = {
      edited_text: fullEditedText,
      sentences: allSentences,
      summary: summaryTotals,
    };

    return NextResponse.json({ success: true, result });

  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
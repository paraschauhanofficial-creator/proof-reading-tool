import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { PROOFREAD_SYSTEM_PROMPT } from "@/lib/proofread-prompt";

export const dynamic = "force-dynamic";

const MODEL = "gpt-5.6-luna";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export async function POST(request: NextRequest) {
  try {
    const { original, currentEdit, instruction, section } = await request.json();

    if (!original) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const instructionLine = instruction
      ? `\n\nADDITIONAL INSTRUCTION FROM THE EDITOR: ${instruction}\nApply this instruction while still following all the rules above.`
      : "";

    const userPrompt = `Re-edit the following ${section || "sentence"} from a medical manuscript. Apply all your editing rules to produce a polished, publication-ready version. ${instructionLine ? "" : "Improve it further if possible."}

ORIGINAL SENTENCE:
${original}

CURRENT EDITED VERSION (improve on this):
${currentEdit || original}${instructionLine}

Return ONLY valid JSON:
{ "original": "${original.replace(/"/g, '\\"')}", "edited": "your improved version", "changed": true }`;

    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: PROOFREAD_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return NextResponse.json({
      success: true,
      original: parsed.original || original,
      edited: parsed.edited || currentEdit || original,
      changed: parsed.changed ?? true,
    });
  } catch (error: any) {
    console.error("Re-edit error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
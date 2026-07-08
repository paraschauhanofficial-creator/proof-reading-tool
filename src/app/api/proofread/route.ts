import { NextRequest, NextResponse } from "next/server";
import { PROOFREAD_SYSTEM_PROMPT, buildProofreadPrompt } from "@/lib/proofread-prompt";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { manuscriptText } = await request.json();

    if (!manuscriptText) {
      return NextResponse.json({ error: "No manuscript text provided" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  systemInstruction: PROOFREAD_SYSTEM_PROMPT,
});

    // Detect and exclude references section
const refPatterns = [
  /\n\s*references\s*\n/i,
  /\n\s*bibliography\s*\n/i,
  /\n\s*works cited\s*\n/i,
];

let mainText = manuscriptText;
let referencesSection = "";

for (const pattern of refPatterns) {
  const match = manuscriptText.search(pattern);
  if (match !== -1) {
    mainText = manuscriptText.slice(0, match).trim();
    referencesSection = manuscriptText.slice(match).trim();
    break;
  }
}

const prompt = buildProofreadPrompt(mainText);

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Append original references back to edited text
if (referencesSection) {
  parsed.edited_text = parsed.edited_text + "\n\n" + referencesSection;
}

return NextResponse.json({ success: true, result: parsed });
  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
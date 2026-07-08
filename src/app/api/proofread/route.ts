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
      model: "gemini-1.5-flash",
      systemInstruction: PROOFREAD_SYSTEM_PROMPT,
    });

    const prompt = buildProofreadPrompt(manuscriptText);

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json({ success: true, result: parsed });
  } catch (error: any) {
    console.error("Proofread error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
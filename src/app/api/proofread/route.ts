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

async function editTitleAndRunningTitle(
  titleText: string,
  runningTitleText: string,
  contextText: string = ""
): Promise<{ title: any; runningTitle: any }> {
  const titlePrompt = `You are an expert medical journal editor. Rewrite the manuscript TITLE and RUNNING TITLE to publication quality. You MUST make a substantive, meaningful rewrite — returning a near-identical title is a failure.

CONTEXT (first part of the paper, to understand the core comparison/intervention):
${contextText.slice(0, 1500)}

TITLE REWRITE RULES:
- Identify the CORE contrast, intervention, or finding from the context and build the title around it. For example, if the study compares underbody versus upper-body warming, the title MUST name that contrast: "Effects of Underbody Versus Upper-Body Forced-Air Warming on..."
- State intervention/comparison + outcome + population + study design
- Replace vague words ("different sites", "the value of", "various") with the specific comparison
- Use precise framing: "The Value of X in Y" → "Association of X with Y"; "reveals" → "identifies"
- Add population explicitly: "in Patients Undergoing Laparoscopic Colorectal Cancer Surgery"
- Add design where evident: ": A Randomized Controlled Trial", ": A Narrative Review"
- Person-first: "Lung Cancer Patients" → "Patients with Lung Cancer"
- Title case
- The edited title MUST differ substantially from the original (restructured, more specific)

RUNNING TITLE RULES:
- Concise, sentence case, under 60 characters
- Capture the core comparison, use accepted abbreviations

Return ONLY valid JSON:
{
  "title": { "original": "...", "edited": "...", "changed": true },
  "running_title": { "original": "...", "edited": "...", "changed": true }
}

ORIGINAL TITLE: ${titleText}
ORIGINAL RUNNING TITLE: ${runningTitleText}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: titlePrompt }],
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return {
      title: parsed.title || null,
      runningTitle: parsed.running_title || null,
    };
  } catch (e) {
    console.error("Title edit error:", e);
    return { title: null, runningTitle: null };
  }
}

// Detect and separate abstract into labeled sections
function separateAbstractLabels(abstractText: string): { label: string; text: string }[] | null {
  const clean = abstractText.replace(/^\[?abstract\]?[:\s]*/i, "").trim();
  const labels = [
    "Background", "Objective", "Objectives", "Aim", "Aims", "Purpose",
    "Methods", "Method", "Materials and Methods",
    "Results", "Conclusion", "Conclusions",
  ];
  const labelPattern = new RegExp(`\\b(${labels.join("|")})\\s*[:：]`, "gi");
  const matches = [...clean.matchAll(labelPattern)];
  if (matches.length < 2) return null;

  const sections: { label: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const start = matches[i].index! + matches[i][0].length;
    const end = i < matches.length - 1 ? matches[i + 1].index! : clean.length;
    const text = clean.slice(start, end).trim();
    sections.push({
      label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
      text,
    });
  }
  return sections;
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
        model: "gpt-5.2",
        messages: [
          { role: "system", content: PROOFREAD_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
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

    // ---- Dedicated title + running-title edit pass ----
    const rawLines = mainText.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const rawTitle = rawLines[0] || "";
    let rawRunningTitle = "";
    for (let k = 1; k < Math.min(6, rawLines.length); k++) {
      if (/^running\s*title[:\s]/i.test(rawLines[k])) {
        rawRunningTitle = rawLines[k].replace(/^running\s*title[:\s]*/i, "").trim();
        break;
      }
    }

    if (rawTitle) {
      const titleResult = await editTitleAndRunningTitle(rawTitle, rawRunningTitle, mainText);

      const filtered = allSentences.filter(
        (s: any) => s.section !== "title" && s.section !== "running_title"
      );
      allSentences.length = 0;
      allSentences.push(...filtered);

      if (titleResult.runningTitle) {
        allSentences.unshift({
          original: titleResult.runningTitle.original || rawRunningTitle,
          edited: titleResult.runningTitle.edited || rawRunningTitle,
          changed: titleResult.runningTitle.changed ?? true,
          section: "running_title",
        });
      }
      if (titleResult.title) {
        allSentences.unshift({
          original: titleResult.title.original || rawTitle,
          edited: titleResult.title.edited || rawTitle,
          changed: titleResult.title.changed ?? true,
          section: "title",
        });
      }
    }
    // ---- end title pass ----

    // ---- Abstract label separation pass ----
    const abstractEntries = allSentences.filter((s: any) => s.section === "abstract");
    if (abstractEntries.length > 0) {
      const combinedEdited = abstractEntries
        .map((s: any) => (s.edited || "").replace(/\*\*/g, "").trim())
        .join(" ");
      const sections = separateAbstractLabels(combinedEdited);

      if (sections && sections.length >= 2) {
        const combinedOriginal = abstractEntries
          .map((s: any) => (s.original || "").replace(/\*\*/g, "").trim())
          .join(" ");

        const nonAbstract = allSentences.filter((s: any) => s.section !== "abstract");
        allSentences.length = 0;
        allSentences.push(...nonAbstract);

        sections.forEach((sec, idx) => {
          allSentences.push({
            original: idx === 0 ? combinedOriginal : "",
            edited: `**${sec.label}:** ${sec.text}`,
            changed: true,
            section: "abstract",
            isLabeledPart: true,
          });
        });
      }
    }
    // ---- end abstract pass ----

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
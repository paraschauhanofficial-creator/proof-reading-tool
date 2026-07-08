"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function ManuscriptPage() {
  const [manuscript, setManuscript] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();

  useEffect(() => {
    fetchManuscript();
  }, []);

  const fetchManuscript = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .eq("id", params.id)
      .single();
    if (data) setManuscript(data);
    setLoading(false);
  };

  const handleProofread = async () => {
    setProcessing(true);

    // Update status to processing
    await supabase
      .from("manuscripts")
      .update({ status: "processing" })
      .eq("id", params.id);

    setManuscript((prev: any) => ({ ...prev, status: "processing" }));

    try {
      // Download original file
      const { data: fileData } = await supabase.storage
        .from("manuscripts")
        .download(manuscript.original_file_url);

      if (!fileData) throw new Error("Could not download file");

      // Extract text using mammoth
      const mammoth = await import("mammoth");
      const arrayBuffer = await fileData.arrayBuffer();
      const { value: manuscriptText } = await mammoth.extractRawText({
        arrayBuffer,
      });

      // Send to proofreading API
      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manuscriptText,
          manuscriptId: params.id,
        }),
      });

      const { result } = await response.json();

      // Update manuscript with results
      await supabase
        .from("manuscripts")
        .update({
          status: "completed",
          edit_summary: result.summary,
        })
        .eq("id", params.id);

      setManuscript((prev: any) => ({
        ...prev,
        status: "completed",
        edit_summary: result.summary,
      }));
    } catch (error: any) {
      await supabase
        .from("manuscripts")
        .update({ status: "error" })
        .eq("id", params.id);
      setManuscript((prev: any) => ({ ...prev, status: "error" }));
    }

    setProcessing(false);
  };

  const statusColor: any = {
    pending: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    processing: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    completed: "text-green-400 bg-green-400/10 border-green-400/20",
    error: "text-red-400 bg-red-400/10 border-red-400/20",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Manuscript not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-white">MedProof AI</h1>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          ← Back to dashboard
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Manuscript Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-white">{manuscript.title}</h2>
            <span className={`text-xs font-medium px-3 py-1 rounded-full border ${statusColor[manuscript.status]}`}>
              {manuscript.status}
            </span>
          </div>
          <p className="text-gray-400 text-sm">
            Uploaded {new Date(manuscript.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* Pending */}
        {manuscript.status === "pending" && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <div className="text-5xl mb-4">📄</div>
            <h3 className="text-xl font-semibold text-white mb-2">
              Ready to proofread
            </h3>
            <p className="text-gray-400 mb-8">
              Your manuscript has been uploaded successfully. Click below to start the 7-pass medical proofreading.
            </p>
            <button
              onClick={handleProofread}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3 rounded-xl transition-colors"
            >
              Start Proofreading
            </button>
          </div>
        )}

        {/* Processing */}
        {manuscript.status === "processing" && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-10 text-center">
            <div className="text-5xl mb-4 animate-pulse">⚙️</div>
            <h3 className="text-xl font-semibold text-white mb-2">
              Proofreading in progress
            </h3>
            <p className="text-gray-400">
              Running 7-pass medical journal proofreading. Please wait...
            </p>
            <div className="mt-6 space-y-2 text-left max-w-sm mx-auto">
              {[
                "Pass 1 — Grammar",
                "Pass 2 — Academic English",
                "Pass 3 — Medical Writing",
                "Pass 4 — Journal Style",
                "Pass 5 — APA Guidelines",
                "Pass 6 — Consistency",
                "Pass 7 — Final Quality Review",
              ].map((pass, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-gray-400">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  {pass}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {manuscript.status === "completed" && (
          <div className="space-y-6">
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                ✅ Proofreading Complete
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button className="bg-gray-800 hover:bg-gray-700 text-white py-3 px-4 rounded-xl transition-colors text-sm font-medium">
                  📄 Download Clean Version
                </button>
                <button className="bg-gray-800 hover:bg-gray-700 text-white py-3 px-4 rounded-xl transition-colors text-sm font-medium">
                  🔴 Download Track Changes
                </button>
                <button className="bg-gray-800 hover:bg-gray-700 text-white py-3 px-4 rounded-xl transition-colors text-sm font-medium">
                  📊 View Edit Summary
                </button>
              </div>
            </div>

            {/* Edit Summary */}
            {manuscript.edit_summary && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-white mb-6">Edit Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                  {[
                    { label: "Grammar", value: manuscript.edit_summary.grammar_corrections },
                    { label: "APA", value: manuscript.edit_summary.apa_corrections },
                    { label: "Terminology", value: manuscript.edit_summary.terminology_corrections },
                    { label: "Consistency", value: manuscript.edit_summary.consistency_improvements },
                    { label: "Style", value: manuscript.edit_summary.style_improvements },
                    { label: "Total Edits", value: manuscript.edit_summary.total_edits },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-800 rounded-xl p-4 text-center">
                      <p className="text-2xl font-bold text-white">{item.value}</p>
                      <p className="text-gray-400 text-sm mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
                {manuscript.edit_summary.key_changes?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-3">Key Changes</h4>
                    <ul className="space-y-2">
                      {manuscript.edit_summary.key_changes.map((change: string, i: number) => (
                        <li key={i} className="text-gray-300 text-sm flex gap-2">
                          <span className="text-blue-400">→</span> {change}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {manuscript.status === "error" && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-10 text-center">
            <div className="text-5xl mb-4">❌</div>
            <h3 className="text-xl font-semibold text-white mb-2">Processing failed</h3>
            <p className="text-gray-400 mb-6">
              Something went wrong. Please try again.
            </p>
            <button
              onClick={handleProofread}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl transition-colors text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

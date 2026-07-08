"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [manuscripts, setManuscripts] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/auth/login");
      else setUser(user);
    };
    getUser();
    fetchManuscripts();
  }, []);

  const fetchManuscripts = async () => {
    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setManuscripts(data);
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith(".docx")) {
      alert("Please upload a .docx file");
      return;
    }
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const sanitizedName = file.name
  .replace(/[^\x00-\x7F]/g, "")
  .replace(/\s+/g, "_")
  .replace(/[()]/g, "")
  .replace(/_+/g, "_")
  .replace(/^_|_$/g, "");

const filePath = `${user.id}/${Date.now()}_${sanitizedName || "manuscript.docx"}`;
    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(filePath, file);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: manuscript } = await supabase
      .from("manuscripts")
      .insert({
        user_id: user.id,
        title: file.name.replace(".docx", ""),
        original_file_url: filePath,
        status: "pending",
      })
      .select()
      .single();

    setUploading(false);
    fetchManuscripts();
    if (manuscript) router.push(`/manuscript/${manuscript.id}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const statusColor: any = {
    pending: "text-yellow-400 bg-yellow-400/10",
    processing: "text-blue-400 bg-blue-400/10",
    completed: "text-green-400 bg-green-400/10",
    error: "text-red-400 bg-red-400/10",
  };

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-white">AIPR</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">{user?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Upload Area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFileUpload(file);
          }}
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
            dragOver ? "border-blue-500 bg-blue-500/5" : "border-gray-700 hover:border-gray-600"
          }`}
        >
          <div className="text-4xl mb-4">📄</div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Upload your manuscript
          </h2>
          <p className="text-gray-400 mb-6">
            Drag and drop a .docx file or click to browse
          </p>
          <label className="cursor-pointer">
            <span className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition-colors">
              {uploading ? "Uploading..." : "Choose file"}
            </span>
            <input
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
          </label>
        </div>

        {/* Manuscripts List */}
        {manuscripts.length > 0 && (
          <div className="mt-10">
            <h3 className="text-lg font-semibold text-white mb-4">
              Your manuscripts
            </h3>
            <div className="space-y-3">
              {manuscripts.map((m) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/manuscript/${m.id}`)}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:border-gray-700 transition-colors"
                >
                  <div>
                    <p className="text-white font-medium">{m.title}</p>
                    <p className="text-gray-400 text-sm">
                      {new Date(m.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusColor[m.status]}`}>
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
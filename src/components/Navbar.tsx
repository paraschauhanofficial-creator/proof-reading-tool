"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function Navbar({ showAuth = true }: { showAuth?: boolean }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "dark" | "light" | null;
    const preferred = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(preferred);
    document.documentElement.setAttribute("data-theme", preferred);
  }, []);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <nav style={{
      backgroundColor: "var(--bg)",
      borderBottom: "1px solid var(--border)",
      position: "sticky",
      top: 0,
      zIndex: 50,
    }}>
      <div style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "0 clamp(1rem, 3vw, 1.5rem)",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.3px" }}>
            AI<span style={{ color: "var(--accent)" }}>PR</span>
          </span>
        </Link>

        {/* Desktop Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }} className="aipr-desktop-nav">
          <button
            onClick={toggleTheme}
            style={{
              background: "var(--bg-card)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", borderRadius: "8px",
              width: "34px", height: "34px",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: "16px",
            }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {showAuth && (
            <>
              {user ? (
                <>
                  <Link href="/dashboard" style={{
                    fontSize: "13px", color: "var(--text-secondary)", textDecoration: "none",
                    padding: "7px 14px", borderRadius: "8px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                  }}>Dashboard</Link>
                  <Link href="/records" style={{
                    fontSize: "13px", color: "var(--text-secondary)", textDecoration: "none",
                    padding: "7px 14px", borderRadius: "8px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                  }}>Records</Link>
                  <button onClick={handleSignOut} style={{
                    fontSize: "13px", color: "var(--text-secondary)", background: "transparent",
                    border: "1px solid var(--border)", padding: "7px 14px",
                    borderRadius: "8px", cursor: "pointer",
                  }}>Sign out</button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" style={{
                    fontSize: "13px", color: "var(--text-secondary)", textDecoration: "none",
                    padding: "7px 14px", borderRadius: "8px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                  }}>Sign in</Link>
                  <Link href="/auth/signup" style={{
                    fontSize: "13px", color: "#fff", textDecoration: "none",
                    padding: "7px 14px", borderRadius: "8px", backgroundColor: "var(--accent)",
                  }}>Get started</Link>
                </>
              )}
            </>
          )}
        </div>

        {/* Mobile — theme toggle always visible + hamburger */}
        <div style={{ display: "none", alignItems: "center", gap: "8px" }} className="aipr-mobile-nav">
          <button
            onClick={toggleTheme}
            style={{
              background: "var(--bg-card)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", borderRadius: "8px",
              width: "34px", height: "34px",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: "16px",
            }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: "var(--bg-card)", border: "1px solid var(--border)",
              color: "var(--text-primary)", borderRadius: "8px",
              width: "34px", height: "34px",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: "18px",
            }}
            aria-label="Menu"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      {menuOpen && (
        <div style={{
          backgroundColor: "var(--bg-card)", borderTop: "1px solid var(--border)",
          padding: "1rem clamp(1rem, 3vw, 1.5rem)",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          {user ? (
            <>
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} style={{
                fontSize: "13px", color: "var(--text-primary)", textDecoration: "none",
                padding: "10px 14px", borderRadius: "8px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg)",
              }}>📊 Dashboard</Link>
              <Link href="/records" onClick={() => setMenuOpen(false)} style={{
                fontSize: "13px", color: "var(--text-primary)", textDecoration: "none",
                padding: "10px 14px", borderRadius: "8px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg)",
              }}>📋 Records</Link>
              <button onClick={handleSignOut} style={{
                fontSize: "13px", color: "#ef4444", background: "var(--bg)",
                border: "1px solid rgba(239,68,68,0.3)", padding: "10px 14px",
                borderRadius: "8px", cursor: "pointer", textAlign: "left",
              }}>Sign out</button>
            </>
          ) : (
            <>
              <Link href="/auth/login" onClick={() => setMenuOpen(false)} style={{
                fontSize: "13px", color: "var(--text-primary)", textDecoration: "none",
                padding: "10px 14px", borderRadius: "8px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg)", display: "block",
              }}>Sign in</Link>
              <Link href="/auth/signup" onClick={() => setMenuOpen(false)} style={{
                fontSize: "13px", color: "#fff", textDecoration: "none",
                padding: "10px 14px", borderRadius: "8px",
                backgroundColor: "var(--accent)", display: "block", textAlign: "center",
              }}>Get started</Link>
            </>
          )}
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .aipr-desktop-nav { display: none !important; }
          .aipr-mobile-nav { display: flex !important; }
        }
      `}</style>
    </nav>
  );
}
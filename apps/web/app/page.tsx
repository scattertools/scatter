"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import Link from "next/link";
import { FiUploadCloud, FiFile, FiX, FiLock, FiLink, FiZap } from "react-icons/fi";
import { FaGithub } from "react-icons/fa";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => setFile(f);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  };

  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      {/* Nav */}
      <nav className="border-b-2 border-scatter-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Scatter" className="w-8 h-8" />
            <span className="text-xl font-black tracking-tight">SCATTER</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/about"
              className="brutal-link hidden sm:block px-3 py-2 font-semibold"
            >
              about
            </Link>
            <Link
              href="/download"
              className="brutal-link hidden sm:block px-3 py-2 font-semibold"
            >
              get the app
            </Link>
            <Link
              href="https://github.com/yourusername/scatter"
              aria-label="GitHub"
              className="brutal-link p-2"
            >
              <FaGithub size={20} />
            </Link>
            <Link
              href="/dashboard"
              className="brutal-btn-sm ml-1 px-4 py-2 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal-sm"
            >
              sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <div className="max-w-3xl mx-auto px-6 py-12 md:py-20">
        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-3">
            share any file, privately.
          </h1>
          <p className="text-lg text-scatter-muted font-medium">
            drop a file, get a link. only people with the link can open it.
          </p>
        </div>

        {/* Upload box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !file && inputRef.current?.click()}
          className={`
            relative border-2 border-scatter-border bg-scatter-surface
            ${file ? "" : "cursor-pointer hover:shadow-brutal-lg hover:-translate-x-1 hover:-translate-y-1"}
            ${dragging ? "bg-scatter-primary/10 shadow-brutal-lg -translate-x-1 -translate-y-1" : "shadow-brutal"}
            transition-all duration-100
          `}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleInputChange}
          />

          {!file ? (
            <div className="py-20 md:py-24 px-6 text-center">
              <FiUploadCloud
                size={72}
                className="mx-auto mb-6 text-scatter-border"
                strokeWidth={1.5}
              />
              <p className="text-2xl font-bold mb-2">drop a file here</p>
              <p className="text-scatter-muted">
                or <span className="underline font-semibold">click to browse</span>
              </p>
              <p className="text-xs text-scatter-muted mt-6 font-mono">
                up to 1 GB free · earn more by running the app
              </p>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-6 p-4 border-2 border-scatter-border bg-scatter-bg">
                <div className="flex items-start gap-3 min-w-0">
                  <FiFile size={24} className="flex-shrink-0 mt-1" />
                  <div className="min-w-0">
                    <p className="font-bold truncate">{file.name}</p>
                    <p className="text-sm text-scatter-muted font-mono">
                      {formatSize(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="brutal-link flex-shrink-0 p-1"
                  aria-label="Remove file"
                >
                  <FiX size={20} />
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => alert("Upload logic coming soon!")}
                  className="brutal-btn flex-1 px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-2"
                >
                  <FiLock size={18} /> upload & get link
                </button>
                <button
                  onClick={() => setFile(null)}
                  className="brutal-btn-sm px-6 py-4 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm"
                >
                  cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stats bar */}
        <div className="mt-8 grid grid-cols-3 gap-0 border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <Stat label="people helping" value="1,247" />
          <Stat label="space available" value="12.4 TB" />
          <Stat label="files shared" value="8,391" />
        </div>

        {/* Quick info — friendlier copy */}
        <div className="mt-12 grid md:grid-cols-3 gap-4">
          <InfoCard
            icon={<FiLock size={20} />}
            title="private by default"
            desc="your files are locked up on your device before they leave. only the link can open them."
          />
          <InfoCard
            icon={<FiZap size={20} />}
            title="fast and resilient"
            desc="files are spread across many computers. if some go offline, your file still works."
          />
          <InfoCard
            icon={<FiLink size={20} />}
            title="share with a link"
            desc="send one link to anyone. no accounts needed to download."
          />
        </div>

        {/* Node CTA */}
        <div className="mt-12 p-6 border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-black mb-1">
                got spare storage? earn bigger uploads.
              </h3>
              <p className="text-scatter-muted">
                install our little app, share some space, get more room for your own files.
              </p>
            </div>
            <Link
              href="/download"
              className="brutal-btn-sm px-5 py-3 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal-sm whitespace-nowrap"
            >
              get the app →
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t-2 border-scatter-border mt-16">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="font-mono text-scatter-muted">
            scatter.tools — © 2026
          </div>
          <div className="flex items-center gap-5 font-semibold">
            <Link href="/privacy" className="brutal-link">privacy</Link>
            <Link href="/terms" className="brutal-link">terms</Link>
            <Link href="/docs" className="brutal-link">docs</Link>
            <Link href="/status" className="brutal-link flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-scatter-primary" />
              status
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 text-center border-r-2 border-scatter-border last:border-r-0">
      <div className="text-2xl md:text-3xl font-black font-mono">{value}</div>
      <div className="text-xs text-scatter-muted uppercase tracking-wider mt-1 font-semibold">
        {label}
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="p-5 border-2 border-scatter-border bg-scatter-surface">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="font-bold">{title}</h3>
      </div>
      <p className="text-sm text-scatter-muted leading-relaxed">{desc}</p>
    </div>
  );
}
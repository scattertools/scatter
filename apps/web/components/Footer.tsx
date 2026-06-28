import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-scatter-border">
      <div className="max-w-5xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="font-mono text-scatter-muted">
          scatter.tools — © 2026
        </div>
        <div className="flex items-center gap-5 font-semibold">
          <Link href="/privacy" className="brutal-link px-2 py-1">
            privacy
          </Link>
          <Link href="/terms" className="brutal-link px-2 py-1">
            terms
          </Link>
          <Link href="/about" className="brutal-link px-2 py-1">
            about
          </Link>
          <Link
            href="/status"
            className="brutal-link px-2 py-1 flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full bg-scatter-primary" />
            status
          </Link>
        </div>
      </div>
    </footer>
  );
}

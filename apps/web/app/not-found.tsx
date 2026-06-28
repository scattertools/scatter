import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text flex flex-col">
      <Nav />

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md text-center">
          <p className="text-scatter-muted font-mono text-sm mb-2">{'// 404'}</p>
          <h1 className="text-7xl font-black tracking-tight mb-4">
            scattered.
          </h1>
          <p className="text-xl text-scatter-muted mb-8 font-medium">
            this page seems to have been split into too many pieces.
          </p>
          <Link
            href="/"
            className="brutal-btn inline-block px-6 py-3 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal"
          >
            go home
          </Link>
        </div>
      </div>

      <Footer />
    </main>
  );
}

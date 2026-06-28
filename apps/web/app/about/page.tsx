import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function About() {
  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      <Nav />

      <article className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        <p className="text-scatter-muted font-mono text-sm mb-2">// about</p>
        <h1 className="text-5xl font-black tracking-tight mb-4">
          how scatter works.
        </h1>
        <p className="text-xl text-scatter-muted mb-12 font-medium">
          file sharing that doesn't trust a company — including us.
        </p>

        <Section title="the problem">
          <p>
            when you upload a file to dropbox, google drive, or wetransfer,
            you're trusting that company with your data. they can read it, scan
            it, lose it, or hand it over to whoever asks.
          </p>
          <p>
            scatter was built on a simple idea:{' '}
            <strong>
              what if the service couldn't read your files, even if it wanted
              to?
            </strong>
          </p>
        </Section>

        <Section title="the approach">
          <ol className="space-y-3">
            <Step n="1" title="encrypt">
              your file is locked with a random key, right in your browser. the
              key never leaves your device.
            </Step>
            <Step n="2" title="shard">
              the encrypted file is split into 14 pieces using reed-solomon
              erasure coding. any 10 pieces can rebuild the whole thing — so if
              some pieces go missing, your file is still safe.
            </Step>
            <Step n="3" title="scatter">
              pieces go to different computers contributed by people running our
              node app. no single machine has enough to read anything.
            </Step>
            <Step n="4" title="share">
              you get a link like{' '}
              <code className="font-mono text-sm bg-scatter-surface border-2 border-scatter-border px-1">
                scatter.tools/f/abc123#key
              </code>
              . the part after the <code>#</code> — the decryption key — is
              never sent to our server. browsers don't send it.
            </Step>
          </ol>
        </Section>

        <Section title="what we can see">
          <p>honest list of what our servers know:</p>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>that someone uploaded a file of a certain size</li>
            <li>which nodes are holding which encrypted pieces</li>
            <li>when the file was created</li>
          </ul>
          <p className="mt-4">
            things we <strong>can't</strong> see:
          </p>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>the contents of the file</li>
            <li>the original filename (it's encrypted with everything else)</li>
            <li>who downloaded it</li>
          </ul>
        </Section>

        <Section title="the catch">
          <p>
            nothing is free. scatter runs because people volunteer their unused
            storage. to keep it sustainable:
          </p>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>
              guest uploads are capped at 100 mb and expire after 24 hours
            </li>
            <li>
              free accounts can upload up to 1 gb, kept until you delete them
            </li>
            <li>
              <Link
                href="/download"
                className="underline font-semibold brutal-link"
              >
                run a node
              </Link>{' '}
              and share spare storage to earn credits toward bigger uploads
            </li>
          </ul>
        </Section>

        <Section title="who's behind this">
          <p>scatter is funded and built by the community.</p>
          <p>
            if you want to support it: run a node, star the{' '}
            <Link
              href="https://github.com/scattertools/scatter"
              className="underline font-semibold brutal-link"
            >
              repo
            </Link>
            ,{' '}
            <Link
              href="https://github.com/sponsors/scattertools"
              className="underline font-semibold brutal-link"
            >
              donate
            </Link>{' '}
            directly, or tell a friend.
          </p>
        </Section>

        <Section title="open source">
          <p>
            the whole stack is open source under AGPL-3.0.{' '}
            <Link
              href="https://github.com/scattertools/scatter"
              className="underline font-semibold brutal-link"
            >
              see the code on github
            </Link>
            . you can self-host your own scatter instance for your team or
            community.
          </p>
        </Section>

        <div className="mt-12 p-6 border-2 border-scatter-border bg-scatter-primary text-white shadow-brutal">
          <h3 className="text-xl font-black mb-1">ready to try it?</h3>
          <p className="mb-4 opacity-90">
            upload your first file — no account needed.
          </p>
          <Link
            href="/"
            className="brutal-btn-sm inline-block px-5 py-3 bg-white text-scatter-primary font-bold border-2 border-scatter-border shadow-brutal-sm"
          >
            get started →
          </Link>
        </div>
      </article>

      <Footer />
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-2xl font-black mb-4">{title}</h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 border-2 border-scatter-border bg-scatter-primary text-white font-mono font-black flex items-center justify-center">
        {n}
      </div>
      <div>
        <h3 className="font-black mb-1">{title}</h3>
        <p className="text-scatter-muted">{children}</p>
      </div>
    </li>
  );
}

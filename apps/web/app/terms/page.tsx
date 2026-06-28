import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function Terms() {
  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      <Nav />

      <article className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        <p className="text-scatter-muted font-mono text-sm mb-2">// terms</p>
        <h1 className="text-5xl font-black tracking-tight mb-4">
          terms of use.
        </h1>
        <p className="text-scatter-muted mb-12 font-mono text-sm">
          last updated: 2026
        </p>

        <div className="p-4 border-2 border-scatter-border bg-scatter-warning/10 mb-10">
          <p className="font-bold mb-1">plain english:</p>
          <p className="text-sm text-scatter-muted">
            don't use scatter for illegal stuff, don't break the network on
            purpose, and understand that it's an open-source project without
            warranties. full text below.
          </p>
        </div>

        <Section title="what you can do">
          <p>
            share legal files. run a node. self-host your own instance.
            contribute to the code.
          </p>
        </Section>

        <Section title="what you can't do">
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>upload content that violates laws in your jurisdiction</li>
            <li>
              distribute child exploitation material (ever, anywhere, no
              exceptions)
            </li>
            <li>use scatter to distribute malware or phishing content</li>
            <li>
              abuse the network (spam uploads, abuse rate limits, exploit the
              protocol)
            </li>
            <li>try to de-anonymize other users</li>
          </ul>
          <p>
            if we're notified of abuse on the hosted scatter.tools service,
            we'll delete the file from our coordinator's records — which
            effectively breaks reassembly. we can't see content, but we can
            respond to reports about specific file ids.
          </p>
        </Section>

        <Section title="running a node">
          <p>
            nodes hold encrypted shards on behalf of the network. you don't host
            "files" in any meaningful sense — you host opaque encrypted blobs
            that can't be read, categorized, or reconstructed on your machine
            alone.
          </p>
          <p>
            you can leave the network at any time. the 10-of-14 erasure coding
            means your departure doesn't break anyone's files.
          </p>
        </Section>

        <Section title="credits">
          <p>
            credits are an internal accounting system, not currency. they have
            no cash value, can't be transferred, and may be adjusted or reset if
            we find bugs in the earning system.
          </p>
        </Section>

        <Section title="no warranty">
          <p>
            scatter is provided "as is" without warranty of any kind. we do our
            best to keep files available, but we can't guarantee it. don't use
            scatter as your only backup.
          </p>
          <p>
            to be extra clear: this service may lose your files. keep originals.
          </p>
        </Section>

        <Section title="account termination">
          <p>
            we can suspend accounts that violate these terms. you can delete
            your account anytime from the{' '}
            <Link
              href="/dashboard"
              className="underline font-semibold brutal-link"
            >
              dashboard
            </Link>
            .
          </p>
        </Section>

        <Section title="changes">
          <p>
            if we update these terms, we'll change the date above. continued use
            after changes means you accept them.
          </p>
        </Section>

        <Section title="open source license">
          <p>
            the scatter software itself is licensed under AGPL-3.0. see{' '}
            <Link
              href="https://github.com/scattertools/scatter/blob/main/LICENSE"
              className="underline font-semibold brutal-link"
            >
              the license
            </Link>{' '}
            for details.
          </p>
          <p>
            these terms cover the hosted service at scatter.tools. if you
            self-host, you set your own terms.
          </p>
        </Section>

        <Section title="contact">
          <p>
            abuse reports:{' '}
            <a
              href="mailto:abuse@scatter.tools"
              className="underline font-semibold brutal-link"
            >
              abuse@scatter.tools
            </a>
          </p>
          <p>
            everything else:{' '}
            <a
              href="mailto:hello@scatter.tools"
              className="underline font-semibold brutal-link"
            >
              hello@scatter.tools
            </a>
          </p>
        </Section>
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

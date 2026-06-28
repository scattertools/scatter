import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function Privacy() {
  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      <Nav />

      <article className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        <p className="text-scatter-muted font-mono text-sm mb-2">// privacy</p>
        <h1 className="text-5xl font-black tracking-tight mb-4">
          privacy policy.
        </h1>
        <p className="text-scatter-muted mb-12 font-mono text-sm">
          last updated: 2026
        </p>

        <Section title="the short version">
          <p>
            we designed scatter so we <strong>can't</strong> see your files —
            not just that we promise not to. the decryption key never touches
            our servers. we'd have to rewrite the product to spy on you.
          </p>
          <p>that said, here's what we do collect and why.</p>
        </Section>

        <Section title="what we collect">
          <h3 className="font-black mb-2">for every upload (even anonymous)</h3>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted mb-4">
            <li>file size (in bytes)</li>
            <li>number of shards and their sizes</li>
            <li>ip address of the uploader (temporarily, for rate limiting)</li>
            <li>timestamp</li>
          </ul>

          <h3 className="font-black mb-2">if you have an account</h3>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted mb-4">
            <li>your email address</li>
            <li>when you sign in</li>
            <li>
              links between you and the files you upload (so you can manage
              them)
            </li>
            <li>credit balance and history</li>
          </ul>

          <h3 className="font-black mb-2">if you run a node</h3>
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>your node's id and declared capacity</li>
            <li>when we last heard from your node</li>
            <li>
              which encrypted shards you're holding (we don't know what they
              contain)
            </li>
          </ul>
        </Section>

        <Section title="what we can't see">
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>the contents of any file</li>
            <li>original filenames</li>
            <li>who downloads a file (downloads don't require an account)</li>
            <li>
              the decryption key — it lives in the <code>#fragment</code> of
              share links, which browsers never send to us
            </li>
          </ul>
        </Section>

        <Section title="who we share with">
          <p>
            <strong>no one.</strong> we don't sell data, we don't do ads, and we
            don't have analytics trackers on the site.
          </p>
          <p>
            the only exception: if we receive a valid legal request, we'll
            provide what we technically have access to (see "what we collect"
            above). we can't hand over files themselves — we don't have the
            keys.
          </p>
        </Section>

        <Section title="how long we keep things">
          <ul className="list-disc ml-6 space-y-1 text-scatter-muted">
            <li>
              anonymous uploads: 24 hours, then the encrypted shards are deleted
            </li>
            <li>
              account uploads: until you delete them or delete your account
            </li>
            <li>ip addresses for rate limiting: 24 hours</li>
            <li>sign-in magic links: 15 minutes, then invalidated</li>
          </ul>
        </Section>

        <Section title="your rights">
          <p>
            you can delete your account at any time from the{' '}
            <Link
              href="/dashboard"
              className="underline font-semibold brutal-link"
            >
              dashboard
            </Link>
            . deletion is permanent and removes your email, credits, and
            uploaded files.
          </p>
          <p>
            want a copy of your data? email{' '}
            <a
              href="mailto:privacy@scatter.tools"
              className="underline font-semibold brutal-link"
            >
              privacy@scatter.tools
            </a>
            .
          </p>
        </Section>

        <Section title="cookies">
          <p>
            we use <strong>one</strong> cookie-like thing: a session token in
            your browser's local storage after you sign in. it's not cross-site,
            it's not tracking, it's just how we know it's you on your next
            visit.
          </p>
        </Section>

        <Section title="changes">
          <p>
            if we change this policy, we'll update the date above and note
            significant changes on the homepage. if we ever make a change that
            would affect your privacy negatively, we'll email account holders
            first.
          </p>
        </Section>

        <Section title="questions">
          <p>
            email{' '}
            <a
              href="mailto:privacy@scatter.tools"
              className="underline font-semibold brutal-link"
            >
              privacy@scatter.tools
            </a>{' '}
            or open an issue on{' '}
            <Link
              href="https://github.com/scattertools/scatter"
              className="underline font-semibold brutal-link"
            >
              github
            </Link>
            .
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

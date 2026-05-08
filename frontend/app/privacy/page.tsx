import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — Bailey & Beau' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
      <header className="bg-white border-b border-[#eccdca] px-8 py-4 flex items-center justify-between">
        <Link href="/" className="font-baloo text-xl font-bold text-[#3d3b62]">Bailey &amp; Beau</Link>
        <Link href="/login" className="text-sm text-[#3d3b62] hover:underline">Sign in</Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-baloo text-4xl font-bold text-[#3d3b62] mb-2">Privacy Policy</h1>
        <p className="text-stone-400 text-sm mb-10">Last updated: 1 May 2026</p>

        <section className="space-y-8 text-[15px] leading-relaxed">
          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">1. Who we are</h2>
            <p>Bailey &amp; Beau (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is an interactive family reading platform. Our service allows families to share live, structured reading sessions over the internet. Our contact email is <a href="mailto:hello@bailyandbeau.com" className="text-[#3b85a6] underline">hello@bailyandbeau.com</a>.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">2. What data we collect</h2>
            <ul className="list-disc pl-5 space-y-1 text-stone-600">
              <li><strong>Account data:</strong> name, email address, username, password (hashed).</li>
              <li><strong>Child profile data:</strong> display name and age band only — no date of birth, no photos.</li>
              <li><strong>Session data:</strong> session start/end times, book title, page reached, duration.</li>
              <li><strong>Payment data:</strong> managed entirely by Stripe. We do not store card numbers.</li>
              <li><strong>Technical data:</strong> browser type, approximate location (country), error logs.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">3. How we use your data</h2>
            <ul className="list-disc pl-5 space-y-1 text-stone-600">
              <li>To provide and improve the reading platform.</li>
              <li>To process payments and manage your subscription.</li>
              <li>To send reading reminders you have opted in to.</li>
              <li>To detect and fix technical errors (Sentry error tracking).</li>
            </ul>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">4. Children&apos;s data</h2>
            <p className="text-stone-600">We collect only a display name and age band for child profiles. We do not collect dates of birth, photographs, or any other personal data about children. Sessions are private and invite-only — there is no public profile or discovery feature. We do not share child data with any third party.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">5. Data sharing</h2>
            <p className="text-stone-600">We share data only with: <strong>Stripe</strong> (payments), <strong>LiveKit</strong> (real-time video infrastructure), <strong>AWS S3</strong> (book asset storage), and <strong>Sentry</strong> (error tracking). We do not sell your data.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">6. Your rights (GDPR)</h2>
            <p className="text-stone-600 mb-2">Under GDPR you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 text-stone-600">
              <li><strong>Access</strong> — request a copy of your data.</li>
              <li><strong>Erasure</strong> — request deletion of your account and all associated data.</li>
              <li><strong>Portability</strong> — receive your data in a machine-readable format.</li>
              <li><strong>Objection</strong> — object to processing for direct marketing.</li>
            </ul>
            <p className="text-stone-600 mt-2">To exercise these rights, go to <Link href="/dashboard/settings" className="text-[#3b85a6] underline">Account Settings</Link> or email <a href="mailto:hello@bailyandbeau.com" className="text-[#3b85a6] underline">hello@bailyandbeau.com</a>.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">7. Data retention</h2>
            <p className="text-stone-600">We retain account data for as long as your account is active. Session metadata is retained for up to 24 months for service improvement. You may request deletion at any time.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">8. Cookies</h2>
            <p className="text-stone-600">We use a single session cookie for authentication and an optional analytics cookie. You can withdraw consent at any time via the cookie banner or your browser settings.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">9. Contact</h2>
            <p className="text-stone-600">Bailey &amp; Beau · <a href="mailto:hello@bailyandbeau.com" className="text-[#3b85a6] underline">hello@bailyandbeau.com</a></p>
          </div>
        </section>
      </main>
    </div>
  );
}

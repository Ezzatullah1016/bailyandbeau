import Link from 'next/link';

export const metadata = { title: 'Terms of Service — Bailey & Beau' };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
      <header className="bg-white border-b border-[#eccdca] px-8 py-4 flex items-center justify-between">
        <Link href="/" className="font-baloo text-xl font-bold text-[#3d3b62]">Bailey &amp; Beau</Link>
        <Link href="/login" className="text-sm text-[#3d3b62] hover:underline">Sign in</Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-baloo text-4xl font-bold text-[#3d3b62] mb-2">Terms of Service</h1>
        <p className="text-stone-400 text-sm mb-10">Last updated: 1 May 2026</p>

        <section className="space-y-8 text-[15px] leading-relaxed">
          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">1. Acceptance</h2>
            <p className="text-stone-600">By creating an account or using Bailey &amp; Beau, you agree to these Terms. If you do not agree, please do not use the service.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">2. Service description</h2>
            <p className="text-stone-600">Bailey &amp; Beau provides a web-based platform for live, structured reading sessions between family members. Sessions require an internet connection and a modern browser.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">3. Accounts</h2>
            <p className="text-stone-600">You must be 18 or over to create an account. You are responsible for maintaining the confidentiality of your login credentials. Invited guests (without accounts) may join sessions via a shared link.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">4. Subscriptions and payments</h2>
            <p className="text-stone-600">Subscriptions are billed monthly or annually via Stripe. Session packs are non-refundable once used. You may cancel your subscription at any time; access continues until the end of the billing period.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">5. Acceptable use</h2>
            <p className="text-stone-600">You agree not to use the service to share illegal, harmful, or offensive content. Sessions are private and invite-only. Any misuse may result in immediate account termination.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">6. Intellectual property</h2>
            <p className="text-stone-600">All book content, platform design, and software are owned by or licensed to Bailey &amp; Beau. You may not copy, redistribute, or reverse-engineer any part of the platform.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">7. Limitation of liability</h2>
            <p className="text-stone-600">Bailey &amp; Beau is provided &ldquo;as is&rdquo;. We are not liable for any loss arising from interruptions to the service, connection failures, or third-party service outages.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">8. Changes</h2>
            <p className="text-stone-600">We may update these Terms from time to time. Continued use of the service after changes constitutes acceptance.</p>
          </div>

          <div>
            <h2 className="font-baloo text-xl font-bold text-[#3d3b62] mb-3">9. Contact</h2>
            <p className="text-stone-600">Bailey &amp; Beau · <a href="mailto:hello@bailyandbeau.com" className="text-[#3b85a6] underline">hello@bailyandbeau.com</a></p>
          </div>
        </section>

        <div className="mt-12 pt-8 border-t border-[#eccdca] text-sm text-stone-400">
          <Link href="/privacy" className="underline hover:text-[#3d3b62]">Privacy Policy</Link>
        </div>
      </main>
    </div>
  );
}

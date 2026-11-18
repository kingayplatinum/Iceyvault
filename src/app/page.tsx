"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronDown,
  CircleHelp, Globe2, Headphones, LockKeyhole, Menu, MessageCircle, Search,
  ShieldCheck, Smartphone, Sparkles, Wallet, X, Zap,
} from "lucide-react";

type Category = "All services" | "WhatsApp" | "Telegram" | "Other services" | "Rentals";
type Offer = { id: string; country: string; flag: string; service: string; kind: string; category: Category; detail: string; };

const offers: Offer[] = [
  { id: "us-wa", country: "United States", flag: "🇺🇸", service: "WhatsApp", kind: "SMS activation", category: "WhatsApp", detail: "US number · One-time verification" },
  { id: "uk-wa", country: "United Kingdom", flag: "🇬🇧", service: "WhatsApp", kind: "SMS activation", category: "WhatsApp", detail: "UK number · One-time verification" },
  { id: "us-tg", country: "United States", flag: "🇺🇸", service: "Telegram", kind: "SMS activation", category: "Telegram", detail: "US number · One-time verification" },
  { id: "uk-tg", country: "United Kingdom", flag: "🇬🇧", service: "Telegram", kind: "SMS activation", category: "Telegram", detail: "UK number · One-time verification" },
  { id: "us-other", country: "United States", flag: "🇺🇸", service: "Other platforms", kind: "SMS activation", category: "Other services", detail: "US number · Supported services" },
  { id: "uk-rent", country: "United Kingdom", flag: "🇬🇧", service: "Private number", kind: "Number rental", category: "Rentals", detail: "UK number · Rental options" },
];

const categories: Category[] = ["All services", "WhatsApp", "Telegram", "Other services", "Rentals"];

export default function Home() {
  const [category, setCategory] = useState<Category>("All services");
  const [country, setCountry] = useState("All countries");
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const filtered = useMemo(() => offers.filter((offer) => {
    const categoryMatch = category === "All services" || offer.category === category;
    const countryMatch = country === "All countries" || offer.country === country;
    const queryMatch = !query || (offer.service + " " + offer.country + " " + offer.detail).toLowerCase().includes(query.toLowerCase());
    return categoryMatch && countryMatch && queryMatch;
  }), [category, country, query]);

  return (
    <main>
      <div className="announcement"><span className="announcement-dot" /> A better way to manage virtual numbers <span className="announcement-link">Explore IceyVault <ArrowRight size={13} /></span></div>
      <header className="site-header">
        <div className="nav-wrap">
          <a className="brand" href="#" aria-label="IceyVault home"><span className="brand-mark">i</span><span>icey<span className="brand-accent">vault</span></span></a>
          <nav className={mobileOpen ? "main-nav mobile-visible" : "main-nav"}>
            <a href="#services" onClick={() => setMobileOpen(false)}>Explore services</a>
            <a href="#how" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#trust" onClick={() => setMobileOpen(false)}>Why IceyVault</a>
            <a href="#help" onClick={() => setMobileOpen(false)}>Help</a>
          </nav>
          <div className="nav-actions">
            <a className="login-link" href="#account">Log in</a>
            <a className="button button-small" href="#account">Create account <ArrowRight size={15} /></a>
          </div>
          <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" />
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14} /> YOUR DIGITAL NUMBER HUB</div>
            <h1>Stay connected.<br /><span>Keep control.</span></h1>
            <p className="hero-description">Access supported virtual number services from one secure place. Choose a country, find the service you need, and manage everything in your IceyVault account.</p>
            <div className="hero-actions"><a className="button" href="#services">Explore number services <ArrowRight size={17} /></a><a className="text-link" href="#how">See how it works <ArrowRight size={15} /></a></div>
            <div className="hero-assurance"><span><ShieldCheck size={16} /> Privacy-minded by design</span><i /> <span><Zap size={15} /> Simple, clear checkout</span></div>
          </div>
          <div className="hero-visual">
            <div className="visual-orbit orbit-a" /><div className="visual-orbit orbit-b" />
            <div className="vault-card">
              <div className="vault-card-top"><div className="vault-symbol"><LockKeyhole size={18} /></div><span className="live-label"><span /> ACCOUNT PREVIEW</span></div>
              <div className="balance-label">Your wallet balance</div><div className="balance-amount">₦0<span>.00</span></div>
              <div className="balance-caption">NGN · Demo view until account setup</div>
              <div className="wallet-actions"><a href="#account"><ArrowDownToLine size={17} /><span>Add funds</span></a><a href="#account"><ArrowUpRight size={17} /><span>Transactions</span></a></div>
              <div className="vault-divider" />
              <div className="activity-row"><div className="activity-icon"><MessageCircle size={17} /></div><div><b>Number activity</b><small>Your orders will appear here</small></div><span className="activity-empty">—</span></div>
              <div className="card-foot"><ShieldCheck size={14} /> Your account activity, in one place</div>
            </div>
            <div className="floating-chip chip-top"><span className="chip-flag">🇺🇸</span><span><b>United States</b><small>Number services</small></span><BadgeCheck size={16} /></div>
            <div className="floating-chip chip-bottom"><div className="chip-message"><MessageCircle size={17} /></div><span><b>One simple dashboard</b><small>Orders · Wallet · Messages</small></span></div>
          </div>
        </div>
        <div className="hero-bottom"><span>BUILT FOR SIMPLE, RESPONSIBLE ACCESS</span><div><span><LockKeyhole size={14} /> Secure account controls</span><span><Globe2 size={14} /> Multi-country catalogue</span><span><Headphones size={14} /> Support when you need it</span></div></div>
      </section>

      <section className="catalog-section" id="services">
        <div className="section-wrap">
          <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> THE CATALOGUE</div><h2>Find the number<br className="mobile-break" /> service you need.</h2><p>Explore services by platform and country. Prices and availability will appear when verified supplier inventory is connected.</p></div><div className="catalog-count"><b>06</b><span>service options<br />in preview</span></div></div>
          <div className="catalog-toolbar">
            <div className="category-tabs" role="tablist" aria-label="Filter by service">
              {categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? "category-tab active" : "category-tab"} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="catalog-filters">
              <label className="search-box"><Search size={16} /><input aria-label="Search services" placeholder="Search services" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label className="country-select"><Globe2 size={15} /><select aria-label="Filter by country" value={country} onChange={(event) => setCountry(event.target.value)}><option>All countries</option><option>United States</option><option>United Kingdom</option></select><ChevronDown size={14} /></label>
            </div>
          </div>
          <div className="offer-grid">
            {filtered.map((offer) => <article className="offer-card" key={offer.id}>
              <div className="offer-card-head"><span className="country-flag">{offer.flag}</span><span className="availability-pill"><span /> Supplier check pending</span></div>
              <div className="offer-country">{offer.country}</div><h3>{offer.service}</h3><p>{offer.detail}</p>
              <div className="offer-card-bottom"><div><small>PRICE</small><b>Quote pending</b></div><span className="offer-type">{offer.kind}</span></div>
              <button className="offer-action" onClick={() => document.getElementById("account")?.scrollIntoView({ behavior: "smooth" })}>View service <ArrowRight size={15} /></button>
            </article>)}
            {filtered.length === 0 && <div className="empty-state"><Search size={22} /><b>No matching services</b><span>Try another search or clear your filters.</span><button onClick={() => { setCategory("All services"); setCountry("All countries"); setQuery(""); }}>Clear filters</button></div>}
          </div>
          <div className="catalog-note"><ShieldCheck size={17} /><span><b>Transparent availability.</b> We only display live prices and stock after a supplier check. No guessed prices or misleading availability.</span></div>
        </div>
      </section>

      <section className="steps-section" id="how"><div className="section-wrap"><div className="center-heading"><div className="eyebrow"><span className="eyebrow-line" /> HOW IT WORKS</div><h2>Everything in three simple steps.</h2><p>A straightforward experience from choosing a service to managing your activity.</p></div>
        <div className="steps-grid"><article className="step-card"><span className="step-number">01</span><div className="step-icon"><Globe2 size={22} /></div><h3>Choose your service</h3><p>Browse available countries, platforms and number options in one organised catalogue.</p></article><article className="step-card"><span className="step-number">02</span><div className="step-icon"><Wallet size={22} /></div><h3>Fund your wallet</h3><p>When payments are enabled, add NGN funds through the supported checkout options.</p></article><article className="step-card"><span className="step-number">03</span><div className="step-icon"><Smartphone size={22} /></div><h3>Manage your activity</h3><p>Keep track of eligible orders, number status and messages from your account dashboard.</p></article></div>
      </div></section>

      <section className="trust-section" id="trust"><div className="section-wrap trust-inner"><div><div className="eyebrow"><span className="eyebrow-line" /> BUILT AROUND TRUST</div><h2>Clarity at every<br />step of the journey.</h2><p>IceyVault is being built around transparent service information, responsible access and clear account controls.</p><a className="text-link" href="#help">Learn about our approach <ArrowRight size={15} /></a></div><div className="trust-points"><div><span><ShieldCheck size={20} /></span><section><b>Security-conscious foundations</b><p>Account data and payment operations are designed to be handled separately and securely.</p></section></div><div><span><BadgeCheck size={20} /></span><section><b>Clear service information</b><p>Country, service type, term and availability will be shown before checkout.</p></section></div><div><span><CircleHelp size={20} /></span><section><b>Support and accountability</b><p>Clear order status and support paths help you understand what happens next.</p></section></div></div></div></section>

      <section className="cta-section" id="account"><div className="cta-card"><div className="cta-orb" /><div className="eyebrow"><Sparkles size={14} /> YOUR NEXT STEP</div><h2>Your number services,<br /><span>all in one vault.</span></h2><p>Account registration and live checkout will be enabled in the next build stage.</p><button className="button" disabled>Create account <ArrowRight size={16} /></button><small>Account access is not active in this preview.</small></div></section>

      <footer className="site-footer" id="help"><div className="footer-main"><a className="brand" href="#"><span className="brand-mark">i</span><span>icey<span className="brand-accent">vault</span></span></a><p>A simpler home for supported virtual number services.</p><div className="footer-links"><a href="#services">Services</a><a href="#how">How it works</a><a href="#trust">Trust & safety</a><a href="mailto:support@iceyvault.com">Contact</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} IceyVault. All rights reserved.</span><span>Preview environment · Live services not yet connected</span></div></footer>
    </main>
  );
}

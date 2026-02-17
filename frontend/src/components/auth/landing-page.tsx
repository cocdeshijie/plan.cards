"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Gift,
  Hash,
  Bell,
  CalendarDays,
  LogIn,
  ArrowRight,
  Sun,
  Moon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AppFooter } from "@/components/ui/app-footer";
import { API_BASE, getTemplateImageUrl, getTemplates } from "@/lib/api";
import type { CardTemplate } from "@/types";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FEATURES = [
  {
    icon: Gift,
    title: "Track Benefits & Credits",
    description:
      "Monitor recurring credits across all your cards. Never miss a statement credit again.",
  },
  {
    icon: Hash,
    title: "5/24 Rule Counter",
    description:
      "Stay on top of Chase's 5/24 rule with automatic tracking per profile.",
  },
  {
    icon: Bell,
    title: "Annual Fee Alerts",
    description:
      "Get reminders before annual fees hit so you can downgrade or cancel in time.",
  },
  {
    icon: CalendarDays,
    title: "Card Timeline",
    description:
      "View your complete card history — openings, closings, product changes, and more.",
  },
];

/* ---------- Fan Card Stack (Poker Hand) ---------- */

const CARD_COUNT = 5;
const TILT_MAX = 10;
const FAN_ROTATE = 6;
const FAN_SPREAD = 38;
const FAN_ARC = 10;

function FanCard({
  card,
  index,
  total,
  isHovered,
  onHover,
  onLeave,
}: {
  card: CardTemplate;
  index: number;
  total: number;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const springX = useSpring(tiltX, { stiffness: 200, damping: 20 });
  const springY = useSpring(tiltY, { stiffness: 200, damping: 20 });

  const mid = (total - 1) / 2;
  const offset = index - mid;

  const restRotateZ = offset * FAN_ROTATE;
  const restX = offset * FAN_SPREAD;
  const restY = Math.abs(offset) * FAN_ARC;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      tiltY.set(nx * TILT_MAX);
      tiltX.set(-ny * TILT_MAX);
    },
    [tiltX, tiltY]
  );

  const handleLeave = useCallback(() => {
    onLeave();
    tiltX.set(0);
    tiltY.set(0);
  }, [onLeave, tiltX, tiltY]);

  const initRotateZ = useMemo(() => (Math.random() - 0.5) * 50, []);

  return (
    <motion.div
      ref={ref}
      className="absolute top-1/2 left-1/2 origin-bottom cursor-pointer"
      style={{
        width: "55%",
        aspectRatio: "1.586 / 1",
        zIndex: isHovered ? 50 : total - Math.abs(offset),
        rotateX: springX,
        rotateY: springY,
      }}
      initial={{
        x: "-50%",
        y: "-50%",
        rotateZ: initRotateZ,
        translateX: (Math.random() - 0.5) * 400,
        translateY: -350 - Math.random() * 150,
        opacity: 0,
        scale: 0.7,
      }}
      animate={{
        x: "-50%",
        y: "-50%",
        rotateZ: isHovered ? 0 : restRotateZ,
        translateX: restX,
        translateY: isHovered ? restY - 25 : restY,
        opacity: 1,
        scale: isHovered ? 1.06 : 1,
      }}
      transition={{
        type: "spring",
        stiffness: 70,
        damping: 16,
        delay: index * 0.12,
      }}
      onMouseEnter={onHover}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleLeave}
    >
      <div
        className="w-full h-full rounded-xl overflow-hidden ring-1 ring-white/20 dark:ring-white/10"
        style={{
          boxShadow: isHovered
            ? "0 20px 50px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.2)"
            : "0 8px 30px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        <img
          src={getTemplateImageUrl(card.id)}
          alt={card.name}
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      </div>
      <motion.div
        className="absolute -bottom-8 left-1/2 -translate-x-1/2 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-background/90 backdrop-blur-sm text-foreground shadow-sm border border-border/50">
          {card.name}
        </span>
      </motion.div>
    </motion.div>
  );
}

function CardStack({ templates }: { templates: CardTemplate[] }) {
  const cards = useMemo(() => {
    const withImages = templates.filter((t) => t.has_image);
    return shuffle(withImages).slice(0, CARD_COUNT);
  }, [templates]);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (cards.length === 0) return null;

  return (
    <div
      className="relative w-[300px] h-[240px] sm:w-[380px] sm:h-[280px] md:w-[440px] md:h-[300px]"
      style={{ perspective: "1000px" }}
    >
      {cards.map((card, i) => (
        <FanCard
          key={card.id}
          card={card}
          index={i}
          total={cards.length}
          isHovered={hoveredIdx === i}
          onHover={() => setHoveredIdx(i)}
          onLeave={() => setHoveredIdx(null)}
        />
      ))}
    </div>
  );
}

function FloatingStack({ templates }: { templates: CardTemplate[] }) {
  return (
    <motion.div
      animate={{ y: [0, -8, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      <CardStack templates={templates} />
    </motion.div>
  );
}

/* ---------- Login Forms ---------- */

function OpenLoginForm() {
  const login = useAppStore((s) => s.login);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleEnter = async () => {
    setSubmitting(true);
    setError("");
    try {
      await login({});
      router.push("/summary");
    } catch {
      setError("Failed to connect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        className="w-full h-11 bg-card/80 backdrop-blur-sm"
        onClick={handleEnter}
        disabled={submitting}
      >
        {submitting ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Entering...</>
        ) : (
          <><LogIn className="h-4 w-4 mr-2" />Enter</>
        )}
      </Button>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
    </div>
  );
}

function PasswordLoginForm() {
  const login = useAppStore((s) => s.login);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login({ password });
      router.push("/summary");
    } catch {
      setError("Invalid password");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-11 bg-card/80 backdrop-blur-sm"
        autoFocus
      />
      <Button type="submit" className="w-full h-11" disabled={submitting || !password}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
    </form>
  );
}

function UsernamePasswordLoginForm() {
  const { login, register: registerAction, registrationEnabled } = useAppStore();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showRegister, setShowRegister] = useState(false);

  // Register fields
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regEmail, setRegEmail] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login({ username, password });
      router.push("/summary");
    } catch {
      setError("Invalid credentials");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await registerAction({
        username: regUsername,
        password: regPassword,
        display_name: regDisplayName || undefined,
        email: regEmail || undefined,
      });
      router.push("/summary");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (showRegister) {
    return (
      <form onSubmit={handleRegister} className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Username</Label>
          <Input value={regUsername} onChange={(e) => setRegUsername(e.target.value)} className="h-10 bg-card/80 backdrop-blur-sm" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Password</Label>
          <Input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} className="h-10 bg-card/80 backdrop-blur-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Confirm Password</Label>
          <Input type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} className="h-10 bg-card/80 backdrop-blur-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Display Name <span className="text-muted-foreground/50">(optional)</span></Label>
          <Input value={regDisplayName} onChange={(e) => setRegDisplayName(e.target.value)} className="h-10 bg-card/80 backdrop-blur-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Email <span className="text-muted-foreground/50">(optional)</span></Label>
          <Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} className="h-10 bg-card/80 backdrop-blur-sm" />
        </div>
        <Button type="submit" className="w-full h-11" disabled={submitting || !regUsername || !regPassword || !regConfirm}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
        </Button>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <p className="text-sm text-center">
          <button type="button" className="text-primary hover:underline" onClick={() => { setShowRegister(false); setError(""); }}>
            Back to sign in
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleLogin} className="space-y-3">
      <Input
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="h-11 bg-card/80 backdrop-blur-sm"
        autoFocus
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-11 bg-card/80 backdrop-blur-sm"
      />
      <Button type="submit" className="w-full h-11" disabled={submitting || !username || !password}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      {registrationEnabled && (
        <p className="text-sm text-center text-muted-foreground">
          Don&apos;t have an account?{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => { setShowRegister(true); setError(""); }}>
            Create one
          </button>
        </p>
      )}
    </form>
  );
}

function OAuthLoginForm() {
  const { oauthProviders } = useAppStore();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const handleOAuth = async (providerName: string) => {
    setLoading(providerName);
    setError("");
    const redirectUri = `${window.location.origin}/auth/callback?provider=${providerName}`;
    localStorage.setItem("oauth_provider", providerName);
    try {
      const res = await fetch(
        `${API_BASE}/api/auth/oauth/${providerName}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start OAuth");
      window.location.href = data.authorization_url;
    } catch (e) {
      setLoading(null);
      setError(e instanceof Error ? e.message : "Failed to start OAuth flow");
    }
  };

  return (
    <div className="space-y-2">
      {oauthProviders.map((provider) => (
        <Button
          key={provider.name}
          variant="outline"
          className="w-full h-11 bg-card/80 backdrop-blur-sm"
          onClick={() => handleOAuth(provider.name)}
          disabled={loading !== null}
        >
          {loading === provider.name ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirecting...</>
          ) : (
            `Continue with ${provider.display_name}`
          )}
        </Button>
      ))}
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      {oauthProviders.length === 0 && (
        <p className="text-sm text-muted-foreground text-center">
          No OAuth providers configured. Contact the administrator.
        </p>
      )}
    </div>
  );
}

/* ---------- Main Landing Page ---------- */

export function LandingPage() {
  const { authMode, authed, darkMode, toggleDarkMode } = useAppStore();
  const [templates, setTemplates] = useState<CardTemplate[]>([]);

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  const hasImages = templates.some((t) => t.has_image);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20">
      {/* Dark mode toggle */}
      <div className="fixed top-4 right-4 z-50">
        <Button size="icon" variant="ghost" className="h-9 w-9 bg-card/60 backdrop-blur-sm" onClick={toggleDarkMode} title="Toggle dark mode">
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
      {/* ===== Hero ===== */}
      <section className="min-h-screen flex flex-col items-center justify-center px-4 py-16 gap-8 md:gap-12">
        {/* Card Stack */}
        {hasImages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <FloatingStack templates={templates} />
          </motion.div>
        )}

        {/* Branding + Login */}
        <motion.div
          className="text-center space-y-6 max-w-md w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: hasImages ? 0.8 : 0.1, duration: 0.5 }}
        >
          <div className="space-y-3">
            <Logo className="h-16 w-16 mx-auto" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              plan.cards
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Track your credit card lifecycle — benefits, fees, bonuses, and
              application rules — all in one place.
            </p>
          </div>

          {/* Login form or dashboard link */}
          <div className="max-w-xs mx-auto">
            {authed ? (
              <Button asChild className="w-full h-11">
                <a href="/summary">
                  Go to Dashboard <ArrowRight className="h-4 w-4 ml-2" />
                </a>
              </Button>
            ) : (
              <>
                {authMode === "open" && <OpenLoginForm />}
                {authMode === "single_password" && <PasswordLoginForm />}
                {authMode === "multi_user" && <UsernamePasswordLoginForm />}
                {authMode === "multi_user_oauth" && <OAuthLoginForm />}
                {!authMode && (
                  <div className="flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          className="absolute bottom-6 text-muted-foreground/40"
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </motion.div>
      </section>

      {/* ===== Features ===== */}
      <section className="px-4 pb-20 pt-8 max-w-4xl mx-auto">
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1 } },
          }}
        >
          {FEATURES.map((feature) => (
            <motion.div
              key={feature.title}
              className="bg-card/70 backdrop-blur-sm border rounded-xl p-5 space-y-2"
              variants={{
                hidden: { opacity: 0, y: 24 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            >
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <feature.icon className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">{feature.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          className="mt-16 text-center space-y-3 max-w-lg mx-auto"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          <h3 className="font-semibold text-sm">Community-Driven Card Templates</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Our card database is open source and community-maintained. Contribute new cards, update existing templates, add card images, or fix details — every contribution helps the community.
          </p>
          <a
            href="https://github.com/cocdeshijie/plan.cards/tree/main/card_templates"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            Contribute on GitHub
          </a>
        </motion.div>

        <div className="mt-12">
          <AppFooter />
        </div>
      </section>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabaseClient';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  Award,
  Bell,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Bot,
  Box,
  Brain,
  Check,
  CheckCheck,
  CheckCircle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Clock,
  Code,
  Compass,
  CornerDownRight,
  Copy,
  Cpu,
  CreditCard,
  Cylinder,
  Database,
  Disc,
  DollarSign,
  Download,
  DownloadCloud,
  Dumbbell,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileSearch,
  FileJson,
  FileText,
  FileSpreadsheet,
  FileCode,
  Filter,
  Flame,
  GitMerge,
  Globe,
  Hash,
  Heart,
  HelpCircle,
  Home,
  Image,
  Landmark,
  Lightbulb,
  LineChart,
  LayoutDashboard,
  Link,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  Monitor,
  Package,
  Paperclip,
  Pin,
  PlayCircle,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Settings,
  Settings2,
  Shapes,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Target,
  Terminal,
  Thermometer,
  ThumbsUp,
  Trash,
  Trash2,
  TrendingUp,
  Trophy,
  UploadCloud,
  User,
  Users,
  Video,
  Wallet,
  Waves,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './cube.css';
import NovaHelpContent from './NovaHelpContent';
import NovaCommunity from './NovaCommunity';
import NovaLandingPage from './NovaLandingPage';
import ContactPage from './ContactPage';
import NotFoundPage from './NotFoundPage';
import SiteEnhancements from './SiteEnhancements';
import { updatePageMetadata } from './siteMetadata';
import { trackConversion } from './conversionTracking';
import { clearAuthAttempts, reserveAuthAttempt } from './authRateLimit.mjs';

let razorpaySdkPromise = null;
const RAZORPAY_SDK_TIMEOUT_MS = 30000;

async function loadRazorpaySdk() {
  if (typeof window === 'undefined') throw new Error('Secure checkout is only available in a browser.');
  if (window.Razorpay) return;

  if (!razorpaySdkPromise) {
    razorpaySdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = window.setTimeout(() => {
        script.remove();
        reject(new Error('Razorpay checkout took too long to load. Check your connection and retry.'));
      }, RAZORPAY_SDK_TIMEOUT_MS);
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timeout);
        if (window.Razorpay) resolve();
        else reject(new Error('Razorpay checkout did not initialize. Please retry.'));
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        script.remove();
        reject(new Error('Could not load secure checkout. Check your connection and retry.'));
      };
      document.head.appendChild(script);
    });
  }

  try {
    await razorpaySdkPromise;
  } finally {
    razorpaySdkPromise = null;
  }
}

function friendlyAuthError(error, fallback) {
  const message = error?.message || '';
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'That email and password do not match. Check them or reset your password.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Please verify your email using the link we sent before signing in.';
  }
  if (normalized.includes('already registered') || normalized.includes('user already exists')) {
    return 'An account already uses this email. Sign in or reset its password instead.';
  }
  if (normalized.includes('provider is not enabled') || normalized.includes('unsupported provider')) {
    return 'Google sign-in is not enabled for this Supabase project yet.';
  }
  if (normalized.includes('identity') && normalized.includes('already')) {
    return 'This Google account is already linked to another NOVA account. Sign in with that account first.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Could not reach the authentication service. Check your connection and try again.';
  }
  return message || fallback;
}

function reserveAuthPageAttempt(action, identity, setErrors, field) {
  const attempt = reserveAuthAttempt(action, identity);
  if (attempt.allowed) return true;
  const minutes = Math.ceil(attempt.retryAfterSeconds / 60);
  setErrors({
    [field]: `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} before trying again.`
  });
  return false;
}

const RECOVERY_FLAG_KEY = 'nova_password_recovery';

// Detects a password-reset email link (Supabase puts type=recovery in the URL hash)
// or an expired/invalid-link error redirect, before Supabase clears the hash.
const recoveryLinkState = (() => {
  const state = { active: false, pending: false, error: '' };
  if (typeof window === 'undefined') return state;
  try {
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search || '');
    const read = (key) => hash.get(key) || query.get(key) || '';
    const fromLink = read('type') === 'recovery';
    const flagged = window.sessionStorage.getItem(RECOVERY_FLAG_KEY) === '1';
    if (fromLink) window.sessionStorage.setItem(RECOVERY_FLAG_KEY, '1');
    state.pending = fromLink || flagged;
    const errorCode = read('error_code');
    const errorName = read('error');
    if (!fromLink && (errorCode === 'otp_expired' || (errorName === 'access_denied' && /recovery|reset|expired|invalid/i.test(read('error_description'))))) {
      state.error = 'This reset link is invalid or has expired. Enter your email below to get a new one.';
    }
    state.active = state.pending || !!state.error;
  } catch (e) {}
  return state;
})();

function endRecoveryLink() {
  recoveryLinkState.active = false;
  recoveryLinkState.pending = false;
  recoveryLinkState.error = '';
  try { window.sessionStorage.removeItem(RECOVERY_FLAG_KEY); } catch (e) {}
}

const PipespecIcon = ({ className = 'w-5 h-5', variant = 'green', ...props }) => (
  <img
    src={variant === 'white' ? '/pipespec-logo-white.png' : '/pipespec-logo-green.png'}
    alt=""
    aria-hidden="true"
    draggable="false"
    className={`object-contain ${className}`}
    {...props}
  />
);

export const VIEW_ROUTES = {
  '/': 'landing',
  '/home': 'landing',
  '/landing': 'mobile_landing',
  '/login': 'login',
  '/signup': 'signup',
  '/forgot': 'forgot',
  '/contact': 'contact',
  '/community': 'nova_community',
  '/chat': 'chat',
  '/help': 'nova_help',
  '/profile': 'profile',
  '/dashboard': 'dashboard',
  '/materials': 'materials',
  '/stress_strain': 'stress_strain',
  '/wizard_demo': 'wizard_demo',
};

export const ROUTE_VIEWS = {
  'landing': '/home',
  'mobile_landing': '/landing',
  'login': '/login',
  'signup': '/signup',
  'forgot': '/forgot',
  'contact': '/contact',
  'nova_community': '/community',
  'chat': '/chat',
  'nova_help': '/help',
  'profile': '/profile',
  'dashboard': '/dashboard',
  'materials': '/materials',
  'stress_strain': '/stress_strain',
  'wizard_demo': '/wizard_demo',
};

export function parseRouteFromUrl() {
  try {
    const rawPath = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (recoveryLinkState.active) return { view: 'forgot', path: '/forgot' };
    const knownRoute = Object.hasOwn(VIEW_ROUTES, rawPath) || [
      '/dashboard/', '/jobs/', '/job/', '/wizards/', '/profile/', '/community/',
      '/help/', '/chat/', '/materials/', '/stress_strain/'
    ].some(prefix => rawPath.startsWith(prefix)) ||
      ['/dashboard', '/wizards', '/profile', '/community', '/help', '/chat', '/materials', '/stress_strain', '/invoice', '/receipt', '/ai-recommender'].includes(rawPath);
    if (!knownRoute) return { view: 'not_found', path: rawPath };

    const isPublic = ['/landing', '/login', '/signup', '/forgot', '/contact'].includes(rawPath);
    const hasAuth = !!localStorage.getItem('nova_user');

    if (hasAuth && ['/', '/home', '/landing', '/login', '/signup', '/forgot'].includes(rawPath)) {
      return { view: 'dashboard', path: '/dashboard' };
    }

    if (!hasAuth && ['/', '/home'].includes(rawPath)) {
      return { view: 'mobile_landing', path: '/landing' };
    }

    if (!hasAuth && !isPublic) {
      return { view: 'login', path: '/login' };
    }

    // 1. Dashboard Sub-routes & Detail Pages
    if (rawPath.startsWith('/dashboard/job/') && rawPath.endsWith('/insights')) {
      const jobId = rawPath.replace('/dashboard/job/', '').replace('/insights', '').split('/')[0];
      return { view: 'dashboard', subType: 'job_insights', id: jobId, path: rawPath };
    }
    if (rawPath.startsWith('/dashboard/job/')) {
      const jobId = window.location.pathname.split('/dashboard/job/')[1]?.split('/')[0];
      return { view: 'dashboard', subType: 'job', id: jobId, path: rawPath };
    }
    if (rawPath.startsWith('/jobs/') || rawPath.startsWith('/job/')) {
      const jobId = window.location.pathname.split(/\/jobs?\/+/)[1]?.split('/')[0];
      return { view: 'dashboard', subType: 'job', id: jobId, path: `/dashboard/job/${jobId}` };
    }
    if (rawPath === '/dashboard/ai-recommender' || rawPath === '/ai-recommender') {
      return { view: 'dashboard', subType: 'ai_recommender', path: rawPath };
    }
    if (rawPath === '/dashboard/submit' || rawPath.startsWith('/dashboard/submit/')) {
      const type = rawPath.replace('/dashboard/submit', '').replace(/^\//, '');
      return { view: 'dashboard', subType: 'submit', type, path: rawPath };
    }
    if (rawPath === '/wizards' || rawPath === '/dashboard/wizards') {
      return { view: 'profile', subType: 'tab', tab: 'wizard', path: rawPath };
    }
    if ((rawPath.startsWith('/wizards/') || rawPath.startsWith('/dashboard/wizards/')) && rawPath.endsWith('/demo')) {
      const parts = rawPath.split('/');
      const wizardId = parts[rawPath.startsWith('/dashboard/') ? 3 : 2];
      return { view: 'dashboard', subType: 'wizard_demo_modal', id: wizardId, path: rawPath };
    }
    if ((rawPath.startsWith('/wizards/') || rawPath.startsWith('/dashboard/wizards/')) && rawPath.endsWith('/pricing')) {
      const parts = rawPath.split('/');
      const wizardId = parts[rawPath.startsWith('/dashboard/') ? 3 : 2];
      return { view: 'dashboard', subType: 'wizard_pricing_modal', id: wizardId, path: rawPath };
    }
    if (rawPath === '/dashboard/invoice' || rawPath === '/invoice') {
      return { view: 'dashboard', subType: 'document', docType: 'invoice', path: rawPath };
    }
    if (rawPath === '/dashboard/receipt' || rawPath === '/receipt') {
      return { view: 'dashboard', subType: 'document', docType: 'receipt', path: rawPath };
    }

    // 2. Profile Sub-routes & Detail Tabs
    if (rawPath === '/profile/edit') {
      return { view: 'profile', subType: 'tab', tab: 'info', modal: 'edit', path: rawPath };
    }
    if (rawPath === '/profile/security/change-password' || rawPath === '/profile/change-password') {
      return { view: 'profile', subType: 'tab', tab: 'security', modal: 'password', path: rawPath };
    }
    if (rawPath === '/profile/security') {
      return { view: 'profile', subType: 'tab', tab: 'security', modal: null, path: rawPath };
    }
    if (rawPath.startsWith('/profile/')) {
      const tab = rawPath.replace('/profile/', '');
      return { view: 'profile', subType: 'tab', tab, path: rawPath };
    }

    // 3. Community Sub-routes & Detail Pages
    if (rawPath === '/community/ask-question' || rawPath === '/community/question') {
      return { view: 'nova_community', subType: 'question', path: rawPath };
    }
    if (rawPath === '/community/new-discussion' || rawPath === '/community/discussion') {
      return { view: 'nova_community', subType: 'discussion', path: rawPath };
    }
    if (rawPath.startsWith('/community/post/')) {
      const postId = window.location.pathname.split('/community/post/')[1]?.split('/')[0];
      return { view: 'nova_community', subType: 'post', id: postId, path: rawPath };
    }
    if (rawPath.startsWith('/community/edit/')) {
      const postId = window.location.pathname.split('/community/edit/')[1]?.split('/')[0];
      return { view: 'nova_community', subType: 'edit', id: postId, path: rawPath };
    }
    if (rawPath.startsWith('/community/user/')) {
      const userId = window.location.pathname.split('/community/user/')[1]?.split('/')[0];
      return { view: 'nova_community', subType: 'user', id: userId, path: rawPath };
    }

    // 4. Help Sub-routes & Detail Topics
    if (rawPath === '/help' || rawPath.startsWith('/help/')) {
      const topicId = rawPath.replace('/help/', '').replace(/^\//, '');
      return { view: 'nova_help', subType: 'help', topicId: topicId || null, path: rawPath };
    }

    // 5. Chat & Direct Messages
    if (rawPath.startsWith('/chat/user/')) {
      const uid = window.location.pathname.split('/chat/user/')[1]?.split('/')[0];
      return { view: 'chat', subType: 'chat_user', recipient: uid, path: rawPath };
    }
    if (rawPath === '/chat' || rawPath.startsWith('/chat/') || window.location.search.includes('user=')) {
      const urlParams = new URLSearchParams(window.location.search);
      const recipient = urlParams.get('user') || window.location.pathname.split('/chat/')[1]?.split('/')[0];
      return { view: 'chat', subType: 'chat', recipient, path: rawPath };
    }

    // 6. Materials Database & Detail View
    if (rawPath === '/materials' || rawPath.startsWith('/materials/')) {
      const mat = rawPath.replace('/materials/', '').replace(/^\//, '');
      return { view: 'materials', subType: 'materials', material: mat || null, path: rawPath };
    }

    // 7. Stress Strain Generator & Curves
    if (rawPath === '/stress_strain' || rawPath.startsWith('/stress_strain/')) {
      return { view: 'stress_strain', subType: 'stress_strain', path: rawPath };
    }

    // 8. Standard Top-level Routes
    if (VIEW_ROUTES[rawPath]) {
      return { view: VIEW_ROUTES[rawPath], path: rawPath };
    }

    return { view: 'not_found', path: rawPath };
  } catch (e) {}
  return { view: 'not_found', path: window.location.pathname };
}

export function getInitialViewFromUrl() {
  const route = parseRouteFromUrl();
  if (['mobile_landing', 'signup', 'forgot', 'contact', 'not_found'].includes(route.view)) {
    return route.view;
  }
  const saved = localStorage.getItem('nova_user');
  if (!saved) {
    return 'login';
  }
  return route.view || 'dashboard';
}
const CosmicLogo = ({ className = "w-8 h-8 sm:w-10 sm:h-10" }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="novaGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ec4899" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#3b82f6" />
      </linearGradient>
      <linearGradient id="novaGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f43f5e" />
        <stop offset="50%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <circle cx="50" cy="50" r="35" stroke="url(#novaGrad1)" strokeWidth="12" filter="url(#glow)" opacity="0.6" />
    <circle cx="50" cy="50" r="35" stroke="url(#novaGrad1)" strokeWidth="8" opacity="0.9" />
    <path d="M50 15 A35 35 0 0 1 85 50 A35 35 0 0 0 50 15 Z" fill="url(#novaGrad2)" opacity="0.8" />
    <path d="M15 50 A35 35 0 0 0 50 85 A35 35 0 0 1 15 50 Z" fill="url(#novaGrad1)" opacity="0.8" />
    <circle cx="50" cy="50" r="35" stroke="url(#novaGrad2)" strokeWidth="2" opacity="0.8" strokeDasharray="15 10 5 10" />
    <circle cx="30" cy="30" r="2.5" fill="#fff" opacity="0.9" />
    <path d="M30 30 L 40 25 L 45 35" stroke="#fff" strokeWidth="1" fill="none" opacity="0.5" />
    <circle cx="40" cy="25" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="45" cy="35" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="70" cy="65" r="2" fill="#fff" opacity="0.9" />
    <path d="M70 65 L 60 75 L 50 70" stroke="#fff" strokeWidth="1" fill="none" opacity="0.5" />
    <circle cx="60" cy="75" r="1" fill="#fff" opacity="0.7" />
    <circle cx="50" cy="70" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="75" cy="35" r="2" fill="#fff" opacity="0.8" />
    <circle cx="25" cy="65" r="1.5" fill="#fff" opacity="0.6" />
    <circle cx="50" cy="50" r="20" fill="url(#novaGrad1)" filter="url(#glow)" opacity="0.2" />
  </svg>
);
const AnimatedStatusBadge = ({ status }) => {
  const normStatus = (status || '').toLowerCase();
  const isSuccess = normStatus === 'completed' || normStatus === 'success';
  const isFailed = normStatus === 'failed';
  const isPending = normStatus === 'pending';
  if (isSuccess) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-white text-[#15803d] border-[1.5px] border-[#86efac] shadow-[0_2px_10px_rgba(22,163,74,0.06)]">
        <CheckCircle className="w-3.5 h-3.5 text-[#16a34a]" />
        <span className="tracking-wide uppercase">{status}</span>
      </span>
    );
  }
  if (isFailed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-white text-[#b91c1c] border-[1.5px] border-[#fca5a5] shadow-[0_2px_10px_rgba(220,38,38,0.06)]">
        <AlertTriangle className="w-3.5 h-3.5 text-[#dc2626]" />
        <span className="tracking-wide uppercase">{status}</span>
      </span>
    );
  }
  if (isPending) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-[#fffbeb] text-[#92400e] border border-[#fde68a]">
        <Clock className="w-4 h-4 text-[#d97706] animate-pulse" />
        <span className="tracking-wide uppercase">{status}</span>
      </span>
    );
  }

  const displayStatus = (status || '').replace(/^Processing\s*-\s*/i, '');
  return (
    <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-[11px] font-black bg-white border-[1.5px] border-indigo-200 shadow-[0_2px_12px_rgba(99,102,241,0.10)]">
      <div className="orbit-spinner" />
      <span className="processing-text tracking-wide uppercase">{displayStatus}</span>
    </span>
  );
};

const DEFAULT_NOVA_COMMUNITY_POSTS = [];
const DEFAULT_NOVA_COMMUNITY_COMMENTS = {};

export const ANSYS_WIZARDS = [
  {
    id: 'full',
    name: 'Full Nozzle Ansys Act Wizard (.WBEX)',
    shortName: 'Full Nozzle ACT Wizard',
    filename: 'Full_Nozzle.wbex',
    desc: 'Complete parametric modeling, meshing, and analysis for full nozzle configurations.',
    curveTypes: null,
    features: [
      'Complete Shell & Head Nozzle Integration',
      'Automated Hex-Dominant Meshing',
      'ASME VIII-2 Part 5 Linearization',
      'Multi-Load Combinations (P + V + M + T)',
      'Instant Word (.docx) FEA Report'
    ],
    pricing: [
      { term: '1 Month', price: '₹9,999', numericPrice: 9999, desc: 'Short-term access for single projects', workstations: 1, recommend: false },
      { term: '3 Months', price: '₹24,999', numericPrice: 24999, desc: 'Ideal for extended engineering phases', workstations: 1, recommend: false },
      { term: '6 Months', price: '₹39,999', numericPrice: 39999, desc: 'Best value for continuous usage', workstations: 2, recommend: true }
    ]
  },
  {
    id: 'shell',
    name: 'Shell Nozzle Ansys Act Wizard (.WBEX)',
    shortName: 'Shell Nozzle ACT Wizard',
    filename: 'Shell_Nozzle.wbex',
    desc: 'Specialized workflow for shell nozzle FEA with automatic report generation.',
    curveTypes: null,
    features: [
      'Cylindrical & Conical Shell Nozzles',
      'Automated Hex-Dominant Meshing',
      'ASME VIII-2 Part 5 Linearization (Pm, Pl, Pb, Q)',
      'Plastic Limit Load & Collapse Checks',
      'Instant Word (.docx) FEA Report'
    ],
    pricing: [
      { term: '1 Month', price: '₹4,999', numericPrice: 4999, desc: 'Short-term access for single projects', workstations: 1, recommend: false },
      { term: '3 Months', price: '₹12,499', numericPrice: 12499, desc: 'Ideal for extended engineering phases', workstations: 1, recommend: false },
      { term: '6 Months', price: '₹19,999', numericPrice: 19999, desc: 'Best value for continuous usage', workstations: 2, recommend: true }
    ]
  },
  {
    id: 'head',
    name: 'Head Nozzle Ansys Act Wizard (.WBEX)',
    shortName: 'Head Nozzle ACT Wizard',
    filename: 'Head_Nozzle.wbex',
    desc: 'Advanced parametric analysis for head nozzle connections.',
    curveTypes: null,
    features: [
      'Hemispherical, Ellipsoidal & Torispherical Heads',
      'Radial & Hillside (Off-Center) Connections',
      'Automated Solid Modeling & Contact Pairing',
      'ASME Section VIII Div 2 Stress Linearization',
      'Audit-Ready Mechanical Documentation'
    ],
    pricing: [
      { term: '1 Month', price: '₹7,499', numericPrice: 7499, desc: 'Short-term access for single projects', workstations: 1, recommend: false },
      { term: '3 Months', price: '₹18,749', numericPrice: 18749, desc: 'Ideal for extended engineering phases', workstations: 1, recommend: false },
      { term: '6 Months', price: '₹29,999', numericPrice: 29999, desc: 'Best value for continuous usage', workstations: 2, recommend: true }
    ]
  },
  {
    id: 'stress_strain',
    name: 'Stress-Strain Curve Ansys Act Wizard (.WBEX)',
    shortName: 'Stress-Strain Curve ACT Wizard',
    filename: 'Stress-Strain_Curve.wbex',
    desc: 'Automated generation of non-linear stress-strain curves for Ansys Engineering Data.',
    curveTypes: [
      'True Stress-Strain',
      'Cyclic Stress-Strain',
      'Isochronous Stress-Strain',
      'Tangent Modulus Stress-Strain'
    ],
    features: [
      'True Stress-Strain Curves',
      'Cyclic Stress-Strain Curves',
      'Isochronous Stress-Strain Curves',
      'Tangent Modulus Stress-Strain Curves',
      'Direct 1-Click Injection into Ansys Engineering Data'
    ],
    pricing: [
      { term: '1 Month', price: '₹1,499', numericPrice: 1499, desc: 'Short-term access for single projects', workstations: 1, recommend: false },
      { term: '3 Months', price: '₹3,749', numericPrice: 3749, desc: 'Ideal for extended engineering phases', workstations: 1, recommend: false },
      { term: '6 Months', price: '₹5,999', numericPrice: 5999, desc: 'Best value for continuous usage', workstations: 2, recommend: true }
    ]
  }
];

export default function App() {
  const initialViewResolved = getInitialViewFromUrl();
  const [currentView, setCurrentView] = useState(initialViewResolved);
  useEffect(() => {
    const route = parseRouteFromUrl();
    updatePageMetadata(currentView, route.view === currentView ? route.path : (ROUTE_VIEWS[currentView] || '/'));
  }, [currentView]);
  const [isMobileLandingViewport, setIsMobileLandingViewport] = useState(() =>
    window.matchMedia('(max-width: 767px)').matches
  );
  const [showSplash, setShowSplash] = useState(() => {
    return initialViewResolved === 'landing' && !localStorage.getItem('nova_splash_seen');
  });
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const updateViewport = (event) => setIsMobileLandingViewport(event.matches);
    setIsMobileLandingViewport(mobileQuery.matches);
    mobileQuery.addEventListener('change', updateViewport);
    return () => mobileQuery.removeEventListener('change', updateViewport);
  }, []);
  const [isSplashExiting, setIsSplashExiting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileTab, setProfileTab] = useState('info');
  const [profileNotifPrefs, setProfileNotifPrefs] = useState({
    job_complete: true, job_failed: true, credit_low: true, sub_renew: true,
    community: false, product_updates: true, promos: false
  });
  const [selectedWizardForDemo, setSelectedWizardForDemo] = useState(null);
  const [isWizardDemoOpen, setIsWizardDemoOpen] = useState(false);
  const [selectedWizardForPricing, setSelectedWizardForPricing] = useState(null);
  const [isWizardPricingOpen, setIsWizardPricingOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobilePopup, setMobilePopup] = useState(null);
  const [isMobileAiRecommender, setIsMobileAiRecommender] = useState(false);
  const [mobileProfileSection, setMobileProfileSection] = useState(null);
  const mobileSwipeStartRef = useRef(null);
  const [isMobileAppBarHidden, setIsMobileAppBarHidden] = useState(false);
  const profilePressTimerRef = useRef(null);
  const suppressProfileClickRef = useRef(false);
  const lastMobileScrollYRef = useRef(0);

  const [currentUser, setCurrentUser] = useState({
    id: null, name: "", email: "", initial: "", avatar: null, company: "", phone: "", joined: "", isApproved: false, plan: "Free", dailyCreditsTotal: 100, dailyCreditsRemaining: 100, isLifetimeMax: false
  });
  const authIdentityRef = useRef({ id: '', email: '' });
  const [completedInvoice, setCompletedInvoice] = useState(null);
  const [invoiceCopiedKey, setInvoiceCopiedKey] = useState(false);
  const [activeDocumentViewer, setActiveDocumentViewer] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState(() => {
    try {
      const savedUserStr = localStorage.getItem('nova_user');
      const savedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
      if (savedUser && savedUser.email) {
        const saved = localStorage.getItem(`nova_payment_history_${savedUser.email.toLowerCase()}`);
        return saved ? JSON.parse(saved) : [];
      }
    } catch (e) { }
    return [];
  });

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showSignupPwd, setShowSignupPwd] = useState(false);
  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });
  const [isPwdSuccess, setIsPwdSuccess] = useState(false);
  const [authErrors, setAuthErrors] = useState({});
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });
  const [pwdErrors, setPwdErrors] = useState({});
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState(recoveryLinkState.pending ? 3 : 1);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const passwordRecoveryRef = useRef(recoveryLinkState.pending);
  const [forgotNewPwd, setForgotNewPwd] = useState("");
  const [forgotConfirmPwd, setForgotConfirmPwd] = useState("");
  const [forgotErrors, setForgotErrors] = useState(recoveryLinkState.error ? { email: recoveryLinkState.error } : {});
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [showForgotPwd, setShowForgotPwd] = useState({ new: false, confirm: false });
  useEffect(() => {
    if (forgotCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setForgotCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [forgotCooldown]);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
  const [jobs, setJobs] = useState([]);
  const [communityPosts, setCommunityPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_community_posts_permanent');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          return parsed
            .filter(p => p && !mockIds.includes(p.id))
            .map(({ user_email, ...post }) => post);
        }
      }
    } catch (e) { }
    return [];
  });
  const [newPostText, setNewPostText] = useState('');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerCategory, setComposerCategory] = useState('ASME Codes');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeModalLang, setCodeModalLang] = useState('python');
  const [codeModalFilename, setCodeModalFilename] = useState('ansys_script.py');
  const [codeModalContent, setCodeModalContent] = useState('');
  const [showAiDraftModal, setShowAiDraftModal] = useState(false);
  const [aiDraftPrompt, setAiDraftPrompt] = useState('');
  const [isAiDraftLoading, setIsAiDraftLoading] = useState(false);
  const [composerCodeLang, setComposerCodeLang] = useState('python');
  const [composerCodeFilename, setComposerCodeFilename] = useState('asme_ansys_script.py');
  const [composerCodeContent, setComposerCodeContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [newPostMedia, setNewPostMedia] = useState(null); // { data, type: 'image'|'video', name, size }
  const [newPostCode, setNewPostCode] = useState(null); // { content, filename, lines, size, lang }
  const [copiedCodeId, setCopiedCodeId] = useState(null);
  const [selectedMediaModal, setSelectedMediaModal] = useState(null);
  const [editingPostId, setEditingPostId] = useState(null);
  const [editPostTitle, setEditPostTitle] = useState('');
  const [editPostContent, setEditPostContent] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [communityActiveTab, setCommunityActiveTab] = useState('all'); // 'all' | 'hot' | 'latest' | 'solved' | 'bookmarked' | 'my_posts'
  const [communitySort, setCommunitySort] = useState('latest'); // 'latest' | 'upvotes' | 'comments'
  const [showAskAiCommunityModal, setShowAskAiCommunityModal] = useState(false);
  const [aiCommunityQuery, setAiCommunityQuery] = useState('');
  const [aiCommunityResponse, setAiCommunityResponse] = useState('');
  const [isAiCommunityLoading, setIsAiCommunityLoading] = useState(false);
  const [selectedPostForAi, setSelectedPostForAi] = useState(null);
  const mediaFileInputRef = useRef(null);
  const codeFileInputRef = useRef(null);

  const [persistentNotifications, setPersistentNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_persistent_notifications');
      return saved ? JSON.parse(saved) : [
        { id: 'notif_welcome', title: 'Workstation Online', message: 'Nova Autonomous FEA Platform initialized and permanently synchronized.', type: 'info', time: 'Just now', date: 'Today', read: false }
      ];
    } catch (e) {
      return [];
    }
  });
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const checkoutStartInProgressRef = useRef(false);
  const [paymentMethod, setPaymentMethod] = useState('upi'); // 'upi', 'card', 'netbanking', 'paypal'
  const [cardForm, setCardForm] = useState({ number: '', name: '', expiry: '', cvv: '', zip: '', saveCard: true });
  const [cardErrors, setCardErrors] = useState({});
  const [cardFlipped, setCardFlipped] = useState(false);
  const [savedCards, setSavedCards] = useState(() => {
    try {
      const stored = localStorage.getItem('nova_saved_cards');
      if (stored) return JSON.parse(stored);
    } catch (e) { }
    return [
      { id: 'card_1', name: 'Dinesh Kumar Yadav', number: '4532 •••• •••• 8920', last4: '8920', brand: 'Visa', expiry: '09/28' },
      { id: 'card_2', name: 'Dinesh Kumar Yadav', number: '5424 •••• •••• 1042', last4: '1042', brand: 'Mastercard', expiry: '11/27' }
    ];
  });
  const [selectedSavedCardId, setSelectedSavedCardId] = useState('new');
  const [savedCardCvv, setSavedCardCvv] = useState('');
  const [savedCardCvvError, setSavedCardCvvError] = useState('');
  const [paypalTxnId, setPaypalTxnId] = useState('');
  const [paypalOpened, setPaypalOpened] = useState(false);
  const [paypalError, setPaypalError] = useState('');
  const [upiId, setUpiId] = useState('dineshkumar2729304@okaxis');
  const [upiStatus, setUpiStatus] = useState('idle');
  const [upiTimer, setUpiTimer] = useState(300);
  const [upiDirectUtr, setUpiDirectUtr] = useState('');
  const [upiDirectError, setUpiDirectError] = useState('');
  const [activeUpiApp, setActiveUpiApp] = useState(null);
  const [selectedNetBank, setSelectedNetBank] = useState('HDFC');
  const [netBankingSearch, setNetBankingSearch] = useState('');
  const [customerPhone, setCustomerPhone] = useState('+919876543210');
  const [orderReceipt, setOrderReceipt] = useState(null);
  const [creditSimModule, setCreditSimModule] = useState('nozzle');
  const [docsSearchQuery, setDocsSearchQuery] = useState('');
  const [activeDocsTab, setActiveDocsTab] = useState('asme');
  const [communityCategory, setCommunityCategory] = useState('All');
  const [communitySearch, setCommunitySearch] = useState('');
  const [postComments, setPostComments] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_community_comments_permanent');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          const clean = {};
          Object.keys(parsed).forEach(k => {
            if (!mockIds.includes(k)) {
              clean[k] = Array.isArray(parsed[k])
                ? parsed[k].map(({ email, ...comment }) => comment)
                : parsed[k];
            }
          });
          return clean;
        }
      }
    } catch (e) { }
    return {};
  });
  const [expandedComments, setExpandedComments] = useState({});
  const [replyText, setReplyText] = useState({});
  const [replyMention, setReplyMention] = useState({});
  const [likedPosts, setLikedPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_community_likes_permanent');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [bookmarkedPosts, setBookmarkedPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_community_bookmarks');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          const clean = {};
          Object.keys(parsed).forEach(k => {
            if (!mockIds.includes(k)) clean[k] = parsed[k];
          });
          return clean;
        }
      }
    } catch (e) { }
    return {};
  });
  const [solvedPosts, setSolvedPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_community_solved');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          const clean = {};
          Object.keys(parsed).forEach(k => {
            if (!mockIds.includes(k)) clean[k] = parsed[k];
          });
          return clean;
        }
      }
    } catch (e) { }
    return {};
  });

  const [activeProductFilter, setActiveProductFilter] = useState('All');
  const [demoActiveTab, setDemoActiveTab] = useState('overview');
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [isJobSelectionMode, setIsJobSelectionMode] = useState(false);
  const jobSelectionPressTimer = useRef(null);
  const detailSwipeStart = useRef(null);
  const [isDeletingJobs, setIsDeletingJobs] = useState(false);
  const [jobFilter, setJobFilter] = useState('All Analysis');
  const [notification, setNotification] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSubmitJobOpen, setIsSubmitJobOpen] = useState(false);
  const [selectedJobType, setSelectedJobType] = useState('Nozzle Analysis');
  const [editForm, setEditForm] = useState({ name: '', company: '', phone: '' });
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [hasRequestedAccess, setHasRequestedAccess] = useState(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiSetupPrompt, setAiSetupPrompt] = useState("");
  const [aiSetupResponse, setAiSetupResponse] = useState("");
  const [isAiSetupLoading, setIsAiSetupLoading] = useState(false);
  const [supportChat, setSupportChat] = useState([
    { role: 'model', text: "Hello! I am the NOVA ✨ AI Support agent. I can help you understand our analysis types or check our pricing. How can I assist you today?" }
  ]);
  const [supportInput, setSupportInput] = useState("");
  const [isSupportLoading, setIsSupportLoading] = useState(false);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [selectedInsightJob, setSelectedInsightJob] = useState(null);
  const [insightResponse, setInsightResponse] = useState("");
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [isJobDetailsOpen, setIsJobDetailsOpen] = useState(false);
  const [selectedJobDetails, setSelectedJobDetails] = useState(null);
  const [activeDetailRun, setActiveDetailRun] = useState(0);
  const [copiedError, setCopiedError] = useState(false);
  const [showMaterialConsultant, setShowMaterialConsultant] = useState(false);
  const [materialPrompt, setMaterialPrompt] = useState("");
  const [materialResponse, setMaterialResponse] = useState("");
  const [isMaterialLoading, setIsMaterialLoading] = useState(false);
  const [materialSearchQuery, setMaterialSearchQuery] = useState("");
  const [materialCategoryFilter, setMaterialCategoryFilter] = useState("All");
  const [selectedMaterialId, setSelectedMaterialId] = useState("sa-516-gr-70");
  const [stressMaterialId, setStressMaterialId] = useState("sa-516-gr-70");
  const [stressTempC, setStressTempC] = useState(20);
  const [stressCurveMode, setStressCurveMode] = useState("true_stress_strain");

  useEffect(() => {
    if (isJobDetailsOpen && window.innerWidth < 768) {
      document.querySelector('.job-details-run-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeDetailRun, isJobDetailsOpen]);

  useEffect(() => () => window.clearTimeout(jobSelectionPressTimer.current), []);

  const openJobDetails = (job) => {
    setSelectedJobDetails(job);
    setActiveDetailRun(0);
    setCopiedError(false);
    setIsJobDetailsOpen(true);
    try {
      window.history.pushState({ view: 'dashboard', jobId: job.id }, '', `/dashboard/job/${job.id}`);
    } catch (e) {}
  };

  const closeJobDetails = () => {
    setIsJobDetailsOpen(false);
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const openSubmitJob = (type = 'Nozzle Analysis') => {
    setSelectedJobType(type);
    setShowMaterialConsultant(false);
    setMaterialPrompt("");
    setMaterialResponse("");
    setIsSubmitJobOpen(true);
    try {
      const slug = (type || 'nozzle').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      window.history.pushState({ view: 'dashboard', submitType: slug }, '', `/dashboard/submit/${slug}`);
    } catch (e) {}
  };

  const closeSubmitJob = () => {
    setIsSubmitJobOpen(false);
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const openWizardDemo = (item) => {
    setSelectedWizardForDemo(item);
    setIsWizardDemoOpen(true);
    try {
      window.history.pushState({ view: 'dashboard', wizardId: item.id }, '', `/wizards/${item.id}/demo`);
    } catch (e) {}
  };

  const closeWizardDemo = () => {
    setIsWizardDemoOpen(false);
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const openWizardPricing = (item) => {
    setSelectedWizardForPricing(item);
    setIsWizardPricingOpen(true);
    try {
      window.history.pushState({ view: 'dashboard', wizardId: item.id }, '', `/wizards/${item.id}/pricing`);
    } catch (e) {}
  };

  const closeWizardPricing = () => {
    setIsWizardPricingOpen(false);
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const openDocumentViewer = (docData, docType = 'invoice') => {
    setActiveDocumentViewer({ data: docData, type: docType });
    try {
      window.history.pushState({ view: 'dashboard', docType }, '', `/dashboard/${docType}`);
    } catch (e) {}
  };

  const closeDocumentViewer = () => {
    setActiveDocumentViewer(null);
    setCompletedInvoice(null);
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const handleProfileTabChange = (tab) => {
    setProfileTab(tab);
    try {
      window.history.pushState({ view: 'profile', tab }, '', `/profile/${tab}`);
    } catch (e) {}
  };

  const navigateToDashboard = () => {
    setCurrentView('dashboard');
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const navigateToHelp = () => {
    setCurrentView('nova_help');
    try {
      window.history.pushState({ view: 'nova_help' }, '', '/help');
    } catch (e) {}
  };

  const navigateMobileApp = (view, path, tab) => {
    setCurrentView(view);
    if (view !== 'profile') setMobileProfileSection(null);
    if (view === 'profile') {
      setProfileTab(tab || 'info');
      setMobileProfileSection(null);
    } else if (tab) setProfileTab(tab);
    try {
      window.history.pushState({ view, tab }, '', path);
    } catch (e) {}
  };

  const hasMobileModalOpen = Boolean(
    mobilePopup || isMobileMenuOpen || isWizardDemoOpen || isWizardPricingOpen ||
    isEditProfileOpen || isChangePasswordOpen || isSubmitJobOpen || isAiModalOpen ||
    isInsightsOpen || isJobDetailsOpen || activeDocumentViewer || completedInvoice
  );

  const handleMobileSwipeStart = (event) => {
    if (window.innerWidth < 768 && hasMobileModalOpen) {
      mobileSwipeStartRef.current = null;
      return;
    }
    if (event.touches.length !== 1) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable="true"], .overflow-x-auto, .overflow-y-auto, .nova-article-enter')) return;
    mobileSwipeStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const handleMobileSwipeEnd = (event) => {
    const start = mobileSwipeStartRef.current;
    mobileSwipeStartRef.current = null;
    if (!start || event.changedTouches.length !== 1 || window.innerWidth >= 768) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 85 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    if (['profile', 'nova_community', 'nova_help'].includes(currentView)) {
      const swipeSequence = [
        { view: 'profile', path: '/profile' },
        { view: 'nova_community', path: '/community' },
        { view: 'nova_help', path: '/help' }
      ];
      const currentIndex = swipeSequence.findIndex(({ view }) => view === currentView);
      const nextIndex = (currentIndex + (dx < 0 ? 1 : -1) + swipeSequence.length) % swipeSequence.length;
      const destination = swipeSequence[nextIndex];
      navigateMobileApp(destination.view, destination.path);
    }
  };

  const openAiModal = () => {
    setIsMobileAiRecommender(false);
    setIsAiModalOpen(true);
    try {
      window.history.pushState({ view: 'dashboard', modal: 'ai' }, '', '/dashboard/ai-recommender');
    } catch (e) {}
  };

  const closeAiModal = () => {
    setIsAiModalOpen(false);
    if (isMobileAiRecommender) {
      setIsMobileAiRecommender(false);
      return;
    }
    try {
      window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
    } catch (e) {}
  };

  const openJobInsights = (job) => {
    setSelectedInsightJob(job);
    setIsInsightsOpen(true);
    handleGenerateInsights(job);
    try {
      window.history.pushState({ view: 'dashboard', jobId: job.id, modal: 'insights' }, '', `/dashboard/job/${job.id}/insights`);
    } catch (e) {}
  };

  const closeJobInsights = () => {
    setIsInsightsOpen(false);
    try {
      if (selectedJobDetails?.id) {
        window.history.pushState({ view: 'dashboard', jobId: selectedJobDetails.id }, '', `/dashboard/job/${selectedJobDetails.id}`);
      } else {
        window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
      }
    } catch (e) {}
  };

  // Synchronize browser URL bar with current active view if not already on a sub-route
  useEffect(() => {
    if (currentView === 'not_found') return;
    try {
      localStorage.setItem('nova_last_view', currentView);
      const curPath = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
      const isSubRoute = curPath.includes('/job/') ||
        curPath.includes('/submit') ||
        curPath.includes('/wizards') ||
        curPath.includes('/profile/') ||
        curPath.includes('/community/') ||
        curPath.includes('/invoice') ||
        curPath.includes('/receipt') ||
        curPath.includes('/materials/') ||
        curPath.includes('/help/') ||
        curPath.includes('/ai-recommender') ||
        curPath.includes('/chat/') ||
        window.location.search.includes('user=');
      if (!isSubRoute) {
        const targetPath = ROUTE_VIEWS[currentView] || '/home';
        if (curPath !== targetPath && !(curPath === '/' && targetPath === '/home')) {
          window.history.pushState({ view: currentView }, '', targetPath);
        }
      }
    } catch (e) {}
  }, [currentView]);

  useEffect(() => {
    const handleMobileScroll = () => {
      const currentY = window.scrollY;
      const scrollingDown = currentY > lastMobileScrollYRef.current;
      const isMobile = window.matchMedia('(max-width: 767px)').matches;
      setIsMobileAppBarHidden(currentView === 'dashboard' && isMobile && currentY > 70 && scrollingDown);
      lastMobileScrollYRef.current = currentY;
    };

    window.addEventListener('scroll', handleMobileScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleMobileScroll);
  }, [currentView]);

  useEffect(() => {
    const hasMobilePopup = mobilePopup !== null || (isAiModalOpen && isMobileAiRecommender);
    if (!hasMobilePopup) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMobilePopup(null);
      if (isMobileAiRecommender) {
        setIsAiModalOpen(false);
        setIsMobileAiRecommender(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobilePopup, isAiModalOpen, isMobileAiRecommender]);

  // Support Browser Back and Forward buttons seamlessly with detail pages
  useEffect(() => {
    const handlePopState = () => {
      const route = parseRouteFromUrl();
      setCurrentView(route.view || 'landing');

      if (route.subType === 'job') {
        const matched = jobs.find(j => j.id === route.id || j.job_id_display === route.id || j.id?.startsWith(route.id));
        if (matched) {
          setSelectedJobDetails(matched);
          setIsJobDetailsOpen(true);
        }
      } else if (route.subType === 'job_insights') {
        const matched = jobs.find(j => j.id === route.id || j.job_id_display === route.id || j.id?.startsWith(route.id));
        if (matched) {
          setSelectedJobDetails(matched);
          setIsJobDetailsOpen(true);
          handleGenerateInsights(matched);
        }
      } else {
        setIsJobDetailsOpen(false);
      }

      if (route.subType === 'ai_recommender') {
        setIsAiModalOpen(true);
      } else {
        setIsAiModalOpen(false);
      }

      if (route.subType === 'materials' && route.material) {
        setSelectedMaterialId(route.material);
      }

      if (route.subType === 'submit') {
        setIsSubmitJobOpen(true);
      } else {
        setIsSubmitJobOpen(false);
      }

      if (route.subType === 'wizard_demo_modal' && route.id) {
        const w = ANSYS_WIZARDS.find(item => item.id === route.id);
        if (w) {
          setSelectedWizardForDemo(w);
          setIsWizardDemoOpen(true);
        }
      } else {
        setIsWizardDemoOpen(false);
      }

      if (route.subType === 'wizard_pricing_modal' && route.id) {
        const w = ANSYS_WIZARDS.find(item => item.id === route.id);
        if (w) {
          setSelectedWizardForPricing(w);
          setIsWizardPricingOpen(true);
        }
      } else {
        setIsWizardPricingOpen(false);
      }

      if (route.subType === 'document') {
        setActiveDocumentViewer(prev => ({ ...(prev || {}), type: route.docType || 'invoice' }));
      } else {
        setActiveDocumentViewer(null);
      }

      if (route.subType === 'tab' && route.tab) {
        setProfileTab(route.tab);
        if (route.modal === 'edit') setIsEditProfileOpen(true);
        else setIsEditProfileOpen(false);
        if (route.modal === 'password') setIsChangePasswordOpen(true);
        else setIsChangePasswordOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [jobs]);

  // Auto-restore detail view or modal on page load or refresh
  useEffect(() => {
    const route = parseRouteFromUrl();
    if (route.subType === 'job' && route.id && jobs.length > 0) {
      const matched = jobs.find(j => j.id === route.id || j.job_id_display === route.id || j.id?.startsWith(route.id));
      if (matched) {
        setSelectedJobDetails(matched);
        setIsJobDetailsOpen(true);
      }
    } else if (route.subType === 'job_insights' && route.id && jobs.length > 0) {
      const matched = jobs.find(j => j.id === route.id || j.job_id_display === route.id || j.id?.startsWith(route.id));
      if (matched) {
        setSelectedJobDetails(matched);
        setIsJobDetailsOpen(true);
        handleGenerateInsights(matched);
      }
    } else if (route.subType === 'ai_recommender') {
      setIsAiModalOpen(true);
    } else if (route.subType === 'materials' && route.material) {
      setSelectedMaterialId(route.material);
    } else if (route.subType === 'submit') {
      setIsSubmitJobOpen(true);
      if (route.type) {
        const typeMap = {
          'nozzle': 'Nozzle Analysis',
          'bellow': 'Bellow Analysis',
          'flange': 'Flange Analysis',
          'saddle': 'Saddle Analysis',
          'pwht': 'Local PWHT',
          'hot-box': 'Hot Box Analysis',
          'stiffener': 'Vessel Stiffener Ring Analysis',
          'lug': 'Lifting Lug WRC Analysis',
          'trunnion': 'Trunnion WRC Analysis',
          'tubesheet': '2D Axisymetric Tubesheet Analysis'
        };
        if (typeMap[route.type]) setSelectedJobType(typeMap[route.type]);
      }
    } else if (route.subType === 'wizard_demo_modal' && route.id) {
      const w = ANSYS_WIZARDS.find(item => item.id === route.id);
      if (w) {
        setSelectedWizardForDemo(w);
        setIsWizardDemoOpen(true);
      }
    } else if (route.subType === 'wizard_pricing_modal' && route.id) {
      const w = ANSYS_WIZARDS.find(item => item.id === route.id);
      if (w) {
        setSelectedWizardForPricing(w);
        setIsWizardPricingOpen(true);
      }
    } else if (route.subType === 'document' && route.docType) {
      setActiveDocumentViewer({ type: route.docType, data: completedInvoice || {} });
    } else if (route.subType === 'tab' && route.tab) {
      setProfileTab(route.tab);
      if (route.modal === 'edit') setIsEditProfileOpen(true);
      if (route.modal === 'password') setIsChangePasswordOpen(true);
    }
  }, [jobs]);
  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (recoveryLinkState.pending) {
          // Arrived from a password-reset email: show the new-password form instead of signing in.
          if (session) {
            passwordRecoveryRef.current = true;
            setIsLoggedIn(false);
            setForgotStep(3);
            setCurrentView('forgot');
          } else {
            endRecoveryLink();
            passwordRecoveryRef.current = false;
            setForgotStep(1);
            setForgotErrors({ email: 'This reset link is invalid or has expired. Enter your email below to get a new one.' });
            setCurrentView('forgot');
          }
          setIsInitializing(false);
          return;
        }
        if (session) {
          setupUser(session.user);
          fetchJobs();
          setCurrentView((prev) => {
            const route = parseRouteFromUrl();
            if (['login', 'signup', 'forgot', 'contact', 'not_found'].includes(route.view)) {
              return 'dashboard';
            }
            if (route.view) {
              return route.view;
            }
            return 'dashboard';
          });
        } else {
          localStorage.removeItem('nova_user');
          setIsLoggedIn(false);
          setCurrentUser({ id: null, name: "", email: "", initial: "", avatar: null, company: "", phone: "", joined: "" });
          setCurrentView((prev) => (['mobile_landing', 'signup', 'forgot', 'contact', 'not_found'].includes(prev) ? prev : 'login'));
        }
        setIsInitializing(false);
      }).catch((error) => {
        console.error('Could not restore the Supabase session:', error);
        localStorage.removeItem('nova_user');
        setIsLoggedIn(false);
        setCurrentUser({ id: null, name: "", email: "", initial: "", avatar: null, company: "", phone: "", joined: "" });
        setCurrentView((prev) => (prev === 'mobile_landing' ? prev : 'login'));
        setIsInitializing(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (_event === 'PASSWORD_RECOVERY') {
          passwordRecoveryRef.current = true;
          setIsLoggedIn(false);
          setForgotStep(3);
          setCurrentView('forgot');
          return;
        }
        if (session && passwordRecoveryRef.current) {
          // Recovery session: stay on the reset form until the password is changed.
          return;
        }
        if (session) {
          if (_event === 'SIGNED_IN') {
            clearAuthAttempts('login');
            clearAuthAttempts('signup');
          }
          const nextIdentity = {
            id: session.user.id,
            email: (session.user.email || '').trim().toLowerCase()
          };
          const previousIdentity = authIdentityRef.current;
          const confirmedEmailChange = _event !== 'INITIAL_SESSION'
            && previousIdentity.id === nextIdentity.id
            && previousIdentity.email
            && nextIdentity.email
            && previousIdentity.email !== nextIdentity.email;
          authIdentityRef.current = nextIdentity;
          setupUser(session.user);
          if (confirmedEmailChange) {
            void sendProfileChangeNotice(['email']).then(() => {
              showNotification('Your sign-in email has been updated and a confirmation notice was sent.', 'success');
            }).catch(error => {
              console.error('Confirmed email change notice failed:', error);
              showNotification('Your sign-in email changed, but its notification email could not be delivered.', 'error');
            });
          }
          fetchJobs();
          setCurrentView((prev) => {
            const route = parseRouteFromUrl();
            if (route.view && !['landing', 'login', 'signup', 'forgot', 'contact', 'not_found'].includes(route.view)) {
              return route.view;
            }
            return ['landing', 'mobile_landing', 'login', 'signup', 'forgot', 'contact', 'not_found'].includes(prev) ? 'dashboard' : prev;
          });
        } else {
          authIdentityRef.current = { id: '', email: '' };
          localStorage.removeItem('nova_user');
          setIsLoggedIn(false);
          setCurrentUser({ id: null, name: "", email: "", initial: "", avatar: null, company: "", phone: "", joined: "" });
          setJobs([]);
          setCurrentView(prev => (['mobile_landing', 'login', 'signup', 'forgot', 'contact', 'not_found'].includes(prev) ? prev : 'login'));
        }
      });
      return () => subscription.unsubscribe();
    } else {
      localStorage.removeItem('nova_user');
      setIsLoggedIn(false);
      setCurrentView(prev => (['mobile_landing', 'signup', 'forgot', 'contact', 'not_found'].includes(prev) ? prev : 'login'));
      setIsInitializing(false);
    }
  }, []);
  useEffect(() => {
    if (!isInitializing && !isLoggedIn) {
      if (!['mobile_landing', 'login', 'signup', 'forgot', 'contact', 'not_found'].includes(currentView)) {
        setCurrentView('login');
        try {
          const targetPath = ROUTE_VIEWS[currentView] || window.location.pathname;
          if (targetPath && targetPath !== '/' && targetPath !== '/login') {
            window.history.replaceState({ view: 'login' }, '', `/login?redirect=${encodeURIComponent(targetPath)}`);
          } else {
            window.history.replaceState({ view: 'login' }, '', '/login');
          }
        } catch (e) {}
      }
    }
  }, [currentView, isLoggedIn, isInitializing]);
  useEffect(() => {
    if (!isLoggedIn || !currentUser.id || currentUser.isApproved) {
      setHasRequestedAccess(false);
      return undefined;
    }

    let cancelled = false;
    setHasRequestedAccess(null);
    const loadAccessRequestStatus = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session?.access_token) throw new Error('Sign in again to check your access request status.');
        const response = await fetch('/api/access-request', {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Access request status could not be loaded.');
        if (!cancelled) setHasRequestedAccess(result.requested === true);
      } catch (error) {
        console.error('Access request status lookup failed:', error);
        if (!cancelled) setHasRequestedAccess(false);
      }
    };
    loadAccessRequestStatus();
    return () => { cancelled = true; };
  }, [isLoggedIn, currentUser.id, currentUser.isApproved]);
  const checkApprovalStatus = async () => {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('is_approved')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (error) {
      console.warn('Approval status check failed:', error);
      return;
    }
    if (profile?.is_approved === true && !currentUser.isApproved) {
      setCurrentUser(prev => ({ ...prev, isApproved: true }));
      showNotification("Account Approved! You can now submit analysis jobs.", "success");
    }
  };

  const downloadSecureWbexFile = async (wizardOrFilename, licenseKey, productName) => {
    let targetFilename = 'Full_Nozzle.wbex';
    const nameLower = (
      typeof wizardOrFilename === 'string'
        ? wizardOrFilename
        : (wizardOrFilename?.filename || wizardOrFilename?.name || productName || '')
    ).toLowerCase();

    if (nameLower.includes('stress') || nameLower.includes('curve')) {
      targetFilename = 'Stress-Strain_Curve.wbex';
    } else if (nameLower.includes('head')) {
      targetFilename = 'Head_Nozzle.wbex';
    } else if (nameLower.includes('shell')) {
      targetFilename = 'Shell_Nozzle.wbex';
    } else if (nameLower.includes('full')) {
      targetFilename = 'Full_Nozzle.wbex';
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Sign in again before downloading this wizard.');
      const response = await fetch('/api/wizard-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ filename: targetFilename })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'This account does not have an active license for the requested wizard.');
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = result.url;
      downloadLink.rel = 'noopener noreferrer';
      downloadLink.target = '_self';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      showNotification(`Secure download initiated for ${targetFilename}. License: ${licenseKey || 'Active'}`, 'success', 'Secure WBEX Delivery');
    } catch (error) {
      console.error('Licensed wizard download failed:', error);
      showNotification(error.message || 'The licensed wizard could not be downloaded.', 'error');
    }
  };

  const downloadAnsysWbexFile = (filename, licenseKey, productName) => {
    downloadSecureWbexFile(filename, licenseKey, productName);
  };

  const generateNovaLicenseKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `NOVA-${code}`;
  };

  const calculateExpiryDate = (termStr) => {
    const now = new Date();
    const s = String(termStr || '').toLowerCase();
    let months = 1;
    if (s.includes('6 month')) months = 6;
    else if (s.includes('3 month')) months = 3;
    else if (s.includes('1 month')) months = 1;
    else if (s.includes('year') || s.includes('annual')) months = 12;
    const exp = new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
    const dd = String(exp.getDate()).padStart(2, '0');
    const mm = String(exp.getMonth() + 1).padStart(2, '0');
    const yyyy = exp.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  const getJobInvoiceData = (job) => {
    if (!job) return null;
    let p = job.json_payload;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { }
    }
    const first = Array.isArray(p) ? p[0] : p;
    if (first && first.invoiceId) return first;

    const isWiz = job.type === 'Wizard Purchase' || (job.name && job.name.toLowerCase().includes('wizard'));
    const isSub = job.type === 'Plan Subscription' || (job.name && job.name.toLowerCase().includes('plan'));
    if (isWiz || isSub || (job.price && job.price > 0)) {
      let licKey = '';
      let expDate = '';
      if (job.error_message && job.error_message.includes('License:')) {
        const matchKey = job.error_message.match(/License:\s*([A-Za-z0-9\-]+)/);
        const matchExp = job.error_message.match(/Expiry:\s*([0-9\-]+)/);
        if (matchKey) licKey = matchKey[1];
        if (matchExp) expDate = matchExp[1];
      }
      if (!licKey) licKey = job.job_id_display || generateNovaLicenseKey();
      if (!expDate) expDate = calculateExpiryDate('1 Month');

      const amt = job.price || (isWiz ? 4999 : 899);
      const baseAmt = Math.round(amt / 1.18);
      const gstAmt = amt - baseAmt;
      const cgst = Math.round(gstAmt / 2);
      const sgst = gstAmt - cgst;

      const jobNameLower = (job.name || '').toLowerCase();
      let targetWbex = 'Full_Nozzle.wbex';
      if (jobNameLower.includes('stress') || jobNameLower.includes('curve')) targetWbex = 'Stress-Strain_Curve.wbex';
      else if (jobNameLower.includes('head')) targetWbex = 'Head_Nozzle.wbex';
      else if (jobNameLower.includes('shell')) targetWbex = 'Shell_Nozzle.wbex';

      return {
        invoiceId: job.job_id_display || ('INV-' + new Date().getFullYear() + '-' + String(job.id || Date.now()).slice(-6)),
        paymentId: 'pay_rzp_live_' + String(job.id || Date.now()).slice(-8),
        date: new Date(job.created_at || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        productName: job.name,
        productType: isWiz ? 'wizard_purchase' : 'credit_subscription',
        priceFormatted: '₹' + amt.toLocaleString('en-IN'),
        amountInINR: amt,
        baseAmount: baseAmt,
        cgst,
        sgst,
        isWizard: isWiz,
        licenseKey: licKey,
        expiryDate: expDate,
        registeredOn: new Date(job.created_at || Date.now()).toLocaleString('en-IN'),
        macAddress: '2C:7B:A0:8C:BC:CA',
        wbexFilename: targetWbex,
        result_url: isWiz ? `/wizards/${targetWbex}` : null,
        customerName: currentUser?.name || 'Dinesh',
        customerEmail: currentUser?.email || '',
        customerPhone: currentUser?.phone || 'Not Provided',
        company: currentUser?.company || 'Nova Engineering',
        term: isWiz ? '1 Month' : 'Monthly',
        workstations: 1
      };
    }
    return null;
  };

  const openDocumentModal = (entryOrData, type = 'invoice') => {
    if (!entryOrData) return;
    const rawAmt = Number(entryOrData.amountInINR || entryOrData.amount || 0);
    const amt = rawAmt > 0 ? rawAmt : (
      entryOrData.priceFormatted ? Number(String(entryOrData.priceFormatted).replace(/[^0-9]/g, '')) : 4980
    ) || 4980;
    const baseAmt = entryOrData.baseAmount || entryOrData.base_amount || Math.round(amt / 1.18);
    const gstAmt = amt - baseAmt;
    const cgst = (entryOrData.cgst !== undefined && entryOrData.cgst !== null) ? entryOrData.cgst : Math.round(gstAmt / 2);
    const sgst = (entryOrData.sgst !== undefined && entryOrData.sgst !== null) ? entryOrData.sgst : (gstAmt - cgst);

    const invId = entryOrData.invoiceId || entryOrData.invoice_no || ('INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6));
    const rcpId = entryOrData.receiptNo || entryOrData.receipt_no || (invId ? invId.replace('INV-', 'RCP-') : ('RCP-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6)));

    const normalized = {
      ...entryOrData,
      invoiceId: invId,
      receiptNo: rcpId,
      paymentId: entryOrData.paymentId || entryOrData.transaction_id || ('PAY-RAZORPAY-' + String(Date.now()).slice(-8)),
      amountInINR: amt,
      baseAmount: baseAmt,
      cgst,
      sgst,
      priceFormatted: '₹' + amt.toLocaleString('en-IN'),
      productName: entryOrData.productName || entryOrData.plan_name || 'Nova Max',
      term: entryOrData.term || entryOrData.billing_cycle || (String(entryOrData.productName || entryOrData.plan_name || '').includes('Wizard') ? '6 Months License' : 'Monthly Subscription'),
      customerName: entryOrData.customerName || entryOrData.user_name || currentUser?.name || 'Dinesh Kumar',
      customerEmail: entryOrData.customerEmail || entryOrData.user_email || currentUser?.email || '',
      customerPhone: entryOrData.customerPhone || entryOrData.user_phone || currentUser?.phone || 'Not Provided',
      gateway: entryOrData.gateway || entryOrData.payment_gateway || 'Razorpay (Live Verified)',
      method: entryOrData.method || entryOrData.payment_method || 'UPI / Cards / NetBanking',
      status: 'PAID',
      date: entryOrData.date || (entryOrData.created_at ? new Date(entryOrData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
      licenseKey: entryOrData.licenseKey || entryOrData.license_key || (entryOrData.receipt_data?.licenseKey || ''),
      expiryDate: entryOrData.expiryDate || entryOrData.expiry_date || (entryOrData.receipt_data?.expiryDate || ''),
      wbexFilename: entryOrData.wbexFilename || entryOrData.wbex_filename || (entryOrData.receipt_data?.wbexFilename || '')
    };

    openDocumentViewer(normalized, type);
    setCompletedInvoice(normalized);
  };


  const handleRazorpayCheckout = async (productName, _priceStr, productType = 'general', metadata = {}) => {
    if (checkoutStartInProgressRef.current) return;
    checkoutStartInProgressRef.current = true;
    setIsProcessingPayment(true);

    const isWizard = productType === 'wizard' || productType === 'wizard_purchase' ||
      productName.toLowerCase().includes('wizard') || productName.toLowerCase().includes('.wbex');
    const serverProductType = isWizard ? 'wizard_purchase' : productType;
    let checkoutOpened = false;
    let checkoutReleased = false;
    let paymentVerificationInProgress = false;
    const releaseCheckout = () => {
      if (checkoutReleased) return;
      checkoutReleased = true;
      checkoutStartInProgressRef.current = false;
      setIsProcessingPayment(false);
    };

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Please sign in again before starting checkout.');

      await loadRazorpaySdk();

      const orderResponse = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          productType: serverProductType,
          planName: metadata.planName,
          wizardId: metadata.wizardId,
          term: metadata.term || '1 Month'
        })
      });
      const orderData = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) throw new Error(orderData.error || 'Could not create secure payment order.');
      if (!orderData.orderId || !orderData.keyId || !orderData.amount || !orderData.currency || !orderData.product?.productName) {
        throw new Error('The secure checkout order was incomplete. No payment was started; please retry.');
      }

      const finalizePayment = async (paymentResponse) => {
        try {
          const verifyResponse = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify(paymentResponse)
          });
          const verification = await verifyResponse.json().catch(() => ({}));
          if (!verifyResponse.ok || !verification.success) {
            throw new Error(verification.error || 'Payment could not be verified.');
          }

          const invoiceData = verification.invoiceData;
          const verifiedIsWizard = invoiceData.isWizard === true;
          const amount = Number(invoiceData.amountInINR);
          if (verifiedIsWizard && invoiceData.wbexFilename) {
            downloadSecureWbexFile(invoiceData.wbexFilename, invoiceData.licenseKey, invoiceData.productName);
          }

          if (metadata.planName) {
            const dailyCredits = metadata.planName === 'Max' ? 3000 : metadata.planName === 'Pro' ? 1500 : 700;
            setCurrentUser(prev => ({
              ...prev,
              plan: metadata.planName,
              dailyCreditsTotal: dailyCredits,
              dailyCreditsRemaining: dailyCredits
            }));
            try {
              localStorage.setItem(`nova_credits_${currentUser.email}`, dailyCredits.toString());
              localStorage.setItem('nova_user_plan_permanent', JSON.stringify({ plan: metadata.planName, credits: dailyCredits }));
            } catch (storageError) {
              console.warn('Plan cache update warning:', storageError);
            }
          }

          const userEmail = (currentUser?.email || '').toLowerCase();
          const historyEntry = { ...invoiceData, customerEmail: userEmail, status: 'PAID', savedAt: new Date().toISOString() };
          setPaymentHistory(prev => {
            const filtered = prev.filter(entry => {
              const emailMatch = !entry.customerEmail || entry.customerEmail.toLowerCase() === userEmail;
              const status = (entry.status || '').toUpperCase();
              return emailMatch && ['PAID', 'SUCCESS', 'COMPLETED'].includes(status);
            });
            const updated = [historyEntry, ...filtered].slice(0, 20);
            if (userEmail) {
              try { localStorage.setItem(`nova_payment_history_${userEmail}`, JSON.stringify(updated)); } catch (storageError) { }
            }
            return updated;
          });

          showNotification(
            `Payment verified of ₹${amount.toLocaleString('en-IN')}! ${invoiceData.productName} — Invoice #${verification.invoiceNo}`,
            'success',
            'Payment Confirmed'
          );
          trackConversion('purchase', {
            currency: 'INR',
            value: amount,
            product_name: invoiceData.productName
          });
          setCompletedInvoice(invoiceData);
          openDocumentModal(invoiceData, 'invoice');
        } catch (error) {
          console.error('Payment verification error:', error);
          const paymentId = paymentResponse?.razorpay_payment_id || 'not available';
          showNotification(`${error.message} Razorpay payment ID: ${paymentId}.`, 'error', 'Payment Verification');
        } finally {
          paymentVerificationInProgress = false;
          releaseCheckout();
        }
      };

      const options = {
        key: orderData.keyId,
        order_id: orderData.orderId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'NOVA AI TECHNOLOGIES',
        description: orderData.product.productName,
        image: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
        handler: (response) => {
          paymentVerificationInProgress = true;
          void finalizePayment(response);
        },
        prefill: {
          name: currentUser?.name || 'User',
          email: currentUser?.email || '',
          contact: currentUser?.phone || ''
        },
        notes: {
          product_type: serverProductType,
          product_name: orderData.product.productName,
          term: orderData.product.term || metadata.term || '',
          workstations: String(orderData.product.workstations || 1),
          wizard_id: orderData.product.wizardId || '',
          filename: orderData.product.filename || ''
        },
        theme: { color: '#2874f0' },
        modal: {
          ondismiss: () => {
            if (!paymentVerificationInProgress) {
              releaseCheckout();
              showNotification('Razorpay checkout window closed.', 'info', 'Razorpay Checkout');
            }
          }
        }
      };
      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', (response) => {
        const description = response.error?.description || 'Transaction declined';
        paymentVerificationInProgress = false;
        showNotification(`Payment failed: ${description}`, 'error', 'Payment Failed');
      });
      razorpay.open();
      checkoutOpened = true;
      setIsProcessingPayment(false);
    } catch (error) {
      console.error('Unable to start checkout:', error);
      showNotification(error.message || 'Unable to start checkout.', 'error', 'Razorpay');
    } finally {
      if (!checkoutOpened) releaseCheckout();
    }
  };

  const downloadCodeSnippet = (filename, content) => {
    if (!content) return;
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'ansys_fea_script.py';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showNotification(`Downloaded ${filename || 'script'} to your computer`, 'success', 'Code File');
    } catch (e) {
      console.error("Code download error:", e);
      showNotification('Failed to trigger file download', 'error');
    }
  };

  const handleMediaFileUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showNotification('File size exceeds 15MB limit.', 'error', 'File Too Large');
      return;
    }
    const isVideo = file.type.startsWith('video');
    const reader = new FileReader();
    reader.onload = (event) => {
      setNewPostMedia({
        data: event.target.result,
        type: isVideo ? 'video' : 'image',
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      });
      setShowAttachMenu(false);
      showNotification(`Attached ${isVideo ? 'video' : 'image'}: ${file.name}`, 'info', 'Media Attached');
    };
    reader.readAsDataURL(file);
  };

  const handleCodeFileUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').length;
      const ext = file.name.split('.').pop().toLowerCase();
      const lang = ext === 'py' || ext === 'wbex' ? 'python' : ext === 'mac' || ext === 'apdl' || ext === 'inp' ? 'apdl' : ext === 'json' ? 'json' : 'text';

      setNewPostCode({
        content: text,
        filename: file.name,
        lines: lines,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        lang: lang
      });
      setComposerCodeFilename(file.name);
      setComposerCodeContent(text);
      setComposerCodeLang(lang);
      setCodeModalFilename(file.name);
      setCodeModalContent(text);
      setCodeModalLang(lang);
      setShowCodeModal(true);
      setShowAttachMenu(false);
      showNotification(`Loaded script: ${file.name} (${lines} lines)`, 'success', 'Script Loaded');
    };
    reader.readAsText(file);
  };

  const fetchCommunityPosts = async () => {
    try {
      if (supabase) {
        const { data, error } = await supabase.from('nova_community_posts')
          .select('id,type,post_type,post_status,title,content,category,tags,user_id,user_name,user_avatar,user_initial,user_role,views_count,likes_count,comments_count,is_solved,created_at,updated_at,last_active_at')
          .order('created_at', { ascending: false });
        if (!error && data) {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          const clean = data.filter(p => p && !mockIds.includes(p.id));
          setCommunityPosts(clean);
          try { localStorage.setItem('nova_community_posts_permanent', JSON.stringify(clean)); } catch (e) { }
          return;
        }
      }
    } catch (e) {
      console.warn("fetchCommunityPosts error:", e);
    }
  };

  const fetchCommunityComments = async () => {
    try {
      if (supabase) {
        const { data, error } = await supabase.from('nova_community_comments')
          .select('id,post_id,comment,user_id,user_name,user_avatar,user_initial,user_role,created_at')
          .order('created_at', { ascending: true });
        if (!error && data) {
          const mockIds = ['post_asme_div2_scl_linearization', 'post_cyclic_fatigue_weld', 'post_spaceclaim_nozzle_blend', 'post_hexahedral_meshing_convergence'];
          const grouped = {};
          data.forEach(item => {
            const pId = item.post_id;
            if (pId && !mockIds.includes(pId)) {
              if (!grouped[pId]) grouped[pId] = [];
              grouped[pId].push({
                id: item.id,
                user: item.user_name || 'Nova Engineer',
                initial: item.user_initial || (item.user_name ? item.user_name[0].toUpperCase() : 'E'),
                userId: item.user_id || '',
                text: item.comment || '',
                time: item.created_at ? new Date(item.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Recently',
                date: item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
                created_at: item.created_at
              });
            }
          });

          setPostComments(grouped);
          try { localStorage.setItem('nova_community_comments_permanent', JSON.stringify(grouped)); } catch (e) { }
        }
      }
    } catch (e) {
      console.warn("fetchCommunityComments error:", e);
    }
  };

  const handlePostCommunity = async () => {
    const rawContent = newPostText.trim();
    const rawCode = composerCodeContent.trim() || newPostCode?.content;
    const rawMedia = newPostMedia;
    const postCat = composerCategory || communityCategory || 'ASME Codes';

    if (!rawContent && !rawCode && !rawMedia) {
      showNotification('Please type a message, attach code, or add media.', 'error', 'Empty Message');
      return;
    }
    setIsPosting(true);

    const generatedTitle = composerTitle.trim() || (rawContent.length > 70
      ? rawContent.substring(0, 70) + '...'
      : (rawContent || (rawCode ? `FEA Automation Script: ${composerCodeFilename}` : 'Engineering Discussion Topic')));

    const newPostPayload = {
      id: `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      user_name: currentUser?.name || 'Nova Engineer',
      user_id: currentUser?.id,
      user_initial: currentUser?.initial || (currentUser?.name ? currentUser.name[0].toUpperCase() : 'E'),
      user_role: currentUser?.plan === 'Max' ? 'Nova Lead Architect' : 'FEA Specialist',
      user_reputation: currentUser?.plan === 'Max' ? 1420 : 150,
      title: generatedTitle,
      content: rawContent,
      category: postCat === 'All' ? 'ASME Codes' : postCat,
      tags: [],
      image_url: rawMedia?.type === 'image' ? rawMedia.data : null,
      media_url: rawMedia?.data || null,
      media_type: rawMedia?.type || null,
      media_name: rawMedia?.name || null,
      code_snippet: rawCode || null,
      code_filename: rawCode ? (composerCodeFilename || 'asme_script.py') : null,
      likes_count: 0,
      is_solved: false,
      is_pinned: false,
      created_at: new Date().toISOString()
    };

    setCommunityPosts(prev => {
      const updated = [newPostPayload, ...prev];
      try { localStorage.setItem('nova_community_posts_permanent', JSON.stringify(updated)); } catch (e) { }
      return updated;
    });

    try {
      if (supabase) {
        const { data, error } = await supabase.from('nova_community_posts').insert([{
          user_name: newPostPayload.user_name,
          user_initial: newPostPayload.user_initial,
          user_id: newPostPayload.user_id,
          title: newPostPayload.title,
          content: rawContent || rawCode || rawMedia?.name || 'Shared an engineering attachment.',
          category: newPostPayload.category
        }]).select('id,user_id,user_name,user_initial,title,content,category,views_count,likes_count,comments_count,is_solved,created_at');
        if (error) throw error;
        if (!data?.[0]) throw new Error('The community post was not returned after saving.');

        setCommunityPosts(prev => {
          const updated = prev.map(p => p.id === newPostPayload.id ? { ...p, id: data[0].id } : p);
          try { localStorage.setItem('nova_community_posts_permanent', JSON.stringify(updated)); } catch (e) { }
          return updated;
        });
      }
    } catch (error) {
      console.error("Supabase community post could not be saved:", error);
      setCommunityPosts(prev => prev.filter(post => post.id !== newPostPayload.id));
      try {
        localStorage.setItem('nova_community_posts_permanent', JSON.stringify(
          communityPosts.filter(post => post.id !== newPostPayload.id)
        ));
      } catch (storageError) {}
      setIsPosting(false);
      showNotification('The community post could not be saved. Please try again.', 'error', 'Community');
      return;
    }

    setNewPostText('');
    setComposerTitle('');
    setComposerCodeContent('');
    setNewPostMedia(null);
    setNewPostCode(null);
    setShowAttachMenu(false);
    setShowCodeModal(false);
    setIsPosting(false);

    showNotification('Message published & synchronized live to Nova Chat!', 'success', 'Discussion');
  };

  const handleDeletePost = async (postId) => {
    if (!window.confirm('Are you sure you want to permanently delete this message?')) return;

    setCommunityPosts(prev => {
      const updated = prev.filter(p => p.id !== postId);
      try { localStorage.setItem('nova_community_posts_permanent', JSON.stringify(updated)); } catch (e) { }
      return updated;
    });

    try {
      if (supabase) {
        await supabase.from('nova_community_posts').delete().eq('id', postId);
      }
    } catch (e) { }

    showNotification('Discussion permanently removed from community', 'info', 'Community');
  };

  const handleToggleBookmark = (postId) => {
    const isCurrently = !!bookmarkedPosts[postId];
    const updated = { ...bookmarkedPosts, [postId]: !isCurrently };
    setBookmarkedPosts(updated);
    try { localStorage.setItem('nova_community_bookmarks', JSON.stringify(updated)); } catch (e) { }
    showNotification(!isCurrently ? 'Discussion saved to your Bookmarks!' : 'Removed from Bookmarks', 'info', 'Bookmarks');
  };

  const handleToggleSolved = (postId) => {
    const isCurrently = !!solvedPosts[postId];
    const updated = { ...solvedPosts, [postId]: !isCurrently };
    setSolvedPosts(updated);
    try { localStorage.setItem('nova_community_solved', JSON.stringify(updated)); } catch (e) { }
    showNotification(!isCurrently ? 'Marked discussion as Solved! 💡' : 'Marked discussion as Open', 'success', 'Status Updated');
  };

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase.from('ansys_jobs').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setJobs(data);
        setSelectedJobDetails(prev => {
          if (!prev) return null;
          const updated = data.find(j => j.id === prev.id);
          return updated || prev;
        });
      }
    } catch (e) {
      console.error("fetchJobs error:", e);
    }
  };
  useEffect(() => {
    if (isLoggedIn) {
      fetchJobs();
      fetchCommunityPosts();
      fetchCommunityComments();
      const channel = supabase
        .channel('ansys_jobs_realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ansys_jobs' },
          () => {
            fetchJobs();
          }
        )
        .subscribe();
      const interval = setInterval(() => {
        fetchJobs();
        fetchCommunityPosts();
        fetchCommunityComments();
        if (!currentUser.isApproved) {
          checkApprovalStatus();
        }
      }, 30000);
      return () => {
        supabase.removeChannel(channel);
        clearInterval(interval);
      };
    }
  }, [isLoggedIn, currentUser.isApproved]);
  function setupUser(user) {
    authIdentityRef.current = {
      id: user.id,
      email: (user.email || '').trim().toLowerCase()
    };
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || "User";
    const metadataAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
    const isSpecialUser = user.email === 'dineshkumar2729304@gmail.com' || user.email === 'dineshkumar2729305@gmail.com' || user.email === 'analysis.ai.nova@gmail.com';
    let userPlan = isSpecialUser ? 'Max' : 'Free';
    let totalCredits = isSpecialUser ? 3000 : 100;
    const savedSub = localStorage.getItem(`nova_sub_${user.email}`);
    if (savedSub && !isSpecialUser) {
      try {
        const parsed = JSON.parse(savedSub);
        userPlan = parsed.plan || 'Free';
        totalCredits = parsed.totalCredits || (userPlan === 'Max' ? 3000 : userPlan === 'Pro' ? 1500 : userPlan === 'Basic' ? 700 : 100);
      } catch (e) { }
    }
    const savedCredits = localStorage.getItem(`nova_credits_${user.email}`);
    let remainingCredits = totalCredits;
    if (savedCredits !== null) {
      remainingCredits = Math.min(totalCredits, parseInt(savedCredits, 10));
    }
    const isApprovedStatus = user.email === 'analysis.ai.nova@gmail.com' || isSpecialUser || userPlan !== 'Free';
    setCurrentUser({
      id: user.id,
      name: fullName,
      email: user.email,
      initial: fullName.charAt(0).toUpperCase(),
      avatar: metadataAvatar,
      avatar_url: metadataAvatar,
      company: user.user_metadata?.company || "Nova Engineering",
      phone: user.user_metadata?.phone || "Not Provided",
      joined: new Date(user.created_at || Date.now()).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
      isApproved: isApprovedStatus,
      plan: userPlan,
      dailyCreditsTotal: totalCredits,
      dailyCreditsRemaining: remainingCredits,
      isLifetimeMax: false
    });

    localStorage.setItem('nova_user', JSON.stringify({ id: user.id, email: user.email }));
    setIsLoggedIn(true);
    supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle().then(({ data: dbProfile, error }) => {
      if (!error && dbProfile) {
        const finalPlan = isSpecialUser ? 'Max' : (dbProfile.plan || userPlan);
        const finalTotal = isSpecialUser ? 3000 : (dbProfile.daily_credits_total || totalCredits);
        const finalRemaining = dbProfile.daily_credits_remaining !== null && dbProfile.daily_credits_remaining !== undefined
          ? Math.min(finalTotal, dbProfile.daily_credits_remaining)
          : finalTotal;
        const profileName = dbProfile.full_name || fullName;
        const profileAvatar = dbProfile.avatar_url || metadataAvatar;
        setCurrentUser(prev => ({
          ...prev,
          name: profileName,
          initial: profileName.charAt(0).toUpperCase(),
          company: dbProfile.company || prev.company,
          phone: dbProfile.phone || prev.phone,
          plan: finalPlan,
          avatar: profileAvatar,
          avatar_url: profileAvatar,
          isApproved: dbProfile.is_approved === true || user.email === 'analysis.ai.nova@gmail.com' || isSpecialUser || finalPlan !== 'Free',
          dailyCreditsTotal: finalTotal,
          dailyCreditsRemaining: finalRemaining
        }));
      } else if (error) {
        console.warn('Supabase profile lookup warning:', error);
      } else {
        console.error('Supabase profile is missing. Apply the auth profile sync migration.', {
          userId: user.id
        });
      }
    }).catch(err => console.warn('Supabase profile sync warning:', err));

    const userEmail = (user.email || '').toLowerCase();
    const userPaymentKey = `nova_payment_history_${userEmail}`;
    try {
      const cached = localStorage.getItem(userPaymentKey);
      setPaymentHistory(cached ? JSON.parse(cached) : []);
    } catch (e) {
      setPaymentHistory([]);
    }
    if (user.email && supabase) {
      supabase.from('nova_orders').select('*').eq('user_email', userEmail).order('created_at', { ascending: false }).then(({ data: ordersData, error: ordersErr }) => {
        if (!ordersErr && ordersData && ordersData.length > 0) {
          const loadedHistory = ordersData
            .filter(order => {
              const st = (order.payment_status || order.status || '').toUpperCase();
              return st === 'PAID' || st === 'SUCCESS' || st === 'COMPLETED';
            })
            .map(order => {
              const rd = order.receipt_data || {};
              const amt = Number(order.amount || rd.amountInINR || 0);
              const baseAmt = order.base_amount || rd.baseAmount || (amt ? Math.round(amt / 1.18) : 0);
              const gstAmt = amt - baseAmt;
              const cgst = (order.cgst !== undefined && order.cgst !== null) ? order.cgst : Math.round(gstAmt / 2);
              const sgst = (order.sgst !== undefined && order.sgst !== null) ? order.sgst : (gstAmt - cgst);
              return {
                invoiceId: order.invoice_no || order.order_id || rd.invoiceId,
                receiptNo: order.receipt_no || rd.receiptNo || (order.invoice_no ? String(order.invoice_no).replace('INV-', 'RCP-') : 'RCP-2026-000000'),
                paymentId: order.transaction_id || rd.paymentId || 'PAY-RAZORPAY-16940220',
                date: order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : (rd.date || 'Today'),
                productName: order.plan_name || rd.productName || 'Nova Subscription',
                productType: order.is_wizard ? 'wizard_purchase' : (rd.productType || 'credit_subscription'),
                priceFormatted: '₹' + amt.toLocaleString('en-IN'),
                amountInINR: amt,
                baseAmount: baseAmt,
                cgst,
                sgst,
                customerName: order.user_name || fullName || 'User',
                customerEmail: order.user_email || user.email,
                customerPhone: order.user_phone || 'Not Provided',
                company: order.user_company || 'Nova AI Technologies',
                term: order.billing_cycle || rd.term || 'License',
                workstations: rd.workstations || 1,
                gateway: order.payment_gateway || 'Razorpay (Live Verified)',
                method: order.payment_method || 'UPI / Cards / NetBanking',
                status: 'PAID',
                licenseKey: order.license_key || rd.licenseKey || '',
                expiryDate: order.expiry_date || rd.expiryDate || '',
                wbexFilename: order.wbex_filename || rd.wbexFilename || '',
                savedAt: order.created_at
              };
            });
          setPaymentHistory(loadedHistory);
          try { localStorage.setItem(userPaymentKey, JSON.stringify(loadedHistory)); } catch (e) { }
        } else {
          setPaymentHistory([]);
          try { localStorage.setItem(userPaymentKey, JSON.stringify([])); } catch (e) { }
        }
      }).catch(err => console.warn('Supabase orders load warning:', err));
    } else {
      setPaymentHistory([]);
    }
  };
  useEffect(() => {
    if (!supabase || !isLoggedIn || !currentUser.id) return undefined;

    const channel = supabase
      .channel(`user-profile-${currentUser.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_profiles',
        filter: `id=eq.${currentUser.id}`
      }, ({ new: profile }) => {
        if (!profile?.id) return;
        setCurrentUser(prev => {
          const profileName = profile.full_name || prev.name;
          const profileAvatar = Object.prototype.hasOwnProperty.call(profile, 'avatar_url')
            ? profile.avatar_url
            : prev.avatar;
          const profilePlan = profile.plan || prev.plan;
          return {
            ...prev,
            email: profile.email || prev.email,
            name: profileName,
            initial: profileName.charAt(0).toUpperCase(),
            company: profile.company || prev.company,
            phone: profile.phone || prev.phone,
            avatar: profileAvatar,
            avatar_url: profileAvatar,
            plan: profilePlan,
            isApproved: profile.is_approved === true
              || prev.email === 'analysis.ai.nova@gmail.com'
              || prev.email === 'dineshkumar2729304@gmail.com'
              || prev.email === 'dineshkumar2729305@gmail.com'
              || profilePlan !== 'Free'
          };
        });
      })
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('User profile realtime subscription failed:', error || status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isLoggedIn, currentUser.id]);
  const PLAN_RANKS = { 'Free': 0, 'Basic': 1, 'Pro': 2, 'Max': 3 };
  const canRunPlan = (requiredPlan) => {
    return true;
  };
  const consumeCredits = (featureName, creditCost, requiredPlan, onAllowed) => {
    if (!currentUser.email) {
      setCurrentView('login');
      return false;
    }
    if (onAllowed) {
      onAllowed();
    }
    return true;
  };
  useEffect(() => {
    if (showSplash) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setShowSplash(false);
        return undefined;
      }
      const exitTimer = setTimeout(() => setIsSplashExiting(true), 3500);
      const unmountTimer = setTimeout(() => {
        setShowSplash(false);
        setIsSplashExiting(false);
      }, 4200);
      return () => { clearTimeout(exitTimer); clearTimeout(unmountTimer); };
    }
  }, [showSplash]);
  const handleLogoClick = () => {
    if (isLoggedIn) {
      navigateToDashboard();
      return;
    }
    setCurrentView('landing');
    setIsSplashExiting(false);
    setShowSplash(true);
    window.scrollTo(0, 0);
  };
  const showNotification = (message, type = 'success', title = null) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);

    const newNotif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: title || (type === 'success' ? 'Action Completed' : type === 'error' ? 'System Alert' : 'Notification'),
      message: message,
      type: type,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      read: false
    };

    setPersistentNotifications(prev => {
      const updated = [newNotif, ...(prev || []).slice(0, 49)];
      try { localStorage.setItem('nova_persistent_notifications', JSON.stringify(updated)); } catch (e) { }
      return updated;
    });
  };
  const scrollToSection = (id) => {
    setIsMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  };
  const handleRouteToAuth = () => {
    setIsMobileMenuOpen(false);
    if (isLoggedIn) setCurrentView('dashboard');
    else setCurrentView('login');
  };
  const callGeminiAPI = async (contents, systemInstructionText) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Sign in to use NOVA AI.');
      const headers = { "Content-Type": "application/json" };
      headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: Array.isArray(contents) ? contents.slice(-20) : contents,
          systemInstruction: systemInstructionText
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The AI service could not complete the request.");
      if (typeof result.text !== "string") throw new Error("The AI service returned an invalid response.");
      return result.text;
    } catch (error) {
      console.error("NOVA AI request failed:", error);
      return `NOVA AI is temporarily unavailable: ${error.message || "Please try again later."}`;
    }
  };
  useEffect(() => {
    const showingLegacyLanding = currentView === 'landing'
      || (currentView === 'mobile_landing' && !isMobileLandingViewport);
    if (showingLegacyLanding && !showSplash) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('opacity-100', 'translate-y-0');
            entry.target.classList.remove('opacity-0', 'translate-y-10');
          }
        });
      }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
      const elements = document.querySelectorAll('.reveal');
      elements.forEach(el => observer.observe(el));
      return () => observer.disconnect();
    }
  }, [currentView, isMobileLandingViewport, showSplash]);
  const handleAiSetupSubmit = async () => {
    if (!aiSetupPrompt.trim()) return;
    setIsAiSetupLoading(true);
    setAiSetupResponse("");
    const systemInstruction = `You are an expert Principal Mechanical FEA Engineer and AI Solutions Architect for NOVA AI TECHNOLOGIES.
Your task is to analyze the user's engineering scenario and recommend the optimal NOVA solution:

1. CLOUD FEA ANALYSIS MODULES (Automated cloud solver, ASME code compliance checks & instant DOCX/PDF reports):
   - ASME Nozzle Analysis (ASME Section VIII-2 Part 5 Elastic-Plastic, 300 credits)
   - Bellow Expansion Joint Analysis (EJMA 10th Ed & ASME VIII-1 App 26, 300 credits)
   - Saddle Horizontal Vessel Support (Zick Method & ASME Section VIII, 150 credits)
   - Local PWHT Thermal Analysis (WRC 452 & ASME VIII-1 UW-40, 125 credits)
   - Flange Rigidity & Leakage (ASME VIII-1 App 2 & EN 1591, 200 credits)
   - Hot Box Skirt Thermal FEA (75 credits)
   - Lifting Lug Analysis (WRC 107/537, 75 credits)
   - Heavy Trunnion Vessel Support (ASME VIII-2 Part 5 & WRC 537, 175 credits)
   - 2D Axisymmetric Tubesheet Heat Exchanger (ASME VIII-1 UHX & TEMA RCB, 250 credits)
   - CAD AI 3D Parametric STEP Generator (75 credits)
   - ASME Materials Database (10 credits / Free)
   - Stress-Strain Curve Generator (10 credits / Free)

2. ANSYS ACT WIZARDS (.WBEX EXTENSIONS FOR LOCAL ANSYS WORKBENCH / MECHANICAL):
   - Shell Nozzle Ansys ACT Wizard (.WBEX) [Base: ₹4,999/mo | ₹12,499/3mo | ₹19,999/6mo]: Cylindrical & conical shell nozzle parametric FEA and stress linearization.
   - Head Nozzle Ansys ACT Wizard (.WBEX) [1.5X Price: ₹7,499/mo | ₹18,749/3mo | ₹29,999/6mo]: Hemispherical, 2:1 ellipsoidal, and torispherical head nozzle parametric analysis.
   - Full Nozzle Ansys ACT Wizard (.WBEX) [2X Price: ₹9,999/mo | ₹24,999/3mo | ₹39,999/6mo]: Complete comprehensive nozzle suite for both Shell and all Vessel Head types.
   - Stress-Strain Curve Ansys ACT Wizard (.WBEX) [₹1,499/mo | ₹3,749/3mo | ₹5,999/6mo]: Generates all types of stress-strain curves in Ansys (Ramberg-Osgood, MISO, KINH, True Stress-True Strain, ASME VIII-2 Annex 3-D).

Format your recommendation cleanly with:
- Recommended Solution (Cloud Module vs Ansys ACT Wizard .WBEX)
- Applicable Governing Standard (e.g. ASME VIII-2 Part 5, EJMA, WRC 537, TEMA)
- Key Input Data Required (geometry, design pressure, temperature, nozzle loads P/V/M, corrosion allowance, material grade)
- Verification & Deliverable (Von Mises stress, stress categorization Pm/Pl/Pb/Q, plastic limit load, DOCX report or .WBEX workflow).`;
    const responseText = await callGeminiAPI([{ role: "user", parts: [{ text: aiSetupPrompt }] }], systemInstruction);
    setAiSetupResponse(responseText);
    setIsAiSetupLoading(false);
  };
  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    if (!supportInput.trim() || isSupportLoading) return;
    const newChat = [...supportChat, { role: 'user', text: supportInput }];
    setSupportChat(newChat);
    setSupportInput("");
    setIsSupportLoading(true);
    const contents = newChat.map(msg => ({ role: msg.role === 'model' ? 'model' : 'user', parts: [{ text: msg.text }] }));
    const systemInstruction = `You are NOVA AI, the authoritative senior mechanical engineering assistant for NOVA AI TECHNOLOGIES.

LATEST OFFICIAL PRICING & PRODUCTS GUIDE:
1. CLOUD SUBSCRIPTION PLANS (100% Daily Credit Auto-Reset at 00:00 UTC / 05:30 AM IST):
   - Free Plan: ₹0 ($0) — 100 credits/day, ASME Materials (10 cr), Stress-Strain Curves (10 cr), AI Recommender.
   - Basic Plan: ₹899/month ($10) — 700 credits/day, ASME Nozzle Analysis (300 cr), Bellow Expansion Joint (300 cr), Saddle Analysis (150 cr), Local PWHT (125 cr), Full DOCX/PDF reports.
   - Pro Plan: ₹2,999/month ($35) — 1,500 credits/day, All Basic modules + Flange Rigidity (200 cr), Hot Box (75 cr), Lug Lifting (75 cr), Priority queue.
   - Max Plan: ₹4,999/month ($60) — 3,000 credits/day, All Pro modules + Trunnion Support (175 cr), Tubesheet Heat Exchanger (250 cr), CAD AI 3D Generator (75 cr), Full platform capability.

2. ANSYS ACT EXTENSION WIZARDS (.WBEX) for Local Ansys Workbench / Mechanical:
   - Shell Nozzle ACT Wizard (.WBEX):
     * 1 Month: ₹4,999 (1 Workstation)
     * 3 Months: ₹12,499 (1 Workstation)
     * 6 Months: ₹19,999 (2 Workstations - Recommended)
   - Head Nozzle ACT Wizard (.WBEX) [1.5X of Shell Nozzle]:
     * 1 Month: ₹7,499 (1 Workstation)
     * 3 Months: ₹18,749 (1 Workstation)
     * 6 Months: ₹29,999 (2 Workstations - Recommended)
   - Full Nozzle ACT Wizard (.WBEX) [2X of Shell Nozzle]:
     * 1 Month: ₹9,999 (1 Workstation)
     * 3 Months: ₹24,999 (1 Workstation)
     * 6 Months: ₹39,999 (2 Workstations - Recommended)
   - Stress-Strain Curve ACT Wizard (.WBEX) [All types of stress-strain curves generated directly in Ansys]:
     * 1 Month: ₹1,499 (1 Workstation)
     * 3 Months: ₹3,749 (1 Workstation)
     * 6 Months: ₹5,999 (2 Workstations - Recommended)

3. DELIVERY & SECURITY:
   - Node-locked commercial license keys and secure direct WBEX downloads are provisioned instantly upon successful Razorpay payment verification.
   - No insecure external drive links are used.
   - Payments processed via Razorpay Live (UPI, Cards, Net Banking, International).
   - Contact: analysis.ai.nova@gmail.com | WhatsApp: +91 8757014303.

Always provide professional, precise, technically accurate, and helpful answers.`;
    const responseText = await callGeminiAPI(contents, systemInstruction);
    setSupportChat(prev => [...prev, { role: 'model', text: responseText }]);
    setIsSupportLoading(false);
  };
  async function handleGenerateInsights(job) {
    setSelectedInsightJob(job);
    setIsInsightsOpen(true);
    setIsInsightLoading(true);
    setInsightResponse("");
    const systemInstruction = "You are a Senior Principal Mechanical Engineer reviewing an FEA analysis. Keep it extremely brief, professional, and highly structured.";
    const prompt = `Generate a realistic 3-bullet executive summary for a completed Finite Element Analysis of a ${job.type} project named "${job.name}". Invent realistic details assuming the geometry passed ASME Section VIII Div 2 Part 5 code compliance. Include a hypothetical maximum Von Mises stress (in MPa) and a safety factor.`;
    const responseText = await callGeminiAPI([{ role: "user", parts: [{ text: prompt }] }], systemInstruction);
    setInsightResponse(responseText);
    setIsInsightLoading(false);
  }
  const handleMaterialConsultant = async (e) => {
    e.preventDefault();
    if (!materialPrompt.trim()) return;
    setIsMaterialLoading(true);
    setMaterialResponse("");

    const systemInstruction = "You are an expert metallurgist and pressure vessel engineer.";
    const prompt = `Based on these operating conditions: "${materialPrompt}", recommend 2-3 suitable ASME materials for a pressure vessel or heat exchanger component. State the material grade and provide a brief 1-sentence technical justification for each.`;
    const responseText = await callGeminiAPI([{ role: "user", parts: [{ text: prompt }] }], systemInstruction);
    setMaterialResponse(responseText);
    setIsMaterialLoading(false);
  };
  const handleLogin = async (e) => {
    e.preventDefault();
    let errors = {};
    if (!emailRegex.test(loginEmail)) errors.email = "Please enter a valid email address.";
    if (!loginPassword) errors.password = "Password is required.";
    if (Object.keys(errors).length > 0) return setAuthErrors(errors);

    setAuthErrors({});
    if (!reserveAuthPageAttempt('login', loginEmail, setAuthErrors, 'password')) return;
    setIsAuthLoading(true);

    try {
      const cleanEmail = loginEmail.trim().toLowerCase();
      const authPromise = supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: loginPassword,
      });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Network timeout contacting auth server. Please check connection.")), 10000));
      const { data, error } = await Promise.race([authPromise, timeoutPromise]);
      setIsAuthLoading(false);
      if (error) {
        setAuthErrors({ password: friendlyAuthError(error, 'Sign-in failed. Please try again.') });
      } else {
        clearAuthAttempts('login', loginEmail);
        trackConversion('sign_in', { method: 'email' });
        if (data?.user) setupUser(data.user);
        const urlParams = new URLSearchParams(window.location.search);
        const redirect = urlParams.get('redirect') || urlParams.get('next');
        if (redirect === 'chat' || redirect === '/chat' || window.location.pathname.includes('/chat')) {
          setCurrentView('chat');
          try { window.history.pushState({ view: 'chat' }, '', '/chat'); } catch (e) {}
        } else {
          setCurrentView('dashboard');
        }
        showNotification("Successfully logged in!");
      }
    } catch (err) {
      setIsAuthLoading(false);
      setAuthErrors({ password: friendlyAuthError(err, 'Failed to sign in. Please try again.') });
    }
  };
  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setAuthErrors({ email: 'Sign-in is unavailable because Supabase is not configured.' });
      return;
    }

    setAuthErrors({});
    const authAction = currentView === 'signup' ? 'signup' : 'login';
    if (!reserveAuthPageAttempt(authAction, '', setAuthErrors, 'email')) return;
    setIsAuthLoading(true);
    try {
      const redirectTo = new URL('/login', window.location.origin);
      const requestedRedirect = new URLSearchParams(window.location.search).get('redirect')
        || new URLSearchParams(window.location.search).get('next');
      if (requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')) {
        redirectTo.searchParams.set('redirect', requestedRedirect);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo.toString(),
          queryParams: { prompt: 'select_account' }
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google sign-in failed:', error);
      setIsAuthLoading(false);
      setAuthErrors({ email: friendlyAuthError(error, 'Unable to start Google sign-in. Please try again.') });
    }
  };
  const handleSignup = async (e) => {
    e.preventDefault();
    let errors = {};
    if (!signupName.trim()) errors.name = "Full Name is required.";
    if (!emailRegex.test(signupEmail)) errors.email = "Please enter a valid email address.";
    if (!passwordRegex.test(signupPassword)) errors.password = "Password must be at least 8 chars, with 1 letter, 1 number, and 1 symbol.";
    if (Object.keys(errors).length > 0) return setAuthErrors(errors);
    setAuthErrors({});
    if (!reserveAuthPageAttempt('signup', signupEmail, setAuthErrors, 'email')) return;
    setIsAuthLoading(true);
    try {
      const cleanEmail = signupEmail.trim().toLowerCase();
      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: signupPassword,
        options: { data: { full_name: signupName.trim() } }
      });
      if (error) {
        setAuthErrors({ email: friendlyAuthError(error, 'Could not create your account. Please try again.') });
      } else {
        trackConversion('sign_up', { method: 'email' });
        showNotification("Account created! Please check your email to verify your account.", "info");
        setCurrentView('login');
        setLoginEmail(cleanEmail);
      }
    } catch (error) {
      setAuthErrors({ email: friendlyAuthError(error, 'Could not create your account. Please check your connection and try again.') });
    } finally {
      setIsAuthLoading(false);
    }
  };
  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('nova_user');
    setPaymentHistory([]);
    setIsDropdownOpen(false);
    setCurrentView('mobile_landing');
    showNotification("Logged out successfully.", "info");
  };
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    let errors = {};
    if (!passwordRegex.test(pwdForm.new)) errors.new = "New password must be at least 8 chars, with 1 letter, 1 number, and 1 symbol.";
    if (pwdForm.new !== pwdForm.confirm) errors.confirm = "Passwords do not match.";
    if (Object.keys(errors).length > 0) {
      setPwdErrors(errors);
      setIsPwdSuccess(false);
      return;
    }
    setPwdErrors({});

    const { error } = await supabase.auth.updateUser({ password: pwdForm.new });
    if (error) {
      setPwdErrors({ confirm: friendlyAuthError(error, 'Could not update your password. Please try again.') });
      setIsPwdSuccess(false);
    } else {
      setIsPwdSuccess(true);
      showNotification("Password changed securely!");
      setTimeout(() => {
        setIsChangePasswordOpen(false);
        setIsPwdSuccess(false);
        setPwdForm({ current: '', new: '', confirm: '' });
        setShowPwd({ current: false, new: false, confirm: false });
      }, 1500);
    }
  };
  const sendProfileChangeNotice = async (changedFields) => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session?.access_token) throw new Error('Your login session expired. Sign in again to send the notification.');
    const response = await fetch('/api/profile-changed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ changedFields })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'Notification email could not be sent.');
  };
  const handleEditProfile = async (e) => {
    e.preventDefault();
    const name = editForm.name.trim();
    if (!name) {
      showNotification("Please enter your name.", "error");
      return;
    }

    setIsProfileSaving(true);
    try {
    const { data, error: profileError } = await supabase
      .from('user_profiles')
      .update({
        full_name: name,
        company: editForm.company,
        phone: editForm.phone,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentUser.id)
      .select('full_name, company, phone')
      .single();
    if (profileError) {
      showNotification("Failed to save profile details: " + profileError.message, "error");
      return;
    }

    setCurrentUser(prev => ({
      ...prev,
      name: data.full_name || prev.name,
      initial: (data.full_name || prev.name).charAt(0).toUpperCase(),
      company: data.company || prev.company,
      phone: data.phone || prev.phone
    }));
    const { error: metadataError } = await supabase.auth.updateUser({
      data: { full_name: name, company: editForm.company, phone: editForm.phone }
    });
    const changedFields = [
      name !== currentUser.name ? 'name' : null,
      editForm.company !== currentUser.company ? 'company' : null,
      editForm.phone !== currentUser.phone ? 'phone' : null
    ].filter(Boolean);

    setIsEditProfileOpen(false);
    let notificationErrorMessage = '';
    if (changedFields.length) {
      try {
        await sendProfileChangeNotice(changedFields);
      } catch (notificationError) {
        console.error('Profile notification error:', notificationError);
        notificationErrorMessage = 'Profile was saved, but its notification email could not be delivered.';
      }
    }

    const warnings = [];
    if (metadataError) warnings.push('Profile was saved, but sign-in metadata could not be refreshed.');
    if (notificationErrorMessage) warnings.push(notificationErrorMessage);
    showNotification(
      warnings.length ? warnings.join(' ') : 'Profile updated successfully.',
      warnings.length ? 'info' : 'success'
    );
    } catch (error) {
      console.error('Profile update failed:', error);
      showNotification(friendlyAuthError(error, 'Could not save your profile. Please try again.'), 'error');
    } finally {
      setIsProfileSaving(false);
    }
  };
  const sendRecoveryLink = async (rawEmail) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/forgot`
    });
    return { cleanEmail, error };
  };
  const handleForgotEmailSubmit = async (e) => {
    e.preventDefault();
    if (!emailRegex.test(forgotEmail.trim())) return setForgotErrors({ email: "Please enter a valid email address." });
    if (!supabase) return setForgotErrors({ email: "Authentication service is unavailable. Please try again later." });

    setForgotErrors({});
    if (!reserveAuthPageAttempt('passwordRecovery', forgotEmail, setForgotErrors, 'email')) return;
    setIsForgotLoading(true);

    try {
      const { cleanEmail, error } = await sendRecoveryLink(forgotEmail);
      if (error) {
        setForgotErrors({ email: friendlyAuthError(error, 'Could not send the reset link. Please try again.') });
      } else {
        setForgotEmail(cleanEmail);
        setForgotStep(2);
        setForgotCooldown(60);
        showNotification(`If an account exists for ${cleanEmail}, a password reset link has been sent.`, "info");
      }
    } catch (error) {
      setForgotErrors({ email: friendlyAuthError(error, 'Could not send the reset link. Check your connection and try again.') });
    } finally {
      setIsForgotLoading(false);
    }
  };
  const handleForgotResend = async () => {
    if (forgotCooldown > 0 || isForgotLoading || !supabase) return;
    setForgotErrors({});
    if (!reserveAuthPageAttempt('passwordRecovery', forgotEmail, setForgotErrors, 'email')) return;
    setIsForgotLoading(true);
    try {
      const { cleanEmail, error } = await sendRecoveryLink(forgotEmail);
      if (error) {
        setForgotErrors({ email: friendlyAuthError(error, 'Could not resend the reset link. Please try again.') });
      } else {
        setForgotCooldown(60);
        showNotification(`If an account exists for ${cleanEmail}, a new reset link has been sent.`, "info");
      }
    } catch (error) {
      setForgotErrors({ email: friendlyAuthError(error, 'Could not resend the reset link. Check your connection and try again.') });
    } finally {
      setIsForgotLoading(false);
    }
  };
  const handleForgotCancel = async () => {
    // Abandon a reset: drop the temporary recovery session so nobody is left signed in without a password.
    const hadRecoverySession = passwordRecoveryRef.current;
    endRecoveryLink();
    if (hadRecoverySession && supabase) {
      try { await supabase.auth.signOut(); } catch (error) { console.error('Could not clear the recovery session:', error); }
    }
    passwordRecoveryRef.current = false;
    setForgotStep(1);
    setForgotErrors({});
    setForgotNewPwd('');
    setForgotConfirmPwd('');
    setCurrentView('login');
    try { window.history.replaceState({ view: 'login' }, '', '/login'); } catch (e) {}
  };
  const handleForgotResetSubmit = async (e) => {
    e.preventDefault();
    let errors = {};
    if (!passwordRegex.test(forgotNewPwd)) errors.new = "Password must be at least 8 chars, with 1 letter, 1 number, and 1 symbol.";
    if (forgotNewPwd !== forgotConfirmPwd) errors.confirm = "Passwords do not match.";
    if (Object.keys(errors).length > 0) return setForgotErrors(errors);
    setForgotErrors({});
    if (!reserveAuthPageAttempt('passwordReset', forgotEmail || 'recovery', setForgotErrors, 'new')) return;
    setIsForgotLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        endRecoveryLink();
        passwordRecoveryRef.current = false;
        setForgotStep(1);
        setForgotErrors({ email: 'Your reset link has expired. Enter your email to get a new one.' });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: forgotNewPwd });
      if (error) {
        setForgotErrors({ new: friendlyAuthError(error, 'Could not reset your password. Please try again.') });
      } else {
        clearAuthAttempts('passwordReset', forgotEmail || 'recovery');
        clearAuthAttempts('passwordRecovery', forgotEmail);
        endRecoveryLink();
        localStorage.removeItem('nova_user');
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) console.error('Password reset completed but session sign-out failed:', signOutError);
        passwordRecoveryRef.current = false;
        setIsLoggedIn(false);
        setForgotNewPwd('');
        setForgotConfirmPwd('');
        setCurrentView('login');
        try { window.history.replaceState({ view: 'login' }, '', '/login'); } catch (e) {}
        setLoginPassword('');
        showNotification("Password reset successfully! Please sign in with your new password.", "success");
        setForgotStep(1);
      }
    } catch (error) {
      setForgotErrors({ new: friendlyAuthError(error, 'Could not reset your password. Please try again.') });
    } finally {
      setIsForgotLoading(false);
    }
  };
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser.id) return;
    showNotification("Uploading profile picture...", "info");
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}-${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', currentUser.id)
        .select('id')
        .single();
      if (profileError) throw profileError;
      setCurrentUser(prev => ({ ...prev, avatar: publicUrl, avatar_url: publicUrl }));
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });
      if (updateError) {
        console.error('Profile photo saved but Auth metadata sync failed:', updateError);
        showNotification('Profile picture was saved, but account metadata could not be synchronized.', 'error');
        return;
      }
      showNotification("Profile picture updated successfully.", "success");
    } catch (error) {
      console.error('Upload error:', error);
      showNotification("Error uploading picture: " + error.message, "error");
    }
  };

  const handleRequestAccess = async () => {
    setIsRequestingAccess(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Sign in again before requesting access.');
      const response = await fetch('/api/access-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Access request email could not be sent.');
      if (result.success || result.alreadyRequested) setHasRequestedAccess(true);
      showNotification(result.message || "Access request sent to Admin successfully!", "success");
    } catch (error) {
      console.error("Error sending access request:", error);
      showNotification(error.message || "Failed to send request. Please try again.", "error");
    } finally {
      setIsRequestingAccess(false);
    }
  };

  const handleJobSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser.id) return;
    const jobName = e.target.jobName.value;
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Sign in again before submitting an analysis job.');
      const response = await fetch('/api/bellow?action=submit-analysis-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          job: {
            user_id: currentUser.id,
            name: jobName,
            type: selectedJobType,
            status: 'Pending',
            price: selectedJobType === 'Nozzle Analysis' ? 300 : selectedJobType === 'Bellow Analysis' ? 300 : 150
          }
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The analysis job could not be submitted.');
      closeSubmitJob();
      showNotification(`${selectedJobType} submitted! Added to queue.`, 'success');
      fetchJobs();
    } catch (error) {
      console.error("Database Error:", error);
      showNotification(`Error submitting job: ${error.message}`, "error");
    }
  };
  const filteredJobs = jobFilter.startsWith('All')
    ? jobs
    : jobs.filter(j => {
      if (jobFilter === 'Bellow Analysis') return j.type.includes('Bellow');
      if (jobFilter === 'Nozzle Analysis') return j.type.includes('Nozzle');
      if (jobFilter === 'Flange Analysis') return j.type.includes('Flange');
      if (jobFilter === 'Saddle Analysis') return j.type.includes('Saddle');
      if (jobFilter === 'Local PWHT') return j.type.includes('PWHT');
      if (jobFilter === 'Hot Box Analysis') return j.type.includes('Hot Box');
      if (jobFilter === 'Vessel Stiffener Ring Analysis') return j.type.includes('Vessel Stiffener');
      if (jobFilter === 'Lifting Lug WRC Analysis') return j.type.includes('Lifting Lug WRC');
      if (jobFilter === 'Trunnion WRC Analysis') return j.type.includes('Trunnion WRC');
      if (jobFilter === '2D Axisymetric Tubesheet Analysis') return j.type.includes('2D Axisymetric Tubesheet');
      return j.type === jobFilter;
    });
  const handleDeleteJob = async (jobId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this analysis job?")) return;
    try {
      setIsDeletingJobs(true);
      const { error } = await supabase.from('ansys_jobs').delete().eq('id', jobId);
      if (error) throw error;
      setJobs(prev => prev.filter(j => j.id !== jobId));
      setSelectedJobIds(prev => prev.filter(id => id !== jobId));
      if (selectedJobDetails?.id === jobId) {
        closeJobDetails();
      }
      showNotification("Job deleted successfully.", "success");
    } catch (err) {
      console.error("Delete error:", err);
      showNotification("Failed to delete job: " + err.message, "error");
    } finally {
      setIsDeletingJobs(false);
    }
  };
  const handleDeleteSelectedJobs = async () => {
    if (selectedJobIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedJobIds.length} selected job(s)?`)) return;
    try {
      setIsDeletingJobs(true);
      const { error } = await supabase.from('ansys_jobs').delete().in('id', selectedJobIds);
      if (error) throw error;
      setJobs(prev => prev.filter(j => !selectedJobIds.includes(j.id)));
      if (selectedJobDetails && selectedJobIds.includes(selectedJobDetails.id)) {
        closeJobDetails();
      }
      showNotification(`${selectedJobIds.length} job(s) deleted successfully.`, "success");
      setSelectedJobIds([]);
      setIsJobSelectionMode(false);
    } catch (err) {
      console.error("Bulk delete error:", err);
      showNotification("Failed to delete selected jobs: " + err.message, "error");
    } finally {
      setIsDeletingJobs(false);
    }
  };
  const handleToggleSelectAll = () => {
    if (!filteredJobs || filteredJobs.length === 0) return;
    const allIds = filteredJobs.map(j => j.id);
    const isAllSelected = allIds.every(id => selectedJobIds.includes(id));
    if (isAllSelected) {
      setSelectedJobIds(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedJobIds(prev => Array.from(new Set([...prev, ...allIds])));
    }
  };
  const handleToggleSelectJob = (jobId, e) => {
    if (e) e.stopPropagation();
    setSelectedJobIds(prev =>
      prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]
    );
  };
  const startJobSelectionPress = (jobId, event) => {
    if (event.target.closest('button, a, input, select, textarea')) return;
    window.clearTimeout(jobSelectionPressTimer.current);
    jobSelectionPressTimer.current = window.setTimeout(() => {
      setIsJobSelectionMode(true);
      setSelectedJobIds(prev => prev.includes(jobId) ? prev : [...prev, jobId]);
      jobSelectionPressTimer.current = null;
    }, 550);
  };
  const endJobSelectionPress = () => {
    window.clearTimeout(jobSelectionPressTimer.current);
    jobSelectionPressTimer.current = null;
  };
  const stats = {
    total: filteredJobs.length,
    completed: filteredJobs.filter(j => j.status === 'Completed' || j.status === 'Success').length,
    processing: filteredJobs.filter(j => j.status && j.status !== 'Completed' && j.status !== 'Success' && j.status !== 'Pending' && j.status !== 'Failed').length,
    pending: filteredJobs.filter(j => j.status === 'Pending').length,
    failed: filteredJobs.filter(j => j.status === 'Failed').length,
  };
  const calculatePayments = () => {
    let subtotal = jobs.reduce((acc, job) => acc + Number(job.price), 0);
    return { unpaid: subtotal * 1.18, paid: 0, total: subtotal * 1.18 };
  };
  const paymentData = calculatePayments();
  const renderSplash = () => (
    <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0B1120] transition-all duration-700 ease-in-out ${isSplashExiting ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100 scale-100'}`}>
      <div className="absolute inset-0 overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-blue-600/30 rounded-full mix-blend-screen filter blur-[120px] animate-blob"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-emerald-600/30 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000"></div>
      </div>
      <style>{`
        .path-draw { stroke-dasharray: 220; stroke-dashoffset: 220; animation: draw 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .path-draw-delayed { stroke-dasharray: 220; stroke-dashoffset: 220; animation: draw 1.5s cubic-bezier(0.4, 0, 0.2, 1) 0.5s forwards; }
        .fill-fade { opacity: 0; animation: fadeFill 1.5s ease-in-out 1s forwards; }
        .star-pop { opacity: 0; transform: scale(0); transform-origin: center; animation: pop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) 1.6s forwards; }
        .text-reveal { opacity: 0; transform: translateY(20px); animation: textUp 1s ease-out 1.2s forwards; }
        .glass-panel-splash { opacity: 0; animation: glassFade 1s ease-out forwards; }
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes fadeFill { to { opacity: 0.8; } }
        @keyframes pop { to { opacity: 0.9; transform: scale(1); } }
        @keyframes textUp { to { opacity: 1; transform: translateY(0); } }
        @keyframes glassFade { to { opacity: 1; } }
        @keyframes loadProgress { 0% { width: 0%; left: 0%; } 50% { width: 100%; left: 0%; } 100% { width: 0%; left: 100%; } }
      `}</style>

      <div className="glass-panel-splash relative flex flex-col items-center justify-center p-6 md:p-12 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-[0_0_80px_rgba(60,100,214,0.3)]">
        <svg className="w-20 md:w-32 h-20 md:h-32 mb-6 drop-shadow-2xl" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="splashGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ec4899" /><stop offset="50%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="splashGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f43f5e" /><stop offset="50%" stopColor="#f97316" /><stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <filter id="splashGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <circle cx="50" cy="50" r="35" stroke="url(#splashGrad1)" strokeWidth="2" fill="none" className="path-draw" filter="url(#splashGlow)" />
          <path d="M50 15 A35 35 0 0 1 85 50 A35 35 0 0 0 50 15 Z" fill="url(#splashGrad2)" className="fill-fade" />
          <path d="M15 50 A35 35 0 0 0 50 85 A35 35 0 0 1 15 50 Z" fill="url(#splashGrad1)" className="fill-fade" />
          <circle cx="50" cy="50" r="20" fill="url(#splashGrad1)" filter="url(#splashGlow)" className="fill-fade" style={{ animationDuration: '2s', animationDelay: '1.5s' }} />
          <circle cx="50" cy="50" r="35" stroke="url(#splashGrad1)" strokeWidth="4" className="path-draw" fill="none" />
          <circle cx="50" cy="50" r="35" stroke="url(#splashGrad2)" strokeWidth="2" opacity="0.8" strokeDasharray="15 10 5 10" className="path-draw-delayed" fill="none" />
          <g className="star-pop">
            <circle cx="30" cy="30" r="2.5" fill="#fff" /><circle cx="40" cy="25" r="1.5" fill="#fff" /><circle cx="45" cy="35" r="1.5" fill="#fff" /><circle cx="70" cy="65" r="2" fill="#fff" /><circle cx="60" cy="75" r="1" fill="#fff" /><circle cx="50" cy="70" r="1.5" fill="#fff" /><circle cx="75" cy="35" r="2" fill="#fff" /><circle cx="25" cy="65" r="1.5" fill="#fff" />
          </g>
        </svg>
        <div className="flex flex-col items-center text-reveal">
          <h1 className="mb-2 text-xl md:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 drop-shadow-lg">NOVA</h1>
          <p className="text-sm font-medium tracking-widest uppercase text-slate-300">Initializing Platform</p>
        </div>

        <div className="w-32 md:w-48 h-1 mt-4 md:mt-8 overflow-hidden rounded-full text-reveal bg-white/10">
          <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 w-1/2 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full relative" style={{ animation: 'loadProgress 2s ease-out infinite' }}></div>
        </div>
      </div>
    </div>
  );
  const renderLanding = () => (
    <div className="relative min-h-screen pt-20 overflow-x-hidden font-sans text-slate-800 scroll-smooth">
      <section className="relative max-w-5xl px-4 md:px-6 pt-16 pb-20 mx-auto text-center">
        <div className="relative z-10 transition-all duration-700 ease-out translate-y-10 opacity-0 reveal">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-panel text-sm font-semibold text-slate-700 mb-4 md:mb-8">
            <Cpu className="w-4 h-4 text-[#3C64D6] animate-pulse" /> Advanced AI-Driven FEA Automation
          </div>

          <h1 className="text-6xl md:text-8xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-[#1E293B] to-[#3C64D6] tracking-tight mb-4 md:mb-8 drop-shadow-sm">NOVA</h1>

          <div className="flex flex-col items-center justify-center gap-4 mb-6 md:mb-12 sm:flex-row sm:gap-6">
            <div className="glass-panel px-4 md:px-6 py-4 rounded-xl flex items-center gap-3 w-full sm:w-auto hover:shadow-[0_8px_32px_rgba(60,100,214,0.2)] transition-shadow">
              <FileText className="w-6 h-6 text-blue-500" />
              <span className="text-lg font-bold text-slate-800">Input Parameters</span>
            </div>
            <ArrowRight className="w-8 h-8 text-[#3C64D6] hidden sm:block animate-[pulse_2s_ease-in-out_infinite]" />
            <div className="glass-panel px-4 md:px-6 py-4 rounded-xl flex items-center gap-3 w-full sm:w-auto hover:shadow-[0_8px_32px_rgba(16,163,74,0.2)] transition-shadow">
              <FileCheck className="w-6 h-6 text-emerald-500" />
              <span className="text-lg font-bold text-slate-800">FE Report</span>
            </div>
          </div>
          <h2 className="text-lg md:text-3xl font-bold text-[#3C64D6] mb-6">Automated FEA. Zero Manual Setup.</h2>
          <p className="max-w-2xl mx-auto mb-6 text-lg font-medium text-slate-700">Input your design specifications. Receive a fully code-compliant FEA stress report in record time directly from the cloud.</p>

          <div className="mb-6 md:mb-12 text-sm font-semibold text-slate-600">
            Eliminate the bottlenecks: <span className="font-normal text-slate-500">Manual Meshing | Tedious Modeling | Repetitive Iterations | Report Drafting</span>
          </div>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button onClick={handleRouteToAuth} data-conversion="landing_start_analysis" className="relative flex items-center justify-center gap-2 px-4 md:px-8 py-4 overflow-hidden font-bold text-white transition-all duration-300 rounded-full glass-btn-blue hover:scale-105 group">
              <Shield className="relative z-10 w-5 h-5" /> <span className="relative z-10">Start Analysis</span>
            </button>
            <button onClick={() => scrollToSection('how-it-works')} className="px-4 md:px-8 py-4 font-bold transition-colors border rounded-full shadow-sm bg-white/50 backdrop-blur-md border-white/50 hover:bg-white/80 text-slate-800">
              See How It Works ↓
            </button>
          </div>
        </div>
      </section>
      <section id="solution" className="relative z-10 px-4 md:px-6 py-6 md:py-24">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-400 rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-blob"></div>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-400 rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-emerald-400 rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-blob animation-delay-4000"></div>
        <div className="relative z-10 max-w-5xl mx-auto transition-all duration-700 ease-out translate-y-10 opacity-0 reveal">
          <div className="mb-16 text-center">
            <span className="bg-white/60 backdrop-blur-md border border-white/50 shadow-sm text-[#3C64D6] px-5 py-2 rounded-full text-xs font-bold tracking-widest uppercase">Solutions</span>
            <h2 className="text-3xl md:text-5xl font-extrabold text-[#1E293B] mt-6 drop-shadow-sm">Engineering Components</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:gap-8 md:grid-cols-2">
            <div className="glass-card glass-card-hover rounded-[2.5rem] p-10 flex flex-col h-full relative group">
              <div className="absolute top-0 right-0 w-40 h-40 transition-transform duration-700 rounded-bl-full bg-blue-400/20 filter blur-xl -z-10 group-hover:scale-125"></div>

              <div className="flex items-center self-start gap-1 px-3 py-1 mb-4 md:mb-8 text-xs font-bold border rounded-full shadow-sm bg-emerald-500/20 border-emerald-500/30 text-emerald-700 backdrop-blur-sm">
                <CheckCircle className="w-3 h-3" /> Available Now
              </div>

              <div className="glass-icon-container w-14 md:w-20 h-14 md:h-20 rounded-[1.25rem] flex items-center justify-center mb-6">
                <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="20" y="15" width="60" height="10" rx="5" fill="#3b82f6" opacity="0.9" />
                  <rect x="20" y="75" width="60" height="10" rx="5" fill="#3b82f6" opacity="0.9" />
                  <path d="M 30 25 C 10 35, 10 65, 30 75" stroke="#8b5cf6" strokeWidth="6" strokeLinecap="round" fill="rgba(139, 92, 246, 0.2)" />
                  <path d="M 50 25 C 30 35, 30 65, 50 75" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" fill="rgba(59, 130, 246, 0.2)" />
                  <path d="M 70 25 C 50 35, 50 65, 70 75" stroke="#0ea5e9" strokeWidth="6" strokeLinecap="round" fill="rgba(14, 165, 233, 0.2)" />
                  <path d="M 90 25 C 70 35, 70 65, 90 75" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" fill="none" />
                  <line x1="30" y1="25" x2="30" y2="75" stroke="white" strokeWidth="2" opacity="0.6" />
                  <line x1="50" y1="25" x2="50" y2="75" stroke="white" strokeWidth="2" opacity="0.6" />
                  <line x1="70" y1="25" x2="70" y2="75" stroke="white" strokeWidth="2" opacity="0.6" />
                </svg>
              </div>

              <h3 className="text-lg md:text-2xl font-bold text-[#1E293B] mb-2 drop-shadow-sm">Advanced Bellows FEA</h3>
              <p className="mb-4 md:mb-8 text-sm font-medium text-slate-600">Thick Convolute (Flanged & Flued)</p>

              <div className="space-y-4 mb-4 md:mb-8 flex-1 bg-white/40 border border-white/50 p-4 md:p-6 rounded-2xl shadow-[inset_0_2px_10px_rgba(255,255,255,0.7)] backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#3C64D6] shrink-0 drop-shadow-sm" />
                  <span className="text-sm font-semibold text-slate-700">Phase 1: Automated TEMA-based spring rate</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#3C64D6] shrink-0 drop-shadow-sm" />
                  <span className="text-sm font-semibold text-slate-700">Phase 2: Comprehensive FEA & validation</span>
                </div>
                <div className="pt-3 mt-2 text-sm font-bold border-t text-slate-800 border-white/60 drop-shadow-sm">Core Capabilities:</div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-600 drop-shadow-sm" /> <span className="text-sm text-slate-700">Corroded / Uncorroded state analysis</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-600 drop-shadow-sm" /> <span className="text-sm text-slate-700">Multi-condition upset loads</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-600 drop-shadow-sm" /> <span className="text-sm text-slate-700">Strict ASME compliance verification</span>
                </div>
              </div>
              <button onClick={handleRouteToAuth} className="glass-btn w-full text-black py-4 rounded-2xl font-bold transition-all hover:scale-[1.02] flex items-center justify-center gap-2 shadow-lg">
                Launch Bellow Analysis <ArrowRight className="w-5 h-5" />
              </button>
            </div>
            <div className="glass-card glass-card-hover rounded-[2.5rem] p-10 flex flex-col h-full relative group opacity-95">
              <div className="absolute top-0 right-0 w-40 h-40 transition-transform duration-700 rounded-bl-full bg-amber-400/20 filter blur-xl -z-10 group-hover:scale-125"></div>

              <div className="flex items-center self-start gap-1 px-3 py-1 mb-4 md:mb-8 text-xs font-bold border rounded-full shadow-sm bg-amber-500/20 border-amber-500/30 text-amber-700 backdrop-blur-sm">
                <Clock className="w-3 h-3" /> In Development
              </div>

              <div className="glass-icon-container w-14 md:w-20 h-14 md:h-20 rounded-[1.25rem] flex items-center justify-center mb-6 opacity-80 mix-blend-luminosity">
                <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M 10 80 Q 50 100, 90 80" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" fill="none" />
                  <path d="M 10 90 Q 50 110, 90 90" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" opacity="0.5" fill="none" />
                  <rect x="35" y="20" width="30" height="50" fill="#ef4444" opacity="0.3" rx="4" />
                  <path d="M 35 20 L 35 68" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" />
                  <path d="M 65 20 L 65 68" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" />
                  <rect x="25" y="10" width="50" height="10" rx="3" fill="#f59e0b" />
                  <rect x="30" y="5" width="40" height="5" rx="2" fill="#ef4444" opacity="0.8" />
                  <line x1="40" y1="20" x2="40" y2="65" stroke="white" strokeWidth="3" opacity="0.8" strokeLinecap="round" />
                </svg>
              </div>

              <h3 className="mb-2 text-lg md:text-2xl font-bold text-slate-700 drop-shadow-sm">Nozzle Junction Stress Analysis</h3>
              <p className="mb-4 md:mb-8 text-sm font-medium text-slate-500">Local Load Analysis for Vessels</p>

              <div className="flex-1 p-4 md:p-6 mb-4 md:mb-8 space-y-4 border bg-white/20 border-white/30 rounded-2xl">
                <div className="flex items-start gap-3 opacity-80">
                  <svg className="w-5 h-5 text-amber-600 shrink-0 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span className="text-sm font-semibold text-slate-700">High-fidelity local stress evaluation</span>
                </div>
                <div className="flex items-start gap-3 opacity-80">
                  <svg className="w-5 h-5 text-amber-600 shrink-0 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span className="text-sm font-semibold text-slate-700">Automated structural integrity checks</span>
                </div>
                <div className="flex items-start gap-3 opacity-80">
                  <svg className="w-5 h-5 text-amber-600 shrink-0 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span className="text-sm font-semibold text-slate-700">Compliant with ASME Section VIII, Div 2 Part 5</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section id="why-nova" className="py-6 md:py-24 bg-white/40 backdrop-blur-md px-4 md:px-6 border-y border-white/60 shadow-[0_8px_32px_rgba(31,38,135,0.05)]">
        <div className="max-w-5xl mx-auto transition-all duration-700 ease-out translate-y-10 opacity-0 reveal">
          <div className="mb-16 text-center">
            <span className="px-5 py-2 text-xs font-bold tracking-widest uppercase rounded-full glass-panel text-slate-700">About</span>
            <h2 className="text-2xl md:text-4xl font-extrabold text-[#1E293B] mt-6 drop-shadow-sm">What is NOVA?</h2>
          </div>
          <div className="grid items-center grid-cols-1 gap-16 md:grid-cols-2">
            <div className="space-y-6">
              <div className="flex items-center gap-5 group">
                <div className="flex items-center justify-center text-lg md:text-2xl font-bold text-white transition-transform shadow-md w-14 h-14 glass-btn-blue rounded-2xl group-hover:scale-110">N</div>
                <div className="text-xl font-extrabold tracking-wide text-slate-700 drop-shadow-sm">Numerical</div>
              </div>
              <div className="flex items-center gap-5 group">
                <div className="flex items-center justify-center text-lg md:text-2xl font-bold text-white transition-transform shadow-md w-14 h-14 glass-btn-blue rounded-2xl group-hover:scale-110">O</div>
                <div className="text-xl font-extrabold tracking-wide text-slate-700 drop-shadow-sm">Optimization &</div>
              </div>
              <div className="flex items-center gap-5 group">
                <div className="flex items-center justify-center text-lg md:text-2xl font-bold text-white transition-transform shadow-md w-14 h-14 glass-btn-blue rounded-2xl group-hover:scale-110">V</div>
                <div className="text-xl font-extrabold tracking-wide text-slate-700 drop-shadow-sm">Virtual</div>
              </div>
              <div className="flex items-center gap-5 group">
                <div className="flex items-center justify-center text-lg md:text-2xl font-bold text-white transition-transform shadow-md w-14 h-14 glass-btn-blue rounded-2xl group-hover:scale-110">A</div>
                <div className="text-xl font-extrabold tracking-wide text-slate-700 drop-shadow-sm">Analysis</div>
              </div>
            </div>
            <div className="glass-panel p-10 rounded-[2rem] shadow-[0_8px_32px_rgba(31,38,135,0.1)]">
              <p className="mb-6 text-lg font-medium leading-relaxed text-slate-700">
                NOVA (Numerical Optimization & Virtual Analysis) is an advanced cloud-based engineering platform designed to democratize Finite Element Analysis (FEA). We bridge the gap between complex <strong className="text-emerald-700">ASME BPVC code requirements</strong> and streamlined, automated execution.
              </p>
              <p className="text-lg font-medium leading-relaxed text-slate-700">
                By integrating <strong className="text-[#3C64D6]">AI-driven data extraction</strong> with industry-standard solvers like ANSYS, NOVA eliminates manual modeling, reducing design validation from weeks to hours.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section id="how-it-works" className="relative z-10 px-4 md:px-6 py-6 md:py-24">
        <div className="max-w-6xl mx-auto text-center transition-all duration-700 ease-out translate-y-10 opacity-0 reveal">
          <span className="px-5 py-2 text-xs font-bold tracking-widest uppercase rounded-full glass-panel text-slate-700">Methodology</span>
          <h2 className="text-2xl md:text-4xl font-extrabold text-[#1E293B] mt-6 mb-4 drop-shadow-sm">How NOVA Works</h2>
          <p className="mb-20 text-lg font-medium text-slate-600">A streamlined 6-step workflow that transforms your engineering data into a compliant FE report</p>
          <div className="relative flex flex-col items-center justify-between gap-4 md:gap-8 md:flex-row md:items-start md:gap-4">
            <div className="hidden md:block absolute top-[2.5rem] left-0 w-full h-0.5 bg-gradient-to-r from-blue-300/50 via-purple-300/50 to-emerald-300/50 z-0"></div>
            {[
              { icon: UploadCloud, title: "Data Ingestion", desc: "Upload PV Elite or structural parameters" },
              { icon: Cpu, title: "Intelligent Parsing", desc: "AI extracts geometry, materials, and loads" },
              { icon: Box, title: "Automated Meshing", desc: "Smart algorithmic grid generation" },
              { icon: GitMerge, title: "Cloud Solving", desc: "ANSYS backend computes stresses" },
              { icon: Award, title: "Code Validation", desc: "ASME Sec VIII Div 2 Part 5 checks" },
              { icon: Download, title: "Final Report", desc: "Download Report, audit-ready PDF" }
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="relative z-10 flex flex-col items-center max-w-[150px] group">
                  <div className="relative flex items-center justify-center w-14 md:w-20 h-14 md:h-20 mb-6 transition-all duration-300 shadow-md glass-panel group-hover:bg-white/60 rounded-2xl group-hover:-translate-y-2">
                    <Icon className="w-8 h-8 text-[#1E293B] group-hover:text-[#3C64D6] transition-colors drop-shadow-sm" />
                  </div>
                  <h4 className="font-extrabold text-slate-800 mb-2 group-hover:text-[#3C64D6] transition-colors text-center drop-shadow-sm">{item.title}</h4>
                  <p className="text-xs font-medium leading-relaxed text-center text-slate-600">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="relative z-10 px-4 md:px-6 py-6 md:py-24 text-center transition-all duration-700 ease-out translate-y-10 opacity-0 reveal">
        <div className="glass-panel max-w-4xl mx-auto rounded-[3rem] p-16 relative overflow-hidden shadow-[0_20px_60px_rgba(60,100,214,0.15)]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full filter blur-[80px] -z-10"></div>
          <h2 className="text-3xl md:text-5xl font-extrabold text-[#1E293B] mb-6 relative z-10">Start Your Analysis Today</h2>
          <p className="relative z-10 mb-10 text-lg font-medium text-slate-600">From Days to Hours. Code-Compliant. Fully Automated.</p>
          <button onClick={handleRouteToAuth} className="relative z-10 flex items-center justify-center gap-3 px-10 py-5 mx-auto text-lg font-bold transition-all rounded-full glass-btn-blue hover:scale-105">
            Access Dashboard <ArrowRight className="w-6 h-6" />
          </button>
        </div>
      </section>
      <footer className="glass-panel text-slate-600 py-6 md:py-12 px-4 md:px-6 relative z-10 mt-6 md:mt-12 border-b-0 rounded-t-[3rem] shadow-[0_-8px_32px_rgba(31,38,135,0.05)]">
        <div className="grid max-w-6xl grid-cols-1 gap-4 md:gap-8 pb-8 mx-auto mb-4 md:mb-8 border-b md:grid-cols-3 border-slate-300/50">
          <div>
            <h3 className="font-bold text-[#1E293B] text-xl mb-4 flex items-center gap-2 cursor-pointer hover:text-[#3C64D6] transition-colors" onClick={handleLogoClick}>
              <CosmicLogo className="w-8 h-8" /> NOVA
            </h3>
            <p className="text-sm font-medium">Numerical Optimization & Virtual Analysis Platform</p>
          </div>
          <div>
            <h4 className="font-bold text-[#1E293B] mb-4">Navigation</h4>
            <ul className="space-y-2 text-sm font-medium">
              <li><button onClick={() => scrollToSection('why-nova')} className="hover:text-[#3C64D6] transition-colors">About NOVA</button></li>
              <li><button onClick={() => scrollToSection('how-it-works')} className="hover:text-[#3C64D6] transition-colors">Methodology</button></li>
              <li><button onClick={() => scrollToSection('solution')} className="hover:text-[#3C64D6] transition-colors">Engineering Solutions</button></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-[#1E293B] mb-4">Support & Contact</h4>
            <a href="mailto:analysis.ai.nova@gmail.com" className="text-sm font-medium flex items-center gap-2 mb-2 hover:text-[#3C64D6] transition-colors group">
              <Mail className="w-4 h-4 group-hover:text-[#3C64D6] transition-colors" /> analysis.ai.nova@gmail.com
            </a>
            <a href="/contact" className="text-sm font-semibold text-[#3C64D6] hover:text-[#1E40AF]">
              Send a message
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between max-w-6xl mx-auto text-sm font-medium">
          <p>© 2026 NOVA Intelligence. All Rights Reserved.</p>
          <button onClick={() => window.scrollTo(0, 0)} className="flex items-center justify-center p-3 text-white transition-transform border-none rounded-full shadow-md glass-btn-blue hover:scale-110">
            <ChevronDown className="w-5 h-5 rotate-180" />
          </button>
        </div>
      </footer>
      <a
        href="https://wa.me/918757014303?text=Hi%20NOVA-CORE,%20I%20need%20help%20with%20an%20analysis."
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center p-4 rounded-full shadow-[0_8px_32px_0_rgba(31,38,135,0.37)] backdrop-blur-md bg-white/20 border border-white/30 hover:bg-white/30 hover:scale-110 transition-all duration-300 cursor-pointer"
      >
        <svg viewBox="0 0 24 24" width="32" height="32" className="text-[#25D366] drop-shadow-lg" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      </a>
    </div>
  );
  const renderAuthContainer = (children, pageClass = '') => (
    <div className={`auth-page mobile-auth-page relative z-10 flex flex-col items-center justify-center min-h-screen p-4 pt-20 ${pageClass}`}>
      <button
        type="button"
        onClick={() => setCurrentView('mobile_landing')}
        aria-label="Go to NOVA home"
        className="auth-home-link absolute top-6 left-6 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full text-slate-700 hover:text-[#2874f0] flex items-center gap-2 font-semibold transition-colors shadow-sm border border-white/60"
      >
        <Home className="w-4 h-4" aria-hidden="true" /> Home
      </button>

      <div className="auth-card mobile-auth-card max-w-md w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-[0_8px_40px_rgba(40,116,240,0.12)] p-8 md:p-10 relative overflow-hidden border border-blue-100">
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-blue-200/40 rounded-full filter blur-[40px]"></div>
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-teal-200/40 rounded-full filter blur-[40px]"></div>

        <div className="relative z-10 mb-6 md:mb-8 space-y-2 text-center">
          <div className="flex justify-center mb-4 cursor-pointer" onClick={handleLogoClick}>
            <CosmicLogo className="w-14 md:w-20 h-14 md:h-20 transition-transform duration-500 hover:scale-110 drop-shadow-md" />
          </div>
          <h1 className="text-xl md:text-3xl font-extrabold text-[#1e293b] tracking-tight">NOVA 1.0</h1>
          <p className="auth-category text-sm font-semibold tracking-wider uppercase text-[#2874f0]">Authentication</p>
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
  const renderLogin = () => renderAuthContainer(
    <>
      <h2 className="mb-6 text-xl font-bold text-center text-[#1e293b]">Secure Sign In</h2>
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isAuthLoading}
        className="mb-5 flex w-full items-center justify-center gap-4 rounded-full border border-[#393a3f] bg-[#131314] px-5 py-3.5 text-sm font-medium text-[#e8eaed] transition-colors hover:bg-[#1c1d20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isAuthLoading
          ? <Loader2 className="h-5 w-5 animate-spin" />
          : <img src="/signin-assets/google-color.svg" alt="" aria-hidden="true" className="h-5 w-5" />}
        <span>{isAuthLoading ? 'Connecting to Google…' : 'Sign in with Google'}</span>
      </button>
      <div className="mb-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="h-px flex-1 bg-slate-200" />
        <span>Or continue with email</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <form onSubmit={handleLogin} className="space-y-5">
        <div className="space-y-1.5">
          <label className="pl-1 text-sm font-bold text-slate-700">Email Address</label>
          <input type="email" value={loginEmail} onChange={(e) => { setLoginEmail(e.target.value); setAuthErrors({ ...authErrors, email: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium ${authErrors.email ? '!border-red-500' : ''}`} required />
          {authErrors.email && <p className="pl-1 text-xs font-bold text-red-500 animate-in fade-in">{authErrors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between pl-1 pr-1">
            <label className="text-sm font-bold text-slate-700">Password</label>
            <button type="button" onClick={() => { setCurrentView('forgot'); setForgotStep(1); setForgotEmail(loginEmail); setForgotCooldown(0); setForgotNewPwd(''); setForgotConfirmPwd(''); setForgotErrors({}); }} className="text-xs text-[#3C64D6] font-bold hover:underline focus:outline-none">Forgot password?</button>
          </div>
          <div className="relative">
            <input type={showLoginPwd ? "text" : "password"} value={loginPassword} onChange={(e) => { setLoginPassword(e.target.value); setAuthErrors({ ...authErrors, password: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium pr-12 ${authErrors.password ? '!border-red-500' : ''}`} required />
            <button type="button" onClick={() => setShowLoginPwd(!showLoginPwd)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#3C64D6] transition-colors">
              {showLoginPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {authErrors.password && <p className="pl-1 text-xs font-bold text-red-500 animate-in fade-in">{authErrors.password}</p>}
        </div>
        <button type="submit" disabled={isAuthLoading} className="w-full nova-btn-primary py-4 rounded-xl font-bold transition-all hover:scale-[1.02] mt-6 flex justify-center items-center gap-2 text-lg shadow-lg">
          {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign In <ArrowRight className="w-5 h-5" /></>}
        </button>
      </form>
      <div className="login-signup-prompt mt-4 md:mt-8 text-sm font-medium text-center text-slate-600">
        Don't have an account? <button onClick={() => setCurrentView('signup')} className="text-[#2874f0] font-bold hover:underline ml-1">Sign up here</button>
      </div>
    </>,
    'login-auth-page'
  );
  const renderSignup = () => renderAuthContainer(
    <>
      <h2 className="mb-6 text-xl font-bold text-center text-[#1e293b]">Create New Account</h2>
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isAuthLoading}
        className="mb-5 flex w-full items-center justify-center gap-4 rounded-full border border-[#393a3f] bg-[#131314] px-5 py-3.5 text-sm font-medium text-[#e8eaed] transition-colors hover:bg-[#1c1d20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isAuthLoading
          ? <Loader2 className="h-5 w-5 animate-spin" />
          : <img src="/signin-assets/google-color.svg" alt="" aria-hidden="true" className="h-5 w-5" />}
        <span>{isAuthLoading ? 'Connecting to Google…' : 'Sign in with Google'}</span>
      </button>
      <div className="mb-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="h-px flex-1 bg-slate-200" />
        <span>Or create an account with email</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <form onSubmit={handleSignup} className="space-y-5">
        <div className="space-y-1.5">
          <label className="pl-1 text-sm font-bold text-slate-700">Full Name</label>
          <input type="text" value={signupName} onChange={(e) => { setSignupName(e.target.value); setAuthErrors({ ...authErrors, name: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium ${authErrors.name ? '!border-red-500' : ''}`} required />
          {authErrors.name && <p className="pl-1 text-xs font-bold text-red-500">{authErrors.name}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="pl-1 text-sm font-bold text-slate-700">Email Address</label>
          <input type="email" value={signupEmail} onChange={(e) => { setSignupEmail(e.target.value); setAuthErrors({ ...authErrors, email: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium ${authErrors.email ? '!border-red-500' : ''}`} required />
          {authErrors.email && <p className="pl-1 text-xs font-bold text-red-500">{authErrors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="pl-1 text-sm font-bold text-slate-700">Password</label>
          <div className="relative">
            <input type={showSignupPwd ? "text" : "password"} value={signupPassword} onChange={(e) => { setSignupPassword(e.target.value); setAuthErrors({ ...authErrors, password: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium pr-12 ${authErrors.password ? '!border-red-500' : ''}`} required />
            <button type="button" onClick={() => setShowSignupPwd(!showSignupPwd)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#3C64D6] transition-colors">
              {showSignupPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {authErrors.password && <p className="pl-1 text-xs font-bold leading-tight text-red-500">{authErrors.password}</p>}
        </div>
        <button type="submit" disabled={isAuthLoading} className="w-full nova-btn-primary py-4 rounded-xl font-bold transition-all hover:scale-[1.02] mt-6 text-lg shadow-lg flex justify-center items-center gap-2">
          {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create Account"}
        </button>
      </form>
      <div className="mt-4 md:mt-8 text-sm font-medium text-center text-slate-600">
        Already have an account? <button onClick={() => setCurrentView('login')} className="text-[#2874f0] font-bold hover:underline ml-1">Sign in</button>
      </div>
    </>
  );
  const renderForgotPassword = () => renderAuthContainer(
    <>
      <h2 className="mb-2 text-xl font-bold text-center text-[#1e293b]">
        {forgotStep === 1 ? "Reset Password" : forgotStep === 2 ? "Check Your Email" : "Create New Password"}
      </h2>
      <p className="px-2 mb-6 text-sm font-medium text-center text-slate-600">
        {forgotStep === 1 && "Enter the email linked to your account and we'll send you a secure link to reset your password."}
        {forgotStep === 2 && "We've sent a password reset link to your inbox."}
        {forgotStep === 3 && "Your email is verified. Choose a new password for your account."}
      </p>
      {forgotStep === 1 && (
        <form onSubmit={handleForgotEmailSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="pl-1 text-xs font-bold tracking-wider uppercase text-slate-500">Email Address</label>
            <input type="email" autoComplete="email" value={forgotEmail} onChange={(e) => { setForgotEmail(e.target.value); setForgotErrors({ ...forgotErrors, email: null }); }} className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium ${forgotErrors.email ? '!border-red-500' : ''}`} required />
            {forgotErrors.email && <p className="pl-1 text-xs font-bold text-red-500">{forgotErrors.email}</p>}
          </div>
          <button type="submit" disabled={isForgotLoading} className="w-full nova-btn-primary disabled:opacity-70 py-4 rounded-xl font-bold transition-all hover:scale-[1.02] flex justify-center items-center gap-2 mt-4 shadow-lg">
            {isForgotLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Mail className="w-5 h-5" /> Send Reset Link</>}
          </button>
        </form>
      )}
      {forgotStep === 2 && (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
            <Mail className="w-8 h-8 text-emerald-600" />
          </div>
          <p className="text-sm font-medium text-slate-600 leading-relaxed">
            If an account exists for <strong className="text-slate-900 break-all">{forgotEmail}</strong>, you'll receive an email with a link to reset your password. Open the email and tap <strong>Reset Password</strong> to continue.
          </p>
          <p className="text-xs font-medium text-slate-500">Can't find it? Check your spam or promotions folder. The link can only be used once and expires after a short time.</p>
          {forgotErrors.email && <p className="text-xs font-bold text-red-500">{forgotErrors.email}</p>}
          <button type="button" onClick={handleForgotResend} disabled={isForgotLoading || forgotCooldown > 0} className="w-full nova-btn-primary disabled:opacity-60 disabled:cursor-not-allowed py-3.5 rounded-xl font-bold transition-all flex justify-center items-center gap-2 shadow-lg">
            {isForgotLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : forgotCooldown > 0 ? `Resend email in ${forgotCooldown}s` : 'Resend email'}
          </button>
          <button type="button" onClick={() => { setForgotStep(1); setForgotErrors({}); setForgotCooldown(0); }} className="text-sm font-bold text-[#3C64D6] hover:underline">Use a different email</button>
        </div>
      )}
      {forgotStep === 3 && (
        <form onSubmit={handleForgotResetSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="pl-1 text-sm font-bold text-slate-700">New Password</label>
            <div className="relative">
              <input type={showForgotPwd.new ? "text" : "password"} value={forgotNewPwd} onChange={(e) => { setForgotNewPwd(e.target.value); setForgotErrors({ ...forgotErrors, new: null }); }} required className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium pr-12 ${forgotErrors.new ? '!border-red-500' : ''}`} />
              <button type="button" onClick={() => setShowForgotPwd({ ...showForgotPwd, new: !showForgotPwd.new })} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#3C64D6] transition-colors">
                {showForgotPwd.new ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {forgotErrors.new && <p className="pl-1 text-xs font-bold leading-tight text-red-500">{forgotErrors.new}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="pl-1 text-sm font-bold text-slate-700">Confirm Password</label>
            <div className="relative">
              <input type={showForgotPwd.confirm ? "text" : "password"} value={forgotConfirmPwd} onChange={(e) => { setForgotConfirmPwd(e.target.value); setForgotErrors({ ...forgotErrors, confirm: null }); }} required className={`w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium pr-12 ${forgotErrors.confirm ? '!border-red-500' : ''}`} />
              <button type="button" onClick={() => setShowForgotPwd({ ...showForgotPwd, confirm: !showForgotPwd.confirm })} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#3C64D6] transition-colors">
                {showForgotPwd.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {forgotErrors.confirm && <p className="pl-1 text-xs font-bold text-red-500">{forgotErrors.confirm}</p>}
          </div>
          <button type="submit" disabled={isForgotLoading} className="w-full nova-btn-primary disabled:opacity-70 py-4 rounded-xl font-bold transition-all hover:scale-[1.02] flex justify-center items-center gap-2 mt-4 shadow-lg">
            {isForgotLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save New Password"}
          </button>
          <button type="button" onClick={handleForgotCancel} disabled={isForgotLoading} className="w-full py-2 text-sm font-bold text-slate-500 hover:text-[#3C64D6] transition-colors">Cancel and go back to sign in</button>
        </form>
      )}
      {forgotStep !== 3 && (
        <div className="mt-4 md:mt-8 text-sm font-medium text-center text-slate-600">
          Remember your password? <button onClick={() => { endRecoveryLink(); setCurrentView('login'); }} className="text-[#2874f0] font-bold hover:underline ml-1">Sign in</button>
        </div>
      )}
    </>
  );
  const renderInsightsModal = () => (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" onClick={() => closeJobInsights()}></div>
      <div className="glass-panel w-full max-w-2xl rounded-[2.5rem] overflow-hidden relative z-10 border-t border-l border-white/80 shadow-[0_25px_70px_rgba(0,0,0,0.35)] animate-in zoom-in-95">
        <div className="flex items-center justify-between p-4 md:p-6 text-white border-b bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 backdrop-blur-md border-white/20">
          <h3 className="flex items-center gap-3 text-xl font-black drop-shadow-sm">
            <Sparkles className="w-6 h-6 text-amber-300" /> Executive AI Insights
          </h3>
          <button
            onClick={() => closeJobInsights()}
            className="p-2 rounded-full bg-white/20 hover:bg-rose-600 hover:text-white transition-all text-white border border-white/30 cursor-pointer shadow-md"
            title="Close AI Insights"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>
        <div className="p-4 md:p-8 space-y-6">
          <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="mb-1 text-xs font-black tracking-widest uppercase text-slate-500">Project / Job</h4>
              <p className="text-lg md:text-2xl font-black text-slate-900">{selectedInsightJob?.name || selectedInsightJob?.job_id_display || selectedInsightJob?.id}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-black text-blue-800 bg-blue-100 rounded-full border border-blue-200">
              <Box className="w-3.5 h-3.5 text-blue-600" /> {selectedInsightJob?.type || 'FEA Simulation'}
            </span>
          </div>
          <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-2xl p-4 md:p-6 shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)] min-h-[200px]">
            {isInsightLoading ? (
              <div className="flex flex-col items-center justify-center h-full py-8 space-y-4 text-purple-600">
                <Loader2 className="w-10 h-10 animate-spin" />
                <p className="text-sm font-black animate-pulse">Analyzing FEA Results & Stress Metrics...</p>
              </div>
            ) : (
              <div className="text-sm font-semibold leading-relaxed whitespace-pre-wrap text-slate-800">
                {insightResponse}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-4 md:mt-8">
            <button
              onClick={() => closeJobInsights()}
              className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-black text-sm shadow-md hover:scale-105 transition-all cursor-pointer flex items-center gap-2"
            >
              <X className="w-4 h-4" /> Close Insights
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  const downloadJobJson = (job) => {
    if (!job) return;
    let payload = job.json_payload || job.geometry_data?.runs || job.geometry_data || [];
    if (typeof payload === 'string') {
      payload = JSON.parse(payload);
    }
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const downloadAnchor = document.createElement('a');
    const filename = String(job.input_file_name || 'analysis.json').replace(/[^a-zA-Z0-9._-]/g, '_');
    downloadAnchor.href = blobUrl;
    downloadAnchor.download = filename;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };
  // ─── NOVA Receipt PDF (Image-1 style: clean simple receipt) ────────────────
  const generateReceiptPDF = (inv) => {
    if (!inv) return;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const mg = 18;
      let y = mg;

      // Header brand
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, W, 22, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text('NOVA AI', mg, 14);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 200, 150);
      doc.text('nova-analysis.vercel.app', W - mg, 14, { align: 'right' });
      y = 34;

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.text('Receipt', mg, y);
      y += 10;

      // Meta info block
      const metaData = [
        ['Invoice number', inv.invoiceId || 'INV-2026-000001'],
        ['Receipt number', (inv.receiptNo || ('RCP-' + Date.now().toString().slice(-6)))],
        ['Date paid', inv.date || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })],
        ['Payment method', 'Razorpay (UPI / Cards / NetBanking)'],
      ];
      doc.setFontSize(9);
      metaData.forEach(([label, val]) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(label, mg, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(val, 60, y);
        y += 5.5;
      });
      y += 6;

      // Divider
      doc.setDrawColor(226, 232, 240);
      doc.line(mg, y, W - mg, y);
      y += 6;

      // Seller & Buyer grid
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text('Nova AI Technologies', mg, y);
      doc.text('Bill to', W / 2 + 2, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const sellerLines = [
        'Nova AI, Surat, Gujarat 395003, India',
        'GSTIN: 07AABCN1234F1Z5',
        'HSN / SAC: 998313',
        'analysis.ai.nova@gmail.com',
      ];
      const buyerLines = [
        inv.customerName || currentUser?.name || 'Valued Engineer',
        inv.customerEmail || currentUser?.email || '',
        inv.customerPhone || currentUser?.phone || '',
        inv.company || '',
      ].filter(Boolean);
      const maxRows = Math.max(sellerLines.length, buyerLines.length);
      for (let i = 0; i < maxRows; i++) {
        if (sellerLines[i]) doc.text(sellerLines[i], mg, y);
        if (buyerLines[i]) doc.text(buyerLines[i], W / 2 + 2, y);
        y += 5;
      }
      y += 8;

      // Amount hero
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42);
      doc.text(inv.priceFormatted + ' paid on ' + (inv.date || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })), mg, y);
      y += 12;

      // Items table
      const planDisplay = inv.isWizard ? inv.productName : (inv.productName && inv.productName.includes('Max') ? 'Nova Max' : inv.productName && inv.productName.includes('Pro') ? 'Nova Pro' : 'Nova Basic');
      const termStr = inv.term || 'Monthly Subscription';
      autoTable(doc, {
        startY: y,
        margin: { left: mg, right: mg },
        head: [['Description', 'Qty', 'Unit price', 'Amount']],
        body: [
          [planDisplay + '\n' + termStr, '1', inv.priceFormatted, inv.priceFormatted],
        ],
        foot: [
          [{ content: 'Subtotal', colSpan: 3, styles: { halign: 'right', fontStyle: 'normal' } }, inv.priceFormatted],
          [{ content: 'Total', colSpan: 3, styles: { halign: 'right', fontStyle: 'normal' } }, inv.priceFormatted],
          [{ content: 'Amount paid', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } }, inv.priceFormatted],
        ],
        headStyles: { fillColor: [248, 250, 252], textColor: [71, 85, 105], fontStyle: 'normal', fontSize: 8, lineColor: [226, 232, 240], lineWidth: 0.2 },
        bodyStyles: { textColor: [15, 23, 42], fontSize: 9 },
        footStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontSize: 9, lineColor: [226, 232, 240], lineWidth: 0.2 },
        columnStyles: { 0: { cellWidth: 90 }, 1: { halign: 'center', cellWidth: 15 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        styles: { lineColor: [226, 232, 240], lineWidth: 0.2 },
        didParseCell: (data) => {
          if (data.section === 'foot' && data.row.index === 2) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });
      const finalY = doc.lastAutoTable.finalY + 8;

      // Footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text((inv.receiptNo || 'RCP-NOVA') + ' · ' + inv.priceFormatted + ' paid on ' + (inv.date || ''), mg, H - 10);
      doc.text('Page 1 of 1', W - mg, H - 10, { align: 'right' });

      doc.save('NOVA_Receipt_' + (inv.invoiceId || Date.now()) + '.pdf');
      showNotification('Receipt PDF downloaded!', 'success', 'Receipt Downloaded');
    } catch (err) {
      console.error('Receipt PDF error:', err);
      showNotification('Failed to generate receipt PDF.', 'error', 'PDF Error');
    }
  };

  // ─── NOVA Invoice PDF (Image-2 style: formal GST invoice) ──────────────────
  const generateInvoicePDF = (inv) => {
    if (!inv) return;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const mg = 18;
      let y = mg;

      // Header
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, W, 22, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text('NOVA AI', mg, 14);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 200, 150);
      doc.text('nova-analysis.vercel.app', W - mg, 14, { align: 'right' });
      y = 34;

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.text('Tax Invoice', mg, y);
      y += 10;

      // Meta grid
      const issueDate = inv.date || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      const metaData = [
        ['Invoice number', inv.invoiceId || 'INV-2026-000001'],
        ['Date of issue', issueDate],
        ['Date due', issueDate],
      ];
      doc.setFontSize(9);
      metaData.forEach(([label, val]) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(label, mg, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(val, 60, y);
        y += 5.5;
      });
      y += 6;

      // Divider
      doc.setDrawColor(226, 232, 240);
      doc.line(mg, y, W - mg, y);
      y += 6;

      // Seller and Buyer
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(37, 99, 235);
      doc.text('Nova AI Technologies', mg, y);
      doc.setTextColor(37, 99, 235);
      doc.text('Bill to', W / 2 + 2, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const sellerLines = [
        'Nova AI, Surat, Gujarat 395003, India',
        'GSTIN: 07AABCN1234F1Z5',
        'CIN: U72900DL2024PTC123456',
        'HSN / SAC Code: 998313',
        'analysis.ai.nova@gmail.com',
        'nova-analysis.vercel.app',
      ];
      const buyerLines = [
        inv.customerName || currentUser?.name || 'Valued Engineer',
        inv.customerEmail || currentUser?.email || '',
        inv.customerPhone || currentUser?.phone || '',
        inv.company || '',
        'India',
      ].filter(Boolean);
      const maxRows2 = Math.max(sellerLines.length, buyerLines.length);
      for (let i = 0; i < maxRows2; i++) {
        if (sellerLines[i]) doc.text(sellerLines[i], mg, y);
        if (buyerLines[i]) doc.text(buyerLines[i], W / 2 + 2, y);
        y += 5;
      }
      y += 8;

      // Amount hero
      const baseAmt = inv.baseAmount || Math.round(inv.amountInINR / 1.18);
      const cgst = inv.cgst || Math.round((inv.amountInINR - baseAmt) / 2);
      const sgst = inv.sgst || (inv.amountInINR - baseAmt - cgst);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(15, 23, 42);
      doc.text(inv.priceFormatted + ' due ' + issueDate, mg, y);
      y += 12;

      // Status badge
      doc.setFillColor(220, 252, 231);
      doc.roundedRect(mg, y - 5, 50, 8, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(22, 163, 74);
      doc.text('PAID · Payment Verified', mg + 4, y + 0.5);
      y += 10;

      // Items table
      const planDisplay2 = inv.isWizard ? inv.productName : (inv.productName && inv.productName.includes('Max') ? 'Nova Max' : inv.productName && inv.productName.includes('Pro') ? 'Nova Pro' : 'Nova Basic');
      const termStr2 = inv.term || 'Monthly Subscription';
      autoTable(doc, {
        startY: y,
        margin: { left: mg, right: mg },
        head: [['Description', 'Qty', 'Unit price', 'Tax', 'Amount']],
        body: [
          [planDisplay2 + '\n' + termStr2, '1', '₹' + baseAmt.toLocaleString('en-IN'), '18% GST', inv.priceFormatted],
        ],
        foot: [
          [{ content: 'Subtotal', colSpan: 4, styles: { halign: 'right', fontStyle: 'normal', textColor: [37, 99, 235] } }, '₹' + baseAmt.toLocaleString('en-IN')],
          [{ content: 'Total excluding tax', colSpan: 4, styles: { halign: 'right', fontStyle: 'normal', textColor: [37, 99, 235] } }, '₹' + baseAmt.toLocaleString('en-IN')],
          [{ content: 'CGST (9%)', colSpan: 4, styles: { halign: 'right', fontStyle: 'normal', textColor: [71, 85, 105] } }, '₹' + cgst.toLocaleString('en-IN')],
          [{ content: 'SGST (9%)', colSpan: 4, styles: { halign: 'right', fontStyle: 'normal', textColor: [71, 85, 105] } }, '₹' + sgst.toLocaleString('en-IN')],
          [{ content: 'Total (incl. 18% GST)', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } }, inv.priceFormatted],
          [{ content: 'Amount paid', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } }, inv.priceFormatted],
        ],
        headStyles: { fillColor: [248, 250, 252], textColor: [71, 85, 105], fontStyle: 'normal', fontSize: 8, lineColor: [226, 232, 240], lineWidth: 0.2 },
        bodyStyles: { textColor: [15, 23, 42], fontSize: 9 },
        footStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontSize: 9, lineColor: [226, 232, 240], lineWidth: 0.2 },
        columnStyles: { 0: { cellWidth: 78 }, 1: { halign: 'center', cellWidth: 12 }, 2: { halign: 'right' }, 3: { halign: 'center', cellWidth: 18 }, 4: { halign: 'right' } },
        styles: { lineColor: [226, 232, 240], lineWidth: 0.2 },
      });

      // Payment details section
      const tableEndY = doc.lastAutoTable.finalY + 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Payment Details', mg, tableEndY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const pd = [
        ['Payment ID', inv.paymentId || '—'],
        ['Gateway', 'Razorpay (Live Verified)'],
        ['Method', 'UPI / Cards / NetBanking'],
        ['Status', 'PAID ✔'],
      ];
      let pdY = tableEndY + 5;
      pd.forEach(([k, v]) => {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
        doc.text(k + ':', mg, pdY);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
        doc.text(v, 62, pdY);
        pdY += 5;
      });

      // Footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text((inv.invoiceId || 'INV-NOVA') + ' · ' + inv.priceFormatted + ' due ' + issueDate, mg, H - 10);
      doc.text('Page 1 of 1', W - mg, H - 10, { align: 'right' });

      doc.save('NOVA_Invoice_' + (inv.invoiceId || Date.now()) + '.pdf');
      showNotification('Invoice PDF downloaded!', 'success', 'Invoice Downloaded');
    } catch (err) {
      console.error('Invoice PDF error:', err);
      showNotification('Failed to generate invoice PDF.', 'error', 'PDF Error');
    }
  };

  const generateInputPDF = (job, index = 0) => {
    if (!job || !job.json_payload) {
      showNotification('No input data available to generate PDF.', 'error', 'PDF Export');
      return;
    }
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      let payloads = job.json_payload;
      if (typeof payloads === 'string') {
        try { payloads = JSON.parse(payloads); } catch (e) { }
      }
      let p = Array.isArray(payloads) ? payloads[index] : payloads;
      if (!p) p = Array.isArray(payloads) ? payloads[0] : payloads;
      const W = 210, margin = 14, contentW = W - 28;
      const analysisType = p.Analysis_Type || '';
      const isLimitLoad = analysisType === 'Limit-Load Analysis';
      const thermalReq = p.Thermal_Required || 'No';
      const showThermal = thermalReq === 'Yes';
      const nType = p.N_TYPE ?? p.Nozzle_Type ?? '';
      const isBarrel = String(nType).toLowerCase() === 'barrel' || String(nType).toLowerCase() === 'srn';
      const padVal = p.Pad_Required ?? p.pad ?? 'No';
      const isPad = String(padVal).toLowerCase() === 'yes';
      const isHead = !!p.Head_TYPE; // True if it's a Vessel Head analysis
      doc.setFillColor(20, 20, 20);
      doc.rect(0, 0, W, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16); doc.setFont("helvetica", "bold");
      doc.text("NOVA", margin, 12);
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
      doc.setTextColor(180, 180, 180);
      doc.text("ENGINEERING ANALYSIS PLATFORM", margin, 18);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10.5); doc.setFont("helvetica", "bold");
      doc.text("INPUT PARAMETERS", W - margin, 12, { align: 'right' });
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
      doc.setTextColor(200, 200, 200);

      const typeStr = isHead ? `Vessel Head Analysis ${index + 1}` : `Shell Nozzle Analysis ${index + 1}`;
      doc.text(typeStr + '  |  ' + (job.job_id_display || job.id.substring(0, 8)), W - margin, 18, { align: 'right' });
      doc.text('Date: ' + new Date().toLocaleDateString('en-IN'), W - margin, 24, { align: 'right' });
      let y = 36;
      const addSection = (num, title) => {
        if (y > 265) { doc.addPage(); y = 18; }
        doc.setDrawColor(20, 20, 20);
        doc.setLineWidth(0.6);
        doc.line(margin, y, margin + contentW, y);
        doc.setLineWidth(0.2);
        doc.setTextColor(20, 20, 20);
        doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
        doc.text(num + '.  ' + title.toUpperCase(), margin, y + 5.5);
        y += 9;
      };
      let rowAlt = false;
      const addRow = (label, value, unit) => {
        if (y > 276) { doc.addPage(); y = 18; rowAlt = false; }
        if (rowAlt) {
          doc.setFillColor(245, 245, 245);
          doc.rect(margin, y, contentW, 5.8, 'F');
        }
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(7.8); doc.setFont("helvetica", "normal");
        doc.text(String(label), margin + 2, y + 4);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(10, 10, 10);
        const val = unit ? String(value) + ' ' + unit : String(value);
        doc.text(val, margin + contentW - 2, y + 4, { align: 'right' });
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.1);
        doc.line(margin, y + 5.8, margin + contentW, y + 5.8);
        y += 5.8;
        rowAlt = !rowAlt;
      };
      addSection(1, 'Project & Conditions'); rowAlt = false;
      if (p.File_Path) addRow('Analysis Folder', p.File_Path);
      if (isHead && p.Head_TYPE) addRow('Head Type', p.Head_TYPE);
      if (analysisType) addRow('Analysis Type', analysisType);

      if (isLimitLoad && p.Material_Type) addRow('Material Model', p.Material_Type);
      if (p.DesignTemp != null) addRow('Design Temp.', p.DesignTemp, '\u00b0C');
      if (p.p != null) addRow('Internal Pressure', p.p, 'MPa');

      addRow('Thermal Required', thermalReq);
      if (showThermal) {
        if (p.T_op != null) addRow('Operating Temperature', p.T_op, '\u00b0C');
        if (p.shell_id_htc != null) addRow('Shell ID HTC', p.shell_id_htc, 'W/m\u00b2\u00b7\u00b0C');
        if (p.nozzle_id_htc != null) addRow('Nozzle ID HTC', p.nozzle_id_htc, 'W/m\u00b2\u00b7\u00b0C');
        if (p.outside_id_htc != null) addRow('Outside Surface HTC', p.outside_id_htc, 'W/m\u00b2\u00b7\u00b0C');
      }
      y += 3;
      addSection(2, 'Materials'); rowAlt = false;
      if (p.Shell_Material) addRow('Shell Material', p.Shell_Material);
      if (p.Nozzle_Material) addRow('Nozzle Material', p.Nozzle_Material);
      addRow('Pad Required', isPad ? 'Yes' : 'No');
      if (isPad && p.Pad_Material) addRow('Pad Material', p.Pad_Material);
      y += 3;
      addSection(3, isHead ? 'Head & Nozzle Geometry' : 'Shell & Nozzle Geometry'); rowAlt = false;
      if (!isHead) {
        const sOD = p.S_OD ?? p.Shell_D_o;
        const sTHK = p.S_THK ?? p.Shell_T;
        const sH = p.S_H ?? p.Shell_L;
        const nOff = p.N_OFF ?? p.Offset;
        const corr = p.CorrosionAllowance ?? p.Corrosion;
        if (sOD != null) addRow('Shell Outer Dia (OD)', sOD, 'mm');
        if (sTHK != null) addRow('Shell Thickness', sTHK, 'mm');
        if (sH != null) addRow('Shell Height', sH, 'mm');
        if (nOff != null) addRow('Nozzle Offset', nOff, 'mm');
        if (corr != null) addRow('Corrosion Allowance', corr, 'mm');
      } else {
        const hType = p.Head_TYPE;
        if (hType === 'Ellipsoidal Head') {
          if (p.H_ID != null) addRow('Head Inner Dia (ID)', p.H_ID, 'mm');
          if (p.H_THK != null) addRow('Head Thickness', p.H_THK, 'mm');
          if (p.ratio != null) addRow('a:b Ratio', p.ratio);
          if (p.S_OFF != null) addRow('Straight Flange Offset', p.S_OFF, 'mm');
          if (p.S_THK != null) addRow('Attached Shell Thickness', p.S_THK, 'mm');
          if (p.S_H != null) addRow('Attached Shell Height', p.S_H, 'mm');
        } else if (hType === 'Flat Head') {
          if (p.H_OD != null) addRow('Head Outer Dia (OD)', p.H_OD, 'mm');
          if (p.H_THK != null) addRow('Head Thickness', p.H_THK, 'mm');
          if (p.S_ID != null) addRow('Shell Inner Dia (ID)', p.S_ID, 'mm');
          if (p.T_LEN != null) addRow('Transition Length', p.T_LEN, 'mm');
          if (p.S_H != null) addRow('Shell Height', p.S_H, 'mm');
          if (p.S_THK != null) addRow('Shell Thickness', p.S_THK, 'mm');
        } else if (hType === 'Torispherical Head') {
          if (p.TH_H_ID != null) addRow('Crown Radius (Head ID)', p.TH_H_ID, 'mm');
          if (p.TH_H_THK != null) addRow('Head Thickness', p.TH_H_THK, 'mm');
          if (p.H_KR != null) addRow('Knuckle Radius', p.H_KR, 'mm');
          if (p.TH_S_OFF != null) addRow('Straight Flange Offset', p.TH_S_OFF, 'mm');
          if (p.TH_S_H != null) addRow('Shell Height', p.TH_S_H, 'mm');
          if (p.TH_S_THK != null) addRow('Shell Thickness', p.TH_S_THK, 'mm');
        }
      }
      const nL1 = p.N_L1 ?? p.h;
      const nOD = p.N_OD ?? p.Nozzle_D_o;
      const nTHK = p.N_THK ?? p.Nozzle_T;
      const nP = p.N_P ?? p.Nozzle_L;
      if (nType) addRow('Nozzle Type', nType);
      if (nL1 != null && !isHead) addRow('Nozzle Location Height', nL1, 'mm');
      if (nOD != null) addRow('Neck OD', nOD, 'mm');
      if (nTHK != null) addRow('Neck Thickness', nTHK, 'mm');
      if (nP != null) addRow('Nozzle Projection', nP, 'mm');
      if (isBarrel) {
        if (p.Hub_OD != null) addRow('Hub OD', p.Hub_OD, 'mm');
        if (p.Hub_LEN != null) addRow('Hub Length', p.Hub_LEN, 'mm');
        if (p.T_LEN != null && hType !== 'Flat Head') addRow('Transition Length', p.T_LEN, 'mm');
      }
      if (p.Fillet_Radius != null) addRow('Weld Fillet Radius', p.Fillet_Radius, 'mm');
      if (p.Nozzle_In_Proj != null) addRow('Inward Projection', p.Nozzle_In_Proj, 'mm');
      if (isPad) {
        const pW = p.P_W ?? p.Pad_Width;
        const pTHK = p.P_THK ?? p.Pad_T;
        if (pW != null) addRow('Pad Width', pW, 'mm');
        if (pTHK != null) addRow('Pad Thickness', pTHK, 'mm');
      }
      y += 3;
      addSection(4, 'Meshing & Loading'); rowAlt = false;
      const bSize = p.B_size ?? p.Mesh_Size;
      const mMeth = p.m_method ?? p.Mesh_Method;
      const nDiv = p.N_D ?? p.Edge_Divisions;
      const nThrust = p.N_analysis ?? p.Nozzle_Thrust;
      const loadBound = p.N_Location ?? p.Load_Boundary;
      const fL = p.FX ?? p.F_L;
      const mT = p.MY ?? p.M_T;
      const fC = p.FZ ?? p.F_C;
      const mC = p.MZ ?? p.M_C;
      const fA = p.FY ?? p.F_A ?? p.P;
      const mL = p.MX ?? p.M_L;
      if (bSize != null) addRow('Global Body Sizing', bSize, 'mm');
      if (mMeth != null) addRow('Mesh Method', mMeth);
      if (nDiv != null) addRow('Edge Divisions', nDiv);
      if (nThrust != null) addRow('Nozzle Thrust Analysis', nThrust);
      if (loadBound != null) addRow('Load Boundary', loadBound);
      if (fL != null) addRow('FL  Longitudinal Shear Force', fL, 'N');
      if (mT != null) addRow('MT  Torsional Moment', mT, 'N mm');
      if (fC != null) addRow('FC  Circumferential Shear Force', fC, 'N');
      if (mC != null) addRow('MC  Circumferential Bending Moment', mC, 'N mm');
      if (fA != null) addRow('P   Axial / Thrust Force', fA, 'N');
      if (mL != null) addRow('ML  Longitudinal Bending Moment', mL, 'N mm');
      const totalPages = doc.internal.getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.line(margin, 285, margin + contentW, 285);
        doc.setTextColor(140, 140, 140);
        doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
        doc.text("NOVA Cloud Engineering Platform  |  ASME Sec VIII Div 2", margin, 290);
        doc.text('Page ' + pg + ' / ' + totalPages, W - margin, 290, { align: 'right' });
      }
      doc.save('NOVA_Input_' + (job.job_id_display || job.id.substring(0, 8)) + '_' + (index + 1) + '.pdf');
    } catch (err) {
      console.error("Error generating PDF:", err);
      showNotification('Failed to generate PDF. Please try again.', 'error', 'PDF Export');
    }
  };
  const generateAndOpenReport = (job, runIndex = null) => {
    if (!job) return;
    if (job.report_url && runIndex === null) {
      window.open(job.report_url, '_blank');
      return;
    }
    if (job.excel_file_url && runIndex === null) {
      window.open(job.excel_file_url, '_blank');
      return;
    }
    const geom = job.geometry_data || {};
    let runs = [];
    if (Array.isArray(geom.runs) && geom.runs.length > 0) runs = geom.runs;
    else if (Array.isArray(job.json_payload) && job.json_payload.length > 0) runs = job.json_payload;
    else if (typeof job.json_payload === 'string') {
      try { const p = JSON.parse(job.json_payload); if (Array.isArray(p)) runs = p; } catch (e) { }
    }
    if (!Array.isArray(runs) || runs.length === 0) runs = [geom];
    if (runIndex !== null) runs = runs[runIndex] ? [runs[runIndex]] : [];
    if (runs.length === 0) {
      showNotification('No input data is available for this analysis report.', 'error', 'Report');
      return;
    }
    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>NOVA FEA Report - ${job.job_id_display || job.name || 'Analysis'}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { background: #f0f4f8; color: #1e293b; margin: 0; padding: 25px; line-height: 1.5; }
    .report-container { max-width: 880px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 10px 35px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; margin-bottom: 25px; }
    .brand-title { font-size: 26px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
    .brand-title span { color: #3b82f6; }
    .meta-box { text-align: right; font-size: 13px; color: #64748b; }
    .job-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; ${job.status === 'Completed' ? 'background:#dcfce7; color:#15803d; border:1px solid #86efac;' : job.status === 'Failed' ? 'background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;' : 'background:#fef3c7; color:#b45309; border:1px solid #fde68a;'} margin-top: 6px; }
    h2 { font-size: 15px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 1px; margin-top: 28px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    h2::before { content: ''; width: 4px; height: 16px; background: #3b82f6; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12.5px; }
    th, td { border: 1px solid #e2e8f0; padding: 9px 14px; text-align: left; }
    th { background: #f8fafc; color: #475569; font-weight: 700; width: 38%; }
    td { color: #1e293b; font-weight: 500; }
    .section-banner { background: #eff6ff; color: #1e40af; font-weight: 800; font-size: 11.5px; letter-spacing: 0.5px; text-transform: uppercase; padding: 8px 14px; border: 1px solid #bfdbfe; }
    .action-bar { max-width: 880px; margin: 0 auto 15px; display: flex; justify-content: space-between; gap: 10px; }
    .btn { background: #3b82f6; color: white; border: none; padding: 10px 22px; border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(59,130,246,0.25); }
    .btn-secondary { background: #64748b; box-shadow: none; }
    .status-alert { padding: 16px 20px; border-radius: 12px; font-size: 13px; margin-bottom: 25px; ${job.status === 'Completed' ? 'background:#f0fdf4; border:1px solid #bbf7d0; color:#166534;' : job.status === 'Failed' ? 'background:#fef2f2; border:1px solid #fecaca; color:#991b1b;' : 'background:#fffbeb; border:1px solid #fde68a; color:#92400e;'} }
    @media print {
      .action-bar { display: none !important; }
      body { background: white; padding: 0; }
      .report-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn" onclick="window.print()">🖨️ Print / Save PDF</button>
    <button class="btn btn-secondary" onclick="window.close()">✕ Close Report</button>
  </div>
  <div class="report-container">
    <div class="header">
      <div>
        <div class="brand-title">NOVA <span>ENGINEERING</span></div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600;">Finite Element Analysis & Structural Verification</div>
      </div>
      <div class="meta-box">
        <div style="font-weight: 800; font-size: 16px; color: #3b82f6;">${job.job_id_display || job.id.substring(0, 8)}</div>
        <div style="margin-top: 2px;">${new Date(job.created_at).toLocaleString()}</div>
        <span class="job-badge">${job.status}</span>
      </div>
    </div>
    ${job.status === 'Failed' ? `
      <div class="status-alert">
        <strong>⚠ Simulation Execution Failure:</strong><br/>
        ${job.error_message || job.error || 'The simulation runner reported an error during solver execution.'}
      </div>
    ` : ''}
    ${job.status === 'Completed' ? `
      <div class="status-alert">
        <strong>✔ Simulation Successfully Executed:</strong> All load cases processed according to ASME Section VIII Div 2 Part 5 design-by-analysis rules.
      </div>
    ` : ''}
    <h2>Project & Job Overview</h2>
    <table>
      <tr><th>Project Name</th><td><strong>${job.name || 'Analysis Job'}</strong></td></tr>
      <tr><th>Analysis Type</th><td>${job.type}</td></tr>
      <tr><th>Job Identifier</th><td><code>${job.job_id_display || job.id}</code></td></tr>
      <tr><th>Date & Time</th><td>${new Date(job.created_at).toLocaleString()}</td></tr>
      <tr><th>Current Status</th><td><strong>${job.status}</strong></td></tr>
      ${job.result_url ? `<tr><th>Full Analysis ZIP</th><td><a href="${job.result_url}" target="_blank" style="color:#2563eb; font-weight:bold;">Download Archive (Google Drive)</a></td></tr>` : ''}
    </table>
    <div style="margin-top: 30px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 15px; text-align: center;">
      Generated automatically by NOVA Cloud Engineering Platform. Compliant with ASME Sec VIII Div 2 standards.
    </div>
  </div>
</body>
</html>`;
    const reportWin = window.open('', '_blank');
    if (reportWin) {
      reportWin.document.write(reportHtml);
      reportWin.document.close();
    }
  };
  const renderJobDetailsModal = () => {
    if (!selectedJobDetails) return null;

    const isSuccess = selectedJobDetails.status === 'Completed' || selectedJobDetails.status === 'Success';
    const isFailed = selectedJobDetails.status === 'Failed';
    const isPending = selectedJobDetails.status === 'Pending';
    const isProcessing = !isSuccess && !isFailed && !isPending;

    const statusLabel = selectedJobDetails.status;
    let payloads = selectedJobDetails.json_payload;
    if (typeof payloads === 'string') {
      try { payloads = JSON.parse(payloads); } catch (e) { }
    }
    if (!Array.isArray(payloads)) payloads = [payloads];
    const isBatch = payloads.length > 1;

    const getBatchItem = (arrStr, idx, fallback) => {
      if (!arrStr) return fallback;
      try {
        if (typeof arrStr === 'string') {
          if (arrStr.startsWith('[')) {
            const arr = JSON.parse(arrStr);
            if (Array.isArray(arr) && arr.length > idx) return arr[idx];
          } else {
            const arr = arrStr.split(',');
            if (arr.length > 1 && arr.length > idx) return arr[idx].trim();
            if (idx === 0) return arrStr;
          }
        } else if (Array.isArray(arrStr) && arrStr.length > idx) {
          return arrStr[idx];
        }
      } catch (e) { }
      return fallback;
    };

    return (
      <div className="job-details-overlay fixed inset-0 z-[120] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => closeJobDetails()}
        />

        <div className="job-details-dialog bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-[0_25px_70px_rgba(0,0,0,0.25)] rounded-[2.5rem] w-full max-w-2xl sm:max-w-3xl p-5 sm:p-8 z-10 animate-in zoom-in-95 space-y-6">

          <div className="job-details-header flex items-center justify-between gap-3 pb-5 border-b border-slate-200">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xl font-black text-slate-900 tracking-tight">{selectedJobDetails.job_id_display || selectedJobDetails.id.substring(0, 8)}</span>
              <span className="px-3.5 py-1 text-xs font-black text-[#2563eb] bg-blue-50 border border-blue-200 rounded-full shadow-xs">
                {selectedJobDetails.type || 'Nozzle Analysis'}
              </span>
              {!isBatch && <AnimatedStatusBadge status={statusLabel} />}
            </div>

            <button
              onClick={() => closeJobDetails()}
              title="Close Job Details"
              className="p-2.5 text-slate-600 hover:text-white bg-slate-100 hover:bg-rose-600 border border-slate-300 rounded-full transition-all shrink-0 cursor-pointer shadow-sm hover:scale-105"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>

          <div className="job-details-summary grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">

            <div className="p-4 bg-slate-50/90 border border-slate-200/90 rounded-2xl shadow-xs">
              <span className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">Job ID</span>
              <span className="font-black text-[#2563eb] text-sm mt-1.5 block">{selectedJobDetails.job_id_display || selectedJobDetails.id}</span>
            </div>

            <div className="p-4 bg-slate-50/90 border border-slate-200/90 rounded-2xl shadow-xs">
              <span className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">Type of Analysis</span>
              <span className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5 mt-1.5">
                <Box className="w-4 h-4 text-indigo-600" />
                {selectedJobDetails.type || 'Nozzle Analysis'}
              </span>
            </div>

            <div className="p-4 bg-slate-50/90 border border-slate-200/90 rounded-2xl shadow-xs">
              <span className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">Submitted</span>
              <span className="font-bold text-slate-800 text-xs mt-1.5 block">
                {new Date(selectedJobDetails.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {new Date(selectedJobDetails.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

          </div>

          {isFailed && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-800 font-black text-xs">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span>Error Diagnostics:</span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedJobDetails.error_message || selectedJobDetails.error || 'Simulation solver error');
                    setCopiedError(true);
                    setTimeout(() => setCopiedError(false), 2000);
                  }}
                  className="text-xs font-bold text-red-700 bg-white border border-red-200 hover:bg-red-100 px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  {copiedError ? <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedError ? 'Copied' : 'Copy Error'}
                </button>
              </div>
              <div className="bg-white border border-red-200 rounded-xl p-3.5 font-mono text-xs text-red-900 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed shadow-inner">
                {selectedJobDetails.error_message || selectedJobDetails.error || "Simulation solver execution failed. Please verify geometry dimensions, material temperature limits, and boundary conditions."}
              </div>
            </div>
          )}

          {isPending && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-xs text-amber-900 font-bold">
              <Clock className="w-5 h-5 text-amber-600 shrink-0" />
              <span>Job is queued. The backend simulation worker will pick it up shortly.</span>
            </div>
          )}

          {isBatch && (
            <nav className="job-details-run-tabs" aria-label="Analysis runs">
              {payloads.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`job-details-run-tab${activeDetailRun === index ? ' is-active' : ''}`}
                  aria-pressed={activeDetailRun === index}
                  onClick={() => setActiveDetailRun(index)}
                >
                  Job {index + 1}
                </button>
              ))}
            </nav>
          )}

          <div
            className="job-details-runs pt-4 border-t border-slate-200 flex flex-col gap-4 w-full"
            onTouchStart={(event) => {
              detailSwipeStart.current = null;
              if (event.target.closest('button, a, input, select, textarea')) return;
              if (event.touches.length === 1) {
                detailSwipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
              }
            }}
            onTouchEnd={(event) => {
              const start = detailSwipeStart.current;
              detailSwipeStart.current = null;
              if (window.innerWidth >= 768 || !isBatch || !start || event.changedTouches.length !== 1) return;
              const deltaX = event.changedTouches[0].clientX - start.x;
              const deltaY = event.changedTouches[0].clientY - start.y;
              if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
              setActiveDetailRun(index => Math.max(0, Math.min(payloads.length - 1, index + (deltaX < 0 ? 1 : -1))));
            }}
          >
            {payloads.map((p, idx) => {
              const pStatus = isBatch ? getBatchItem(selectedJobDetails.statuses, idx, statusLabel) : statusLabel;
              const pReportUrl = isBatch ? getBatchItem(selectedJobDetails.report_urls, idx, selectedJobDetails.report_url) : selectedJobDetails.report_url;
              const pResultUrl = isBatch ? getBatchItem(selectedJobDetails.result_urls, idx, selectedJobDetails.result_url) : selectedJobDetails.result_url;
              const isPSuccess = pStatus === 'Completed' || pStatus === 'Success';
              const labelSuffix = isBatch ? ` Analysis ${idx + 1}` : '';

              return (
                <div key={idx} className={`job-details-run-card flex flex-col gap-3 p-4 bg-slate-50/50 border border-slate-100 rounded-2xl${activeDetailRun === idx ? ' is-active' : ''}`}>
                  {isBatch && (
                    <div className="job-details-run-heading flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-700">Analysis {idx + 1} {p.Head_TYPE ? '(Vessel Head)' : '(Shell Nozzle)'}</span>
                      <AnimatedStatusBadge status={pStatus} />
                    </div>
                  )}
                  <div className="job-details-run-actions flex flex-col sm:flex-row items-center justify-start gap-3">
                    <button
                      onClick={() => generateInputPDF(selectedJobDetails, idx)}
                      title="Download User Input Parameters PDF"
                      className="job-detail-action job-detail-action-input glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-violet-800 hover:scale-105 flex items-center gap-2 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5 text-violet-600" />
                      <span className="job-detail-label-mobile">Input</span>
                      <span className="job-detail-label-desktop">Input Parameters PDF{labelSuffix}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadJobJson(selectedJobDetails)}
                      title={`Download ${selectedJobDetails.input_file_name || 'analysis.json'} for the analysis worker`}
                      className="job-detail-action job-detail-action-input glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-indigo-800 hover:scale-105 flex items-center gap-2 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="job-detail-label-mobile">JSON</span>
                      <span className="job-detail-label-desktop">Download Input JSON</span>
                    </button>

                    {pReportUrl ? (
                      <a
                        href={pReportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Download MS Word FEA Report (.docx)"
                        className="job-detail-action job-detail-action-report glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-emerald-800 hover:scale-105 flex items-center gap-2 transition-all"
                      >
                        <FileText className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="job-detail-label-mobile">Report</span>
                        <span className="job-detail-label-desktop">View Report{labelSuffix}</span>
                      </a>
                    ) : isPSuccess ? (
                      <button
                        onClick={() => generateAndOpenReport(selectedJobDetails, isBatch ? idx : null)}
                        title="View Analysis Report"
                        className="job-detail-action job-detail-action-report glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-emerald-800 hover:scale-105 flex items-center gap-2 transition-all"
                      >
                        <FileText className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="job-detail-label-mobile">Report</span>
                        <span className="job-detail-label-desktop">View Report{labelSuffix}</span>
                      </button>
                    ) : (
                      <button type="button" disabled title="Report is not available yet" className="job-detail-action job-detail-action-report glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-slate-400 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5" /><span className="job-detail-label-mobile">Report</span><span className="job-detail-label-desktop">Report unavailable</span>
                      </button>
                    )}

                    <button
                      onClick={() => openJobInsights(selectedJobDetails)}
                      title="Generate Executive AI Analysis Insights"
                      className="job-detail-action job-detail-action-insight glass-card w-full sm:w-auto justify-center px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black text-purple-800 hover:scale-105 flex items-center gap-2 transition-all border border-purple-200"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      <span className="job-detail-label-mobile">Insight</span>
                      <span className="job-detail-label-desktop">AI Insights</span>
                    </button>

                    {pResultUrl ? (
                      <a
                        href={pResultUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Download complete ANSYS simulation archive"
                        className="job-detail-action job-detail-action-analysis glass-card w-full sm:w-auto justify-center text-blue-900 px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black transition-all hover:scale-105 flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="job-detail-label-mobile">Analysis</span>
                        <span className="job-detail-label-desktop">Full Analysis{labelSuffix} (.zip)</span>
                      </a>
                    ) : (
                      <button type="button" disabled title="Full analysis ZIP is not available yet" className="job-detail-action job-detail-action-analysis glass-card w-full sm:w-auto justify-center text-slate-400 px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-[11px] font-black flex items-center gap-2">
                        <Download className="w-3.5 h-3.5" /><span className="job-detail-label-mobile">Analysis</span><span className="job-detail-label-desktop">Full Analysis unavailable</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    );
  };
  const DashboardHeader = ({ isProfile, customTitle }) => (
    <div className={`${!isProfile && !customTitle ? 'dashboard-header-card' : ''} ${customTitle === 'Nova Community' ? 'community-page-header' : ''} relative z-50 flex flex-col items-start justify-between p-4 md:p-6 mb-4 md:mb-8 border-t shadow-md glass-panel text-slate-800 rounded-3xl md:flex-row md:items-center border-white/60`}>
      <div className="flex items-center gap-4">
        <div className="items-center justify-center hidden p-3 transition-all border shadow-sm cursor-pointer sm:flex bg-white/40 border-white/50 rounded-2xl hover:bg-white/60 hover:scale-105" onClick={handleLogoClick}>
          <CosmicLogo className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>
        <div>
          {customTitle ? (
            <>
              <h1 className="text-lg md:text-2xl font-extrabold text-[#1E293B] tracking-wide drop-shadow-sm">{customTitle}</h1>
              <div className="flex items-center text-sm mt-1.5 font-bold text-slate-600">
                <span>Numerical Optimization & Virtual Analysis Platform</span>
              </div>
            </>
          ) : isProfile ? (
            <h1 className="text-lg md:text-2xl font-extrabold text-[#1E293B] drop-shadow-sm">About Me</h1>
          ) : (
            <>
              <h1 className="text-lg md:text-2xl font-extrabold text-[#1E293B] tracking-wide drop-shadow-sm">Welcome, {currentUser.name}!</h1>
              <div className="flex items-center text-sm mt-1.5 font-bold text-slate-600">
                <span>NOVA Dashboard - {jobs.length} Jobs</span>
                <span className={`ml-3 flex items-center px-2.5 py-1 rounded-full text-xs shadow-sm border ${currentUser.isApproved ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-800' : 'bg-amber-500/20 border-amber-500/30 text-amber-800'}`}>
                  {currentUser.isApproved ? (
                    <><CheckCircle className="w-3.5 h-3.5 mr-1" /> Approved</>
                  ) : (
                    <><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Pending Owner Confirmation</>
                  )}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      {isProfile || customTitle ? (
        <button onClick={() => { setCurrentView('dashboard'); try { window.history.pushState({ view: 'dashboard' }, '', '/dashboard'); } catch (e) {} }} className="glass-input hover:bg-white/70 text-slate-800 px-4 md:px-6 py-2.5 rounded-xl text-sm font-bold transition-colors mt-4 md:mt-0 shadow-sm border-white/80 flex items-center gap-2 cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5 mt-4 md:mt-0 z-[60]">
          <div className="relative">
            <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="flex items-center p-2 pr-4 space-x-3 text-left transition-colors shadow-sm cursor-pointer glass-input hover:bg-white/70 rounded-2xl focus:outline-none border-white/80">
              <div className="bg-[#3C64D6] text-white w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-md overflow-hidden border border-white/20">
                {currentUser.avatar ? <img src={currentUser.avatar} alt="Profile" loading="lazy" decoding="async" className="object-cover w-full h-full" /> : currentUser.initial}
              </div>
              <div className="hidden pr-2 sm:block">
                <div className="text-sm font-extrabold leading-tight text-slate-800">{currentUser.name}</div>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-600 hidden sm:block transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-3 w-60 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl py-2 z-[100] text-slate-800 animate-in fade-in slide-in-from-top-2 border border-slate-200">
                <button onClick={() => { setCurrentView('profile'); handleProfileTabChange('info'); setIsDropdownOpen(false); }} className="flex items-center w-full px-5 py-3 text-sm font-bold text-left transition-colors hover:bg-white/60">
                  <User className="w-4 h-4 mr-3 text-[#3C64D6]" /> My Profile
                </button>
                <button onClick={() => { setCurrentView('nova_help'); setIsDropdownOpen(false); try { window.history.pushState({ view: 'nova_help' }, '', '/help'); } catch (e) {} }} className="flex items-center w-full px-5 py-3 text-sm font-bold text-left transition-colors hover:bg-white/60">
                  <HelpCircle className="w-4 h-4 mr-3 text-sky-600" /> Nova Help
                </button>
                <button onClick={() => { setCurrentView('nova_community'); setIsDropdownOpen(false); try { window.history.pushState({ view: 'nova_community' }, '', '/community'); } catch (e) {} }} className="flex items-center w-full px-5 py-3 text-sm font-bold text-left transition-colors hover:bg-white/60">
                  <Users className="w-4 h-4 mr-3 text-emerald-600" /> Nova Community
                </button>
                <div className="h-px mx-2 my-1 bg-slate-200/50"></div>
                <button onClick={handleLogout} className="flex items-center w-full px-5 py-3 text-sm font-bold text-left text-red-600 transition-colors hover:bg-red-50/50">
                  <Lock className="w-4 h-4 mr-3 text-red-500" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
  const renderDashboard = () => (
    <div className="nova-dashboard-root relative z-10 min-h-screen p-4 pt-24 font-sans text-slate-800 md:p-8">
      <div className="max-w-[1200px] mx-auto">
        <DashboardHeader isProfile={false} />
        {!currentUser.isApproved && (
          <div className="bg-amber-100 border border-amber-300 rounded-2xl p-5 mb-4 md:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm max-w-[1000px] mx-auto">
            <div className="flex items-start gap-4">
              <Shield className="w-8 h-8 mt-1 text-amber-600 shrink-0 sm:mt-0" />
              <div>
                <h4 className="text-lg font-extrabold text-amber-800">Account Verification Required</h4>
                <p className="mt-1 text-sm text-amber-900">You can still buy plans and Ansys ACT Wizards. Approval is only needed to run restricted analysis modules.</p>
              </div>
            </div>

            {hasRequestedAccess === true ? (
              <span className="rounded-xl bg-amber-200 px-4 py-3 font-bold text-amber-900 whitespace-nowrap" role="status">
                Request sent
              </span>
            ) : hasRequestedAccess === false ? (
              <button
                onClick={handleRequestAccess}
                disabled={isRequestingAccess}
                className="flex items-center gap-2 px-4 md:px-6 py-3 font-bold text-white transition-colors shadow-md bg-amber-600 hover:bg-amber-700 rounded-xl whitespace-nowrap disabled:opacity-70"
              >
                {isRequestingAccess ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
                {isRequestingAccess ? 'Sending...' : 'Request Access'}
              </button>
            ) : (
              <span className="flex items-center gap-2 px-4 py-3 font-semibold text-amber-900 whitespace-nowrap" role="status">
                <Loader2 className="w-5 h-5 animate-spin" /> Checking request…
              </span>
            )}
          </div>
        )}
        <div className="nova-dashboard-module-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-[1100px] mx-auto mb-10"> <div className="glass-panel border-indigo-500/20 bg-indigo-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(99,102,241,0.15)] transition-all">
          <div>
            <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
              {!canRunPlan('Basic') ? (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              ) : (
                <div className="h-5"></div>
              )}
            </div>
            <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
              <Cylinder className="w-6 h-6 text-indigo-600" /> Nozzle Analysis
            </h3>
          </div>

          {canRunPlan('Basic') ? (
            currentUser.isApproved ? (
              <button
                onClick={() => consumeCredits('Nozzle Analysis', 300, 'Basic', () => window.location.href = '/Nozzle8.html')}
                className="bg-indigo-600 hover:bg-indigo-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-indigo-600/25">
                Submit New Job
              </button>
            ) : (
              <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                <Lock className="w-4 h-4" /> Pending Approval
              </button>
            )
          ) : (
            <button
              onClick={() => {
                setCurrentView('dashboard');
                showNotification('⚡ Upgrade to Basic Plan to submit Nozzle Analysis jobs.', 'info');
              }}
              className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white shadow-md hover:shadow-indigo-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
              title="Requires Basic Plan. Click to Upgrade."
            >
              <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
              <span>Upgrade to Submit Job</span>
              <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Basic</span>
            </button>
          )}
        </div> <div className="glass-panel border-emerald-500/20 bg-emerald-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(16,185,129,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Basic') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Waves className="w-6 h-6 text-emerald-500" /> Bellow Analysis
              </h3>
            </div>

            {canRunPlan('Basic') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Bellow Analysis', 300, 'Basic', () => window.location.href = '/bellow.html')}
                  className="glass-btn-green w-full py-3.5 rounded-xl font-bold text-white transition-transform hover:scale-105 shadow-md">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Basic Plan to submit Bellow Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-600 hover:from-amber-600 hover:to-emerald-700 text-white shadow-md hover:shadow-emerald-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Basic Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Basic</span>
              </button>
            )}
          </div> <div className="glass-panel border-amber-500/20 bg-amber-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(245,158,11,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Pro') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <CircleDashed className="w-6 h-6 text-amber-600" /> Flange Analysis
              </h3>
            </div>

            {canRunPlan('Pro') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Flange Analysis', 200, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/flange.html')}
                  className="bg-amber-600 hover:bg-amber-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-amber-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Pro Plan to submit Flange Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white shadow-md hover:shadow-amber-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Pro Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Pro</span>
              </button>
            )}
          </div> <div className="glass-panel border-orange-500/20 bg-orange-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(234,88,12,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Basic') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Flame className="w-6 h-6 text-orange-500" /> Local PWHT
              </h3>
            </div>

            {canRunPlan('Basic') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Local PWHT', 125, 'Basic', () => window.location.href = 'https://nova-analysis.vercel.app/pwht.html')}
                  className="glass-btn-orange w-full py-3.5 rounded-xl font-bold text-white transition-transform hover:scale-105 shadow-md">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Basic Plan to submit Local PWHT jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-md hover:shadow-orange-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Basic Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Basic</span>
              </button>
            )}
          </div> <div className="glass-panel border-rose-500/20 bg-rose-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(225,29,72,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Basic') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Cylinder className="w-6 h-6 text-rose-600" /> Saddle Analysis
              </h3>
            </div>

            {canRunPlan('Basic') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Saddle Analysis', 150, 'Basic', () => window.location.href = 'https://nova-analysis.vercel.app/saddle.html')}
                  className="bg-rose-600 hover:bg-rose-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-rose-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Basic Plan to submit Saddle Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white shadow-md hover:shadow-rose-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Basic Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Basic</span>
              </button>
            )}
          </div> <div className="glass-panel border-orange-500/20 bg-orange-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(249,115,22,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Pro') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Flame className="w-6 h-6 text-orange-600" /> Hot Box Analysis
              </h3>
            </div>

            {canRunPlan('Pro') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Hot Box Analysis', 75, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/hot.html')}
                  className="bg-orange-600 hover:bg-orange-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-orange-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Pro Plan to submit Hot Box Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white shadow-md hover:shadow-orange-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Pro Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Pro</span>
              </button>
            )}
          </div> <div className="glass-panel border-purple-500/20 bg-purple-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(168,85,247,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Max') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <CircleDot className="w-6 h-6 text-purple-600" /> Stiffener Analysis
              </h3>
            </div>

            {canRunPlan('Max') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Stiffener Analysis', 150, 'Max', () => window.location.href = 'https://nova-analysis.vercel.app/stiffener.html')}
                  className="bg-purple-600 hover:bg-purple-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-purple-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Max Plan to submit Stiffener Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white shadow-md hover:shadow-purple-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Max Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Max</span>
              </button>
            )}
          </div> <div className="glass-panel border-emerald-500/20 bg-emerald-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(16,185,129,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Max') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Target className="w-6 h-6 text-emerald-600" /> Tubesheet Analysis
              </h3>
            </div>

            {canRunPlan('Max') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Tubesheet Analysis', 250, 'Max', () => window.location.href = 'https://nova-analysis.vercel.app/tubesheet.html')}
                  className="bg-emerald-600 hover:bg-emerald-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-emerald-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Max Plan to submit Tubesheet Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-600 hover:from-amber-600 hover:to-emerald-700 text-white shadow-md hover:shadow-emerald-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Max Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Max</span>
              </button>
            )}
          </div> <div className="glass-panel border-cyan-500/20 bg-cyan-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(6,182,212,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Pro') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Link className="w-6 h-6 text-cyan-600" /> Lug Analysis
              </h3>
            </div>

            {canRunPlan('Pro') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Lug Analysis', 75, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/lug.html')}
                  className="bg-cyan-600 hover:bg-cyan-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-cyan-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Pro Plan to submit Lug Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white shadow-md hover:shadow-cyan-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Pro Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Pro</span>
              </button>
            )}
          </div> <div className="glass-panel border-sky-500/20 bg-sky-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(14,165,233,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Max') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Dumbbell className="w-6 h-6 text-sky-600" /> Trunnion Analysis
              </h3>
            </div>

            {canRunPlan('Max') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('Trunnion Analysis', 175, 'Max', () => window.location.href = 'https://nova-analysis.vercel.app/trunnion.html')}
                  className="bg-sky-600 hover:bg-sky-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-sky-600/25">
                  Submit New Job
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Max Plan to submit Trunnion Analysis jobs.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-sky-600 hover:from-amber-600 hover:to-sky-700 text-white shadow-md hover:shadow-sky-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Max Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Max</span>
              </button>
            )}
          </div> <div className="glass-panel border-blue-500/20 bg-blue-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(37,99,235,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                <div className="h-5"></div>
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Database className="w-6 h-6 text-blue-600" /> ASME Materials
              </h3>
            </div>

            <button
              onClick={() => {
                window.open('https://asme-material.vercel.app/', '_blank', 'noopener,noreferrer');
              }}
              className="bg-blue-600 hover:bg-blue-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-blue-600/25 cursor-pointer">
              Open Database
            </button>
          </div> <div className="glass-panel border-indigo-500/20 bg-indigo-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(79,70,229,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                <div className="h-5"></div>
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <LineChart className="w-6 h-6 text-indigo-600" /> Stress-Strain Curve
              </h3>
            </div>

            <button
              onClick={() => {
                window.open('https://nova-analysis.vercel.app/curve.html', '_blank', 'noopener,noreferrer');
              }}
              className="bg-indigo-600 hover:bg-indigo-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-indigo-600/25 cursor-pointer">
              Open Generator
            </button>
          </div> <div className="dashboard-cad-ai-card glass-panel border-teal-500/20 bg-teal-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(20,184,166,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {!canRunPlan('Max') ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shadow-sm">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <h3 className="mb-6 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <Box className="w-6 h-6 text-teal-600" /> CAD AI
              </h3>
            </div>

            {canRunPlan('Max') ? (
              currentUser.isApproved ? (
                <button
                  onClick={() => consumeCredits('CAD AI', 75, 'Max', () => window.location.href = 'https://space-geo.vercel.app/')}
                  className="bg-teal-600 hover:bg-teal-700 w-full py-3.5 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-md hover:shadow-teal-600/25">
                  Launch Agent
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 w-full py-3.5 rounded-xl font-bold cursor-not-allowed flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Pending Approval
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  showNotification('⚡ Upgrade to Max Plan to launch CAD AI.', 'info');
                }}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs sm:text-sm bg-gradient-to-r from-amber-500 via-rose-500 to-teal-600 hover:from-amber-600 hover:to-teal-700 text-white shadow-md hover:shadow-teal-500/25 flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-105 group"
                title="Requires Max Plan. Click to Upgrade."
              >
                <Lock className="w-4 h-4 text-amber-200 group-hover:scale-110 transition-transform" />
                <span>Upgrade to Submit Job</span>
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-md font-extrabold uppercase">Max</span>
              </button>
            )}
          </div> <div className="dashboard-asme-interpreter-card glass-panel border-cyan-500/20 bg-cyan-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(6,182,212,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                <div className="h-5"></div>
              </div>
              <h3 className="mb-2 text-xl font-extrabold text-slate-800 drop-shadow-sm flex flex-col items-center gap-2">
                <FileSearch className="w-6 h-6 text-cyan-600" /> ASME Interpreter
              </h3>
              <p className="mb-6 text-xs font-medium text-slate-600">Look up and interpret ASME code requirements.</p>
            </div>
            <a
              href="https://asme-interpreter.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-cyan-600 hover:bg-cyan-700 w-full py-3.5 rounded-xl font-bold text-white text-center transition-all duration-300 hover:scale-105 shadow-md hover:shadow-cyan-600/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              Open Interpreter <ExternalLink className="w-4 h-4" />
            </a>
          </div> <div className="dashboard-ai-recommender-card glass-panel border-purple-500/20 bg-purple-50/40 rounded-[2rem] p-4 md:p-8 text-center shadow-sm flex flex-col justify-between hover:shadow-[0_8px_32px_rgba(168,85,247,0.15)] transition-all">
            <div>
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                <div className="h-5"></div>
              </div>
              <h3 className="flex items-center justify-center gap-2 mb-2 text-xl font-extrabold text-slate-800 drop-shadow-sm">
                <Sparkles className="w-5 h-5 text-purple-600" /> AI Recommender
              </h3>
              <p className="mb-6 text-xs font-medium text-slate-600">Not sure which analysis to run? Describe your scenario.</p>
            </div>
            <button onClick={() => openAiModal()} className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white w-full py-3.5 rounded-xl font-bold transition-transform hover:scale-105 flex items-center justify-center gap-2 shadow-md">
              <Sparkles className="w-4 h-4" /> ✨ Smart Setup
            </button>
          </div>
        </div><div className="dashboard-job-summary glass-panel rounded-[2rem] p-4 md:p-8 shadow-sm mb-4 md:mb-8">
          <div className="dashboard-job-summary-heading flex flex-col items-center justify-between gap-4 mb-4 md:mb-8 sm:flex-row">
            <h2 className="text-lg md:text-2xl font-extrabold text-slate-800 drop-shadow-sm">Your Job Summary</h2>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className="glass-input text-[#3C64D6] text-sm rounded-xl px-5 py-2.5 outline-none font-bold cursor-pointer shadow-sm border-white/60 focus:ring-2 focus:ring-blue-500">
              <option value={`All Analysis (${jobs.length})`}>All Analysis ({jobs.length})</option>
              <option value="Nozzle Analysis">Nozzle Analysis</option>
              <option value="Bellow Analysis">Bellow Analysis</option>
              <option value="Flange Analysis">Flange Analysis</option>
              <option value="Saddle Analysis">Saddle Analysis</option>
              <option value="Local PWHT">Local PWHT</option>
              <option value="Hot Box Analysis">Hot Box Analysis</option>
              <option value="Vessel Stiffener Ring Analysis">Vessel Stiffener Ring Analysis</option>
              <option value="Lifting Lug WRC Analysis">Lifting Lug WRC Analysis</option>
              <option value="Trunnion WRC Analysis">Trunnion WRC Analysis</option>
              <option value="2D Axisymetric Tubesheet Analysis">2D Axisymetric Tubesheet Analysis</option>
            </select>
          </div>
          <div className="dashboard-job-status-grid grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="dashboard-job-status-card p-5 text-center border shadow-sm bg-emerald-500/20 border-emerald-500/30 backdrop-blur-md rounded-2xl">
              <div className="mb-1 text-xl md:text-3xl font-extrabold text-emerald-800">{stats.total}</div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-emerald-700 opacity-90">Total</div>
            </div>
            <div className="dashboard-job-status-card p-5 text-center border shadow-sm bg-blue-500/20 border-blue-500/30 backdrop-blur-md rounded-2xl">
              <div className="mb-1 text-xl md:text-3xl font-extrabold text-blue-800">{stats.completed}</div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-blue-700 opacity-90">Completed</div>
            </div>
            <div className="dashboard-job-status-card p-5 text-center border shadow-sm bg-sky-500/20 border-sky-500/30 backdrop-blur-md rounded-2xl">
              <div className="mb-1 text-xl md:text-3xl font-extrabold text-sky-800">{stats.processing}</div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-sky-700 opacity-90">Processing</div>
            </div>
            <div className="dashboard-job-status-card p-5 text-center border shadow-sm bg-orange-500/20 border-orange-500/30 backdrop-blur-md rounded-2xl">
              <div className="mb-1 text-xl md:text-3xl font-extrabold text-orange-800">{stats.pending}</div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-orange-700 opacity-90">Pending</div>
            </div>
            <div className="dashboard-job-status-card p-5 text-center border shadow-sm bg-red-500/20 border-red-500/30 backdrop-blur-md rounded-2xl">
              <div className="mb-1 text-xl md:text-3xl font-extrabold text-red-800">{stats.failed}</div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-red-700 opacity-90">Failed</div>
            </div>
          </div>
        </div>
        {jobs.length === 0 ? (
          <div className="glass-panel rounded-[2.5rem] py-6 md:py-24 px-4 md:px-6 text-center border-t border-l border-white/80 flex flex-col items-center justify-center">
            <div className="relative flex items-center justify-center w-24 h-24 mb-4 md:mb-8 glass-icon-container rounded-3xl">
              <Database className="w-8 h-8 sm:w-12 sm:h-12 text-[#3C64D6] opacity-80" />
            </div>
            <h3 className="mb-3 text-lg md:text-2xl font-extrabold text-slate-800 drop-shadow-sm">No Analysis Jobs Yet</h3>
            <p className="max-w-sm mx-auto mb-4 md:mb-8 text-sm font-medium leading-relaxed text-slate-600">Your engineering analysis jobs will appear here.<br />Submit your first job to get started!</p>
            {canRunPlan('Basic') ? (
              currentUser.isApproved ? (
                <button onClick={() => openSubmitJob('Nozzle Analysis')} className="glass-btn-green font-bold py-3.5 px-4 md:px-6 rounded-xl transition-all hover:scale-105 flex items-center shadow-lg text-sm">
                  <Plus className="w-5 h-5 mr-2" /> Start First Job
                </button>
              ) : (
                <button disabled className="flex items-center px-4 md:px-6 py-3.5 text-sm font-bold shadow-sm cursor-not-allowed bg-slate-200 text-slate-500 rounded-xl">
                  <Lock className="w-5 h-5 mr-2" /> Pending Approval
                </button>
              )
            ) : (
              <button onClick={() => setCurrentView('dashboard')} className="bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white font-bold py-3.5 px-4 md:px-6 rounded-xl transition-all hover:scale-105 flex items-center shadow-lg text-sm">
                <Lock className="w-5 h-5 mr-2 text-amber-200" /> Upgrade to Submit Job
              </button>
            )}
          </div>
        ) : (
          <div className="dashboard-recent-jobs glass-panel rounded-[2rem] overflow-hidden border-t border-white/80">
            <div className="dashboard-recent-jobs-header flex flex-wrap items-center justify-between gap-3 px-4 md:px-8 py-5 border-b bg-white/40 backdrop-blur-md border-white/50">
              <div className="flex items-center gap-3">
                <h3 className="flex items-center gap-3 text-lg font-extrabold text-slate-800 drop-shadow-sm"><FileText className="w-6 h-6 text-[#3C64D6]" /> Recent Jobs</h3>
                <span className="text-xs font-bold text-slate-500 bg-white/60 px-2.5 py-1 rounded-full border border-slate-200/60">
                  {filteredJobs.length} {filteredJobs.length === 1 ? 'Job' : 'Jobs'}
                </span>
              </div>
              {isJobSelectionMode && (
                <button
                  onClick={() => {
                    setIsJobSelectionMode(false);
                    setSelectedJobIds([]);
                  }}
                  className="dashboard-selection-done px-3 py-2 text-xs font-bold text-slate-600 bg-white/80 border border-slate-200 rounded-xl"
                >
                  Done
                </button>
              )}
              {selectedJobIds.length > 0 && (
                <button
                  onClick={handleDeleteSelectedJobs}
                  disabled={isDeletingJobs}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-black text-white transition-all bg-red-600 rounded-xl shadow-md hover:bg-red-700 hover:scale-105 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Selected ({selectedJobIds.length})
                </button>
              )}
            </div>
            <div className="dashboard-recent-jobs-table-wrap p-4 overflow-x-auto">
              <table className={`dashboard-jobs-table w-full text-sm text-left border-separate text-slate-700 border-spacing-y-2${isJobSelectionMode ? ' is-selecting' : ''}`}>
                <thead className="text-slate-500 font-bold uppercase tracking-wider text-[11px] px-4">
                  <tr>
                    <th className="w-12 px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded cursor-pointer accent-[#3C64D6]"
                        checked={filteredJobs.length > 0 && filteredJobs.every(j => selectedJobIds.includes(j.id))}
                        onChange={handleToggleSelectAll}
                        title="Select / Deselect All"
                      />
                    </th>
                    <th className="px-4 md:px-6 py-2.5">Job ID</th>
                    <th className="px-4 md:px-6 py-2.5">Type</th>
                    <th className="px-4 md:px-6 py-2.5">Date &amp; Time</th>
                    <th className="px-4 md:px-6 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(job => {
                    const isSelected = selectedJobIds.includes(job.id);
                    const isJobSuccess = job.status === 'Completed' || job.status === 'Success';
                    const isJobFailed = job.status === 'Failed';
                    const isJobPending = job.status === 'Pending';
                    const isJobProcessing = !isJobSuccess && !isJobFailed && !isJobPending;
                    const hasBatchReports = Array.isArray(job.report_urls) ? job.report_urls.some(Boolean) : Boolean(job.report_urls);
                    const hasBatchResults = Array.isArray(job.result_urls) ? job.result_urls.some(Boolean) : Boolean(job.result_urls);
                    return (
                      <tr
                        key={job.id}
                        className={`dashboard-job-row transition-colors shadow-sm rounded-xl${isSelected ? ' is-selected' : ''} ${isSelected ? 'bg-blue-50/80 border border-blue-200' : 'bg-white/40 hover:bg-white/70'}`}
                        onTouchStart={(event) => startJobSelectionPress(job.id, event)}
                        onTouchEnd={endJobSelectionPress}
                        onTouchMove={endJobSelectionPress}
                        onTouchCancel={endJobSelectionPress}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <td className="dashboard-job-select w-12 px-4 py-4 text-center first:rounded-l-xl" data-label="Select">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded cursor-pointer accent-[#3C64D6]"
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectJob(job.id, e)}
                            title="Select Job"
                          />
                        </td>
                        <td className="dashboard-job-id px-4 md:px-6 py-4 font-black text-[#3C64D6]" data-label="Job ID">
                          <span className="dashboard-job-id-value">
                          {job.job_id_display || job.id.substring(0, 8)}
                          </span>
                        </td>
                        <td className="dashboard-job-type px-4 md:px-6 py-4 font-semibold text-slate-700" data-label="Type">
                          <span className="inline-flex items-center gap-1.5">
                            <Box className="w-3.5 h-3.5 text-indigo-500" />
                            {job.type}
                          </span>
                        </td>
                        <td className="dashboard-job-date px-4 md:px-6 py-4 font-medium text-slate-600 text-xs" data-label="Date & Time">
                          <span className="dashboard-job-date-value">
                          {new Date(job.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          <span className="dashboard-job-time block text-[11px] text-slate-400 font-semibold">
                            {new Date(job.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          </span>
                        </td>
                        <td className="dashboard-job-actions px-4 md:px-6 py-4 flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 last:rounded-r-xl">
                          <span className="dashboard-job-status"><AnimatedStatusBadge status={job.status} /></span>
                          {(job.report_url || hasBatchReports || isJobSuccess) && (
                            job.report_url ? (
                              <a
                                href={job.report_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download MS Word FEA Report (.docx)"
                                className="dashboard-job-report glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold text-emerald-700 hover:bg-emerald-50 transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm border border-emerald-300"
                              >
                                <FileText className="w-3.5 h-3.5 text-emerald-600" /><span>Report</span>
                              </a>
                            ) : hasBatchReports ? (
                              <button
                                onClick={() => openJobDetails(job)}
                                title="View available reports for each analysis"
                                className="dashboard-job-report glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold text-emerald-700 hover:bg-emerald-50 transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm border border-emerald-300"
                              >
                                <FileText className="w-3.5 h-3.5 text-emerald-600" /><span>Report</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => generateAndOpenReport(job)}
                                title="Download / View Analysis Report"
                                className="dashboard-job-report glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold text-emerald-700 hover:bg-emerald-50 transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm border border-emerald-300"
                              >
                                <FileText className="w-3.5 h-3.5 text-emerald-600" /><span>Report</span>
                              </button>
                            )
                          )}
                          {!job.report_url && !hasBatchReports && !isJobSuccess && (
                            <button type="button" disabled title="Report is not available yet" className="dashboard-job-report mobile-job-action-placeholder">
                              <FileText className="w-3.5 h-3.5" /><span>Report</span>
                            </button>
                          )}
                          {job.result_url ? (
                            <a
                              href={job.result_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Download Full Analysis ZIP Archive"
                              className="dashboard-job-zip glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold text-blue-700 hover:bg-blue-50 transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm border border-blue-300"
                            >
                              <Download className="w-3.5 h-3.5 text-blue-600" /><span className="dashboard-action-short-label">Analysis</span><span className="dashboard-action-full-label">Full Analysis (.zip)</span>
                            </a>
                          ) : hasBatchResults ? (
                            <button
                              onClick={() => openJobDetails(job)}
                              title="View full analysis ZIP files for each analysis"
                              className="dashboard-job-zip glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold text-blue-700 hover:bg-blue-50 transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm border border-blue-300"
                            >
                              <Download className="w-3.5 h-3.5 text-blue-600" /><span className="dashboard-action-short-label">Analysis</span><span className="dashboard-action-full-label">Full Analysis ZIPs</span>
                            </button>
                          ) : (
                            <button type="button" disabled title="Full analysis ZIP is not available yet" className="dashboard-job-zip mobile-job-action-placeholder">
                              <Download className="w-3.5 h-3.5" /><span>Analysis</span>
                            </button>
                          )}
                          <button
                            onClick={() => openJobDetails(job)}
                            title={job.status === 'Failed' ? 'View Failure Error Log & Details' : 'View Input Parameters & Details'}
                            className={`dashboard-job-details glass-panel px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all hover:scale-105 flex items-center gap-1.5 shadow-sm ${job.status === 'Failed'
                                ? 'text-red-700 hover:bg-red-50/80 border border-red-300'
                                : 'text-slate-700 hover:bg-white/80 border border-slate-300'
                              }`}
                          >
                            {job.status === 'Failed' ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> : <Eye className="w-3.5 h-3.5 text-slate-600" />}
                            <span>Details</span>
                          </button>
                          <button
                            onClick={(e) => handleDeleteJob(job.id, e)}
                            disabled={isDeletingJobs}
                            title="Delete Job"
                            className="dashboard-job-delete p-1.5 text-red-600 transition-all border border-red-200 hover:bg-red-50 rounded-lg shadow-sm hover:scale-105 disabled:opacity-50 bg-white"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isSubmitJobOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => closeSubmitJob()}></div>
            <div className="glass-panel w-full max-w-md rounded-[2rem] overflow-hidden animate-in zoom-in-95 relative z-10 border-t border-l border-white/80 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
              <div className={`p-4 md:p-6 text-white font-extrabold flex justify-between items-center bg-gradient-to-r ${selectedJobType === 'Nozzle Analysis' ? 'from-emerald-600/90 to-emerald-500/90' : selectedJobType === 'Local PWHT' ? 'from-orange-600/90 to-orange-500/90' : 'from-blue-600/90 to-blue-500/90'} backdrop-blur-md`}>
                <span className="flex items-center gap-3 text-lg drop-shadow-sm"><Plus className="w-6 h-6" /> New {selectedJobType}</span>
                <button onClick={() => closeSubmitJob()} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleJobSubmit} className="p-4 md:p-8 space-y-4">
                <div className="space-y-2">
                  <label className="pl-1 text-sm font-bold text-slate-800">Project Name</label>
                  <input name="jobName" type="text" className="w-full px-4 py-3.5 glass-input rounded-xl text-sm font-medium" required autoFocus placeholder="e.g. Shell Nozzle Analysis" />
                </div>

                <div className="pt-4 mt-2 border-t border-slate-300/40">
                  <button type="button" onClick={() => setShowMaterialConsultant(!showMaterialConsultant)} className="flex items-center gap-2 text-sm font-extrabold text-purple-700 hover:underline">
                    <Sparkles className="w-4 h-4" /> Need AI Material Recommendations?
                  </button>

                  {showMaterialConsultant && (
                    <div className="p-4 mt-4 border bg-purple-500/10 border-purple-500/20 rounded-xl backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                      <textarea
                        className="w-full h-14 md:h-20 p-3 mb-3 text-sm font-medium rounded-lg resize-none glass-input focus:ring-purple-500/50"
                        placeholder="E.g., High pressure steam, 450°C, corrosive environment..."
                        value={materialPrompt}
                        onChange={(e) => setMaterialPrompt(e.target.value)}
                      />
                      <button type="button" onClick={handleMaterialConsultant} disabled={isMaterialLoading || !materialPrompt.trim()} className="bg-gradient-to-r from-purple-600 to-indigo-600 disabled:opacity-50 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all hover:scale-[1.02] shadow-sm w-full">
                        {isMaterialLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Ask AI Consultant
                      </button>

                      {materialResponse && (
                        <div className="p-4 mt-4 text-xs font-medium leading-relaxed whitespace-pre-wrap border rounded-lg shadow-sm text-slate-800 glass-panel border-white/50">
                          {materialResponse}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => closeSubmitJob()} className="flex-1 px-4 py-3.5 glass-input text-slate-800 rounded-xl font-bold hover:bg-white/60 transition-colors shadow-sm">Cancel</button>
                  <button type="submit" className={`flex-1 px-4 py-3.5 text-white rounded-xl font-bold transition-all hover:scale-[1.02] shadow-md ${selectedJobType === 'Nozzle Analysis' ? 'glass-btn-green' : selectedJobType === 'Local PWHT' ? 'glass-btn-orange' : 'glass-btn-blue'}`}>Submit</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {isJobDetailsOpen && renderJobDetailsModal()}
        {isInsightsOpen && renderInsightsModal()}
      </div>
    </div>
  );
  const handleDownloadWbex = () => {
    const receipt = orderReceipt || completedInvoice;
    const planName = receipt?.plan || receipt?.productName || 'Full Nozzle Ansys ACT Wizard (.WBEX)';
    const licKey = receipt?.licenseKey || 'NOV-ACT-COMMERCIAL';
    downloadSecureWbexFile(planName, licKey, planName);
  };
  const handlePrintInvoice = () => {
    window.print();
  };
  const renderWizardProducts = () => {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center space-y-4">
          <h2 className="text-xl font-black">Ansys Wizard Products</h2>
          <p className="text-sm text-slate-500">Ansys ACT automation workflows are integrated into Nova Analysis.</p>
          <button onClick={navigateToDashboard} className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl">Go to Dashboard</button>
        </div>
      </div>
    );
  };
  const renderWizardBuy = () => renderWizardProducts();
  const renderWizardDemo = () => renderWizardProducts();
  const renderWizardCheckout = () => renderWizardProducts();
  const renderCreditSuccess = () => {
    const receipt = orderReceipt || {
      orderId: `ORD-${Date.now().toString().slice(-8)}`,
      invoiceNumber: `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      plan: currentUser.isLifetimeMax ? 'Max Plan (Annual Subscription)' : `${currentUser.plan} Plan (Monthly Subscription)`,
      price: currentUser.plan === 'Max' ? '$576.00' : currentUser.plan === 'Pro' ? '$399.00' : '$199.00',
      method: 'Direct Payment (Live Verified)',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      userEmail: currentUser.email || '',
      userName: currentUser.name || 'Dinesh Kumar Yadav',
      status: 'PAID',
      isWizardProduct: false,
      licenseKey: null
    };
    const modulesData = [
      {
        id: 'nozzle',
        name: 'ASME Nozzle Analysis',
        code: 'ASME VIII-2 Part 5 Elastic-Plastic',
        credits: 300,
        plan: 'Basic',
        icon: Cylinder,
        color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
        desc: 'Shell/head nozzle intersection stress linearization (Pm, Pl, Pb, Q) & limit load.',
        action: () => consumeCredits('Nozzle Analysis', 300, 'Basic', () => window.location.href = '/Nozzle8.html')
      },
      {
        id: 'bellow',
        name: 'Bellow Expansion Joint',
        code: 'EJMA 10th Ed & ASME VIII-1 App 26',
        credits: 300,
        plan: 'Basic',
        icon: Waves,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
        desc: 'Axial, lateral, angular deflection, squirm stability & fatigue cycle evaluation.',
        action: () => consumeCredits('Bellow Analysis', 300, 'Basic', () => window.location.href = '/bellow.html')
      },
      {
        id: 'saddle',
        name: 'Saddle Horizontal Vessel',
        code: 'Zick Method & ASME Section VIII',
        credits: 150,
        plan: 'Basic',
        icon: Disc,
        color: 'text-blue-600 bg-blue-50 border-blue-200',
        desc: 'Peak bending over saddles, horn stress & circumferential compressive checks.',
        action: () => consumeCredits('Saddle Analysis', 150, 'Basic', () => window.location.href = '/saddle.html')
      },
      {
        id: 'pwht',
        name: 'Local PWHT Thermal Analysis',
        code: 'WRC 452 & ASME VIII-1 UW-40',
        credits: 125,
        plan: 'Basic',
        icon: Flame,
        color: 'text-amber-600 bg-amber-50 border-amber-200',
        desc: 'Soak band calculation, axial thermal gradient control & residual stress relief.',
        action: () => consumeCredits('Local PWHT', 125, 'Basic', () => window.location.href = '/pwht.html')
      },
      {
        id: 'flange',
        name: 'Flange Rigidity & Leakage',
        code: 'ASME VIII-1 App 2 & EN 1591',
        credits: 200,
        plan: 'Pro',
        icon: Target,
        color: 'text-rose-600 bg-rose-50 border-rose-200',
        desc: 'Gasket seating factor, bolt preload, flange rotation and leakage criteria.',
        action: () => consumeCredits('Flange Analysis', 200, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/flange.html')
      },
      {
        id: 'hotbox',
        name: 'Hot Box Thermal FEA',
        code: 'Transient & Steady-State Heat Transfer',
        credits: 75,
        plan: 'Pro',
        icon: Thermometer,
        color: 'text-orange-600 bg-orange-50 border-orange-200',
        desc: 'Skirt hotspot dissipation, refractory conduction & thermal stress mitigation.',
        action: () => consumeCredits('Hot Box Analysis', 75, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/hotbox.html')
      },
      {
        id: 'lug',
        name: 'Lug Lifting Analysis',
        code: 'WRC 107/537 Pin & Shear Stress',
        credits: 75,
        plan: 'Pro',
        icon: Link,
        color: 'text-cyan-600 bg-cyan-50 border-cyan-200',
        desc: 'Tear-out check, pin bearing & vessel shell local longitudinal/circumferential stress.',
        action: () => consumeCredits('Lug Analysis', 75, 'Pro', () => window.location.href = 'https://nova-analysis.vercel.app/lug.html')
      },
      {
        id: 'trunnion',
        name: 'Trunnion Support Analysis',
        code: 'ASME VIII-2 Part 5 & WRC 537',
        credits: 175,
        plan: 'Max',
        icon: Dumbbell,
        color: 'text-sky-600 bg-sky-50 border-sky-200',
        desc: 'Heavy vertical vessel lifting, tailing lug & trunnion pipe shell local stresses.',
        action: () => consumeCredits('Trunnion Analysis', 175, 'Max', () => window.location.href = 'https://nova-analysis.vercel.app/trunnion.html')
      },
      {
        id: 'tubesheet',
        name: 'Tubesheet Heat Exchanger',
        code: 'ASME VIII-1 Part UHX & TEMA RCB',
        credits: 250,
        plan: 'Max',
        icon: Shapes,
        color: 'text-violet-600 bg-violet-50 border-violet-200',
        desc: 'Fixed, U-tube & floating tubesheet bending, shear & tube-to-tubesheet joint check.',
        action: () => consumeCredits('Tubesheet Analysis', 250, 'Max', () => window.location.href = 'https://nova-analysis.vercel.app/tubesheet.html')
      },
      {
        id: 'cad_ai',
        name: 'CAD AI 3D Generator',
        code: 'Parametric CAD Generation',
        credits: 75,
        plan: 'Max',
        icon: Box,
        color: 'text-teal-600 bg-teal-50 border-teal-200',
        desc: 'Autonomous AI parametric STEP/IGES geometry builder for pressure vessels.',
        action: () => consumeCredits('CAD AI', 75, 'Max', () => window.location.href = 'https://swcad-ai.vercel.app/chat')
      },
      {
        id: 'materials',
        name: 'ASME Materials Database',
        code: 'ASME Section II Part D Properties',
        credits: 10,
        plan: 'Free',
        icon: Database,
        color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
        desc: 'Instant temperature-dependent allowable stresses, yield & tensile strength.',
        action: () => consumeCredits('ASME Materials', 10, 'Free', () => setCurrentView('materials'))
      },
      {
        id: 'stress_strain',
        name: 'Stress-Strain Curve Generator',
        code: 'ASME VIII-2 Annex 3-D Multilinear',
        credits: 10,
        plan: 'Free',
        icon: LineChart,
        color: 'text-purple-600 bg-purple-50 border-purple-200',
        desc: 'True stress-strain curve generation with Ramberg-Osgood plasticity derivation.',
        action: () => consumeCredits('Stress-Strain Curve', 10, 'Free', () => setCurrentView('stress_strain'))
      }
    ];
    const currentSim = modulesData.find(m => m.id === creditSimModule) || modulesData[0];
    const runsPossible = Math.floor(currentUser.dailyCreditsTotal / currentSim.credits);
    const balanceAfterOneRun = Math.max(0, currentUser.dailyCreditsTotal - currentSim.credits);
    return (
      <div className="relative z-10 min-h-screen p-4 pt-24 font-sans text-slate-900 md:p-8  flex flex-col items-center justify-start">
        <div className="max-w-[1020px] w-full mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700 space-y-8"> <div className="bg-white p-6 sm:p-10 md:p-12 rounded-[2.5rem] border-2 border-slate-200/90 shadow-2xl space-y-8 print:border-none print:shadow-none print:p-0"> <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <CosmicLogo className="w-10 h-10" />
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">NOVA AI TECHNOLOGIES</h3>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Autonomous Pressure Vessel FEA Platform</p>
            </div>
          </div>
          <div className="text-center sm:text-right">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black uppercase tracking-wider border border-emerald-300 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> 100% Daily Credits Active
            </span>
            <p className="text-[11px] font-mono text-slate-500 mt-1">Invoice: {receipt.invoiceNumber || 'INV-2026-004812'}</p>
          </div>
        </div> <div className="text-center space-y-4 py-2">
            <div className="relative inline-flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full bg-emerald-400/20 animate-ping"></div>
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-indigo-600 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30 relative z-10">
                <CheckCircle2 className="w-10 h-10" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black uppercase tracking-wider">
                <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600 animate-pulse" /> Daily Credits Unlocked & Ready
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                Welcome to {currentUser.isLifetimeMax ? 'Max Plan' : `${currentUser.plan} Plan`}!
              </h2>
              <p className="text-slate-600 text-xs sm:text-sm font-medium max-w-xl mx-auto leading-relaxed">
                Your payment has been verified. Your account has been upgraded with <strong className="text-indigo-900 font-black">{currentUser.dailyCreditsTotal} Daily Credits</strong> refreshed automatically every 24 hours at 00:00 UTC.
              </p>
            </div>
          </div> <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
            <div className="relative z-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 inline-block mb-2">
                    ⚡ Daily Engineering Quota
                  </span>
                  <h3 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-3">
                    {currentUser.dailyCreditsRemaining} / {currentUser.dailyCreditsTotal}
                    <span className="text-base sm:text-lg font-bold text-slate-300">Credits / Day</span>
                  </h3>
                </div>

                <div className="sm:text-right">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black uppercase tracking-wider border border-emerald-400/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    {currentUser.isLifetimeMax ? 'Max Plan (Forever Active)' : `${currentUser.plan} Plan Active`}
                  </span>
                  <p className="text-xs text-slate-400 font-medium mt-1">Refreshes every 24h at 00:00 UTC</p>
                </div>
              </div> <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span>Available Balance Today</span>
                  <span className="text-emerald-400 font-mono">100% Full Quota Active</span>
                </div>
                <div className="w-full h-3.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/60 shadow-inner">
                  <div className="h-full bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-400 rounded-full w-full shadow-lg shadow-emerald-500/50"></div>
                </div>
              </div> <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-5 h-5 animate-spin" style={{ animationDuration: '8s' }} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-300">Daily Reset</div>
                    <div className="text-sm font-black text-white">00:00 UTC (100%)</div>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-300">Cloud Solver</div>
                    <div className="text-sm font-black text-white">High-Speed GPU Cluster</div>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-300">ASME Div 1 & 2</div>
                    <div className="text-sm font-black text-white">All Modules Unlocked</div>
                  </div>
                </div>
              </div>
            </div>
          </div> <div className="bg-slate-50/80 rounded-3xl p-6 sm:p-8 border-2 border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  Interactive Daily Credit Run Simulator
                </h4>
                <p className="text-xs text-slate-500 font-medium">
                  Test your daily capacity by selecting any engineering analysis module:
                </p>
              </div>
              <div className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-200 shrink-0">
                Daily Quota: {currentUser.dailyCreditsTotal} Credits
              </div>
            </div> <div className="flex flex-wrap gap-2 pt-1">
              {modulesData.map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => setCreditSimModule(mod.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${creditSimModule === mod.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                >
                  {mod.name} ({mod.credits} cr)
                </button>
              ))}
            </div> <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-inner grid grid-cols-1 sm:grid-cols-3 gap-4 text-center sm:text-left">
              <div>
                <span className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">Analysis Cost</span>
                <div className="text-xl font-black text-slate-900 font-mono">{currentSim.credits} Credits</div>
                <div className="text-[11px] text-slate-500 font-medium">{currentSim.code}</div>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-emerald-600 tracking-wider">Runs Possible Today</span>
                <div className="text-xl font-black text-emerald-700 font-mono">{runsPossible} Full Runs / Day</div>
                <div className="text-[11px] text-slate-500 font-medium">100% daily reset guaranteed</div>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Balance After 1 Run</span>
                <div className="text-xl font-black text-indigo-900 font-mono">{balanceAfterOneRun} Credits</div>
                <div className="text-[11px] text-slate-500 font-medium">Remaining for other analyses</div>
              </div>
            </div>
          </div> <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-600" />
                  Ready to Solve: Your Unlocked Analysis Modules
                </h4>
                <p className="text-xs text-slate-500 font-medium">
                  Click any module below to immediately launch the solver with your active daily quota:
                </p>
              </div>
              <button
                onClick={navigateToHelp}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 hover:underline shrink-0"
              >
                View Resource Guide →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {modulesData.map((m) => {
                const IconComp = m.icon;
                return (
                  <div
                    key={m.id}
                    className="bg-white rounded-2xl p-5 border border-slate-200/90 hover:border-indigo-400 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${m.color}`}>
                          <IconComp className="w-5 h-5" />
                        </div>
                        <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                          ⚡ {m.credits} Credits
                        </span>
                      </div>

                      <div>
                        <h5 className="font-black text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                          {m.name}
                        </h5>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{m.code}</p>
                        <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">{m.desc}</p>
                      </div>
                    </div>
                    <div className="pt-4 mt-3 border-t border-slate-100">
                      <button
                        onClick={m.action}
                        className="w-full py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-indigo-600 text-white transition-all flex items-center justify-center gap-1.5 shadow-sm group-hover:shadow"
                      >
                        <span>Launch Solver</span>
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div> <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Billed To (Client):</span>
              <div className="font-extrabold text-slate-900 text-sm">{receipt.userName || currentUser.name || 'Valued Engineer'}</div>
              <div className="font-medium text-slate-600">{receipt.userEmail || currentUser.email}</div>
              <div className="font-medium text-slate-500">Account Type: Verified Professional</div>
            </div>
            <div className="space-y-1.5 sm:text-right">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Order & Transaction Details:</span>
              <div className="font-mono font-bold text-slate-800 flex items-center sm:justify-end gap-1.5">
                Order ID: <span className="text-slate-900 font-extrabold">{receipt.orderId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(receipt.orderId);
                    showNotification('Order ID copied to clipboard!', 'success', 'Copied');
                  }}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600"
                  title="Copy Order ID"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="text-slate-600">Date: {receipt.date}</div>
              <div className="text-slate-600">Payment Gateway: <strong className="text-slate-800">{receipt.method}</strong></div>
            </div>
          </div> <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-black uppercase text-[10px] tracking-wider">
                  <th className="p-3.5">Subscription Plan / Service</th>
                  <th className="p-3.5">Daily Credits Allocation</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                <tr>
                  <td className="p-3.5 font-bold text-slate-900">
                    <div>{receipt.plan}</div>
                    <div className="text-[10px] font-normal text-slate-500">
                      Full Cloud FEA, Batch Mode & Automated Report Generation
                    </div>
                  </td>
                  <td className="p-3.5 font-mono font-bold text-emerald-700">
                    ⚡ {currentUser.dailyCreditsTotal} Credits / Day (100% Daily Reset)
                  </td>
                  <td className="p-3.5">
                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                      ACTIVATED
                    </span>
                  </td>
                  <td className="p-3.5 text-right font-black text-slate-900 text-sm">
                    {receipt.price}
                  </td>
                </tr>
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-700">
                <tr>
                  <td colSpan="3" className="p-3 text-right">Subtotal:</td>
                  <td className="p-3 text-right">{receipt.price}</td>
                </tr>
                <tr>
                  <td colSpan="3" className="p-3 text-right text-slate-500">Estimated Tax (0%):</td>
                  <td className="p-3 text-right text-slate-500">$0.00</td>
                </tr>
                <tr className="border-t border-slate-300 font-black text-slate-900 text-sm">
                  <td colSpan="3" className="p-3 text-right">Total Paid:</td>
                  <td className="p-3 text-right text-emerald-700 font-mono">{receipt.price}</td>
                </tr>
              </tfoot>
            </table>
          </div> <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 print:hidden">
            <button
              onClick={handlePrintInvoice}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs transition-all shadow-md hover:scale-105"
            >
              <Printer className="w-4 h-4 text-emerald-400" /> Print / Save Tax Receipt (PDF)
            </button>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={navigateToHelp}
                className="w-full sm:w-auto px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors border border-slate-300 flex items-center justify-center gap-1.5"
              >
                <BookOpen className="w-4 h-4 text-emerald-600" /> View 100% Daily Credits Guide
              </button>
              <button
                onClick={navigateToDashboard}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs transition-all shadow-md hover:scale-105 flex items-center justify-center gap-1.5"
              >
                Start Analysis on Dashboard →
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  };
  const renderWizardSuccess = () => {
    const receipt = orderReceipt || {
      orderId: `ORD-${Date.now().toString().slice(-8)}`,
      invoiceNumber: `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      plan: 'Full Nozzle Ansys ACT Wizard (.WBEX)',
      price: '$399.00',
      method: 'Razorpay Standard (Live Verified)',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      userEmail: currentUser.email || '',
      userName: currentUser.name || 'Dinesh Kumar Yadav',
      status: 'PAID',
      isWizardProduct: true,
      licenseKey: 'NOV-ACT-WBEX-7F4B-9E21-A3C8'
    };
    if (!receipt.isWizardProduct && !(receipt.plan && (
      receipt.plan.toLowerCase().includes('wizard') ||
      receipt.plan.toLowerCase().includes('.wbex') ||
      receipt.plan.toLowerCase().includes('month license') ||
      receipt.plan.toLowerCase().includes('act extension')
    ))) {
      return renderCreditSuccess();
    }
    return (
      <div className="relative z-10 min-h-screen p-4 pt-24 font-sans text-slate-900 md:p-8  flex items-center justify-center">
        <div className="max-w-[800px] w-full mx-auto animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-white p-6 sm:p-10 md:p-12 rounded-[2.5rem] border-2 border-slate-200/90 shadow-2xl space-y-8 print:border-none print:shadow-none print:p-0"> <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <CosmicLogo className="w-10 h-10" />
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">NOVA AI TECHNOLOGIES</h3>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Autonomous Pressure Vessel FEA Platform</p>
              </div>
            </div>
            <div className="text-center sm:text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black uppercase tracking-wider border border-indigo-300">
                <Package className="w-4 h-4 text-indigo-600" /> Commercial ACT License Active
              </span>
              <p className="text-[11px] font-mono text-slate-500 mt-1">Invoice: {receipt.invoiceNumber || 'INV-2026-004812'}</p>
            </div>
          </div> <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-black uppercase tracking-wider">
                <Lock className="w-3.5 h-3.5 text-indigo-600" /> Official Ansys ACT Deliverable
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Ansys ACT Wizard Provisioned & Ready
              </h2>
              <p className="text-slate-600 text-xs sm:text-sm font-medium max-w-lg mx-auto">
                Thank you for your commercial purchase. Your node-locked ACT extension binary and commercial activation key have been generated below for local Workbench installation.
              </p>
            </div> <div className="bg-indigo-50/80 border-2 border-indigo-200 rounded-3xl p-6 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-indigo-600" /> Assigned ACT Commercial License Key:
                </span>
                <span className="text-[10px] font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200">
                  Perpetual Commercial
                </span>
              </div>
              <div className="flex items-center justify-between bg-white border-2 border-indigo-300/80 rounded-2xl p-4 shadow-inner">
                <span className="font-mono font-black text-sm sm:text-base text-indigo-800 tracking-widest select-all">
                  {receipt.licenseKey || 'NOV-ACT-WBEX-7F4B-9E21-A3C8'}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(receipt.licenseKey || 'NOV-ACT-WBEX-7F4B-9E21-A3C8');
                    showNotification('Commercial license key copied to clipboard!', 'success', 'Copied');
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-1.5 transition-all hover:scale-105 shrink-0 ml-3"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Key
                </button>
              </div>
            </div> <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl shadow-indigo-600/20">
              <div className="space-y-1 text-center sm:text-left">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200 bg-white/10 px-2.5 py-0.5 rounded-full inline-block">
                  Compiled Extension Package
                </span>
                <h4 className="text-xl font-black text-white flex items-center justify-center sm:justify-start gap-2 pt-1">
                  <Package className="w-6 h-6 text-indigo-200" /> NOVA_Ansys_ACT_Wizard_v2.4.wbex
                </h4>
                <p className="text-xs text-indigo-100 max-w-md">
                  Includes automated meshing, stress linearization, and ASME Section VIII Div 2 Part 5 validation. Compatible with Workbench 2021 R1 - 2024 R2.
                </p>
              </div>
              <button
                onClick={handleDownloadWbex}
                className="px-6 py-4 rounded-2xl bg-white hover:bg-slate-100 text-indigo-950 font-black text-sm shadow-xl flex items-center gap-2 shrink-0 transition-all hover:scale-105 active:scale-95"
              >
                <DownloadCloud className="w-5 h-5 text-indigo-600 animate-bounce" /> Download .WBEX Archive
              </button>
            </div> <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-indigo-600" /> Local Ansys Workbench Installation Guide
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="font-mono font-black text-indigo-600 text-xs">Step 1:</span>
                  <p className="text-slate-600 font-medium">Open Ansys Workbench & navigate to <strong>Extensions → Install Extension...</strong></p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="font-mono font-black text-indigo-600 text-xs">Step 2:</span>
                  <p className="text-slate-600 font-medium">Select the downloaded <strong>.wbex</strong> package & toggle it active in Extension Manager.</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="font-mono font-black text-indigo-600 text-xs">Step 3:</span>
                  <p className="text-slate-600 font-medium">Paste your <strong>License Key</strong> into the NOVA ACT Toolbar prompt to activate.</p>
                </div>
              </div>
            </div> <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <div className="space-y-1.5">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Billed To (Client):</span>
                <div className="font-extrabold text-slate-900 text-sm">{receipt.userName || currentUser.name || 'Valued Engineer'}</div>
                <div className="font-medium text-slate-600">{receipt.userEmail || currentUser.email}</div>
                <div className="font-medium text-slate-500">Account Type: Commercial License Holder</div>
              </div>
              <div className="space-y-1.5 sm:text-right">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Order & Transaction Details:</span>
                <div className="font-mono font-bold text-slate-800">Order ID: <span className="text-slate-900 font-extrabold">{receipt.orderId}</span></div>
                <div className="text-slate-600">Date: {receipt.date}</div>
                <div className="text-slate-600">Payment Gateway: <strong className="text-slate-800">{receipt.method}</strong></div>
              </div>
            </div> <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-black uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Purchased Deliverable</th>
                    <th className="p-3.5">License Term</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  <tr>
                    <td className="p-3.5 font-bold text-slate-900">
                      <div>{String(receipt.plan || '').replace(/\s*\(\.WBEX\)/gi, '')}</div>
                      <div className="text-[10px] font-normal text-slate-500">
                        ACT Binary Package + Node-Locked Commercial License
                      </div>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-indigo-700">
                      Commercial Node-Locked
                    </td>
                    <td className="p-3.5">
                      <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                        LICENSED
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-black text-slate-900 text-sm">
                      {receipt.price}
                    </td>
                  </tr>
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-700">
                  <tr>
                    <td colSpan="3" className="p-3 text-right">Subtotal:</td>
                    <td className="p-3 text-right">{receipt.price}</td>
                  </tr>
                  <tr>
                    <td colSpan="3" className="p-3 text-right text-slate-500">Estimated Tax (0%):</td>
                    <td className="p-3 text-right text-slate-500">$0.00</td>
                  </tr>
                  <tr className="border-t border-slate-300 font-black text-slate-900 text-sm">
                    <td colSpan="3" className="p-3 text-right">Total Paid:</td>
                    <td className="p-3 text-right text-emerald-700 font-mono">{receipt.price}</td>
                  </tr>
                </tfoot>
              </table>
            </div> <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 print:hidden">
              <button
                onClick={handlePrintInvoice}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs transition-all shadow-md hover:scale-105"
              >
                <Printer className="w-4 h-4 text-emerald-400" /> Print / Save Tax Receipt (PDF)
              </button>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setCurrentView('wizard_demo')}
                  className="w-full sm:w-auto px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors border border-slate-300 flex items-center gap-1.5 justify-center"
                >
                  <PlayCircle className="w-4 h-4 text-indigo-600" /> Watch Setup Tutorial
                </button>
                <button
                  onClick={navigateToDashboard}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-xs transition-all shadow-md hover:scale-105"
                >
                  Return to Dashboard →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };
  const renderNovaHelp = () => {
    return (
      <div className="relative z-10 min-h-screen bg-white font-sans text-slate-900">
        <NovaHelpContent
          onBackToDashboard={() => {
            setCurrentView('dashboard');
            try {
              window.history.pushState({ view: 'dashboard' }, '', '/dashboard');
            } catch (e) {}
          }}
          onMobileSwipeToCommunity={() => navigateMobileApp('nova_community', '/community')}
          onMobileSwipeToProfile={() => navigateMobileApp('profile', '/profile')}
        />
      </div>
    );
  };

  const renderNovaCommunity = () => {
    const isStandaloneMode = () => {
      try {
        const p = window.location.pathname.toLowerCase();
        return p.includes('/new-discussion') || p.includes('/ask-question') || p.includes('/discussion') || p.includes('/question') || p.includes('/edit/');
      } catch (e) {
        return false;
      }
    };

    if (isStandaloneMode()) {
      return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
          <NovaCommunity
            currentUser={currentUser}
            onNavigateBack={navigateToDashboard}
          />
        </div>
      );
    }

    return (
      <div className="mobile-community-page relative z-10 min-h-screen p-3 sm:p-6 pt-20 font-sans text-slate-900 bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200">
        <div className="max-w-[1440px] mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-3">
          {/* Top Profile Header */}
          <DashboardHeader isProfile={false} customTitle="Nova Community" />
          <NovaCommunity
            currentUser={currentUser}
            onNavigateBack={navigateToDashboard}
          />
        </div>
      </div>
    );
  };

  const ASME_MATERIALS_CATALOG = [
    {
      id: 'sa-516-gr-70',
      grade: 'SA-516 Gr 70',
      uns: 'K02700',
      category: 'Carbon Steel',
      form: 'Plate',
      composition: 'C-Mn-Si',
      tensileMpa: 485,
      tensileKsi: 70,
      yieldMpa: 260,
      yieldKsi: 38,
      curve: 'Curve B',
      extChart: 'Fig. CS-2',
      elasticMod: '200 GPa',
      density: '7.85 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 138 },
        { temp: '100°C', s: 138 },
        { temp: '200°C', s: 138 },
        { temp: '300°C', s: 125 },
        { temp: '400°C', s: 92 },
        { temp: '500°C', s: 45 }
      ],
      desc: 'Most widely utilized carbon steel plate for pressure vessels and boilers in moderate to lower temperature service.'
    },
    {
      id: 'sa-106-gr-b',
      grade: 'SA-106 Gr B',
      uns: 'K03006',
      category: 'Carbon Steel',
      form: 'Seamless Pipe',
      composition: 'C-Mn-Si',
      tensileMpa: 415,
      tensileKsi: 60,
      yieldMpa: 240,
      yieldKsi: 35,
      curve: 'Curve B',
      extChart: 'Fig. CS-2',
      elasticMod: '203 GPa',
      density: '7.85 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 118 },
        { temp: '100°C', s: 118 },
        { temp: '200°C', s: 118 },
        { temp: '300°C', s: 109 },
        { temp: '400°C', s: 84 },
        { temp: '500°C', s: 38 }
      ],
      desc: 'Seamless carbon steel pipe specification for high-temperature process piping and vessel nozzles.'
    },
    {
      id: 'sa-240-304',
      grade: 'SA-240 304',
      uns: 'S30400',
      category: 'Austenitic Stainless',
      form: 'Plate / Sheet',
      composition: '18Cr-8Ni',
      tensileMpa: 515,
      tensileKsi: 75,
      yieldMpa: 205,
      yieldKsi: 30,
      curve: 'Impact Exempt (> -196°C)',
      extChart: 'Fig. HA-1',
      elasticMod: '193 GPa',
      density: '8.00 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 138 },
        { temp: '100°C', s: 115 },
        { temp: '200°C', s: 99 },
        { temp: '300°C', s: 89 },
        { temp: '400°C', s: 83 },
        { temp: '500°C', s: 78 }
      ],
      desc: 'General-purpose austenitic stainless steel with excellent corrosion resistance and cryogenic toughness.'
    },
    {
      id: 'sa-240-316l',
      grade: 'SA-240 316L',
      uns: 'S31603',
      category: 'Austenitic Stainless',
      form: 'Plate / Sheet',
      composition: '16Cr-12Ni-2Mo',
      tensileMpa: 485,
      tensileKsi: 70,
      yieldMpa: 170,
      yieldKsi: 25,
      curve: 'Impact Exempt (> -196°C)',
      extChart: 'Fig. HA-2',
      elasticMod: '193 GPa',
      density: '8.00 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 115 },
        { temp: '100°C', s: 98 },
        { temp: '200°C', s: 86 },
        { temp: '300°C', s: 78 },
        { temp: '400°C', s: 73 },
        { temp: '500°C', s: 69 }
      ],
      desc: 'Low-carbon molybdenum-bearing stainless steel providing enhanced resistance to pitting and crevice corrosion.'
    },
    {
      id: 'sa-387-gr-22-cl-2',
      grade: 'SA-387 Gr 22 Cl 2',
      uns: 'K21590',
      category: 'Low Alloy Steel',
      form: 'Plate',
      composition: '2.25Cr-1Mo',
      tensileMpa: 515,
      tensileKsi: 75,
      yieldMpa: 310,
      yieldKsi: 45,
      curve: 'Curve C',
      extChart: 'Fig. CS-3',
      elasticMod: '211 GPa',
      density: '7.85 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 147 },
        { temp: '100°C', s: 147 },
        { temp: '200°C', s: 147 },
        { temp: '300°C', s: 147 },
        { temp: '400°C', s: 139 },
        { temp: '500°C', s: 108 }
      ],
      desc: 'Chromium-molybdenum alloy steel intended primarily for boilers and pressure vessels elevated temperature hydrogen service.'
    },
    {
      id: 'sb-443-inconel-625',
      grade: 'SB-443 Inconel 625',
      uns: 'N06625',
      category: 'Nickel Alloy',
      form: 'Plate / Sheet',
      composition: '60Ni-22Cr-9Mo-3.5Nb',
      tensileMpa: 827,
      tensileKsi: 120,
      yieldMpa: 414,
      yieldKsi: 60,
      curve: 'Impact Exempt',
      extChart: 'Fig. NFN-12',
      elasticMod: '207 GPa',
      density: '8.44 g/cm³',
      allowables: [
        { temp: '-29 to 40°C', s: 230 },
        { temp: '100°C', s: 219 },
        { temp: '200°C', s: 205 },
        { temp: '300°C', s: 196 },
        { temp: '400°C', s: 191 },
        { temp: '500°C', s: 187 }
      ],
      desc: 'High-strength nickel-chromium-molybdenum alloy with outstanding corrosion resistance in severe chemical and marine environments.'
    }
  ];

  const renderChat = () => {
    return (
      <div className="min-h-screen bg-white font-sans text-slate-900">
        <NovaCommunity
          currentUser={currentUser}
          onNavigateBack={navigateToDashboard}
        />
      </div>
    );
  };

  const renderMaterials = () => {
    const filteredMaterials = ASME_MATERIALS_CATALOG.filter(m => {
      const matchSearch = materialSearchQuery === '' ||
        m.grade.toLowerCase().includes(materialSearchQuery.toLowerCase()) ||
        m.uns.toLowerCase().includes(materialSearchQuery.toLowerCase()) ||
        m.desc.toLowerCase().includes(materialSearchQuery.toLowerCase());
      const matchCat = materialCategoryFilter === 'All' || m.category === materialCategoryFilter;
      return matchSearch && matchCat;
    });

    const activeMaterial = ASME_MATERIALS_CATALOG.find(m => m.id === selectedMaterialId) || ASME_MATERIALS_CATALOG[0];

    const handleSelectMat = (mat) => {
      setSelectedMaterialId(mat.id);
      try {
        window.history.pushState({ view: 'materials', material: mat.id }, '', `/materials/${mat.id}`);
      } catch (e) {}
    };

    return (
      <div className="relative z-10 min-h-screen p-3 sm:p-6 pt-20 font-sans text-slate-900 bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200">
        <div className="max-w-[1440px] mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-3">
          <DashboardHeader isProfile={false} customTitle="ASME Materials Database" />

          {/* Top Banner and Quick Links */}
          <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-black uppercase tracking-wider backdrop-blur-md">
                <Database className="w-3.5 h-3.5" /> ASME Section II Part D Database
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Standard ASME Pressure Vessel Materials</h2>
              <p className="text-sm text-blue-100 font-medium leading-relaxed">
                Explore ASME Section II Part D design stress allowables, temperature limits, UCS-66 impact test exemption curves, external pressure charts, and mechanical properties.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <a
                href="https://asme-material.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 rounded-2xl bg-white text-blue-700 font-black text-xs sm:text-sm shadow-lg hover:bg-blue-50 transition-all flex items-center gap-2 hover:scale-105"
              >
                <ExternalLink className="w-4 h-4" /> Open Full ASME Database App
              </a>
              <button
                type="button"
                onClick={() => {
                  setCurrentView('stress_strain');
                  try { window.history.pushState({ view: 'stress_strain' }, '', '/stress_strain'); } catch (e) {}
                }}
                className="px-5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs sm:text-sm backdrop-blur-md transition-all flex items-center gap-2 cursor-pointer"
              >
                <LineChart className="w-4 h-4" /> Stress-Strain Curves →
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by grade (e.g. SA-516, 304, 316, Inconel)..."
                value={materialSearchQuery}
                onChange={(e) => setMaterialSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="materials-category-filter flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {['All', 'Carbon Steel', 'Austenitic Stainless', 'Low Alloy Steel', 'Nickel Alloy'].map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMaterialCategoryFilter(cat)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    materialCategoryFilter === cat
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* 2-Column Layout: Materials List on Left, Active Detail on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* List */}
            <div className="lg:col-span-5 space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-slate-500 px-1">
                Showing {filteredMaterials.length} Materials
              </div>
              <div className="space-y-3">
                {filteredMaterials.map(m => {
                  const isSelected = m.id === activeMaterial.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => handleSelectMat(m)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/80 border-blue-400 shadow-md ring-2 ring-blue-500/10'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-slate-900">{m.grade}</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">{m.uns}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-1">{m.desc}</p>
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-blue-100/70 text-blue-700 whitespace-nowrap">
                          {m.category}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-center">
                        <div className="bg-slate-50 rounded-lg p-1.5">
                          <span className="block text-[9px] uppercase font-bold text-slate-400">Tensile (Su)</span>
                          <span className="text-xs font-black text-slate-800">{m.tensileMpa} MPa</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-1.5">
                          <span className="block text-[9px] uppercase font-bold text-slate-400">Yield (Sy)</span>
                          <span className="text-xs font-black text-slate-800">{m.yieldMpa} MPa</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-1.5">
                          <span className="block text-[9px] uppercase font-bold text-slate-400">MDMT Curve</span>
                          <span className="text-xs font-black text-indigo-700">{m.curve}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active Detail View */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">{activeMaterial.grade}</h3>
                      <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-blue-50 text-blue-700 border border-blue-200">
                        UNS {activeMaterial.uns}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1.5">{activeMaterial.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStressMaterialId(activeMaterial.id);
                      setCurrentView('stress_strain');
                      try { window.history.pushState({ view: 'stress_strain' }, '', '/stress_strain'); } catch (e) {}
                    }}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5 self-start whitespace-nowrap cursor-pointer"
                  >
                    <LineChart className="w-3.5 h-3.5" /> Generate Stress-Strain Curve
                  </button>
                </div>

                {/* Key Specification Matrix */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="block text-[10px] font-black uppercase text-slate-400">Product Form</span>
                    <span className="text-sm font-black text-slate-900 mt-0.5 block">{activeMaterial.form}</span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="block text-[10px] font-black uppercase text-slate-400">Composition</span>
                    <span className="text-sm font-black text-slate-900 mt-0.5 block">{activeMaterial.composition}</span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="block text-[10px] font-black uppercase text-slate-400">Elastic Modulus</span>
                    <span className="text-sm font-black text-slate-900 mt-0.5 block">{activeMaterial.elasticMod}</span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="block text-[10px] font-black uppercase text-slate-400">External Pressure</span>
                    <span className="text-sm font-black text-indigo-700 mt-0.5 block">{activeMaterial.extChart}</span>
                  </div>
                </div>

                {/* ASME Allowable Stresses Table */}
                <div>
                  <h4 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" /> ASME Section II Part D Maximum Allowable Stress Values, S (MPa)
                  </h4>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-white font-black uppercase">
                        <tr>
                          {activeMaterial.allowables.map((a, i) => (
                            <th key={i} className="p-3 border-r border-slate-800 last:border-r-0 text-center">{a.temp}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-x divide-slate-100 font-bold text-center">
                        <tr className="bg-slate-50">
                          {activeMaterial.allowables.map((a, i) => (
                            <td key={i} className="p-3 text-sm font-black text-blue-700">{a.s} MPa</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-2">
                    * Values derived from ASME BPVC Section II, Part D, Subpart 1, Table 1A (Div 1) and Table 5A (Div 2 Class 1).
                  </p>
                </div>

                {/* AI Material Recommendation Assistant */}
                <div className="p-5 rounded-2xl bg-purple-50/70 border border-purple-200 space-y-3">
                  <div className="flex items-center gap-2 text-purple-900 font-black text-sm">
                    <Sparkles className="w-4 h-4 text-purple-600" /> Ask AI Material Consultant
                  </div>
                  <p className="text-xs text-purple-700 font-medium leading-relaxed">
                    Have specific operating conditions (e.g. wet H2S sour service, high temperature hydrogen attack, or cryogenic conditions)? Let NOVA AI recommend the optimal ASME grade.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Sour gas service, 250°C, 4 MPa, H2S present..."
                      value={materialPrompt}
                      onChange={(e) => setMaterialPrompt(e.target.value)}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-purple-200 text-xs sm:text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    />
                    <button
                      type="button"
                      onClick={handleMaterialConsultant}
                      disabled={isMaterialLoading || !materialPrompt.trim()}
                      className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {isMaterialLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Ask AI
                    </button>
                  </div>
                  {materialResponse && (
                    <div className="p-4 bg-white rounded-xl border border-purple-200 text-xs text-slate-800 whitespace-pre-wrap font-medium leading-relaxed shadow-sm">
                      {materialResponse}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStressStrain = () => {
    const activeMat = ASME_MATERIALS_CATALOG.find(m => m.id === stressMaterialId) || ASME_MATERIALS_CATALOG[0];

    // Compute temperature adjusted mechanical properties
    const tempDelta = Math.max(0, stressTempC - 20);
    const tempFactorYield = Math.max(0.4, 1 - 0.00065 * tempDelta);
    const tempFactorTensile = Math.max(0.5, 1 - 0.00045 * tempDelta);
    const currentSy = Math.round(activeMat.yieldMpa * tempFactorYield);
    const currentSu = Math.round(activeMat.tensileMpa * tempFactorTensile);
    const currentE = 200000 - Math.round(tempDelta * 60);

    // Compute Ramberg-Osgood stress-strain data points
    // epsilon = sigma / E + alpha * (sigma / Sy)^m
    const m = activeMat.category.includes('Stainless') ? 7 : 12;

    const dataPoints = [];
    const maxStress = currentSu * 1.05;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const sigma = (maxStress / steps) * i;
      const elasticStrain = sigma / currentE;
      const plasticStrain = 0.002 * Math.pow(sigma / currentSy, m);
      const totalStrain = elasticStrain + plasticStrain;
      dataPoints.push({
        strain: parseFloat(totalStrain.toFixed(5)),
        stress: Math.round(sigma)
      });
    }

    // Map to SVG coordinates
    const maxStrainVal = 0.05;
    const svgWidth = 540;
    const svgHeight = 260;
    const padding = { left: 55, right: 25, top: 25, bottom: 40 };
    const chartW = svgWidth - padding.left - padding.right;
    const chartH = svgHeight - padding.top - padding.bottom;

    const pathData = dataPoints.map((pt, idx) => {
      const x = padding.left + Math.min(1, pt.strain / maxStrainVal) * chartW;
      const y = padding.top + (1 - (pt.stress / (maxStress * 1.08))) * chartH;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

    const handleExportCsv = () => {
      const rows = [
        ['Engineering/True Strain (mm/mm)', 'Stress (MPa)'],
        ...dataPoints.map(p => [p.strain, p.stress])
      ];
      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${activeMat.grade.replace(/[^a-zA-Z0-9]/g, '_')}_${stressTempC}C_curve.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showNotification('Stress-strain curve CSV exported successfully!', 'success');
    };

    return (
      <div className="relative z-10 min-h-screen p-3 sm:p-6 pt-20 font-sans text-slate-900 bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200">
        <div className="max-w-[1440px] mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-3">
          <DashboardHeader isProfile={false} customTitle="Stress-Strain Curve Generator" />

          {/* Top Hero Banner */}
          <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-pink-700 rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-black uppercase tracking-wider backdrop-blur-md">
                <LineChart className="w-3.5 h-3.5" /> ASME Sec VIII Div 2 Part 3 & API 579 Curves
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Nonlinear Stress-Strain Generator</h2>
              <p className="text-sm text-purple-100 font-medium leading-relaxed">
                Generate mathematical True Stress-True Strain curves, Ramberg-Osgood plasticity parameters, and tangent modulus curves directly for FEA simulation inputs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <a
                href="/curve.html"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 rounded-2xl bg-white text-indigo-700 font-black text-xs sm:text-sm shadow-lg hover:bg-indigo-50 transition-all flex items-center gap-2 hover:scale-105"
              >
                <ExternalLink className="w-4 h-4" /> Open Standalone Curve Generator
              </a>
              <button
                type="button"
                onClick={() => {
                  setCurrentView('materials');
                  try { window.history.pushState({ view: 'materials' }, '', '/materials'); } catch (e) {}
                }}
                className="px-5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs sm:text-sm backdrop-blur-md transition-all flex items-center gap-2 cursor-pointer"
              >
                <Database className="w-4 h-4" /> ASME Materials Database →
              </button>
            </div>
          </div>

          {/* Controls & Curve Canvas */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Parameters Controls */}
            <div className="lg:col-span-4 bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-6">
              <div>
                <h3 className="text-base font-black text-slate-900 mb-1">Material & Temperature</h3>
                <p className="text-xs text-slate-500 font-medium">Select material grade and design operating temperature.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Material Grade</label>
                  <select
                    value={stressMaterialId}
                    onChange={(e) => setStressMaterialId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {ASME_MATERIALS_CATALOG.map(m => (
                      <option key={m.id} value={m.id}>{m.grade} ({m.category})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-black uppercase text-slate-500">Design Temperature</label>
                    <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">{stressTempC} °C</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="500"
                    step="5"
                    value={stressTempC}
                    onChange={(e) => setStressTempC(parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold mt-1">
                    <span>20 °C (Room Temp)</span>
                    <span>250 °C</span>
                    <span>500 °C (Creep Range)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Curve Formulation</label>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'true_stress_strain', label: 'True Stress-True Strain (Ramberg-Osgood)' },
                      { id: 'engineering', label: 'Engineering (Nominal) Stress-Strain' },
                      { id: 'cyclic', label: 'Cyclic Stress-Strain (Masing Rule)' },
                      { id: 'tangent', label: 'Tangent Modulus (Et) vs Strain' }
                    ].map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setStressCurveMode(type.id)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                          stressCurveMode === type.id
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Computed Temperature Properties */}
                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Adjusted Properties @ {stressTempC}°C</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="block text-[10px] text-slate-400 font-bold">Yield (Sy)</span>
                      <span className="text-sm font-black text-slate-900">{currentSy} MPa</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="block text-[10px] text-slate-400 font-bold">Tensile (Su)</span>
                      <span className="text-sm font-black text-slate-900">{currentSu} MPa</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="block text-[10px] text-slate-400 font-bold">Modulus (E)</span>
                      <span className="text-sm font-black text-slate-900">{Math.round(currentE / 1000)} GPa</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="block text-[10px] text-slate-400 font-bold">Hardening (m)</span>
                      <span className="text-sm font-black text-indigo-600">{m}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Export Curve Data (.CSV)
                </button>
              </div>
            </div>

            {/* SVG Graph & Analysis */}
            <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {activeMat.grade} — {stressCurveMode === 'true_stress_strain' ? 'True Stress vs True Strain' : stressCurveMode === 'engineering' ? 'Engineering Stress-Strain Curve' : stressCurveMode === 'cyclic' ? 'Cyclic Stress-Strain' : 'Tangent Modulus'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Computed per ASME BPVC Section VIII, Division 2, Part 3-D</p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 self-start">
                  Sy: {currentSy} MPa | Su: {currentSu} MPa
                </span>
              </div>

              {/* Interactive SVG Chart */}
              <div className="relative bg-slate-950 rounded-2xl p-4 overflow-hidden shadow-inner">
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto">
                  <defs>
                    <linearGradient id="curveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                    const y = padding.top + (1 - frac) * chartH;
                    const val = Math.round(frac * maxStress);
                    return (
                      <g key={idx}>
                        <line x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                        <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontWeight="bold">{val}</text>
                      </g>
                    );
                  })}

                  {/* Vertical Grid lines */}
                  {[0.01, 0.02, 0.03, 0.04, 0.05].map((str, idx) => {
                    const x = padding.left + (str / maxStrainVal) * chartW;
                    return (
                      <g key={idx}>
                        <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartH} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                        <text x={x} y={padding.top + chartH + 16} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="bold">{(str * 100).toFixed(0)}%</text>
                      </g>
                    );
                  })}

                  {/* Axes */}
                  <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartH} stroke="#64748b" strokeWidth="1.5" />
                  <line x1={padding.left} y1={padding.top + chartH} x2={svgWidth - padding.right} y2={padding.top + chartH} stroke="#64748b" strokeWidth="1.5" />

                  {/* Axis Titles */}
                  <text x={padding.left - 38} y={padding.top + chartH / 2} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="bold" transform={`rotate(-90, ${padding.left - 38}, ${padding.top + chartH / 2})`}>Stress σ (MPa)</text>
                  <text x={padding.left + chartW / 2} y={svgHeight - 8} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="bold">True Strain ε (mm/mm)</text>

                  {/* Curve Line */}
                  <path d={pathData} fill="none" stroke="url(#curveGradient)" strokeWidth="3" strokeLinecap="round" />

                  {/* Yield Point Dot */}
                  {(() => {
                    const yieldPt = dataPoints.find(p => p.stress >= currentSy) || dataPoints[5];
                    const yx = padding.left + (yieldPt.strain / maxStrainVal) * chartW;
                    const yy = padding.top + (1 - (yieldPt.stress / (maxStress * 1.08))) * chartH;
                    return (
                      <g>
                        <circle cx={yx} cy={yy} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                        <text x={yx + 8} y={yy - 6} fill="#fbbf24" fontSize="10" fontWeight="bold">Yield: {currentSy} MPa</text>
                      </g>
                    );
                  })()}
                </svg>
              </div>

              {/* Curve Formula Summary */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                <div className="font-black text-slate-900 uppercase tracking-wider text-[11px]">Ramberg-Osgood Material Model Formulation</div>
                <div className="font-mono bg-white p-3 rounded-xl border border-slate-200 text-indigo-700 font-bold overflow-x-auto">
                  ε = (σ / E) + 0.002 × (σ / Sy)^{m}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                  This mathematical relationship characterizes elastic-plastic behavior through the yield transition up to ultimate tensile strength without artificial discontinuities, matching Section VIII Div 2 Part 5 requirements.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderProfile = () => {
    const mobileJobCounts = jobs.reduce((counts, job) => {
      const status = (job.status || '').toLowerCase();
      if (status === 'completed' || status === 'success') counts.completed += 1;
      else if (status === 'failed' || status === 'error') counts.failed += 1;
      else if (status === 'pending' || status === 'queued' || status === 'waiting') counts.pending += 1;
      return counts;
    }, { completed: 0, pending: 0, failed: 0 });
    const openMobileProfileSection = (tab, label) => {
      handleProfileTabChange(tab);
      setMobileProfileSection(label);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    const mobileProfileItems = [
      { label: 'Profile Info', icon: Settings, action: () => openMobileProfileSection('info', 'Profile Info') },
      { label: 'My Orders & Jobs', icon: Receipt, action: () => openMobileProfileSection('orders', 'My Orders & Jobs') },
      { label: 'Plan & Subscription', icon: Sparkles, action: () => openMobileProfileSection('subscription', 'Plan & Subscription') },
      { label: 'Security Settings', icon: Lock, action: () => openMobileProfileSection('security', 'Security Settings') },
      { label: 'Notifications', icon: Bell, action: () => openMobileProfileSection('notifications', 'Notifications') },
      { label: 'Help & Support', icon: HelpCircle, action: () => openMobileProfileSection('help', 'Help & Support') },
      { label: 'Ansys Wizard Product', icon: Package, action: () => openMobileProfileSection('wizard', 'Ansys Wizard Product') },
      { label: 'Pipespec', icon: PipespecIcon, action: () => openMobileProfileSection('pipespec', 'Pipespec') },
      { label: 'Nova Community', icon: Users, action: () => openMobileProfileSection('community', 'Nova Community') },
      { label: 'Nova Help', icon: BookOpen, action: () => openMobileProfileSection('nova_help', 'Nova Help') },
    ];
    return (
      <div className={`mobile-profile-root relative z-10 min-h-screen font-sans text-slate-800${mobileProfileSection ? ' is-detail' : ''}`} style={{ fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <div className="profile-desktop-header sticky top-0 z-50 bg-transparent text-slate-900">
          <div className="max-w-[1280px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button onClick={navigateToDashboard} className="flex items-center gap-2 text-slate-950 hover:text-black text-sm font-semibold transition-colors">
                <ArrowRight className="w-4 h-4 rotate-180" /> Dashboard
              </button>
              <span className="text-slate-300">/</span>
              <span className="text-slate-950 text-sm font-black">My Account</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="tap-avatar-wrap w-8 h-8 rounded-full cursor-pointer">
                {currentUser.avatar
                  ? <img src={currentUser.avatar} alt="Avatar" loading="lazy" decoding="async" className="w-8 h-8 rounded-full object-cover border-2 border-slate-200" />
                  : <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-sm border-2 border-slate-200">{currentUser.initial}</div>
                }
                <div className="tap-avatar-overlay rounded-full">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:'12px',height:'12px'}}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              <span className="font-bold text-sm whitespace-nowrap">{currentUser.name}</span>
            </div>
          </div>
        </div>
        {!mobileProfileSection ? (
          <>
            <header className="mobile-profile-header">
              <button type="button" aria-label="Back to Dashboard" onClick={navigateToDashboard}>
                <ArrowLeft aria-hidden="true" />
                <span>Profile</span>
              </button>
              <button type="button" className="mobile-profile-notifications" aria-label="Open Activity and Alerts Log" onClick={() => setMobilePopup('alerts')}>
                <Bell aria-hidden="true" />
                {persistentNotifications.some((item) => !item.read) && <span />}
              </button>
            </header>
            <section className="mobile-profile-overview" aria-label="Profile overview">
          <div className="mobile-profile-cover" aria-hidden="true" />
          <label
            className="mobile-profile-avatar"
            aria-label="Tap to change profile photo or press and hold to preview"
            onPointerDown={startProfileLongPress}
            onPointerUp={cancelProfileLongPress}
            onPointerLeave={cancelProfileLongPress}
            onPointerCancel={cancelProfileLongPress}
            onContextMenu={(event) => {
              event.preventDefault();
              cancelProfileLongPress();
              suppressProfileClickRef.current = true;
              setMobilePopup('profile-preview');
            }}
            onClick={(event) => {
              if (suppressProfileClickRef.current) {
                event.preventDefault();
                suppressProfileClickRef.current = false;
              }
            }}
          >
            {currentUser.avatar
              ? <img src={currentUser.avatar} alt="" loading="lazy" decoding="async" />
              : <span>{currentUser.initial || currentUser.name?.slice(0, 1) || 'N'}</span>}
            <input type="file" accept="image/*" aria-label="Choose profile photo" onChange={handleImageUpload} />
          </label>
          <div className="mobile-profile-identity">
            <h1>{currentUser.name}</h1>
            <span className={currentUser.isApproved ? 'is-verified' : 'is-unverified'}>
              {currentUser.isApproved ? <CheckCircle2 aria-hidden="true" /> : <X aria-hidden="true" />}
              {currentUser.isApproved ? 'Verified' : 'Unverified'}
            </span>
            <p>{currentUser.plan || 'Free'} Plan</p>
          </div>
          <div className="mobile-profile-job-stats" aria-label="Analysis job summary">
            {[
              { label: 'Completed', value: mobileJobCounts.completed, kind: 'completed' },
              { label: 'Pending', value: mobileJobCounts.pending, kind: 'pending' },
              { label: 'Failed', value: mobileJobCounts.failed, kind: 'failed' },
            ].map((item) => (
              <div className={`mobile-profile-job-stat is-${item.kind}`} key={item.kind}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
            </section>
            <h2 className="mobile-profile-menu-heading">My Account</h2>
            <nav className="mobile-profile-menu" aria-label="Profile sections">
          {mobileProfileItems.map(({ label, icon: Icon, action }) => (
            <button type="button" key={label} onClick={action}>
              <span className="mobile-profile-menu-icon"><Icon aria-hidden="true" /></span>
              <span>{label}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="mobile-profile-signout" onClick={handleLogout}>
            <span className="mobile-profile-menu-icon"><LogOut aria-hidden="true" /></span>
            <span>Sign Out</span>
            <ChevronRight aria-hidden="true" />
          </button>
            </nav>
          </>
        ) : (
          <section className="mobile-profile-detail-page">
            <header className="mobile-profile-detail-header">
              <button type="button" aria-label="Back to profile" onClick={() => navigateMobileApp('profile', '/profile')}>
                <ArrowLeft aria-hidden="true" />
              </button>
              <strong>{mobileProfileSection}</strong>
              <button type="button" className="mobile-profile-notifications" aria-label="Open Activity and Alerts Log" onClick={() => setMobilePopup('alerts')}>
                <Bell aria-hidden="true" />
                {persistentNotifications.some((item) => !item.read) && <span />}
              </button>
            </header>
          </section>
        )}
        <div className="max-w-[1280px] mx-auto px-3 sm:px-4 py-6 flex flex-col lg:flex-row gap-5 items-start"> <div className="profile-desktop-sidebar w-full lg:w-[260px] shrink-0 space-y-3"> <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <label className="tap-avatar-wrap block w-16 h-16 rounded-full cursor-pointer">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-[#2874f0] flex items-center justify-center text-white text-2xl font-black border-4 border-white shadow-lg">
                  {currentUser.avatar ? <img src={currentUser.avatar} alt="Profile" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : currentUser.initial}
                </div>
                <div className="tap-avatar-overlay rounded-full">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <span>Change</span>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-500 font-medium">Hello,</div>
              <div className="font-black text-slate-900 text-sm truncate">{currentUser.name}</div>
              <div className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full mt-1 ${currentUser.plan === 'Max' ? 'bg-purple-100 text-purple-800' : currentUser.plan === 'Pro' ? 'bg-blue-100 text-blue-800' : currentUser.plan === 'Basic' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                <Sparkles className="w-2.5 h-2.5" /> {currentUser.plan} Plan
              </div>

            </div>
          </div>
        </div> <div className="profile-tabs bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {[
              { id: 'info', icon: <User className="w-4 h-4" />, label: 'Profile Information', color: 'text-[#2874f0]' },
              { id: 'orders', icon: <Receipt className="w-4 h-4" />, label: 'My Orders & Jobs', color: 'text-[#ff6161]' },
              { id: 'subscription', icon: <Sparkles className="w-4 h-4" />, label: 'Plan & Subscription', color: 'text-[#9c27b0]' },
              { id: 'security', icon: <Lock className="w-4 h-4" />, label: 'Security Settings', color: 'text-[#e53935]' },
              { id: 'notifications', icon: <Bell className="w-4 h-4" />, label: 'Notifications', color: 'text-[#0288d1]' },
              { id: 'help', icon: <HelpCircle className="w-4 h-4" />, label: 'Help & Support', color: 'text-[#00796b]' },
              { id: 'wizard', icon: <Package className="w-4 h-4" />, label: 'Ansys Wizard Product', color: 'text-[#e65100]' },
              { id: 'pipespec', icon: <PipespecIcon className="w-4 h-4" />, label: 'Pipespec', color: 'text-[#059669]' },
              { id: 'community', icon: <Users className="w-4 h-4" />, label: 'Nova Community', color: 'text-[#2e7d32]' },
              { id: 'nova_help', icon: <BookOpen className="w-4 h-4" />, label: 'Nova Help', color: 'text-[#1565c0]' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => handleProfileTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-sm font-semibold text-left transition-all border-b border-slate-100 last:border-b-0 group ${profileTab === item.id ? 'bg-[#eff6ff] text-[#2874f0] border-l-[3px] border-l-[#2874f0]' : 'text-[#1e293b] hover:bg-[#f8fafc] border-l-[3px] border-l-transparent'}`}
              >
                <span className={profileTab === item.id ? 'text-[#2874f0]' : item.color}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${profileTab === item.id ? 'text-[#2874f0]' : 'text-slate-300 group-hover:text-slate-400'}`} />
              </button>
            ))}
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-all border-t-2 border-slate-100 border-l-4 border-l-transparent">
              <Lock className="w-4 h-4" /> <span className="flex-1 text-left">Sign Out</span>
            </button>
          </div> <div className="bg-gradient-to-br from-[#2874f0] via-[#1a5dc9] to-[#0c47ba] rounded-xl p-4 text-white shadow-lg shadow-blue-200">
            <div className="text-xs text-blue-200 font-medium mb-1">Daily Credits Available</div>
            <div className="text-2xl font-black">{currentUser.dailyCreditsRemaining}<span className="text-sm text-blue-200 font-medium"> / {currentUser.dailyCreditsTotal}</span></div>
            <div className="w-full bg-white/20 rounded-full h-1.5 mt-2 overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${Math.round((currentUser.dailyCreditsRemaining / currentUser.dailyCreditsTotal) * 100)}%` }}></div>
            </div>
            <button onClick={() => handleProfileTabChange('subscription')} className="mt-3 w-full text-[11px] font-black bg-white text-[#2874f0] py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
              Upgrade Plan →
            </button>
          </div>
        </div> <div className="profile-desktop-content flex-1 min-w-0 space-y-4"> {profileTab === 'info' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-900">Personal Information</h2>
                <p className="text-xs text-slate-500 mt-0.5">Manage your name and contact details</p>
              </div>
              <button onClick={() => { setEditForm({ name: currentUser.name, company: currentUser.company, phone: currentUser.phone }); setIsEditProfileOpen(true); try { window.history.pushState({ view: 'profile', tab: 'info', modal: 'edit' }, '', '/profile/edit'); } catch (e) {} }} className="flex items-center gap-2 px-4 py-2 nova-btn-primary text-white text-sm font-bold rounded-lg transition-all shadow-sm">
                <Settings className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
            <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-[#eff6ff] to-[#f0fdf4]">
              <div className="flex items-center gap-5">
                <label className="tap-avatar-wrap block w-20 h-20 rounded-full cursor-pointer">
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-[#2874f0] flex items-center justify-center text-white text-3xl font-black border-4 border-white shadow-lg">
                    {currentUser.avatar ? <img src={currentUser.avatar} alt="Profile" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : currentUser.initial}
                  </div>
                  <div className="tap-avatar-overlay rounded-full">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span>Change</span>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
                <div>
                  <div className="font-black text-lg text-slate-900">{currentUser.name}</div>
                  <div className="text-sm text-slate-500">{currentUser.email}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${currentUser.isApproved ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                      {currentUser.isApproved ? '✓ Approved' : '⚠ Pending'}
                    </span>
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${currentUser.plan === 'Max' ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-blue-100 text-blue-800 border-blue-200'}`}>
                      {currentUser.plan} Plan
                    </span>

                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Full Name', value: currentUser.name, icon: <User className="w-4 h-4 text-[#2874f0]" /> },
                  { label: 'Email Address', value: currentUser.email, icon: <Mail className="w-4 h-4 text-[#2874f0]" /> },
                  { label: 'Phone Number', value: currentUser.phone || 'Not provided', icon: <Smartphone className="w-4 h-4 text-[#2874f0]" /> },
                  { label: 'Company / Institute', value: currentUser.company || 'Not provided', icon: <Landmark className="w-4 h-4 text-[#2874f0]" /> },
                  { label: 'Member Since', value: currentUser.joined, icon: <Clock className="w-4 h-4 text-[#2874f0]" /> },
                  { label: 'Analysis Jobs', value: `${jobs.length} Total · ${stats.completed} Completed`, icon: <Activity className="w-4 h-4 text-[#2874f0]" /> },
                ].map((field, i) => (
                  <div key={i} className="flex items-start gap-3 p-4 bg-white rounded-xl border border-slate-200 hover:border-[#2874f0]/40 hover:shadow-sm transition-all">
                    <div className="w-8 h-8 rounded-lg bg-[#eff6ff] flex items-center justify-center shrink-0">{field.icon}</div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-[#64748b] font-semibold uppercase tracking-wider mb-0.5">{field.label}</div>
                      <div className="text-sm font-bold text-[#1e293b] truncate">{field.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total', value: stats.total, color: 'nova-stat-total' },
                  { label: 'Completed', value: stats.completed, color: 'nova-stat-completed' },
                  { label: 'Processing', value: stats.processing, color: 'nova-stat-processing' },
                  { label: 'Pending', value: stats.pending, color: 'nova-stat-pending' },
                ].map((s, i) => (
                  <div key={i} className={`rounded-xl px-4 py-3 text-center ${s.color}`}>
                    <div className="text-2xl font-black">{s.value}</div>
                    <div className="text-[11px] font-bold mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )} {profileTab === 'orders' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="text-lg font-black text-slate-900">My Analysis Orders</h2>
              <p className="text-xs text-slate-500 mt-0.5">{jobs.length} total jobs</p>
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-16 px-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-4"><Receipt className="w-7 h-7 text-slate-400" /></div>
                <h3 className="font-bold text-slate-700 mb-2">No orders yet</h3>
                <p className="text-sm text-slate-400 mb-4">Submit your first FEA analysis from the Dashboard</p>
                <button onClick={navigateToDashboard} className="px-5 py-2.5 nova-btn-primary text-white text-sm font-bold rounded-lg">Go to Dashboard</button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {jobs.map((job) => {
                  const normStatus = (job.status || '').toLowerCase();
                  const isCompleted = normStatus === 'completed' || normStatus === 'success';
                  const isFailed = normStatus === 'failed' || normStatus === 'error';
                  const isPending = !isCompleted && !isFailed;
                  return (
                    <div key={job.id} className="px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => openJobDetails(job)}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#e8f0fe] flex items-center justify-center shrink-0"><Cpu className="w-5 h-5 text-[#2874f0]" /></div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{job.name}</div>
                            <div className="text-xs text-slate-500">Order: <span className="font-mono font-bold">{job.job_id_display || `NV-${(job.id || '').toString().slice(0, 6)}`}</span></div>
                            <div className="text-[11px] text-slate-400">{new Date(job.created_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                          {isCompleted && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-sm">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="tracking-wide uppercase">Completed</span>
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-red-50 text-red-700 border border-red-300 shadow-sm">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                              <span className="tracking-wide uppercase">Failed</span>
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-300 shadow-sm">
                              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
                              <span className="tracking-wide uppercase">{job.status || 'Pending'}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )} {profileTab === 'subscription' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className={`rounded-xl overflow-hidden shadow-lg ${currentUser.plan === 'Max' ? 'bg-gradient-to-r from-purple-700 to-indigo-700' : currentUser.plan === 'Pro' ? 'bg-gradient-to-r from-[#2874f0] to-[#0c47ba]' : currentUser.plan === 'Basic' ? 'bg-gradient-to-r from-[#43a047] to-[#1b5e20]' : 'bg-gradient-to-r from-slate-700 to-slate-900'}`}>
              <div className="p-6 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs text-white/70 font-semibold uppercase tracking-wider mb-1">Active Plan</div>
                    <h2 className="text-3xl font-black">{currentUser.plan} Plan</h2>
                    <div className="flex items-center gap-3 mt-2 text-sm text-white/80 font-semibold">
                      <span>{currentUser.dailyCreditsTotal} Credits/day</span>
                      <span>·</span>
                      <span>{currentUser.dailyCreditsRemaining} remaining today</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/70 mb-1">Resets at</div>
                    <div className="font-black text-lg">00:00 UTC</div>
                    <div className="text-xs text-white/60">05:30 AM IST</div>
                  </div>
                </div>
                <div className="mt-5">
                  <div className="flex justify-between text-xs text-white/70 mb-1.5">
                    <span>Quota Used Today</span>
                    <span>{currentUser.dailyCreditsTotal - currentUser.dailyCreditsRemaining} / {currentUser.dailyCreditsTotal}</span>
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-white rounded-full" style={{ width: `${Math.round((currentUser.dailyCreditsRemaining / currentUser.dailyCreditsTotal) * 100)}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="subscription-plans-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {(() => {
                const PLAN_TIER_RANKS = { 'Free': 0, 'Basic': 1, 'Pro': 2, 'Max': 3 };
                const userCurrentTierRank = PLAN_TIER_RANKS[currentUser?.plan || 'Free'] ?? 0;
                const allPlans = [
                  { name: 'Free', price: '$0', credits: '100 cr/day', badge: null, color: 'border-slate-300', features: ['ASME Materials (10 cr)', 'Stress-Strain Curves', 'AI Recommender Free', 'Daily Auto-Reset'] },
                  { name: 'Basic', price: '₹899', credits: '700 cr/day', badge: null, color: 'border-emerald-400', features: ['Nozzle Analysis (300 cr)', 'Bellow Analysis (300 cr)', 'Saddle Analysis', 'Full DOCX Reports'] },
                  { name: 'Pro', price: '₹2,999', credits: '1,500 cr/day', badge: 'Popular', color: 'border-[#2874f0]', features: ['All Basic features', 'Flange & Lug Analysis', 'Priority Queue', '5-10 FEA solves/day'] },
                  { name: 'Max', price: '₹4,999', credits: '3,000 cr/day', badge: 'Best Value', color: 'border-purple-500', features: ['All Pro features', 'Trunnion Analysis', 'CAD AI Generator', 'Tubesheet FEA'] },
                ];
                const upgradeablePlans = allPlans.filter(p => PLAN_TIER_RANKS[p.name] >= userCurrentTierRank);

                return upgradeablePlans.map((plan) => {
                  const isCurrent = (currentUser?.plan || 'Free') === plan.name;
                  return (
                    <div key={plan.name} className={`subscription-plan-card bg-white rounded-xl border-2 shadow-sm overflow-hidden flex flex-col ${isCurrent ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-md' : plan.color} hover:shadow-md transition-all`}>
                      {plan.badge && <div className="bg-[#fb641b] text-white text-[10px] font-black py-1 text-center tracking-wider">{plan.badge}</div>}
                      <div className="p-5 flex-1 flex flex-col">
                        <div className="flex items-center justify-between">
                          <div className="font-black text-xl text-slate-900">{plan.name}</div>
                          {isCurrent && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Active Plan
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1 mt-1 mb-2">
                          <span className="text-3xl font-black text-slate-900">{plan.price}</span>
                          <span className="text-sm text-slate-500">/mo</span>
                        </div>
                        <div className="text-xs font-bold text-[#2874f0] bg-[#e8f0fe] px-2.5 py-1 rounded-lg mb-4">{plan.credits}</div>
                        <div className="space-y-2 flex-1">
                          {plan.features.map((f, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-slate-600"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" /> {f}</div>
                          ))}
                        </div>
                        {isCurrent ? (
                          <button
                            disabled
                            className="mt-4 w-full py-2.5 rounded-xl text-sm font-black bg-emerald-50 text-emerald-700 border-2 border-emerald-300 cursor-default flex items-center justify-center gap-1.5"
                          >
                            <CheckCircle className="w-4 h-4 text-emerald-600" /> Current Plan (Active)
                          </button>
                        ) : (
                          <button
                            disabled={isProcessingPayment}
                            onClick={() => {
                              if (plan.name === 'Basic') {
                                handleRazorpayCheckout('Basic Plan (Monthly Subscription)', '₹899', 'credit_subscription', { planName: 'Basic', credits: 700 });
                              } else if (plan.name === 'Pro') {
                                handleRazorpayCheckout('Pro Plan (Monthly Subscription)', '₹2,999', 'credit_subscription', { planName: 'Pro', credits: 1500 });
                              } else if (plan.name === 'Max') {
                                handleRazorpayCheckout('Max Plan (Monthly Subscription)', '₹4,999', 'credit_subscription', { planName: 'Max', credits: 3000 });
                              }
                            }}
                            className="mt-4 w-full py-2.5 rounded-xl text-sm font-black bg-[#2874f0] hover:bg-[#1a5dc9] text-white shadow-md hover:scale-105 transition-all flex items-center justify-center gap-1.5 disabled:cursor-wait disabled:opacity-60"
                          >
                            {isProcessingPayment ? 'Preparing secure checkout...' : `Upgrade to ${plan.name} →`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            {currentUser.plan !== 'Max' && (
              <div className="bg-gradient-to-r from-[#2874f0] to-[#0c47ba] rounded-xl p-5 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg">
                <div>
                  <div className="font-black text-lg">Unlock All 14 Analysis Modules</div>
                  <div className="text-white/80 text-sm mt-0.5">Upgrade to Max — 3,000 credits/day, full enterprise access</div>
                </div>
                <button disabled={isProcessingPayment} onClick={() => handleRazorpayCheckout('Max Plan (Monthly Subscription)', '₹4,999', 'credit_subscription', { planName: 'Max', credits: 3000 })} className="shrink-0 px-6 py-3 bg-[#fb641b] hover:bg-[#e55a16] text-white font-black rounded-xl shadow-md text-sm hover:scale-105 transition-all disabled:cursor-wait disabled:opacity-60">{isProcessingPayment ? 'Preparing secure checkout...' : 'Upgrade to Max Plan (₹4,999) →'}</button>
              </div>
            )}

            {/* ── Payment History ── show only if current user has successfully paid */}
            {(() => {
              const userSuccessfulPayments = paymentHistory.filter(entry => {
                const emailMatch = !entry.customerEmail || entry.customerEmail.toLowerCase() === currentUser?.email?.toLowerCase();
                const st = (entry.status || '').toUpperCase();
                const statusMatch = st === 'PAID' || st === 'SUCCESS' || st === 'COMPLETED';
                return emailMatch && statusMatch;
              });

              if (userSuccessfulPayments.length === 0) return null;

              return (
                <div className="mt-4 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-indigo-500" /> Payment History
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">Your verified plan purchases</p>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                      {userSuccessfulPayments.length} Record{userSuccessfulPayments.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {userSuccessfulPayments.slice(0, 5).map((entry, idx) => {
                      const planLabel = (entry.productName?.includes('Max') ? 'Nova Max'
                        : entry.productName?.includes('Pro') ? 'Nova Pro'
                          : entry.productName?.includes('Basic') ? 'Nova Basic'
                            : entry.productName || 'Nova Plan').replace(/\s*\(\.WBEX\)/gi, '');
                      return (
                        <div key={idx} className="payment-history-row px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                          <div className="payment-history-details flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                              <div className="text-sm font-bold text-slate-900">{planLabel}</div>
                              <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                {entry.date}&nbsp;·&nbsp;
                                <span className="text-emerald-600 font-bold">{entry.priceFormatted}</span>
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">{entry.invoiceId}</div>
                            </div>
                          </div>
                          <div className="payment-history-actions flex items-center gap-2 shrink-0">
                            <span className="hidden sm:inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">PAID</span>
                            <button
                              type="button"
                              onClick={() => openDocumentModal(entry, 'invoice')}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-lg border border-slate-200 hover:border-indigo-300 shadow-sm transition-all cursor-pointer"
                              title="View Authentic Tax Invoice"
                            >
                              <FileText className="w-3.5 h-3.5 text-indigo-600" /> View Invoice
                            </button>
                            <button
                              type="button"
                              onClick={() => openDocumentModal(entry, 'receipt')}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-200 hover:border-indigo-300 shadow-sm transition-all cursor-pointer"
                              title="View Payment Receipt"
                            >
                              <Receipt className="w-3.5 h-3.5 text-indigo-600" /> View Receipt
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {userSuccessfulPayments.length > 5 && (
                    <div className="px-5 py-3 border-t border-slate-100 text-center">
                      <span className="text-xs text-slate-400">Showing 5 of {userSuccessfulPayments.length} payments</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )} {profileTab === 'security' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="text-lg font-black text-slate-900">Security Settings</h2>
              <p className="text-xs text-slate-500 mt-0.5">Manage password and account security</p>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div className="flex items-center justify-between p-5 border border-slate-200 rounded-xl hover:border-[#2874f0]/40 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center shrink-0"><Lock className="w-5 h-5 text-red-600" /></div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Password</div>
                    <div className="text-xs text-slate-400 mt-0.5">Last changed recently</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsChangePasswordOpen(true);
                    try {
                      window.history.pushState({ view: 'profile', tab: 'security', modal: 'password' }, '', '/profile/security/change-password');
                    } catch (e) {}
                  }}
                  className="px-4 py-2 border-2 border-[#2874f0] text-[#2874f0] text-sm font-bold rounded-lg hover:bg-[#e8f0fe] transition-all shrink-0 cursor-pointer"
                >
                  Change
                </button>
              </div>
              <div className="flex items-center justify-between p-5 border border-slate-200 rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><Mail className="w-5 h-5 text-emerald-600" /></div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Email Verification</div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{currentUser.email}</div>
                  </div>
                </div>
                <span className="px-3 py-1 text-[11px] font-black bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 shrink-0">Verified</span>
              </div>
              <div className="flex items-center justify-between p-5 border border-slate-200 rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0"><Shield className="w-5 h-5 text-blue-600" /></div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Account Status</div>
                    <div className="text-xs text-slate-400 mt-0.5">Platform approval</div>
                  </div>
                </div>
                <span className={`px-3 py-1 text-[11px] font-black rounded-full border shrink-0 ${currentUser.isApproved ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>{currentUser.isApproved ? 'Approved' : 'Pending'}</span>
              </div>
              <div className="flex items-center justify-between p-5 border border-slate-200 rounded-xl bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5 text-purple-600" /></div>
                  <div>
                    <div className="font-bold text-slate-700 text-sm">Two-Factor Authentication</div>
                    <div className="text-xs text-slate-400 mt-0.5">SMS and Authenticator app</div>
                  </div>
                </div>
                <span className="px-3 py-1 text-[11px] font-black bg-slate-200 text-slate-500 rounded-full shrink-0">Coming Soon</span>
              </div>
              <div className="border-2 border-red-200 rounded-xl p-5 bg-red-50">
                <div className="text-sm font-black text-red-800 mb-1">Danger Zone</div>
                <div className="text-xs text-red-600 mb-3">Permanently delete your account. This action is irreversible.</div>
                <button className="px-4 py-2 border-2 border-red-400 text-red-700 text-xs font-black rounded-lg hover:bg-red-100 transition-all">Delete My Account</button>
              </div>
            </div>
          </div>
        )} {profileTab === 'notifications' && (
          <div className="space-y-5 animate-in fade-in duration-300"> <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Activity & Alerts Log</h2>
                <p className="text-xs text-slate-500 mt-0.5">Real-time alerts, transactions, and community events saved permanently</p>
              </div>
              {persistentNotifications.length > 0 && (
                <button
                  onClick={() => {
                    setPersistentNotifications([]);
                    try { localStorage.removeItem('nova_persistent_notifications'); } catch (e) { }
                    showNotification('Alert history cleared', 'info');
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors"
                >
                  Clear Log
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {persistentNotifications.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs font-medium">
                  No alerts or notifications recorded yet.
                </div>
              ) : (
                persistentNotifications.map((notif) => (
                  <div key={notif.id} className="p-4 hover:bg-slate-50 flex items-start gap-3 transition-colors">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${notif.type === 'success' ? 'bg-emerald-100 text-emerald-600' :
                        notif.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                      {notif.type === 'success' ? <CheckCircle className="w-4 h-4" /> :
                        notif.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-bold text-xs text-slate-900">{notif.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{notif.time || 'Today'}</span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium leading-relaxed">{notif.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div> <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h2 className="text-lg font-black text-slate-900">Notification Preferences</h2>
                <p className="text-xs text-slate-500 mt-0.5">Configure automated push and email channels</p>
              </div>
              <div className="px-6 py-2">
                {[
                  { key: 'job_complete', label: 'Job Completion', desc: 'Alert when your FEA analysis finishes' },
                  { key: 'job_failed', label: 'Job Failed', desc: 'Alert when a job fails or has errors' },
                  { key: 'credit_low', label: 'Low Credit Warning', desc: 'Warn when daily credits fall below 20%' },
                  { key: 'sub_renew', label: 'Subscription Renewal', desc: 'Reminder 3 days before plan renews' },
                  { key: 'community', label: 'Community Activity', desc: 'Likes, comments and replies on posts' },
                  { key: 'product_updates', label: 'Product Updates', desc: 'New features and platform improvements' },
                  { key: 'promos', label: 'Offers & Promotions', desc: 'Discounts and special offers' },
                ].map((pref) => (
                  <div key={pref.key} className="flex items-center justify-between py-4 border-b border-slate-100 last:border-b-0">
                    <div>
                      <div className="text-sm font-bold text-slate-800">{pref.label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{pref.desc}</div>
                    </div>
                    <button
                      onClick={() => setProfileNotifPrefs(prev => ({ ...prev, [pref.key]: !prev[pref.key] }))}
                      className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${profileNotifPrefs[pref.key] ? 'bg-[#2874f0]' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${profileNotifPrefs[pref.key] ? 'left-7' : 'left-1'}`}></span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
                <button onClick={() => showNotification('Notification preferences saved!', 'success', 'Preferences')} className="px-6 py-2.5 bg-[#2874f0] text-white font-bold text-sm rounded-xl hover:bg-[#1a5dc9] transition-all">Save Preferences</button>
              </div>
            </div>
          </div>
        )} {profileTab === 'help' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-4"><Mail className="w-7 h-7 text-blue-600" /></div>
                <h3 className="font-black text-slate-900 mb-2">Email Support</h3>
                <p className="text-xs text-slate-500 mb-4">Technical issues, billing and licensing queries</p>
                <a href="mailto:analysis.ai.nova@gmail.com" className="w-full py-2.5 bg-[#2874f0] text-white font-bold text-sm rounded-xl hover:bg-[#1a5dc9] transition-all block">analysis.ai.nova@gmail.com</a>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center">
                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4"><Users className="w-7 h-7 text-emerald-600" /></div>
                <h3 className="font-black text-slate-900 mb-2">Nova Community</h3>
                <p className="text-xs text-slate-500 mb-4">Share results, ask questions, peer support</p>
                <button onClick={() => setCurrentView('nova_community')} className="w-full py-2.5 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 transition-all">Open Community</button>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100"><h2 className="font-black text-slate-900">Frequently Asked Questions</h2></div>
              <div className="divide-y divide-slate-100">
                {[
                  { q: 'When do daily credits reset?', a: 'Credits reset at 00:00 UTC (05:30 AM IST) every day, automatically and fully to 100%.' },
                  { q: 'What if I run out of credits mid-session?', a: 'The job will not submit if credits are insufficient. Upgrade your plan or wait for the midnight reset.' },
                  { q: 'How do I download my FEA report?', a: 'Dashboard → click any completed job → click View Report to download your DOCX or PDF.' },
                  { q: 'Is the payment system secure?', a: 'Yes. 256-bit SSL encryption. We support Visa, Mastercard, RuPay, UPI, Net Banking, and PayPal via secure certified gateways.' },
                  { q: 'How many computers can I use the ACT Wizard on?', a: '6-Month license: 2 workstation activations. 1-Month and 3-Month: 1 workstation activation each.' },
                  { q: 'How do I cancel my subscription?', a: 'Email analysis.ai.nova@gmail.com. Cancellations take effect at the end of the billing cycle.' },
                ].map((item, i) => (
                  <details key={i} className="group px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors">
                    <summary className="flex items-center justify-between font-bold text-sm text-slate-800 list-none">
                      {item.q}
                      <ChevronRight className="w-4 h-4 text-slate-400 group-open:rotate-90 transition-transform shrink-0 ml-3" />
                    </summary>
                    <p className="text-sm text-slate-500 mt-3 leading-relaxed font-medium pr-4">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#e8f0fe] flex items-center justify-center"><Bot className="w-5 h-5 text-[#2874f0]" /></div>
                <div>
                  <div className="font-black text-slate-900 text-sm">NOVA AI Support</div>
                  <div className="text-[11px] text-emerald-600 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Online</div>
                </div>
              </div>
              <div className="h-52 overflow-y-auto p-4 space-y-3 bg-[#f8fafc]">
                {supportChat.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`px-4 py-2.5 rounded-2xl text-xs font-medium max-w-[80%] leading-relaxed ${m.role === 'user' ? 'bg-[#2874f0] text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'}`}>{m.text}</div>
                  </div>
                ))}
                {isSupportLoading && (
                  <div className="flex justify-start">
                    <div className="px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs text-slate-400 flex items-center gap-2 shadow-sm">
                      <Loader2 className="w-3 h-3 animate-spin text-[#2874f0]" /> Typing...
                    </div>
                  </div>
                )}
              </div>
              <form onSubmit={handleSupportSubmit} className="flex gap-2 p-4 border-t border-slate-100">
                <input type="text" className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#2874f0] focus:bg-white" value={supportInput} onChange={e => setSupportInput(e.target.value)} placeholder="Ask anything about NOVA..." />
                <button type="submit" disabled={!supportInput.trim() || isSupportLoading} className="px-4 py-2.5 bg-[#2874f0] text-white rounded-xl font-bold hover:bg-[#1a5dc9] transition-all disabled:opacity-50 flex items-center gap-2">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        )} {profileTab === 'wizard' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Ansys ACT Wizards</h2>
                <p className="text-xs text-slate-500 mt-1">Automate your FEA workflows with our premium .WBEX extensions</p>
              </div>
              <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center">
                <Package className="w-5 h-5 text-[#d84315]" />
              </div>
            </div>
            <div className="p-6 space-y-4">
              {ANSYS_WIZARDS.map((item, i) => {
                const purchasedJob = (jobs || []).find(j => {
                  const isCompleted = (j.status || '').toLowerCase() === 'completed';
                  const jName = (j.name || '').toLowerCase();
                  const isWiz = j.type === 'Wizard Purchase' || jName.includes('wizard') || jName.includes('.wbex');
                  if (!isCompleted || !isWiz) return false;
                  if (item.id === 'stress_strain' && (jName.includes('stress') || jName.includes('curve'))) return true;
                  if (item.id === 'head' && jName.includes('head')) return true;
                  if (item.id === 'shell' && jName.includes('shell')) return true;
                  if (item.id === 'full' && (jName.includes('full') || (!jName.includes('head') && !jName.includes('shell') && !jName.includes('stress')))) return true;
                  return false;
                });
                const isPurchased = !!purchasedJob;
                const itemIcon = item.id === 'stress_strain'
                  ? <LineChart className="w-6 h-6 text-[#2874f0]" />
                  : item.id === 'shell'
                    ? <Cylinder className="w-6 h-6 text-[#2874f0]" />
                    : item.id === 'head'
                      ? <Disc className="w-6 h-6 text-[#2874f0]" />
                      : <Box className="w-6 h-6 text-[#2874f0]" />;

                return (
                  <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-slate-300 transition-all gap-4 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#e8f0fe] rounded-2xl flex items-center justify-center shrink-0">
                        {itemIcon}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm sm:text-base">{item.name.replace(/\s*\(\.WBEX\)/gi, '')}</h3>
                        <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <button
                        onClick={() => openWizardDemo(item)}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2"
                      >
                        <PlayCircle className="w-4 h-4 text-slate-700" /> View Demo
                      </button>
                      {isPurchased ? (
                        <button
                          onClick={() => window.open('mailto:analysis.ai.nova@gmail.com', '_blank')}
                          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                        >
                          <Mail className="w-4 h-4" /> Contact Support
                        </button>
                      ) : (
                        <button
                          onClick={() => openWizardPricing(item)}
                          className="px-6 py-2.5 bg-gradient-to-r from-[#d84315] to-[#bf360c] hover:from-[#c23b12] hover:to-[#a72e09] text-white text-xs sm:text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 hover:scale-105"
                        >
                          <ShoppingCart className="w-4 h-4" /> Buy
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )} {profileTab === 'pipespec' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <PipespecIcon className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Pipespec</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">Interactive DXF Piping Composite &amp; Component Dimension Viewer supporting ISO Metric (mm), U.S. Customary (Inches), and Inch Fractions.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">150+</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Components</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">Online &amp; Offline</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Access</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">Full ASME</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Size Ranges</div>
                </div>
              </div>
              <a
                href="https://pipespec.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-3 mx-auto w-full sm:w-auto sm:max-w-fit"
              >
                <PipespecIcon className="w-5 h-5" variant="white" />
                <span className="h-5 w-px bg-white/40" aria-hidden="true"></span>
                Open Pipespec
              </a>
            </div>
          </div>
        )} {profileTab === 'community' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-10 h-10 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Nova Community Hub</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">Connect with fellow engineers, share your FEA results, ask questions, and collaborate on complex structural analysis problems.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">500+</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Engineers</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">1.2k</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Discussions</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="font-black text-xl text-slate-800">Daily</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">New Resources</div>
                </div>
              </div>
              <button
                onClick={() => navigateMobileApp('nova_community', '/community')}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 mx-auto"
              >
                <Users className="w-5 h-5" /> Enter Nova Community
              </button>
            </div>
          </div>
        )} {profileTab === 'nova_help' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-10 h-10 text-[#1565c0]" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Nova Knowledge Base</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">Access comprehensive documentation, video tutorials, API references, and engineering guides for all Nova Analysis modules.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto mb-8 text-left">
                <div className="p-4 border border-slate-200 rounded-xl flex items-start gap-3">
                  <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                  <div>
                    <div className="font-bold text-slate-800 text-sm">Module Documentation</div>
                    <div className="text-xs text-slate-500 mt-0.5">Detailed input guidelines and result interpretations.</div>
                  </div>
                </div>
                <div className="p-4 border border-slate-200 rounded-xl flex items-start gap-3">
                  <Video className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <div className="font-bold text-slate-800 text-sm">Video Tutorials</div>
                    <div className="text-xs text-slate-500 mt-0.5">Step-by-step FEA workflow guides.</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => navigateMobileApp('nova_help', '/help')}
                className="px-8 py-3.5 bg-[#1565c0] hover:bg-[#0d47a1] text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 mx-auto"
              >
                <BookOpen className="w-5 h-5" /> Access Help Center
              </button>
            </div>
          </div>
        )}
          </div>
        </div> {isEditProfileOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setIsEditProfileOpen(false); try { window.history.pushState({ view: 'profile', tab: 'info' }, '', '/profile/info'); } catch (e) {} }}></div>
            <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 relative z-10">
              <div className="flex items-center justify-between px-6 py-5 bg-[#2874f0] text-white">
                <span className="flex items-center gap-2 font-black text-lg"><Settings className="w-5 h-5" /> Edit Profile</span>
                <button onClick={() => { setIsEditProfileOpen(false); try { window.history.pushState({ view: 'profile', tab: 'info' }, '', '/profile/info'); } catch (e) {} }} className="hover:bg-white/20 p-1.5 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleEditProfile} className="p-6 space-y-5">
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">Full Name</label>
                  <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required maxLength={100} placeholder="Your name" className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2874f0]" />
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">Email Address</label>
                  <input type="email" value={currentUser.email || ''} readOnly disabled className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500" />
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">Your sign-in email cannot be changed.</p>
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">Company / Institute</label>
                  <input type="text" value={editForm.company} onChange={e => setEditForm({ ...editForm, company: e.target.value })} required placeholder="e.g. Larsen and Toubro Ltd." className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2874f0]" />
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">Phone Number</label>
                  <input type="tel" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} required placeholder="+91 98765 43210" className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2874f0]" />
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => { setIsEditProfileOpen(false); try { window.history.pushState({ view: 'profile', tab: 'info' }, '', '/profile/info'); } catch (e) {} }} className="flex-1 py-3 border border-slate-300 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={isProfileSaving} className="flex-1 py-3 bg-[#2874f0] hover:bg-[#1a5dc9] text-white rounded-xl font-bold text-sm shadow-md disabled:cursor-not-allowed disabled:opacity-60">{isProfileSaving ? 'Saving…' : 'Save Changes'}</button>
                </div>
              </form>
            </div>
          </div>
        )} {isWizardDemoOpen && selectedWizardForDemo && (
          <div className="wizard-demo-overlay fixed inset-0 z-[150] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => closeWizardDemo()}></div>
            <div className="wizard-demo-dialog bg-slate-900 w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl relative z-10 animate-in zoom-in-95 border border-slate-700">
              <div className="wizard-demo-header flex items-center justify-between px-6 py-4 bg-slate-800 text-white border-b border-slate-700">
                <span className="flex items-center gap-3 font-bold text-lg">
                  <PlayCircle className="w-5 h-5 text-[#2874f0]" /> {selectedWizardForDemo.name.replace(/\s*\(\.WBEX\)/gi, '')} - Demo
                </span>
                <button onClick={() => closeWizardDemo()} className="hover:bg-slate-700 p-1.5 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-300" />
                </button>
              </div>
              <div className="p-0 bg-black relative aspect-video">
                <iframe
                  width="100%"
                  height="100%"
                  src="https://www.youtube.com/embed/A65i5WT83bs?autoplay=1"
                  title="Nova Wizard Demo"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                ></iframe>
              </div>
              <div className="px-6 py-4 bg-slate-800 border-t border-slate-700 text-slate-300 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="text-sm font-semibold">{selectedWizardForDemo.desc}</div>
                  <button
                    onClick={() => { closeWizardDemo(); openWizardPricing(selectedWizardForDemo); }}
                    className="px-6 py-2.5 bg-[#d84315] hover:bg-[#bf360c] text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2 shrink-0"
                  >
                    <ShoppingCart className="w-4 h-4" /> Buy
                  </button>
                </div>
                {(selectedWizardForDemo.id === 'stress_strain' || selectedWizardForDemo.curveTypes) && (
                  <div className="pt-2 border-t border-slate-700/70">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Supported Curve Types:</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {(selectedWizardForDemo.curveTypes || [
                        'True Stress-Strain',
                        'Cyclic Stress-Strain',
                        'Isochronous Stress-Strain',
                        'Tangent Modulus Stress-Strain'
                      ]).map((curve, ci) => (
                        <div key={ci} className="bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-700 text-emerald-400 font-medium text-center">
                          {curve}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )} {isWizardPricingOpen && selectedWizardForPricing && (
          <div className="wizard-pricing-overlay fixed inset-0 z-[150] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => closeWizardPricing()}></div>
            <div className="wizard-pricing-modal bg-white w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl relative z-10 animate-in zoom-in-95">
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                <span className="flex items-center gap-3 font-bold text-lg text-slate-900">
                  <Package className="w-5 h-5 text-[#d84315]" /> Select Subscription - {(selectedWizardForPricing.shortName || selectedWizardForPricing.name.split(' Ansys')[0]).replace(/\s*\(\.WBEX\)/gi, '')}
                </span>
                <button onClick={() => closeWizardPricing()} className="hover:bg-slate-100 p-1.5 rounded-full transition-colors text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="wizard-pricing-content p-6 bg-slate-50">
                <div className="wizard-pricing-intro text-center mb-6">
                  <h3 className="text-xl font-bold text-slate-900">Choose your licensing term</h3>
                  <p className="text-sm text-slate-500 mt-1">Unlock full access to {selectedWizardForPricing.name.replace(/\s*\(\.WBEX\)/gi, '')}</p>
                </div>
                <div className="wizard-pricing-grid grid grid-cols-1 md:grid-cols-3 gap-5">
                  {(selectedWizardForPricing.pricing || [
                    { term: '1 Month', price: '₹4,999', desc: 'Short-term access for single projects', workstations: 1, recommend: false },
                    { term: '3 Months', price: '₹12,499', desc: 'Ideal for extended engineering phases', workstations: 1, recommend: false },
                    { term: '6 Months', price: '₹19,999', desc: 'Best value for continuous usage', workstations: 2, recommend: true },
                  ]).map((plan, i) => {
                    return (
                      <div key={i} className={`wizard-pricing-card bg-white rounded-xl border-2 flex flex-col relative transition-all hover:shadow-lg ${plan.recommend ? 'border-[#d84315] shadow-md ring-4 ring-[#d84315]/10' : 'border-slate-200 hover:border-slate-300'}`}>
                        {plan.recommend && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#d84315] text-white text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                            Recommended
                          </div>
                        )}
                        <div className="p-5 flex-1 text-center flex flex-col justify-between">
                          <div>
                            <div className="wizard-pricing-term font-bold text-slate-500 text-sm mb-2">{plan.term} License</div>
                            <div className="wizard-pricing-price text-3xl font-black text-slate-900">{plan.price}</div>
                            <div className="text-[11px] text-slate-400 mt-1 mb-4">Includes 18% GST</div>
                            <div className="wizard-pricing-description text-xs text-slate-600 font-medium mb-3">{plan.desc}</div>
                            <div className="wizard-workstation-row flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-500 mb-5 bg-slate-50 py-1.5 rounded-lg border border-slate-100">
                              <Monitor className="w-3.5 h-3.5 text-[#2874f0]" /> {plan.workstations} Workstation{plan.workstations > 1 ? 's' : ''}
                            </div>
                          </div>
                          <div>
                            <button
                              disabled={isProcessingPayment}
                              onClick={() => {
                                closeWizardPricing();
                                handleRazorpayCheckout(
                                  `${selectedWizardForPricing.name} (${plan.term} License)`,
                                  plan.price,
                                  'wizard_purchase',
                                  {
                                    term: plan.term,
                                    workstations: plan.workstations,
                                    productName: selectedWizardForPricing.name,
                                    wizardId: selectedWizardForPricing.id,
                                    filename: selectedWizardForPricing.filename
                                  }
                                );
                              }}
                              className={`wizard-pricing-select w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60 ${plan.recommend ? 'bg-[#d84315] hover:bg-[#bf360c] text-white shadow-md' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                            >
                              <CreditCard className="w-4 h-4" /> {isProcessingPayment ? 'Preparing secure checkout...' : `Select ${plan.term}`}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-2">Secure Payments Via</span>
                  {['UPI', 'Visa', 'Mastercard', 'Net Banking', 'RuPay'].map(m => (
                    <span key={m} className="px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-500">{m}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )} {isChangePasswordOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setIsChangePasswordOpen(false); try { window.history.pushState({ view: 'profile', tab: 'security' }, '', '/profile/security'); } catch (e) {} }}></div>
            <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 relative z-10">
              <div className={`flex items-center justify-between px-6 py-5 text-white ${isPwdSuccess ? 'bg-[#388e3c]' : 'bg-[#d32f2f]'}`}>
                <span className="flex items-center gap-2 font-black text-lg">
                  {isPwdSuccess ? <CheckCircle className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  {isPwdSuccess ? 'Password Updated!' : 'Change Password'}
                </span>
                <button onClick={() => { setIsChangePasswordOpen(false); setPwdErrors({}); setPwdForm({ current: '', new: '', confirm: '' }); setIsPwdSuccess(false); try { window.history.pushState({ view: 'profile', tab: 'security' }, '', '/profile/security'); } catch (e) {} }} className="hover:bg-white/20 p-1.5 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handlePasswordChange} className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">New Password</label>
                  <div className="relative">
                    <input type={showPwd.new ? 'text' : 'password'} value={pwdForm.new} onChange={e => { setPwdForm({ ...pwdForm, new: e.target.value }); setPwdErrors({ ...pwdErrors, new: null }); }} required placeholder="Min 8 chars, 1 number, 1 symbol" className={`w-full px-4 py-3 border rounded-xl text-sm pr-12 focus:outline-none focus:ring-2 ${pwdErrors.new ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-[#2874f0]'}`} />
                    <button type="button" onClick={() => setShowPwd({ ...showPwd, new: !showPwd.new })} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">{showPwd.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                  {pwdErrors.new && <p className="text-xs text-red-500 mt-1">{pwdErrors.new}</p>}
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-1.5 block">Confirm New Password</label>
                  <div className="relative">
                    <input type={showPwd.confirm ? 'text' : 'password'} value={pwdForm.confirm} onChange={e => { setPwdForm({ ...pwdForm, confirm: e.target.value }); setPwdErrors({ ...pwdErrors, confirm: null }); }} required placeholder="Re-enter new password" className={`w-full px-4 py-3 border rounded-xl text-sm pr-12 focus:outline-none focus:ring-2 ${pwdErrors.confirm ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-[#2874f0]'}`} />
                    <button type="button" onClick={() => setShowPwd({ ...showPwd, confirm: !showPwd.confirm })} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">{showPwd.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                  {pwdErrors.confirm && <p className="text-xs text-red-500 mt-1">{pwdErrors.confirm}</p>}
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => { setIsChangePasswordOpen(false); try { window.history.pushState({ view: 'profile', tab: 'security' }, '', '/profile/security'); } catch (e) {} }} className="flex-1 py-3 border border-slate-300 text-slate-700 rounded-xl font-bold text-sm">Cancel</button>
                  <button type="submit" className={`flex-1 py-3 text-white rounded-xl font-bold text-sm shadow-md ${isPwdSuccess ? 'bg-[#388e3c]' : 'bg-[#d32f2f] hover:bg-[#c62828]'}`}>
                    {isPwdSuccess ? 'Updated!' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderLandingRoute = () => isMobileLandingViewport
    ? (
      <NovaLandingPage
        isAuthenticated={isLoggedIn}
        onSignIn={() => setCurrentView('login')}
        onDashboard={navigateToDashboard}
      />
    )
    : renderLanding();
  const mobilePrimaryDestinations = [
    { label: 'Home', view: 'dashboard', path: '/dashboard', icon: Home },
    { label: 'Nova Community', view: 'nova_community', path: '/community', icon: Users },
    {
      label: 'CAD AI',
      icon: Sparkles,
      action: () => consumeCredits('CAD AI', 75, 'Max', () => { window.location.href = 'https://space-geo.vercel.app/'; })
    },
    { label: 'Nova Help', view: 'nova_help', path: '/help', icon: BookOpen },
    { label: 'Profile', view: 'profile', path: '/profile', icon: User }
  ];
  const startProfileLongPress = () => {
    window.clearTimeout(profilePressTimerRef.current);
    suppressProfileClickRef.current = false;
    profilePressTimerRef.current = window.setTimeout(() => {
      suppressProfileClickRef.current = true;
      setMobilePopup('profile-preview');
    }, 550);
  };
  const cancelProfileLongPress = () => window.clearTimeout(profilePressTimerRef.current);
  const openProfileFromAvatar = () => {
    if (suppressProfileClickRef.current) {
      suppressProfileClickRef.current = false;
      return;
    }
    navigateMobileApp('profile', '/profile');
  };
  const openMobileAiRecommender = () => {
    setIsMobileAiRecommender(true);
    setIsAiModalOpen(true);
  };

  if (currentView === 'not_found') {
    return <><NotFoundPage /><SiteEnhancements /></>;
  }
  if (currentView === 'contact') {
    return <><ContactPage /><SiteEnhancements /></>;
  }

  return (
    <>
      <SiteEnhancements isSignupPage={currentView === 'signup'} />
      {isInitializing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 px-6" role="status" aria-label="Loading NOVA">
          <div className="w-full max-w-sm">
            <div className="mx-auto mb-8 h-12 w-12 animate-pulse rounded-2xl bg-blue-400/30" />
            <div className="mx-auto h-5 w-40 animate-pulse rounded bg-white/15" />
            <div className="mx-auto mt-3 h-3 w-56 animate-pulse rounded bg-white/10" />
            <div className="mt-9 space-y-3" aria-hidden="true">
              <div className="h-12 animate-pulse rounded-xl bg-white/10" />
              <div className="h-12 animate-pulse rounded-xl bg-white/10" />
              <div className="h-12 animate-pulse rounded-xl bg-white/10" />
            </div>
            <span className="sr-only">Loading your NOVA workspace…</span>
          </div>
        </div>
      )}
      <style>{`
        body { margin: 0; background: linear-gradient(135deg, #dbeafe 0%, #ccfbf1 40%, #dbeafe 100%); background-attachment: fixed; overflow-x: hidden; }
        * { -webkit-tap-highlight-color: transparent; }
        .auth-page { background: transparent; }
        .auth-card { background: rgba(255,255,255,0.92) !important; border: 1px solid rgba(255,255,255,0.9) !important; }
        .glass-input { background: rgba(255,255,255,0.85) !important; border: 1.5px solid #e2e8f0 !important; color: #1e293b; transition: all 0.2s; }
        .glass-input:focus { background: #ffffff !important; border-color: #2874f0 !important; box-shadow: 0 0 0 3px rgba(40,116,240,0.15) !important; }
        .glass-input::placeholder { color: #94a3b8; }
        .nova-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .nova-btn-primary { background: linear-gradient(135deg, #2874f0, #1a5dc9); color: #fff; border: none; font-weight: 700; border-radius: 10px; transition: all 0.2s; cursor: pointer; }
        .nova-btn-primary:hover { background: linear-gradient(135deg, #1a5dc9, #1148a3); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(40,116,240,0.35); }
        /* Avatar tap-to-change — works on all avatar wrappers */
        .tap-avatar-wrap { position: relative; cursor: pointer; display: inline-block; }
        .tap-avatar-wrap input[type=file] { display: none; }
        .tap-avatar-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; pointer-events: none; flex-direction: column; gap: 2px; }
        .tap-avatar-overlay svg { width: 20px; height: 20px; color: #fff; }
        .tap-avatar-overlay span { font-size: 10px; color: #fff; font-weight: 700; line-height: 1; }
        .tap-avatar-wrap:hover .tap-avatar-overlay, .tap-avatar-wrap:focus-within .tap-avatar-overlay { opacity: 1; }
        @media (hover: none) { .tap-avatar-wrap .tap-avatar-overlay { opacity: 1; background: rgba(0,0,0,0.3); } }
        /* Profile page cards */
        .profile-desktop-sidebar .bg-white, .profile-desktop-content .bg-white { box-shadow: 0 2px 10px rgba(0,0,0,0.07) !important; border-color: #e2e8f0 !important; }
        /* Mobile profile styles */
        .mobile-profile-root { background: linear-gradient(170deg, #dbeafe 0%, #ccfbf1 60%, #dbeafe 100%) !important; }
        .mobile-profile-overview { background: rgba(255,255,255,0.7) !important; backdrop-filter: blur(20px); border-radius: 0 0 24px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .mobile-profile-menu button { background: #ffffff !important; border-bottom: 1px solid #f1f5f9; }
        .mobile-profile-menu { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.07); margin: 0 16px; }
        .mobile-profile-menu-heading { color: #1e293b !important; font-size: 16px; font-weight: 800; padding: 20px 16px 8px; }
        .mobile-profile-identity h1 { color: #1e293b !important; font-weight: 800; }
        .mobile-profile-identity p { color: #64748b !important; }
        .mobile-profile-job-stats { background: rgba(255,255,255,0.6); border-radius: 14px; margin: 12px 0 0; padding: 10px 0; }
        .mobile-profile-job-stat strong { color: #1e293b !important; font-weight: 800; }
        .mobile-profile-job-stat span { color: #64748b !important; }
        .mobile-profile-signout { color: #ef4444 !important; border-top: 1.5px solid #fee2e2 !important; }
        /* Auth inputs and labels */
        label.text-sm.font-bold { color: #374151 !important; }
        .glass-btn-blue { background: linear-gradient(135deg, #2874f0 0%, #1a5dc9 100%) !important; box-shadow: 0 4px 14px rgba(40,116,240,0.35) !important; }
        .glass-btn-green { background: linear-gradient(135deg, #16a34a 0%, #059669 100%) !important; box-shadow: 0 4px 14px rgba(22,163,74,0.3) !important; }
        /* Stat cards */
        .nova-stat-total { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
        .nova-stat-completed { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
        .nova-stat-processing { background: #eef2ff; border: 1px solid #c7d2fe; color: #4338ca; }
        .nova-stat-pending { background: #fffbeb; border: 1px solid #fde68a; color: #b45309; }
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(40px, -60px) scale(1.1); }
          66% { transform: translate(-30px, 30px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 10s infinite alternate; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
        .glass-panel {
          background: rgba(255, 255, 255, 0.45);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-top: 1px solid rgba(255, 255, 255, 0.8);
          border-left: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
        }
        .glass-dark {
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-top: 1px solid rgba(255, 255, 255, 0.2);
        }
        .glass-input {
          background: rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow: inset 0 2px 5px rgba(0,0,0,0.03);
        }
        .glass-input:focus {
          background: rgba(255, 255, 255, 0.8);
          border-color: #3b82f6;
          box-shadow: inset 0 2px 5px rgba(0,0,0,0.02), 0 0 0 3px rgba(59, 130, 246, 0.3);
        }
        .glass-btn-blue {
          background: linear-gradient(135deg, rgba(60, 100, 214, 0.85), rgba(37, 99, 235, 0.85));
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 4px 15px rgba(60, 100, 214, 0.3);
          position: relative;
          overflow: hidden;
        }
        .glass-btn-green {
          background: linear-gradient(135deg, rgba(22, 163, 74, 0.85), rgba(5, 150, 105, 0.85));
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 4px 15px rgba(22, 163, 74, 0.3);
          position: relative;
          overflow: hidden;
        }
        .glass-btn-orange {
          background: linear-gradient(135deg, rgba(234, 88, 12, 0.85), rgba(194, 65, 12, 0.85));
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 4px 15px rgba(234, 88, 12, 0.3);
          position: relative;
          overflow: hidden;
        }
        .glass-btn-blue::after, .glass-btn-green::after, .glass-btn-orange::after {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 50%; height: 100%;
          background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%);
          transform: skewX(-20deg);
          transition: left 0.7s ease;
        }
        .glass-btn-blue:hover::after, .glass-btn-green:hover::after, .glass-btn-orange:hover::after {
          left: 200%;
        }
      `}</style>

      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[55%] bg-blue-300/30 rounded-full mix-blend-multiply filter blur-[120px] animate-blob"></div>
        <div className="absolute top-[15%] right-[-15%] w-[65%] h-[65%] bg-teal-300/25 rounded-full mix-blend-multiply filter blur-[120px] animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-20%] left-[15%] w-[65%] h-[65%] bg-cyan-300/20 rounded-full mix-blend-multiply filter blur-[120px] animate-blob animation-delay-4000"></div>
      </div>   {(activeDocumentViewer || completedInvoice) && (() => {
        const docData = activeDocumentViewer?.data || completedInvoice;
        const docMode = activeDocumentViewer?.type || 'invoice';

        const docAmt = Number(docData?.amountInINR || docData?.amount || 4980);
        const docBaseAmt = docData?.baseAmount || docData?.base_amount || (docAmt ? Math.round(docAmt / 1.18) : 4220);
        const docGstAmt = docAmt - docBaseAmt;
        const docCgst = (docData?.cgst !== undefined && docData?.cgst !== null) ? docData.cgst : Math.round(docGstAmt / 2);
        const docSgst = (docData?.sgst !== undefined && docData?.sgst !== null) ? docData.sgst : (docGstAmt - docCgst);

        const docInvId = docData?.invoiceId || docData?.invoice_no || 'INV-2026-940221';
        const docRcpId = docData?.receiptNo || docData?.receipt_no || (docInvId ? String(docInvId).replace('INV-', 'RCP-') : 'RCP-2026-940221');
        const docPaymentId = docData?.paymentId || docData?.transaction_id || 'PAY-RAZORPAY-16940220';
        const docDateStr = docData?.date || (docData?.created_at ? new Date(docData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '04 Oct 2026, 05:59 PM');

        const docCustomerName = docData?.customerName || docData?.user_name || currentUser?.name || 'Dinesh Kumar';
        const docCustomerEmail = docData?.customerEmail || docData?.user_email || currentUser?.email || '';

        const docProductName = String(docData?.productName || docData?.plan_name || 'Nova Max').replace(/\s*\(\.WBEX\)/gi, '');
        const docTerm = docData?.term || docData?.billing_cycle || (String(docProductName).includes('Wizard') ? '6 Months License' : 'Monthly Subscription');

        return (
          <div className="fixed inset-0 z-[1200] bg-slate-900/80 backdrop-blur-sm overflow-y-auto overflow-x-hidden p-3 sm:p-6 pb-6 print:p-0 print:bg-white print:static animate-in fade-in">
            <div className="max-w-[800px] w-full mx-auto flex flex-col items-center">
              {/* Top Control Bar (print-hidden) */}
              <div className="invoice-modal-bar w-full flex items-center justify-between gap-3 bg-white px-5 py-3 rounded-2xl shadow-xl border border-slate-200 mb-6 sticky top-2 z-20 print:hidden">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openDocumentViewer(docData, 'invoice')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      docMode === 'invoice'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" /> Tax Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => openDocumentViewer(docData, 'receipt')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      docMode === 'receipt'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Receipt className="w-3.5 h-3.5" /> Payment Receipt
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeDocumentViewer}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Close document viewer"
                  >
                    <X className="w-4 h-4" /> Close
                  </button>
                </div>
              </div>

              {/* Authentic Invoice / Receipt Container */}
              <div className="invoice-container shadow-2xl mb-10 print:mb-0 print:shadow-none" id="invoice-printable">
                <div className="content-wrapper">
                  {/* Header */}
                  <div className="header">
                    <div className="logo-section">
                      <div className="logo-icon">N</div>
                      <div>
                        <div className="company-title">NOVA AI</div>
                        <div className="company-subtitle">Smarter Analytics. Bigger Decisions.</div>
                      </div>
                    </div>
                  </div>

                  {/* Title */}
                  <h1>{docMode === 'receipt' ? 'Payment Receipt' : 'Tax Invoice'}</h1>

                  {/* Invoice Info */}
                  <div className="info-grid">
                    {docMode === 'receipt' ? (
                      <>
                        <span className="info-label">Receipt Number</span> <span className="info-value">{docRcpId}</span>
                        <span className="info-label">Invoice Number</span> <span className="info-value">{docInvId}</span>
                        <span className="info-label">Date of Payment</span> <span className="info-value">{docDateStr}</span>
                      </>
                    ) : (
                      <>
                        <span className="info-label">Invoice Number</span> <span className="info-value">{docInvId}</span>
                        <span className="info-label">Date of Issue</span> <span className="info-value">{docDateStr}</span>
                        <span className="info-label">Due Date</span> <span className="info-value">{docDateStr}</span>
                      </>
                    )}
                  </div>

                  <div className="divider"></div>

                  {/* Addresses */}
                  <div className="address-grid">
                    <div className="address-left">
                      <div className="section-title">Billed To</div>
                      <div className="address-name">{docCustomerName}</div>
                      <div>{docCustomerEmail}</div>
                      <div>Not Provided</div>
                      <div>Not Provided</div>
                      <div>India</div>
                    </div>

                    <div className="address-right">
                      <div className="section-title">From</div>
                      <div className="address-name">Nova AI Technologies</div>
                      <div>Nova AI, Surat, Gujarat 395003, India</div>

                      <div className="company-details-grid">
                        <div className="company-details-label">GSTIN</div>
                        <div>: 07AABCN1234F1Z5</div>
                        <div className="company-details-label">CIN</div>
                        <div>: UT2900DL2024PTC123456</div>
                        <div className="company-details-label">HSN / SAC Code</div>
                        <div>: 998313</div>
                      </div>

                      <a href="mailto:analysis.ai.nova@gmail.com" className="icon-text">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                        </svg>
                        analysis.ai.nova@gmail.com
                      </a>
                    </div>
                  </div>

                  <div className="divider"></div>

                  {/* Summary */}
                  <h2>{docMode === 'receipt' ? 'Receipt Summary' : 'Invoice Summary'}</h2>
                  <div className="summary-subtitle">
                    ₹{docAmt.toLocaleString('en-IN')}{' '}
                    <span>{docMode === 'receipt' ? `paid on ${docDateStr}` : `due ${docDateStr}`}</span>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="col-qty">Qty</th>
                        <th className="col-price">Unit price</th>
                        <th className="col-tax">Tax</th>
                        <th className="col-amount">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div style={{ fontWeight: 600, color: '#111827', marginBottom: '4px' }}>{docProductName}</div>
                          <div style={{ color: '#6b7280', fontSize: '12px' }}>{docTerm}</div>
                        </td>
                        <td>1</td>
                        <td>₹{docBaseAmt.toLocaleString('en-IN')}</td>
                        <td>18% GST</td>
                        <td className="col-amount">₹{docAmt.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="calc-row">
                        <td colSpan="4" className="calc-label">Subtotal</td>
                        <td className="calc-value">₹{docBaseAmt.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="calc-row">
                        <td colSpan="4" className="calc-label">Total excluding tax</td>
                        <td className="calc-value">₹{docBaseAmt.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="calc-row">
                        <td colSpan="4" className="calc-label">CGST (9%)</td>
                        <td className="calc-value">₹{docCgst.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="calc-row">
                        <td colSpan="4" className="calc-label">SGST (9%)</td>
                        <td className="calc-value">₹{docSgst.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="total-row">
                        <td colSpan="4" className="calc-label">Total (incl. 18% GST)</td>
                        <td className="calc-value">₹{docAmt.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr className="amount-paid-row">
                        <td colSpan="4" className="calc-label">Amount paid</td>
                        <td className="calc-value" style={{ fontWeight: 600 }}>₹{docAmt.toLocaleString('en-IN')}</td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="divider"></div>

                  {/* Payment Details */}
                  <h2>Payment Details</h2>
                  <div className="payment-grid">
                    <span className="info-label">Payment ID</span> <span className="info-value">{docPaymentId}</span>
                    <span className="info-label">Gateway</span> <span className="info-value">{docData?.gateway || 'Razorpay (Live Verified)'}</span>
                    <span className="info-label">Method</span> <span className="info-value">{docData?.method || 'UPI / Cards / NetBanking'}</span>
                    <span className="info-label">Status</span>
                    <span>
                      <div className="badge-paid">
                        <svg style={{ width: '10px', height: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                        </svg>
                        PAID
                      </div>
                    </span>
                  </div>

                  {/* If Ansys ACT license is attached */}
                  {docData?.licenseKey && (
                    <div style={{ marginTop: '10px', marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>Commercial Ansys ACT Extension Deliverable</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', color: '#475569' }}>
                        <span>License Key: <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{docData.licenseKey}</strong></span>
                        {docData.expiryDate && <span>Expiry Date: <strong style={{ color: '#0f172a' }}>{docData.expiryDate}</strong></span>}
                        {docData.wbexFilename && <span>Binary Package: <strong style={{ color: '#0f172a' }}>{docData.wbexFilename}</strong></span>}
                      </div>
                    </div>
                  )}

                  {/* Dynamic flexbox footer */}
                  <div className="footer">
                    <div>
                      <div className="footer-company">Nova AI</div>
                      <div>Smarter Analytics. Bigger Decisions.</div>
                    </div>
                    <div className="footer-links">
                      <a href="https://nova-analysis.vercel.app" target="_blank" rel="noopener noreferrer" className="footer-link">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path>
                        </svg>
                        nova-analysis.vercel.app
                      </a>
                      <div className="vert-divider"></div>
                      <a href="mailto:analysis.ai.nova@gmail.com" className="footer-link">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                        </svg>
                        analysis.ai.nova@gmail.com
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Close Button for effortless navigation after scrolling */}
              <div className="w-full text-center pb-12 print:hidden">
                <button
                  type="button"
                  onClick={closeDocumentViewer}
                  className="px-6 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs shadow-lg border border-slate-200 transition-all cursor-pointer inline-flex items-center gap-2"
                >
                  <X className="w-4 h-4" /> Close Document
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showSplash && renderSplash()}
      {!showSplash && (
        <>
          {!isLoggedIn && currentView === 'mobile_landing' && renderLandingRoute()}
          {currentView === 'login' && renderLogin()}
          {currentView === 'signup' && renderSignup()}
          {currentView === 'forgot' && renderForgotPassword()}
          {isLoggedIn && (
            <div
              className={`mobile-root-shell${hasMobileModalOpen ? ' has-active-mobile-modal' : ''}`}
              onTouchStart={handleMobileSwipeStart}
              onTouchEnd={handleMobileSwipeEnd}
            >
              {currentView === 'dashboard' && <header className={`mobile-app-bar${isMobileAppBarHidden ? ' is-hidden' : ''}`} aria-label="Quick actions">
                <button
                  type="button"
                  className="mobile-greeting-avatar"
                  aria-label="Open profile; press and hold to preview profile picture"
                  onPointerDown={startProfileLongPress}
                  onPointerUp={cancelProfileLongPress}
                  onPointerLeave={cancelProfileLongPress}
                  onPointerCancel={cancelProfileLongPress}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    cancelProfileLongPress();
                    suppressProfileClickRef.current = true;
                    setMobilePopup('profile-preview');
                  }}
                  onClick={openProfileFromAvatar}
                >
                  {currentUser.avatar
                    ? <img src={currentUser.avatar} alt="" loading="lazy" decoding="async" />
                    : <span>{currentUser.initial || currentUser.name?.slice(0, 1) || 'N'}</span>
                  }
                </button>
                <div className="mobile-greeting-copy">
                  <strong>{`${new Date().getHours() < 12 ? 'Good Morning' : new Date().getHours() < 17 ? 'Good Afternoon' : 'Good Evening'}, ${currentUser.name?.trim().split(/\s+/)[0] || 'there'}`}</strong>
                  <span>Ready to get stronger today?</span>
                </div>
                <div className="mobile-quick-actions">
                  <button
                    type="button"
                    className="mobile-quick-action mobile-notification-action"
                    aria-label="Open Activity and Alerts Log"
                    onClick={() => setMobilePopup('alerts')}
                  >
                    <Bell aria-hidden="true" />
                    {persistentNotifications.some((item) => !item.read) && <span className="mobile-notification-dot" />}
                  </button>
                  <button
                    type="button"
                    className="mobile-quick-action mobile-ai-action"
                    aria-label="Open AI Analysis Recommender"
                    onClick={openMobileAiRecommender}
                  >
                    <Sparkles aria-hidden="true" />
                  </button>
                </div>
              </header>}

              <div className={`mobile-root-content${currentView === 'mobile_landing' ? ' is-public-mobile-landing' : ''}`}>
                {currentView === 'mobile_landing' && renderLandingRoute()}
                {currentView === 'landing' && renderLanding()}
                {currentView === 'dashboard' && renderDashboard()}
                {currentView === 'profile' && renderProfile()}
                {currentView === 'nova_help' && renderNovaHelp()}
                {currentView === 'nova_community' && renderNovaCommunity()}
                {currentView === 'chat' && renderChat()}
                {currentView === 'materials' && renderMaterials()}
                {currentView === 'stress_strain' && renderStressStrain()}
                {currentView === 'wizard_demo' && renderWizardDemo()}
              </div>

              {currentView !== 'mobile_landing' && (
                <nav className="mobile-bottom-navigation" aria-label="Primary navigation">
                  {mobilePrimaryDestinations.map(({ label, view, path, tab, icon: Icon, action }) => (
                    <button
                      type="button"
                      key={label}
                      className={`mobile-bottom-link ${view && currentView === view ? 'is-active' : ''}`}
                      aria-label={label}
                      aria-current={view && currentView === view ? 'page' : undefined}
                      onClick={action || (() => navigateMobileApp(view, path, tab))}
                    >
                      <span className="mobile-bottom-icon-wrap"><Icon aria-hidden="true" /></span>
                    </button>
                  ))}
                </nav>
              )}
            </div>
          )}
          {!isLoggedIn && !['mobile_landing', 'login', 'signup', 'forgot'].includes(currentView) && renderLogin()}
        </>
      )}
      {notification && typeof document !== 'undefined' && createPortal(
        <div
          className={`app-alert-toast fixed top-4 right-4 px-4 md:px-6 py-4 rounded-2xl shadow-xl text-white font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-4 backdrop-blur-md border border-white/20 ${currentView === 'profile' ? 'text-sm rounded-xl px-5 py-3.5 shadow-2xl border' : ''} ${notification.type === 'success' ? (currentView === 'profile' ? 'bg-[#388e3c] border-[#2e7d32]' : 'bg-emerald-600/90') : notification.type === 'info' ? (currentView === 'profile' ? 'bg-[#1976d2] border-[#1565c0]' : 'bg-blue-600/90') : (currentView === 'profile' ? 'bg-[#d32f2f] border-[#c62828]' : 'bg-slate-800/90')}`}
          role="status"
          aria-live="polite"
        >
          <CheckCircle className="w-5 h-5 shrink-0" /> {notification.message}
        </div>,
        document.body
      )}
      {isLoggedIn && mobilePopup && typeof document !== 'undefined' && createPortal(
        <div className="mobile-quick-popup-layer">
          <button
            type="button"
            className="mobile-quick-popup-backdrop"
            aria-label="Close popup"
            onClick={() => setMobilePopup(null)}
          />
          {mobilePopup === 'alerts' ? (
            <section className="mobile-quick-popup-card mobile-alerts-card" role="dialog" aria-modal="true" aria-labelledby="mobile-alerts-title">
              <header className="mobile-popup-heading">
                <div className="mobile-popup-heading-icon mobile-popup-bell"><Bell aria-hidden="true" /></div>
                <div>
                  <h2 id="mobile-alerts-title">Activity &amp; Alerts Log</h2>
                  <p>Recent activity and account updates</p>
                </div>
                <button type="button" className="mobile-popup-close" aria-label="Close alerts" onClick={() => setMobilePopup(null)}><X aria-hidden="true" /></button>
              </header>
              <div className="mobile-alert-list">
                {persistentNotifications.length ? persistentNotifications.map((item) => (
                  <article className="mobile-alert-item" key={item.id}>
                    <span className={`mobile-alert-item-icon ${item.type === 'success' ? 'is-success' : item.type === 'error' ? 'is-error' : ''}`}>
                      {item.type === 'success' ? <CheckCircle aria-hidden="true" /> : item.type === 'error' ? <AlertCircle aria-hidden="true" /> : <Bell aria-hidden="true" />}
                    </span>
                    <span className="mobile-alert-item-copy">
                      <span className="mobile-alert-item-title">{item.title}</span>
                      <span className="mobile-alert-item-message">{item.message}</span>
                    </span>
                    <time>{item.time || 'Today'}</time>
                  </article>
                )) : <p className="mobile-alert-empty">No alerts or notifications recorded yet.</p>}
              </div>
              {persistentNotifications.length > 0 && (
                <button
                  type="button"
                  className="mobile-alert-clear"
                  onClick={() => {
                    setPersistentNotifications([]);
                    try { localStorage.removeItem('nova_persistent_notifications'); } catch (error) { console.error('Unable to clear saved notifications.', error); }
                    showNotification('Alert history cleared', 'info');
                  }}
                >
                  Clear Log
                </button>
              )}
            </section>
          ) : (
            <section className="mobile-profile-preview-card" role="dialog" aria-modal="true" aria-label={`${currentUser.name || 'User'} profile picture`}>
              <button type="button" className="mobile-popup-close" aria-label="Close profile picture preview" onClick={() => setMobilePopup(null)}><X aria-hidden="true" /></button>
              <div className="mobile-profile-preview-ring">
                <div className="mobile-profile-preview-image">
                  {currentUser.avatar
                    ? <img src={currentUser.avatar} alt={`${currentUser.name || 'User'} profile`} loading="lazy" decoding="async" />
                    : <span>{currentUser.initial || currentUser.name?.slice(0, 1) || 'N'}</span>
                  }
                </div>
              </div>
              <strong>{currentUser.name || 'Nova User'}</strong>
              <span>{currentUser.email}</span>
            </section>
          )}
        </div>,
        document.body
      )}
      {isLoggedIn && isAiModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="mobile-ai-modal-layer fixed inset-0 z-[1300] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" aria-label="Close AI Analysis Recommender" onClick={closeAiModal} />
          <section className="mobile-ai-modal-card glass-panel w-full max-w-2xl rounded-[2.5rem] overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 relative z-10 shadow-[0_20px_60px_rgba(0,0,0,0.2)] border-t border-l border-white/80" role="dialog" aria-modal="true" aria-labelledby="mobile-ai-title">
            <header className="flex items-center justify-between p-4 md:p-6 text-white border-b bg-gradient-to-r from-purple-600/90 to-indigo-600/90 backdrop-blur-md border-white/20">
              <h2 id="mobile-ai-title" className="flex items-center gap-3 text-xl font-extrabold drop-shadow-sm">
                <Sparkles className="w-6 h-6" /> AI Analysis Recommender
              </h2>
              <button type="button" onClick={closeAiModal} aria-label="Close AI Analysis Recommender" className="hover:bg-white/20 p-1.5 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="flex-1 p-4 md:p-8 space-y-6 overflow-y-auto">
              <div className="bg-white/40 border border-white/50 backdrop-blur-md rounded-2xl p-4 md:p-6 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)]">
                <p className="pl-1 mb-3 text-sm font-bold text-purple-900 drop-shadow-sm">Describe your engineering scenario below:</p>
                <textarea
                  className="w-full h-20 md:h-32 p-4 text-sm font-medium resize-none glass-input rounded-xl focus:ring-purple-500/50"
                  placeholder="E.g., I have a high-pressure steam pipe attached to a thin-walled cylindrical vessel. I need to know if the junction is safe."
                  value={aiSetupPrompt}
                  onChange={(event) => setAiSetupPrompt(event.target.value)}
                />
                <div className="flex justify-end mt-4">
                  <button
                    type="button"
                    onClick={handleAiSetupSubmit}
                    disabled={isAiSetupLoading || !aiSetupPrompt.trim()}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 text-white text-sm font-bold py-3 px-4 md:px-6 rounded-xl flex items-center gap-2 transition-all hover:scale-[1.02] shadow-md"
                  >
                    {isAiSetupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isAiSetupLoading ? 'Analyzing...' : 'Analyze Scenario'}
                  </button>
                </div>
              </div>
              {aiSetupResponse && (
                <div className="p-4 md:p-8 shadow-sm glass-panel border-purple-500/30 rounded-2xl animate-in fade-in slide-in-from-bottom-4 bg-white/60">
                  <h3 className="flex items-center gap-2 mb-4 text-xs font-black tracking-widest text-purple-800 uppercase drop-shadow-sm">
                    <Bot className="w-4 h-4" /> AI Recommendation
                  </h3>
                  <div className="text-sm font-medium leading-relaxed whitespace-pre-wrap text-slate-800">{aiSetupResponse}</div>
                </div>
              )}
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}

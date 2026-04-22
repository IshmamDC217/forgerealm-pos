// Base URL for the POS API.
// In dev, leave VITE_API_URL unset so Vite's proxy forwards /api to the local
// Express server. In production builds (Netlify, Capacitor Android) set it to
// the absolute deployed URL.
export const API_BASE: string = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

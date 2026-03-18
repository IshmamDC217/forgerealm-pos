<p align="center">
  <img src="client/public/logo.png" alt="ForgeRealm POS" width="120" height="120" />
</p>

<h1 align="center">ForgeRealm POS</h1>

<p align="center">
  <strong>Real-time stall sales tracker with style.</strong><br/>
  A sleek, dark-themed point-of-sale system built for tracking live event and market stall sales.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express-4-000000?style=flat-square&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Framer_Motion-12-FF0055?style=flat-square&logo=framer&logoColor=white" alt="Framer Motion" />
</p>

---

## Overview

ForgeRealm POS is a full-stack sales tracking application designed for market stalls, pop-up shops, and live events. It features a navy & gold glassmorphism UI with smooth animations, real-time analytics, and professional Excel exports.

## Features

- **Session Management** — Create, edit, close, and delete sales sessions per event or stall
- **Live Sales Recording** — Tap products from a categorised grid, set quantity & price, and log instantly
- **Cash & Card Tracking** — Tag each sale as cash or card with a single toggle
- **SumUp Card Fee Deduction** — One-click toggle to apply 1.69% card processing fees across a session
- **Real-time Analytics** — Revenue, units sold, best-selling product, and per-product breakdowns
- **Sale Editing & Undo** — Modify or remove any recorded sale on the fly
- **Professional Exports** — Download session reports as styled XLSX (with summary + detail sheets) or CSV
- **Product Catalog** — Manage your product library with names, default prices, and categories
- **JWT Authentication** — Single-user login with bcrypt-hashed credentials
- **Animated UI** — Framer Motion page transitions, hover effects, shimmer, and glow animations
- **Responsive** — Works on desktop and mobile with collapsible sidebar

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion |
| Backend | Node.js, Express, TypeScript (tsx) |
| Database | PostgreSQL (Neon) |
| Auth | JWT + bcrypt |
| Export | ExcelJS |
| Hosting | Render (free tier) |

## Theme

Built around a **navy & gold** palette with glassmorphism effects:

```
Navy        #0a1628     — primary background
Navy Light  #0f1d32     — elevated surfaces
Gold        #d4a843     — accent, buttons, branding
Gold Light  #e4c373     — hover states
Surface     #111827     — cards, panels
Glass       rgba(255,255,255,0.03) + backdrop-blur
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (or a [Neon](https://neon.tech) free tier)

### Setup

```bash
# Clone the repo
git clone https://github.com/IshmamDC217/forgerealm-pos.git
cd forgerealm-pos

# Install all dependencies (root, server, client)
npm run install:all

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your DATABASE_URL and JWT_SECRET
```

### Environment Variables

Create `server/.env`:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
JWT_SECRET=your-secret-key
```

### Database Setup

```bash
# Run migrations (creates tables)
npm run migrate

# Create login credentials
cd server && npx tsx db/create-user.ts <username> <password>
```

### Development

```bash
npm run dev
```

This starts both the server (port 3001) and client (port 5173) concurrently.

### Production Build

```bash
npm run build    # Builds the React client
npm start        # Starts the Express server (serves client from dist/)
```

## API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate and receive JWT |
| `GET` | `/api/health` | Service health check |

### Protected (Bearer token required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/me` | Current user info |
| `GET` | `/api/sessions` | List all sessions with stats |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id` | Session details with analytics |
| `PATCH` | `/api/sessions/:id` | Update session |
| `DELETE` | `/api/sessions/:id` | Delete session (cascades) |
| `GET` | `/api/products` | List all products |
| `POST` | `/api/products` | Create product |
| `PATCH` | `/api/products/:id` | Update product |
| `DELETE` | `/api/products/:id` | Delete product |
| `GET` | `/api/sales/session/:id` | Sales for a session |
| `POST` | `/api/sales` | Record a sale |
| `PATCH` | `/api/sales/:id` | Edit a sale |
| `DELETE` | `/api/sales/:id` | Delete a sale |
| `GET` | `/api/export/:id?format=xlsx` | Export session as Excel |
| `GET` | `/api/export/:id?format=csv` | Export session as CSV |

## Project Structure

```
forgerealm-pos/
├── client/
│   ├── public/
│   │   └── logo.png
│   ├── src/
│   │   ├── components/       # Sidebar, HomeButton, PageTransition
│   │   ├── contexts/         # AuthContext, SessionsContext
│   │   ├── pages/            # Welcome, SessionView, Products, Login
│   │   ├── utils/            # API client, currency formatter
│   │   ├── App.tsx
│   │   └── index.css         # Tailwind + custom animations
│   └── tailwind.config.ts
├── server/
│   ├── db/
│   │   ├── index.ts          # PostgreSQL pool
│   │   ├── migrate.ts        # Schema migrations
│   │   ├── seed.ts           # Sample data seeder
│   │   └── create-user.ts    # User creation script
│   ├── middleware/
│   │   └── auth.ts           # JWT verification
│   ├── routes/
│   │   ├── auth.ts           # Login endpoints
│   │   ├── sessions.ts       # Session CRUD
│   │   ├── products.ts       # Product CRUD
│   │   ├── sales.ts          # Sales CRUD
│   │   └── export.ts         # XLSX/CSV generation
│   └── index.ts              # Express app entry
├── render.yaml               # Render deployment config
└── package.json
```

## Deployment

Configured for [Render](https://render.com) with a Neon PostgreSQL database.

The `render.yaml` blueprint handles:
- Installing dependencies
- Building the React client
- Running database migrations
- Creating the initial user (via `POS_ADMIN_USER` / `POS_ADMIN_PASS` env vars)

Required Render environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `POS_ADMIN_USER` | Login username |
| `POS_ADMIN_PASS` | Login password |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server + client |
| `npm run build` | Build client for production |
| `npm start` | Start production server |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed sample data |
| `npm run create-user` | Create a login user |

---

<p align="center">
  <img src="client/public/logo.png" alt="ForgeRealm" width="32" height="32" /><br/>
  <sub>Built by <strong>Ishmam Ahmed</strong></sub>
</p>

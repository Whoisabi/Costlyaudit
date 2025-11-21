# CostlyAgent

## Overview

CostlyAgent is a full-stack web application for analyzing and optimizing AWS infrastructure costs using Steampipe, Powerpipe, and the AWS Thrifty mod. The application provides an interactive dashboard for running cost optimization benchmarks, visualizing data, and identifying potential savings across AWS resources.

**Core Purpose**: Enable users to discover cost optimization opportunities across 15 benchmarks and 41 controls by connecting their AWS accounts and running automated cost analysis scans.

**Key Features**:
- Multi-account AWS credential management with encrypted storage
- Real-time benchmark and control execution
- Interactive data visualization dashboards
- SQL query explorer for custom Steampipe queries
- Resource drill-down with savings recommendations
- User authentication via Replit OAuth

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack**:
- React 18 with TypeScript
- Vite for build tooling and development server
- Wouter for client-side routing
- TanStack Query for server state management
- shadcn/ui component library with Radix UI primitives

**Design System**:
- Based on Carbon Design System (IBM) for enterprise-grade data presentation
- IBM Plex Sans typography via Google Fonts
- Tailwind CSS for styling with custom theme configuration
- Dark/light theme support with context-based theme provider
- Custom color tokens defined in CSS variables

**State Management**:
- TanStack Query (React Query) for API data fetching and caching
- React Context for theme state
- Form state managed via react-hook-form with zod validation

**Component Organization**:
- Page components in `client/src/pages/`
- Reusable UI components in `client/src/components/ui/`
- Custom hooks in `client/src/hooks/`
- Shared utilities in `client/src/lib/`

### Backend Architecture

**Technology Stack**:
- Node.js with Express.js server
- TypeScript with ES modules
- Drizzle ORM for database operations
- Neon serverless PostgreSQL driver

**API Structure**:
- RESTful API endpoints under `/api` prefix
- Authentication middleware protecting all routes except `/api/login`
- Session-based authentication using express-session with PostgreSQL session store

**Key API Endpoints**:
- `/api/auth/user` - Fetch authenticated user profile
- `/api/aws-accounts` - CRUD operations for AWS account credentials
- `/api/dashboard/stats` - Dashboard statistics and metrics
- `/api/benchmarks` - Benchmark execution and results
- `/api/resources` - Resource listing and details
- `/api/queries/*` - SQL query execution and history

**Authentication Flow**:
- OpenID Connect (OIDC) integration with Replit Auth
- Passport.js strategy for OAuth handling
- Session management with PostgreSQL-backed session store
- User profile data synchronized to local database

**Security Measures**:
- AWS credentials encrypted using AES-256-CBC
- Encryption key derived from SESSION_SECRET environment variable
- Credentials never returned in plaintext via API (masked as "***ENCRYPTED***")
- Session cookies with httpOnly and secure flags
- CSRF protection via session secret

### Data Storage Solutions

**Database**: PostgreSQL (via Neon serverless)

**Schema Design** (defined in `shared/schema.ts`):

1. **sessions** - Express session storage (required for auth)
   - Primary key: sid (session ID)
   - Contains serialized session data and expiration

2. **users** - User profiles from Replit OAuth
   - Fields: email, firstName, lastName, profileImageUrl
   - Timestamps: createdAt, updatedAt

3. **awsAccounts** - AWS account credentials per user
   - Foreign key to users table with cascade delete
   - Encrypted secretAccessKey field
   - Fields: nickname, accessKeyId, region, isActive
   - Supports multi-account management per user

4. **benchmarkResults** - Results from benchmark executions
   - Stores benchmark outcomes and metadata

5. **controlResults** - Individual control check results
   - Granular results from AWS Thrifty controls

6. **queryHistory** - SQL query execution history
   - Tracks user queries for audit and reuse

**ORM Layer**:
- Drizzle ORM for type-safe database queries
- Schema validation using drizzle-zod
- Migration management via drizzle-kit

### External Dependencies

**Third-Party Services**:

1. **Replit Authentication**
   - OpenID Connect provider for user authentication
   - Issuer URL: `https://replit.com/oidc` (configurable via ISSUER_URL)
   - Provides user profile data (email, name, avatar)

2. **Neon Database**
   - Serverless PostgreSQL hosting
   - WebSocket-based connection pooling
   - Connection string via DATABASE_URL environment variable

**External Tools** (Referenced but not yet integrated):

1. **Steampipe**
   - CLI tool for querying cloud infrastructure as SQL
   - Expected to be executed programmatically from backend
   - AWS plugin integration for account scanning

2. **Powerpipe**
   - Dashboard and benchmark execution engine
   - AWS Thrifty mod for cost optimization checks
   - Expected integration: 15 benchmarks, 41 controls

**Required Environment Variables**:
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret for session encryption and AWS credential encryption
- `REPL_ID` - Replit application identifier
- `ISSUER_URL` - OAuth issuer URL (optional, defaults to Replit)

**NPM Dependencies**:
- `@neondatabase/serverless` - Neon PostgreSQL driver
- `drizzle-orm` - Database ORM
- `express` - Web server framework
- `passport` & `openid-client` - OAuth authentication
- `connect-pg-simple` - PostgreSQL session store
- `@radix-ui/*` - UI primitive components
- `@tanstack/react-query` - Data fetching library
- `recharts` - Data visualization library
- `react-hook-form` & `zod` - Form handling and validation
- `tailwindcss` - Utility-first CSS framework

**Design Assets**:
- Google Fonts CDN for IBM Plex Sans and IBM Plex Mono
- Custom favicon in `/favicon.png`
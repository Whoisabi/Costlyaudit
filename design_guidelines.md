# CostlyAgent Design Guidelines

## Design Approach

**Selected System**: Carbon Design System (IBM)
**Rationale**: Enterprise-grade data visualization platform with complex dashboards, tables, and analytics. Carbon excels at information-dense applications with structured data presentation.

**Design Principles**:
- Clarity in data presentation
- Efficient task completion
- Consistent enterprise-grade patterns
- Purposeful information hierarchy

---

## Core Design Elements

### A. Typography

**Primary Font**: IBM Plex Sans (via Google Fonts CDN)
**Monospace**: IBM Plex Mono (for code/SQL editor)

**Hierarchy**:
- Page Titles: text-3xl font-semibold (30px)
- Section Headers: text-2xl font-semibold (24px)
- Card Titles: text-lg font-medium (18px)
- Body: text-base (16px)
- Metadata/Labels: text-sm (14px)
- Captions: text-xs (12px)

### B. Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, and 12
- Component padding: p-6
- Card gaps: gap-6
- Section spacing: space-y-8
- Page margins: px-8 py-6
- Tight spacing: gap-2, gap-4

**Grid System**:
- Dashboard cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-4
- Benchmark cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Resource tables: Full-width with horizontal scroll

---

## C. Component Library

### 1. Authentication & Credential Management

**Login Page**:
- Centered card (max-w-md) with shadow-lg
- Logo at top, form below
- Single-column layout
- CTA button full-width

**AWS Credentials Management Page** (Post-Login Priority):
- Header: "Connected AWS Accounts" with primary "Add Account" button
- Account cards in grid (grid-cols-1 lg:grid-cols-2 gap-6)
- Each card displays: Account nickname, Access Key ID (masked), Region, Status badge (Active/Inactive), Actions (Edit/Delete icons)
- "Add Account" modal: Form with fields for Account Nickname, Access Key ID (input), Secret Access Key (password input), Default Region (dropdown)
- Account selector dropdown in main nav (fixed top-right) showing active account with avatar/icon

### 2. Navigation

**Top Bar** (h-16, fixed):
- Logo left, account selector center-right, user menu far-right
- Shadow-sm border-b
- Icons: Heroicons outline

**Sidebar** (w-64, sticky):
- Dashboard, Benchmarks, Controls, Resources, SQL Explorer, Settings sections
- Active state: border-l-4 with filled background
- Collapsed state on mobile: Hamburger menu

### 3. Dashboard Components

**KPI Cards** (4-column grid):
- Large number (text-4xl font-bold)
- Label below (text-sm)
- Trend indicator (up/down arrow with percentage)
- Icon in top-right corner
- Shadow-sm, rounded-lg, p-6

**Benchmark Cards**:
- Header: Benchmark name + service icon
- Circular progress ring (showing % passed)
- Stats row: "X/Y controls passed"
- Savings badge: "Est. $XXX/mo savings"
- "View Details" link bottom-right
- Hover: shadow-md transition

**Control Detail Page**:
- Breadcrumb navigation top
- Two-column layout (8/12 + 4/12):
  - Left: Control metadata, SQL code block (syntax-highlighted), results table
  - Right: Severity badge, affected resources count, action buttons (Run Control, Export)
- Charts below in full-width

### 4. Data Display

**Resource Table**:
- Sticky header (bg-surface, shadow-sm)
- Sortable columns with arrows
- Filter row above table
- Row actions: overflow menu (3 dots)
- Pagination bottom (showing X-Y of Z)
- Alternating row backgrounds for readability

**SQL Query Editor**:
- Monaco-style code editor (dark theme)
- Toolbar: Run button, Save, History
- Split view: Editor top (60%), Results table bottom (40%)
- Line numbers, syntax highlighting

### 5. Charts (Recharts)

**Types to Use**:
- Pie Chart: Savings by service
- Bar Chart: Controls passed/failed by benchmark
- Line Chart: Cost trends over time
- Stacked Area: Resource utilization

**Chart Styling**:
- Consistent palette across all charts
- Grid lines subtle
- Tooltips with shadow-lg
- Legend positioned bottom or right
- Responsive container

### 6. Forms & Inputs

**Text Inputs**:
- Border, rounded-md, px-4 py-2
- Focus: ring-2 transition
- Label above (text-sm font-medium mb-2)
- Helper text below (text-xs)

**Buttons**:
- Primary: Full padding (px-6 py-3), rounded-md, shadow-sm
- Secondary: Outlined variant
- Icon buttons: p-2, rounded-md
- Loading state: Spinner inside button

### 7. Modals & Overlays

**Modal Structure**:
- Backdrop: Semi-transparent overlay
- Content: max-w-2xl, rounded-lg, shadow-2xl
- Header: Border-b with close icon
- Footer: Border-t with action buttons right-aligned

---

## D. Animations

**Use Sparingly**:
- Page transitions: None (instant)
- Card hover: shadow transition (transition-shadow duration-200)
- Button clicks: Scale feedback (active:scale-95)
- Loading states: Spinner only
- Avoid scroll-triggered animations

---

## Images

**Logo**: Place CostlyAgent logo (or AWS cloud icon) in top-left navigation bar
**Dashboard Icons**: Use Heroicons for services (cloud, database, server icons)
**Empty States**: Illustration placeholders for "No accounts connected" and "No data available"
**No Hero Images**: This is a dashboard application - focus on data, not marketing imagery
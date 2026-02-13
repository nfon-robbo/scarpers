

# Garmin AI Coach — Web App

A web-based AI-powered endurance training analysis and coaching platform. Users upload their Garmin data via FIT/CSV files, view interactive dashboards, and receive AI-generated training analysis and plans.

---

## Phase 1: Foundation

### 1.1 User Authentication
- Sign up / login with email using Supabase Auth
- Protected routes — unauthenticated users redirected to login

### 1.2 User Profile & Onboarding
- Onboarding wizard after first login: name, primary sport (running, cycling, triathlon), experience level, current training goals
- Free-text field for athlete context (e.g., "recovering from knee injury", "targeting sub-3hr marathon")
- Profile settings page to update these later

---

## Phase 2: Data Import & Storage

### 2.1 File Upload
- Upload page accepting CSV and FIT files exported from Garmin Connect
- Parse uploaded files to extract: activities (distance, duration, pace, HR, power), daily metrics (HRV, sleep, RHR, weight)
- Store parsed data in Supabase, linked to the user's account
- Upload history showing previously imported files with date and record count

### 2.2 Activity Browser
- List view of all imported activities with search and date filtering
- Activity detail view showing key stats per session

---

## Phase 3: KPI Dashboard

### 3.1 Interactive Charts & Metrics
- **Training Load**: Chronic load, acute load, and ACWR (Acute-to-Chronic Workload Ratio) trend chart
- **Recovery**: HRV trend, resting heart rate trend, sleep quality scores
- **Body Composition**: Weight trend over time
- **Activity Summary**: Recent activities with distance, pace, HR zones, duration
- Date range filter across all charts
- All charts built with Recharts

---

## Phase 4: AI Training Analysis

### 4.1 AI Analysis Engine
- "Run Analysis" button that sends the user's data + athlete context to an AI edge function (OpenAI GPT)
- Multi-domain analysis covering:
  - Training load progression & overtraining risk
  - Running/cycling execution (pace, power, zone distribution)
  - Physiology & readiness assessment
  - Actionable recommendations organized by category

### 4.2 Analysis Report View
- Interactive report with expandable sections for each analysis domain
- Key findings highlighted with severity indicators
- "Download as HTML" button generating a styled report matching the original garmin-ai-coach output

---

## Phase 5: Training Plan Generation

### 5.1 Competition Management
- Add target races: name, date, distance, priority (A/B/C race), goal time
- Edit and remove races from a management page

### 5.2 Season Plan
- AI-generated macro-cycle plan (12–24 weeks) anchored around target races
- Periodization phases (base, build, peak, taper) displayed in a timeline view

### 5.3 4-Week Training Plan
- AI-generated detailed daily workout schedule
- Each workout includes: type, duration, intensity zone, coaching cues
- Calendar view for the 4-week plan
- "Download as HTML" button for the training plan

---

## Phase 6: History & Settings

### 6.1 Analysis History
- All past AI analyses and training plans saved and browsable
- View any previous report or plan
- Re-run analysis with updated/new data

### 6.2 Settings
- AI analysis mode: quick vs. detailed
- Athlete context editing
- Competition management
- Account settings (email, password)

---

## What You'll Need to Provide
- **OpenAI API key** — for the AI coaching analysis and plan generation (will be stored as a Supabase secret)
- **Garmin export files** — CSV or FIT files exported from Garmin Connect for testing


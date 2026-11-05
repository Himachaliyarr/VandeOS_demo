# Vande OS — Phase 1

Vande OS is a MERN workspace for Vande Digital and Vande Digital Academy. It includes a React + Vite web app, an Express API, and MongoDB models for the HR foundation and the CRM, delivery, Academy, finance, marketing, inventory, support, automation, and reporting workflows.

## Confirmed company configuration

- One office location, configured by the Owner after deployment.
- Flexible employee shifts; configured hours are guidance, and attendance is not blocked by a rigid start-time window.
- GPS check-in for office attendance, with a server-checked radius and GPS accuracy limit.
- Web check-in only for employees marked as approved for remote work.
- HR directly approves or declines leave requests. The Owner has the same review access.
- The first Super Admin is the Owner, provisioned from environment variables only when the user collection is empty.
- Divisions: **Vande Digital** and **Vande Digital Academy**.
- Starter departments: Web Development, Digital Marketing, Graphic Designing, Video Editing, and Training (under Vande Digital Academy).

## Phase 1 features

- Owner and employee sign-in with an HTTP-only session cookie, password hashing, login throttling, and forced password change for initial accounts.
- Server-side role checks for Super Admin, HR, and Employee access. Public account registration is disabled.
- Employee directory, account creation, division and department assignment, shift assignment, remote-work approval, HR role assignment by the Owner, and account deactivation.
- Flexible shift configuration with workdays and a configurable flexible window.
- Office GPS check-in and check-out, approved remote web check-in, monthly attendance history, and staff attendance report.
- Leave application, overlap protection, HR/Owner direct approval, employee cancellation while pending, and notifications to reviewers and employees.
- Owner dashboard, employee dashboard, department headcount, attendance summary, notifications, and Owner-only audit history.
- Office geofence, timezone, GPS accuracy, division, department, and shift configuration.
- Responsive dark interface for desktop, tablet, and mobile.

## Business workspace modules

The shared workspace also includes:

- **CRM:** leads, clients, contacts, deals, and activity records.
- **Projects & tasks:** delivery records, ownership, due dates, and client links.
- **Academy:** courses, batches, student profiles, enrollments, assignments, submissions, and certificates. Students can review records assigned to their profile and submit work against their assigned assignments.
- **Finance:** invoices, payment history, and expenses, with client-linked invoices and payment history available in the client portal. Finance records are Owner-only for internal users.
- **Marketing:** campaign and content planning.
- **Inventory:** items with low-stock alerts and immutable stock movement history.
- **Support:** staff ticket tracking and client-submitted support requests.
- **Automations:** rule and run-log records. This is a workspace for documenting and tracking automations; it does not connect to external systems or execute customer-defined code.
- **Reports:** staff-scoped record and overdue summaries.
- **Client and student portals:** accounts are provisioned by Owner/HR when creating a client or student record. The generated temporary password is displayed once, and the user must change it at first sign-in. Client access is limited to linked CRM, project, invoice, and support records; student access is limited to their Academy record, linked learning records, and submissions.

These modules use a shared `WorkspaceRecord` collection with a validated module, record type, status, typed ownership/relationship fields, and a string-only metadata map. Archive actions retain records and are included in audit history. Link projects and invoices to their corresponding client, and Academy assignments to their student, in the module form for portal visibility.

Operational controls prevent important records from being edited as plain text: invoice payments are recorded against an invoice and update its outstanding balance; stock changes require a receive/issue movement and cannot reduce stock below zero; payment and stock history is stored immutably with its invoice/item as one atomic database update; only pending student submissions can be reviewed, and each learner can submit once per assignment. These actions create audit entries and the relevant staff/student notifications.

## Requirements

- Node.js 20.19 or newer (Node 22 LTS or newer is recommended).
- npm 10 or newer.
- A MongoDB server or MongoDB Atlas connection string.

## Quick start (Windows PowerShell)

From the project root:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set at least:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/vande_os
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
OWNER_NAME=Your name
OWNER_EMAIL=you@yourcompany.com
OWNER_PASSWORD=use-a-long-unique-password
```

You can generate a random JWT secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Install the root runner and both application packages:

```powershell
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Open **http://localhost:5173**. The API runs at **http://localhost:5000**.

On the first API startup, Vande OS creates the base organization, the two divisions, starter departments, and one flexible core shift. It creates the Owner account only if there are no users and both `OWNER_EMAIL` and `OWNER_PASSWORD` are set. The Owner must choose a new password at first sign-in. Later startups do not replace or reset accounts.

### Configure the real office location

Sign in as the Owner and open **Workspace settings**. Enter the verified office latitude and longitude and save. Until coordinates are configured, office GPS check-in is disabled. Set radius and accuracy to match the office policy. Remote web attendance can be used only after an employee is marked **Approved for remote work**.

The `.env.example` also accepts `OFFICE_LATITUDE` and `OFFICE_LONGITUDE` for initial setup. Leave them blank until the office coordinates have been verified. For a new database, `GEOFENCE_RADIUS_METERS`, `GPS_MAX_ACCURACY_METERS`, `OFFICE_NAME`, and `TIMEZONE` can set the initial values.

## Useful commands

```powershell
npm run dev             # Run Vite and Express together
npm run dev:client      # Run the React app only
npm run dev:server      # Run the API only
npm run build           # Production frontend build
npm test                # Run attendance policy tests
npm run check           # Server syntax and policy tests, then frontend production build
npm start               # Start the Express API
```

The app uses the same-origin `/api` path by default; Vite proxies it to the local Express server during development. For a separately hosted frontend/API, set `VITE_API_URL` in `client/.env` (for example `VITE_API_URL=https://api.example.com/api`) and configure the API `CLIENT_URL` to the exact frontend origin.

## Production single-origin deployment

The production React build is served by Express from the same origin as `/api`, so session cookies and CORS do not require a separate frontend host. Build the client, then start the API with production settings:

```powershell
npm run build
$env:NODE_ENV = "production"
$env:COOKIE_SECURE = "true"
npm start
```

Terminate HTTPS at a trusted reverse proxy or hosting platform, set the exact public `CLIENT_URL`, use a production MongoDB deployment with backups, and supply secrets through the hosting platform's secret manager instead of a committed `.env`. The API creates workspace indexes at startup; startup intentionally fails if an existing database cannot satisfy the unique Academy-submission index. Back up an existing database before upgrading; if it already contains duplicate active submissions for one student/assignment, resolve those duplicates before starting the upgraded app. Run `npm run check` before deployment. `npm --prefix server test` with `NODE_ENV=production` also checks the built single-origin app fallback.

## Project layout

```text
VandeOS-Phase1/
├── client/                   React 19 + Vite app
│   └── src/
│       ├── components/        Layout, dialogs, and UI primitives
│       ├── context/           Session context
│       ├── lib/               API and formatting helpers
│       └── pages/             HR, business modules, client/student portals, and reports
├── server/                   Express 5 API
│   ├── src/
│   │   ├── config/            MongoDB connection
│   │   ├── middleware/        Authentication, authorization, error handling
│   │   ├── models/            Mongoose schemas and indexes
│   │   ├── routes/            HR REST API and business workspace API
│   │   └── services/          Audit, notifications, organization setup, geofence rules
│   └── test/                  Node test-runner policy and API tests
├── .env.example
└── README.md
```

## API overview

All API routes are under `/api`. Success responses use `{ success: true, data }`; errors use `{ success: false, message }`.

| Area | Routes |
| --- | --- |
| Session | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Organization | `GET /organization`, `PATCH /organization/settings` |
| Divisions / departments | `GET /divisions`, `POST /divisions`, `PATCH /divisions/:id`, `GET /departments`, `POST /departments`, `PATCH /departments/:id` |
| People | `GET /employees`, `GET /employees/me`, `POST /employees`, `PATCH /employees/:id`, `POST /employees/:id/deactivate` |
| Shifts | `GET /shifts`, `POST /shifts`, `PATCH /shifts/:id` |
| Attendance | `POST /attendance/check-in`, `POST /attendance/check-out`, `GET /attendance/me`, `GET /attendance` |
| Leave | `POST /leave-requests`, `GET /leave-requests/me`, `GET /leave-requests`, `POST /leave-requests/:id/review`, `POST /leave-requests/:id/cancel` |
| Dashboard | `GET /dashboard` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |
| Audit | `GET /audit-logs` |
| Business workspace | `GET /workspace/:module`, `POST /workspace/:module`, `PATCH /workspace/:module/:id`, `POST /workspace/:module/:id/archive` |
| Workspace metadata / reports | `GET /workspace/meta`, `GET /workspace/reports/overview` |
| Invoice payments | `POST /workspace/finance/:invoiceId/payments` (Owner only; amount and currency required) |
| Stock movements | `POST /workspace/inventory/:itemId/movements` (Owner/HR; direction `IN` or `OUT`, positive quantity) |
| Academy submission review | `POST /workspace/academy/:submissionId/review` (Owner/HR; decision `APPROVED` or `REJECTED`) |

Workspace module names are `crm`, `projects`, `academy`, `finance`, `marketing`, `inventory`, `support`, and `automations`. The API validates each module's allowed record types and statuses. The reports endpoint is restricted to Owner/HR and omits Owner-only finance data from HR summaries.

## Roles and access

| Capability | Super Admin (Owner) | HR | Employee |
| --- | --- | --- | --- |
| Workspace and office settings | Manage | Read | Read |
| Employee records | Create and manage | Create and manage employee accounts | Read directory and own profile |
| Assign HR / Super Admin role | Yes | No | No |
| Attendance | View team and own | View team and own | Own records |
| Leave review | Approve / decline | Approve / decline | No |
| Leave requests | Apply and review | Apply and review | Apply / cancel pending |
| Audit history | View | No | No |

Employee records, attendance reports, leave decisions, password changes, and important settings changes are protected by API middleware. Hiding a frontend page is not the security boundary.

Owner/HR can choose each employee's allowed work areas (CRM, projects, Academy, marketing, inventory, and support) in the person's profile, based on their job title. HR accounts can also be limited to selected HR work areas and reports. The same permissions are enforced by the API and navigation; employees only see records assigned to them or created by them. Finance and automations remain Owner-only. Existing employee accounts without a saved permission list retain project and support access; existing HR accounts retain their current HR workspace access until an Owner/HR saves a narrower list.

Client and student portal accounts use the `CLIENT` and `STUDENT` roles. These roles cannot access internal attendance, leave, employee, or organization endpoints. Portal record visibility is enforced by server-side client/student links, not by frontend filters. Staff can create and edit the business records; clients can read linked records and open support tickets, while students can read linked Academy records and submit work for their assigned assignments.

## Attendance behavior

- The server supplies attendance timestamps and applies the organization timezone when choosing a work date.
- Office check-in requires GPS coordinates, configured office coordinates, an acceptable GPS accuracy reading, and a location within the configured radius.
- Approved remote employees may choose web check-in. Other employees cannot use the web method.
- One record per employee per work date is enforced with a MongoDB unique index. Duplicate check-ins and invalid check-outs are rejected.
- Check-out uses the original check-in method and the server records total elapsed minutes.
- GPS is a useful location signal, not proof that a particular person holds the device. Use normal workplace verification for sensitive attendance disputes.

## Tests and verification

`npm test` runs focused Node tests for office geofencing, GPS accuracy, missing office configuration, remote approval, workspace role scoping, model constraints, and unauthenticated API access. `npm run check` runs server syntax/tests and builds the production React bundle. These tests do not require MongoDB.

For a connected end-to-end demonstration, configure MongoDB and the Owner account, then verify sign-in, employee creation, forced password change, GPS behavior inside/outside the configured radius, approved remote check-in, check-out, leave review, notifications, and audit history. The MongoDB-backed workflows require a reachable MongoDB instance.

## Production notes and integration boundary

- Use HTTPS in production, set a strong unique `JWT_SECRET`, set `COOKIE_SECURE=true`, and set `CLIENT_URL` to the exact frontend origin.
- Keep `.env` out of source control. Use managed secrets in hosted environments.
- The initial employee password is displayed once in the Owner/HR UI. Share it through a secure channel; the employee is forced to change it at first sign-in.
- Office coordinates are intentionally not guessed. GPS attendance must be configured by the Owner.
- Audit and attendance records have no deletion UI. Employee offboarding deactivates accounts so history remains intact.
- Notifications are stored in MongoDB and shown in the web app. SMTP, WhatsApp, Redis workers, file storage, payment gateways, LMS video hosting, and external integrations are not configured.
- The business workspace provides operational CRUD, linking, access control, and status reporting. It is not a substitute for accounting/tax compliance, a payment processor, an external LMS delivery service, or a job runner for customer-authored automation code.
- MongoDB-backed workflows require a reachable MongoDB instance. No live MongoDB data, SMTP provider, office coordinates, or external credentials are bundled.
#   V a n d e O S _ d e m o  
 
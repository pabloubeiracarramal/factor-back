# Factor Backend

A multi-tenant invoicing API built with NestJS, Prisma, and PostgreSQL. This backend powers the Factor invoicing application, providing robust authentication, company management, client handling, and invoice generation with PDF export capabilities.

## 🚀 Features

- **Multi-tenant Architecture**: Companies are isolated with their own users, clients, and invoices
- **Google OAuth Authentication**: Secure login via Google with JWT token management
- **Company Invitations**: Invite team members to join your company via email
- **Client Management**: Full CRUD operations for managing clients
- **Invoice Management**: Create, update, and track invoices with multiple statuses (DRAFT, PENDING, PAID, OVERDUE)
- **PDF Generation**: Generate professional invoice PDFs for preview and download
- **Dashboard Statistics**: Get real-time insights on invoice data
- **Role-based Access**: User roles (USER, ADMIN) for access control

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) v11
- **Database**: PostgreSQL
- **ORM**: [Prisma](https://www.prisma.io/) v7
- **Authentication**: Passport.js with Google OAuth 2.0 & JWT
- **PDF Generation**: PDFKit
- **Validation**: class-validator & class-transformer
- **Language**: TypeScript

## 📁 Project Structure

```
src/
├── auth/                  # Authentication module (Google OAuth, JWT)
│   ├── decorators/        # Custom decorators (CurrentUser)
│   ├── guards/            # Auth guards (JWT, Google)
│   └── strategies/        # Passport strategies
├── clients/               # Client management module
│   ├── dto/               # Data transfer objects
│   └── entities/          # Client entity
├── companies/             # Company/tenant management
│   ├── dto/
│   └── entities/
├── invoices/              # Invoice management & PDF generation
│   ├── dto/
│   └── entities/
├── prisma/                # Prisma service module
└── users/                 # User management
    ├── dto/
    └── entities/

prisma/
├── schema.prisma          # Database schema
└── migrations/            # Database migrations
```

## 📋 Prerequisites

- Node.js (v18 or higher recommended)
- PostgreSQL database
- Google OAuth credentials (Client ID & Secret)

## ⚙️ Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/factor?schema=app"

# JWT
JWT_SECRET="your-jwt-secret-key"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:3000/auth/google/callback"

# Frontend
FRONTEND_URL="http://localhost:5173"
```

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# (Optional) Open Prisma Studio to view data
npx prisma studio
```

### Running the Application

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

The API will be available at `http://localhost:3000`.

## 📚 API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google` | Initiate Google OAuth login |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/profile` | Get current user profile |
| POST | `/auth/invitations` | Create company invitation |
| POST | `/auth/invitations/:token/accept` | Accept invitation |

### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/companies` | Create a new company |
| GET | `/companies/:id` | Get company details |
| PATCH | `/companies/:id` | Update company |
| DELETE | `/companies/:id` | Delete company |

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/clients` | Create a new client |
| GET | `/clients` | List all clients (with filters) |
| GET | `/clients/:id` | Get client details |
| PATCH | `/clients/:id` | Update client |
| DELETE | `/clients/:id` | Delete client |

### Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/invoices` | Create a new invoice |
| GET | `/invoices` | List all invoices (with filters) |
| GET | `/invoices/dashboard` | Get dashboard statistics |
| GET | `/invoices/:id` | Get invoice details |
| PATCH | `/invoices/:id` | Update invoice |
| DELETE | `/invoices/:id` | Delete invoice |
| GET | `/invoices/:id/pdf/preview` | Preview invoice PDF |
| GET | `/invoices/:id/pdf/download` | Download invoice PDF |

## 🧪 Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# End-to-end tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 🔧 Development

### Code Formatting & Linting

```bash
# Format code with Prettier
npm run format

# Lint and fix issues
npm run lint
```

### Database Schema Changes

After modifying `prisma/schema.prisma`:

```bash
# Create a new migration
npx prisma migrate dev --name your_migration_name

# Reset database (development only)
npx prisma migrate reset
```

## 📊 Data Models

### Company (Tenant)
- Multi-tenant root entity
- Contains users, clients, and invoices
- Stores company details (name, address, VAT, etc.)

### User
- Belongs to a company (optional for new users)
- Google OAuth integration
- Role-based (USER, ADMIN)

### Client
- Belongs to a company
- Contains contact and billing information
- Associated with invoices

### Invoice
- Belongs to a company and client
- Contains invoice items
- Supports multiple statuses and currencies
- PDF generation capability

### Invoice Item
- Line items within an invoice
- Contains quantity, price, and tax rate

## 🔐 Authentication Flow

1. User clicks "Login with Google"
2. Redirected to Google OAuth consent screen
3. After approval, callback creates/finds user
4. JWT token generated and sent to frontend
5. All subsequent API calls use JWT in Authorization header

## 📝 License

**All Rights Reserved**

Copyright © 2026. This software is proprietary and confidential. Unauthorized copying, modification, distribution, or use of this software, via any medium, is strictly prohibited without express written permission from the copyright holder.

This codebase is not open source and no license is granted for its use, modification, or distribution.

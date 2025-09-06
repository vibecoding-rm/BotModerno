# Overview

CubaModel Bot is a collaborative Telegram bot system designed to crowdsource and verify information about mobile phone compatibility in Cuba. The system consists of a Telegram bot that guides users through a submission wizard to report phone models and their functionality, paired with a web-based administration panel for content moderation and data management.

The bot operates through an interactive wizard that collects phone specifications including commercial name, model, network compatibility, supported bands, and user observations. All submissions are stored with "pending" status and require admin approval through the web panel before becoming publicly available.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Next.js 14 SSR Application**: Complete server-side rendering with no client-side Supabase usage for security
- **Tailwind CSS**: Utility-first styling with custom components and responsive design
- **Static Pages**: Simple HTML tables and forms for data display and moderation actions
- **Basic Authentication**: Edge middleware implementing HTTP Basic Auth for admin access

## Backend Architecture
- **Serverless Functions**: Vercel-hosted API routes for webhook handling and data operations
- **Telegraf Bot Framework**: Node.js Telegram bot with wizard-based user interactions
- **Persistent Wizard State**: Draft submissions stored in database to maintain user progress across sessions
- **Command System**: Structured bot commands for submission (/subir), reporting (/reportar), subscriptions (/suscribir), and administration

## Data Storage Solutions
- **Primary Database**: Supabase (PostgreSQL) with service role key for server operations
- **Core Tables**:
  - `phones`: Main phone submissions with status workflow (pending → approved/rejected)
  - `submission_drafts`: Temporary wizard state storage with step tracking
  - `reports`: User-reported issues with moderation status
  - `subscriptions`: User notification preferences
- **Data Export**: CSV and JSON export capabilities with proper escaping and formatting

## Authentication and Authorization
- **Bot Access Control**: Environment-based admin and allowed chat ID filtering
- **Panel Security**: HTTP Basic Auth via Edge middleware with credential validation
- **Service Authentication**: Supabase service role key for server-side database operations
- **No Client Secrets**: All sensitive keys restricted to server-side operations

## Integration Patterns
- **Webhook Architecture**: Telegram webhook to Vercel serverless function for real-time message processing
- **Database Abstraction**: Flexible client wrapper supporting both Supabase and direct PostgreSQL connections
- **State Management**: Wizard pattern with database-backed session persistence
- **Error Handling**: Robust error boundaries with proper Telegram API response codes

# External Dependencies

## Core Services
- **Supabase**: PostgreSQL database hosting with REST API and service role authentication
- **Vercel**: Serverless function hosting for both bot webhook and web panel deployment
- **Telegram Bot API**: Message handling, webhook configuration, and user interaction management

## Development Dependencies
- **Testing Framework**: Jest for unit testing with Playwright for end-to-end testing
- **Code Quality**: ESLint configuration for Next.js projects
- **CSS Processing**: PostCSS with Autoprefixer for cross-browser compatibility

## Runtime Libraries
- **@supabase/supabase-js**: Database client library for server-side operations
- **telegraf**: Telegram bot framework with context and middleware support
- **pg**: Direct PostgreSQL client as fallback for non-Supabase deployments
- **next**: React framework with SSR capabilities and API routes

## Environment Configuration
- **Bot Variables**: BOT_TOKEN, webhook secrets, admin IDs, chat restrictions
- **Database Variables**: Supabase URL and service role key for authenticated access
- **Panel Variables**: Basic auth credentials and optional bot status endpoint URL
- **Deployment Variables**: Separate environment configs for bot and panel projects
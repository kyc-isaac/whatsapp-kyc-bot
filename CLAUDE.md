# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp bot for KYC (Know Your Customer) compliance list checking, built with Node.js/Express and Twilio. The bot allows users to search for individuals or companies in restrictive lists (OFAC, DEA, SAT, PEP, FBI, LPB) via WhatsApp interface.

## Development Commands

```bash
# Start the application
npm start                  # Production mode (runs server.js)
npm run dev               # Development mode with nodemon (auto-reload)

# Dependencies management
npm install               # Install all dependencies from package.json
```

## Architecture

### Core Components

1. **WhatsApp Integration** (`server.js:12-15, 77-96`)
   - Uses Twilio API for WhatsApp messaging
   - Webhook endpoint at `/webhook` processes incoming messages
   - Maintains user sessions in memory with conversation state

2. **KYC API Integration** (`server.js:122-156`)
   - Connects to external KYC-LISTAS API at `http://localhost:3000/api/listas`
   - Searches for persons/companies in compliance lists
   - Returns match percentages and generates PDF reports

3. **State Machine** (`server.js:24-32`)
   - WELCOME: Initial menu state
   - WAITING_PERSON_TYPE: Choosing between individual or company
   - WAITING_NAME: Collecting name input
   - WAITING_APATERNO/AMATERNO: Collecting surnames (for individuals only)
   - PROCESSING: Performing the search

4. **Session Management** (`server.js:60-74, 604-615`)
   - In-memory session storage using Map
   - Sessions expire after 6 hours of inactivity
   - Each WhatsApp number maintains its own conversation state

## Key Configuration

Environment variables (`.env`):
- `TWILIO_ACCOUNT_SID`: Twilio account credentials
- `TWILIO_AUTH_TOKEN`: Twilio authentication
- `TWILIO_WHATSAPP_NUMBER`: WhatsApp sandbox number
- `KYC_API_URL`: Base URL for KYC API (default: `http://localhost:3000/api/listas`)
- `KYC_API_KEY`: API authentication key
- `PORT`: Server port (default: 3001)
- `SERVER_URL`: Public URL for serving PDFs

## API Integration Details

The bot integrates with KYC-LISTAS API (`API_DOCUMENTATION.md`) which provides:
- Individual search endpoint: `/search`
- Batch search endpoint: `/search-multiple` 
- Performance stats: `/search-multiple/stats`
- Supports similarity percentage matching (default 85%)
- Returns PDF reports encoded in base64

## File Structure

- `server.js`: Main application with all bot logic
- `API_DOCUMENTATION.md`: Complete KYC API documentation
- `temp/`: Temporary PDF storage (auto-cleaned after 24h)
- `logs/`: Application logs organized by date

## Important Patterns

1. **Error Handling**: All async operations wrapped in try-catch with detailed logging
2. **Message Flow**: Sequential state-based conversation handling
3. **PDF Generation**: Base64 PDFs converted to temporary files served via `/temp` endpoint
4. **Cleanup**: Automatic cleanup of temp files (24h) and inactive sessions (6h)
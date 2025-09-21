# ParkEasy - AI-Powered WhatsApp Parking Management System 🚗

A hardware-free, conversational AI assistant built to manage India's unorganized parking sector. ParkEasy uses WhatsApp and Google's Gemini AI to provide a robust, theft-proof, and easy-to-use platform for parking lot owners and attendants.

## 🌟 Project Overview

The unorganized parking market in India suffers from a critical lack of technology, leading to an estimated 20-30% revenue leakage due to cash theft and a lack of accurate data. ParkEasy solves this by providing a simple yet powerful SaaS tool that runs entirely on WhatsApp.

Parking attendants can log vehicle entries and exits using natural language (English or Hinglish). The system automates transaction logging, pass management, and daily reporting, giving the owner complete, real-time visibility into their business and eliminating the multi-crore problem of cash pilferage.

## ✨ Core Features

*   **🤖 Conversational AI Interface:** Powered by Google's Gemini, the system understands natural language commands in English and Hinglish, making it incredibly easy for attendants to use.
*   ** theft-proof Operations:** Real-time logging of all vehicle `in` and `out` transactions, with instant notifications to the owner.
*   **Full SaaS Business Lifecycle:**
    *   Automated onboarding for new inquiries.
    *   Admin-powered subscription activation and renewal.
    *   Automated subscription expiry reminders and service lockout.
*   **Comprehensive Management Suite:**
    *   **Attendant Management:** Owners can `add` and `deactivate` attendants.
    *   **Pass Management:** Owners can create and view monthly passes (`addpass`, `viewpass`).
    *   **Reporting:** On-demand daily reports for owners (`report`).
*   **Intelligent Validation:** Robust, multi-language validation for Indian vehicle numbers and automatic normalization for 10-digit phone numbers.
*   **Automated Customer Communication:** The system is prepared to send approved Meta Message Templates for e-receipts and pass expiry reminders.

## 🛠️ System Architecture

*   **Frontend Interface:** WhatsApp (via the Meta Business API).
*   **Backend Server:** Node.js with the Express.js framework.
*   **Database:** PostgreSQL.
*   **AI Brain (NLU):** Google's Gemini 1.5 Flash model, via the `@google/generative-ai` SDK.
*   **Scheduled Tasks:** A standalone Node.js script (`daily_report.js`) for daily reports and reminders.

## 🚀 Getting Started

Follow these steps to set up and run the project locally.

### 1. Prerequisites
*   Node.js (v18 or later)
*   PostgreSQL Server
*   A GitHub account and Git installed

### 2. Installation
Clone the repository and install the required dependencies.
```bash
# Clone the repository (if you haven't already)
git clone https://github.com/your-username/parkeasy-backend.git

# Navigate to the project directory
cd parkeasy-backend

# Install dependencies
npm install express pg dotenv axios @google/generative-ai
```
### 3. Environment Configuration (.env)

Create a .env file in the root of the project and add the following keys.
```
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
# PostgreSQL Database Configuration
DB_USER=postgres
DB_HOST=localhost
DB_DATABASE=parkeasy_db
DB_PASSWORD=your_postgres_password
DB_PORT=5432

# Meta WhatsApp API Credentials
META_API_TOKEN=your_temporary_or_permanent_access_token
SENDER_PHONE_ID=your_whatsapp_business_phone_number_id
VERIFY_TOKEN=a_secret_string_you_create_for_webhook_verification

# Google Gemini API Key
GEMINI_API_KEY=your_google_ai_studio_api_key

# Application Admin Number (for managing subscriptions)
ADMIN_PHONE_NUMBER=91...

# Application Port
PORT=3000
```
  

### 4. Database Setup

Execute the following SQL commands in your PostgreSQL database to create the required tables.
```
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
-- Create all necessary tables for the application
CREATE TABLE Owners (
    owner_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    subscription_plan VARCHAR(50) DEFAULT 'TRIAL',
    subscription_start_date TIMESTAMPTZ,
    subscription_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ParkingLots (
    lot_id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES Owners(owner_id),
    lot_name VARCHAR(255) NOT NULL,
    hourly_rate INTEGER NOT NULL
);

CREATE TABLE Attendants (
    attendant_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE Transactions (
    transaction_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    attendant_id INTEGER,
    vehicle_number VARCHAR(20) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    total_fee INTEGER,
    status VARCHAR(50) NOT NULL,
    customer_whatsapp_number VARCHAR(20)
);

CREATE TABLE Passes (
    pass_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    vehicle_number VARCHAR(20) NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    customer_whatsapp_number VARCHAR(20),
    UNIQUE(lot_id, vehicle_number)
);
```
  

5. Running the Application

    To start the main server:
   ```  node index.js ```

  

   To run the daily scheduled tasks manually:

   ``` node daily_report.js ```

      

🧠 AI Integration Details

The core intelligence of the application resides in the gemini_ai.js module. It uses a detailed System Prompt to instruct the Gemini model to act as a specialized Natural Language Understanding (NLU) engine.

When a user sends a message like "gaadi aayi GJ05RT1234", the module processes it and returns a structured JSON object:
```
{
  "intent": "vehicle_check_in",
  "vehicle_number": "GJ05RT1234",
  "language": "hi"
}
```
  

The main server (index.js) then uses this intent to route the request to the correct business logic, making the system both powerful and easy to maintain.
🛣️ Future Roadmap

This MVP is the foundation for a much larger vision. Key features planned for future versions include:

    📸 Photo Check-in (ANPR): Allow attendants to check in vehicles by simply sending a photo of the number plate.

    💳 Digital Payments: Integrate Razorpay or Stripe to handle UPI payments directly through WhatsApp.

    🔊 Voice Note Commands: Allow users to speak their commands instead of typing.

    📊 Web Dashboard: A simple web interface for owners to view graphical reports, analytics, and manage their account.

Developed by Chintan Joshi with the assistance of Google Gemini.

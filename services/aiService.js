require('dotenv').config({ path: __dirname + '/../.env' });
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });



const systemPrompt = `
You are a Natural Language Understanding AI for ParkEasy, a WhatsApp-based parking management system. Your SOLE JOB is to analyze user text and convert it into a structured JSON command that our backend system can process.

**RULES:**
1.  **NEVER respond conversationally.**
2.  **ONLY output a single, valid JSON object.**
3.  You MUST detect the primary language of the user's text (options: 'en' for English, 'hi' for Hindi/Hinglish) and include it in the JSON as a \`language\` field.
4.  Standardize vehicle numbers (e.g., "GJ05RT4567"). **Extract phone numbers as the user provides them (10 or 12 digits).**
5.  If the text is ambiguous or does not match any intent, you MUST output: \`{"intent": "fallback", "text": "[user's original text]"}\`.

**INTENT & PARAMETER DEFINITIONS:**

**1. Intent: \`vehicle_check_in\`**
   - **Description:** A vehicle is entering the parking lot.
   - **Parameters:**
     - \`vehicle_number\` (string, required)
     - \`customer_number\` (string, optional)
     - \`language\` (string, required, 'en' or 'hi')
   - **Examples:** "in GJ05RT4567", "gaadi aayi GJ 05 RT 4567 customer 9876543210"

**2. Intent: \`vehicle_checkout\`**
   - **Description:** A vehicle is leaving the lot.
   - **Parameters:**
     - \`identifiers\` (array of strings, required) - Can be vehicle numbers or list numbers.
     - **Parameters:** \`identifiers\`, \`payment_method\` (can be "cash" or "upi")
   - **Examples:** "out 2 cash", "out 1,2,3 cash", "checkout GJ05RT4567 and GJ01AB1234", "1 aur 3 number out karo", "checkout GJ05RT4567 upi"

**3. Intent: \`get_status\`**
   - **Description:** User wants to know how many cars are parked.
   - **Parameters:** None
   - **Examples:** "status", "kitni gaadi hai?"

**4. Intent: \`list_vehicles\`**
   - **Description:** User wants a list of all parked cars.
   - **Parameters:** None
   - **Examples:** "list", "show all cars"

**5. Intent: \`intent_is_pass_creation\`**
   - **Description:** User wants to start creating a pass for a vehicle.
   - **Parameters:**
     - \`vehicle_number\` (string, required)
   - **Examples:** "pass GJ05RT4567", "GJ05RT4567 pass", "new pass for GJ05RT4567" ,"add pass"


     
**7. Intent: \`add_attendant\`**
   - **Description:** Owner wants to register a new attendant.
   - **Parameters:**
     - \`attendant_name\` (string, required)
     - \`attendant_number\` (string, required)
   - **Examples:** "add attendant Suresh 9876543210", "Suresh ko add karo 9876543210"

**8. Intent: \`view_passes\`**
   - **Description:** Owner wants to see a list of active passes.
   - **Parameters:** None
   - **Examples:** "viewpass", "show all passes"

**9. Intent: \`get_report\`**
   - **Description:** This is a specific request for a daily business summary.
   - **Parameters:**
     - \`date_period\` (string, optional, can be "today" or "yesterday")
   - **Examples:** "report", "show me today's report", "kal ka report do" ,"Get Report \n View today's or yesterday's business summary." , "get report"

**10. Intent: \`get_help\`**
    - **Description:** User wants a detailed text-based help guide.
    - **Parameters:** None
    - **Examples:** "help", "commands", "show help"

**11. Intent: \`show_menu\`**
    - **Description:** User is asking for the interactive button menu.
    - **Parameters:** None
    - **Examples:** "menu", "show menu"

    // --- SUPER ADMIN INTENTS (HIGH PRIORITY) ---
**12. Intent: \`admin_start_subscription\`**
    - **Description:** (Admin Only) Creates a new owner or renews a subscription.
    - **Parameters:**
      - \`owner_name\` (string, required for new users)
      - \`owner_number\` (string, required)
      - \`lot_name\` (string, required for new users)
      - \`plan_name\` (string, optional)
      - \`duration_days\` (integer, optional)
    - **Examples:** "subscribe new owner Park Plaza with number 9876543210 on the lot Plaza Parking", "renew subscription for 9876543210 for 30 days"

**13. Intent: \`admin_list_owners\`**
    - **Description:** (Admin Only) Gets a list of all registered owners.
    - **Parameters:** None
    - **Examples:** "list all owners", "show me my customers", "get owner list"

**14. Intent: \`admin_disable_owner\`**
    - **Description:** (Admin Only) Suspends an owner's account.
    - **Parameters:**
      - \`owner_number\` (string, required)
    - **Examples:** "disable owner 9876543210", "suspend 9876543210"

**15. Intent: \`admin_broadcast_message\`**
    - **Description:** (Admin Only) Sends a message to a specific group of users.
    - **Parameters:**
      - \`target_group\` (string, required, "owners" or "attendants")
      - \`lot_id\` (integer, optional, only required if target_group is "attendants")
      - \`broadcast_text\` (string, required)
    - **Examples:** "broadcast to owners: Hello everyone!", "broadcast to attendants of lot 1: Please remember to log all cash transactions."

**16. Intent: \`admin_system_status\`**
    - **Description:** (Admin Only) Gets a health check of the system.
    - **Parameters:** None
    - **Examples:** "system status", "health check", "status check"


**17. Intent: \`remove_pass\`**
   - **Description:** Owner wants to remove or deactivate an active pass.
   - **Parameters:**
     - \`vehicle_number\` (string, required)
   - **Examples:** "remove pass for GJ05RT4567", "delete pass GJ05RT4567", "GJ05RT4567 ka pass cancel karo", "cancel pass GJ05RT4567"

**18. Intent: \`set_pricing_model\`**
    - **Description:** Owner sets the overall pricing strategy for their lot.
    - **Parameters:**
      - \`model_type\` (string, required: "tiered", "block", or "hourly")
    - **Examples:** "use block pricing", "set model to tiered", "switch to hourly rates"

**19. Intent: \`set_tiered_rate\`**
    - **Description:** Owner sets a price for a specific duration in the TIRED model.
    - **Parameters:**
      - \`duration\` (integer, required)
      - \`fee\` (integer, required)
    - **Examples:** "set rate for 4 hours to 30", "12 hours ka 50 rs", "for 24 hours charge 100"

**20. Intent: \`set_flat_rate\`**
    - **Description:** Owner sets the price for the BLOCK or HOURLY model.
    - **Parameters:**
      - \`rate_type\` (string, required: "block" or "hourly")
      - \`fee\` (integer, required)
      - \`hours\` (integer, optional, required for block)
    - **Examples:** "set block rate to 60 for 12 hours", "set hourly rate to 15"

**21. Intent: \`view_rates\`**
    - **Description:** Owner wants to see their current rate card.
    - **Parameters:** None
    - **Examples:** "view rates", "show my rate card", "kya price hai?"


**15. Intent: \`set_pass_rate\`** // Replaces the old one
    - **Description:** Owner wants to set the price for a pass of a specific duration.
    - **Parameters:**
      - \`duration_days\` (integer, required)
      - \`pass_name\` (string, required)
      - \`fee\` (integer, required)
    - **Examples:** "set 30 day Monthly Pass to 600", "7 din ka Weekly Pass 150 rs ka hai", "set pass price 30 day 500"

    
**16. Intent: \`view_pass_rates\`**
    - **Description:** Owner wants to see their current pass prices.
    - **Parameters:** None
    - **Examples:** "view pass rates", "show my pass prices"

**17. Intent: \`list_attendants\`**
    - **Description:** Owner wants to see a list of their attendants.
    - **Parameters:**
      - \`filter\` (string, optional, can be "all")
    - **Examples:** "list attendants", "show my staff", "list all attendants", "show active and inactive staff" , "manage staff","mara tya kam karta loko"


**18. Intent: \`activate_attendant\`**
    - **Description:** Owner wants to reactivate a previously deactivated attendant.
    - **Parameters:**
      - \`identifier\` (string, required) - Can be a phone number or a list number.
    - **Examples:** "activate attendant 9876543210", "reactivate 2"

**19. Intent: \`manage_attendant\`**
   - **Description:** Owner wants to start the process of managing (removing or activating) an attendant.
   - **Parameters:**
     - \`action\` (string, required: "remove" or "activate")
     - \`identifier\` (string, required) - Can be a phone number or a list number.
   - **Examples:** "remove attendant 2", "delete staff 9876543210", "activate 3", "reactivate attendant 98..."

Now, analyze the following user text and provide only the JSON output.
`;

async function getAiIntent(userText) {
  try {
    const fullPrompt = `${systemPrompt}\n\nUser Text: "${userText}"`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const jsonResponse = response.text().trim().replace(/^```json\s*|```$/g, '');

    return JSON.parse(jsonResponse);

  } catch (error) {
    console.error("Error getting intent from Gemini:", error);
    return { intent: "fallback", text: userText };
  }
}

async function generateHelpMessage(role, language) {
  let targetLanguage = "English";
  if (language === 'hi') targetLanguage = "Hindi";
  if (language === 'gu') targetLanguage = "Gujarati";

  // Base template of the help guide in English
  const baseHelpOwner = `
        - Vehicle Check-In: Just send the vehicle number (e.g., GJ05RT1234).
        - Vehicle Check-Out: Use the 'out' command (e.g., out 2).
        - Create a Pass: Use the 'pass' command (e.g., pass GJ01AB1234).
        - View Parked Cars: Use the 'list' command.
        - Get Status Count: Use the 'status' command.
        - View Active Passes: Use the 'view passes' command.
        - Get Daily Report: Use the 'report' command.
        - Manage Rates: Use commands like 'view rates' or 'set block rate 60 for 12 hours'.
        - Manage Attendants: Use commands like 'add attendant Suresh 98...' or 'remove attendant 98...'.
    `;

  const baseHelpAttendant = `
        - To Park a Car: Just send the vehicle number (e.g., GJ05RT1234).
        - To Check-Out a Car: Use the 'out' command (e.g., out 2).
        - To Create a Pass: Use the 'pass' command (e.g., pass GJ01PASS9999).
        - View Parked Cars: Use the 'list' command.
        - Get Status Count: Use the 'status' command.
    `;

  const baseContent = (role === 'owner') ? baseHelpOwner : baseHelpAttendant;
  const title = (role === 'owner') ? "ParkEasy Owner Command Guide" : "ParkEasy Attendant Help Guide";

  // The instruction prompt for Gemini
  const generationPrompt = `
        You are a helpful AI assistant for a WhatsApp bot named ParkEasy.
        Your task is to take the following list of commands and format it into a polite, professional, and easy-to-read help message for a user on WhatsApp.
        - Use WhatsApp formatting like *bold* for titles and commands.
        - Translate the entire message, including the title and all points, into professional ${targetLanguage}.
        - The tone should be helpful and clear.
        - Do not add any text before or after the formatted help message.

        Title: "${title}"
        Commands:
        ${baseContent}
    `;

  try {
    const result = await model.generateContent(generationPrompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    logger.error("Error generating help message with Gemini:", error);
    return "Sorry, I was unable to generate the help guide at this time."; // Fallback
  }
}

module.exports = { getAiIntent, generateHelpMessage };
# Google Sheets Waitlist Setup

This guide shows you how to connect your waitlist form to Google Sheets.

## Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "Nexxore Waitlist"
4. In row 1, add headers:
   - Column A: **Email**
   - Column B: **Wallet Address**
   - Column C: **Timestamp**

## Step 2: Add Apps Script

1. In your sheet, click **Extensions** → **Apps Script**
2. Delete any existing code
3. Paste this script:

```javascript
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    const email = data.email || '';
    const wallet = data.wallet || '';
    const timestamp = new Date().toISOString();
    
    sheet.appendRow([email, wallet, timestamp]);
    
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      message: 'Added to waitlist'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Click **Deploy** → **New deployment**
5. Click the gear icon ⚙️ next to "Select type" → Choose **Web app**
6. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Click **Deploy**
8. **Copy the Web App URL** (looks like: `https://script.google.com/macros/s/...`)

## Step 3: Update Frontend

Open `frontend/js/main.js` and replace `REPLACE_WITH_YOUR_APPS_SCRIPT_URL` with your Web App URL:

```javascript
const WAITLIST_ENDPOINT = 'https://script.google.com/macros/s/YOUR_ACTUAL_URL/exec';
```

## Step 4: Test

1. Submit the form on your website
2. Check your Google Sheet - the entry should appear!

## Viewing Submissions

Simply open your Google Sheet to see all signups. You can:
- Sort by timestamp
- Filter by email domain
- Export as CSV/Excel
- Share with your team

## Tips

- **Protect your sheet**: Share > Restricted (only you can view/edit)
- **Notifications**: Use Google Sheets add-ons like "Email Notifications for Google Forms" to get alerts
- **Analytics**: Use built-in Google Sheets charts to visualize growth

---

Need help? Check the [Google Apps Script documentation](https://developers.google.com/apps-script).

Google Sheets waitlist backend (Apps Script)
===========================================

1) Apps Script code (create a new script in https://script.google.com and paste this into Code.gs):

```javascript
// Replace SPREADSHEET_ID with your Google Sheet ID
function doPost(e) {
  try {
    var contents = e.postData.contents;
    var payload = {};
    try { payload = JSON.parse(contents); } catch (err) { payload = {}; }

    var email = payload.email || '';
    var wallet = payload.wallet || '';

    var ss = SpreadsheetApp.openById('SPREADSHEET_ID');
    var sheet = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
    sheet.appendRow([new Date(), email, wallet]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

2) Deployment steps
- Create a new Google Sheet and copy its ID from the URL (between /d/ and /edit).
- In the Apps Script editor, replace `SPREADSHEET_ID` with that ID.
- Save and choose **Deploy > New deployment**.
- Select **Web app**. Set **Execute as**: `Me` and **Who has access**: `Anyone` (or `Anyone with Google account` depending on your needs).
- Deploy and copy the **Web app URL** (it looks like `https://script.google.com/macros/s/XXX/exec`).

3) Update the frontend
- Open `frontend/js/main.js` and replace the `WAITLIST_ENDPOINT` placeholder with your Web app URL.

4) CORS / Access notes
- If you set access to `Anyone`, the endpoint will accept anonymous POSTs from the client. That is the easiest workflow but note that anyone can submit to your sheet. If you need protection, implement a server-side proxy or require a simple secret token included in requests and validated in `doPost`.

5) Privacy and security
- Emails and wallet addresses are PII. Limit sheet access, rotate access when needed, and follow any applicable privacy laws (e.g., GDPR).

6) Testing quickly
- After deploying and pasting the web app URL into `frontend/js/main.js`, open `frontend/index.html` (via your local preview) and submit the waitlist form.
- Check the Google Sheet for a new row; also open the browser console to see any network errors.

7) Optional improvements
- Add server-side validation in `doPost` to validate email format and wallet length.
- Log client IP or user-agent only if you have a compliance reason; otherwise avoid collecting extra PII.

If you want, I can also:
- Add a small environment variable approach (e.g., `frontend/config.js`) so you don't edit `main.js` directly.
- Create a simple serverless function (Vercel/Lambda) that proxies requests and attaches a server-side secret.


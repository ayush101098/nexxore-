# Waitlist Google Sheets Integration Setup Guide

## ✅ What's Been Set Up

1. **API Endpoint**: `/api/waitlist` — accepts POST requests with email submissions
2. **Form Handler**: Updated `index.html` form to send data to the API
3. **Environment Variables**: Added `GOOGLE_SHEET_ID` and `GOOGLE_APPLICATION_CREDENTIALS` to `.env`

## 🚀 Next Steps: Create Google Cloud Service Account

Your submissions will be recorded in this Google Sheet: 
https://docs.google.com/spreadsheets/d/1chwxjMc11Hy-1StNSGp5ESbApBtE4epjixJLqQJlbFI/edit

### Step 1: Enable Google Sheets API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Search for "Google Sheets API" → click Enable
4. Search for "Google Drive API" → click Enable

### Step 2: Create Service Account
1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Fill in details:
   - **Service account name**: `nexxore-waitlist`
   - **Description**: `Nexxore waitlist form submissions`
4. Click **Create and Continue**
5. Grant role: **Editor** (or more restricted: **Sheets Editor**)
6. Click **Continue** → **Done**

### Step 3: Create JSON Key
1. Click on the service account you just created
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Choose **JSON**
5. A file will download automatically
6. **Move this file to the root of your project as `credentials.json`**

```bash
# Move the downloaded file to your project root
mv ~/Downloads/nexxore-waitlist-*.json /path/to/nexxore-/credentials.json
```

### Step 4: Share Google Sheet with Service Account
1. Open your [waitlist Google Sheet](https://docs.google.com/spreadsheets/d/1chwxjMc11Hy-1StNSGp5ESbApBtE4epjixJLqQJlbFI/edit)
2. Click **Share**
3. Copy the service account email from your `credentials.json` file (looks like: `nexxore-waitlist@project-id.iam.gserviceaccount.com`)
4. Paste it in the Share dialog
5. Grant **Editor** access
6. Click **Share**

### Step 5: Set Up Sheet Structure
Make sure your Google Sheet has these columns (or the form will append there):

| Column | Header |
|--------|--------|
| A | Email |
| B | Name |
| C | Source |
| D | Timestamp |

**Example first row:**
```
Email                    | Name  | Source  | Timestamp
user@example.com        |       | website | 2024-01-15T10:30:45.123Z
```

### Step 6: Install Dependencies
```bash
npm install
```

### Step 7: Test It Out
1. Go to your website at http://localhost:3000 (or production)
2. Scroll to the **"Get early access"** section
3. Enter an email and click **"Notify me →"**
4. Check your Google Sheet — the email should appear within seconds!

## 🔧 Troubleshooting

### "Authentication failed" error
- Make sure `credentials.json` is in the root directory
- Check that `GOOGLE_APPLICATION_CREDENTIALS` in `.env` points to `./credentials.json`
- Verify the service account has Editor access to the sheet

### Submissions aren't appearing
- Check browser console (F12) for errors
- Check server logs for API errors
- Verify sheet tab name is exactly `Waitlist` (case-sensitive)
- Ensure the service account email is shared on the sheet

### "Sheet not found" error
- The sheet tab must be named exactly `Waitlist`
- If you want to use a different tab name, edit `/api/waitlist.js` line 7: `const SHEET_NAME = 'Waitlist';`

## 📊 Monitoring & Analytics

To see all submissions:
1. Open your [Google Sheet](https://docs.google.com/spreadsheets/d/1chwxjMc11Hy-1StNSGp5ESbApBtE4epjixJLqQJlbFI/edit)
2. All submissions appear in the `Waitlist` tab automatically
3. Use Google Sheets filters/formulas to analyze

## 🚀 Deployment

When deploying to Vercel or similar:
1. Add `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json` to your deployment environment variables
2. The `credentials.json` file needs to be included in your deployment (don't add to `.gitignore`)

## Need Help?
If you encounter issues:
- Check that the email format is valid (contains @)
- Verify Google Cloud credentials are correct
- Ensure the sheet is properly shared with the service account

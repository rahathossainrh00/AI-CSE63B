// ============================================================
// DRIVE → FIRESTORE SYNC SCRIPT
// Automatically syncs Google Drive folder contents into
// the "resources" field of each Firestore subject document.
// ============================================================

// ===================== CONFIGURATION ========================
const CONFIG = {
  FIRESTORE_PROJECT_ID: 'cse-63b',

  // Optional: email address to receive sync summaries (leave blank to disable)
  NOTIFICATION_EMAIL: '',

  // Optional: Google Sheet ID for sync logging (leave blank to disable)
  LOG_SHEET_ID: '',
  LOG_SHEET_NAME: 'Sync Log',
};

// Firestore REST API base URL (do not change)
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

// ============================================================
// MAIN SYNC FUNCTION (called by trigger or manually)
// ============================================================

function syncDriveToFirestore() {
  const startTime = new Date();
  let checked = 0, updated = 0, skipped = 0, errored = 0;
  const changes = []; // Track changes for notifications/logging

  try {
    const subjects = fetchAllSubjects();
    Logger.log(`📚 Found ${subjects.length} subject document(s) in Firestore.`);

    for (const doc of subjects) {
      try {
        const fields = doc.fields || {};
        const subjectName = getStringValue(fields.subjectname) || getStringValue(fields.name) || 'Unknown';
        const driveLink = getStringValue(fields.drivefolder) || '';

        if (!driveLink) {
          Logger.log(`  ⏭️  "${subjectName}" — no Drive folder link, skipping.`);
          skipped++;
          continue;
        }

        const folderId = extractFolderId(driveLink);
        if (!folderId) {
          Logger.log(`  ⚠️  "${subjectName}" — could not extract folder ID from: ${driveLink}`);
          skipped++;
          continue;
        }

        checked++;
        Logger.log(`  🔍 Checking "${subjectName}" (folder: ${folderId})...`);

        // Build fresh resources from Drive
        const driveResources = buildResourcesFromDrive(folderId);

        // Parse existing resources from Firestore
        const existingResources = parseFirestoreResources(fields.resources);

        // Compare
        if (deepEqual(driveResources, existingResources)) {
          Logger.log(`     ✅ No changes for "${subjectName}".`);
          skipped++;
          continue;
        }

        // Diff for logging
        const diff = describeDiff(existingResources, driveResources);
        Logger.log(`     🔄 Changes detected for "${subjectName}": ${diff}`);
        changes.push({ subject: subjectName, diff: diff });

        // Update Firestore
        const docPath = doc.name; // Full resource path
        updateResourcesInFirestore(docPath, driveResources);
        updated++;
        Logger.log(`     ✅ Updated "${subjectName}" in Firestore.`);

      } catch (docError) {
        errored++;
        const name = getStringValue(doc.fields?.subjectname) || 'Unknown';
        Logger.log(`  ❌ Error processing "${name}": ${docError.message}`);
      }
    }
  } catch (error) {
    Logger.log(`❌ Fatal error during sync: ${error.message}`);
  }

  // Summary
  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  const summary = `\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 SYNC SUMMARY\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `   Subjects checked:  ${checked}\n` +
    `   Updated:           ${updated}\n` +
    `   Skipped (no change): ${skipped}\n` +
    `   Errors:            ${errored}\n` +
    `   Time elapsed:      ${elapsed}s\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  Logger.log(summary);

  // Optional: send email notification
  if (CONFIG.NOTIFICATION_EMAIL && updated > 0) {
    sendSyncEmail(updated, skipped, errored, changes);
  }

  // Optional: log to Google Sheet
  if (CONFIG.LOG_SHEET_ID) {
    logToSheet(checked, updated, skipped, errored, changes);
  }
}

/**
 * Manual trigger — run this from the Apps Script editor.
 */
function manualSync() {
  syncDriveToFirestore();
}

// ============================================================
// FIRESTORE REST API FUNCTIONS
// ============================================================

/**
 * Fetch all documents from the "subjects" collection.
 * Handles pagination automatically.
 */
function fetchAllSubjects() {
  const token = ScriptApp.getOAuthToken();
  let allDocs = [];
  let pageToken = null;

  do {
    let url = `${FIRESTORE_BASE}/subjects?pageSize=100`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`Firestore GET failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    if (data.documents) {
      allDocs = allDocs.concat(data.documents);
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allDocs;
}

/**
 * Update only the "resources" field of a subject document.
 * Uses PATCH with updateMask to leave other fields untouched.
 */
function updateResourcesInFirestore(docPath, resources) {
  const token = ScriptApp.getOAuthToken();
  const url = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=resources`;

  const body = {
    fields: {
      resources: jsToFirestoreValue(resources)
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Firestore PATCH failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }
}

// ============================================================
// DRIVE FUNCTIONS
// ============================================================

/**
 * Build a resources map from a Drive folder's subfolders and files.
 * Each subfolder at any depth becomes its own category.
 * Nested folders use path names: "Notes / Slides / Week 1"
 * Returns: { "CategoryName": [{title, url}, ...], ... }
 */
function buildResourcesFromDrive(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const resources = {};

  // 1. Recursively collect all categories (subfolders at every level)
  collectCategoriesRecursive(folder, '', resources);

  // 2. Files in the root folder go into "General"
  const rootFiles = folder.getFiles();
  const generalFiles = [];
  while (rootFiles.hasNext()) {
    const file = rootFiles.next();
    generalFiles.push({
      title: file.getName().replace(/\.[^/.]+$/, ''),
      url: `https://drive.google.com/file/d/${file.getId()}/view?usp=sharing`
    });
  }
  generalFiles.sort((a, b) => a.title.localeCompare(b.title));

  if (generalFiles.length > 0) {
    resources['General'] = generalFiles;
  }

  return resources;
}

/**
 * Recursively walk subfolders, creating a category for each one.
 * @param {Folder} folder - Current Drive folder
 * @param {string} pathPrefix - Parent path (e.g. "Notes / Slides")
 * @param {Object} resources - The resources map being built
 */
function collectCategoriesRecursive(folder, pathPrefix, resources) {
  const subfolders = folder.getFolders();

  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    const folderName = subfolder.getName().trim();
    const categoryName = pathPrefix ? `${pathPrefix} / ${folderName}` : folderName;

    // Collect files directly in this subfolder
    const files = [];
    const folderFiles = subfolder.getFiles();
    while (folderFiles.hasNext()) {
      const file = folderFiles.next();
      files.push({
        title: file.getName().replace(/\.[^/.]+$/, ''),
        url: `https://drive.google.com/file/d/${file.getId()}/view?usp=sharing`
      });
    }
    files.sort((a, b) => a.title.localeCompare(b.title));

    if (files.length > 0) {
      resources[categoryName] = files;
    }

    // Recurse into nested subfolders
    collectCategoriesRecursive(subfolder, categoryName, resources);
  }
}

// ============================================================
// FIRESTORE VALUE CONVERTERS
// ============================================================

/**
 * Extract a plain string from a Firestore field value.
 */
function getStringValue(field) {
  if (!field) return '';
  return field.stringValue || '';
}

/**
 * Parse the "resources" field from Firestore REST response
 * into a plain JS object: { categoryName: [{title, url}] }
 */
function parseFirestoreResources(field) {
  if (!field || !field.mapValue || !field.mapValue.fields) return {};

  const result = {};
  const fields = field.mapValue.fields;

  for (const categoryName in fields) {
    const categoryField = fields[categoryName];
    if (!categoryField.arrayValue || !categoryField.arrayValue.values) continue;

    result[categoryName] = categoryField.arrayValue.values.map(val => {
      const fileFields = val.mapValue?.fields || {};
      return {
        title: fileFields.title?.stringValue || '',
        url: fileFields.url?.stringValue || ''
      };
    });
  }

  return result;
}

/**
 * Convert a plain JS value to Firestore REST format.
 * Handles strings, numbers, booleans, arrays, and objects/maps.
 */
function jsToFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(item => jsToFirestoreValue(item))
      }
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const key in value) {
      fields[key] = jsToFirestoreValue(value[key]);
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Extract a Google Drive folder ID from various URL formats.
 * Handles: /folders/ID, ?id=ID, /open?id=ID
 */
function extractFolderId(url) {
  if (!url || typeof url !== 'string') return null;

  // Format: /folders/FOLDER_ID
  let match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Format: ?id=FOLDER_ID or &id=FOLDER_ID
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // If the string itself looks like a bare folder ID (no slashes or dots)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) {
    return url.trim();
  }

  return null;
}

/**
 * Deep equality check for two objects.
 * Used to compare existing vs new resources to avoid unnecessary writes.
 */
function deepEqual(a, b) {
  return JSON.stringify(sortObjectKeys(a)) === JSON.stringify(sortObjectKeys(b));
}

/**
 * Recursively sort object keys for stable JSON comparison.
 */
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = sortObjectKeys(obj[key]);
    });
    return sorted;
  }
  return obj;
}

/**
 * Describe the differences between old and new resources for logging.
 */
function describeDiff(oldRes, newRes) {
  const parts = [];
  const allCategories = new Set([...Object.keys(oldRes), ...Object.keys(newRes)]);

  for (const cat of allCategories) {
    const oldFiles = (oldRes[cat] || []).map(f => f.url);
    const newFiles = (newRes[cat] || []).map(f => f.url);

    if (!oldRes[cat]) {
      parts.push(`+category "${cat}" (${newFiles.length} files)`);
    } else if (!newRes[cat]) {
      parts.push(`-category "${cat}" removed`);
    } else {
      const added = newFiles.filter(u => !oldFiles.includes(u)).length;
      const removed = oldFiles.filter(u => !newFiles.includes(u)).length;
      if (added || removed) {
        parts.push(`"${cat}": +${added} -${removed}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(', ') : 'minor changes';
}

// ============================================================
// OPTIONAL ENHANCEMENT 1: EMAIL NOTIFICATION
// ============================================================

function sendSyncEmail(updated, skipped, errored, changes) {
  if (!CONFIG.NOTIFICATION_EMAIL) return;

  const changeList = changes.map(c => `• ${c.subject}: ${c.diff}`).join('\n');

  const body =
    `Drive → Firestore Sync Report\n` +
    `Time: ${new Date().toLocaleString()}\n\n` +
    `Updated: ${updated} | Skipped: ${skipped} | Errors: ${errored}\n\n` +
    `Changes:\n${changeList || 'None'}`;

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: `[CSE 63B] Sync: ${updated} subject(s) updated`,
    body: body
  });

  Logger.log(`📧 Notification email sent to ${CONFIG.NOTIFICATION_EMAIL}`);
}

// ============================================================
// OPTIONAL ENHANCEMENT 2: GOOGLE SHEET LOGGING
// ============================================================

function logToSheet(checked, updated, skipped, errored, changes) {
  if (!CONFIG.LOG_SHEET_ID) return;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);

    // Create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Checked', 'Updated', 'Skipped', 'Errors', 'Changes']);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }

    const changesSummary = changes.map(c => `${c.subject}: ${c.diff}`).join(' | ');
    sheet.appendRow([
      new Date(),
      checked,
      updated,
      skipped,
      errored,
      changesSummary || 'No changes'
    ]);

    Logger.log(`📝 Sync log appended to Google Sheet.`);
  } catch (e) {
    Logger.log(`⚠️  Could not write to log sheet: ${e.message}`);
  }
}

// ============================================================
// OPTIONAL ENHANCEMENT 3: WEB APP TRIGGER
// ============================================================

/**
 * Deploy as Web App to allow external HTTP POST to trigger sync.
 * URL: https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
 *
 * POST → triggers sync and returns JSON result
 * GET  → returns a simple status page
 */
function doPost(e) {
  syncDriveToFirestore();
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, timestamp: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'POST to this URL to trigger a Drive→Firestore sync.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

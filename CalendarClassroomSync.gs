// ============================================================
// CALENDAR + CLASSROOM → FIRESTORE SYNC SCRIPT
// ============================================================
// Syncs Google Calendar events → Firestore "calendar" collection
// Syncs Google Classroom coursework → Firestore "assignments" collection
// Test events from Calendar also write to "assignments" collection
// ============================================================

// ===================== CONFIGURATION ========================

const CONFIG = {
  FIRESTORE_PROJECT_ID: 'cse-63b',
  CALENDAR_NAME: 'CSE 63B',
  SYNC_DAYS_PAST: 30,
  SYNC_DAYS_FUTURE: 180,
  TIMEZONE: 'Asia/Dhaka',
};

// Firestore REST API base (do not change)
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

function getSemesterStart() {
  const now = new Date();
  const month = now.getMonth() + 1;

  if (month >= 8) return new Date(now.getFullYear(), 7, 1);  // Aug 1
  if (month >= 5) return new Date(now.getFullYear(), 4, 1);  // May 1
  return new Date(now.getFullYear(), 0, 1);                  // Jan 1
}

// ============================================================
// GOOGLE CALENDAR COLOR ID REFERENCE
// ============================================================
// Google Calendar event color IDs:
//   1  = Lavender
//   2  = Sage
//   3  = Grape
//   4  = Flamingo (pink)    → used for "Off Day"
//   5  = Banana
//   6  = Tangerine
//   7  = Peacock
//   8  = Graphite
//   9  = Blueberry
//   10 = Basil
//   11 = Tomato (red)       → used for "Test"
//   No color / default      → "Event"
// ============================================================

// ============================================================
// TRIGGER FUNCTIONS
// ============================================================

function syncCalendar() {
  _syncCalendarToFirestore();
}

function syncClassroom() {
  _syncClassroomToFirestore();
}

function syncAll() {
  syncCalendar();
  syncClassroom();
}

function manualSync() {
  syncCourseList(); // always refresh course list on manual sync
  syncAll();
}

function syncCourseList() {
  try {
    const response = Classroom.Courses.list({ courseStates: ['ACTIVE'] });
    const semesterStart = getSemesterStart();
    const courses = (response.courses || [])
      .filter(c => {
        if (!c.creationTime) return false;
        const created = new Date(c.creationTime);
        return created >= semesterStart;
      })
      .map(c => c.name)
      .filter(Boolean);

    Logger.log(`📅 Semester start: ${semesterStart.toISOString()}`);
    Logger.log(`📋 Courses after semester filter: ${courses.join(', ')}`);
    
    setFirestoreDoc('settings', 'classroom_courses', {
      courses: courses,
      lastSynced: new Date().toISOString()
    });
    
    Logger.log(`✅ Synced ${courses.length} Classroom course(s) to Firestore.`);
    Logger.log(`   Courses: ${courses.join(', ')}`);
  } catch (e) {
    Logger.log(`❌ Failed to sync course list: ${e.message}`);
  }
}

function buildSubjectMapFromFirestore() {
  try {
    const docs = fetchAllDocsInCollection('subjects');
    const map = {};
    
    for (const doc of docs) {
      const fields = parseFirestoreFields(doc.fields);
      const gcrName = fields.gcr_name || '';
      const shortName = fields.short_name || '';
      
      if (gcrName && shortName) {
        map[gcrName] = shortName;
      }
    }
    
    Logger.log(`📚 Built subject map from Firestore: ${JSON.stringify(map)}`);
    return map;
  } catch (e) {
    Logger.log(`❌ Failed to build subject map: ${e.message}`);
    return {};
  }
}

// ============================================================
// PART 1 — GOOGLE CALENDAR → FIRESTORE
// ============================================================

function _syncCalendarToFirestore() {
  const startTime = new Date();
  let checked = 0, created = 0, updated = 0, deleted = 0, skipped = 0, errored = 0;

  try {
    // Find the calendar
    const calendars = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME);
    if (calendars.length === 0) {
      Logger.log(`❌ Calendar "${CONFIG.CALENDAR_NAME}" not found.`);
      return;
    }
    const calendar = calendars[0];

    // Time window
    const now = new Date();
    const startDate = new Date(now.getTime() - CONFIG.SYNC_DAYS_PAST * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + CONFIG.SYNC_DAYS_FUTURE * 24 * 60 * 60 * 1000);

    // Fetch all events in window
    const events = calendar.getEvents(startDate, endDate);
    Logger.log(`📅 Found ${events.length} Calendar event(s) in sync window.`);

    // Fetch existing Firestore calendar docs to detect deletions
    const existingDocs = fetchAllDocsInCollection('calendar');
    const existingIds = new Set(existingDocs.map(d => extractDocId(d.name)));
    const processedIds = new Set();

    // Process each event
    for (const event of events) {
      try {
        checked++;
        const eventId = event.getId().replace('@google.com', '');
        const firestoreDocId = eventId;
        processedIds.add(firestoreDocId);

        // Determine category from color
        const colorId = event.getColor();
        let category = 'Event';
        if (colorId === '11') category = 'Test';
        else if (colorId === '4') category = 'Off Day';

        // Format date
        const isAllDay = event.isAllDayEvent();
        let dateStr;
        if (isAllDay) {
          const d = event.getAllDayStartDate();
          dateStr = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
        } else {
          dateStr = Utilities.formatDate(event.getStartTime(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
        }

        const calendarDoc = {
          date: dateStr,
          category: category,
          title: event.getTitle() || '',
          description: event.getDescription() || ''
        };

        // Check if document exists
        const existingDoc = getFirestoreDoc('calendar', firestoreDocId);

        if (existingDoc) {
          // Compare
          const existingData = parseFirestoreFields(existingDoc.fields);
          if (deepEqual(existingData, calendarDoc)) {
            skipped++;
          } else {
            setFirestoreDoc('calendar', firestoreDocId, calendarDoc);
            updated++;
            Logger.log(`  🔄 Updated calendar: "${calendarDoc.title}"`);
          }
        } else {
          setFirestoreDoc('calendar', firestoreDocId, calendarDoc);
          created++;
          Logger.log(`  ✅ Created calendar: "${calendarDoc.title}"`);
        }

        // If Test → also write to assignments collection
        if (category === 'Test') {
          const location = event.getLocation() || '';
          let subject = location.trim().toUpperCase();
          if (!subject) {
            subject = 'General';
            Logger.log(`  ⚠️ Warning: Test event "${calendarDoc.title}" has no Location (subject). Defaulting to "General".`);
          }

          let deadline;
          if (isAllDay) {
            deadline = dateStr + 'T23:59:00';
          } else {
            deadline = Utilities.formatDate(event.getStartTime(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
          }

          const assignmentDoc = {
            subjectname: subject,
            category: 'Test',
            categorycolor: 'bg-red-100 text-red-700',
            title: calendarDoc.title,
            description: calendarDoc.description,
            deadline: deadline,
            relatedlinks: '[]'
          };

          const calAssignId = 'CAL_' + eventId;
          const existingAssign = getFirestoreDoc('assignments', calAssignId);

          if (existingAssign) {
            const existingAssignData = parseFirestoreFields(existingAssign.fields);
            if (deepEqual(existingAssignData, assignmentDoc)) {
              // No change
            } else {
              setFirestoreDoc('assignments', calAssignId, assignmentDoc);
              Logger.log(`  🔄 Updated assignment from Calendar test: "${calendarDoc.title}"`);
            }
          } else {
            setFirestoreDoc('assignments', calAssignId, assignmentDoc);
            Logger.log(`  ✅ Created assignment from Calendar test: "${calendarDoc.title}"`);
          }
        }

      } catch (eventError) {
        errored++;
        Logger.log(`  ❌ Error processing calendar event: ${eventError.message}`);
      }
    }

    // Delete Firestore docs whose Calendar event is no longer in the window
    for (const existingId of existingIds) {
      if (!processedIds.has(existingId)) {
        try {
          deleteFirestoreDoc('calendar', existingId);
          deleted++;
          Logger.log(`  🗑️ Deleted stale calendar doc: ${existingId}`);

          // Also delete matching assignment if it was a CAL_ test
          const calAssignId = 'CAL_' + existingId;
          const existingAssign = getFirestoreDoc('assignments', calAssignId);
          if (existingAssign) {
            deleteFirestoreDoc('assignments', calAssignId);
            Logger.log(`  🗑️ Also deleted stale test assignment: ${calAssignId}`);
          }
        } catch (delError) {
          Logger.log(`  ❌ Error deleting stale doc ${existingId}: ${delError.message}`);
        }
      }
    }

  } catch (error) {
    Logger.log(`❌ Fatal error in Calendar sync: ${error.message}`);
  }

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  Logger.log(`\n━━━ CALENDAR SYNC SUMMARY ━━━`);
  Logger.log(`  Checked: ${checked} | Created: ${created} | Updated: ${updated} | Deleted: ${deleted} | Skipped: ${skipped} | Errors: ${errored} | Time: ${elapsed}s`);
}

// ============================================================
// PART 2 — GOOGLE CLASSROOM → FIRESTORE
// ============================================================

function _syncClassroomToFirestore() {
  const startTime = new Date();
  let coursesChecked = 0, found = 0, created = 0, updated = 0, skipped = 0, errored = 0;

  try {
    // Build dynamic map from settings
    const SUBJECT_MAP = buildSubjectMapFromFirestore();
    const courseNames = Object.keys(SUBJECT_MAP);
    
    if (courseNames.length === 0) {
      Logger.log(`⚠️ Warning: No courses mapped in subjects collection. Skipping Classroom sync.`);
      return;
    }

    let allCourses;

    try {
      const response = Classroom.Courses.list({ courseStates: ['ACTIVE'] });
      allCourses = response.courses || [];
    } catch (e) {
      Logger.log(`❌ Could not list Classroom courses: ${e.message}`);
      return;
    }

    // Filter to courses in SUBJECT_MAP
    const matchedCourses = allCourses.filter(course => {
      return courseNames.some(name => course.name && course.name.includes(name));
    });

    Logger.log(`🎓 Found ${matchedCourses.length} matching Classroom course(s).`);

    const now = new Date();

    for (const course of matchedCourses) {
      try {
        coursesChecked++;
        const courseName = course.name || '';

        // Resolve subject abbreviation
        let subject = courseName; // fallback
        for (const [fullName, abbrev] of Object.entries(SUBJECT_MAP)) {
          if (courseName.includes(fullName)) {
            subject = abbrev;
            break;
          }
        }
        if (subject === courseName) {
          Logger.log(`  ⚠️ Course "${courseName}" not in SUBJECT_MAP, using full name.`);
        }

        Logger.log(`  📘 Checking "${courseName}" → ${subject}`);

        // Fetch published coursework
        let courseWorkItems = [];
        let pageToken = null;
        do {
          const params = { courseWorkStates: ['PUBLISHED'], pageSize: 50 };
          if (pageToken) params.pageToken = pageToken;
          const cwResponse = Classroom.Courses.CourseWork.list(course.id, params);
          if (cwResponse.courseWork) {
            courseWorkItems = courseWorkItems.concat(cwResponse.courseWork);
          }
          pageToken = cwResponse.nextPageToken || null;
        } while (pageToken);

        Logger.log(`     Found ${courseWorkItems.length} coursework item(s)`);

        for (const cw of courseWorkItems) {
          try {
            // Build deadline
            let deadline = null;
            if (cw.dueDate) {
              const year = cw.dueDate.year;
              const month = String(cw.dueDate.month).padStart(2, '0');
              const day = String(cw.dueDate.day).padStart(2, '0');

              if (cw.dueTime && cw.dueTime.hours !== undefined) {
                const hours = String(cw.dueTime.hours || 0).padStart(2, '0');
                const minutes = String(cw.dueTime.minutes || 0).padStart(2, '0');
                deadline = `${year}-${month}-${day}T${hours}:${minutes}:00`;
              } else {
                deadline = `${year}-${month}-${day}T23:59:00`;
              }
            }

            // Filter: only sync if deadline is within the current semester
            if (deadline) {
              const deadlineDate = new Date(deadline);
              if (deadlineDate < getSemesterStart()) continue;
            }

            found++;

            // Determine category from title keywords
            const titleLower = (cw.title || '').toLowerCase();
            let category = 'Assignment';
            let categoryColor = 'bg-blue-100 text-blue-700';
            if (/test|quiz|exam|mid/.test(titleLower)) {
              category = 'Test';
              categoryColor = 'bg-red-100 text-red-700';
            } else if (/presentation|project/.test(titleLower)) {
              category = 'Presentation';
              categoryColor = 'bg-purple-100 text-purple-700';
            }

            // Extract links from materials
            const links = [];
            if (cw.materials) {
              for (const mat of cw.materials) {
                if (mat.driveFile && mat.driveFile.driveFile) {
                  const df = mat.driveFile.driveFile;
                  links.push(df.title || 'File');
                } else if (mat.link) {
                  links.push(mat.link.title || mat.link.url || 'Link');
                } else if (mat.youtubeVideo) {
                  links.push(mat.youtubeVideo.title || 'YouTube Video');
                }
              }
            }

            // Build links as URL strings
            const linksArray = [];
            if (cw.materials) {
              for (const mat of cw.materials) {
                if (mat.driveFile && mat.driveFile.driveFile) {
                  const df = mat.driveFile.driveFile;
                  linksArray.push(`https://drive.google.com/file/d/${df.id}/view?usp=sharing`);
                } else if (mat.link) {
                  linksArray.push(mat.link.url || '');
                } else if (mat.youtubeVideo) {
                  linksArray.push(`https://www.youtube.com/watch?v=${mat.youtubeVideo.id}`);
                }
              }
            }

            const assignmentDoc = {
              subjectname: subject,
              category: category,
              categorycolor: categoryColor,
              title: cw.title || '',
              description: cw.description || '',
              deadline: deadline || '',
              relatedlinks: JSON.stringify(linksArray)
            };

            const firestoreDocId = `CLS_${course.id}_${cw.id}`;
            const existingDoc = getFirestoreDoc('assignments', firestoreDocId);

            if (existingDoc) {
              const existingData = parseFirestoreFields(existingDoc.fields);
              if (deepEqual(existingData, assignmentDoc)) {
                skipped++;
              } else {
                setFirestoreDoc('assignments', firestoreDocId, assignmentDoc);
                updated++;
                Logger.log(`     🔄 Updated: "${cw.title}"`);
              }
            } else {
              setFirestoreDoc('assignments', firestoreDocId, assignmentDoc);
              created++;
              Logger.log(`     ✅ Created: "${cw.title}"`);
            }

          } catch (cwError) {
            errored++;
            Logger.log(`     ❌ Error processing coursework "${cw.title || 'unknown'}": ${cwError.message}`);
          }
        }

      } catch (courseError) {
        errored++;
        Logger.log(`  ❌ Error processing course "${course.name || 'unknown'}": ${courseError.message}`);
      }
    }

  } catch (error) {
    Logger.log(`❌ Fatal error in Classroom sync: ${error.message}`);
  }

  const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  Logger.log(`\n━━━ CLASSROOM SYNC SUMMARY ━━━`);
  Logger.log(`  Courses: ${coursesChecked} | Found: ${found} | Created: ${created} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errored} | Time: ${elapsed}s`);
}

// ============================================================
// FIRESTORE REST API HELPERS
// ============================================================

/**
 * Fetch all documents in a collection. Handles pagination.
 */
function fetchAllDocsInCollection(collection) {
  const token = ScriptApp.getOAuthToken();
  let allDocs = [];
  let pageToken = null;

  do {
    let url = `${FIRESTORE_BASE}/${collection}?pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`Firestore GET collection failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    if (data.documents) allDocs = allDocs.concat(data.documents);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allDocs;
}

/**
 * Get a single Firestore document. Returns null if not found.
 */
function getFirestoreDoc(collection, docId) {
  const token = ScriptApp.getOAuthToken();
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 200) {
    return JSON.parse(response.getContentText());
  }
  return null; // not found or error
}

/**
 * Create or overwrite a Firestore document with a specific ID.
 * Uses PATCH with all field paths in updateMask.
 */
function setFirestoreDoc(collection, docId, data) {
  const token = ScriptApp.getOAuthToken();
  const fieldPaths = Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `${FIRESTORE_BASE}/${collection}/${docId}?${fieldPaths}`;

  const fields = {};
  for (const key in data) {
    fields[key] = jsToFirestoreValue(data[key]);
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ fields }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Firestore PATCH failed for ${collection}/${docId} (${response.getResponseCode()}): ${response.getContentText()}`);
  }
}

/**
 * Delete a Firestore document.
 */
function deleteFirestoreDoc(collection, docId) {
  const token = ScriptApp.getOAuthToken();
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Firestore DELETE failed for ${collection}/${docId} (${response.getResponseCode()})`);
  }
}

// ============================================================
// FIRESTORE VALUE CONVERTERS
// ============================================================

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(v => jsToFirestoreValue(v)) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const k in value) fields[k] = jsToFirestoreValue(value[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreValueToJs(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ('mapValue' in value) {
    const result = {};
    const fields = value.mapValue.fields || {};
    for (const k in fields) result[k] = firestoreValueToJs(fields[k]);
    return result;
  }
  return null;
}

/**
 * Parse all fields from a Firestore document into plain JS.
 */
function parseFirestoreFields(fields) {
  if (!fields) return {};
  const result = {};
  for (const key in fields) {
    result[key] = firestoreValueToJs(fields[key]);
  }
  return result;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Extract the document ID from a full Firestore resource path.
 */
function extractDocId(resourcePath) {
  const parts = resourcePath.split('/');
  return parts[parts.length - 1];
}

/**
 * Deep equality check using sorted JSON.
 */
function deepEqual(a, b) {
  return JSON.stringify(sortObj(a)) === JSON.stringify(sortObj(b));
}

function sortObj(obj) {
  if (Array.isArray(obj)) return obj.map(sortObj);
  if (obj && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(k => { sorted[k] = sortObj(obj[k]); });
    return sorted;
  }
  return obj;
}

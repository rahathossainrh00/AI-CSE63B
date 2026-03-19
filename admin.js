// ============================================
// ADMIN PANEL - FIREBASE VERSION
// ============================================

// Global state
let currentUser = null;
let currentSection = 'calendar';
let editingItem = null;
let allSubjects = [];
let prefilledDayForEditor = null;

// Schedule collapse state persistence
let scheduleCollapseState = {
    Sunday: false, Monday: false, Tuesday: false, Wednesday: false, Thursday: false
};

// Day order and color config
const SCHEDULE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const DAY_COLORS = {
    Sunday:    { pill: 'bg-blue-100 text-blue-700',   border: 'border-blue-200',   accent: 'text-blue-600' },
    Monday:    { pill: 'bg-green-100 text-green-700',  border: 'border-green-200',  accent: 'text-green-600' },
    Tuesday:   { pill: 'bg-purple-100 text-purple-700', border: 'border-purple-200', accent: 'text-purple-600' },
    Wednesday: { pill: 'bg-orange-100 text-orange-700', border: 'border-orange-200', accent: 'text-orange-600' },
    Thursday:  { pill: 'bg-teal-100 text-teal-700',    border: 'border-teal-200',   accent: 'text-teal-600' }
};

// Time slots mapping
const TIME_SLOTS = [
    { index: 0, time: "09:00 AM - 10:15 AM", start: "09:00 AM" },
    { index: 1, time: "10:15 AM - 11:30 AM", start: "10:15 AM" },
    { index: 2, time: "11:30 AM - 12:45 PM", start: "11:30 AM" },
    { index: 3, time: "01:00 PM - 02:15 PM", start: "01:00 PM" },
    { index: 4, time: "02:15 PM - 03:30 PM", start: "02:15 PM" },
    { index: 5, time: "03:30 PM - 04:45 PM", start: "03:30 PM" }
];

// Tag color options
const TAG_COLORS = [
    { name: 'Blue', class: 'bg-blue-100 text-blue-800 border-blue-300' },
    { name: 'Purple', class: 'bg-purple-100 text-purple-800 border-purple-300' },
    { name: 'Red', class: 'bg-red-100 text-red-800 border-red-300' },
    { name: 'Green', class: 'bg-green-100 text-green-800 border-green-300' },
    { name: 'Orange', class: 'bg-orange-100 text-orange-800 border-orange-300' }
];

// ============================================
// HTML SANITIZATION
// ============================================

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// TOAST NOTIFICATION
// ============================================

let toastTimeout = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    const toastContainer = toast.querySelector('div');

    if (!toast || !toastMessage) return;

    const config = {
        success: { icon: '✅', borderColor: 'border-green-500', bg: 'bg-green-50' },
        error: { icon: '❌', borderColor: 'border-red-500', bg: 'bg-red-50' },
        warning: { icon: '⚠️', borderColor: 'border-yellow-500', bg: 'bg-yellow-50' },
        info: { icon: 'ℹ️', borderColor: 'border-blue-500', bg: 'bg-blue-50' }
    };

    const c = config[type] || config.info;

    toastIcon.textContent = c.icon;
    toastMessage.textContent = message;
    toastContainer.className = `${c.bg} rounded-lg shadow-2xl ${c.borderColor} border-l-4 p-4`;

    toast.classList.remove('hidden');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.toggle('hidden', !show);
    }
}

// ============================================
// FIREBASE TABLE NAME MAPPING
// ============================================

function getCollectionName(section) {
    const map = {
        'calendar': 'calendar',
        'announcements': 'announcements',
        'assignments': 'assignments',
        'subjects': 'subjects',
        'schedule': 'schedule',
        'contacts': 'contacts'
    };
    return map[section] || section;
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    // Initialize Firebase
    if (!initFirebase()) {
        showToast('Failed to connect to Firebase. Check configuration.', 'error');
        return;
    }

    // Setup auth listener
    onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            showDashboard();
        } else {
            currentUser = null;
            showLoginScreen();
        }
    });

    // Setup login form
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // Setup logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Setup section buttons
    document.querySelectorAll('.section-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            switchSection(this.dataset.section);
        });
    });
});

// ============================================
// AUTHENTICATION (with brute-force protection)
// ============================================

const LOGIN_MAX_ATTEMPTS = 3;
const LOGIN_LOCKOUT_MS = 60000; // 60 seconds

function getLoginState() {
    const attempts = parseInt(sessionStorage.getItem('login_attempts') || '0');
    const lockoutUntil = parseInt(sessionStorage.getItem('login_lockout_until') || '0');
    return { attempts, lockoutUntil };
}

function setLoginAttempts(count) {
    sessionStorage.setItem('login_attempts', String(count));
}

function setLockout() {
    const until = Date.now() + LOGIN_LOCKOUT_MS;
    sessionStorage.setItem('login_lockout_until', String(until));
    sessionStorage.setItem('login_attempts', '0');
    startLockoutCountdown(until);
}

function startLockoutCountdown(until) {
    const submitBtn = document.querySelector('#login-form button[type="submit"]');
    const lockoutDiv = document.getElementById('lockout-message');
    if (!submitBtn || !lockoutDiv) return;

    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    lockoutDiv.classList.remove('hidden');

    const tick = () => {
        const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        if (remaining <= 0) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            lockoutDiv.classList.add('hidden');
            sessionStorage.removeItem('login_lockout_until');
            return;
        }
        lockoutDiv.textContent = `Too many attempts. Try again in ${remaining}s`;
        setTimeout(tick, 1000);
    };
    tick();
}

async function handleLogin(e) {
    e.preventDefault();

    const { lockoutUntil } = getLoginState();
    if (lockoutUntil > Date.now()) {
        startLockoutCountdown(lockoutUntil);
        return;
    }

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');

    errorDiv.classList.add('hidden');

    try {
        await signIn(email, password);
        // Reset attempts on success
        sessionStorage.removeItem('login_attempts');
        sessionStorage.removeItem('login_lockout_until');
    } catch (error) {
        // Increment failed attempts
        let { attempts } = getLoginState();
        attempts++;
        setLoginAttempts(attempts);

        // Show inline error
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');

        // Check if lockout threshold reached
        if (attempts >= LOGIN_MAX_ATTEMPTS) {
            setLockout();
        }
    }
}

async function handleLogout() {
    try {
        await signOut();
        showToast('Logged out successfully', 'info');
    } catch (error) {
        showToast('Error logging out', 'error');
    }
}

function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('admin-dashboard').classList.add('hidden');
}

async function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');

    const emailSpan = document.getElementById('admin-email');
    if (emailSpan && currentUser) {
        emailSpan.textContent = currentUser.email;
    }

    await loadDashboardStats();
    await loadSectionData(currentSection);
}

// ============================================
// DASHBOARD STATS
// ============================================

async function loadDashboardStats() {
    try {
        const [calendar, announcements, assignments, subjects, schedule, contacts] = await Promise.all([
            getCollectionCount('calendar'),
            getCollectionCount('announcements'),
            getCollectionCount('assignments'),
            getCollectionCount('subjects'),
            getCollectionCount('schedule'),
            getCollectionCount('contacts')
        ]);

        document.getElementById('stat-calendar').textContent = calendar;
        document.getElementById('stat-announcements').textContent = announcements;
        document.getElementById('stat-assignments').textContent = assignments;
        document.getElementById('stat-subjects').textContent = subjects;
        document.getElementById('stat-schedule').textContent = schedule;
        document.getElementById('stat-contacts').textContent = contacts;
    } catch (error) {
        showToast('Error loading dashboard stats', 'error');
    }
}

// ============================================
// SECTION SWITCHING
// ============================================

function switchSection(section) {
    currentSection = section;

    // Update buttons
    document.querySelectorAll('.section-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });

    const activeBtn = document.querySelector(`[data-section="${section}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-blue-600', 'text-white');
        activeBtn.classList.remove('bg-gray-200', 'text-gray-700');
        activeBtn.blur();
    }

    // Update title
    const titles = {
        calendar: '📅 Calendar Events',
        announcements: '📢 Announcements',
        assignments: '📝 Assignments',
        subjects: '📚 Subjects',
        schedule: '🕐 Schedule',
        contacts: '👥 Contacts'
    };
    document.getElementById('section-title').textContent = titles[section] || section;

    // Hide/show global Add New button for schedule section
    const addNewBtn = document.getElementById('add-new-btn');
    if (addNewBtn) {
        addNewBtn.style.display = (section === 'schedule') ? 'none' : '';
    }
    
    // Hide/show Sync GCR Courses button for subjects section ONLY
    const syncCoursesBtn = document.getElementById('sync-courses-btn');
    if (syncCoursesBtn) {
        syncCoursesBtn.style.display = (section === 'subjects') ? '' : 'none';
    }

    loadSectionData(section);
}

// ============================================
// LOAD SECTION DATA
// ============================================

async function loadSectionData(section) {
    showLoading(true);
    const container = document.getElementById('data-container');

    try {
        const collectionName = getCollectionName(section);
        const data = await getCollection(collectionName);

        // Schedule uses its own grouped renderer
        if (section === 'schedule') {
            loadScheduleGrouped(container, data);
            showLoading(false);
            return;
        }

        if (data.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <div class="text-gray-400 text-5xl mb-4">📭</div>
                    <p class="text-gray-500 text-lg font-medium">No items yet</p>
                    <p class="text-gray-400 text-sm mt-2">Click "Add New" to create one</p>
                </div>
            `;
            hideBulkBar();
        } else {
            // Select All toggle
            container.innerHTML = `
                <div class="flex items-center gap-2 mb-3 pb-3 border-b">
                    <input type="checkbox" id="select-all-checkbox" class="w-4 h-4 accent-blue-600 cursor-pointer" onchange="toggleSelectAll(this.checked)">
                    <label for="select-all-checkbox" class="text-sm font-medium text-gray-600 cursor-pointer">Select All</label>
                </div>
            ` + data.map(item => renderDataItem(section, item)).join('');
        }
    } catch (error) {
        container.innerHTML = `
            <div class="text-center py-12">
                <div class="text-red-400 text-5xl mb-4">⚠️</div>
                <p class="text-red-500 text-lg font-medium">Error loading data</p>
                <p class="text-gray-400 text-sm mt-2">${escapeHTML(error.message)}</p>
            </div>
        `;
    }

    showLoading(false);
}

// ============================================
// RENDER DATA ITEMS
// ============================================

function renderDataItem(section, item) {
    let content = '';

    switch (section) {
        case 'calendar':
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700">${escapeHTML(item.category || '')}</span>
                            <span class="text-xs text-gray-500">${escapeHTML(item.date || '')}</span>
                        </div>
                        <p class="font-semibold text-gray-800">${escapeHTML(item.title || '')}</p>
                        <p class="text-sm text-gray-500 truncate">${escapeHTML(item.description || '')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;

        case 'announcements':
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold px-2 py-1 rounded-full ${escapeHTML(item.tagcolor || 'bg-blue-100 text-blue-800')}">${escapeHTML(item.category || '')}</span>
                        </div>
                        <p class="font-semibold text-gray-800">${escapeHTML(item.title || '')}</p>
                        <p class="text-sm text-gray-500 truncate">${escapeHTML(item.description || '')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;

        case 'assignments':
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold px-2 py-1 rounded-full ${escapeHTML(item.categorycolor || 'bg-blue-100 text-blue-700')}">${escapeHTML(item.category || '')}</span>
                            <span class="text-xs text-gray-500">${escapeHTML(item.subjectname || '')}</span>
                        </div>
                        <p class="font-semibold text-gray-800">${escapeHTML(item.title || '')}</p>
                        <p class="text-sm text-gray-500">Due: ${escapeHTML(item.deadline ? new Date(item.deadline).toLocaleString() : 'N/A')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;

        case 'subjects':
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">${escapeHTML(item.tag || '')}</span>
                        </div>
                        <p class="font-semibold text-gray-800">
                            ${escapeHTML(item.subjectname || '')} &bull; ${escapeHTML(item.short_name || '')} &bull; ${escapeHTML(item.gcr_name || 'Not linked')}
                        </p>
                        <p class="text-sm text-gray-500">${escapeHTML(item.coursecode || '')} | ${escapeHTML(item.teachername || '')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;

        case 'schedule':
            const timeSlot = TIME_SLOTS.find(s => s.index === item.timeslot_index);
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold px-2 py-1 rounded-full bg-purple-100 text-purple-700">${escapeHTML(item.day || '')}</span>
                            <span class="text-xs text-gray-500">${timeSlot ? escapeHTML(timeSlot.time) : escapeHTML(item.starttime || '')}</span>
                        </div>
                        <p class="font-semibold text-gray-800">${escapeHTML(item.subjectname || '')}</p>
                        <p class="text-sm text-gray-500">${escapeHTML(item.teachername || '')} | Room: ${escapeHTML(item.room || '')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;

        case 'contacts':
            content = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-gray-800">${escapeHTML(item.name || '')}</p>
                        <p class="text-sm text-gray-500">${escapeHTML(item.designation || '')} | ${escapeHTML(item.email || '')}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium transition">Edit</button>
                        <button onclick="deleteItem('${currentSection}', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition">Delete</button>
                    </div>
                </div>
            `;
            break;
    }

    return `<div class="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition flex items-start gap-3 data-item" data-item-id="${item.id}">
        <input type="checkbox" class="bulk-checkbox mt-1 w-4 h-4 accent-blue-600 cursor-pointer" data-id="${item.id}" onchange="updateBulkBar()">
        <div class="flex-1">${content}</div>
    </div>`;
}

// ============================================
// EDITOR / FORM
// ============================================

function openEditor(data = null, prefilledDay = null) {
    editingItem = data;
    prefilledDayForEditor = prefilledDay;
    const overlay = document.getElementById('editor-overlay');
    const title = document.getElementById('editor-title');
    const fields = document.getElementById('form-fields');

    title.textContent = data ? 'Edit Item' : 'Add New Item';
    fields.innerHTML = getFormFields(currentSection, data);

    overlay.classList.remove('hidden');

    // Initialize dynamic forms after rendering
    setTimeout(() => {
        if (currentSection === 'subjects') {
            initSubjectResourceForm();
            populateGcrDropdown(data?.gcr_name || '');
        } else if (currentSection === 'assignments') {
            initAssignmentLinksForm();
        }
    }, 100);
}

function closeEditor() {
    document.getElementById('editor-overlay').classList.add('hidden');
    editingItem = null;
}

function closeForm() {
    closeEditor();
}

async function editItem(id) {
    showLoading(true);
    try {
        const collectionName = getCollectionName(currentSection);
        const item = await getDocument(collectionName, id);
        if (item) {
            openEditor(item);
        }
    } catch (error) {
        showToast('Error loading item', 'error');
    }
    showLoading(false);
}

// ============================================
// FORM FIELDS
// ============================================

function getFormFields(section, data = null) {
    switch (section) {
        case 'calendar': return renderForm_calendar(data);
        case 'announcements': return renderForm_announcements(data);
        case 'assignments': return renderForm_assignments(data);
        case 'subjects': return renderForm_subjects(data);
        case 'schedule': return renderForm_schedule(data);
        case 'contacts': return renderForm_contacts(data);
        default: return '';
    }
}

function renderForm_calendar(data) {
    return `
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Date</label>
            <input type="date" id="field-date" value="${data?.date || ''}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <select id="field-category" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="Event" ${data?.category === 'Event' ? 'selected' : ''}>Event</option>
                <option value="Test" ${data?.category === 'Test' ? 'selected' : ''}>Test</option>
                <option value="Off Day" ${data?.category === 'Off Day' ? 'selected' : ''}>Off Day</option>
            </select>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input type="text" id="field-title" value="${escapeHTML(data?.title || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea id="field-description" rows="3" required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">${escapeHTML(data?.description || '')}</textarea>
        </div>
    `;
}

function renderForm_announcements(data) {
    const tagColorOptions = TAG_COLORS.map(tc =>
        `<option value="${tc.class}" ${data?.tagcolor === tc.class ? 'selected' : ''}>${tc.name}</option>`
    ).join('');
    return `
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <input type="text" id="field-category" value="${escapeHTML(data?.category || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                   placeholder="e.g., Notice, Update, Important">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Tag Color</label>
            <select id="field-tagcolor" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                ${tagColorOptions}
            </select>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input type="text" id="field-title" value="${escapeHTML(data?.title || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea id="field-description" rows="3" required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">${escapeHTML(data?.description || '')}</textarea>
        </div>
    `;
}

function renderForm_assignments(data) {
    return `
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Subject Name</label>
            <input type="text" id="field-subjectname" value="${escapeHTML(data?.subjectname || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <select id="field-category" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="Assignment" ${data?.category === 'Assignment' ? 'selected' : ''}>Assignment (Blue)</option>
                <option value="Test" ${data?.category === 'Test' ? 'selected' : ''}>Test (Red)</option>
                <option value="Presentation" ${data?.category === 'Presentation' ? 'selected' : ''}>Presentation (Purple)</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Color is automatically assigned based on category</p>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input type="text" id="field-title" value="${escapeHTML(data?.title || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea id="field-description" rows="3" required
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">${escapeHTML(data?.description || '')}</textarea>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Deadline</label>
            <input type="datetime-local" id="field-deadline" value="${data?.deadline ? data.deadline.slice(0, 16) : ''}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Related Links</label>
            <div id="assignment-links-container" class="space-y-2 mb-2"></div>
            <button type="button" onclick="addAssignmentLink()" class="text-sm text-blue-600 hover:text-blue-800 font-medium">
                + Add Link
            </button>
        </div>
    `;
}

function renderForm_subjects(data) {
    return `
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Subject Name</label>
            <input type="text" id="field-subjectname" value="${escapeHTML(data?.subjectname || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Short Name</label>
            <input type="text" id="field-short_name" value="${escapeHTML(data?.short_name || '')}" placeholder="e.g. BEE, DS, DE&LT" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                   style="text-transform: uppercase;"
                   oninput="this.value = this.value.toUpperCase()">
            <p class="text-xs text-gray-400 mt-1">Abbreviation shown on assignment badges</p>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">GCR Course Name</label>
            <select id="field-gcr_name"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition">
                <option value="">— Not linked to Classroom —</option>
                <!-- populated dynamically from settings/classroom_courses -->
            </select>
            <p class="text-xs text-gray-400 mt-1">Match to the exact Google Classroom course name</p>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Course Code</label>
            <input type="text" id="field-coursecode" value="${escapeHTML(data?.coursecode || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Teacher Name</label>
            <input type="text" id="field-teachername" value="${escapeHTML(data?.teachername || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Tag</label>
            <select id="field-tag" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="Theory" ${data?.tag === 'Theory' ? 'selected' : ''}>Theory</option>
                <option value="Theory & Lab" ${data?.tag === 'Theory & Lab' ? 'selected' : ''}>Theory & Lab</option>
            </select>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Drive Folder Link</label>
            <input type="url" id="field-drivefolder" value="${escapeHTML(data?.drivefolder || '')}"
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                   placeholder="https://drive.google.com/...">
            <p class="text-xs text-gray-500 mt-1">Link to the main Google Drive folder for this subject</p>
        </div>
        <div class="border-t pt-4 mt-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Resources</label>
            <div id="subject-resources-container" class="space-y-4"></div>
            <button type="button" onclick="addSubjectCategory()" class="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
                + Add Category
            </button>
        </div>
    `;
}

function renderForm_schedule(data) {
    let selectedSlotIndex = 0;
    if (data?.timeslot_index !== undefined) {
        selectedSlotIndex = data.timeslot_index;
    }
    const timeSlotOptions = TIME_SLOTS.map(slot =>
        `<option value="${slot.index}" ${selectedSlotIndex === slot.index ? 'selected' : ''}>${slot.time}</option>`
    ).join('');

    // Determine the day value: editing existing > prefilled from day button > empty
    const dayValue = data?.day || prefilledDayForEditor || 'Sunday';
    const isDayReadOnly = !!(data || prefilledDayForEditor);

    // Day field: read-only pill + hidden input when locked, editable select when not
    let dayFieldHTML = '';
    if (isDayReadOnly) {
        const colors = DAY_COLORS[dayValue] || DAY_COLORS.Sunday;
        dayFieldHTML = `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Day</label>
                <div class="flex items-center gap-2">
                    <span class="inline-block text-sm font-bold px-4 py-2 rounded-full ${colors.pill}">${escapeHTML(dayValue)}</span>
                    <span class="text-xs text-gray-400 italic">Day cannot be changed</span>
                </div>
                <input type="hidden" id="field-day" value="${escapeHTML(dayValue)}">
            </div>
        `;
    } else {
        dayFieldHTML = `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Day</label>
                <select id="field-day" required
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="Sunday" ${dayValue === 'Sunday' ? 'selected' : ''}>Sunday</option>
                    <option value="Monday" ${dayValue === 'Monday' ? 'selected' : ''}>Monday</option>
                    <option value="Tuesday" ${dayValue === 'Tuesday' ? 'selected' : ''}>Tuesday</option>
                    <option value="Wednesday" ${dayValue === 'Wednesday' ? 'selected' : ''}>Wednesday</option>
                    <option value="Thursday" ${dayValue === 'Thursday' ? 'selected' : ''}>Thursday</option>
                </select>
            </div>
        `;
    }

    return `
        ${dayFieldHTML}
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Time Slot</label>
            <select id="field-timeslot" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                ${timeSlotOptions}
            </select>
            <p class="text-xs text-gray-500 mt-1">Select the time slot for this class</p>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Subject Name</label>
            <input type="text" id="field-subjectname" value="${escapeHTML(data?.subjectname || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Teacher Name</label>
            <input type="text" id="field-teachername" value="${escapeHTML(data?.teachername || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Room</label>
            <input type="text" id="field-room" value="${escapeHTML(data?.room || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <select id="field-type" required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="Theory" ${data?.type === 'Theory' ? 'selected' : ''}>Theory</option>
                <option value="Lab" ${data?.type === 'Lab' ? 'selected' : ''}>Lab (spans 2 slots)</option>
            </select>
        </div>
    `;
}

function renderForm_contacts(data) {
    return `
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Name</label>
            <input type="text" id="field-name" value="${escapeHTML(data?.name || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Designation</label>
            <input type="text" id="field-designation" value="${escapeHTML(data?.designation || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input type="email" id="field-email" value="${escapeHTML(data?.email || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Contact Number</label>
            <input type="tel" id="field-contactnumber" value="${escapeHTML(data?.contactnumber || '')}" required
                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Contact Instructions</label>
            <textarea id="field-contactinstructions" rows="3"
                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">${escapeHTML(data?.contactinstructions || '')}</textarea>
        </div>
    `;
}

// ============================================
// FORM DATA COLLECTION
// ============================================

function getFormData(section) {
    let formData = {};

    switch (section) {
        case 'calendar':
            formData = {
                date: document.getElementById('field-date').value,
                category: document.getElementById('field-category').value,
                title: document.getElementById('field-title').value,
                description: document.getElementById('field-description').value
            };
            break;

        case 'announcements':
            formData = {
                category: document.getElementById('field-category').value,
                tagcolor: document.getElementById('field-tagcolor').value,
                title: document.getElementById('field-title').value,
                description: document.getElementById('field-description').value,
                created_at: editingItem?.created_at || new Date().toISOString()
            };
            break;

        case 'assignments':
            const linkInputs = document.querySelectorAll('.link-url');
            const links = Array.from(linkInputs)
                .map(input => input.value.trim())
                .filter(link => link !== '');

            const category = document.getElementById('field-category').value;
            let categoryColor = 'bg-blue-100 text-blue-700';
            if (category === 'Test') categoryColor = 'bg-red-100 text-red-700';
            else if (category === 'Presentation') categoryColor = 'bg-purple-100 text-purple-700';

            formData = {
                subjectname: document.getElementById('field-subjectname').value,
                category: category,
                categorycolor: categoryColor,
                title: document.getElementById('field-title').value,
                description: document.getElementById('field-description').value,
                deadline: new Date(document.getElementById('field-deadline').value).toISOString(),
                relatedlinks: JSON.stringify(links)
            };
            break;

        case 'subjects':
            const resources = {};
            const categoryDivs = document.querySelectorAll('[data-category-index]');

            categoryDivs.forEach(categoryDiv => {
                const categoryNameInput = categoryDiv.querySelector('.category-name');
                const categoryName = categoryNameInput.value.trim();

                if (categoryName) {
                    const fileEntries = categoryDiv.querySelectorAll('.file-entry');
                    const files = [];

                    fileEntries.forEach(fileEntry => {
                        const fileName = fileEntry.querySelector('.file-name').value.trim();
                        const fileUrl = fileEntry.querySelector('.file-url').value.trim();

                        if (fileName && fileUrl) {
                            files.push({ title: fileName, url: fileUrl });
                        }
                    });

                    if (files.length > 0) {
                        resources[categoryName] = files;
                    }
                }
            });

            formData = {
                subjectname: document.getElementById('field-subjectname').value,
                short_name: document.getElementById('field-short_name').value.toUpperCase(),
                gcr_name: document.getElementById('field-gcr_name').value,
                coursecode: document.getElementById('field-coursecode').value,
                teachername: document.getElementById('field-teachername').value,
                tag: document.getElementById('field-tag').value,
                drivefolder: document.getElementById('field-drivefolder').value,
                resources: resources
            };
            break;

        case 'schedule':
            const timeslotIndex = parseInt(document.getElementById('field-timeslot').value);
            const timeSlot = TIME_SLOTS.find(slot => slot.index === timeslotIndex);

            formData = {
                day: document.getElementById('field-day').value,
                subjectname: document.getElementById('field-subjectname').value,
                teachername: document.getElementById('field-teachername').value,
                room: document.getElementById('field-room').value,
                starttime: timeSlot ? timeSlot.start : '',
                timeslot_index: timeslotIndex,
                type: document.getElementById('field-type').value,
                bgcolor: 'white'
            };
            break;

        case 'contacts':
            formData = {
                name: document.getElementById('field-name').value,
                designation: document.getElementById('field-designation').value,
                email: document.getElementById('field-email').value,
                contactnumber: document.getElementById('field-contactnumber').value,
                contactinstructions: document.getElementById('field-contactinstructions').value
            };
            break;
    }

    return formData;
}

// ============================================
// SUBJECT RESOURCES DYNAMIC FORM
// ============================================

function initSubjectResourceForm() {
    const container = document.getElementById('subject-resources-container');
    if (!container) return;

    const resources = editingItem?.resources || {};

    if (Object.keys(resources).length === 0) {
        addSubjectCategory();
    } else {
        Object.keys(resources).forEach(categoryName => {
            const files = resources[categoryName] || [];
            addSubjectCategory(categoryName, files);
        });
    }
}

function addSubjectCategory(categoryName = '', files = []) {
    const container = document.getElementById('subject-resources-container');
    const categoryIndex = container.children.length;

    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'border-2 border-gray-300 rounded-lg p-3 sm:p-4 bg-gray-50';
    categoryDiv.dataset.categoryIndex = categoryIndex;

    categoryDiv.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center mb-3">
            <input type="text" class="category-name flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                   placeholder="Category Name (e.g., Books, Slides)" value="${escapeHTML(categoryName)}">
            <button type="button" onclick="removeSubjectCategory(${categoryIndex})"
                    class="text-red-600 hover:text-red-800 px-4 py-2 rounded bg-red-50 hover:bg-red-100 text-sm font-medium whitespace-nowrap">
                Remove Category
            </button>
        </div>
        <div class="files-container space-y-3 mb-3" data-category="${categoryIndex}"></div>
        <button type="button" onclick="addSubjectFile(${categoryIndex})"
                class="text-sm text-green-600 hover:text-green-800 font-medium px-3 py-2 bg-green-50 hover:bg-green-100 rounded">
            + Add File
        </button>
    `;

    container.appendChild(categoryDiv);

    if (files.length === 0) {
        addSubjectFile(categoryIndex);
    } else {
        files.forEach(file => {
            addSubjectFile(categoryIndex, file.title || file.name || '', file.url || file.link || '');
        });
    }
}

function addSubjectFile(categoryIndex, fileName = '', fileUrl = '') {
    const filesContainer = document.querySelector(`.files-container[data-category="${categoryIndex}"]`);
    if (!filesContainer) return;

    const fileDiv = document.createElement('div');
    fileDiv.className = 'bg-white border border-gray-200 rounded-lg p-3 file-entry';

    fileDiv.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-2">
            <div class="flex-1 space-y-2">
                <input type="text" class="file-name w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                       placeholder="File Name" value="${escapeHTML(fileName)}">
                <input type="url" class="file-url w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                       placeholder="File URL (https://...)" value="${escapeHTML(fileUrl)}">
            </div>
            <button type="button" onclick="removeSubjectFile(this)"
                    class="self-start sm:self-center text-red-600 hover:text-red-800 px-3 py-2 bg-red-50 hover:bg-red-100 rounded text-sm font-medium whitespace-nowrap">
                Remove
            </button>
        </div>
    `;

    filesContainer.appendChild(fileDiv);
}

function removeSubjectCategory(categoryIndex) {
    const container = document.getElementById('subject-resources-container');
    const categoryDiv = container.querySelector(`[data-category-index="${categoryIndex}"]`);
    if (categoryDiv) categoryDiv.remove();
}

function removeSubjectFile(button) {
    button.closest('.file-entry').remove();
}

// ============================================
// ASSIGNMENT LINKS DYNAMIC FORM
// ============================================

function initAssignmentLinksForm() {
    const container = document.getElementById('assignment-links-container');
    if (!container) return;

    let links = [];
    if (editingItem?.relatedlinks) {
        try {
            links = typeof editingItem.relatedlinks === 'string'
                ? JSON.parse(editingItem.relatedlinks)
                : editingItem.relatedlinks;
        } catch (e) {
            // Ignore parse error
        }
    }

    if (links.length === 0) {
        addAssignmentLink();
    } else {
        links.forEach(link => addAssignmentLink(link));
    }
}

function addAssignmentLink(linkUrl = '') {
    const container = document.getElementById('assignment-links-container');
    if (!container) return;

    const linkDiv = document.createElement('div');
    linkDiv.className = 'bg-gray-50 border border-gray-200 rounded-lg p-2 link-entry';

    linkDiv.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-2">
            <input type="url" class="link-url flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                   placeholder="Enter URL (https://...)" value="${escapeHTML(linkUrl)}">
            <button type="button" onclick="removeAssignmentLink(this)"
                    class="text-red-600 hover:text-red-800 px-3 py-2 bg-red-50 hover:bg-red-100 rounded text-sm font-medium whitespace-nowrap">
                Remove
            </button>
        </div>
    `;

    container.appendChild(linkDiv);
}

function removeAssignmentLink(button) {
    button.closest('.link-entry').remove();
}

// ============================================
// AUDIT LOG (Task 13)
// ============================================

async function writeAuditLog(action, section, itemId, details = '') {
    try {
        await addDocument('audit_log', {
            timestamp: new Date().toISOString(),
            user: currentUser?.email || 'unknown',
            action: action,
            section: section,
            itemId: itemId || '',
            details: details
        });
    } catch (e) {
        // Audit log failure should not block the action
    }
}

// ============================================
// SAVE FUNCTIONS (with audit log)
// ============================================

async function saveItem() {
    showLoading(true);

    try {
        const formData = getFormData(currentSection);
        const collectionName = getCollectionName(currentSection);

        if (editingItem) {
            await updateDocument(collectionName, editingItem.id, formData);
            await writeAuditLog('update', currentSection, editingItem.id, formData.title || formData.subjectname || formData.name || '');
            showToast('Updated successfully!', 'success');
        } else {
            const newDoc = await addDocument(collectionName, formData);
            await writeAuditLog('create', currentSection, newDoc?.id || '', formData.title || formData.subjectname || formData.name || '');
            showToast('Added successfully!', 'success');
        }

        closeForm();
        await loadSectionData(currentSection);
        await loadDashboardStats();

    } catch (error) {
        showToast('Error saving: ' + error.message, 'error');
    }

    showLoading(false);
}

// ============================================
// DELETE FUNCTIONS (with audit log)
// ============================================

async function deleteItem(section, id) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    showLoading(true);

    try {
        const collectionName = getCollectionName(section);
        await deleteDocument(collectionName, id);
        await writeAuditLog('delete', section, id);

        showToast('Deleted successfully!', 'success');
        await loadSectionData(section);
        await loadDashboardStats();

    } catch (error) {
        showToast('Error deleting: ' + error.message, 'error');
    }

    showLoading(false);
}

// ============================================
// BULK OPERATIONS (Task 12)
// ============================================

function getSelectedIds() {
    return Array.from(document.querySelectorAll('.bulk-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateBulkBar() {
    const selected = getSelectedIds();
    const bar = document.getElementById('bulk-action-bar');
    const count = document.getElementById('bulk-count');
    if (!bar) return;
    if (selected.length > 0) {
        bar.classList.remove('hidden');
        if (count) count.textContent = `${selected.length} selected`;
    } else {
        bar.classList.add('hidden');
    }
    // Update Select All state
    const selectAll = document.getElementById('select-all-checkbox');
    const total = document.querySelectorAll('.bulk-checkbox').length;
    if (selectAll) selectAll.checked = selected.length === total && total > 0;
}

function hideBulkBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (bar) bar.classList.add('hidden');
}

function toggleSelectAll(checked) {
    document.querySelectorAll('.bulk-checkbox').forEach(cb => { cb.checked = checked; });
    updateBulkBar();
}

async function bulkDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item(s)? This cannot be undone.`)) return;

    showLoading(true);
    try {
        const collectionName = getCollectionName(currentSection);
        await Promise.all(ids.map(id => deleteDocument(collectionName, id)));
        await writeAuditLog('bulk_delete', currentSection, ids.join(','), `${ids.length} items deleted`);
        showToast(`${ids.length} items deleted`, 'success');
        hideBulkBar();
        await loadSectionData(currentSection);
        await loadDashboardStats();
    } catch (error) {
        showToast('Error during bulk delete: ' + error.message, 'error');
    }
    showLoading(false);
}

async function archiveItems() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (!confirm(`Archive ${ids.length} item(s)? They will be hidden from the portal.`)) return;

    showLoading(true);
    try {
        const collectionName = getCollectionName(currentSection);
        await Promise.all(ids.map(id => updateDocument(collectionName, id, { archived: true })));
        await writeAuditLog('bulk_archive', currentSection, ids.join(','), `${ids.length} items archived`);
        showToast(`${ids.length} items archived`, 'success');
        hideBulkBar();
        await loadSectionData(currentSection);
        await loadDashboardStats();
    } catch (error) {
        showToast('Error during archive: ' + error.message, 'error');
    }
    showLoading(false);
}

// ============================================
// GCR COURSE SYNC (Classroom Integration)
// ============================================

async function syncClassroomCourses() {
  showLoading(true);
  try {
    const doc = await getDocument('settings', 'classroom_courses');
    if (!doc || !doc.courses || doc.courses.length === 0) {
      showToast('No courses found. Run manualSync() in Apps Script first.', 'warning');
      return;
    }
    showToast(`${doc.courses.length} courses loaded successfully.`, 'success');
    loadSectionData('subjects');
  } catch (e) {
    showToast('Failed to load courses.', 'error');
  } finally {
    showLoading(false);
  }
}

async function populateGcrDropdown(selectedValue = '') {
  const select = document.getElementById('field-gcr_name');
  if (!select) return;

  try {
    const doc = await getDocument('settings', 'classroom_courses');
    console.log('[GCR] raw doc:', JSON.stringify(doc));

    let courses = [];
    if (doc && doc.courses) {
      if (Array.isArray(doc.courses)) {
        courses = doc.courses;
      } else if (typeof doc.courses === 'object') {
        courses = Object.values(doc.courses);
      }
    }

    console.log('[GCR] parsed courses:', courses);

    if (courses.length === 0) {
      select.innerHTML = '<option value="">No courses found — run manualSync() in Apps Script first</option>';
      return;
    }

    select.innerHTML = '<option value="">— Not linked to Classroom —</option>';
    courses.forEach(courseName => {
      if (!courseName || typeof courseName !== 'string') return;
      const opt = document.createElement('option');
      opt.value = courseName;
      opt.textContent = courseName;
      if (courseName === selectedValue) opt.selected = true;
      select.appendChild(opt);
    });

  } catch (e) {
    console.error('[GCR] populateGcrDropdown error:', e);
    select.innerHTML = '<option value="">Could not load courses — check console for details</option>';
  }
}

// ============================================
// MAKE FUNCTIONS GLOBALLY ACCESSIBLE
// ============================================

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.closeForm = closeForm;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.saveItem = saveItem;
window.addSubjectCategory = addSubjectCategory;
window.addSubjectFile = addSubjectFile;
window.removeSubjectCategory = removeSubjectCategory;
window.removeSubjectFile = removeSubjectFile;
window.addAssignmentLink = addAssignmentLink;
window.removeAssignmentLink = removeAssignmentLink;
window.toggleSelectAll = toggleSelectAll;
window.updateBulkBar = updateBulkBar;
window.bulkDelete = bulkDelete;
window.archiveItems = archiveItems;
window.toggleDayCollapse = toggleDayCollapse;
window.openEditorForDay = openEditorForDay;
window.saveScheduleExportUrl = saveScheduleExportUrl;
window.syncClassroomCourses = syncClassroomCourses;

// ============================================
// SCHEDULE EXPORT URL SETTINGS
// ============================================

async function loadScheduleExportUrl() {
    try {
        const doc = await getDocument('settings', 'schedule_export');
        const input = document.getElementById('export-url-input');
        if (input && doc && doc.exportImageUrl) {
            input.value = doc.exportImageUrl;
        }
    } catch (e) {
        // Silently fail — field stays empty
    }
}

async function saveScheduleExportUrl() {
    const input = document.getElementById('export-url-input');
    if (!input || !input.value.trim()) {
        showToast('Please enter a valid URL.', 'warning');
        return;
    }
    try {
        showLoading(true);
        // Use set (via updateDocument) — create or overwrite the document
        await db.collection('settings').doc('schedule_export').set(
            { exportImageUrl: input.value.trim() },
            { merge: true }
        );
        showToast('Export URL saved successfully.', 'success');
    } catch (e) {
        showToast('Failed to save URL.', 'error');
    }
    showLoading(false);
}

// ============================================
// SCHEDULE — GROUPED BY DAY RENDERER
// ============================================

function loadScheduleGrouped(container, data) {
    // Group items by day
    const grouped = {};
    SCHEDULE_DAYS.forEach(day => { grouped[day] = []; });
    data.forEach(item => {
        const day = item.day;
        if (grouped[day]) {
            grouped[day].push(item);
        }
    });

    // Sort each day's classes by timeslot_index
    SCHEDULE_DAYS.forEach(day => {
        grouped[day].sort((a, b) => (a.timeslot_index || 0) - (b.timeslot_index || 0));
    });

    // Select All checkbox at the top
    let html = `
        <div class="flex items-center gap-2 mb-4 pb-3 border-b">
            <input type="checkbox" id="select-all-checkbox" class="w-4 h-4 accent-blue-600 cursor-pointer" onchange="toggleSelectAll(this.checked)">
            <label for="select-all-checkbox" class="text-sm font-medium text-gray-600 cursor-pointer">Select All</label>
        </div>
    `;

    // Render each day card
    SCHEDULE_DAYS.forEach(day => {
        html += renderScheduleDayCard(day, grouped[day]);
    });

    container.innerHTML = `
        <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <h3 class="text-sm font-semibold text-gray-700 mb-3">Schedule Export Image</h3>
            <div class="flex gap-3 items-center">
                <input type="text" id="export-url-input" placeholder="https://drive.google.com/..."
                    class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition">
                <button onclick="saveScheduleExportUrl()"
                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap">
                    Save URL
                </button>
            </div>
        </div>
    ` + html;
    loadScheduleExportUrl();
}

function renderScheduleDayCard(day, classes) {
    const colors = DAY_COLORS[day];
    const count = classes.length;
    const countText = count === 0 ? 'No classes yet' : count === 1 ? '1 class' : `${count} classes`;
    const isCollapsed = scheduleCollapseState[day];
    const chevronRotation = isCollapsed ? '' : 'rotate-180';

    let bodyContent = '';

    if (count === 0) {
        bodyContent = `
            <div class="text-center py-6">
                <p class="text-gray-400 text-sm italic">No classes scheduled for ${escapeHTML(day)}</p>
            </div>
        `;
    } else {
        bodyContent = classes.map((item, idx) => {
            const timeSlot = TIME_SLOTS.find(s => s.index === item.timeslot_index);
            const timeText = timeSlot ? timeSlot.time : (item.starttime || '');
            const typeBadge = item.type === 'Lab'
                ? '<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">Lab</span>'
                : '<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Theory</span>';
            const divider = idx < classes.length - 1 ? '<div class="border-t border-gray-100 my-0"></div>' : '';

            return `
                <div class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition" data-item-id="${item.id}">
                    <input type="checkbox" class="bulk-checkbox w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0" data-id="${item.id}" onchange="updateBulkBar()">
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-gray-800 text-sm">${escapeHTML(item.subjectname || '')}</p>
                        <p class="text-xs text-gray-400">${escapeHTML(item.teachername || '')} · Room ${escapeHTML(item.room || '')}</p>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-xs text-gray-500 hidden sm:inline">${escapeHTML(timeText)}</span>
                        ${typeBadge}
                        <button onclick="editItem('${item.id}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition">Edit</button>
                        <button onclick="deleteItem('schedule', '${item.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition">Delete</button>
                    </div>
                </div>
                ${divider}
            `;
        }).join('');
    }

    return `
        <div class="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden shadow-sm">
            <!-- Day Header -->
            <div class="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-50 transition" onclick="toggleDayCollapse('${day}')">
                <div class="flex items-center gap-3">
                    <span class="text-xs font-bold px-3 py-1 rounded-full ${colors.pill}">${escapeHTML(day)}</span>
                    <span class="text-sm text-gray-500">${countText}</span>
                </div>
                <svg class="w-5 h-5 text-gray-400 chevron-icon ${chevronRotation}" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="transition: transform 0.2s;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
            </div>
            <!-- Day Body -->
            <div class="schedule-day-body" data-day="${day}" style="${isCollapsed ? 'display:none;' : ''}">
                <div class="border-t border-gray-100">
                    ${bodyContent}
                </div>
                <!-- Add Class Button -->
                <div class="px-4 py-3 border-t border-gray-100">
                    <button onclick="openEditorForDay('${day}')" class="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-400 transition">
                        + Add class to ${escapeHTML(day)}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function toggleDayCollapse(day) {
    scheduleCollapseState[day] = !scheduleCollapseState[day];
    const body = document.querySelector(`.schedule-day-body[data-day="${day}"]`);
    const card = body?.closest('.bg-white');
    const chevron = card?.querySelector('.chevron-icon');

    if (body) {
        body.style.display = scheduleCollapseState[day] ? 'none' : '';
    }
    if (chevron) {
        if (scheduleCollapseState[day]) {
            chevron.classList.remove('rotate-180');
        } else {
            chevron.classList.add('rotate-180');
        }
    }
}

function openEditorForDay(day) {
    openEditor(null, day);
}

// ============================================
// Ã°Å¸Å¡â‚¬ PORTAL ENGINE - FIREBASE VERSION
// ============================================

// State
let currentMonthOffset = 0;
let calendarCache = {};
let currentFilter = 'all';
let announcementsData = [];
let assignmentsData = [];
let subjectsData = [];
let calendarEvents = {};
let contactData = [];
let scheduleData = null;
let globalCountdownId = null; // Single global ticker
let pendingUpdateData = null; // Holds background-fetched data for update banner
let updateBannerSuppressed = false; // Session suppression flag

// ============================================
// HTML SANITIZATION (XSS Prevention)
// ============================================

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// TOAST NOTIFICATION (Visible to Users)
// ============================================

let toastTimeout = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    const toastContainer = toast.querySelector('div');

    if (!toast || !toastMessage) return;

    // Set icon and border color based on type
    const config = {
        success: { icon: '\u2705', borderColor: 'border-green-500', bg: 'bg-green-50' },
        error: { icon: '\u274C', borderColor: 'border-red-500', bg: 'bg-red-50' },
        warning: { icon: '\u26A0\uFE0F', borderColor: 'border-yellow-500', bg: 'bg-yellow-50' },
        info: { icon: '\u2139\uFE0F', borderColor: 'border-blue-500', bg: 'bg-blue-50' }
    };

    const c = config[type] || config.info;

    toastIcon.textContent = c.icon;
    toastMessage.textContent = message;
    toastContainer.className = `${c.bg} rounded-lg shadow-2xl ${c.borderColor} border-l-4 p-4 toast-slide-up`;

    toast.classList.remove('hidden');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => hideToast(), 5000);
}

function hideToast() {
    const toast = document.getElementById('toast');
    if (toast) toast.classList.add('hidden');
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
}

// Make globally accessible
window.hideToast = hideToast;

// ============================================
// WEEKLY STATISTICS
// ============================================

function calculateWeeklyStats() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    let weeklyEvents = 0;
    let weeklyTests = 0;
    let weeklyAssignments = 0;

    // Count calendar events for this week
    Object.keys(calendarEvents).forEach(dateStr => {
        const eventDate = new Date(dateStr + 'T00:00:00');
        if (eventDate >= startOfWeek && eventDate <= endOfWeek) {
            const events = calendarEvents[dateStr];
            events.forEach(evt => {
                if (evt.category === 'Test') {
                    weeklyTests++;
                } else {
                    weeklyEvents++;
                }
            });
        }
    });

    // Count assignments due this week Ã¢â‚¬â€ only Assignment and Presentation, never Test
    assignmentsData.forEach(assignment => {
        const deadline = new Date(assignment.deadline);
        if (deadline >= startOfWeek && deadline <= endOfWeek) {
            const cat = (assignment.category || '').toLowerCase();
            if (cat !== 'test') {
                weeklyAssignments++;
            }
        }
    });

    return { weeklyEvents, weeklyTests, weeklyAssignments };
}

function updateWeeklyStats() {
    const stats = calculateWeeklyStats();

    const eventsEl = document.getElementById('weekly-events-count');
    const testsEl = document.getElementById('weekly-tests-count');
    const assignmentsEl = document.getElementById('weekly-assignments-count');

    if (eventsEl) eventsEl.textContent = stats.weeklyEvents;
    if (testsEl) testsEl.textContent = stats.weeklyTests;
    if (assignmentsEl) assignmentsEl.textContent = stats.weeklyAssignments;
}

// ============================================
// DATA LOADING FROM FIREBASE (Progressive)
// ============================================

// Skeleton loader HTML for sections
function sectionSkeleton(cols = 3) {
    const card = '<div class="skeleton h-40 rounded-xl"></div>';
    return `<div class="grid md:grid-cols-${cols} gap-6">${card.repeat(cols)}</div>`;
}

function sectionError(sectionName, retryFn) {
    return `<div class="col-span-full text-center py-12">
        <i data-lucide="alert-triangle" class="w-12 h-12 mx-auto text-red-400 mb-3"></i>
        <p class="text-gray-600 font-medium">Could not load ${escapeHTML(sectionName)}.</p>
        <button onclick="${retryFn}" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">
            Retry
        </button>
    </div>`;
}

function mapAnnouncements(raw) {
    return raw.filter(a => a.archived !== true).map(a => ({
        id: a.id,
        category: a.category || '',
        tagColor: a.tagcolor || 'bg-blue-100 text-blue-800 border-blue-300',
        title: a.title || '',
        description: a.description || '',
        date: a.created_at || a.date || new Date().toISOString()
    }));
}

function mapAssignments(raw) {
    return raw.filter(a => a.archived !== true).map(a => ({
        id: a.id,
        subject: a.subjectname || '',
        category: a.category || 'Assignment',
        categoryColor: a.categorycolor || 'bg-blue-100 text-blue-700',
        title: a.title || '',
        description: a.description || '',
        deadline: a.deadline || '',
        relatedLinks: parseLinks(a.relatedlinks)
    }));
}

function mapSubjects(raw) {
    return raw.filter(s => s.archived !== true).map(s => ({
        id: s.id,
        name: s.subjectname || '',
        fullName: s.coursecode || '',
        teacher: s.teachername || '',
        type: (s.tag || 'theory').toLowerCase(),
        icon: s.tag === 'Lab' ? 'flask-conical' : 'book-open',
        color: getSubjectColor(s.subjectname),
        driveFolder: s.drivefolder || '#',
        categories: transformResources(s.resources)
    }));
}

function mapCalendar(raw) {
    const events = {};
    raw.filter(e => e.archived !== true).forEach(evt => {
        const date = evt.date;
        if (!events[date]) events[date] = [];
        events[date].push({
            title: evt.title || '',
            description: evt.description || '',
            category: evt.category || 'Event'
        });
    });
    return events;
}

function mapContacts(raw) {
    return raw.filter(c => c.archived !== true).map(c => ({
        id: c.id,
        name: c.name || '',
        designation: c.designation || '',
        email: c.email || '',
        phone: c.contactnumber || '',
        profileImage: c.profileimage || '',
        howToContact: c.contactinstructions || ''
    }));
}

// Phase 1: Critical data (announcements + assignments)
async function loadPhase1() {
    const announcementsContainer = document.getElementById('announcements-container');
    const assignmentsContainer = document.getElementById('assignments-container');

    // Show skeletons
    if (announcementsContainer) announcementsContainer.innerHTML = sectionSkeleton(3);
    if (assignmentsContainer) assignmentsContainer.innerHTML = sectionSkeleton(3);

    try {
        const [announcements, assignments] = await Promise.all([
            getCollection('announcements'),
            getCollection('assignments')
        ]);
        announcementsData = mapAnnouncements(announcements);
        assignmentsData = mapAssignments(assignments);
        renderAnnouncements();
        renderAssignments();
    } catch (error) {
        if (announcementsContainer) announcementsContainer.innerHTML = sectionError('announcements', 'retryPhase1()');
        if (assignmentsContainer) assignmentsContainer.innerHTML = sectionError('assignments', 'retryPhase1()');
    }
    lucide.createIcons();
}

// Phase 2: Deferred data (calendar, subjects, schedule, contacts)
async function loadPhase2() {
    const subjectsContainer = document.getElementById('subjects-container');
    const contactContainer = document.getElementById('contact-container');

    // Show skeletons
    if (subjectsContainer) subjectsContainer.innerHTML = sectionSkeleton(3);
    if (contactContainer) contactContainer.innerHTML = sectionSkeleton(2);

    try {
        const [calendar, subjects, schedule, contacts] = await Promise.all([
            getCollection('calendar'),
            getCollection('subjects'),
            getCollection('schedule'),
            getCollection('contacts')
        ]);

        calendarCache = {}; // Invalidate calendar cache
        calendarEvents = mapCalendar(calendar);
        subjectsData = mapSubjects(subjects);
        scheduleData = buildScheduleData(schedule.filter(s => s.archived !== true));
        contactData = mapContacts(contacts);

        renderSchedule();
        renderSubjects();
        renderContacts();
        updateWeeklyStats();
    } catch (error) {
        if (subjectsContainer) subjectsContainer.innerHTML = sectionError('subjects', 'retryPhase2()');
        if (contactContainer) contactContainer.innerHTML = sectionError('contacts', 'retryPhase2()');
    }
    lucide.createIcons();
}

async function retryPhase1() { await loadPhase1(); }
async function retryPhase2() { await loadPhase2(); }
window.retryPhase1 = retryPhase1;
window.retryPhase2 = retryPhase2;

// Full load (used by background refresh)
async function loadAllData() {
    calendarCache = {};
    const [announcements, assignments, subjects, calendar, contacts, schedule] = await Promise.all([
        getCollection('announcements'),
        getCollection('assignments'),
        getCollection('subjects'),
        getCollection('calendar'),
        getCollection('contacts'),
        getCollection('schedule')
    ]);
    return { announcements, assignments, subjects, calendar, contacts, schedule };
}

function parseLinks(linksData) {
    if (!linksData) return [];
    try {
        const parsed = typeof linksData === 'string' ? JSON.parse(linksData) : linksData;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getSubjectColor(name) {
    return 'bg-blue-600';
}

function transformResources(resources) {
    if (!resources || typeof resources !== 'object') return {};
    const flat = {};
    Object.keys(resources).forEach(category => {
        const items = resources[category];
        if (Array.isArray(items)) {
            flat[category] = items.map(item => ({
                name: item.title || item.name || 'Untitled',
                link: item.url || item.link || '#'
            }));
        }
    });

    // Build a tree from path-based category names (e.g. "Notes / Slides")
    const tree = buildResourceTree(flat);

    // Attach the tree to a special key so the modal renderer can use it
    flat._tree = tree;
    return flat;
}

/**
 * Build a nested tree from flat path-based category keys.
 * Input:  { "Notes": [...], "Notes / Slides": [...], "Books": [...] }
 * Output: [ { name: "Notes", files: [...], children: [ { name: "Slides", files: [...], children: [] } ] },
 *           { name: "Books", files: [...], children: [] } ]
 */
function buildResourceTree(flat) {
    const root = [];

    // Sort keys so parents come before children
    const keys = Object.keys(flat).filter(k => k !== '_tree').sort();

    // Map to find nodes by path
    const nodeMap = {};

    keys.forEach(key => {
        const parts = key.split(' / ');
        const name = parts[parts.length - 1];
        const node = { name: name, fullPath: key, files: flat[key], children: [] };
        nodeMap[key] = node;

        if (parts.length === 1) {
            // Top-level category
            root.push(node);
        } else {
            // Find parent by reconstructing parent path
            const parentPath = parts.slice(0, -1).join(' / ');
            if (nodeMap[parentPath]) {
                nodeMap[parentPath].children.push(node);
            } else {
                // Parent doesn't exist as its own category, add to root
                root.push(node);
            }
        }
    });

    return root;
}

function buildScheduleData(scheduleItems) {
    const timeSlots = [
        "09:00 - 10:15", "10:15 - 11:30", "11:30 - 12:45",
        "01:00 - 02:15", "02:15 - 03:30", "03:30 - 04:45"
    ];
    const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
    const days = dayOrder.map(dayName => {
        const dayClasses = scheduleItems.filter(s => s.day === dayName);
        const classes = Array(6).fill(null);

        dayClasses.forEach(c => {
            const slotIndex = c.timeslot_index !== undefined ? c.timeslot_index : 0;
            if (slotIndex >= 0 && slotIndex < 6) {
                const isLab = (c.type || '').toLowerCase() === 'lab';
                classes[slotIndex] = {
                    name: c.subjectname || '',
                    instructor: c.teachername || '',
                    room: c.room || '',
                    colspan: isLab ? 2 : 1
                };
                if (isLab && slotIndex + 1 < 6) {
                    classes[slotIndex + 1] = 'SKIP';
                }
            }
        });

        return { day: dayName, classes };
    });

    return { timeSlots, days };
}

// ============================================
// ANNOUNCEMENT VISIBILITY
// ============================================

function shouldShowAnnouncement(dateStr) {
    const announcementDate = new Date(dateStr);
    const now = new Date();
    const daysDiff = Math.floor((now - announcementDate) / (1000 * 60 * 60 * 24));
    return daysDiff <= 7;
}

// ============================================
// ASSIGNMENT VISIBILITY
// ============================================

function shouldShowAssignment(deadlineStr) {
    const deadline = new Date(deadlineStr);
    const now = new Date();
    const hoursDiff = (now - deadline) / (1000 * 60 * 60);
    return hoursDiff <= 24;
}

// ============================================
// CARD GENERATORS (with XSS protection)
// ============================================

function createAnnouncementCard(announcement) {
    const isNew = (() => {
        const created = new Date(announcement.date);
        const now = new Date();
        return (now - created) < (24 * 60 * 60 * 1000);
    })();

    return `
        <div class="relative p-6 bg-white border border-gray-200 rounded-xl shadow-lg transition hover:shadow-xl hover:border-blue-400">
            ${isNew ? '<span class="new-badge">NEW</span>' : ''}
            <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-semibold px-3 py-1 rounded-full border ${announcement.tagColor}">
                    ${escapeHTML(announcement.category)}
                </span>
            </div>
            <h4 class="mt-2 text-lg font-bold text-gray-800">${escapeHTML(announcement.title)}</h4>
            <p class="mt-2 text-sm text-gray-600">${escapeHTML(announcement.description)}</p>
            <div class="mt-3 text-xs text-gray-400 flex items-center gap-2">
                <i data-lucide="clock" class="w-3 h-3"></i>
                ${escapeHTML(new Date(announcement.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))}
            </div>
        </div>
    `;
}

function createAssignmentCard(assignment) {
    const deadline = new Date(assignment.deadline);
    const now = new Date();
    const isPast = now > deadline;
    const hoursLeft = (deadline - now) / (1000 * 60 * 60);

    let urgencyClass = '';
    let urgencyLabel = '';
    if (isPast) {
        urgencyLabel = '<span aria-label="Deadline passed" class="flex items-center gap-1 text-sm font-semibold text-gray-500"><span>\u23F3</span> Deadline Passed</span>';
    } else if (hoursLeft <= 24) {
        urgencyClass = 'countdown-urgent-red';
        urgencyLabel = '<span aria-label="Urgent: less than 24 hours remaining" class="flex items-center gap-1 text-xs font-bold text-red-600"><span>\uD83D\uDD34</span> Urgent</span>';
    } else if (hoursLeft <= 48) {
        urgencyClass = 'countdown-urgent-orange';
        urgencyLabel = '<span aria-label="Due soon: less than 48 hours remaining" class="flex items-center gap-1 text-xs font-bold text-orange-600"><span>\u26A0\uFE0F</span> Due Soon</span>';
    }

    return `
        <div class="group p-6 bg-white border-2 border-gray-200 rounded-xl shadow-lg transition hover:shadow-xl hover:border-blue-600 cursor-pointer assignment-card"
             data-assignment-id="${escapeHTML(assignment.id)}">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold px-3 py-1 rounded-full ${assignment.categoryColor}">
                        ${escapeHTML(assignment.category)}
                    </span>
                    ${assignment.subject ? `<span class="text-xs font-semibold px-3 py-1 rounded-full bg-blue-600 text-white">${escapeHTML(assignment.subject)}</span>` : ''}
                    ${urgencyLabel}
                </div>
            </div>
            <h4 class="text-lg font-bold text-gray-800 mb-2">${escapeHTML(assignment.title)}</h4>
            <p class="text-sm text-gray-600 mb-4 line-clamp-2">${escapeHTML(assignment.description)}</p>
            
            ${isPast ? `
                <div class="text-center py-2 px-4 bg-gray-100 rounded-lg">
                    ${urgencyLabel}
                </div>
            ` : `
                <div class="${urgencyClass}">
                    <p class="text-xs text-gray-500 text-center mb-2">Time Remaining</p>
                    <div class="countdown-display flex gap-2 justify-center" data-deadline="${assignment.deadline}">
                        <div class="countdown-box bg-gray-100 rounded-lg p-2 text-center">
                            <div class="text-xl font-bold text-blue-600 countdown-days">--</div>
                            <div class="text-xs text-gray-500">Days</div>
                        </div>
                        <div class="countdown-box bg-gray-100 rounded-lg p-2 text-center">
                            <div class="text-xl font-bold text-blue-600 countdown-hours">--</div>
                            <div class="text-xs text-gray-500">Hrs</div>
                        </div>
                        <div class="countdown-box bg-gray-100 rounded-lg p-2 text-center">
                            <div class="text-xl font-bold text-blue-600 countdown-mins">--</div>
                            <div class="text-xs text-gray-500">Min</div>
                        </div>
                        <div class="countdown-box bg-gray-100 rounded-lg p-2 text-center">
                            <div class="text-xl font-bold text-blue-600 countdown-secs">--</div>
                            <div class="text-xs text-gray-500">Sec</div>
                        </div>
                    </div>
                </div>
            `}
            
            <div class="mt-3 text-xs text-gray-400 flex items-center gap-2">
                <i data-lucide="calendar" class="w-3 h-3"></i>
                Due: ${escapeHTML(deadline.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}
            </div>
        </div>
    `;
}

function renderAssignmentStats(assignments) {
    const statsDiv = document.getElementById('assignment-stats');
    if (!statsDiv) return;

    const total = assignments.length;
    const now = new Date();
    const urgent = assignments.filter(a => {
        const hoursLeft = (new Date(a.deadline) - now) / (1000 * 60 * 60);
        return hoursLeft > 0 && hoursLeft <= 48;
    }).length;

    statsDiv.style.display = '';
    statsDiv.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-4">
            <div class="flex items-center gap-4">
                <div class="flex items-center gap-2">
                    <i data-lucide="clipboard-list" class="w-5 h-5 text-blue-600"></i>
                    <span class="font-semibold text-gray-700">${total} Active Tasks</span>
                </div>
                ${urgent > 0 ? `
                    <div class="flex items-center gap-2 text-red-600">
                        <i data-lucide="alert-triangle" class="w-5 h-5"></i>
                        <span class="font-semibold">${urgent} Urgent</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// ============================================
// SINGLE GLOBAL COUNTDOWN TICK (Task 4)
// ============================================

function stopGlobalCountdown() {
    if (globalCountdownId) {
        clearInterval(globalCountdownId);
        globalCountdownId = null;
    }
}

function startGlobalCountdown() {
    stopGlobalCountdown();

    function tick() {
        const elements = document.querySelectorAll('.countdown-display[data-deadline]');
        if (elements.length === 0) {
            stopGlobalCountdown();
            return;
        }

        const now = Date.now();
        elements.forEach(el => {
            const deadline = new Date(el.getAttribute('data-deadline')).getTime();
            const diff = deadline - now;
            if (diff <= 0) return;

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((diff % (1000 * 60)) / 1000);

            const d = el.querySelector('.countdown-days');
            const h = el.querySelector('.countdown-hours');
            const m = el.querySelector('.countdown-mins');
            const s = el.querySelector('.countdown-secs');
            if (d) d.textContent = String(days).padStart(2, '0');
            if (h) h.textContent = String(hours).padStart(2, '0');
            if (m) m.textContent = String(mins).padStart(2, '0');
            if (s) s.textContent = String(secs).padStart(2, '0');
        });
    }

    tick(); // Initial tick
    globalCountdownId = setInterval(tick, 1000);
}

// ============================================
// ASSIGNMENT DETAILS MODAL
// ============================================

function openAssignmentDetails(assignmentId) {
    const assignment = assignmentsData.find(a => a.id === assignmentId);
    if (!assignment) return;

    const modal = document.getElementById('assignment-details-modal');
    const modalTitle = document.getElementById('assignment-modal-title');
    const modalBody = document.getElementById('assignment-modal-body');

    modalTitle.textContent = assignment.title;
    document.title = `${assignment.title} - CSE 63B Portal`;

    const deadline = new Date(assignment.deadline);
    const now = new Date();
    const isPast = now > deadline;

    let linksHTML = '';
    if (assignment.relatedLinks && assignment.relatedLinks.length > 0) {
        linksHTML = `
            <div class="mt-6">
                <h4 class="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <i data-lucide="link" class="w-5 h-5 text-blue-600"></i>
                    Related Links
                </h4>
                <div class="space-y-2">
                    ${assignment.relatedLinks.map(link => `
                        <a href="${escapeHTML(link)}" target="_blank"
                           class="block p-3 border border-gray-200 rounded-lg hover:border-blue-600 hover:bg-blue-50 transition group">
                            <div class="flex items-center justify-between">
                                <span class="text-sm font-medium text-gray-700 group-hover:text-blue-600 truncate">${escapeHTML(link)}</span>
                                <i data-lucide="external-link" class="w-4 h-4 text-gray-400 group-hover:text-blue-600 flex-shrink-0 ml-2"></i>
                            </div>
                        </a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center gap-3">
                <span class="text-sm font-semibold px-3 py-1 rounded-full ${assignment.categoryColor}">
                    ${escapeHTML(assignment.category)}
                </span>
                <span class="text-sm text-gray-500">${escapeHTML(assignment.subject)}</span>
            </div>
            <p class="text-gray-700">${escapeHTML(assignment.description)}</p>
            <div class="bg-gray-50 rounded-lg p-4">
                <div class="flex items-center gap-2 mb-2">
                    <i data-lucide="calendar" class="w-5 h-5 text-blue-600"></i>
                    <span class="font-semibold text-gray-700">Deadline</span>
                </div>
                <p class="text-lg font-bold ${isPast ? 'text-red-600' : 'text-gray-800'}">
                    ${escapeHTML(deadline.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}
                </p>
                ${isPast ? '<p class="text-sm text-red-500 mt-1">This deadline has passed</p>' : ''}
            </div>
            ${linksHTML}
        </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    lucide.createIcons();
}

// ============================================
// SUBJECT MODAL
// ============================================

function openSubjectModal(subjectId) {
    const subject = subjectsData.find(s => s.id === subjectId);
    if (!subject) return;

    const modal = document.getElementById('subject-modal');
    const modalIcon = document.getElementById('subject-modal-icon');
    const modalTitle = document.getElementById('subject-modal-title');
    const modalSubtitle = document.getElementById('subject-modal-subtitle');
    const modalBody = document.getElementById('subject-modal-body');
    const driveLink = document.getElementById('drive-folder-link');
    const breadcrumbName = document.getElementById('subject-breadcrumb-name');

    modalIcon.className = `w-12 h-12 rounded-full flex items-center justify-center text-white ${subject.color}`;
    modalIcon.innerHTML = `<i data-lucide="${escapeHTML(subject.icon)}" class="w-6 h-6"></i>`;
    modalTitle.textContent = subject.name;
    modalSubtitle.textContent = subject.fullName;
    driveLink.href = subject.driveFolder;
    breadcrumbName.textContent = subject.name;

    document.title = `${subject.name} - CSE 63B Portal`;

    // Use the tree structure for nested rendering
    const tree = subject.categories._tree || [];
    let categoriesHTML = '';
    let globalIndex = { value: 0 }; // shared counter for unique IDs

    if (tree.length === 0) {
        categoriesHTML = '<p class="text-gray-500 text-center py-8">No resources available yet</p>';
    } else {
        categoriesHTML = tree.map(node => renderResourceNode(node, 0, globalIndex)).join('');
    }

    modalBody.innerHTML = categoriesHTML;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    lucide.createIcons();

    initModalResourceSearch();

    document.querySelectorAll('.category-toggle').forEach(button => {
        button.addEventListener('click', function () {
            const idx = this.dataset.categoryIndex;
            const content = document.getElementById(`subject-category-${idx}`);
            const arrow = this.querySelector('.category-arrow');

            content.classList.toggle('open');
            arrow.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
        });
    });
}

/**
 * Recursively render a resource tree node as a nested accordion.
 * @param {Object} node - { name, files, children }
 * @param {number} depth - nesting depth (0 = top level)
 * @param {Object} globalIndex - shared counter { value: N } for unique IDs
 */
function renderResourceNode(node, depth, globalIndex) {
    const idx = globalIndex.value++;
    const indent = depth > 0 ? `margin-left: ${depth * 16}px;` : '';
    const bgClass = depth === 0 ? 'bg-gray-50' : 'bg-gray-100';
    const iconName = depth === 0 ? 'folder' : 'folder-open';
    const totalFiles = countAllFiles(node);

    // File list for this node
    let filesHTML = '';
    if (node.files && node.files.length > 0) {
        filesHTML = node.files.map(item => `
            <a href="${escapeHTML(item.link)}" target="_blank"
               class="resource-item block p-3 border border-gray-200 rounded-lg hover:border-blue-600 hover:bg-blue-50 transition group"
               data-name="${escapeHTML(item.name.toLowerCase())}">
                <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-gray-700 group-hover:text-blue-600">${escapeHTML(item.name)}</span>
                    <i data-lucide="external-link" class="w-4 h-4 text-gray-400 group-hover:text-blue-600"></i>
                </div>
            </a>
        `).join('');
    }

    // Recursively render children
    let childrenHTML = '';
    if (node.children && node.children.length > 0) {
        childrenHTML = node.children.map(child => renderResourceNode(child, depth + 1, globalIndex)).join('');
    }

    return `
        <div class="mb-4 border rounded-lg overflow-hidden resource-category" style="${indent}">
            <button class="category-toggle w-full flex items-center justify-between p-4 ${bgClass} hover:bg-gray-100 transition"
                    data-category-index="${idx}">
                <div class="flex items-center gap-3">
                    <i data-lucide="${iconName}" class="w-5 h-5 text-blue-600"></i>
                    <span class="font-bold text-gray-800">${escapeHTML(node.name)}</span>
                    <span class="text-xs bg-blue-600 text-white px-2 py-1 rounded-full">${totalFiles}</span>
                </div>
                <i data-lucide="chevron-down" class="w-5 h-5 text-gray-500 transition-transform category-arrow"></i>
            </button>
            <div class="dropdown-content bg-white" id="subject-category-${idx}">
                <div class="p-4 space-y-3">
                    ${filesHTML}
                    ${childrenHTML}
                </div>
            </div>
        </div>
    `;
}

/**
 * Count total files in a node and all descendants.
 */
function countAllFiles(node) {
    let count = (node.files ? node.files.length : 0);
    if (node.children) {
        node.children.forEach(child => { count += countAllFiles(child); });
    }
    return count;
}

// Named handler reference to prevent listener accumulation
let _resourceSearchHandler = null;

function initModalResourceSearch() {
    const searchInput = document.getElementById('modal-resource-search');
    if (!searchInput) return;

    searchInput.value = '';

    // Remove previous listener if exists
    if (_resourceSearchHandler) {
        searchInput.removeEventListener('input', _resourceSearchHandler);
    }

    _resourceSearchHandler = function (e) {
        const searchTerm = e.target.value.toLowerCase();
        const categories = document.querySelectorAll('.resource-category');

        categories.forEach(category => {
            const items = category.querySelectorAll('.resource-item');
            let hasVisibleItems = false;

            items.forEach(item => {
                const name = item.getAttribute('data-name');
                if (name.includes(searchTerm)) {
                    item.style.display = '';
                    hasVisibleItems = true;
                } else {
                    item.style.display = 'none';
                }
            });

            if (searchTerm && hasVisibleItems) {
                category.style.display = '';
                const dropdown = category.querySelector('.dropdown-content');
                dropdown.classList.add('open');
                category.querySelector('.category-arrow').style.transform = 'rotate(180deg)';
            } else if (searchTerm && !hasVisibleItems) {
                category.style.display = 'none';
            } else {
                category.style.display = '';
            }
        });
    };

    searchInput.addEventListener('input', _resourceSearchHandler);
}

// ============================================
// SCHEDULE TABLE GENERATOR
// ============================================

function renderSchedule() {
    const headerRow = document.getElementById('schedule-header');
    const tbody = document.getElementById('schedule-body');

    if (!scheduleData || !headerRow || !tbody) return;

    let headerHTML = '<th class="py-3 px-4 rounded-tl-xl min-w-[100px]">Day</th>';
    scheduleData.timeSlots.forEach((slot, index) => {
        const roundClass = index === scheduleData.timeSlots.length - 1 ? 'rounded-tr-xl' : '';
        headerHTML += `<th class="py-3 px-2 text-xs sm:text-sm min-w-[140px] ${roundClass}">${escapeHTML(slot)}</th>`;
    });
    headerRow.innerHTML = headerHTML;

    let bodyHTML = '';
    scheduleData.days.forEach(dayData => {
        bodyHTML += `<tr class="bg-white rounded-xl shadow-md">`;
        bodyHTML += `<td class="font-bold text-blue-600 py-4 px-3 rounded-l-xl text-sm sm:text-base whitespace-nowrap">${escapeHTML(dayData.day)}</td>`;

        for (let i = 0; i < 6; i++) {
            const classData = dayData.classes[i];
            const isLast = i === 5;
            const roundClass = isLast ? 'rounded-r-xl' : '';

            if (classData === 'SKIP') continue;

            if (classData === null) {
                bodyHTML += `<td class="py-3 px-2 ${roundClass}"></td>`;
            } else {
                const colspanAttr = classData.colspan > 1 ? `colspan="${classData.colspan}"` : '';
                bodyHTML += `<td class="py-3 px-2 ${roundClass}" ${colspanAttr}>
                    <div class="bg-white border-2 border-blue-600 rounded-xl p-2 w-11/12 mx-auto shadow-md hover:shadow-lg transition-shadow">
                        <p class="font-bold text-blue-600 text-xs sm:text-sm">${escapeHTML(classData.name)}</p>
                        <p class="italic text-blue-800 text-xs">${escapeHTML(classData.instructor)}</p>
                        <p class="text-xs text-gray-600">(${escapeHTML(classData.room)})</p>
                    </div>
                </td>`;
            }
        }

        bodyHTML += '</tr>';
    });

    tbody.innerHTML = bodyHTML;
}

// ============================================
// EXPORT SCHEDULE
// ============================================

function exportSchedule() {
    const scheduleImageUrl = 'https://drive.google.com/uc?export=download&id=19zx8t0FE02QAwTTGAdBv5VMrsj84MpNI';
    const link = document.createElement('a');
    link.href = scheduleImageUrl;
    link.download = 'CSE_63B_Schedule.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============================================
// SUBJECT CARD GENERATOR
// ============================================

function createSubjectCard(subject) {
    const isLab = subject.type === 'lab' || subject.type === 'Lab';
    const typeColor = isLab ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700';
    const typeText = subject.type ? subject.type.charAt(0).toUpperCase() + subject.type.slice(1) : 'Theory';
    const categoryCount = Object.keys(subject.categories).length;

    return `
        <div class="subject-card cursor-pointer bg-white border-2 border-gray-200 rounded-xl shadow-lg overflow-hidden transition hover:shadow-2xl hover:border-blue-600 transform hover:scale-105"
             data-subject-id="${escapeHTML(subject.id)}"
             data-subject-name="${escapeHTML(subject.name.toLowerCase())}"
             data-subject-teacher="${escapeHTML(subject.teacher.toLowerCase())}">
            <div class="${subject.color} p-6 text-white relative">
                <div class="absolute top-4 right-4">
                    <span class="text-xs font-semibold px-3 py-1 rounded-full ${typeColor}">
                        ${typeText}
                    </span>
                </div>
                <div class="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm mb-4">
                    <i data-lucide="${escapeHTML(subject.icon)}" class="w-7 h-7"></i>
                </div>
                <h3 class="text-2xl font-bold">${escapeHTML(subject.name)}</h3>
                <p class="text-sm opacity-90 mt-1">${escapeHTML(subject.fullName)}</p>
                <p class="text-xs opacity-75 mt-2">${escapeHTML(subject.teacher)}</p>
            </div>
            <div class="p-4 bg-white">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2 text-sm text-gray-600">
                        <i data-lucide="folder" class="w-4 h-4"></i>
                        <span class="font-medium">${categoryCount} Categories</span>
                    </div>
                    <i data-lucide="chevron-right" class="w-5 h-5 text-blue-600"></i>
                </div>
                <button onclick="openSubjectModal('${escapeHTML(subject.id)}'); event.stopPropagation();"
                        class="w-full text-center bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium py-2 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2">
                    <i data-lucide="folder-open" class="w-4 h-4"></i>
                    View Resources
                </button>
            </div>
        </div>
    `;
}

// ============================================
// CONTACT CARD GENERATOR
// ============================================

function createContactCard(contact) {
    const hasImage = contact.profileImage && contact.profileImage !== '';

    return `
        <div class="p-6 bg-gray-50 border border-gray-200 rounded-xl shadow-md transition hover:shadow-lg">
            <div class="flex items-start gap-4">
                <div class="w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0 ${hasImage ? '' : 'bg-blue-100 border-4 border-blue-600'}">
                    ${hasImage
            ? `<img src="${escapeHTML(contact.profileImage)}" alt="${escapeHTML(contact.name)}" class="w-full h-full rounded-full object-cover" loading="lazy">`
            : `<i data-lucide="user" class="w-10 h-10 text-blue-600"></i>`
        }
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-bold text-gray-800">${escapeHTML(contact.name)}</h3>
                    <p class="text-sm text-blue-600 font-semibold">${escapeHTML(contact.designation)}</p>
                    <div class="mt-3 space-y-2 text-sm text-gray-600">
                        <div class="flex items-center gap-2" style="display:flex;align-items:center;gap:8px;">
                            <i data-lucide="mail" class="w-4 h-4 text-gray-500 flex-shrink-0" style="display:inline-flex;align-self:center;"></i>
                            <a href="mailto:${escapeHTML(contact.email)}" class="hover:underline hover:text-blue-600 break-all">${escapeHTML(contact.email)}</a>
                        </div>
                        <div class="flex items-center gap-2" style="display:flex;align-items:center;gap:8px;">
                            <i data-lucide="phone" class="w-4 h-4 text-gray-500 flex-shrink-0" style="display:inline-flex;align-self:center;"></i>
                            <a href="tel:${escapeHTML(contact.phone)}" class="hover:underline hover:text-blue-600">${escapeHTML(contact.phone)}</a>
                        </div>
                        ${contact.howToContact ? `
                            <div class="mt-3 pt-3 border-t border-gray-200">
                                <div class="flex items-start gap-2">
                                    <div class="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <i data-lucide="info" class="w-3 h-3 text-blue-600"></i>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <p class="font-semibold text-gray-700 text-xs mb-1">How to Contact</p>
                                        <p class="text-xs text-gray-600 leading-relaxed">${escapeHTML(contact.howToContact)}</p>
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// CALENDAR GENERATOR
// ============================================

function generateCalendar(monthOffset = 0) {
    const cacheKey = `calendar-${monthOffset}`;
    if (calendarCache[cacheKey]) {
        return calendarCache[cacheKey];
    }

    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    let calendarHTML = `
        <div class="grid grid-cols-7 gap-2 mb-2">
            <div class="text-center font-semibold text-gray-600 py-2">Sun</div>
            <div class="text-center font-semibold text-gray-600 py-2">Mon</div>
            <div class="text-center font-semibold text-gray-600 py-2">Tue</div>
            <div class="text-center font-semibold text-gray-600 py-2">Wed</div>
            <div class="text-center font-semibold text-gray-600 py-2">Thu</div>
            <div class="text-center font-semibold text-red-600 py-2">Fri</div>
            <div class="text-center font-semibold text-red-600 py-2">Sat</div>
        </div>
        <div class="grid grid-cols-7 gap-2">
    `;

    for (let i = 0; i < startingDayOfWeek; i++) {
        calendarHTML += '<div></div>';
    }

    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasEvent = calendarEvents[dateStr] && calendarEvents[dateStr].length > 0;
        const isToday = isCurrentMonth && day === today.getDate();

        const currentDate = new Date(year, month, day);
        const dayOfWeek = currentDate.getDay();
        const isFridayOrSaturday = dayOfWeek === 5 || dayOfWeek === 6;

        let colorClass = '';
        if (hasEvent) {
            const events = calendarEvents[dateStr];
            const categories = events.map(e => e.category);
            const hasTest = categories.includes('Test');
            const hasRegularEvent = categories.some(c => c !== 'Test' && c !== 'Off Day');
            const hasOffDay = categories.includes('Off Day');

            if (hasTest && hasRegularEvent) {
                colorClass = 'has-event-gradient';
            } else if (hasTest) {
                colorClass = 'has-event-purple';
            } else if (hasOffDay) {
                colorClass = 'has-event-red';
            } else {
                colorClass = 'has-event';
            }
        } else if (isFridayOrSaturday) {
            colorClass = 'weekend-day';
        }

        calendarHTML += `
            <div class="calendar-day ${colorClass} ${isToday ? 'today' : ''}"
                 data-date="${dateStr}"
                 ${hasEvent ? `onmouseenter="showEventTooltip(event, '${dateStr}')" onmouseleave="hideEventTooltip()"` : ''}>
                ${day}
            </div>
        `;
    }

    calendarHTML += '</div>';
    calendarCache[cacheKey] = calendarHTML;
    return calendarHTML;
}

function showEventTooltip(event, dateStr) {
    const tooltip = document.getElementById('event-tooltip');
    const events = calendarEvents[dateStr];
    if (!events || events.length === 0) return;

    let tooltipHTML = '';
    events.forEach(evt => {
        let titleColor = 'text-blue-600';
        if (evt.category === 'Test') titleColor = 'text-purple-600';
        else if (evt.category === 'Off Day') titleColor = 'text-red-600';

        tooltipHTML += `
            <div class="mb-2 last:mb-0">
                <div class="font-bold ${titleColor} text-sm">${escapeHTML(evt.title)}</div>
                <div class="text-xs text-gray-600">${escapeHTML(evt.description)}</div>
            </div>
        `;
    });

    tooltip.innerHTML = tooltipHTML;
    tooltip.style.left = event.pageX + 10 + 'px';
    tooltip.style.top = event.pageY + 10 + 'px';
    tooltip.classList.add('show');
}

function hideEventTooltip() {
    const tooltip = document.getElementById('event-tooltip');
    tooltip.classList.remove('show');
}

// ============================================
// SECTION RENDER FUNCTIONS
// ============================================

function renderAnnouncements() {
    const container = document.getElementById('announcements-container');
    if (!container) return;
    const visible = announcementsData.filter(a => shouldShowAnnouncement(a.date));

    if (visible.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <i data-lucide="inbox" class="w-16 h-16 mx-auto text-gray-300 mb-4"></i>
                <p class="text-gray-500 text-lg font-medium">No recent announcements</p>
                <p class="text-gray-400 text-sm mt-2">Check back later for updates</p>
            </div>
        `;
    } else {
        container.innerHTML = visible.map(createAnnouncementCard).join('');
    }
}

function renderAssignments() {
    stopGlobalCountdown();
    const container = document.getElementById('assignments-container');
    if (!container) return;
    const visible = assignmentsData
        .filter(a => shouldShowAssignment(a.deadline))
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    if (visible.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <i data-lucide="check-circle" class="w-16 h-16 mx-auto text-green-500 mb-4"></i>
                <p class="text-gray-500 text-lg font-medium">No active assignments</p>
                <p class="text-gray-400 text-sm mt-2">You're all caught up! Ã°Å¸Å½â€°</p>
            </div>
        `;
        const statsDiv = document.getElementById('assignment-stats');
        if (statsDiv) statsDiv.style.display = 'none';
    } else {
        container.innerHTML = visible.map(createAssignmentCard).join('');
        renderAssignmentStats(visible);
        startGlobalCountdown();
    }

    // Bind click handlers
    document.querySelectorAll('.assignment-card').forEach(card => {
        card.addEventListener('click', function () {
            openAssignmentDetails(this.dataset.assignmentId);
        });
    });
}

function renderSubjects() {
    const container = document.getElementById('subjects-container');
    if (!container) return;
    container.innerHTML = subjectsData.map(createSubjectCard).join('');
    document.querySelectorAll('.subject-card').forEach(card => {
        card.addEventListener('click', function () {
            openSubjectModal(this.dataset.subjectId);
        });
    });
}

function renderContacts() {
    const container = document.getElementById('contact-container');
    if (!container) return;
    container.innerHTML = contactData.map(createContactCard).join('');
}

// Full render (used when applying deferred updates)
function renderPortalContent() {
    stopGlobalCountdown();
    renderAnnouncements();
    renderAssignments();
    renderSchedule();
    renderSubjects();
    renderContacts();
    updateWeeklyStats();
    lucide.createIcons();
}

// ============================================
// ENHANCEMENTS INITIALIZATION
// ============================================

function initializeEnhancements() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', function () {
            mobileMenu.classList.toggle('open');
            const icon = this.querySelector('i');
            if (mobileMenu.classList.contains('open')) {
                icon.setAttribute('data-lucide', 'x');
            } else {
                icon.setAttribute('data-lucide', 'menu');
            }
            lucide.createIcons({ nodes: [this] });
        });
    }

    document.querySelectorAll('#mobile-menu a').forEach(link => {
        link.addEventListener('click', () => {
            if (mobileMenu) {
                mobileMenu.classList.remove('open');
                const icon = mobileMenuBtn.querySelector('i');
                icon.setAttribute('data-lucide', 'menu');
                lucide.createIcons({ nodes: [mobileMenuBtn] });
            }
        });
    });

    // Combined scroll handler using requestAnimationFrame for performance
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    const fab = document.getElementById('scroll-to-top');
    const progressBar = document.getElementById('progress-bar');
    let scrollTicking = false;

    window.addEventListener('scroll', function () {
        if (!scrollTicking) {
            requestAnimationFrame(function () {
                const winScroll = document.documentElement.scrollTop;
                const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;

                // Progress bar
                if (progressBar) {
                    const scrolled = (winScroll / height) * 100;
                    progressBar.style.width = scrolled + '%';
                }

                // Active nav link highlighting
                let current = '';
                sections.forEach(section => {
                    const sectionTop = section.offsetTop;
                    if (window.scrollY >= (sectionTop - 100)) {
                        current = section.getAttribute('id');
                    }
                });

                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === '#' + current) {
                        link.classList.add('active');
                        const sectionName = current.charAt(0).toUpperCase() + current.slice(1);
                        document.title = `${sectionName} - CSE 63B Portal`;
                    }
                });

                // Scroll-to-top FAB visibility
                if (fab) {
                    if (window.scrollY > 300) {
                        fab.style.opacity = '1';
                        fab.style.pointerEvents = 'auto';
                    } else {
                        fab.style.opacity = '0';
                        fab.style.pointerEvents = 'none';
                    }
                }

                scrollTicking = false;
            });
            scrollTicking = true;
        }
    });

    if (fab) {
        fab.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const adminBtn = document.getElementById('admin-button');
    if (adminBtn) {
        adminBtn.addEventListener('click', function () {
            window.location.href = 'admin.html';
        });
        adminBtn.style.opacity = '1';
        adminBtn.style.pointerEvents = 'auto';
    }

    const exportBtn = document.getElementById('export-schedule-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportSchedule);
    }

    initSwipeToClose();
    initModalHandlers();
}

// ============================================
// FOCUS TRAP UTILITY (Task 6)
// ============================================

function trapFocus(modal) {
    const focusable = modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    function handler(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }
    modal.addEventListener('keydown', handler);
    modal._focusTrapHandler = handler;
}

function releaseFocus(modal) {
    if (modal._focusTrapHandler) {
        modal.removeEventListener('keydown', modal._focusTrapHandler);
        delete modal._focusTrapHandler;
    }
}

function openModal(modalId, title) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal._triggerElement = document.activeElement;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (title) document.title = title;
    trapFocus(modal);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.title = 'CSE 63B - Web Portal';
    if (modal._triggerElement) {
        modal._triggerElement.focus();
        delete modal._triggerElement;
    }
}

// ============================================
// SWIPE TO CLOSE MODALS
// ============================================

function initSwipeToClose() {
    const modals = document.querySelectorAll('[id$="-modal"]');

    modals.forEach(modal => {
        let startY = 0;
        let currentY = 0;
        const modalContent = modal.querySelector('.modal-content-animate');
        if (!modalContent) return;

        modalContent.addEventListener('touchstart', function (e) {
            startY = e.touches[0].clientY;
        }, { passive: true });

        modalContent.addEventListener('touchmove', function (e) {
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            if (diff > 0) {
                modalContent.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: true });

        modalContent.addEventListener('touchend', function () {
            const diff = currentY - startY;
            if (diff > 100) {
                closeModal(modal.id);
            }
            modalContent.style.transform = '';
            startY = 0;
            currentY = 0;
        });
    });
}

// ============================================
// MODAL HANDLERS
// ============================================

function initModalHandlers() {
    const openCalendarBtn = document.getElementById('open-calendar-btn');
    if (openCalendarBtn) {
        openCalendarBtn.addEventListener('click', function () {
            const calendarView = document.getElementById('calendar-view');
            currentMonthOffset = 0;
            calendarView.innerHTML = generateCalendar(currentMonthOffset);
            openModal('calendar-modal', 'Calendar - CSE 63B Portal');
        });
    }

    const closeCalendarBtn = document.getElementById('close-calendar-btn');
    if (closeCalendarBtn) {
        closeCalendarBtn.addEventListener('click', () => closeModal('calendar-modal'));
    }

    const prevMonthBtn = document.getElementById('prev-month-btn');
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', function () {
            currentMonthOffset--;
            document.getElementById('calendar-view').innerHTML = generateCalendar(currentMonthOffset);
        });
    }

    const nextMonthBtn = document.getElementById('next-month-btn');
    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', function () {
            currentMonthOffset++;
            document.getElementById('calendar-view').innerHTML = generateCalendar(currentMonthOffset);
        });
    }

    const openAnnouncementHistoryBtn = document.getElementById('open-announcement-history-btn');
    if (openAnnouncementHistoryBtn) {
        openAnnouncementHistoryBtn.addEventListener('click', function () {
            const body = document.getElementById('announcement-history-body');
            const allAnnouncements = announcementsData.filter(a => !shouldShowAnnouncement(a.date));

            if (allAnnouncements.length === 0) {
                body.innerHTML = `
                    <div class="text-center py-12">
                        <i data-lucide="inbox" class="w-16 h-16 mx-auto text-gray-300 mb-4"></i>
                        <p class="text-gray-500 text-lg font-medium">No announcement history yet</p>
                        <p class="text-gray-400 text-sm mt-2">Past announcements will appear here</p>
                    </div>
                `;
            } else {
                body.innerHTML = '<div class="grid md:grid-cols-2 gap-6">' +
                    allAnnouncements.map(createAnnouncementCard).join('') +
                    '</div>';
            }

            openModal('announcement-history-modal', 'Announcement History - CSE 63B Portal');
            lucide.createIcons();
        });
    }

    const closeAnnouncementHistoryBtn = document.getElementById('close-announcement-history-btn');
    if (closeAnnouncementHistoryBtn) {
        closeAnnouncementHistoryBtn.addEventListener('click', () => closeModal('announcement-history-modal'));
    }

    // Assignment History with Search + Filter (Task 9)
    const openAssignmentHistoryBtn = document.getElementById('open-assignment-history-btn');
    if (openAssignmentHistoryBtn) {
        openAssignmentHistoryBtn.addEventListener('click', function () {
            const body = document.getElementById('assignment-history-body');
            const allAssignments = assignmentsData.filter(a => !shouldShowAssignment(a.deadline));

            // Build search + filter UI
            const categories = ['All', ...new Set(allAssignments.map(a => a.category))];
            const filterButtons = categories.map(c => 
                `<button class="history-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    c === 'All' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }" data-filter="${escapeHTML(c)}">${escapeHTML(c)}</button>`
            ).join('');

            body.innerHTML = `
                <div class="mb-4 space-y-3">
                    <div class="relative">
                        <input type="text" id="history-search" placeholder="Search past assignments..." 
                               class="w-full p-2.5 pl-10 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-sm">
                        <i data-lucide="search" class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2"></i>
                    </div>
                    <div class="flex gap-2 flex-wrap" id="history-filters">${filterButtons}</div>
                </div>
                <div id="history-results"></div>
            `;

            let activeFilter = 'All';

            function renderHistoryResults() {
                const searchVal = (document.getElementById('history-search')?.value || '').toLowerCase();
                let filtered = allAssignments;

                if (activeFilter !== 'All') {
                    filtered = filtered.filter(a => a.category === activeFilter);
                }
                if (searchVal) {
                    filtered = filtered.filter(a => 
                        a.title.toLowerCase().includes(searchVal) ||
                        a.description.toLowerCase().includes(searchVal) ||
                        a.subject.toLowerCase().includes(searchVal)
                    );
                }

                const resultsDiv = document.getElementById('history-results');
                if (filtered.length === 0) {
                    resultsDiv.innerHTML = `
                        <div class="text-center py-12">
                            <i data-lucide="search-x" class="w-16 h-16 mx-auto text-gray-300 mb-4"></i>
                            <p class="text-gray-500 text-lg font-medium">No results found</p>
                            <p class="text-gray-400 text-sm mt-2">Try a different search or filter</p>
                        </div>
                    `;
                } else {
                    resultsDiv.innerHTML = '<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">' +
                        filtered.map(createAssignmentCard).join('') + '</div>';
                }
                lucide.createIcons();
            }

            renderHistoryResults();

            // Debounced search
            let searchTimer;
            document.getElementById('history-search')?.addEventListener('input', function () {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(renderHistoryResults, 300);
            });

            // Category filter buttons
            document.querySelectorAll('.history-filter-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    activeFilter = this.dataset.filter;
                    document.querySelectorAll('.history-filter-btn').forEach(b => {
                        b.className = b.dataset.filter === activeFilter
                            ? 'history-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold transition bg-blue-600 text-white'
                            : 'history-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold transition bg-gray-200 text-gray-700 hover:bg-gray-300';
                    });
                    renderHistoryResults();
                });
            });

            openModal('assignment-history-modal', 'Assignment History - CSE 63B Portal');
            lucide.createIcons();
        });
    }

    const closeAssignmentHistoryBtn = document.getElementById('close-assignment-history-btn');
    if (closeAssignmentHistoryBtn) {
        closeAssignmentHistoryBtn.addEventListener('click', () => closeModal('assignment-history-modal'));
    }

    const closeAssignmentDetailsBtn = document.getElementById('close-assignment-details-btn');
    if (closeAssignmentDetailsBtn) {
        closeAssignmentDetailsBtn.addEventListener('click', () => closeModal('assignment-details-modal'));
    }

    const closeSubjectModalBtn = document.getElementById('close-subject-modal-btn');
    if (closeSubjectModalBtn) {
        closeSubjectModalBtn.addEventListener('click', () => closeModal('subject-modal'));
    }

    // Close modals on outside click
    [
        'calendar-modal', 'announcement-history-modal',
        'assignment-history-modal', 'assignment-details-modal', 'subject-modal'
    ].forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === this) {
                    closeModal(modalId);
                }
            });
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('[id$="-modal"]:not(.hidden)').forEach(modal => {
                closeModal(modal.id);
            });
        }
    });
}

// Make functions globally accessible
window.openAssignmentDetails = openAssignmentDetails;
window.openSubjectModal = openSubjectModal;
window.showEventTooltip = showEventTooltip;
window.hideEventTooltip = hideEventTooltip;

// ============================================
// "UPDATES AVAILABLE" BANNER (Task 5)
// ============================================

function isAnyModalOpen() {
    return !!document.querySelector('[id$="-modal"]:not(.hidden)');
}

function showUpdateBanner() {
    if (updateBannerSuppressed) return;
    if (isAnyModalOpen()) {
        // Wait for modal close, then check again
        const observer = new MutationObserver(() => {
            if (!isAnyModalOpen()) {
                observer.disconnect();
                showUpdateBanner();
            }
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        return;
    }
    const banner = document.getElementById('update-banner');
    if (banner) banner.classList.remove('hidden');
}

function applyPendingUpdate() {
    if (!pendingUpdateData) return;
    const d = pendingUpdateData;
    calendarCache = {};
    announcementsData = mapAnnouncements(d.announcements);
    assignmentsData = mapAssignments(d.assignments);
    subjectsData = mapSubjects(d.subjects);
    calendarEvents = mapCalendar(d.calendar);
    contactData = mapContacts(d.contacts);
    scheduleData = buildScheduleData(d.schedule.filter(s => s.archived !== true));
    pendingUpdateData = null;
    renderPortalContent();
    const banner = document.getElementById('update-banner');
    if (banner) banner.classList.add('hidden');
}

function dismissUpdateBanner() {
    const banner = document.getElementById('update-banner');
    if (banner) banner.classList.add('hidden');
    updateBannerSuppressed = true;
    pendingUpdateData = null;
}

window.applyPendingUpdate = applyPendingUpdate;
window.dismissUpdateBanner = dismissUpdateBanner;

// ============================================
// INITIALIZATION (Progressive)
// ============================================

document.addEventListener('DOMContentLoaded', async function () {
    // Initialize Firebase
    if (!initFirebase()) {
        showToast('Failed to connect to the server. Please check your configuration.', 'error');
        return;
    }

    initializeEnhancements();
    lucide.createIcons();

    // Phase 1: Load critical data first
    await loadPhase1();

    // Phase 2: Load deferred data
    await loadPhase2();
});

// Background auto-refresh every hour Ã¢â€ â€™ "Updates Available" banner
setInterval(async () => {
    try {
        const freshData = await loadAllData();
        pendingUpdateData = freshData;
        showUpdateBanner();
    } catch (error) {
        // Silently fail on background refresh
    }
}, 3600000);

